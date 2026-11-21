import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GateHarness } from '../testing/gate-harness';

/**
 * Режимы гейта 0.5.0: проверка конфигурации, счёт находок в записи фикстуры,
 * индекс как источник мерила в `--staged`, скан изменённого, история,
 * базовая линия, машинные форматы и маскирование значения во всех них.
 */
const { VALUE } = GateHarness;
const OTHER = ['Wk7', 'pL3nB8qR2x'].join('');
const reason = 'пароль одноразового контейнера спек на 127.0.0.1, задаётся харнессом тестов';

describe('конфигурация: типы полей', () => {
  let repo = '';

  beforeEach(() => {
    repo = GateHarness.repo('secrets-config-');
    GateHarness.git(repo, 'add', '-A');
  });

  afterEach(() => {
    GateHarness.remove(repo);
  });

  it.each([
    ['строка с разделителем', '1,500'],
    ['строка-число', '1500'],
    ['дробное', 1.5],
    ['отрицательное', -1],
    ['null', null],
  ])('minFiles — %s: отказ «не смог проверить», а не выключенный порог', (_name, minFiles) => {
    GateHarness.writeConfig(repo, { ...GateHarness.config(1), minFiles });
    const result = GateHarness.run([], repo);
    expect(result.stderr).toContain('minFiles — целое число от 0');
    expect(result.status).toBe(2);
  });

  it('неизвестный ключ (опечатка) — отказ с именем ключа', () => {
    GateHarness.writeConfig(repo, { ...GateHarness.config(1), extraPlaceholder: ['x'] });
    const result = GateHarness.run([], repo);
    expect(result.stderr).toContain('неизвестные ключи: extraPlaceholder');
    expect(result.status).toBe(2);
  });

  it('deliveryPattern не регулярное выражение — отказ', () => {
    GateHarness.writeConfig(repo, { ...GateHarness.config(1), deliveryPattern: '(' });
    const result = GateHarness.run([], repo);
    expect(result.stderr).toContain('deliveryPattern — не регулярное выражение');
    expect(result.status).toBe(2);
  });

  it('testCodePatterns: своя форма спек освобождает, без неё — код сервиса', () => {
    GateHarness.write(repo, 'src/db/harness.test.ts', `const password = '${VALUE}';\n`);
    GateHarness.write(
      repo,
      GateHarness.FIXTURES_LIST,
      JSON.stringify([{ file: 'src/db/harness.test.ts', keys: ['password'], reason }]),
    );
    GateHarness.git(repo, 'add', '-A');
    expect(GateHarness.run([], repo).stderr).toContain(
      '#0 src/db/harness.test.ts: файл поставки или код сервиса',
    );
    GateHarness.writeConfig(repo, { ...GateHarness.config(1), testCodePatterns: ['\\.test\\.ts$'] });
    expect(GateHarness.run([], repo).status).toBe(0);
  });

  it.each([['--stagged'], ['--full'], ['--format', 'xml'], ['--since']])(
    'аргументы %j — отказ с причиной, а не «нет файлов»',
    (...args) => {
      const result = GateHarness.run(args, repo);
      expect(result.stderr).not.toContain('нет файлов');
      expect(result.stderr).toContain('ОТКАЗ (гейт не смог проверить)');
      expect(result.status).toBe(2);
    },
  );
});

