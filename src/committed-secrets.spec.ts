import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Гейт секретов на фикстурах: каждая форма, которую упрощённая проверка
 * пропускала (12 из 15 строк), — находка; рядом — та же
 * форма с подстановкой, заглушкой или выражением, которая находкой быть не
 * должна. Без второй половины фикстура проверяла бы «гейт краснеет на всём».
 *
 * Значения собираются в рантайме: литерал в этом файле нашёл бы сам гейт на
 * прогоне по репозиторию.
 */
const BIN = join(__dirname, '..', 'bin', 'committed-secrets.cjs');
const FIXTURES_LIST = join('src', 'architecture', 'allowlists', 'committed-secret-fixtures.json');

/** Конфигурация проекта-потребителя; порог и классы — параметрами. */
const config = (minFiles: number, requiredKinds: string[]) => ({
  minFiles,
  requiredKinds,
  fixturesPath: FIXTURES_LIST,
  deliveryPattern:
    '^(deploy/|docker-compose[^/]*\\.ya?ml$|(?:[^/]*/)*Dockerfile[^/]*$|[^/]*\\.Dockerfile$|\\.gitlab-ci\\.yml$|\\.env\\.example$)',
  serviceCodeRoot: 'src/',
});
const R_KINDS = ['.ts', '.json', '.yml', '.md', '.sh', '.env.example'];
const writeConfig = (dir: string, value: object): void => {
  writeFileSync(join(dir, 'committed-secrets.json'), JSON.stringify(value));
};

