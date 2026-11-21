import type { ConfigSource } from './config-source';
import { GateBrokenError } from './gate-broken.error';

/** JSON файла или отказ «не смог проверить» с путём — не трассировка. */
export function readJson(source: ConfigSource, path: string): unknown {
  const text = source.read(path);
  if (text === null) {
    throw new GateBrokenError(`нет файла ${source.where(path)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new GateBrokenError(
      `${source.where(path)} не разбирается как JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