describe('перечень фикстур: запись освобождает конкретные находки', () => {
  let repo = '';

  beforeEach(() => {
    repo = GateHarness.repo('secrets-count-');
  });

  afterEach(() => {
    GateHarness.remove(repo);
  });

  const withFixtures = (entries: unknown[]) => {
    GateHarness.write(repo, GateHarness.FIXTURES_LIST, JSON.stringify(entries));
    GateHarness.git(repo, 'add', '-A');
    return GateHarness.run([], repo);
  };

  it('второй секрет под тем же ключом — находка, запись освобождает одну', () => {
    GateHarness.write(repo, 'test/a.env', `REDIS_PASSWORD=${VALUE}\nREDIS_PASSWORD=${OTHER}\n`);
    const result = withFixtures([{ file: 'test/a.env', keys: ['REDIS_PASSWORD'], reason }]);
    expect(GateHarness.flagged(result.stderr, repo)).toEqual(['test/a.env:2']);
    expect(result.status).toBe(1);
  });

  it('count: 2 — обе освобождены', () => {
    GateHarness.write(repo, 'test/a.env', `REDIS_PASSWORD=${VALUE}\nREDIS_PASSWORD=${OTHER}\n`);
    const result = withFixtures([{ file: 'test/a.env', keys: ['REDIS_PASSWORD'], count: 2, reason }]);
    expect(result.stdout).toContain('фикстур по перечню: 2');
    expect(result.status).toBe(0);
  });

  it('count больше найденного — запись устарела, с числами', () => {
    GateHarness.write(repo, 'test/a.env', `REDIS_PASSWORD=${VALUE}\n`);
    const result = withFixtures([{ file: 'test/a.env', keys: ['REDIS_PASSWORD'], count: 2, reason }]);
    expect(result.stderr).toContain(
      'test/a.env · REDIS_PASSWORD: находок 1, запись освобождает 2 — запись устарела',
    );
    expect(result.status).toBe(1);
  });

  it.each([[0], [1.5], ['2']])('count %j — нарушение перечня', (count) => {
    GateHarness.write(repo, 'test/a.env', `REDIS_PASSWORD=${VALUE}\n`);
    const result = withFixtures([{ file: 'test/a.env', keys: ['REDIS_PASSWORD'], count, reason }]);
    expect(result.stderr).toContain('count — целое число от 1');
    expect(result.status).toBe(1);
  });
});

describe('--staged: мерило и содержимое — из индекса', () => {
  let repo = '';

  beforeEach(() => {
    repo = GateHarness.repo('secrets-staged-');
    GateHarness.write(repo, 'test/a.env', `REDIS_PASSWORD=${VALUE}\n`);
  });

  afterEach(() => {
    GateHarness.remove(repo);
  });

  const fixture = [{ file: 'test/a.env', keys: ['REDIS_PASSWORD'], reason }];

  it('запись перечня на диске, но не в индексе, коммит не освобождает', () => {
    GateHarness.git(repo, 'add', '-A');
    GateHarness.write(repo, GateHarness.FIXTURES_LIST, JSON.stringify(fixture));
    const staged = GateHarness.run(['--staged'], repo);
    expect(GateHarness.flagged(staged.stderr, repo)).toEqual(['test/a.env:1']);
    expect(staged.status).toBe(1);
    // Контроль: рабочее дерево судится перечнем с диска.
    expect(GateHarness.run([], repo).status).toBe(0);
    GateHarness.git(repo, 'add', '-A');
    expect(GateHarness.run(['--staged'], repo).status).toBe(0);
  });

  it('конфигурация есть только на диске — отказ «нет в индексе»', () => {
    const result = GateHarness.run(['--staged'], repo);
    expect(result.stderr).toContain('нет committed-secrets.json в индексе');
    expect(result.status).toBe(2);
  });

  describe('скан изменённого относительно HEAD', () => {
    beforeEach(() => {
      GateHarness.write(repo, GateHarness.FIXTURES_LIST, JSON.stringify(fixture));
      // Секрет уже в истории (коммит без хука): хук нового коммита его не судит.
      GateHarness.write(repo, 'deploy/old.env', `API_TOKEN=${VALUE}\n`);
      GateHarness.git(repo, 'add', '-A');
      GateHarness.git(repo, 'commit', '-qm', 'база');
      GateHarness.write(repo, 'src/new.ts', 'export const x = 1;\n');
      GateHarness.git(repo, 'add', 'src/new.ts');
    });

    it('изменённое чисто — зелёный, хотя в неизменённом файле секрет', () => {
      const result = GateHarness.run(['--staged'], repo);
      expect(result.stdout).toContain('в индексе файлов: 5, проверено изменённых: 2');
      expect(result.status).toBe(0);
    });

    it('--full — весь индекс: находка в неизменённом', () => {
      const result = GateHarness.run(['--staged', '--full'], repo);
      expect(GateHarness.flagged(result.stderr, repo)).toEqual(['deploy/old.env:1']);
      expect(result.status).toBe(1);
    });

    it('изменён перечень фикстур — мерило другое: весь индекс', () => {
      GateHarness.write(repo, GateHarness.FIXTURES_LIST, `${JSON.stringify(fixture, null, 1)}\n`);
      GateHarness.git(repo, 'add', '-A');
      expect(GateHarness.flagged(GateHarness.run(['--staged'], repo).stderr, repo)).toEqual([
        'deploy/old.env:1',
      ]);
    });

    it('файл перечня фикстур читается всегда: устаревшая запись видна', () => {
      GateHarness.write(repo, 'test/a.env', 'REDIS_PASSWORD=\n');
      GateHarness.git(repo, 'commit', '-qam', 'секрет убран');
      GateHarness.write(repo, 'src/new.ts', 'export const x = 2;\n');
      GateHarness.git(repo, 'add', 'src/new.ts');
      const result = GateHarness.run(['--staged'], repo);
      expect(result.stderr).toContain('test/a.env · REDIS_PASSWORD: в файле такой находки нет');
      expect(result.status).toBe(1);
    });

    it('новый секрет в изменённом — находка', () => {
      GateHarness.write(repo, 'src/new.ts', `export const apiKey = '${OTHER}';\n`);
      GateHarness.git(repo, 'add', 'src/new.ts');
      expect(GateHarness.flagged(GateHarness.run(['--staged'], repo).stderr, repo)).toEqual(['src/new.ts:1']);
    });
  });
});

