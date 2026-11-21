import type { ConfigSource } from './config-source';
import { GateBrokenError } from './gate-broken.error';
import type { GateConfig } from './gate-config.type';
import { readJson } from './read-json';

export const CONFIG_NAME = 'committed-secrets.json';

/**
 * Конфигурация проекта. Каждое поле проверяется по типу: строка `"1,500"`
 * в `minFiles` прежде превращалась в `NaN`, и порог выборки молча выключался;
 * неизвестный ключ (опечатка `extraPlaceholder`) молча не действовал.
 */
export function loadConfig(source: ConfigSource): GateConfig {
  if (source.read(CONFIG_NAME) === null) {
    throw new GateBrokenError(
      `нет ${CONFIG_NAME} в ${source.fromIndex ? 'индексе' : source.root} — порог выборки, классы файлов и перечень фикстур задаёт проект.`,
    );
  }
  const config = readJson(source, CONFIG_NAME);
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new GateBrokenError(`${CONFIG_NAME}: ожидался объект`);
  }
  const record = config as Record<string, unknown>;
  const required = ['minFiles', 'requiredKinds', 'fixturesPath', 'deliveryPattern', 'serviceCodeRoot'];
  const missing = required.filter((key) => !(key in record));
  if (missing.length > 0) {
    throw new GateBrokenError(`в ${CONFIG_NAME} нет ключей: ${missing.join(', ')}`);
  }
  const known = new Set([
    ...required,
    'extraPlaceholders',
    'testCodePatterns',
    'baselinePath',
    '$schema',
    '$comment',
  ]);
  const unknown = Object.keys(record).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new GateBrokenError(`в ${CONFIG_NAME} неизвестные ключи: ${unknown.join(', ')}`);
  }
  const { minFiles } = record;
  if (typeof minFiles !== 'number' || !Number.isSafeInteger(minFiles) || minFiles < 0) {
    throw new GateBrokenError(
      `${CONFIG_NAME}: minFiles — целое число от 0, а не ${JSON.stringify(minFiles)}`,
    );
  }
  const strings = (key: string, value: unknown): string[] => {
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item !== '')) {
      throw new GateBrokenError(`${CONFIG_NAME}: ${key} — список непустых строк`);
    }
    return value as string[];
  };
  const text = (key: string): string => {
    const value = record[key];
    if (typeof value !== 'string' || value === '') {
      throw new GateBrokenError(`${CONFIG_NAME}: ${key} — непустая строка`);
    }
    return value;
  };
  // Флаги — те же, с которыми выражение применяется.
  const pattern = (key: string, value: string, flags: string): string => {
    try {
      new RegExp(value, flags);
    } catch (error) {
      throw new GateBrokenError(
        `${CONFIG_NAME}: ${key} — не регулярное выражение: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return value;
  };
  const baselinePath = record.baselinePath ?? null;
  if (baselinePath !== null && (typeof baselinePath !== 'string' || baselinePath === '')) {
    throw new GateBrokenError(`${CONFIG_NAME}: baselinePath — непустая строка`);
  }
  return {
    minFiles,
    requiredKinds: strings('requiredKinds', record.requiredKinds),
    fixturesPath: text('fixturesPath'),
    deliveryPattern: pattern('deliveryPattern', text('deliveryPattern'), 'y'),
    serviceCodeRoot: text('serviceCodeRoot'),
    extraPlaceholders: strings('extraPlaceholders', record.extraPlaceholders ?? []),
    testCodePatterns: strings('testCodePatterns', record.testCodePatterns ?? ['spec\\.ts$', '/testing/']).map(
      (item) => pattern('testCodePatterns', item, 'u'),
    ),
    baselinePath,
  };
}
