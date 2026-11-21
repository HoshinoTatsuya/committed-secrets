import { copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GateHarness } from './testing/gate-harness';

const ROOT = join(__dirname, '..');
const read = (file: string): string => readFileSync(join(ROOT, file), 'utf8');
const EXAMPLES = ['examples/committed-secrets.json', 'examples/committed-secret-fixtures.json'];

/** README цитирует примеры дословно: настройка, которую проверяет спека ниже, — та, что в README. */
describe.each(['README.md', 'README.ru.md'])('%s цитирует examples/', (readme) => {
  it.each(EXAMPLES)('%s — дословно', (file) => {
    expect(read(readme)).toContain(read(file).trim());
  });
});

/**
 * Быстрый старт README на настоящем репозитории git: настройка и перечень
 * фикстур из examples/, собранный гейт (`bin`). Фикстура теста освобождена,
 * новый секрет в коде — находка с кодом 1, и значение в выводе не появляется.
 */
describe('быстрый старт README', () => {
  const OTHER = ['Wk7', 'pL3nB8qR2x'].join('');
  let repo = '';

  beforeAll(() => {
    repo = GateHarness.tempDir('secrets-readme-');
    GateHarness.git(repo, 'init', '-q');
    copyFileSync(join(ROOT, EXAMPLES[0] as string), join(repo, 'committed-secrets.json'));
    copyFileSync(join(ROOT, EXAMPLES[1] as string), join(repo, 'committed-secret-fixtures.json'));
    for (let index = 0; index < 50; index += 1) {
      GateHarness.write(repo, `src/module-${index}.ts`, `export const value${index} = ${index};\n`);
    }
    GateHarness.write(repo, 'docker-compose.yml', 'services:\n  db:\n    image: postgres:17-alpine\n');
    GateHarness.write(repo, 'README.md', '# app\n');
    GateHarness.write(
      repo,
      'src/testing/postgres.harness.ts',
      `export const POSTGRES_PASSWORD = '${GateHarness.VALUE}';\n`,
    );
    GateHarness.git(repo, 'add', '-A');
  });

  afterAll(() => {
    GateHarness.remove(repo);
  });

  it('чистый репозиторий с фикстурой из перечня — код 0', () => {
    const result = GateHarness.run([], repo);
    expect([result.status, GateHarness.flagged(result.stderr, repo)]).toEqual([0, []]);
  });

  it('секрет в коде — находка с кодом 1, значение не выводится; --staged видит его в индексе', () => {
    GateHarness.write(repo, 'src/app/config.ts', `export const apiKey = '${OTHER}';\n`);
    GateHarness.git(repo, 'add', '-A');
    const full = GateHarness.run([], repo);
    const staged = GateHarness.run(['--staged'], repo);
    expect([full.status, GateHarness.flagged(full.stderr, repo)]).toEqual([1, ['src/app/config.ts:1']]);
    expect([staged.status, GateHarness.flagged(staged.stderr, repo)]).toEqual([1, ['src/app/config.ts:1']]);
    expect(`${full.stdout}${full.stderr}${staged.stdout}${staged.stderr}`).not.toContain(OTHER);
  });
});
