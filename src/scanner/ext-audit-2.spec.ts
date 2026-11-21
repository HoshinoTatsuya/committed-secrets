import { execFileSync } from 'node:child_process';

import { GateHarness } from '../testing/gate-harness';
import { Git } from './git';
import { parseGateOptions } from './parse-gate-options';
import { scanText } from './scan-text';
import { textOf } from './text-of';

/**
 * Внешний аудит №2 (17.11.2026): у каждой подтверждённой формы — пара «находит»
 * (с ключом находки) и «не трогает» (та же форма без секрета или похожая, где
 * значение секретом не является). Значения собираются в рантайме: литерал в
 * спеке нашёл бы сам гейт.
 */
const j = (...parts: string[]): string => parts.join('');
const b64 = (text: string): string => Buffer.from(text).toString('base64');
const R = j('Zq8vR2mT7x', 'Lp4Kd9Wn3B');

const keysOf = (path: string, text: string): string[] =>
  scanText(path, `${text}\n`, new Set()).map((finding) => `${finding.line}:${finding.key}`);

/** [имя, путь, текст с секретом, находки «строка:ключ», тот же путь без секрета]. */
const FORMS: Array<[name: string, path: string, found: string, keys: string[], quiet: string]> = [
  [
    'список YAML: `- sh`, `- -c`, команда строкой в кавычках',
    'docker-compose.yml',
    ['    command:', '      - sh', '      - -c', `      - "redis-cli -a ${R} ping"`].join('\n'),
    ['4:redis-cli -a'],
    ['    command:', '      - sh', '      - -c', '      - "redis-cli -a $REDIS_PASSWORD ping"'].join('\n'),
  ],
  [
    'env Kubernetes: value выше name',
    'deploy/app.yml',
    ['        env:', `          - value: ${R}`, '            name: DB_PASSWORD'].join('\n'),
    ['2:DB_PASSWORD'],
    ['        env:', `          - value: ${R}`, '            name: LOG_LEVEL'].join('\n'),
  ],
  [
    'env Kubernetes: комментарий после name',
    'deploy/app.yml',
    ['        env:', '          - name: DB_PASSWORD # пароль базы', `            value: ${R}`].join('\n'),
    ['3:DB_PASSWORD'],
    ['        env:', '          - name: DB_PASSWORD # пароль базы', '            value: ${DB_PASSWORD}'].join(
      '\n',
    ),
  ],
  [
    'env Kubernetes: value блоком `|`',
    'deploy/app.yml',
    ['        env:', '          - name: DB_PASSWORD', '            value: |', `              ${R}`].join(
      '\n',
    ),
    ['4:DB_PASSWORD'],
    [
      '        env:',
      '          - name: DB_PASSWORD',
      '            value: |',
      '              ${DB_PASSWORD}',
    ].join('\n'),
  ],
  [
    'пара в одной строке: value раньше name',
    'src/task.ts',
    `const env = [{ value: '${R}', name: 'DB_PASSWORD' }];`,
    ['1:DB_PASSWORD'],
    `const env = [{ value: '${R}', name: 'LOG_LEVEL' }];`,
  ],
  [
    'YAML: `#` внутри значения без кавычек — часть значения',
    'config/app.yml',
    `db:\n  password: ab#${R}`,
    ['2:password'],
    `db:\n  password: \${DB_PASSWORD} #${R}`,
  ],
  [
    'код: экранированная кавычка внутри литерала',
    'src/db.ts',
    `const password = "ab\\"${R}";`,
    ['1:password'],
    'const password = "ab\\"x";',
  ],
  [
    '.env: экранированная кавычка в двойных кавычках',
    '.env.example',
    `DB_PASSWORD="ab\\"${R}"`,
    ['1:DB_PASSWORD'],
    'DB_PASSWORD="${DB_PASSWORD}"',
  ],
  [
    'YAML: экранированная кавычка в двойных кавычках',
    'config/app.yml',
    `db:\n  password: "ab\\"${R}"`,
    ['2:password'],
    'db:\n  password: "ab\\"x"',
  ],
  [
    "YAML: удвоенная '' в одинарных кавычках",
    'config/app.yml',
    `db:\n  password: 'ab''${R}'`,
    ['2:password'],
    "db:\n  password: 'ab''x'",
  ],
  [
    'код: литерал на следующей строке после `=` (перенос форматтера)',
    'src/db.ts',
    ['const dbPassword =', `  "${R}";`].join('\n'),
    ['2:dbPassword'],
    ['const dbPassword =', '  process.env.DB_PASSWORD;'].join('\n'),
  ],
  [
    'код: литерал на следующей строке после ключа объекта',
    'src/db.ts',
    ['const config = {', '  password:', `    '${R}',`, '};'].join('\n'),
    ['3:password'],
    ['const config = {', '  password:', '    process.env.DB_PASSWORD,', '};'].join('\n'),
  ],
  [
    'Authorization: схема вне списка (ApiKey) в YAML',
    'config/client.yml',
    `headers:\n  Authorization: ApiKey ${R}`,
    ['2:Authorization'],
    'headers:\n  Authorization: ApiKey ${API_KEY}',
  ],
  [
    'Authorization: Bearer в YAML без кавычек',
    'config/client.yml',
    `headers:\n  Authorization: Bearer ${R}`,
    ['2:Authorization'],
    'headers:\n  Authorization: Bearer ${TOKEN}',
  ],
  [
    'Authorization: сырой токен без схемы в коде',
    'src/client.ts',
    `const headers = { Authorization: '${R}' };`,
    ['1:Authorization'],
    "const headers = { Authorization: 'required' };",
  ],
  [
    'curl -H «Authorization: HMAC …»',
    'scripts/call.sh',
    `curl -H "Authorization: HMAC ${R}" https://api.example.com/`,
    ['1:Authorization'],
    'curl -H "Authorization: HMAC $SIGNATURE" https://api.example.com/',
  ],
  [
    'массив аргументов со скобками внутри строки',
    'src/run.ts',
    `spawn('curl', ['curl', '-u', 'user:${R}', 'http://[::1]:8080']);`,
    ['1:curl -u'],
    "spawn('curl', ['curl', '-u', `user:${process.env.PW}`, 'http://[::1]:8080']);",
  ],
  [
    'массив: `sh -c` с `[ ]` внутри команды',
    'src/run.ts',
    `execFile('sh', ['sh', '-c', 'if [ -f x ]; then redis-cli -a ${R}; fi']);`,
    ['1:redis-cli -a'],
    "execFile('sh', ['sh', '-c', 'if [ -f x ]; then redis-cli -a \"$PW\"; fi']);",
  ],
  [
    'Markdown, блок ```ts: литерал по умолчанию',
    'README.md',
    ['```ts', `const dbPassword = process.env.DB_PASSWORD ?? '${R}';`, '```'].join('\n'),
    ['2:dbPassword'],
    ['```ts', 'const dbPassword = process.env.DB_PASSWORD;', '```'].join('\n'),
  ],
  [
    '.npmrc `_auth`: base64 «логин:пароль» декодируется',
    '.npmrc',
    `_auth=${b64(j('deploy:', R))}`,
    ['1:_auth'],
    `_auth=${b64('user:password')}`,
  ],
  [
    '`ключ: литерал соседнего свойства` — ключ правее первого присваивания',
    'src/config.ts',
    `const c = { apiKey: getSecret() ?? '${R}' };`,
    ['1:apiKey'],
    'const c = { apiKey: getSecret() };',
  ],
];

