/** Класс файла: какие формы в нём искать. */
export interface FileKind {
  /** Значение без кавычек — секрет (.env, YAML, shell, Dockerfile…). */
  readonly config: boolean;
  readonly markdown: boolean;
  /** Структура YAML: блоки `|`, списки, `name`/`value`, `encryptedData`. */
  readonly yaml: boolean;
  /** Директива и значение через пробел (`requirepass …` redis.conf). */
  readonly directives: boolean;
  /** `.netrc`: `machine … login … password …`. */
  readonly netrc: boolean;
  /** `.pgpass`: `хост:порт:база:пользователь:пароль`. */
  readonly pgpass: boolean;
}
