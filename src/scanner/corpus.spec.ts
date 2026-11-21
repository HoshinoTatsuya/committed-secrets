import { scanText } from './scan-text';

/**
 * Корпус форм утечки: 36 форм, которые находкой быть обязаны, и 12 форм,
 * которые находкой быть не должны (заглушки, подстановки, правильное
 * хранение). У КАЖДОЙ формы пара: «находит» — с поддельным секретом, «не
 * трогает» — та же форма с заглушкой, подстановкой или зашифрованным
 * значением. Без второй половины форма проверяла бы «краснеет на всём».
 *
 * Значения собираются в рантайме: литерал в этом файле нашёл бы сам гейт.
 */
const j = (...parts: string[]): string => parts.join('');
const b64 = (text: string): string => Buffer.from(text).toString('base64');
/** Поддельное значение с энтропией. */
const R = j('Zq8vR2mT7x', 'Lp4Kd9Wn3B', 'c6Hf1Jy5Ug0Q');
const TAIL = j('aB3dE5fG7h', 'J9kL1mN2pQ', '4rS6tU8vW0xY2z4A');
const PEM_HEAD = (kind: string): string => j('-----BEGIN ', kind, 'PRIVATE KEY-----');

interface Form {
  readonly name: string;
  readonly path: string;
  /** Текст с секретом и ключ находки (ровно одна находка). */
  readonly found: string;
  readonly key: string;
  /** Та же форма без секрета — ни одной находки. */
  readonly quiet: string;
}

