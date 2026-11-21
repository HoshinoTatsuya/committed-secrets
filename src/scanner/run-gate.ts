import { writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

import { Baseline } from './baseline';
import { ConfigSource } from './config-source';
import { EXIT_CODE } from './exit-code.constant';
import type { Finding } from './finding.type';
import { fingerprintOf } from './fingerprint';
import { loadFixtures } from './fixture-list';
import { GateBrokenError } from './gate-broken.error';
import { GateFiles } from './gate-files';
import { loadConfig } from './load-config';
import { parseGateOptions } from './parse-gate-options';
import { pathSuffix } from './path-suffix';
import { ReportFormats } from './report-formats';
import type { ReportedFinding } from './reported-finding.type';
import { scanText } from './scan-text';
import { BUILT_IN_PLACEHOLDERS } from './secret-rules';
import { textOf } from './text-of';
import { valueText } from './value-text';

/** Куда пишет гейт: stdout — итог, stderr — отказы. */
export interface GateOutput {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/**
 * Гейт «в закоммиченных файлах нет литеральных секретов». Аргументы: без
 * них — файлы git в рабочем дереве; `--staged` — изменённое в индексе
 * (`--full` — весь индекс); `--history`/`--since <коммит>` — блобы истории;
 * пути — только они, без перечня фикстур. Код выхода — `EXIT_CODE`. Значение
 * секрета не выводится НИГДЕ: ни в тексте, ни в машинных форматах.
 */
export async function runGate(argv: readonly string[], root: string, output: GateOutput): Promise<number> {
  try {
    return await judge(argv, root, output);
  } catch (error) {
    output.err(
      `ОТКАЗ (гейт не смог проверить): ${error instanceof Error ? error.message : valueText(error)}`,
    );
    return EXIT_CODE.broken;
  }
}

const kindOf = (path: string): string =>
  path.slice(path.lastIndexOf('/') + 1) === '.env.example' ? '.env.example' : pathSuffix(path);

async function judge(argv: readonly string[], root: string, output: GateOutput): Promise<number> {
  const startedAt = new Date();
  const options = parseGateOptions(argv);
  const source = new ConfigSource(root, options.mode === 'staged');
  const config = loadConfig(source);
  const placeholders = new Set([
    ...BUILT_IN_PLACEHOLDERS,
    ...config.extraPlaceholders.map((item) => item.toLowerCase()),
  ]);
  const explicit = options.mode === 'paths';
  const fixtures = explicit ? { entries: [], problems: [] } : loadFixtures(source, config);
  const baseline =
    config.baselinePath !== null && !explicit && !options.writeBaseline
      ? Baseline.load(source, config.baselinePath)
      : null;
  const selection = await GateFiles.select(options, root, config, fixtures.entries);

  const collected: Array<{ shown: string; commit: string | null; finding: Finding }> = [];
  const scanned = new Set<string>();
  let blobs = 0;
  for await (const file of selection.files) {
    const text = textOf(file.data);
    if (text === null) {
      continue;
    }
    const inside = isAbsolute(file.path) ? relative(root, file.path) : file.path;
    const shown =
      isAbsolute(file.path) && (inside.startsWith('..') || isAbsolute(inside)) ? file.path : inside;
    scanned.add(shown);
    blobs += 1;
    for (const finding of scanText(shown, text, placeholders)) {
      collected.push({ shown, commit: file.commit ?? null, finding });
    }
  }

  // «Нарушений ноль» неотличимо от «файлов не найдено».
  if (options.mode === 'history') {
    if (selection.commits === 0) {
      throw new GateBrokenError(
        `в диапазоне истории нет коммитов${options.since === null ? '' : ` после ${options.since}`} — выборка выродилась.`,
      );
    }
  } else if (!explicit) {
    const population = selection.population ?? [...scanned];
    const kinds = new Set(population.map(kindOf));
    const missingKinds = config.requiredKinds.filter((kind) => !kinds.has(kind));
    if (population.length < config.minFiles || missingKinds.length > 0) {
      throw new GateBrokenError(
        `гейт просмотрел ${population.length} ${selection.partial ? 'записей индекса' : 'текстовых файлов'} (нужно от ${config.minFiles}), нет классов: ` +
          `${missingKinds.join(', ') || '—'} — выборка выродилась.`,
      );
    }
  }

  // Перечень фикстур: запись освобождает `count` находок каждого ключа, по порядку строк.
  const allowed = new Map<string, number>();
  for (const { file, keys, count } of fixtures.entries) {
    for (const key of keys) {
      const pair = `${file}\0${key}`;
      allowed.set(pair, (allowed.get(pair) ?? 0) + count);
    }
  }
  const freed = new Map<string, number>();
  const remaining: typeof collected = [];
  for (const item of collected) {
    const pair = `${item.shown}\0${item.finding.key}`;
    const limit = allowed.get(pair) ?? 0;
    // В истории файл встречается многими блобами: запись освобождает ключ файла целиком.
    if (limit > 0 && (options.mode === 'history' || (freed.get(pair) ?? 0) < limit)) {
      freed.set(pair, (freed.get(pair) ?? 0) + 1);
    } else {
      remaining.push(item);
    }
  }
  const problems = [...fixtures.problems];
  if (options.mode !== 'history') {
    for (const [pair, limit] of [...allowed].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const used = freed.get(pair) ?? 0;
      if (used < limit) {
        const [file, key] = pair.split('\0');
        problems.push(
          used === 0
            ? `  ${file} · ${key}: в файле такой находки нет — запись устарела`
            : `  ${file} · ${key}: находок ${used}, запись освобождает ${limit} — запись устарела`,
        );
      }
    }
  }

  const needFingerprints = baseline !== null || options.writeBaseline || options.format !== 'text';
  const reported: ReportedFinding[] = remaining.map(({ shown, commit, finding }) => ({
    file: shown,
    line: finding.line,
    commit,
    key: finding.key,
    rule: finding.rule,
    description: finding.description,
    fingerprint: needFingerprints ? fingerprintOf(shown, finding.key, finding.secret()) : '',
  }));
  const reports = remaining.map(({ commit, finding }) =>
    commit === null ? finding.report : `${finding.report} (коммит ${commit.slice(0, 12)})`,
  );

  if (options.writeBaseline) {
    const path = config.baselinePath;
    if (path === null) {
      throw new GateBrokenError('--write-baseline: в committed-secrets.json нет baselinePath');
    }
    writeFileSync(join(root, path), Baseline.serialize(reported));
    output.out(
      `Базовая линия записана: ${path}, записей ${reported.length}. Значений в ней нет — только отпечатки.`,
    );
    return EXIT_CODE.clean;
  }

  // Базовая линия: принятые находки (по отпечатку) — не отказ.
  let accepted = 0;
  const fresh: ReportedFinding[] = [];
  const freshReports: string[] = [];
  const left = new Map(baseline ?? []);
  reported.forEach((finding, index) => {
    const key = Baseline.keyOf(finding.file, finding.key, finding.fingerprint);
    const count = left.get(key) ?? 0;
    if (count > 0) {
      left.set(key, count - 1);
      accepted += 1;
    } else {
      fresh.push(finding);
      freshReports.push(reports[index] as string);
    }
  });
  const staleBaseline = [...left.values()].reduce((sum, count) => sum + count, 0);

  const machine = options.format !== 'text';
  if (machine) {
    const document = ReportFormats.render(options.format as 'json' | 'sarif' | 'gitlab', {
      findings: fresh,
      version: ReportFormats.version(),
      head: selection.head,
      startedAt,
      finishedAt: new Date(),
    });
    if (options.output === null) {
      output.out(document.trimEnd());
    } else {
      writeFileSync(isAbsolute(options.output) ? options.output : join(root, options.output), document);
    }
  }
  // Итог — в stderr, когда stdout занят документом машинного формата.
  const summary = machine && options.output === null ? output.err : output.out;

  if (problems.length > 0) {
    output.err(`ОТКАЗ: перечень фикстур ${config.fixturesPath}:`);
    output.err(problems.join('\n'));
    return EXIT_CODE.findings;
  }
  if (fresh.length > 0) {
    output.err('ОТКАЗ: в закоммиченных файлах литеральные секреты.');
    output.err('Значение, попавшее в git, скомпрометировано — ротируйте его, а в файле');
    output.err('оставьте подстановку (переменная окружения, хранилище секретов).');
    output.err(freshReports.join('\n'));
    return EXIT_CODE.findings;
  }
  const what =
    options.mode === 'history'
      ? `просмотрено коммитов: ${selection.commits ?? 0}, блобов: ${blobs}`
      : selection.partial
        ? `в индексе файлов: ${selection.population?.length ?? 0}, проверено изменённых: ${scanned.size}`
        : `просмотрено текстовых файлов: ${scanned.size}`;
  const baselineNote =
    baseline === null
      ? ''
      : `, по базовой линии: ${accepted}${
          staleBaseline > 0 && !selection.partial
            ? ` (записей без находки: ${staleBaseline} — линию можно обновить: --write-baseline)`
            : ''
        }`;
  summary(
    `Литеральных секретов нет, ${what}, фикстур по перечню: ${[...freed.values()].reduce((a, b) => a + b, 0)}${baselineNote}`,
  );
  return EXIT_CODE.clean;
}
