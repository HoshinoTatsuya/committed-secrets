import { spawn, spawnSync } from 'node:child_process';

import { GateBrokenError } from './gate-broken.error';

/**
 * Вызовы git. Отказ — `GateBrokenError` с ПРИЧИНОЙ: «git не найден»,
 * «вывод больше потолка» (ENOBUFS) и «git ответил ошибкой» лечатся
 * по-разному, и «нет git» на переполнении буфера отправляет чинить не то.
 * Большие выводы (список файлов, история, содержимое блобов) — потоком: память
 * не растёт с размером репозитория.
 */
export class Git {
  /** Потолок синхронного вывода: короткие ответы (rev-parse, один блоб конфигурации). */
  public static readonly SYNC_MAX_BUFFER = 64 * 1024 * 1024;

  private static readonly MISSING = 'в окружении нет git, а список файлов берётся у него.';

  /** Короткий вызов. `allowFailure` — код ≠ 0 не отказ, а ответ (`rev-parse --verify`). */
  public static run(
    root: string,
    args: readonly string[],
    options: { readonly maxBuffer?: number; readonly allowFailure?: boolean } = {},
  ): { readonly status: number; readonly stdout: Buffer } {
    const maxBuffer = options.maxBuffer ?? Git.SYNC_MAX_BUFFER;
    const result = spawnSync('git', args, { cwd: root, maxBuffer });
    if (result.error !== undefined) {
      throw Git.spawnError(args, result.error, maxBuffer);
    }
    const status = result.status ?? 1;
    if (status !== 0 && options.allowFailure !== true) {
      throw Git.statusError(args, status, result.stderr.toString('utf8'));
    }
    return { status, stdout: result.stdout };
  }

  /** Записи вывода, разделённые NUL (`ls-files -z`, `log -z`), — потоком. */
  public static async *records(root: string, args: readonly string[]): AsyncGenerator<string> {
    const child = spawn('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = { requested: false };
    const done = Git.completion(child, args, stop);
    let carry: Buffer = Buffer.alloc(0);
    try {
      for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
        carry = carry.length === 0 ? chunk : Buffer.concat([carry, chunk]);
        let start = 0;
        let end = carry.indexOf(0, start);
        while (end !== -1) {
          yield carry.subarray(start, end).toString('utf8');
          start = end + 1;
          end = carry.indexOf(0, start);
        }
        carry = carry.subarray(start);
      }
      await done;
    } finally {
      stop.requested = true;
      child.kill();
    }
    if (carry.length > 0) {
      yield carry.toString('utf8');
    }
  }

  /**
   * Содержимое блобов по одному, в порядке запроса (`cat-file --batch`): в
   * памяти — один блоб, а не индекс целиком. `null` — блоба нет в базе.
   */
  public static async *blobs(root: string, shas: readonly string[]): AsyncGenerator<Buffer | null> {
    if (shas.length === 0) {
      return;
    }
    const args = ['cat-file', '--batch'];
    const child = spawn('git', args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    const stop = { requested: false };
    const done = Git.completion(child, args, stop);
    // Запрос пишется, пока читается ответ: потребитель, прервавший чтение
    // (находка-исключение, оборванный ответ), убивает git, и недописанный запрос
    // получает EPIPE. Без слушателя это uncaughtException — падение процесса с
    // кодом 1, то есть «найдены секреты». Причину отказа скажет completion.
    child.stdin.on('error', () => undefined);
    // Запись — отдельной задачей: git пишет ответ, пока читает запрос, и
    // последовательная запись всего запроса до чтения ответа встала бы.
    const writing = (async () => {
      for (let start = 0; start < shas.length; start += 1024) {
        const ok = child.stdin.write(`${shas.slice(start, start + 1024).join('\n')}\n`);
        if (!ok) {
          await new Promise<void>((resolve) => {
            child.stdin.once('drain', resolve);
          });
        }
      }
      child.stdin.end();
    })();
    writing.catch(() => undefined);
    const chunks: Buffer[] = [];
    let buffered = 0;
    let need = -1;
    let index = 0;
    const take = (size: number): Buffer => {
      const all = chunks.length === 1 ? (chunks[0] as Buffer) : Buffer.concat(chunks, buffered);
      chunks.length = 0;
      const head = all.subarray(0, size);
      const rest = all.subarray(size);
      if (rest.length > 0) {
        chunks.push(rest);
      }
      buffered = rest.length;
      return head;
    };
    try {
      for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
        chunks.push(chunk);
        buffered += chunk.length;
        for (;;) {
          if (need === -1) {
            const joined = chunks.length === 1 ? (chunks[0] as Buffer) : Buffer.concat(chunks, buffered);
            chunks.length = 0;
            chunks.push(joined);
            const newline = joined.indexOf(0x0a);
            if (newline === -1) {
              break;
            }
            const header = take(newline + 1)
              .toString('utf8')
              .trim()
              .split(' ');
            const sha = shas[index] ?? '';
            if (header[0] !== sha) {
              throw new GateBrokenError(`git cat-file: неожиданный ответ для ${sha}`);
            }
            if (header[1] === 'missing') {
              index += 1;
              yield null;
              continue;
            }
            need = Number(header[2]) + 1;
          }
          if (buffered < need) {
            break;
          }
          const data = take(need).subarray(0, need - 1);
          need = -1;
          index += 1;
          yield data;
        }
      }
      await done;
      await writing;
    } finally {
      stop.requested = true;
      child.kill();
    }
    if (index !== shas.length) {
      throw new GateBrokenError(`git cat-file: ответ оборвался на ${index} из ${shas.length} блобов`);
    }
  }

  /**
   * Завершение процесса. Остановка по НАШЕМУ запросу (потребитель прервал
   * чтение) — не отказ; любой другой сигнал или код ≠ 0 — отказ: оборванный
   * вывод читался бы как «секретов нет».
   */
  private static completion(
    child: ReturnType<typeof spawn>,
    args: readonly string[],
    stop: { readonly requested: boolean },
  ): Promise<void> {
    const stderr: Buffer[] = [];
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    const result = new Promise<void>((resolve, reject) => {
      child.once('error', (error) => reject(Git.spawnError(args, error, 0)));
      child.once('close', (code, signal) => {
        if (code === 0 || (stop.requested && signal !== null)) {
          resolve();
        } else {
          reject(Git.statusError(args, code ?? 1, Buffer.concat(stderr).toString('utf8')));
        }
      });
    });
    result.catch(() => undefined);
    return result;
  }

  private static spawnError(args: readonly string[], error: Error, maxBuffer: number): GateBrokenError {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return new GateBrokenError(Git.MISSING);
    }
    if (code === 'ENOBUFS') {
      return new GateBrokenError(
        `git ${args.join(' ')}: вывод больше ${Math.round(maxBuffer / 1024 / 1024)} МиБ (ENOBUFS) — git есть, ответ не поместился в буфер`,
      );
    }
    return new GateBrokenError(`git ${args.join(' ')}: ${error.message}`);
  }

  private static statusError(args: readonly string[], status: number, stderr: string): GateBrokenError {
    const reason = stderr.trim();
    return new GateBrokenError(`git ${args.join(' ')}: ${reason || `код ${String(status)}`}`);
  }
}
