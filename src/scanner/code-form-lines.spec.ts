import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { scanText } from './scan-text';
import { BUILT_IN_PLACEHOLDERS } from './secret-rules';

/**
 * Ложные находки 0.5.1 на строках настоящего кода (`fixtures/code-forms/`):
 * синтетические строки ТОЙ ЖЕ ФОРМЫ, что встретились в реальной эксплуатации,
 * вместе с окружением, которое влияет на разбор (блок комментария, блок кода
 * в JSDoc, кавычки). В 0.5.1 эти формы чинились на упрощённых подобиях — и
 * строки полной формы сканер находил по-прежнему.
 *
 * У каждой формы — пары «та же позиция с настоящим секретом — находка»:
 * ослабление правила не должно открыть дыру. Подмена в паре проверяется
 * (текст обязан измениться), иначе пара проверяла бы исходную строку.
 */
const j = (...parts: string[]): string => parts.join('');
const R = j('Zq8vR2mT7x', 'Lp4Kd9Wn3B');
/** Заглавные буквы без слова секрета — случайное значение той же формы, что имя переменной. */
const UPPER = j('QXKZML', 'PTRWVB');
const HEX64 = j('24e45e7f5fe0b41140284afaf0c792a2', 'ad28b6ae095f5bc4f6d29c8b70ceed39');
const PLACEHOLDERS: ReadonlySet<string> = new Set(BUILT_IN_PLACEHOLDERS);

const DIR = join(__dirname, '..', '..', 'fixtures', 'code-forms');
const read = (name: string): string => readFileSync(join(DIR, name), 'utf8');
const flagged = (shown: string, text: string): string[] =>
  scanText(shown, text, PLACEHOLDERS).map(({ line, key }) => `${line}:${key}`);
const lineOf = (text: string, needle: string): number =>
  text.split('\n').findIndex((line) => line.includes(needle)) + 1;

/** [имя, фикстура, путь в отчёте (класс файла — по расширению)]. */
const QUIET: Array<[name: string, fixture: string, shown: string]> = [
  ['адрес с паролем-многоточием в комментарии', 'url-userinfo-comment.ts', 'src/url/display.ts'],
  ['константа с SECRET, значение — слова через дефис', 'migration-key.constant.ts', 'src/a/key.constant.ts'],
  ['соединение SQL с колонкой в кавычках', 'grouped-query.repository.ts', 'src/a/query.repository.ts'],
  ['64 hex в блоке кода после @example JSDoc', 'client-factory.ts', 'src/a/client.factory.ts'],
  ['ключ — имя переменной окружения', 'payload-env.constant.ts', 'src/a/payload-env.constant.ts'],
  [
    'ключи подключения парами «имя — имя»',
    'database-key-pairs.constant.ts',
    'src/a/database-key.constant.ts',
  ],
  ['имя переменной окружения одним словом', 'env-name-single-word.constant.ts', 'src/a/pg-env.constant.ts'],
  [
    'спека: ключ переноса, значение — слова через дефис',
    'backfill.real-pg.spec.ts',
    'src/a/b.real-pg.spec.ts',
  ],
];

