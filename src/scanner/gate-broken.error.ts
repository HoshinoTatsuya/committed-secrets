/** Гейт не смог проверить: причина — текст, код выхода 2. */
export class GateBrokenError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = GateBrokenError.name;
  }
}
