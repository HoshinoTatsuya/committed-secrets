import { GateHarness } from '../testing/gate-harness';
import { MIN_REASON_LENGTH } from './fixture-list';

/**
 * Перечень фикстур — исключение из гейта, поэтому сам он проверяется строже
 * кода: причина не короче порога, запись — объект с ключами, файл поставки и
 * код сервиса не освобождаются. Каждое правило — своя проверка, рядом —
 * допустимая запись (иначе фикстура проверяла бы «отказ на всём»).
 */
const { VALUE } = GateHarness;
const reasonOf = (length: number): string => 'п'.repeat(length);

describe('перечень фикстур', () => {
  let repo = '';

  beforeEach(() => {
    repo = GateHarness.repo('secrets-fixtures-');
    GateHarness.write(repo, 'test/env/test.env', `REDIS_PASSWORD=${VALUE}\n`);
  });

  afterEach(() => {
    GateHarness.remove(repo);
  });

  const gateWith = (entries: unknown) => {
    GateHarness.write(repo, GateHarness.FIXTURES_LIST, JSON.stringify(entries));
    GateHarness.git(repo, 'add', '-A');
    return GateHarness.run([], repo);
  };
  const entry = (overrides: Record<string, unknown> = {}) => ({
    file: 'test/env/test.env',
    keys: ['REDIS_PASSWORD'],
    reason: reasonOf(MIN_REASON_LENGTH),
    ...overrides,
  });

  it(`причина ровно ${MIN_REASON_LENGTH} знаков — запись принята`, () => {
    const result = gateWith([entry()]);
    expect(result.stdout).toContain('фикстур по перечню: 1');
    expect(result.status).toBe(0);
  });

  it(`причина на знак короче — отказ с номером записи`, () => {
    const result = gateWith([entry({ reason: reasonOf(MIN_REASON_LENGTH - 1) })]);
    expect(result.stderr).toContain(`#0 test/env/test.env: причина короче ${MIN_REASON_LENGTH} знаков`);
    expect(result.status).toBe(1);
  });

  it('пробелы по краям причину не удлиняют', () => {
    const result = gateWith([entry({ reason: `   ${reasonOf(MIN_REASON_LENGTH - 1)}   ` })]);
    expect(result.stderr).toContain('причина короче');
    expect(result.status).toBe(1);
  });

  it('перечень — не список: «не смог проверить», код 2', () => {
    const result = gateWith({ file: 'test/env/test.env' });
    expect(result.stderr).toContain('ожидался список записей');
    expect(result.status).toBe(2);
  });

  it.each([
    ['строка', 'test/env/test.env'],
    ['null', null],
    ['список', ['test/env/test.env']],
  ])('запись — %s: отказ «запись — не объект»', (_name, bad) => {
    const result = gateWith([entry(), bad]);
    expect(result.stderr).toContain('#1: запись — не объект');
    expect(result.status).toBe(1);
  });

  it('пустой список ключей — отказ', () => {
    const result = gateWith([entry(), entry({ file: 'test/env/other.env', keys: [] })]);
    expect(result.stderr).toContain('#1 test/env/other.env: пустой список ключей');
    expect(result.status).toBe(1);
  });

  it('устаревшие записи перечислены по порядку', () => {
    const result = gateWith([entry({ keys: ['REDIS_PASSWORD', 'Z_TOKEN', 'A_TOKEN'] })]);
    const stale = result.stderr.split('\n').filter((line) => line.includes('запись устарела'));
    expect(stale).toEqual([
      '  test/env/test.env · A_TOKEN: в файле такой находки нет — запись устарела',
      '  test/env/test.env · Z_TOKEN: в файле такой находки нет — запись устарела',
    ]);
    expect(result.stderr).toContain(`ОТКАЗ: перечень фикстур ${GateHarness.FIXTURES_LIST}:`);
    expect(result.status).toBe(1);
  });

  describe('код сервиса освобождается только в спеках и testing/', () => {
    const cases: Array<[path: string, allowed: boolean]> = [
      ['src/db/harness.spec.ts', true],
      ['src/testing/harness.ts', true],
      ['src/db/harness.ts', false],
      // Спека — по окончанию имени, а не по подстроке.
      ['src/db/harness.spec.ts.bak', false],
      // Вне корня кода сервиса — тестовый файл, освобождается.
      ['test/db/src/harness.ts', true],
    ];

    it.each(cases)('%s — освобождается: %s', (path, allowed) => {
      GateHarness.write(repo, path, `const password = '${VALUE}';\n`);
      const result = gateWith([entry(), entry({ file: path, keys: ['password'] })]);
      if (allowed) {
        expect(result.stdout).toContain('фикстур по перечню: 2');
        expect(result.status).toBe(0);
      } else {
        expect(result.stderr).toContain(`#1 ${path}: файл поставки или код сервиса`);
        expect(result.status).toBe(1);
      }
    });
  });

  it('шаблон поставки сверяется с НАЧАЛА пути, а не где угодно', () => {
    GateHarness.writeConfig(repo, { ...GateHarness.config(1), deliveryPattern: 'deploy/' });
    GateHarness.write(repo, 'test/deploy/x.env', `API_TOKEN=${VALUE}\n`);
    GateHarness.write(repo, 'deploy/x.env', `API_TOKEN=${VALUE}\n`);
    const result = gateWith([
      entry(),
      entry({ file: 'test/deploy/x.env', keys: ['API_TOKEN'] }),
      entry({ file: 'deploy/x.env', keys: ['API_TOKEN'] }),
    ]);
    expect(result.stderr).toContain('#2 deploy/x.env: файл поставки');
    expect(result.stderr).not.toContain('#1 test/deploy/x.env: файл поставки');
    expect(result.status).toBe(1);
  });
});
