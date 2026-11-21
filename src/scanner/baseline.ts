import type { ConfigSource } from './config-source';
import { GateBrokenError } from './gate-broken.error';
import { readJson } from './read-json';
import type { ReportedFinding } from './reported-finding.type';

/**
 * Базовая линия — принятые находки ОТПЕЧАТКАМИ (файл, ключ, отпечаток
 * значения): гейт включается в репозитории с историей и падает только на
 * НОВЫХ находках. Значений в файле нет. Запись без находки — не отказ (линия
 * для того и есть, чтобы убывать), но о ней говорится.
 */
export class Baseline {
  public static readonly VERSION = 1;

  /** Ключ записи: файл, ключ находки, отпечаток. */
  public static keyOf(file: string, key: string, fingerprint: string): string {
    return `${file}\0${key}\0${fingerprint}`;
  }

  /** Записи линии со счётом (одинаковые значения под одним ключом — несколько записей). */
  public static load(source: ConfigSource, path: string): Map<string, number> {
    const document = readJson(source, path);
    const findings = (document as { version?: unknown; findings?: unknown } | null)?.findings;
    if (
      typeof document !== 'object' ||
      document === null ||
      (document as { version?: unknown }).version !== Baseline.VERSION ||
      !Array.isArray(findings)
    ) {
      throw new GateBrokenError(
        `${path}: ожидалась базовая линия { "version": ${Baseline.VERSION}, "findings": [...] }`,
      );
    }
    const entries = new Map<string, number>();
    findings.forEach((entry: unknown, index) => {
      const record = entry as { file?: unknown; key?: unknown; fingerprint?: unknown } | null;
      if (
        typeof record?.file !== 'string' ||
        typeof record.key !== 'string' ||
        typeof record.fingerprint !== 'string' ||
        !/^[0-9a-f]{32}$/u.test(record.fingerprint)
      ) {
        throw new GateBrokenError(`${path}: запись #${index} — не { file, key, fingerprint }`);
      }
      const key = Baseline.keyOf(record.file, record.key, record.fingerprint);
      entries.set(key, (entries.get(key) ?? 0) + 1);
    });
    return entries;
  }

  /** Текст файла линии: записи отсортированы — дифф правки линии читается. */
  public static serialize(findings: readonly ReportedFinding[]): string {
    const entries = findings
      .map(({ file, key, fingerprint }) => ({ file, key, fingerprint }))
      .map((entry) => ({ entry, order: Baseline.keyOf(entry.file, entry.key, entry.fingerprint) }))
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
      .map(({ entry }) => entry);
    return `${JSON.stringify({ version: Baseline.VERSION, findings: entries }, null, 2)}\n`;
  }
}
