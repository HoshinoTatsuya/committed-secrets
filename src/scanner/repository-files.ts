/** Файл выборки: путь относительно корня, содержимое и коммит (скан истории). */
export interface RepositoryFile {
  readonly path: string;
  readonly data: Buffer;
  readonly commit?: string;
}