/** 36 форм, найденных корпусом аудита; пропуски версии 0.4.0 отмечены. */
const LEAKS: Form[] = [
  {
    name: 'AWS secret в .env',
    path: 'deploy/a.env',
    found: `AWS_SECRET_ACCESS_KEY=${R}abcd1234`,
    key: 'AWS_SECRET_ACCESS_KEY',
    quiet: 'AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}',
  },
  {
    name: 'AWS id в коде',
    path: 'src/aws.ts',
    found: `const id = '${j('AKIA', 'Q3N7XZ2LK5PMW8RT')}';`,
    key: 'токен AWS',
    quiet: `const id = '${j('AKIA', 'Q3N7XZ2LK5PMW8')}';`,
  },
  {
    name: 'GitLab в адресе git',
    path: 'ci/x.sh',
    found: `git clone https://oauth2:${j('glpat-', 'aB3dE5fG7hJ9kL1mN2pQ')}@gitlab.example.com/r.git`,
    key: 'токен GitLab',
    quiet: 'git clone https://oauth2:${GITLAB_TOKEN}@gitlab.example.com/r.git',
  },
  {
    name: 'GitHub в export',
    path: 'ci/x.sh',
    found: `export GITHUB_TOKEN=${j('ghp_', TAIL)}`,
    key: 'GITHUB_TOKEN',
    quiet: 'export GITHUB_TOKEN="$(cat /run/secrets/gh)"',
  },
  {
    name: 'Slack в коде',
    path: 'src/slack.ts',
    found: `const t = '${j('xoxb-', '123456789012-1234567890123-', 'aB3dE5fG7hJ9kL1mN2pQ4rS')}';`,
    key: 'токен Slack',
    quiet: 'const t = process.env.SLACK_TOKEN;',
  },
  // Пропуск 0.4.0: хвост короче 24.
  {
    name: 'Stripe sk_live_',
    path: 'src/pay.ts',
    found: `stripe('${j('sk_', 'live_', 'aB3dE5fG7hJ9kL1mN2pQ4rS')}')`,
    key: 'токен Stripe',
    quiet: `stripe('${j('sk_', 'test_', 'aB3dE5fG7hJ9kL1mN2pQ4rS')}')`,
  },
  {
    name: 'Google API',
    path: 'src/g.ts',
    found: `key: '${j('AIza', 'SyA1bC2dE3fG4hI5jK6lM7nO8pQ9rS0tU1v')}'`,
    key: 'токен Google',
    quiet: 'key: process.env.GOOGLE_KEY',
  },
  {
    name: 'ключ OpenSSH',
    path: 'deploy/id_rsa',
    found: `${PEM_HEAD('OPENSSH ')}\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ\n-----END OPENSSH PRIVATE KEY-----`,
    key: 'PEM',
    quiet: '-----BEGIN OPENSSH PUBLIC KEY-----\nAAAAB3NzaC1yc2E\n-----END OPENSSH PUBLIC KEY-----',
  },
  {
    name: 'ключ RSA',
    path: 'deploy/k.pem',
    found: `${PEM_HEAD('RSA ')}\nMIIEpAIBAAKCAQEA1b2C3d4E5f6G7h8I9j0K\n-----END RSA PRIVATE KEY-----`,
    key: 'PEM',
    quiet: '-----BEGIN CERTIFICATE-----\nMIIEpAIBAAKCAQEA1b2C3d4E5f6G7h8I9j0K\n-----END CERTIFICATE-----',
  },
  {
    name: 'пароль в адресе БД',
    path: 'src/db.ts',
    found: `const url = 'postgres://app:${R}@db.internal:5432/app';`,
    key: 'адрес',
    quiet: 'const url = `postgres://app:${password}@db.internal:5432/app`;',
  },
  {
    name: 'compose: список environment',
    path: 'deploy/compose.yml',
    found: `    environment:\n      - POSTGRES_PASSWORD=${R}`,
    key: 'POSTGRES_PASSWORD',
    quiet: '    environment:\n      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?нет}',
  },
  {
    name: 'compose: map environment',
    path: 'deploy/compose.yml',
    found: `    environment:\n      REDIS_PASSWORD: "${R}"`,
    key: 'REDIS_PASSWORD',
    quiet: '    environment:\n      REDIS_PASSWORD: "${REDIS_PASSWORD}"',
  },
  // Пропуск 0.4.0: директива через пробел.
  {
    name: 'redis.conf requirepass',
    path: 'deploy/redis.conf',
    found: `requirepass ${R}`,
    key: 'requirepass',
    quiet: '# requirepass foobared',
  },
  {
    name: '.npmrc _authToken',
    path: '.npmrc',
    found: `//npm.example.com/:_authToken=${j('npm_', TAIL)}`,
    key: '_authToken',
    quiet: '//npm.example.com/:_authToken=${NPM_TOKEN}',
  },
  {
    name: 'Dockerfile ENV',
    path: 'deploy/Dockerfile',
    found: `ENV DB_PASSWORD=${R}`,
    key: 'DB_PASSWORD',
    quiet: 'ENV DB_PASSWORD=${DB_PASSWORD}',
  },
  {
    name: 'Dockerfile ARG',
    path: 'deploy/Dockerfile',
    found: `ARG NPM_TOKEN=${R}`,
    key: 'NPM_TOKEN',
    quiet: 'ARG NPM_TOKEN',
  },
  // Пропуск 0.4.0: base64 PEM в `*-data`.
  {
    name: 'kubeconfig client-key-data',
    path: 'deploy/kubeconfig',
    found: `    client-key-data: ${b64(`${PEM_HEAD('RSA ')}\nMIIEpAIBAAKCAQEA`)}`,
    key: 'client-key-data',
    quiet: `    client-certificate-data: ${b64('-----BEGIN CERTIFICATE-----\nMIIEpAIBAAKCAQEA')}`,
  },
  // Пропуск 0.4.0: base64 «логин:пароль».
  {
    name: 'Docker config.json auth',
    path: 'deploy/docker-config.json',
    found: `{"auths":{"cr.example.com":{"auth":"${b64(`json_key:${R}`)}"}}}`,
    key: 'auth',
    quiet: `{"auths":{"cr.example.com":{"auth":"${b64('user:password')}"}}}`,
  },
  {
    name: 'tfvars',
    path: 'infra/main.tfvars',
    found: `db_password = "${R}"`,
    key: 'db_password',
    quiet: 'db_password = var.db_password',
  },
  {
    name: 'toml',
    path: 'config/app.toml',
    found: `password = "${R}"`,
    key: 'password',
    quiet: 'password = "changeme"',
  },
  {
    name: 'ini',
    path: 'config/app.ini',
    found: `password=${R}`,
    key: 'password',
    quiet: 'password=%(DB_PASSWORD)s',
  },
  {
    name: 'json',
    path: 'config/app.json',
    found: `{ "db": { "password": "${R}" } }`,
    key: 'password',
    quiet: '{ "db": { "password": "" } }',
  },
  {
    name: 'properties',
    path: 'config/app.properties',
    found: `spring.datasource.password=${R}`,
    key: 'spring.datasource.password',
    quiet: 'spring.datasource.password=${DB_PASSWORD}',
  },
  {
    name: 'JWT под ключом',
    path: 'src/jwt.ts',
    found: `const token = '${j('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', '.eyJzdWIiOiIxMjM0NTY3ODkwIn0.', TAIL)}';`,
    key: 'token',
    quiet: 'const token = jwt.sign(payload, process.env.JWT_SECRET);',
  },
  {
    name: 'YC OAuth y0_',
    path: 'deploy/yc.sh',
    found: `YC_TOKEN=${j('y0_', 'AgAAAAAB3dE5fG7hJ9kL1mN2pQ4rS6tU8vW0xY2z4A')}`,
    key: 'YC_TOKEN',
    quiet: 'YC_TOKEN=$(yc iam create-token)',
  },
  // Пропуск 0.4.0: позиционное значение `config set token`.
  {
    name: 'yc config set token t1.',
    path: 'deploy/yc.sh',
    found: `yc config set token ${j('t1.', '9euelZqLmZ2RjpWQk5yZmZuWjM7v')}`,
    key: 'token',
    quiet: 'yc config set token "$YC_TOKEN"',
  },
  {
    name: 'ключ сервисного аккаунта YC',
    path: 'deploy/sa.json',
    found: `{"id":"aje1","private_key":"PLEASE DO NOT REMOVE THIS LINE! Yandex.Cloud SA Key ID <x>\\n${PEM_HEAD('')}\\nMIIEvQ\\n-----END PRIVATE KEY-----\\n"}`,
    key: 'PEM',
    quiet: '{"id":"aje1","public_key":"-----BEGIN PUBLIC KEY-----\\nMIIBIj\\n-----END PUBLIC KEY-----\\n"}',
  },
  {
    name: 'Python',
    path: 'src/x.py',
    found: `password = '${R}'`,
    key: 'password',
    quiet: "password = os.environ['DB_PASSWORD']",
  },
  {
    name: 'Go',
    path: 'src/x.go',
    found: `const apiKey = "${R}"`,
    key: 'apiKey',
    quiet: 'apiKey := os.Getenv("API_KEY")',
  },
  // Пропуск 0.4.0: `curl -u логин:пароль`.
  {
    name: 'curl -u в CI',
    path: 'ci/.gitlab-ci.yml',
    found: `  script:\n    - curl -u admin:${R} https://nexus.example.com`,
    key: 'curl -u',
    quiet: '  script:\n    - curl -u "admin:${NEXUS_PASSWORD}" https://nexus.example.com',
  },
  {
    name: 'X-Api-Key',
    path: 'src/h.ts',
    found: `headers: { 'X-Api-Key': '${R}' }`,
    key: 'X-Api-Key',
    quiet: "headers: { 'X-Api-Key': apiKey }",
  },
  {
    name: 'Basic в заголовке',
    path: 'src/h.ts',
    found: `Authorization: 'Basic ${b64(`admin:${R}`)}'`,
    key: 'Authorization',
    quiet: `Authorization: 'Basic ${b64('user:password')}'`,
  },
  // Пропуск 0.4.0: склеенное имя переменной.
  {
    name: 'PGPASSWORD перед командой',
    path: 'deploy/run.sh',
    found: `PGPASSWORD='${R}' psql -h db`,
    key: 'PGPASSWORD',
    quiet: 'PGPASSWORD="$DB_PASSWORD" psql -h db',
  },
  // Пропуск 0.4.0: короткий флаг команды.
  {
    name: 'sshpass -p',
    path: 'deploy/run.sh',
    found: `sshpass -p '${R}' ssh host`,
    key: 'sshpass -p',
    quiet: 'sshpass -e ssh host',
  },
  // Пропуск 0.4.0: тег YAML.
  {
    name: 'YAML !!str',
    path: 'deploy/app.yaml',
    found: `  password: !!str ${R}`,
    key: 'password',
    quiet: '  password: !!str ${DB_PASSWORD}',
  },
  // Пропуск 0.4.0: литерал внутри вызова.
  {
    name: 'hex в Buffer.from',
    path: 'src/k.ts',
    found: `const secret = Buffer.from('${Buffer.from(R).toString('hex')}', 'hex');`,
    key: 'secret',
    quiet: "const secret = Buffer.from(process.env.SECRET_HEX ?? '', 'hex');",
  },
];

