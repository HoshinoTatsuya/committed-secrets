import type { ConfigSource } from './config-source';
import type { FixtureEntry } from './fixture-entry.type';
import { GateBrokenError } from './gate-broken.error';
import type { GateConfig } from './gate-config.type';
import { readJson } from './read-json';

/** Причина записи перечня фикстур короче — не причина. */
export const MIN_REASON_LENGTH = 40;

/**
 * Файл поставки и код сервиса: секрет в них — секрет прода, перечень фикстур
 * их не освобождает. Код сервиса — под `serviceCodeRoot`, кроме спек и
 * обвязки тестов (`testCodePatterns`, по умолчанию `spec\.ts$` и `/testing/`).
 */
export function isDeliveryFile(path: string, config: GateConfig): boolean {
  // `re.match` Python: совпадение с начала строки, а не где угодно.
  const delivery = new RegExp(config.deliveryPattern, 'y');
  if (delivery.test(path)) {
    return true;
  }
  return (
    path.startsWith(config.serviceCodeRoot) &&
    !config.testCodePatterns.some((pattern) => new RegExp(pattern, 'u').test(path))
  );
}

/**
 * Записи перечня и нарушения самого перечня. Запись освобождает `count`
 * находок каждого своего ключа (по умолчанию одну): с 0.5.0 запись — про
 * КОНКРЕТНЫЕ находки, и второй секрет под тем же ключом в том же файле —
 * снова находка, а не «уже разрешено».
 */
export function loadFixtures(
  source: ConfigSource,
  config: GateConfig,
): { entries: FixtureEntry[]; problems: string[] } {
  const list = readJson(source, config.fixturesPath);
  if (!Array.isArray(list)) {
    throw new GateBrokenError(`${config.fixturesPath}: ожидался список записей`);
  }
  const entries: FixtureEntry[] = [];
  const problems: string[] = [];
  list.forEach((entry: unknown, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      problems.push(`  #${index}: запись — не объект`);
      return;
    }
    const record = entry as { file?: unknown; keys?: unknown; reason?: unknown; count?: unknown };
    if (typeof record.file !== 'string' || record.file === '') {
      problems.push(`  #${index}: file — не непустая строка`);
      return;
    }
    const { file } = record;
    const keys = Array.isArray(record.keys) ? (record.keys as unknown[]) : [];
    const reason = typeof record.reason === 'string' ? record.reason : '';
    if (isDeliveryFile(file, config)) {
      problems.push(
        `  #${index} ${file}: файл поставки или код сервиса — перечень фикстур его не освобождает`,
      );
    }
    if (keys.length === 0) {
      problems.push(`  #${index} ${file}: пустой список ключей`);
    } else if (!keys.every((key) => typeof key === 'string' && key !== '')) {
      problems.push(`  #${index} ${file}: ключ — не непустая строка`);
    }
    if ([...reason.trim()].length < MIN_REASON_LENGTH) {
      problems.push(`  #${index} ${file}: причина короче ${MIN_REASON_LENGTH} знаков`);
    }
    const count = record.count ?? 1;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) {
      problems.push(`  #${index} ${file}: count — целое число от 1, а не ${JSON.stringify(count)}`);
    }
    entries.push({
      file,
      keys: keys.map(String),
      count: typeof count === 'number' && count >= 1 ? count : 1,
    });
  });
  return { entries, problems };
}
