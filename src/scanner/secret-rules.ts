/**
 * Правила распознавания — те же, что у прежней реализации на Python, перенесены
 * один к одному и сверены на корпусе (см. README). `\w` у Python Юникодный:
 * здесь — `[\p{L}\p{N}\p{M}_]` с флагом `u`.
 */
const W = String.raw`\p{L}\p{N}\p{M}_`;

/** Короче — не ловим: `true`, `secret`, `none` и короткие ключи настроек дали бы шум. */
export const MIN_SECRET_LENGTH = 8;

export const SECRET_WORDS: ReadonlySet<string> = new Set([
  'password',
  'passwd',
  'pass',
  'passphrase',
  'secret',
  'token',
  'credential',
  'credentials',
  'apikey',
  'privatekey',
  // С 0.5.0: сокращения пароля (одним словом — `PWD` оболочки — не секрет, см. isSecretKey)
  // и директивы Redis, склеенные из слов.
  'pwd',
  'pw',
  'requirepass',
  'masterauth',
]);
export const SECRET_PAIRS: ReadonlySet<string> = new Set([
  'api key',
  'access key',
  'private key',
  'auth key',
  // С 0.5.0: ключи шифрования и подписи (`ENCRYPTION_KEY`, `SIGNING_KEY`, `RAILS_MASTER_KEY`).
  'encryption key',
  'signing key',
  'master key',
  'hmac key',
  'jwt key',
  'session key',
  'cipher key',
  'crypto key',
  'license key',
  'app key',
  'account key',
  'shared key',
  'deploy key',
  'aes key',
]);

/** Последнее слово ключа, при котором значение — описание секрета, а не он сам. Список закрытый. */
export const METADATA_LAST_WORDS: ReadonlySet<string> = new Set([
  'name',
  'names',
  'ref',
  'file',
  'path',
  'dir',
  'env',
  'var',
  'header',
  'field',
  'length',
  'ttl',
  'ms',
  'sec',
  'url',
  'type',
  'kind',
  'mode',
  'policy',
  'prefix',
  'count',
  'tests',
  'enabled',
  'required',
  'pattern',
  // `--password-stdin`, `PASSWORD_STDIN`: способ передачи, а не значение.
  'stdin',
]);

/** Заглушки — ПОЛНОЕ совпадение без учёта регистра. Заглушки проекта — `extraPlaceholders`. */
export const BUILT_IN_PLACEHOLDERS: readonly string[] = [
  'changeme',
  'placeholder',
  'example',
  'redacted',
  'password',
  'secret',
  'token',
  'undefined',
  'your-token',
  'your-password',
];
export const URL_PLACEHOLDERS: ReadonlySet<string> = new Set(['pass', 'pwd', 'pw', 'user', 'password']);
export const PLACEHOLDER_SHAPE = /^(<[^<>]+>|x{3,}|\*{3,}|\.{3,}|…)$/iu;
export const REFERENCE_PATH = new RegExp(
  String.raw`^[${W}$]*(?:\.[${W}$]+)*\.(?<last>[A-Za-z_][${W}]*)$`,
  'u',
);
export const FILE_PATH = new RegExp(String.raw`^(?:/[${W}.-]+/|\./|\.\./|~/)[${W}./-]*$`, 'u');
/** Описание словами через `-`/`_`, допускается суффикс версии (`team-secret-bookmarks-v1`). */
export const DESCRIBED = /^[a-z]+(?:[-_][a-z]+)+(?:[-_]v\d+)?$/u;
export const DESCRIBED_CAMEL = /^[a-z]+(?:[A-Z][a-z]+)+$/u;
export const ENV_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/u;

/** Ключ — не продолжение слова и не имя внутри подстановки (`${TOKEN:?…}`, `$TOKEN`, `env.TOKEN`). */
const KEY = String.raw`(?<![${W}\${.-])(?<key>[A-Za-z_][A-Za-z0-9_.-]*)`;
/** Код: значение — строковый литерал, ключ может стоять в кавычках (JSON). */
/** Обратная кавычка: в режиме `u` экранировать её в регулярке нельзя. */
const BT = '`';
export const CODE_ASSIGN = new RegExp(
  // С 0.3.0 и с аннотацией типа: `apiKey: string = '…'`, `password: str = "…"`.
  // С 0.6.0 кавычка, экранированная обратной чертой (`"a\"b"`), — часть значения, а не его конец.
  String.raw`(?<kq>["'${BT}]?)${KEY}\k<kq>\s*(?::\s*[A-Za-z_][\w.<>\[\]|, ]*?\s*=|:=|=>|:|=)\s*(?:"(?<dq>(?:[^"\\\n]|\\.)*)"|'(?<sq>(?:[^'\\\n]|\\.)*)'|${BT}(?<bq>(?:[^${BT}\\\n]|\\.)*)${BT})`,
  'gu',
);
/**
 * Конфигурация: то же плюс значение без кавычек до пробела или `,`; `#` — конец
 * значения только в начале слова (`KEY=abc#123` в .env и YAML — значение
 * `abc#123`, комментарий начинается с ` #`). В двойных кавычках `\"` — часть
 * значения, в одинарных YAML — `''`. Тег
 * ядра YAML (`!!str`) — не значение; локальный тег (`!Ref` CloudFormation) —
 * выражение, остаётся значением и молчит. Значение SOPS `ENC[…]` — целиком, с
 * запятыми.
 */
export const CONFIG_ASSIGN = new RegExp(
  String.raw`(?<kq>["']?)${KEY}\k<kq>\s*(?::|=)[ \t]*(?:!![A-Za-z]+[ \t]+)?(?:(?<enc>ENC\[[^\]\n]*\])|"(?<dq>(?:[^"\\\n]|\\.)*)"|'(?<sq>(?:[^'\n]|'')*)'|(?<bare>[^\s"'#,;][^\s"',;]*))`,
  'gu',
);
export const URL_PASSWORD = new RegExp(
  String.raw`\b[a-z][a-z0-9+.-]*://[^\s:/@'"${BT}]*:(?<val>[^\s/@'"${BT}]+)@`,
  'giu',
);
export const PEM_PRIVATE = /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/u;
/** Значение по умолчанию подстановки: `${VAR:-x}`, `${VAR-x}`, `${VAR:=x}`. */
export const SUBST_DEFAULT = /\$\{[A-Za-z_][A-Za-z0-9_]*:?[-=]([^}]*)\}/gu;

export const CONFIG_SUFFIXES: readonly string[] = [
  '.env',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.conf',
  '.cfg',
  '.properties',
  '.sh',
  '.npmrc',
];