describe('внешний аудит №2: формы', () => {
  it.each(FORMS)('%s: находит ровно указанное', (_name, path, found, keys) => {
    expect(keysOf(path, found)).toEqual(keys);
  });

  it.each(FORMS)('%s: без секрета — тишина', (_name, path, _found, _keys, quiet) => {
    expect(keysOf(path, quiet)).toEqual([]);
  });
});

describe('внешний аудит №2: ложные находки', () => {
  it.each([
    [
      'литерал соседнего аргумента не приписывается ключу (граница выражения)',
      'src/config.ts',
      `f({ token: env.TOKEN }, other ?? '${R}');`,
    ],
    [
      'Markdown, блок ```ts: аннотация типа под секретным ключом — не значение',
      'README.md',
      ['```ts', 'interface Options {', '  apiKey: CustomTokenType;', '}', '```'].join('\n'),
    ],
    [
      'Markdown, блок ```ts: присваивание выражения — не значение',
      'README.md',
      ['```ts', 'const token = config.tokens?.[parsed.data.tokenId];', '```'].join('\n'),
    ],
    [
      'Authorization в комментарии .env с заглушкой и хвостом прозы',
      '.env.example',
      '# (локальный запуск: Authorization=Bearer <ключ>).',
    ],
    [
      'Authorization: Digest — список параметров, а не одно значение',
      'config/client.yml',
      'headers:\n  Authorization: Digest username="u", realm="r", nonce="abc123def456"',
    ],
    // Текст спеки с шаблоном: `${…}` внутри кавычек — подстановка, а не литерал.
    [
      'подстановка в шаблоне под литералом по умолчанию',
      'src/k.ts',
      "const secret = Buffer.from('${toHex(value)}', 'hex');",
    ],
    [
      'пара name/value с несекретным именем — не находка в обоих порядках (прежде — любое значение)',
      'deploy/app.yml',
      [
        '        env:',
        '          - name: IMAGE_TAG',
        `            value: ${R}`,
        `          - value: ${R}`,
        '            name: LOG_LEVEL',
      ].join('\n'),
    ],
    [
      'value без секретного имени не переходит к имени следующего элемента',
      'deploy/app.yml',
      [
        '        env:',
        `          - value: ${R}`,
        '            name: LOG_LEVEL',
        '          - name: DB_PASSWORD',
        '            value: ${DB_PASSWORD}',
      ].join('\n'),
    ],
    ['проза Markdown: «Пароль:» и строка в кавычках ниже', 'docs/guide.md', `password:\n"${R}"`],
  ])('%s', (_name, path, text) => {
    expect(keysOf(path, text)).toEqual([]);
  });
});

