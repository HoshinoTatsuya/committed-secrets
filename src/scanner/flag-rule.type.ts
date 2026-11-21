/**
 * Правило флага команды. Режимы значения:
 *  - `password` — пароль любой длины (`redis-cli -a abc`);
 *  - `userpass` — «логин:пароль» (`curl -u`), секрет — пароль;
 *  - `header` — заголовок HTTP (`curl -H "Authorization: Bearer …"`);
 *  - `opensslpass` — `pass:…` OpenSSL (`env:`/`file:` — не литерал);
 *  - `secret` — литерал от порога длины (длинные флаги любой команды).
 */
export interface FlagRule {
  readonly mode: 'password' | 'userpass' | 'header' | 'opensslpass' | 'secret';
  /** Значение — следующим словом (`-a pass`). */
  readonly separate: boolean;
  /** Значение — слитно (`-ppass`, `-uuser:pass`). */
  readonly glued: boolean;
  /** Разделитель логина и пароля для `userpass`. */
  readonly separator?: string;
}