/** 12 форм, которые находкой быть не должны; рядом — та же форма с настоящим секретом. */
const SAFE: Form[] = [
  {
    name: 'заглушка в .env.example',
    path: 'deploy/a.env.example',
    quiet: 'DB_PASSWORD=changeme',
    found: `DB_PASSWORD=${R}`,
    key: 'DB_PASSWORD',
  },
  {
    name: 'подстановка в compose',
    path: 'deploy/compose.yml',
    quiet: '      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}',
    found: `      - POSTGRES_PASSWORD=\${POSTGRES_PASSWORD:-${R}}`,
    key: 'POSTGRES_PASSWORD',
  },
  // Пропуск 0.4.0 (обратная сторона): `?? 'литерал'` — находка.
  {
    name: 'env ?? пусто',
    path: 'src/c.ts',
    quiet: "password: process.env.DB_PASSWORD ?? ''",
    found: `password: process.env.DB_PASSWORD ?? '${R}'`,
    key: 'password',
  },
  {
    name: 'заглушка <…> в YAML',
    path: 'deploy/app.yaml',
    quiet: '  password: <your-password>',
    found: `  password: ${R}`,
    key: 'password',
  },
  // В спеке — тоже находка: освобождает перечень фикстур, а не сканер.
  {
    name: 'описание в спеке',
    path: 'src/c.spec.ts',
    quiet: "const password = 'test-password';",
    found: `const password = '${R}';`,
    key: 'password',
  },
  // Ложная находка 0.4.0: SOPS.
  {
    name: 'SOPS ENC[…]',
    path: 'deploy/secrets.sops.yaml',
    quiet: 'password: ENC[AES256_GCM,data:abc,iv:def,tag:ghi,type:str]',
    found: `password: ${R}`,
    key: 'password',
  },
  {
    name: 'проза README',
    path: 'README.md',
    quiet: 'Задайте `DB_PASSWORD=...` в окружении.',
    found: `\`\`\`bash\nDB_PASSWORD=${R}\n\`\`\``,
    key: 'DB_PASSWORD',
  },
  {
    name: 'имя поля',
    path: 'src/x.ts',
    quiet: "const passwordField = 'password';",
    found: `const passwordText = '${R}';`,
    key: 'passwordText',
  },
  // Пропуск 0.4.0 (обратная сторона): `name`/`value` env Kubernetes — находка.
  {
    name: 'k8s secretKeyRef',
    path: 'deploy/k8s.yaml',
    quiet:
      '        - name: DB_PASSWORD\n          valueFrom:\n            secretKeyRef: { name: db, key: password }',
    found: `        - name: DB_PASSWORD\n          value: ${R}`,
    key: 'DB_PASSWORD',
  },
  {
    name: 'integrity sha512',
    path: 'package-lock.json',
    quiet: `"integrity": "sha512-${R}${R}=="`,
    found: `"password": "${R}"`,
    key: 'password',
  },
  {
    name: 'uuid',
    path: 'src/x.ts',
    quiet: "const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';",
    found: "const uuid = 'postgres://u:3f2504e0@h';",
    key: 'адрес',
  },
  {
    name: 'sha256',
    path: 'src/x.ts',
    quiet: "const sha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';",
    found: "const shaSecret = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';",
    key: 'shaSecret',
  },
];

