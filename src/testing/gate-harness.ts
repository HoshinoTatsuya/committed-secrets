import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Обвязка спек: запуск собранного гейта (`bin`) во временном репозитории.
 * Значения секретов собираются в рантайме — литерал в спеке нашёл бы сам гейт
 * на прогоне по репозиторию.
 */
export class GateHarness {
  public static readonly BIN = join(__dirname, '..', '..', 'bin', 'committed-secrets.cjs');

  public static readonly FIXTURES_LIST = join(
    'src',
    'architecture',
    'allowlists',
    'committed-secret-fixtures.json',
  );

  public static readonly DELIVERY_PATTERN =
    '^(deploy/|docker-compose[^/]*\\.ya?ml$|(?:[^/]*/)*Dockerfile[^/]*$|[^/]*\\.Dockerfile$|\\.gitlab-ci\\.yml$|\\.env\\.example$)';

  /** Потолок одного запуска гейта или git: зависание — падение теста, а не держание очереди. */
  public static readonly TIMEOUT_MS = 30_000;

  /** Поддельное значение, похожее на настоящий секрет: буквы разного регистра и цифры. */
  public static readonly VALUE = ['Zq8', 'vR2mT7xLp4'].join('');

  /** Конфигурация проекта-потребителя; порог и классы — параметрами. */
  public static config(minFiles: number, requiredKinds: string[] = []): Record<string, unknown> {
    return {
      minFiles,
      requiredKinds,
      fixturesPath: GateHarness.FIXTURES_LIST,
      deliveryPattern: GateHarness.DELIVERY_PATTERN,
      serviceCodeRoot: 'src/',
    };
  }

  public static run(args: readonly string[], cwd: string, env?: NodeJS.ProcessEnv): SpawnSyncReturns<string> {
    return spawnSync(process.execPath, [GateHarness.BIN, ...args], {
      cwd,
      encoding: 'utf8',
      env: env ?? process.env,
      timeout: GateHarness.TIMEOUT_MS,
    });
  }

  public static git(cwd: string, ...args: string[]): SpawnSyncReturns<string> {
    const result = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
      cwd,
      encoding: 'utf8',
      timeout: GateHarness.TIMEOUT_MS,
    });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    }
    return result;
  }

  /** Найденные гейтом строки: `<файл>:<строка>` из отчёта. */
  public static flagged(stderr: string, root: string): string[] {
    return stderr
      .split('\n')
      .map((line) => /^ {2}(\S+):(\d+) {2}/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => `${(match[1] ?? '').replace(`${root}/`, '')}:${match[2] ?? ''}`);
  }

  /** Временный каталог с настоящим путём ($TMPDIR macOS — ссылка). */
  public static tempDir(prefix: string): string {
    return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  }

  public static remove(dir: string): void {
    rmSync(dir, { recursive: true, force: true });
  }

  public static write(root: string, path: string, text: string | Buffer): void {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  public static writeConfig(root: string, value: object): void {
    GateHarness.write(root, 'committed-secrets.json', JSON.stringify(value));
  }

  /** Репозиторий git с конфигурацией и пустым перечнем фикстур. */
  public static repo(prefix: string, config: object = GateHarness.config(1)): string {
    const root = GateHarness.tempDir(prefix);
    GateHarness.git(root, 'init', '-q');
    GateHarness.writeConfig(root, config);
    GateHarness.write(root, GateHarness.FIXTURES_LIST, '[]');
    return root;
  }
}
