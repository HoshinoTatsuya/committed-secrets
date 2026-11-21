import { scanText } from './scan-text';

/**
 * Значение-имя файла под ключом со словом секрета (0.6.1): ключ отчёта
 * (`secret_detection: gl-secret-detection-report.json` в отчётах CI), путь к
 * файлу ключа без `./` (`client_secret: keys/client-secret.json`), имя файла в
 * коде — ссылка на файл, а не литерал. У каждой формы пара: тот же ключ с
 * настоящим литеральным секретом — находка.
 */
const j = (...parts: string[]): string => parts.join('');
/** Случайный литерал — секрет по форме. */
const R = j('Zq8vR2mT7x', 'Lp4Kd9Wn3B');

/** [имя, путь, текст с секретом, ключи находок, тот же ключ с именем файла]. */
const FORMS: Array<[name: string, path: string, found: string, keys: string[], quiet: string]> = [
  [
    'отчёт CI: ключ со словом secret',
    '.gitlab-ci.yml',
    `      secret_detection: ${R}`,
    ['secret_detection'],
    '      secret_detection: gl-secret-detection-report.json',
  ],
  [
    'путь без ./ в YAML',
    'config.yml',
    `client_secret: ${R}`,
    ['client_secret'],
    'client_secret: keys/client-secret.json',
  ],
  ['имя файла в .env', '.env.example', `API_KEY=${R}`, ['API_KEY'], 'API_KEY=api-key.txt'],
  [
    'имя файла в коде',
    'src/report.ts',
    `const secretReport = '${R}';`,
    ['secretReport'],
    "const secretReport = 'reports/secret-scan.sarif';",
  ],
  [
    'файл ключа PEM в YAML',
    'config.yml',
    `private_key: ${R}`,
    ['private_key'],
    'private_key: tls/server.key',
  ],
  [
    // Литерал с точкой внутри — не имя файла: расширение не из перечня.
    'литерал с точкой — по-прежнему находка',
    'config.yml',
    `api_secret: ${R}.${R}`,
    ['api_secret'],
    'api_secret: ${API_SECRET}',
  ],
  [
    // Расширение есть, но слово перед ним — случайный литерал с цифрами и
    // регистром без разделителей: секрет, дописанный «.json», остаётся секретом.
    'литерал с расширением — по-прежнему находка',
    'config.yml',
    `api_secret: ${R}.json`,
    ['api_secret'],
    'api_secret: api-secret.json',
  ],
];

const keysOf = (path: string, text: string): string[] =>
  scanText(path, `${text}\n`, new Set()).map(({ key }) => key);

describe('имя файла под ключом секрета (0.6.1)', () => {
  it('выборка не выродилась: форм больше пяти', () => {
    expect(FORMS.length).toBeGreaterThan(5);
  });

  it.each(FORMS)('%s: литерал под тем же ключом — находка', (_name, path, found, keys) => {
    expect(keysOf(path, found)).toEqual(keys);
  });

  it.each(FORMS)('%s: имя файла — тишина', (_name, path, _found, _keys, quiet) => {
    expect(keysOf(path, quiet)).toEqual([]);
  });
});