/** Найденные ключи и строки отчёта формы. */
const scan = (path: string, text: string) => scanText(path, `${text}\n`, new Set(['changeme']));

describe('корпус форм утечки', () => {
  it('выборка не выродилась: 36 форм утечки и 12 безопасных, имена уникальны', () => {
    expect(LEAKS).toHaveLength(36);
    expect(SAFE).toHaveLength(12);
    const names = [...LEAKS, ...SAFE].map(({ name }) => name);
    expect(new Set(names).size).toBe(names.length);
  });

  describe.each([
    ['утечка', LEAKS],
    ['безопасная форма', SAFE],
  ])('%s', (_group, forms) => {
    it.each(forms.map((form) => [form.name, form] as const))(
      '%s: находит ровно одну, с ключом',
      (_name, form) => {
        const findings = scan(form.path, form.found);
        expect(findings.map(({ key }) => key)).toEqual([form.key]);
      },
    );

    it.each(forms.map((form) => [form.name, form] as const))(
      '%s: та же форма без секрета — тишина',
      (_name, form) => {
        expect(scan(form.path, form.quiet).map(({ report }) => report)).toEqual([]);
      },
    );
  });

  it('значение не попадает в отчёт ни в какой форме: ни сырое, ни base64, ни hex', () => {
    const reports = [...LEAKS, ...SAFE].flatMap((form) =>
      scan(form.path, form.found).map(({ report }) => report),
    );
    const text = reports.join('\n');
    expect(reports.length).toBe(48);
    for (const shape of [R, b64(R), Buffer.from(R).toString('hex'), TAIL, b64(`admin:${R}`)]) {
      expect(text).not.toContain(shape);
    }
  });
});
