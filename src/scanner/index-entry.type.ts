/** Запись индекса или дерева git с содержимым: режим, блоб, путь. */
export interface IndexEntry {
  readonly mode: string;
  readonly sha: string;
  readonly path: string;
}
