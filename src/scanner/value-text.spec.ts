import { GateHarness } from '../testing/gate-harness';
import { EXIT_CODE } from './exit-code.constant';
import { runGate } from './run-gate';
import { valueText } from './value-text';

const STRANGE = [
  ['без прототипа', (): unknown => Object.create(null)],
  [
    'с бросающим toString',
    (): unknown => ({
      toString: () => {
        throw new Error('toString');
      },
    }),
  ],
  [
    'с бросающим Symbol.toPrimitive',
    (): unknown => ({
      [Symbol.toPrimitive]: () => {
        throw new Error('toPrimitive');
      },
    }),
  ],
] as const;

describe('valueText: текст брошенного значения не бросает', () => {
  it('значение без прототипа — тег объекта', () => {
    expect(valueText(Object.create(null))).toBe('[object Object]');
  });

  it('бросающий toString — message, если это строка', () => {
    const value = {
      message: 'исходная причина',
      toString: () => {
        throw new Error('toString');
      },
    };
    expect(valueText(value)).toBe('исходная причина');
  });

  it('бросающий Symbol.toPrimitive — тег объекта', () => {
    const value = {
      [Symbol.toPrimitive]: () => {
        throw new Error('toPrimitive');
      },
    };
    expect(valueText(value)).toBe('[object Object]');
  });

  it('бросающий геттер message вместе с бросающим toString — запасной текст', () => {
    const value = Object.create(null, {
      message: {
        get: () => {
          throw new Error('message');
        },
      },
    });
    expect(valueText(value)).toBe('[значение без текста]');
  });

  it('обычная ошибка — «Имя: сообщение»', () => {
    expect(valueText(new TypeError('плохой аргумент'))).toBe('TypeError: плохой аргумент');
  });

  it('строка и undefined — как String()', () => {
    expect(valueText('текст')).toBe('текст');
    expect(valueText(undefined)).toBe('undefined');
  });
});

/**
 * Отказ, у которого `String()` бросает, доходит до ветки «гейт не смог
 * проверить»: ответ обязан остаться кодом 2 с текстом, а не TypeError вместо
 * исходного отказа.
 */
describe('runGate: отказ со «странным» значением — понятный отказ, а не TypeError', () => {
  let repo = '';

  beforeEach(() => {
    repo = GateHarness.repo('secrets-strange-');
    GateHarness.write(repo, 'a.ts', '\n');
    GateHarness.git(repo, 'add', '-A');
  });

  afterEach(() => {
    GateHarness.remove(repo);
  });

  it.each(STRANGE)('запись итога бросила значение %s — код 2 и причина в тексте', async (_label, make) => {
    const errors: string[] = [];
    const code = await runGate([], repo, {
      out: () => {
        throw make();
      },
      err: (line) => errors.push(line),
    });
    expect(code).toBe(EXIT_CODE.broken);
    expect(errors).toEqual(['ОТКАЗ (гейт не смог проверить): [object Object]']);
  });
});
