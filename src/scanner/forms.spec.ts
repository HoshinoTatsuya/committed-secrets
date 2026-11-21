import { scanText } from './scan-text';

/**
 * Формы 0.5.0 сверх корпуса: команды и флаги, переменные AUTH/PASS в позиции
 * присваивания, структура YAML, зашифрованное хранение, XML, `=>`, литералы
 * по умолчанию в коде, словарь ключей. У каждой формы пара: «находит» с
 * ключом находки и «не трогает» — та же форма без секрета или похожая форма,
 * где значение секретом не является.
 */
const j = (...parts: string[]): string => parts.join('');
const b64 = (text: string): string => Buffer.from(text).toString('base64');
const R = j('Zq8vR2mT7x', 'Lp4Kd9Wn3B');
/** sha256 пустой строки — вид хэша в примерах документации. */
const HEX64 = j('e3b0c44298fc1c149afbf4c8996fb924', '27ae41e4649b934ca495991b7852b855');

/** [имя, путь, текст с секретом, ключи находок, тот же путь без секрета]. */
const FORMS: Array<[name: string, path: string, found: string, keys: string[], quiet: string]> = [
  // Н3: пароль Redis в compose — строкой команды, переменной клиента, exec-формой, проверкой здоровья.
  [
    '--requirepass в command',
    'docker-compose.yml',
    `    command: redis-server --requirepass "${R}"`,
    ['--requirepass'],
    '    command: redis-server --requirepass "${REDIS_PASSWORD}"',
  ],
  [
    'REDISCLI_AUTH в environment',
    'docker-compose.yml',
    `      - REDISCLI_AUTH=${R}`,
    ['REDISCLI_AUTH'],
    '      - REDISCLI_AUTH=${REDIS_PASSWORD}',
  ],
  [
    'REDISCLI_AUTH картой',
    'docker-compose.yml',
    `      REDISCLI_AUTH: ${R}`,
    ['REDISCLI_AUTH'],
    '      REDISCLI_AUTH: ${REDIS_PASSWORD:?нет}',
  ],
  [
    'exec-форма command',
    'docker-compose.yml',
    `    command: ["redis-server", "--requirepass", "${R}"]`,
    ['--requirepass'],
    '    command: ["redis-server", "--requirepass", "$REDIS_PASSWORD"]',
  ],
  [
    'exec-форма без кавычек',
    'docker-compose.yml',
    `    command: [redis-server, --requirepass, ${R}]`,
    ['--requirepass'],
    '    command: [redis-server, --appendonly, "yes"]',
  ],
  [
    'healthcheck exec-форма',
    'docker-compose.yml',
    `      test: ["CMD", "redis-cli", "-a", "${R}", "ping"]`,
    ['redis-cli -a'],
    '      test: ["CMD", "redis-cli", "ping"]',
  ],
  [
    'healthcheck CMD-SHELL',
    'docker-compose.yml',
    `      test: ["CMD-SHELL", "redis-cli -a ${R} ping"]`,
    ['redis-cli -a'],
    '      test: ["CMD-SHELL", "redis-cli -a $$REDIS_PASSWORD ping"]',
  ],
  [
    'healthcheck строкой',
    'docker-compose.yml',
    `      test: redis-cli -a '${R}' ping`,
    ['redis-cli -a'],
    '      test: redis-cli -a "$REDIS_PASSWORD" ping',
  ],
  [
    'список YAML по строкам',
    'k8s/redis.yaml',
    `        args:\n          - --requirepass\n          - ${R}`,
    ['--requirepass'],
    '        args:\n          - --requirepass\n          - $(REDIS_PASSWORD)',
  ],
  // Флаги команд, привязанные к команде.
  [
    'docker login -p',
    'ci/push.sh',
    `docker login -u ci -p ${R} registry.example.com`,
    ['docker login -p'],
    'docker run -p 8080:80 -u app image',
  ],
  [
    'login другой программы — не реестр',
    'ci/push.sh',
    `podman login -p ${R} registry.example.com`,
    ['podman login -p'],
    'devserver login -p 3000',
  ],
  [
    '--password-stdin — не значение',
    'ci/push.sh',
    `echo "$PW" | docker login --password-stdin -u ci ${R}`.replace(R, 'registry.example.com'),
    [],
    'docker login --password-stdin registry.example.com',
  ],
  [
    'mysql -pПАРОЛЬ слитно',
    'deploy/db.sh',
    `mysql -uroot -p${R} app`,
    ['mysql -p'],
    'mysql -uroot -p application_database',
  ],
  [
    '--password= любой команды',
    'deploy/db.sh',
    `mysqldump --password=${R} app`,
    ['--password'],
    'mysqldump --password="$DB_PASSWORD" app',
  ],
  [
    '--no-password — не значение',
    'deploy/db.sh',
    `psql --no-password ${j('application', '_database')}`,
    [],
    'psql --no-password -h db',
  ],
  [
    '--token-file — путь',
    'deploy/db.sh',
    'vault login --token-file /run/secrets/vault_token_file',
    [],
    'vault login --token-file ./vault-token-file',
  ],
  [
    'curl -H Bearer',
    'ci/x.sh',
    `curl -H "Authorization: Bearer ${R}" https://api.example.com`,
    ['Authorization'],
    'curl -H "Authorization: Bearer $API_TOKEN" https://api.example.com',
  ],
  [
    'curl --header X-Api-Key',
    'ci/x.sh',
    `curl --header "X-Api-Key: ${R}" https://api.example.com`,
    ['X-Api-Key'],
    'curl --header "Content-Type: application/json" https://api.example.com',
  ],
  [
    'openssl pass:',
    'deploy/certs.sh',
    `openssl pkcs12 -export -passout pass:${R} -out a.p12`,
    ['pass'],
    'openssl pkcs12 -export -passout env:P12_PASSWORD -out a.p12',
  ],
  [
    'ldapsearch -w',
    'deploy/ldap.sh',
    `ldapsearch -x -D cn=admin -w ${R}`,
    ['ldapsearch -w'],
    'ldapsearch -x -D cn=admin -W',
  ],
  [
    'docker run -e',
    'deploy/run.sh',
    `docker run -e POSTGRES_PASSWORD=${R} postgres`,
    ['POSTGRES_PASSWORD'],
    'docker run -e POSTGRES_PASSWORD postgres',
  ],
  [
    'kubectl --from-literal',
    'deploy/run.sh',
    `kubectl create secret generic db --from-literal=password=${R}`,
    ['password'],
    'kubectl create secret generic db --from-file=password=./db-password.txt',
  ],
  [
    'mount -o user,password',
    'src/mount.ts',
    `execSync('mount -t cifs -o username=app,password=${R} //h/s /mnt');`,
    ['password'],
    "execSync('mount -t cifs -o credentials=/root/.smb //h/s /mnt');",
  ],
  [
    'smbclient -U user%pass',
    'deploy/run.sh',
    `smbclient //h/s -U app%${R}`,
    ['smbclient -U'],
    'smbclient //h/s -U app',
  ],
  [
    'команда в строке кода',
    'src/backup.ts',
    `execSync('sshpass -p ${R} ssh backup@host');`,
    ['sshpass -p'],
    'execSync(`sshpass -p ${password} ssh backup@host`);',
  ],
  [
    'массив аргументов в коде',
    'src/backup.ts',
    `spawn('redis-cli', ['-a', '${R}', 'ping']);`,
    ['redis-cli -a'],
    "spawn('redis-cli', ['-a', password, 'ping']);",
  ],
  [
    'команда во встроенном коде Markdown',
    'docs/ops.md',
    `Проверка: \`redis-cli -a ${R} ping\``,
    ['redis-cli -a'],
    'Проверка: `redis-cli -a <пароль> ping`',
  ],
  // Склеенные имена и словарь ключей.
  ['MYSQL_PWD', 'deploy/run.sh', `MYSQL_PWD=${R} mysql app`, ['MYSQL_PWD'], 'PWD=build-workspace'],
  [
    'PASSWORD_STDIN — способ, не значение',
    'deploy/app.env',
    `DB_PASSWORD=${R}`,
    ['DB_PASSWORD'],
    'PASSWORD_STDIN=from-pipeline-file',
  ],
  [
    'ENCRYPTION_KEY',
    'deploy/app.env',
    `ENCRYPTION_KEY=${R}`,
    ['ENCRYPTION_KEY'],
    'CACHE_KEY=users-by-email-v2',
  ],
  ['SIGNING_KEY', 'deploy/app.env', `SIGNING_KEY=${R}`, ['SIGNING_KEY'], 'PRIMARY_KEY=account_identifier'],
  [
    '.npmrc _auth',
    '.npmrc',
    `//npm.example.com/:_auth=${b64(`ci:${R}`)}`,
    ['_auth'],
    '//npm.example.com/:_auth=${NPM_AUTH}',
  ],
  ['BASIC_AUTH', 'deploy/app.env', `BASIC_AUTH=admin:${R}`, ['BASIC_AUTH'], 'AUTH_PROVIDER=keycloak-realm'],
  [
    'auth в коде — не секрет',
    'src/a.ts',
    `const accessTokenSecret = '${R}';`,
    ['accessTokenSecret'],
    "const auth = 'oauth2-client-credentials';",
  ],
  // Литералы по умолчанию в коде.
  [
    'get(KEY, литерал)',
    'src/config.ts',
    `const db = config.get('DB_PASSWORD', '${R}');`,
    ['DB_PASSWORD'],
    "const host = config.get('DB_HOST', 'database.internal');",
  ],
  [
    'getenv Python',
    'src/settings.py',
    `secret_key = os.getenv("SECRET_KEY", "${R}")`,
    ['secret_key'],
    'secret_key = os.getenv("SECRET_KEY")',
  ],
  [
    '.default(литерал)',
    'src/env.ts',
    `  JWT_SECRET: Joi.string().default('${R}'),`,
    ['JWT_SECRET'],
    '  PORT: Joi.number().default(3000),',
  ],
  [
    'env || литерал',
    'src/env.ts',
    `const apiKey = process.env.API_KEY || '${R}';`,
    ['apiKey'],
    "const region = process.env.REGION || 'ru-central1-a';",
  ],
  [
    'import.meta.env ?? литерал под чужим ключом',
    'src/env.ts',
    `const k = import.meta.env.VITE_API_TOKEN ?? '${R}';`,
    ['VITE_API_TOKEN'],
    "const k = import.meta.env.VITE_API_URL ?? 'https://api.example.com';",
  ],
  // P2: `=>`, XML.
  [
    'PHP =>',
    'config/db.php',
    `    'password' => '${R}',`,
    ['password'],
    "    'password' => env('DB_PASSWORD'),",
  ],
  ['Ruby =>', 'config/db.rb', `  :password => "${R}",`, ['password'], '  :password => ENV["DB_PASSWORD"],'],
  [
    'XML элемент',
    'config/settings.xml',
    `<password>${R}</password>`,
    ['password'],
    '<password>${env.MAVEN_PASSWORD}</password>',
  ],
  [
    'XML entry key',
    'config/app.xml',
    `<entry key="db.password">${R}</entry>`,
    ['db.password'],
    '<entry key="db.host">database.internal</entry>',
  ],
  [
    '.NET add key/value',
    'web.config',
    `<add key="DbPassword" value="${R}" />`,
    ['DbPassword'],
    '<add key="DbHost" value="database.internal" />',
  ],
  [
    'ECS name/value',
    'deploy/task.json',
    `{ "name": "DB_PASSWORD", "value": "${R}" }`,
    ['DB_PASSWORD'],
    '{ "name": "DB_PASSWORD", "valueFrom": "arn:aws:ssm:x" }',
  ],
  [
    'Maven {зашифровано}',
    'config/settings.xml',
    `<password>${R}</password>`,
    ['password'],
    '<password>{COQLCE6DU6GtcS5P=}</password>',
  ],
  // Структура YAML.
  [
    'блок | одной строкой',
    'deploy/app.yaml',
    `  password: |\n    ${R}\n  user: app`,
    ['password'],
    '  script: |\n    echo start\n    echo done',
  ],
  [
    'блок | многострочный — текст',
    'deploy/app.yaml',
    `  password: >-\n    ${R}\n`,
    ['password'],
    '  secret: |\n    {"type":"service_account",\n     "project":"app-production"}',
  ],
  [
    'SealedSecret encryptedData',
    'deploy/sealed.yaml',
    `kind: Secret\ndata:\n  password: ${b64(R)}`,
    ['password'],
    `kind: SealedSecret\nspec:\n  encryptedData:\n    password: ${j('AgBy3i4OJSWK', '+PiTySYZZA2rO43cGDEq')}\n    token: ${j('AgCx9k2LmN', 'pQ7rS1tU3vW5xY7zA9')}\n  template:\n    metadata:\n      name: db`,
  ],
  [
    'age: ключ — секрет, шифротекст — нет',
    'deploy/keys.txt',
    j('AGE-SECRET-KEY-1', 'QY7XZ2LK5PMW8RTQY7XZ2LK5PMW8RTQY7XZ2LK5PMW8RTQY7XZ2LK5PMW8RT'.slice(0, 58)),
    ['токен age'],
    '-----BEGIN AGE ENCRYPTED FILE-----\nYWdlLWVuY3J5cHRpb24ub3JnL3YxCi0+IFgyNTUxOQ\n-----END AGE ENCRYPTED FILE-----',
  ],
  [
    'CloudFormation !Ref',
    'infra/stack.yaml',
    `      MasterUserPassword: ${R}`,
    ['MasterUserPassword'],
    '      MasterUserPassword: !Ref DbPassword',
  ],
  // Режим конфигурации по имени файла.
  [
    '.bashrc export',
    'home/.bashrc',
    `export GITHUB_TOKEN=${R}`,
    ['GITHUB_TOKEN'],
    'export GITHUB_TOKEN=$(pass show github)',
  ],
  [
    '.netrc',
    'home/.netrc',
    `machine api.example.com login ci password ${R}`,
    ['password'],
    'machine api.example.com login ci',
  ],
  [
    '.pgpass',
    'home/.pgpass',
    `db.internal:5432:app:app:${R}`,
    ['password'],
    'db.internal:5432:*:app:*'.replace(/:\*$/u, ''),
  ],
  ['.my.cnf', 'home/.my.cnf', `password=${R}`, ['password'], 'password='],
  [
    'redis.conf ACL',
    'deploy/redis.conf',
    `user app on >${R} ~* +@all`,
    ['user'],
    'user app on #9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 ~* +@all',
  ],
  // Двойная находка: токен в пароле адреса — одна.
  [
    'токен в адресе — одна находка',
    'ci/x.sh',
    `git push https://ci:${j('glpat-', 'aB3dE5fG7hJ9kL1mN2pQ')}@gitlab.example.com/r.git`,
    ['токен GitLab'],
    'git push https://ci:${CI_JOB_TOKEN}@gitlab.example.com/r.git',
  ],
  // 0.5.1: ссылка на секрет BuildKit по имени — не литерал; литерал после `--secret` — находка.
  [
    'BuildKit --secret id=…,env=… в CI',
    '.gitlab-ci.yml',
    `    - mytool --secret ${R}`,
    ['--secret'],
    '    - docker build --secret id=npm_token,env=NPM_TOKEN -t app .',
  ],
  [
    'BuildKit --secret=id=…,src=…',
    '.gitlab-ci.yml',
    `    - mytool --secret=${R}`,
    ['--secret'],
    '    - docker buildx build --secret=id=npmrc,src=.npmrc --secret "id=pip,source=pip.conf" .',
  ],
  [
    'BuildKit --secret в блоке кода Markdown',
    'docs/build.md',
    ['```bash', `mytool --secret ${R}`, '```'].join('\n'),
    ['--secret'],
    ['```bash', 'docker build --secret id=npm_token,env=NPM_TOKEN .', '```'].join('\n'),
  ],
  [
    'BuildKit --secret: ключ вне спеки — находка по ключу',
    '.gitlab-ci.yml',
    `    - docker build --secret id=npm_token,password=${R} .`,
    ['password'],
    '    - docker build --secret id=npm_token,type=env,env=NPM_TOKEN .',
  ],
  // 0.5.1: экранированная ссылка на переменную удалённой оболочки (`ssh host redis-cli -a \"\$PW\"`) — не литерал.
  [
    'redis-cli -a \\$PW в команде ssh',
    'scripts/smoke-test.sh',
    `ssh "$HOST" redis-cli -a ${R} ping`,
    ['redis-cli -a'],
    'ssh "$HOST" PW=\\$\\(cat /run/secrets/redis\\)\\; redis-cli -a \\"\\$PW\\" ping',
  ],
  [
    'redis-cli -a \\${PW} в команде ssh',
    'scripts/smoke-test.sh',
    `ssh "$HOST" redis-cli -a \\"${R}\\" ping`,
    ['redis-cli -a'],
    'ssh "$HOST" redis-cli -a \\${REDIS_PASSWORD} ping && ssh "$HOST" redis-cli -a \\$PW ping',
  ],
  // 0.5.1: том compose «путь:путь[:режим]» — значение путь, а не секрет.
  [
    'том compose с режимом',
    'docker-compose.yml',
    `      - ./metrics-account-key.json:${R}:ro`,
    ['metrics-account-key.json'],
    '      - ./metrics-account-key.json:/run/secrets/metrics-account-key.json:ro',
  ],
  [
    'том compose в кавычках с режимами',
    'docker-compose.yml',
    `      - "./metrics-account-key.json:${R}"`,
    ['metrics-account-key.json'],
    '      - "./metrics-account-key.json:/run/secrets/metrics-account-key.json:ro,z"',
  ],
  [
    'том compose в блоке YAML Markdown',
    'docs/deploy.md',
    ['```yaml', '    volumes:', `      - ./service-account-key.json:${R}`, '```'].join('\n'),
    ['service-account-key.json'],
    [
      '```yaml',
      '    volumes:',
      '      - ./service-account-key.json:/run/secrets/service-account-key.json:ro',
      '```',
    ].join('\n'),
  ],
  [
    'ключ внутри json-файла ключа',
    'deploy/metrics-account-key.json',
    `{"private_key": "${R}"}`,
    ['private_key'],
    '{"private_key": "/run/secrets/metrics-account-key.json:ro"}',
  ],
  // 0.5.1: ложные находки в реальной эксплуатации — у каждой пара с настоящим секретом в той же позиции.
  [
    'константа с SECRET и значением-идентификатором с версией',
    'src/bookmarks/migration.ts',
    `export const TEAM_SECRET_BOOKMARKS_MIGRATION_KEY = 'team-secret-bookmarks-${R}';`,
    ['TEAM_SECRET_BOOKMARKS_MIGRATION_KEY'],
    "export const TEAM_SECRET_BOOKMARKS_MIGRATION_KEY = 'team-secret-bookmarks-v1';",
  ],
  [
    'колонка SQL, сравниваемая с колонкой',
    'deploy/queries.yml',
    `  where: ON secret_state.secret_id = ${R}`,
    ['secret_state.secret_id'],
    '  where: ON secret_state.secret_id = secrets.id AND secret_state.project_id = $2',
  ],
  [
    'адрес с заглушками в комментарии-примере',
    'src/config/database.ts',
    `// например postgres://app:${R}@db.internal/app`,
    ['адрес'],
    '// например postgres://user:secret@host/db, postgres://app:app@localhost/app',
  ],
  [
    'адрес с заглушкой в коде — по-прежнему находка',
    'src/config/database.ts',
    "const url = 'postgres://user:secret@host/db';",
    ['адрес'],
    "const url = 'postgres://user:<password>@host/db';",
  ],
  [
    'sha256 в @example JSDoc',
    'src/secrets/secret.dto.ts',
    `   * @example secretId: '${R}'`,
    ['secretId'],
    `   * @example secretId: '${HEX64}'`,
  ],
  [
    '64 hex значением ключа в коде — находка',
    'src/secrets/client.ts',
    `const apiSecret = '${HEX64}';`,
    ['apiSecret'],
    'const apiSecret = process.env.API_SECRET;',
  ],
  [
    'пример ключа AWS из документации',
    'README.md',
    `AWS_ACCESS_KEY_ID=${j('AKIA', '2OGYBAH6QKZXT7NA')}`,
    ['токен AWS'],
    [
      'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
      'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    ].join('\n'),
  ],
  [
    'пример секретного ключа AWS из документации в .env',
    'deploy/app.env',
    `AWS_SECRET_ACCESS_KEY=${j('wJalrXUtnFEMI/K7MDENG/', 'bPxRfiCYzq8vR2mT7xLp4')}`,
    ['AWS_SECRET_ACCESS_KEY'],
    'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  ],
];

const keysOf = (path: string, text: string): string[] =>
  scanText(path, `${text}\n`, new Set()).map(({ key }) => key);

describe('формы 0.5.0', () => {
  it('выборка не выродилась: форм больше 50, у каждой есть находка или явная тишина', () => {
    expect(FORMS.length).toBeGreaterThan(50);
    expect(FORMS.filter(([, , , keys]) => keys.length > 0).length).toBeGreaterThan(45);
  });

  it.each(FORMS)('%s: находит ровно указанное', (_name, path, found, keys) => {
    expect(keysOf(path, found)).toEqual(keys);
  });

  it.each(FORMS)('%s: без секрета — тишина', (_name, path, _found, _keys, quiet) => {
    expect(keysOf(path, quiet)).toEqual([]);
  });

  it('значение в отчёт не попадает', () => {
    const reports = FORMS.flatMap(([, path, found]) =>
      scanText(path, `${found}\n`, new Set()).map(({ report }) => report),
    ).join('\n');
    expect(reports).not.toContain(R);
    expect(reports).not.toContain(b64(R));
  });
});