/** [имя, фикстура, путь, что заменить, на что, маркер строки находки, ключ находки]. */
const FOUND: Array<[name: string, fixture: string, shown: string, from: string, to: string, key: string]> = [
  [
    'настоящий пароль в том же комментарии',
    'url-userinfo-comment.ts',
    'src/url/display.ts',
    'user:xn--...@',
    `user:${R}@`,
    'адрес',
  ],
  [
    'пароль-многоточие в КОДЕ',
    'url-userinfo-comment.ts',
    'src/url/display.ts',
    '    // "https://user:xn--...@xn--...", в схеме и т.п.), замена попадёт не туда и',
    '    const sample = "https://user:xn--...@xn--...";',
    'адрес',
  ],
  [
    'случайный хвост вместо слов',
    'migration-key.constant.ts',
    'src/a/key.constant.ts',
    "'bookmarks-to-saved-secrets'",
    `'bookmarks-to-saved-${R}'`,
    'TEAM_SECRET_BOOKMARKS_MIGRATION_KEY',
  ],
  [
    'парольная фраза словами без слова секрета',
    'migration-key.constant.ts',
    'src/a/key.constant.ts',
    "'bookmarks-to-saved-secrets'",
    "'correct-horse-battery-staple'",
    'TEAM_SECRET_BOOKMARKS_MIGRATION_KEY',
  ],
  [
    'литерал вместо колонки',
    'grouped-query.repository.ts',
    'src/a/query.repository.ts',
    'secret_state.secret_id = "vault_entries"."secret_digest"',
    `secret_state.secret_id = "${R}"`,
    'secret_state.secret_id',
  ],
  [
    'литерал перед колонкой в кавычках',
    'grouped-query.repository.ts',
    'src/a/query.repository.ts',
    'secret_state.secret_id = "vault_entries"."secret_digest"',
    `secret_state.secret_id = "${R}"."secret_digest"`,
    'secret_state.secret_id',
  ],
  [
    'литерал словом с вызовом метода, а не колонкой',
    'grouped-query.repository.ts',
    'src/a/query.repository.ts',
    'secret_state.secret_id = "vault_entries"."secret_digest"',
    'secret_state.secret_id = "hunterpasswordstaple".trim()',
    'secret_state.secret_id',
  ],
  [
    '65 hex в том же блоке @example',
    'client-factory.ts',
    'src/a/client.factory.ts',
    `secretId: '${HEX64}'`,
    `secretId: '${HEX64}0'`,
    'secretId',
  ],
  [
    'случайное значение в том же блоке @example',
    'client-factory.ts',
    'src/a/client.factory.ts',
    `secretId: '${HEX64}'`,
    `secretId: '${R}'`,
    'secretId',
  ],
  [
    'хэш в том же JSDoc ДО @example',
    'client-factory.ts',
    'src/a/client.factory.ts',
    '   * фильтры листинга.',
    `   * secretId: '${HEX64}'`,
    'secretId',
  ],
  [
    'хэш в следующем JSDoc без @example',
    'client-factory.ts',
    'src/a/client.factory.ts',
    '  ): Promise<IListHostsBySecretOutput | ClientError>;',
    `  ): Promise<IListHostsBySecretOutput | ClientError>;\n\n  /**\n   * secretId: '${HEX64}'\n   */`,
    'secretId',
  ],
  [
    'хэш в комментарии сразу за концом JSDoc с @example',
    'client-factory.ts',
    'src/a/client.factory.ts',
    '   */\n  public abstract listHostsBySecret(',
    `   */\n  /**\n   * secretId: '${HEX64}'\n   */\n  public abstract listHostsBySecret(`,
    'secretId',
  ],
  [
    'хэш под следующим тегом после @example',
    'client-factory.ts',
    'src/a/client.factory.ts',
    '   */\n  public abstract listHostsBySecret(',
    `   * @see secretId: '${HEX64}'\n   */\n  public abstract listHostsBySecret(`,
    'secretId',
  ],
  [
    'хэш в `//` после `// @example`: тег действует только на свою строку',
    'url-userinfo-comment.ts',
    'src/url/display.ts',
    [
      '    // Если перевод ничего не изменил — возвращаем исходную строку без лишних аллокаций',
      '    if (unicodeHost === asciiHost) {',
      '      return url;',
      '    }',
      '',
      '    // Собираем адрес из частей, подменяя ТОЛЬКО хост.',
    ].join('\n'),
    [
      '    // @example toDisplayUrl(url)',
      '    if (unicodeHost === asciiHost) {',
      '      return url;',
      '    }',
      '',
      `    // secretId: '${HEX64}'`,
    ].join('\n'),
    'secretId',
  ],
  [
    // Строка без `*` внутри JSDoc для сканера — не комментарий: раздел закрывается (не смог определить — находка).
    'хэш после строки без `*` в разделе @example',
    'client-factory.ts',
    'src/a/client.factory.ts',
    `   *   size: 20,\n   *   secretId: '${HEX64}',`,
    `     size: 20,\n   *   secretId: '${HEX64}',`,
    'secretId',
  ],
  [
    'литерал вместо имени переменной',
    'payload-env.constant.ts',
    'src/a/payload-env.constant.ts',
    "    REDIS_PASSWORD: 'REDIS_PASSWORD',",
    `    REDIS_PASSWORD: '${R}',`,
    'REDIS_PASSWORD',
  ],
  [
    'литерал вместо имени ключа пароля',
    'database-key-pairs.constant.ts',
    'src/a/database-key.constant.ts',
    "  PASSWORD: 'PASSWORD',",
    `  PASSWORD: '${R}',`,
    'PASSWORD',
  ],
  [
    'заглавные буквы без слова секрета',
    'env-name-single-word.constant.ts',
    'src/a/pg-env.constant.ts',
    "  PGPASSWORD: 'PGPASSWORD',",
    `  PGPASSWORD: '${UPPER}',`,
    'PGPASSWORD',
  ],
  [
    'слово секрета не последним',
    'env-name-single-word.constant.ts',
    'src/a/pg-env.constant.ts',
    "  password: 'PGPASSWORD',",
    `  password: 'PGPASSWORD${UPPER}',`,
    'password',
  ],
  [
    'случайный хвост в спеке',
    'backfill.real-pg.spec.ts',
    'src/a/b.real-pg.spec.ts',
    "'bookmarks-to-saved-secrets'",
    `'bookmarks-to-saved-${R}'`,
    'SECRET_BOOKMARKS_KEY',
  ],
];

describe('строки настоящего кода', () => {
  it('выборка не выродилась: каждая фикстура прочитана и непуста', () => {
    expect(QUIET.length).toBe(8);
    for (const [, fixture] of QUIET) {
      expect(read(fixture).split('\n').length).toBeGreaterThan(1);
    }
  });

  it.each(QUIET)('%s: молчит', (_name, fixture, shown) => {
    expect(flagged(shown, read(fixture))).toEqual([]);
  });

  it.each(FOUND)('%s: находка', (_name, fixture, shown, from, to, key) => {
    const text = read(fixture);
    expect(text.split(from).length).toBe(2);
    const changed = text.replace(from, to);
    expect(changed).not.toBe(text);
    const marker = to.split('\n').find((line) => line.includes(key) || line.includes('://')) ?? to;
    expect(flagged(shown, changed)).toEqual([`${lineOf(changed, marker)}:${key}`]);
  });
});
