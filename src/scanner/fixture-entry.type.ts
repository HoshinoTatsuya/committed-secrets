/** Запись перечня фикстур: файл, ключи и сколько находок КАЖДОГО ключа она освобождает. */
export interface FixtureEntry {
  readonly file: string;
  readonly keys: readonly string[];
  readonly count: number;
}