describe('внешний аудит №2: разбор и чтение', () => {
  it('UTF-16 BE с BOM нечётной длины — текст без последнего байта, а не RangeError', () => {
    const data = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from([0x00, 0x61, 0x00, 0x62, 0x00])]);
    expect(textOf(data)).toBe('ab');
  });

  it.each([[['--history', '--write-baseline']], [['--since', 'HEAD~1', '--write-baseline']]])(
    '%p — отказ: базовая линия рабочего дерева не пишется по истории',
    (argv) => {
      expect(() => parseGateOptions(argv)).toThrow('--write-baseline');
    },
  );

  it('контроль: --write-baseline сам по себе — дерево', () => {
    expect(parseGateOptions(['--write-baseline']).mode).toBe('tree');
  });

  it('чтение блобов прервано, запрос ещё пишется — EPIPE не становится uncaughtException', async () => {
    const root = GateHarness.repo('cs-epipe-');
    try {
      GateHarness.write(root, 'a.txt', 'a\n');
      GateHarness.git(root, 'add', '-A');
      GateHarness.git(root, 'commit', '-qm', 'a');
      const sha = execFileSync('git', ['rev-parse', 'HEAD:a.txt'], { cwd: root, encoding: 'utf8' }).trim();
      // Запрос в несколько мегабайт: к моменту прерывания он ещё не дописан.
      const shas = Array.from({ length: 300_000 }, () => sha);
      const uncaught: unknown[] = [];
      const listener = (error: unknown): void => {
        uncaught.push(error);
      };
      process.prependListener('uncaughtException', listener);
      let read = 0;
      try {
        for await (const blob of Git.blobs(root, shas)) {
          read += blob === null ? 0 : 1;
          break;
        }
        await new Promise((done) => setTimeout(done, 300));
      } finally {
        process.removeListener('uncaughtException', listener);
      }
      expect({ read, uncaught: uncaught.map((error) => (error as NodeJS.ErrnoException).code) }).toEqual({
        read: 1,
        uncaught: [],
      });
    } finally {
      GateHarness.remove(root);
    }
  });
});

describe('внешний аудит №2: гейт из подкаталога монорепозитория', () => {
  let monorepo = '';
  let service = '';

  beforeAll(() => {
    monorepo = GateHarness.tempDir('cs-mono-');
    service = `${monorepo}/services/api`;
    GateHarness.git(monorepo, 'init', '-q');
    GateHarness.writeConfig(service, GateHarness.config(1));
    GateHarness.write(service, GateHarness.FIXTURES_LIST, '[]');
    GateHarness.write(service, 'src/a.ts', 'export const a = 1;\n');
    GateHarness.write(monorepo, 'other/readme.txt', 'x\n');
    GateHarness.git(monorepo, 'add', '-A');
    GateHarness.git(monorepo, 'commit', '-qm', 'база');
    GateHarness.write(service, 'src/new.ts', `const dbPassword = "${R}";\n`);
    GateHarness.write(monorepo, 'other/leak.ts', `const dbPassword = "${R}";\n`);
    GateHarness.git(monorepo, 'add', '-A');
  });

  afterAll(() => {
    GateHarness.remove(monorepo);
  });

  it('--staged: изменённое в каталоге запуска сканируется (прежде — ноль изменённых, зелёный)', () => {
    const result = GateHarness.run(['--staged'], service);
    expect({ status: result.status, flagged: GateHarness.flagged(result.stderr, service) }).toEqual({
      status: 1,
      flagged: ['src/new.ts:1'],
    });
  });

  it('--history: история каталога запуска, пути от него; соседний сервис не судится', () => {
    GateHarness.git(monorepo, 'commit', '-qm', 'утечка');
    const result = GateHarness.run(['--history'], service);
    expect({ status: result.status, flagged: GateHarness.flagged(result.stderr, service) }).toEqual({
      status: 1,
      flagged: ['src/new.ts:1'],
    });
  });
});
