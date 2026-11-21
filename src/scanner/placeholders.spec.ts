import { GateHarness } from '../testing/gate-harness';
import { BUILT_IN_PLACEHOLDERS, URL_PLACEHOLDERS } from './secret-rules';

/**
 * Заглушки молчат — иначе гейт шумит на `changeme` и `<password>`, и его
 * отключают. Каждая встроенная заглушка проверяется сама по себе (мутант,
 * снявший одну, краснеет), и рядом — то же значение с хвостом: заглушка —
 * полное совпадение, а не префикс.
 */
/** Список — свой, а не импорт модуля: мутант, снявший заглушку, снял бы и её проверку. */
const BUILT_IN = [
  'changeme',
  'placeholder',
  'example',
  'redacted',
  'password',
  'secret',
  'token',
  'undefined',
  'your-token',
  'your-password',
];
const URL_ONLY = ['pass', 'pwd', 'pw', 'user', 'password'];

describe('встроенные заглушки', () => {
  let root = '';
  const lines: Array<[line: string, flagged: boolean]> = [];

  beforeAll(() => {
    root = GateHarness.tempDir('secrets-placeholders-');
    for (const placeholder of BUILT_IN) {
      // Короче порога литерала заглушка молчит и без списка — её держит адрес.
      if ([...placeholder].length >= 8) {
        lines.push([`DB_PASSWORD=${placeholder}`, false]);
        lines.push([`DB_PASSWORD=${placeholder.toUpperCase()}`, false]);
      }
      lines.push([`DATABASE_URL=postgres://app:${placeholder}@db:5432/app`, false]);
      lines.push([`DATABASE_URL=postgres://app:${placeholder}9x@db:5432/app`, true]);
    }
    for (const placeholder of URL_ONLY) {
      lines.push([`REDIS_URL=redis://app:${placeholder}@redis:6379`, false]);
    }
    for (const shape of ['<password>', 'xxx', 'XXXX', '***', '...', '…']) {
      lines.push([`DATABASE_URL=postgres://app:${shape}@db:5432/app`, false]);
    }
    // Форма заглушки — целиком: с хвостом или приставкой это значение.
    for (const shape of ['<pw>abc', 'abc<pw>', 'x', 'xx', '*', '**', '.', '..', 'a…']) {
      lines.push([`DATABASE_URL=postgres://app:${shape}@db:5432/app`, true]);
    }
    GateHarness.write(root, 'prod.env', `${lines.map(([line]) => line).join('\n')}\n`);
    GateHarness.writeConfig(root, GateHarness.config(1));
  });

  afterAll(() => {
    GateHarness.remove(root);
  });

  it('словари модуля совпадают с проверяемыми здесь', () => {
    expect([...BUILT_IN_PLACEHOLDERS].sort()).toEqual([...BUILT_IN].sort());
    expect([...URL_PLACEHOLDERS].sort()).toEqual([...URL_ONLY].sort());
  });

  it('выборка не выродилась: рядом с заглушками — находки', () => {
    expect(lines.filter(([, flagged]) => flagged).length).toBeGreaterThan(10);
  });

  it('находки — ровно строки с хвостом, заглушки молчат', () => {
    const result = GateHarness.run([`${root}/prod.env`], root);
    const expected = lines.flatMap(([, flagged], index) => (flagged ? [`prod.env:${index + 1}`] : []));

    expect(GateHarness.flagged(result.stderr, root)).toEqual(expected);
    expect(result.status).toBe(1);
  });
});