/** Похожее на настоящий секрет значение: буквы разного регистра и цифры. */
const VALUE = ['Zq8', 'vR2mT7xLp4'].join('');
const PREFIXED = ['postgres', 'Q7xK2mLp'].join('');
const PEM = ['-----BEGIN ', 'OPENSSH PRIVATE', ' KEY-----'].join('');
/** Токены с известным префиксом — собраны в рантайме, чтобы гейт не нашёл этот файл. */
const TAIL36 = 'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5';
const GITHUB = ['ghp', '_', TAIL36].join('');
const GITLAB = ['glpat', '-', 'Zq8vR2mT7xLp4Wk9Bn3C'].join('');
const SLACK = ['xoxb', '-', '1234567890-abcdefghij'].join('');
const AWS = ['AKIA', '2OGYBAH6QKZXT7NA'].join('');
const GOOGLE = ['AIza', 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'].join('');
const PGP = ['-----BEGIN ', 'PGP PRIVATE KEY', ' BLOCK-----'].join('');

type Case = { file: string; lines: Array<[line: string, flagged: boolean]> };

const CASES: Case[] = [
  {
    // Конфигурация окружения в .env-файле поставки.
    file: 'prod.env',
    lines: [
      [`POSTGRES_PASSWORD=${VALUE}`, true],
      [`REDIS_PASSWORD_PREVIOUS=${VALUE}`, true],
      [`DB_PASS=${PREFIXED}`, true],
      ['POSTGRES_PASSWORD=', false],
      ['POSTGRES_USER=root', false],
    ],
  },
  {
    file: '.env.example',
    lines: [
      [`S3_SECRET_ACCESS_KEY=${VALUE}`, true],
      ['S3_SECRET_ACCESS_KEY=', false],
    ],
  },
  {
    file: 'docker-compose.x.yml',
    lines: [
      [`      POSTGRES_PASSWORD: ${VALUE}`, true],
      [`      - POSTGRES_PASSWORD=${VALUE}`, true],
      [`      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-${VALUE}}`, true],
      ['      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?не задан в .env на хосте}', false],
      ['      REDIS_PASSWORD: ${REDIS_PASSWORD}', false],
      ['      REDIS_PASSWORD_PREVIOUS: ${REDIS_PASSWORD_PREVIOUS:-}', false],
      ['      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-local-dev-only}', false],
      ['      secretName: app-secrets', false],
      [`      url: redis://:${VALUE}@redis:6379`, true],
    ],
  },
  {
    // Ключ в кавычках: между ключом и двоеточием — кавычка.
    file: 'settings.json',
    lines: [
      [`{"password":"${VALUE}"}`, true],
      [`{ "apiKey": "${VALUE}" }`, true],
      ['{ "passWithNoTests": "falsefalse" }', false],
      // Имя свойства или члена перечисления в camelCase, слова которого
      // называют секрет, — описание, а не значение.
      ['{ "SECRET_ACCESS_KEY": "secretAccessKey" }', false],
      ['{ "isStrongPassword": "isStrongPassword" }', false],
      // Контроль: camelCase, слова которого секрет НЕ называют, — находка.
      ['{ "password": "correctHorseBattery" }', true],
    ],
  },
  {
    file: 'client.ts',
    lines: [
      [`const dbPassword = '${VALUE}';`, true],
      [`  apiKey: "${VALUE}",`, true],
      [`  token: '${VALUE}',`, true],
      [`  secret_token: '${VALUE}',`, true],
      [`  JWT_SECRET: '${VALUE}',`, true],
      [`  clientSecret: \`${VALUE}\`,`, true],
      [`const url = 'postgres://app:${VALUE}@db:5432/app';`, true],
      ['const password = config.password;', false],
      ['  password: process.env.POSTGRES_PASSWORD,', false],
      ['  token: string;', false],
      ['  const line = "SYSTEM_PASSWORD=" + NEW + "\\n";', false],
      ["  wrapToken: 'vault-wrap-token',", false],
      ["  'vault-wrap-token': '/tmp/wrap',", false],
      ["  return [key, first ? 'token' : 'modifier'];", false],
      ['const example = "postgres://user:password@db:5432/x";', false],
      ['const built = `postgres://${user}:${pass}@${host}`;', false],
    ],
  },
  {
    // С 0.3.0: аннотация типа между ключом и значением.
    file: 'typed.ts',
    lines: [
      [`const apiKey: string = '${VALUE}';`, true],
      [`  private readonly dbPassword: string | undefined = "${VALUE}";`, true],
      ['  apiKey: string;', false],
      ['const apiKey: string = process.env.API_KEY ?? "";', false],
    ],
  },
  {
    file: 'settings.py',
    lines: [
      [`password: str = "${VALUE}"`, true],
      ['password: str = os.environ["DB_PASSWORD"]', false],
    ],
  },
  {
    // С 0.3.0: токены по форме — под любым ключом, в адресе, без ключа.
    file: 'tokens.ts',
    lines: [
      [`  auth: '${GITHUB}',`, true],
      [`const remote = 'https://${GITHUB}@github.com/org/repo.git';`, true],
      [`  headers: { 'PRIVATE-TOKEN': '${GITLAB}' },`, true],
      [`slack.send('${SLACK}');`, true],
      [`  region: 'eu', id: '${AWS}',`, true],
      [`  maps: '${GOOGLE}',`, true],
      [`  Authorization: 'Bearer ${VALUE}',`, true],
      ["  Authorization: 'Bearer ' + token,", false],
      ["  IClientAuth: 'interface',", false],
      ["  const auth = 'https://a.example:80';", false],
      ["  prefix: 'ghp_short',", false],
      [PGP, true],
    ],
  },
  {
    file: 'deploy.sh',
    lines: [
      [`export VAULT_TOKEN=${VALUE}`, true],
      ['           SYSTEM_PASSWORD: .POSTGRES_PASSWORD,', false],
      ['  password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB });', false],
      [': "${VAULT_ID_TOKEN:?VAULT_ID_TOKEN — нет id_tokens у джобы}"', false],
      ['TOKEN=$(vault print token)', false],
    ],
  },
  {
    file: 'Dockerfile',
    lines: [
      [`ENV API_KEY=${VALUE}`, true],
      ['ENV API_KEY=${API_KEY}', false],
    ],
  },
  {
    file: '.npmrc',
    lines: [[`//npm.example/:_authToken=${VALUE}`, true]],
  },
  {
    // В тексте Markdown пара без кавычек — проза, в блоке кода — команда.
    file: 'runbook.md',
    lines: [
      ['Поле password: передаётся в заголовке запроса', false],
      ['```bash', false],
      [`export VAULT_TOKEN=${VALUE}`, true],
      ['export VAULT_TOKEN=$(cat /run/secrets/token)', false],
      ['```', false],
      [PEM, true],
    ],
  },
];

/** Найденные гейтом строки: `<файл>:<строка>` из отчёта. */
const flaggedOf = (stderr: string, root: string): string[] =>
  stderr
    .split('\n')
    .map((line) => /^ {2}(\S+):(\d+) {2}/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => `${(match[1] ?? '').replace(`${root}/`, '')}:${match[2] ?? ''}`);

const run = (args: string[], cwd: string) =>
  spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', timeout: 30_000 });

/**
 * Без committed-secrets.json — отказ: значения по умолчанию судили бы чужой
 * репозиторий чужим порогом.
 */
describe('конфигурация проекта', () => {
  const inTemp = (prefix: string, body: (dir: string) => void): void => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    try {
      body(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('нет committed-secrets.json — «не смог проверить» (код 2) с причиной', () => {
    inTemp('secrets-gate-noconf-', (dir) => {
      const result = run([], dir);
      expect(result.stderr).toContain('нет committed-secrets.json');
      expect(result.status).toBe(2);
    });
  });

  it('конфигурация не разбирается — код 2 с путём, а не трассировка', () => {
    inTemp('secrets-gate-badconf-', (dir) => {
      writeFileSync(join(dir, 'committed-secrets.json'), '{ minFiles: 1 ');
      const result = run([], dir);
      expect(result.stderr).toContain('не разбирается как JSON');
      expect(result.stderr).not.toContain('Traceback');
      expect(result.status).toBe(2);
    });
  });

  it('extraPlaceholders не список строк — код 2', () => {
    inTemp('secrets-gate-badextra-', (dir) => {
      writeConfig(dir, { ...config(1, []), extraPlaceholders: [1] });
      const result = run([], dir);
      expect(result.stderr).toContain('extraPlaceholders');
      expect(result.status).toBe(2);
    });
  });

  it('каталог вне git — код 2 с причиной git, а не трассировка', () => {
    inTemp('secrets-gate-nogit-', (dir) => {
      writeConfig(dir, config(1, []));
      const result = run([], dir);
      expect(result.stderr).toContain('гейт не смог проверить');
      expect(result.stderr).not.toContain('Traceback');
      expect(result.status).toBe(2);
    });
  });

  it('явный путь, которого нет, — код 2; --staged вместе с путями — код 2', () => {
    inTemp('secrets-gate-args-', (dir) => {
      writeConfig(dir, config(1, []));
      expect(run([join(dir, 'нет.env')], dir).status).toBe(2);
      expect(run(['--staged', join(dir, 'a.env')], dir).status).toBe(2);
    });
  });
});

describe('гейт секретов: формы, которые находит, и формы, которые не трогает', () => {
  let root = '';

  beforeAll(() => {
    // Путь — настоящий: скрипт печатает разрешённые пути, а $TMPDIR macOS —
    // ссылка (/var → /private/var).
    root = realpathSync(mkdtempSync(join(tmpdir(), 'secrets-gate-')));
    for (const { file, lines } of CASES) {
      writeFileSync(join(root, file), `${lines.map(([line]) => line).join('\n')}\n`);
    }
    // Дефолт дев-окружения — заглушка ПРОЕКТА, а не библиотеки (extraPlaceholders).
    writeConfig(root, { ...config(1, []), extraPlaceholders: ['local-dev-only'] });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('фикстура не выродилась: в каждом файле есть находка, рядом — разрешённые формы', () => {
    for (const { file, lines } of CASES) {
      expect([file, lines.some(([, flagged]) => flagged)]).toEqual([file, true]);
    }
    expect(CASES.flatMap(({ lines }) => lines).filter(([, flagged]) => !flagged).length).toBeGreaterThan(20);
  });

  it('находки — ровно запрещённые строки, отказ с кодом 1', () => {
    const result = run(
      CASES.map(({ file }) => join(root, file)),
      root,
    );
    const expected = CASES.flatMap(({ file, lines }) =>
      lines.flatMap(([, flagged], index) => (flagged ? [`${file}:${index + 1}`] : [])),
    );

    expect(flaggedOf(result.stderr, root).sort()).toEqual(expected.sort());
    expect(result.status).toBe(1);
  });

  it('значение в отчёт не попадает: только ключ и длина', () => {
    const result = run([join(root, 'prod.env')], root);

    expect(result.stderr).toContain('POSTGRES_PASSWORD — литерал длиной 13');
    expect(result.stderr).not.toContain(VALUE);
  });

  /**
   * Репозиторий в миниатюре: корень — каталог запуска, список файлов — у
   * git, порог, классы и перечень фикстур — из committed-secrets.json.
   */
  describe('прогон по репозиторию: выборка и перечень фикстур', () => {
    let repo = '';

    const write = (path: string, text: string): void => {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), text);
    };
    const git = (...args: string[]) =>
      spawnSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 30_000 });
    const gate = () => run([], repo);

    beforeEach(() => {
      repo = realpathSync(mkdtempSync(join(tmpdir(), 'secrets-gate-repo-')));
      git('init', '-q');
      writeConfig(repo, config(1, []));
      write('test/env/test.env', `REDIS_PASSWORD=${VALUE}\n`);
      write('docker-compose.prod.yml', '    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?нет}\n');
    });

    afterEach(() => {
      rmSync(repo, { recursive: true, force: true });
    });

    const fixtures = (entries: unknown[]): void => {
      write(FIXTURES_LIST, JSON.stringify(entries));
      git('add', '-A');
    };

    const TEST_ENV_ENTRY = {
      file: 'test/env/test.env',
      keys: ['REDIS_PASSWORD'],
      reason: 'пароль одноразового контейнера Redis спек на 127.0.0.1, задаётся харнессом',
    };

    it('все классы файлов есть, но файлов меньше порога — отказ «выборка выродилась»', () => {
      writeConfig(repo, config(1500, R_KINDS));
      for (const path of ['src/a.ts', 'b.json', 'c.yml', 'd.md', 'e.sh', '.env.example']) {
        write(path, '\n');
      }
      fixtures([TEST_ENV_ENTRY]);
      const result = gate();

      expect(result.stderr).toContain('выборка выродилась');
      expect(result.stderr).toContain('нет классов: —');
      expect(result.status).toBe(2);
    });

    it('файлов больше порога, но без класса .ts — отказ «выборка выродилась»', () => {
      const floor = 20;
      writeConfig(repo, config(floor, R_KINDS));
      for (let index = 0; index < floor; index += 1) {
        write(`docs/f${index}.md`, '\n');
      }
      for (const path of ['b.json', 'c.yml', 'e.sh', '.env.example']) {
        write(path, '\n');
      }
      fixtures([TEST_ENV_ENTRY]);
      const result = gate();

      expect(result.stderr).toContain('нет классов: .ts —');
      expect(result.status).toBe(2);
    });

    it('перечень фикстур: файл поставки не освобождается, устаревшая запись — отказ', () => {
      fixtures([
        {
          file: 'docker-compose.prod.yml',
          keys: ['POSTGRES_PASSWORD'],
          reason: 'попытка освободить файл поставки записью перечня фикстур с длинной причиной',
        },
        {
          file: 'test/env/test.env',
          keys: ['REDIS_PASSWORD', 'S3_SECRET_ACCESS_KEY'],
          reason: 'пароль одноразового контейнера Redis спек на 127.0.0.1, задаётся харнессом',
        },
      ]);
      const result = gate();

      expect(result.stderr).toContain('docker-compose.prod.yml: файл поставки');
      expect(result.stderr).toContain('test/env/test.env · S3_SECRET_ACCESS_KEY: в файле такой находки нет');
      expect(result.status).toBe(1);
    });

    it('запись перечня освобождает свою находку и только её', () => {
      write('test/db/harness.js', `const url = 'redis://:${VALUE}@127.0.0.1:6379';\n`);
      fixtures([
        {
          file: 'test/env/test.env',
          keys: ['REDIS_PASSWORD'],
          reason: 'пароль одноразового контейнера Redis спек на 127.0.0.1, задаётся харнессом',
        },
      ]);
      const result = gate();

      expect(flaggedOf(result.stderr, repo)).toEqual(['test/db/harness.js:1']);
      expect(result.status).toBe(1);
    });

    /**
     * Хук после `git add -p`: в индексе секрет, на диске его уже нет — и
     * наоборот. Проверяется то, что уйдёт в коммит.
     */
    it('--staged: секрет в индексе, на диске его нет — находка; проверка рабочего дерева его не видит', () => {
      fixtures([TEST_ENV_ENTRY]);
      write('src/x.ts', `const apiKey = '${VALUE}';\n`);
      git('add', 'src/x.ts');
      write('src/x.ts', 'const apiKey = process.env.API_KEY;\n');

      const staged = run(['--staged'], repo);
      expect(flaggedOf(staged.stderr, repo)).toEqual(['src/x.ts:1']);
      expect(staged.stderr).not.toContain(VALUE);
      expect(staged.status).toBe(1);
      // Контроль: рабочее дерево чистое — режим по умолчанию зелёный.
      expect(gate().status).toBe(0);
    });

    it('--staged: в индексе чисто, секрет только на диске — зелёный; рабочее дерево — находка', () => {
      fixtures([TEST_ENV_ENTRY]);
      write('src/x.ts', 'const apiKey = process.env.API_KEY;\n');
      git('add', 'src/x.ts');
      write('src/x.ts', `const apiKey = '${VALUE}';\n`);

      expect(run(['--staged'], repo).status).toBe(0);
      expect(gate().status).toBe(1);
    });

    it('--staged: перечень фикстур и порог выборки действуют так же', () => {
      fixtures([TEST_ENV_ENTRY]);
      const result = run(['--staged'], repo);
      expect(result.stdout).toContain('фикстур по перечню: 1');
      expect(result.status).toBe(0);
    });

    it('extraPlaceholders проекта: полное совпадение — не секрет; без записи — находка', () => {
      const LOCAL = ['local', 'dev', 'only'].join('-');
      fixtures([TEST_ENV_ENTRY]);
      write('docker-compose.dev.yml', `    POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-${LOCAL}}\n`);
      git('add', '-A');

      expect(flaggedOf(gate().stderr, repo)).toEqual(['docker-compose.dev.yml:1']);
      writeConfig(repo, { ...config(1, []), extraPlaceholders: [LOCAL] });
      expect(gate().status).toBe(0);
      // Не префикс: значение, начинающееся с заглушки, — находка.
      write('docker-compose.dev.yml', `    POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-${LOCAL}${VALUE}}\n`);
      expect(gate().status).toBe(1);
    });
  });
});