describe('скан истории', () => {
  let repo = '';
  let first = '';

  beforeEach(() => {
    repo = GateHarness.repo('secrets-history-');
    GateHarness.write(repo, 'deploy/app.env', `API_TOKEN=${VALUE}\n`);
    GateHarness.git(repo, 'add', '-A');
    GateHarness.git(repo, 'commit', '-qm', 'секрет');
    first = GateHarness.git(repo, 'rev-parse', 'HEAD').stdout.trim();
    GateHarness.write(repo, 'deploy/app.env', 'API_TOKEN=${API_TOKEN}\n');
    GateHarness.git(repo, 'commit', '-qam', 'секрет убран');
  });

  afterEach(() => {
    GateHarness.remove(repo);
  });

  it('удалённый из дерева секрет — в истории, с коммитом', () => {
    expect(GateHarness.run([], repo).status).toBe(0);
    const result = GateHarness.run(['--history'], repo);
    expect(GateHarness.flagged(result.stderr, repo)).toEqual(['deploy/app.env:1']);
    expect(result.stderr).toContain(`(коммит ${first.slice(0, 12)})`);
    expect(result.stderr).not.toContain(VALUE);
    expect(result.status).toBe(1);
  });

  it('--since <коммит> — только после него', () => {
    const result = GateHarness.run(['--since', first], repo);
    expect(result.stdout).toContain('просмотрено коммитов: 1');
    expect(result.status).toBe(0);
  });

  it('--since HEAD — пустой диапазон: выборка выродилась', () => {
    const result = GateHarness.run(['--since', 'HEAD'], repo);
    expect(result.stderr).toContain('нет коммитов');
    expect(result.status).toBe(2);
  });

  it('--since несуществующего коммита — отказ', () => {
    const result = GateHarness.run(['--since', 'нет-такого'], repo);
    expect(result.stderr).toContain('такого коммита нет');
    expect(result.status).toBe(2);
  });
});

