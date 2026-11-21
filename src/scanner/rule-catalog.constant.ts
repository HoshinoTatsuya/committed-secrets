/** Правила находок: идентификатор → краткое описание (SARIF `rules`, GitLab `identifiers`). */
export const RULE_CATALOG: Readonly<Record<string, string>> = Object.freeze({
  'key-literal': 'Литерал под ключом, который называет секрет',
  'fallback-literal': 'Литерал по умолчанию под секретным ключом или переменной',
  'command-flag': 'Секрет во флаге или присваивании командной строки',
  'url-password': 'Пароль в адресе',
  'private-key': 'Закрытый ключ PEM или PGP',
  'base64-private-key': 'Закрытый ключ PEM в base64',
  'base64-credentials': 'Логин и пароль в base64',
});
