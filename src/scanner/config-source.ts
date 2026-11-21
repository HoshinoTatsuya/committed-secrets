import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { Git } from './git';

/**
 * Откуда гейт читает свои файлы (конфигурацию, перечень фикстур, базовую
 * линию): из рабочего дерева или из ИНДЕКСА. Хук `--staged` судит то, что
 * уйдёт в коммит, — и мерилом обязан быть закоммичиваемый же перечень:
 * запись фикстуры, добавленная на диск и не добавленная в индекс, не
 * освобождает находку коммита.
 */
export class ConfigSource {
  public constructor(
    public readonly root: string,
    public readonly fromIndex: boolean,
  ) {}

  /** Где искали — для текста отказа. */
  public where(path: string): string {
    return this.fromIndex ? `${path} в индексе` : join(this.root, path);
  }

  /** Содержимое файла или `null`, если его нет. */
  public read(path: string): string | null {
    if (!this.fromIndex) {
      const full = join(this.root, path);
      if (!existsSync(full) || !statSync(full).isFile()) {
        return null;
      }
      return readFileSync(full, 'utf8');
    }
    // `:./путь` — путь относительно каталога запуска, а не корня репозитория.
    const found = Git.run(this.root, ['rev-parse', '--verify', '--quiet', `:./${path}`], {
      allowFailure: true,
    });
    if (found.status !== 0) {
      return null;
    }
    return Git.run(this.root, ['cat-file', 'blob', found.stdout.toString('utf8').trim()]).stdout.toString(
      'utf8',
    );
  }
}
