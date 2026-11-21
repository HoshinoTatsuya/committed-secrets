import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Пакет — только CLI: программного входа нет, и `exports` закрывает файлы
 * `dist/*` от импорта (гейт не обещает их стабильность). Исполняемый файл
 * запускается по пути из `bin` — карта exports на него не влияет.
 */
const ROOT = join(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  exports: Record<string, string>;
  bin: Record<string, string>;
};

describe('карта exports пакета', () => {
  it('программных входов нет: только package.json', () => {
    expect(manifest.exports).toEqual({ './package.json': './package.json' });
  });

  it('исполняемый файл существует и грузит собранный сканер', () => {
    const bins = Object.values(manifest.bin);
    expect(bins).toHaveLength(1);
    const bin = join(ROOT, bins[0] as string);
    expect(existsSync(bin)).toBe(true);
    expect(readFileSync(bin, 'utf8')).toContain("require('../dist/scanner/cli.js')");
    expect(existsSync(join(ROOT, 'src', 'scanner', 'cli.ts'))).toBe(true);
  });
});
