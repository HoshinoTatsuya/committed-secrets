import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import type { FixtureEntry } from './fixture-entry.type';
import { GateBrokenError } from './gate-broken.error';
import type { GateConfig } from './gate-config.type';
import type { GateOptions } from './gate-options.type';
import { CONFIG_NAME } from './load-config';
import type { RepositoryFile } from './repository-files';
import { RepositorySource } from './repository-source';

/**
 * Что сканирует прогон. `population` — пути, по которым судится порог
 * выборки, когда содержимое читается не всё (хук по изменённому): записи
 * индекса, а не прочитанные файлы. `commits` — число коммитов скана истории.
 */
export class GateFiles {
  public static async select(
    options: GateOptions,
    root: string,
    config: GateConfig,
    fixtures: readonly FixtureEntry[],
  ): Promise<{
    files: AsyncIterable<RepositoryFile> | Iterable<RepositoryFile>;
    population: readonly string[] | null;
    partial: boolean;
    commits: number | null;
    head: string | null;
  }> {
    const head = options.mode === 'paths' ? null : RepositorySource.head(root);
    if (options.mode === 'paths') {
      const explicit = options.paths.map((path) => resolve(path));
      const missing = explicit.filter((path) => !existsSync(path) || !statSync(path).isFile());
      if (missing.length > 0) {
        throw new GateBrokenError(`нет файлов: ${missing.join(', ')}`);
      }
      return {
        // По одному файлу: в памяти — один файл, а не список целиком.
        files: (function* () {
          for (const path of explicit) {
            yield { path, data: readFileSync(path) };
          }
        })(),
        population: null,
        partial: false,
        commits: null,
        head,
      };
    }
    if (options.mode === 'tree') {
      return { files: RepositorySource.tracked(root), population: null, partial: false, commits: null, head };
    }
    if (options.mode === 'history') {
      const { commits, entries } = await RepositorySource.history(root, options.since);
      return {
        files: RepositorySource.blobsOf(root, entries),
        population: null,
        partial: false,
        commits,
        head,
      };
    }
    const entries = await RepositorySource.indexEntries(root);
    if (options.full || head === null) {
      return {
        files: RepositorySource.blobsOf(root, entries),
        population: null,
        partial: false,
        commits: null,
        head,
      };
    }
    // Хук по изменённому: неизменённое уже прошло гейт при своём коммите. Правка
    // самого гейта (конфигурация, перечень, базовая линия) меняет мерило — тогда
    // весь индекс. Файлы перечня фикстур читаются всегда: иначе устаревшая
    // запись была бы неотличима от непрочитанной.
    const changed = await RepositorySource.changedPaths(root, head);
    const gateFiles = [CONFIG_NAME, config.fixturesPath, config.baselinePath].filter(
      (path): path is string => path !== null,
    );
    if (gateFiles.some((path) => changed.has(path))) {
      return {
        files: RepositorySource.blobsOf(root, entries),
        population: null,
        partial: false,
        commits: null,
        head,
      };
    }
    const fixtureFiles = new Set(fixtures.map(({ file }) => file));
    const selected = entries.filter(({ path }) => changed.has(path) || fixtureFiles.has(path));
    return {
      files: RepositorySource.blobsOf(root, selected),
      population: entries.map(({ path }) => path),
      partial: true,
      commits: null,
      head,
    };
  }
}