describe('базовая линия', () => {
  let repo = '';
  const BASELINE = 'committed-secrets.baseline.json';

  beforeEach(() => {
    repo = GateHarness.repo('secrets-baseline-', { ...GateHarness.config(1), baselinePath: BASELINE });
    GateHarness.write(repo, 'deploy/app.env', `API_TOKEN=${VALUE}\n`);
    GateHarness.git(repo, 'add', '-A');
  });

  afterEach(() => {
    GateHarness.remove(repo);
  });

  it('принятые находки — зелёный; в файле линии значения нет', () => {
    const write = GateHarness.run(['--write-baseline'], repo);
    expect(write.stdout).toContain('записей 1');
    const text = readFileSync(join(repo, BASELINE), 'utf8');
    expect(text).not.toContain(VALUE);
    expect(JSON.parse(text).findings).toEqual([
      { file: 'deploy/app.env', key: 'API_TOKEN', fingerprint: expect.stringMatching(/^[0-9a-f]{32}$/u) },
    ]);
    GateHarness.git(repo, 'add', '-A');
    const result = GateHarness.run([], repo);
    expect(result.stdout).toContain('по базовой линии: 1');
    expect(result.status).toBe(0);
  });

  it('сдвиг строки — та же находка; новое значение — новая находка', () => {
    GateHarness.run(['--write-baseline'], repo);
    GateHarness.write(repo, 'deploy/app.env', `# сверху\n\nAPI_TOKEN=${VALUE}\n`);
    GateHarness.git(repo, 'add', '-A');
    expect(GateHarness.run([], repo).status).toBe(0);
    GateHarness.write(repo, 'deploy/app.env', `API_TOKEN=${VALUE}\nAPI_TOKEN=${OTHER}\n`);
    const result = GateHarness.run([], repo);
    expect(GateHarness.flagged(result.stderr, repo)).toEqual(['deploy/app.env:2']);
    expect(result.status).toBe(1);
  });

  it('то же место, другое значение — новая находка', () => {
    GateHarness.run(['--write-baseline'], repo);
    GateHarness.write(repo, 'deploy/app.env', `API_TOKEN=${OTHER}\n`);
    GateHarness.git(repo, 'add', '-A');
    const result = GateHarness.run([], repo);
    expect(GateHarness.flagged(result.stderr, repo)).toEqual(['deploy/app.env:1']);
    expect(result.status).toBe(1);
  });

  it('секрет убран — запись линии без находки названа, но не отказ', () => {
    GateHarness.run(['--write-baseline'], repo);
    GateHarness.write(repo, 'deploy/app.env', 'API_TOKEN=\n');
    GateHarness.git(repo, 'add', '-A');
    const result = GateHarness.run([], repo);
    expect(result.stdout).toContain('записей без находки: 1');
    expect(result.status).toBe(0);
  });

  it('линии нет на диске — отказ «нет файла»', () => {
    const result = GateHarness.run([], repo);
    expect(result.stderr).toContain(`нет файла ${join(repo, BASELINE)}`);
    expect(result.status).toBe(2);
  });
});

/**
 * Значение не встречается в выводе НИ В КАКОМ формате — ни сырое, ни base64,
 * ни декодированный пароль из base64, ни hex.
 */
