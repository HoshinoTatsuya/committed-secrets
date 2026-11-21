import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GateBrokenError } from './gate-broken.error';
import { Git } from './git';
import type { IndexEntry } from './index-entry.type';
import type { RepositoryFile } from './repository-files';

/**
 * Файлы выборки — у git: `.env` хоста не в git, и секреты в нём законны.
 * Содержимое читается по одному файлу (рабочее дерево) или потоком блобов
 * (индекс, история): в памяти — один файл, а не репозиторий.
 */
export class RepositorySource {
  /** Записи без текстового содержимого: символическая ссылка, подмодуль. */
  private static readonly NON_CONTENT_MODES: ReadonlySet<string> = new Set(['120000', '160000']);

  /** Пустой блоб/дерево в выводе `--raw`: файла с этой стороны нет. */
  private static readonly NO_OBJECT = /^0+$/u;

  /**
   * Файлы git с содержимым рабочего дерева. `git ls-files` показывает удалённый и
   * ещё не закоммиченный файл: «не смог прочитать» — отдельный ответ, а не повод
   * падать. Символическая ссылка — не содержимое.
   */
  public static async *tracked(root: string): AsyncGenerator<RepositoryFile> {
    for await (const path of Git.records(root, ['ls-files', '-z'])) {
      if (path === '') {
        continue;
      }
      const full = join(root, path);
      let isFile: boolean;
      try {
        isFile = lstatSync(full).isFile();
      } catch {
        continue;
      }
      if (isFile) {
        yield { path, data: readFileSync(full) };
      }
    }
  }

  /** Записи индекса с содержимым (без ссылок и подмодулей). */
  public static async indexEntries(root: string): Promise<IndexEntry[]> {
    const entries: IndexEntry[] = [];
    for await (const record of Git.records(root, ['ls-files', '-s', '-z'])) {
      if (record === '') {
        continue;
      }
      const tab = record.indexOf('\t');
      const [mode = '', sha = ''] = record.slice(0, tab).split(' ');
      if (!RepositorySource.NON_CONTENT_MODES.has(mode)) {
        entries.push({ mode, sha, path: record.slice(tab + 1) });
      }
    }
    return entries;
  }

  /** HEAD или `null`, если коммитов ещё нет. */
  public static head(root: string): string | null {
    const result = Git.run(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], {
      allowFailure: true,
    });
    return result.status === 0 ? result.stdout.toString('utf8').trim() : null;
  }

  /** Пути индекса, изменённые относительно HEAD (добавленные, изменённые, сменившие тип). */
  public static async changedPaths(root: string, head: string): Promise<Set<string>> {
    const paths = new Set<string>();
    for await (const path of Git.records(root, [
      'diff',
      '--cached',
      '--name-only',
      // Пути — относительно каталога запуска и только под ним, как у ls-files:
      // без этого из подкаталога монорепозитория пути шли от корня репозитория и
      // ни один не совпадал с путями индекса — изменённое молча не сканировалось.
      '--relative',
      '-z',
      '--no-renames',
      '--diff-filter=d',
      head,
    ])) {
      if (path !== '') {
        paths.add(path);
      }
    }
    return paths;
  }

  /** Содержимое записей потоком, в порядке записей. */
  public static async *blobsOf(
    root: string,
    entries: readonly (IndexEntry & { readonly commit?: string })[],
  ): AsyncGenerator<RepositoryFile> {
    let index = 0;
    for await (const data of Git.blobs(
      root,
      entries.map(({ sha }) => sha),
    )) {
      const entry = entries[index] as IndexEntry & { readonly commit?: string };
      index += 1;
      if (data === null) {
        throw new GateBrokenError(`git cat-file: нет блоба ${entry.sha} (${entry.path})`);
      }
      yield entry.commit === undefined
        ? { path: entry.path, data }
        : { path: entry.path, data, commit: entry.commit };
    }
  }

  /**
   * Блобы истории: каждый (путь, блоб) — один раз, с коммитом, где он
   * появился. `since` — коммит, после которого смотреть (`since..HEAD`);
   * `null` — все ссылки. Слияния — против первого родителя: правка,
   * сделанная при разрешении конфликта, тоже видна.
   */
  public static async history(
    root: string,
    since: string | null,
  ): Promise<{ commits: number; entries: Array<IndexEntry & { commit: string }> }> {
    if (since !== null) {
      const verified = Git.run(root, ['rev-parse', '--verify', '--quiet', `${since}^{commit}`], {
        allowFailure: true,
      });
      if (verified.status !== 0) {
        throw new GateBrokenError(`--since ${since}: такого коммита нет`);
      }
    }
    const range = since === null ? ['--all'] : [`${since}..HEAD`];
    const entries: Array<IndexEntry & { commit: string }> = [];
    const seen = new Set<string>();
    let commits = 0;
    let commit = '';
    let pending: { mode: string; sha: string } | null = null;
    for await (const raw of Git.records(root, [
      'log',
      ...range,
      '--raw',
      // История каталога запуска, пути от него (как у ls-files и перечня фикстур), а не всего монорепозитория.
      '--relative',
      '-z',
      '--no-renames',
      '--no-abbrev',
      '--diff-merges=first-parent',
      '--diff-filter=AMT',
      '--format=%x01%H',
    ])) {
      const record = raw.replace(/^\n+/u, '');
      if (pending !== null) {
        const key = `${pending.sha}\0${record}`;
        if (!seen.has(key)) {
          seen.add(key);
          entries.push({ ...pending, path: record, commit });
        }
        pending = null;
      } else if (record.startsWith('\u0001')) {
        commit = record.slice(1).trim();
        commits += 1;
      } else if (record.startsWith(':')) {
        const [, mode = '', , sha = ''] = record.slice(1).split(' ');
        pending =
          RepositorySource.NON_CONTENT_MODES.has(mode) || RepositorySource.NO_OBJECT.test(sha)
            ? null
            : { mode, sha };
        if (pending === null) {
          // Путь этой записи пропускается: следующая запись — путь.
          pending = { mode: 'skip', sha: '' };
        }
      }
    }
    return { commits, entries: entries.filter(({ mode }) => mode !== 'skip') };
  }
}
