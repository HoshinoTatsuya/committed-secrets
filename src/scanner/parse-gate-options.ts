import { GateBrokenError } from './gate-broken.error';
import type { GateOptions } from './gate-options.type';

/**
 * Аргументы гейта. Неизвестный флаг — отказ «не смог проверить»: прежде он
 * читался как путь, и опечатка (`--stagged`) давала «нет файлов» вместо
 * объяснения. Несовместимые режимы — тоже отказ, а не молчаливый выбор одного.
 */
export function parseGateOptions(argv: readonly string[]): GateOptions {
  const paths: string[] = [];
  const flags = new Set<string>();
  const values: Record<string, string> = {};
  const VALUED = ['--since', '--format', '--output'];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    const [name = '', inline] =
      arg.startsWith('--') && arg.includes('=')
        ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
        : [arg, undefined];
    if (VALUED.includes(name)) {
      const value = inline ?? argv[index + 1];
      if (inline === undefined) {
        index += 1;
      }
      if (value === undefined || value === '' || value.startsWith('-')) {
        throw new GateBrokenError(`${name}: нет значения`);
      }
      values[name] = value;
    } else if (['--staged', '--full', '--history', '--write-baseline'].includes(arg)) {
      flags.add(arg);
    } else if (arg.startsWith('-')) {
      throw new GateBrokenError(
        `неизвестный аргумент ${arg}; есть: --staged [--full], --history, --since <коммит>, --format text|json|sarif|gitlab, --output <файл>, --write-baseline`,
      );
    } else {
      paths.push(arg);
    }
  }
  const staged = flags.has('--staged');
  const history = flags.has('--history') || values['--since'] !== undefined;
  if (staged && paths.length > 0) {
    throw new GateBrokenError('--staged проверяет индекс; пути вместе с ним не задаются');
  }
  if (history && (staged || paths.length > 0)) {
    throw new GateBrokenError(
      '--history/--since проверяют историю; --staged и пути вместе с ними не задаются',
    );
  }
  if (flags.has('--full') && !staged) {
    throw new GateBrokenError(
      '--full уточняет --staged (весь индекс, а не изменённое); без --staged он не задаётся',
    );
  }
  if (flags.has('--write-baseline') && (staged || paths.length > 0 || history)) {
    throw new GateBrokenError(
      '--write-baseline пишет базовую линию по файлам рабочего дерева; с --staged, --history/--since и путями он не задаётся',
    );
  }
  const format = values['--format'] ?? 'text';
  if (format !== 'text' && format !== 'json' && format !== 'sarif' && format !== 'gitlab') {
    throw new GateBrokenError(`--format ${format}: есть text, json, sarif, gitlab`);
  }
  return {
    mode: staged ? 'staged' : history ? 'history' : paths.length > 0 ? 'paths' : 'tree',
    paths,
    full: flags.has('--full'),
    since: values['--since'] ?? null,
    format,
    output: values['--output'] ?? null,
    writeBaseline: flags.has('--write-baseline'),
  };
}
