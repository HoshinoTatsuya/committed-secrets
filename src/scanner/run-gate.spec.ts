import { symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { GateHarness } from '../testing/gate-harness';

/**
 * Гейт целиком: аргументы, порог выборки, пути в отчёте, тексты отказов.
 * Каждый ответ «не смог проверить» сверяется по ПРИЧИНЕ, а не по коду: код 2
 * дают и отсутствующий путь, и упавшее чтение — различает их только текст.
 */
const { VALUE } = GateHarness;

describe('гейт: аргументы и порог выборки', () => {
  let repo = '';

  beforeEach(() => {
    repo = GateHarness.repo('secrets-run-');
  });

  afterEach(() => {
    GateHarness.remove(repo);
  });

  const commitAll = (): void => {
    GateHarness.git(repo, 'add', '-A');
  };

  it('файлов ровно столько, сколько порог, — выборка достаточна', () => {
    // Конфигурация и перечень фикстур — тоже текстовые файлы выборки.
    GateHarness.write(repo, 'a.ts', '\n');
    GateHarness.writeConfig(repo, GateHarness.config(3));
    commitAll();
    expect(GateHarness.run([], repo).status).toBe(0);
    GateHarness.writeConfig(repo, GateHarness.config(4));
    const result = GateHarness.run([], repo);
    expect(result.stderr).toContain('гейт просмотрел 3 текстовых файлов (нужно от 4)');
    expect(result.status).toBe(2);
  });

  it('класс .env.example узнаётся по имени файла в подкаталоге', () => {
    GateHarness.write(repo, 'deploy/.env.example', 'DB_PASSWORD=\n');
    GateHarness.writeConfig(repo, GateHarness.config(1, ['.env.example']));
    commitAll();
    expect(GateHarness.run([], repo).status).toBe(0);
  });

  it('явные пути не судятся порогом выборки', () => {
    GateHarness.write(repo, 'a.env', 'DB_PASSWORD=\n');
    GateHarness.writeConfig(repo, GateHarness.config(1500, ['.ts']));
    const result = GateHarness.run([join(repo, 'a.env')], repo);
    expect(result.stdout).toContain('просмотрено текстовых файлов: 1');
    expect(result.status).toBe(0);
  });

  it('явный путь, которого нет, — причина с путём, а не трассировка чтения', () => {
    const missing = join(repo, 'нет.env');
    const result = GateHarness.run([missing], repo);
    expect(result.stderr).toContain(`нет файлов: ${missing}`);
    expect(result.status).toBe(2);
  });

  it('явный путь — каталог: тот же отказ', () => {
    GateHarness.write(repo, 'dir/a.env', '\n');
    const result = GateHarness.run([join(repo, 'dir')], repo);
    expect(result.stderr).toContain(`нет файлов: ${join(repo, 'dir')}`);
    expect(result.status).toBe(2);
  });

  it('--staged вместе с путями — отказ с причиной', () => {
    GateHarness.write(repo, 'a.env', '\n');
    const result = GateHarness.run(['--staged', join(repo, 'a.env')], repo);
    expect(result.stderr).toContain('пути вместе с ним не задаются');
    expect(result.status).toBe(2);
  });

  it('путь внутри корня — в отчёте относительный, вне корня — абсолютный', () => {
    const outside = GateHarness.tempDir('secrets-outside-');
    try {
      GateHarness.write(repo, 'in.env', `API_TOKEN=${VALUE}\n`);
      GateHarness.write(outside, 'out.env', `API_TOKEN=${VALUE}\n`);
      const result = GateHarness.run([join(repo, 'in.env'), join(outside, 'out.env')], repo);
      expect(result.stderr).toContain('\n  in.env:1  API_TOKEN');
      expect(result.stderr).toContain(`\n  ${join(outside, 'out.env')}:1  API_TOKEN`);
      expect(result.status).toBe(1);
    } finally {
      GateHarness.remove(outside);
    }
  });

  it('находка: отказ с советом ротировать, значение не печатается', () => {
    GateHarness.write(repo, 'a.env', `API_TOKEN=${VALUE}\n`);
    commitAll();
    const result = GateHarness.run([], repo);
    expect(result.stderr).toContain('ОТКАЗ: в закоммиченных файлах литеральные секреты.');
    expect(result.stderr).toContain('скомпрометировано — ротируйте его');
    expect(result.stderr).toContain('оставьте подстановку');
    expect(`${result.stdout}${result.stderr}`).not.toContain(VALUE);
    expect(result.status).toBe(1);
  });
});

/**
 * Список файлов — у git: удалённый, но не закоммиченный файл, ссылка,
 * подмодуль, двоичный файл и отказ самого git — отдельные ответы.
 */
describe('гейт: файлы git', () => {
  let repo = '';

  beforeEach(() => {
    repo = GateHarness.repo('secrets-files-');
  });

  afterEach(() => {
    GateHarness.remove(repo);
  });

  it('отслеживаемый файл удалён с диска — пропущен, а не отказ чтения', () => {
    GateHarness.write(repo, 'gone.env', '\n');
    GateHarness.git(repo, 'add', '-A');
    GateHarness.remove(join(repo, 'gone.env'));
    const result = GateHarness.run([], repo);
    expect(result.stdout).toContain('просмотрено текстовых файлов: 2');
    expect(result.status).toBe(0);
  });

  it('символическая ссылка — не содержимое: ни в рабочем дереве, ни в индексе', () => {
    const outside = GateHarness.tempDir('secrets-link-');
    try {
      GateHarness.write(outside, 'secret.env', `API_TOKEN=${VALUE}\n`);
      symlinkSync(join(outside, 'secret.env'), join(repo, 'linked.env'));
      // Содержимое ссылки в индексе — путь цели; здесь путь похож на секрет.
      symlinkSync(`API_TOKEN=${VALUE}`, join(repo, 'target.env'));
      GateHarness.git(repo, 'add', '-A');

      expect(GateHarness.run([], repo).status).toBe(0);
      expect(GateHarness.run(['--staged'], repo).status).toBe(0);
    } finally {
      GateHarness.remove(outside);
    }
  });

  it('подмодуль в индексе — не содержимое', () => {
    GateHarness.git(repo, 'add', '-A');
    GateHarness.git(repo, 'update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},vendor/lib`);
    const result = GateHarness.run(['--staged'], repo);
    expect(result.stdout).toContain('Литеральных секретов нет');
    expect(result.status).toBe(0);
  });

  it('двоичный файл (NUL в начале) — не текст: и на диске, и в индексе', () => {
    GateHarness.write(
      repo,
      'blob.env',
      Buffer.concat([Buffer.from([0]), Buffer.from(`\nAPI_TOKEN=${VALUE}\n`)]),
    );
    GateHarness.git(repo, 'add', '-A');
    expect(GateHarness.run([], repo).status).toBe(0);
    expect(GateHarness.run(['--staged'], repo).status).toBe(0);
  });

  it('git не найден — причина «нет git», код 2', () => {
    const result = GateHarness.run([], repo, { ...process.env, PATH: join(repo, 'нет-такого-каталога') });
    expect(result.stderr).toContain('в окружении нет git');
    expect(result.status).toBe(2);
  });

  it('git отказал — в причине команда и ответ git', () => {
    GateHarness.write(repo, '.git/HEAD', 'не ссылка\n');
    const result = GateHarness.run([], repo);
    expect(result.stderr).toMatch(/ОТКАЗ \(гейт не смог проверить\): git ls-files -z: \S/);
    expect(result.status).toBe(2);
  });
});
