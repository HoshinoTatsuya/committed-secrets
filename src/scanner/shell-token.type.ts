/** Слово команды: текст без кавычек; `literal` — без подстановок оболочки (`$`, обратные кавычки). */
export interface ShellToken {
  readonly text: string;
  readonly literal: boolean;
}
