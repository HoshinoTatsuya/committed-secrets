import { METADATA_LAST_WORDS, SECRET_PAIRS, SECRET_WORDS } from './secret-rules';

/** Слова имени ключа: разбиение по `_ . -` и границам camelCase. */
export function wordsOf(key: string): string[] {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return spaced
    .split(/[\s_.-]+/u)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());
}

/**
 * Слова называют секрет: слово словаря, пара слов (`api key`) или имя,
 * склеенное без разделителя (`PGPASSWORD`, `accesstoken`, `clientsecret`).
 * `pwd`/`pw` одни — не секрет: `PWD` оболочки — текущий каталог.
 */
export function namesSecret(words: readonly string[]): boolean {
  return (
    words.some(
      (word) =>
        (SECRET_WORDS.has(word) && !(words.length === 1 && (word === 'pwd' || word === 'pw'))) ||
        ['password', 'passwd', 'passphrase', 'secret', 'token'].some(
          (tail) => word.length > tail.length && word.endsWith(tail),
        ),
    ) || words.slice(1).some((word, index) => SECRET_PAIRS.has(`${words[index]} ${word}`))
  );
}

/**
 * Имя ключа называет секрет. `auth` — только последним словом имени
 * переменной окружения (`REDISCLI_AUTH`, `BASIC_AUTH`): в коде слово давало
 * шум (`IClientAuth: 'interface'`). `_auth` `.npmrc` — base64 логина и пароля.
 */
export function isSecretKey(key: string): boolean {
  if (key === '_auth') {
    return true;
  }
  const words = wordsOf(key);
  const last = words.at(-1);
  if (last === undefined || METADATA_LAST_WORDS.has(last)) {
    return false;
  }
  if (last === 'auth' && words.length > 1 && /^[A-Z][A-Z0-9_]*$/u.test(key)) {
    return true;
  }
  return namesSecret(words);
}
