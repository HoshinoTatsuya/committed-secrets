/** Находка в отчёте: без значения; отпечаток — для базовой линии и отслеживания в MR. */
export interface ReportedFinding {
  readonly file: string;
  readonly line: number;
  /** Коммит, где блоб появился (скан истории), иначе `null`. */
  readonly commit: string | null;
  readonly key: string;
  readonly rule: string;
  readonly description: string;
  readonly fingerprint: string;
}
