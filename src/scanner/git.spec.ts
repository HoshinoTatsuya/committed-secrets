import { GateHarness } from '../testing/gate-harness';
import { GateBrokenError } from './gate-broken.error';
import { Git } from './git';

/**
 * Причина отказа git называет то, что чинить: переполнение буфера — не «нет
 * git» (прежде `--staged` на индексе больше 1 ГиБ отвечал именно так), и
 * оборванный поток блобов — не «секретов нет».
 */
describe('вызовы git', () => {
  let repo = '';

  beforeAll(() => {
    repo = GateHarness.repo('secrets-git-');
    for (let index = 0; index < 50; index += 1) {
      GateHarness.write(repo, `docs/file-${index}.md`, `строка ${index}\n`);
    }
    GateHarness.git(repo, 'add', '-A');
  });

  afterAll(() => {
    GateHarness.remove(repo);
  });

  it('вывод больше буфера — ENOBUFS с размером, а не «нет git»', () => {
    let error: unknown;
    try {
      Git.run(repo, ['ls-files', '-s', '-z'], { maxBuffer: 1024 });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(GateBrokenError);
    expect((error as Error).message).toContain('ENOBUFS');
    expect((error as Error).message).toContain('git ls-files -s -z');
    expect((error as Error).message).toContain('не поместился в буфер');
    expect((error as Error).message).not.toContain('нет git');
  });

  it('код ≠ 0 — команда и ответ git; allowFailure — ответ, а не отказ', () => {
    expect(() => Git.run(repo, ['rev-parse', '--verify', 'нет-такой-ссылки'])).toThrow(
      /git rev-parse --verify нет-такой-ссылки: \S/u,
    );
    expect(
      Git.run(repo, ['rev-parse', '--verify', '--quiet', 'нет'], { allowFailure: true }).status,
    ).not.toBe(0);
  });

  it('поток записей: все пути, ровно по одному', async () => {
    const paths: string[] = [];
    for await (const path of Git.records(repo, ['ls-files', '-z'])) {
      paths.push(path);
    }
    expect(paths.filter((path) => path.startsWith('docs/'))).toHaveLength(50);
  });

  it('поток блобов: содержимое по порядку; отсутствующий блоб — null', async () => {
    const shas = ['docs/file-3.md', 'docs/file-7.md'].map((path) =>
      GateHarness.git(repo, 'rev-parse', `:${path}`).stdout.trim(),
    );
    const contents: Array<string | null> = [];
    for await (const blob of Git.blobs(repo, [shas[0] as string, '1'.repeat(40), shas[1] as string])) {
      contents.push(blob === null ? null : blob.toString('utf8'));
    }
    expect(contents).toEqual(['строка 3\n', null, 'строка 7\n']);
  });

  it('git отказал посреди потока — отказ, а не пустой ответ', async () => {
    const read = async () => {
      for await (const _ of Git.records(repo, ['log', 'нет-такой-ветки'])) {
        // читаем до конца
      }
    };
    await expect(read()).rejects.toThrow(/git log нет-такой-ветки: \S/u);
  });
});
