/** Находка в тексте файла — без значения в отчёте. */
export interface Finding {
  /** Ключ перечня фикстур и базовой линии: имя ключа, флаг команды, `PEM`, `токен <вид>`. */
  readonly key: string;
  /** Правило (`RULE_CATALOG`): идентификатор для SARIF и GitLab. */
  readonly rule: string;
  readonly line: number;
  /** Описание без значения: `POSTGRES_PASSWORD — литерал длиной 13`. */
  readonly description: string;
  /** Строка отчёта: `  путь:строка  описание`. */
  readonly report: string;
  /**
   * Значение — ТОЛЬКО для отпечатка. Функция, а не поле: `JSON.stringify`
   * находки его не выведет, а форматы отчёта строятся явным перечнем полей.
   */
  readonly secret: () => string;
}
