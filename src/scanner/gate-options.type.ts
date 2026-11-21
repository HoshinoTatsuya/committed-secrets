/** Разобранные аргументы гейта. */
export interface GateOptions {
  /** `tree` — файлы git в рабочем дереве (CI); `staged` — индекс (хук); `paths` — явные пути; `history` — блобы истории. */
  readonly mode: 'tree' | 'staged' | 'paths' | 'history';
  readonly paths: readonly string[];
  /** `--staged --full`: весь индекс, а не только изменённое относительно HEAD. */
  readonly full: boolean;
  /** `--since <коммит>`: история от коммита (не включая его) до HEAD; `null` — вся история. */
  readonly since: string | null;
  readonly format: 'text' | 'json' | 'sarif' | 'gitlab';
  /** Файл отчёта машинного формата; `null` — stdout. */
  readonly output: string | null;
  readonly writeBaseline: boolean;
}
