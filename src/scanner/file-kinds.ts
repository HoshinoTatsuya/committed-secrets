import type { FileKind } from './file-kind.type';
import { pathSuffix } from './path-suffix';
import { CONFIG_SUFFIXES } from './secret-rules';

/** Класс файла по имени. */
export class FileKinds {
  /** Файлы конфигурации без расширения конфигурации: профили оболочки, учётные файлы клиентов. */
  public static readonly CONFIG_NAMES: ReadonlySet<string> = new Set([
    '.bashrc',
    '.bash_profile',
    '.bash_login',
    '.profile',
    '.zshrc',
    '.zshenv',
    '.zprofile',
    '.kshrc',
    '.envrc',
    '.netrc',
    '_netrc',
    '.pgpass',
    '.my.cnf',
    '.git-credentials',
    '.pypirc',
    '.s3cfg',
  ]);

  public static of(path: string): FileKind {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const suffix = pathSuffix(path);
    const config =
      CONFIG_SUFFIXES.some((ending) => name.endsWith(ending)) ||
      FileKinds.CONFIG_NAMES.has(name) ||
      name.startsWith('.env') ||
      // `prod.env.example`, `app.env.local`: файл окружения с суффиксом варианта.
      /(?:^|\.)env\.(?:example|sample|template|tpl|dist|defaults?|local|dev|development|test|staging|stage|prod|production)$/u.test(
        name,
      ) ||
      name.startsWith('Dockerfile') ||
      name.endsWith('.Dockerfile') ||
      suffix === '.cnf' ||
      !name.includes('.');
    return {
      config,
      markdown: suffix === '.md',
      yaml: suffix === '.yml' || suffix === '.yaml' || !name.includes('.'),
      directives: suffix === '.conf',
      netrc: name === '.netrc' || name === '_netrc',
      pgpass: name === '.pgpass',
    };
  }
}