describe('машинные форматы и маскирование', () => {
  let repo = '';
  const B64_PAIR = Buffer.from(`ci:${OTHER}`).toString('base64');

  beforeAll(() => {
    repo = GateHarness.repo('secrets-formats-');
    GateHarness.write(
      repo,
      'deploy/app.env',
      [
        `API_TOKEN=${VALUE}`,
        `REGISTRY_AUTH_URL=https://ci:${OTHER}@cr.example.com`,
        `redis-cli -a ${VALUE} ping`,
      ].join('\n'),
    );
    GateHarness.write(repo, 'deploy/config.json', `{"auths":{"cr.example.com":{"auth":"${B64_PAIR}"}}}\n`);
    GateHarness.git(repo, 'add', '-A');
    GateHarness.git(repo, 'commit', '-qm', 'база');
  });

  afterAll(() => {
    GateHarness.remove(repo);
  });

  const leaks = (text: string): string[] =>
    [
      VALUE,
      OTHER,
      B64_PAIR,
      Buffer.from(VALUE).toString('base64'),
      Buffer.from(VALUE).toString('hex'),
    ].filter((shape) => text.includes(shape));

  it.each(['text', 'json', 'sarif', 'gitlab'])(
    '%s: значение не встречается ни в stdout, ни в stderr',
    (format) => {
      const result = GateHarness.run(['--format', format], repo);
      expect(result.status).toBe(1);
      expect(leaks(`${result.stdout}\n${result.stderr}`)).toEqual([]);
    },
  );

  it.each(['json', 'sarif', 'gitlab'])('%s в файл: значения нет и в файле', (format) => {
    const result = GateHarness.run(['--format', format, '--output', `report.${format}.json`], repo);
    const text = readFileSync(join(repo, `report.${format}.json`), 'utf8');
    expect(result.status).toBe(1);
    expect(leaks(text)).toEqual([]);
    expect(result.stderr).toContain('ОТКАЗ: в закоммиченных файлах литеральные секреты.');
  });

  it('SARIF: результат на каждую находку, правило, строка, отпечаток', () => {
    const sarif = JSON.parse(GateHarness.run(['--format', 'sarif'], repo).stdout);
    expect(sarif.version).toBe('2.1.0');
    const results = sarif.runs[0].results as Array<{
      ruleId: string;
      locations: Array<{
        physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number } };
      }>;
      partialFingerprints: Record<string, string>;
    }>;
    expect(
      results.map((result) => [
        result.ruleId,
        result.locations[0]?.physicalLocation.artifactLocation.uri,
        result.locations[0]?.physicalLocation.region.startLine,
      ]),
    ).toEqual([
      ['key-literal', 'deploy/app.env', 1],
      ['url-password', 'deploy/app.env', 2],
      ['command-flag', 'deploy/app.env', 3],
      ['base64-credentials', 'deploy/config.json', 1],
    ]);
    for (const result of results) {
      expect(result.partialFingerprints['committedSecrets/v1']).toMatch(/^[0-9a-f]{32}$/u);
    }
    const ruleIds = (sarif.runs[0].tool.driver.rules as Array<{ id: string }>).map(({ id }) => id);
    expect(ruleIds.sort()).toEqual(['base64-credentials', 'command-flag', 'key-literal', 'url-password']);
  });

  it('GitLab: уязвимость на каждую находку, тип отчёта, коммит HEAD', () => {
    const head = GateHarness.git(repo, 'rev-parse', 'HEAD').stdout.trim();
    const report = JSON.parse(GateHarness.run(['--format', 'gitlab'], repo).stdout);
    expect(report.scan.type).toBe('secret_detection');
    expect(report.scan.status).toBe('success');
    const vulnerabilities = report.vulnerabilities as Array<{
      id: string;
      severity: string;
      location: { commit: { sha: string } };
    }>;
    expect(vulnerabilities).toHaveLength(4);
    expect(new Set(vulnerabilities.map(({ id }) => id)).size).toBe(4);
    for (const vulnerability of vulnerabilities) {
      expect(vulnerability.location.commit.sha).toBe(head);
      expect(vulnerability.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
      expect(vulnerability.severity).toBe('Critical');
    }
  });
});

describe('кодировки файла', () => {
  let root = '';

  beforeAll(() => {
    root = GateHarness.tempDir('secrets-utf16-');
    GateHarness.writeConfig(root, GateHarness.config(1));
    const text = `API_TOKEN=${VALUE}\n`;
    GateHarness.write(
      root,
      'le-bom.env',
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]),
    );
    GateHarness.write(root, 'le.env', Buffer.from(text, 'utf16le'));
    GateHarness.write(
      root,
      'be-bom.env',
      Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()]),
    );
    // Кириллица в UTF-16 почти без нулевых байт: узнаётся только по BOM.
    GateHarness.write(
      root,
      'ru-le-bom.env',
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(`# ${'комментарий'.repeat(40)}\n${text}`, 'utf16le'),
      ]),
    );
    GateHarness.write(
      root,
      'utf8-bom.env',
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]),
    );
    // Двоичный файл с нулями вразнобой — не текст.
    GateHarness.write(root, 'blob.env', Buffer.concat([Buffer.from([0, 0, 7, 0, 1]), Buffer.from(text)]));
  });

  afterAll(() => {
    GateHarness.remove(root);
  });

  it('UTF-16 с BOM и без, UTF-8 с BOM — текст; двоичный — нет', () => {
    const files = ['le-bom.env', 'le.env', 'be-bom.env', 'utf8-bom.env', 'ru-le-bom.env', 'blob.env'];
    const result = GateHarness.run(
      files.map((file) => join(root, file)),
      root,
    );
    expect(GateHarness.flagged(result.stderr, root).sort()).toEqual(
      ['be-bom.env:1', 'le-bom.env:1', 'le.env:1', 'ru-le-bom.env:2', 'utf8-bom.env:1'].sort(),
    );
    expect(result.status).toBe(1);
  });
});
