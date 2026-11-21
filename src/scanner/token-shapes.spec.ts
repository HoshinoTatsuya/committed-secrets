import { KNOWN_TOKEN_SHAPES } from './known-token-shapes.constant';
import { scanText } from './scan-text';

/**
 * Токены с известным префиксом — по ФОРМЕ, под ключом, который секрет не
 * называет. У каждой формы своя пара: полная длина — находка с видом токена,
 * хвост на символ короче нижней границы — тишина (иначе квантификатор `{20,}`
 * можно снять, и никто не заметит).
 */
const join = (...parts: string[]): string => parts.join('');
const tail = (length: number): string =>
  'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5cD7eF9gH1iJ3kL5mN7'.repeat(3).slice(0, length);

/** [вид, токен минимальной длины, тот же токен на символ короче]. */
const SHAPES: Array<[kind: string, token: string, short: string]> = [
  ['GitHub', join('ghp', '_', tail(36)), join('ghp', '_', tail(35))],
  ['GitHub', join('github', '_pat_', tail(22)), join('github', '_pat_', tail(21))],
  ['GitLab', join('glpat', '-', tail(20)), join('glpat', '-', tail(19))],
  ['Slack', join('xoxb', '-', tail(10)), join('xoxb', '-', tail(9))],
  ['AWS', join('AKIA', '2OGYBAH6QKZXT7NA'), join('AKIA', '2OGYBAH6QKZXT7N')],
  ['Google', join('AIza', tail(35)), join('AIza', tail(34))],
  ['npm', join('npm', '_', tail(36)), join('npm', '_', tail(35))],
  // С 0.5.0 нижняя граница Stripe — 16: короткий хвост корпуса аудита пропускался.
  ['Stripe', join('sk', '_live_', tail(16)), join('sk', '_live_', tail(15))],
  ['GitLab', join('glrt', '-', tail(20)), join('glrt', '-', tail(19))],
  ['GitLab', join('gldt', '-', tail(20)), join('gldt', '-', tail(19))],
  ['OpenAI', join('sk', '-proj-', tail(40)), join('sk', '-proj-', tail(39))],
  [
    'OpenAI',
    join('sk', '-', tail(20), 'T3Blbk', 'FJ', tail(20)),
    join('sk', '-', tail(20), 'T3Blbk', 'FJ', tail(19)),
  ],
  ['Anthropic', join('sk', '-ant-api03-', tail(32)), join('sk', '-ant-api03-', tail(31))],
  [
    'JWT',
    join('eyJ', tail(8), '.eyJ', tail(8), '.', tail(16)),
    join('eyJ', tail(8), '.eyJ', tail(8), '.', tail(15)),
  ],
  ['Yandex OAuth', join('y0', '_', tail(40)), join('y0', '_', tail(39))],
  ['Yandex IAM', join('t1', '.9eu', tail(20)), join('t1', '.9eu', tail(19))],
  ['Yandex API', join('AQ', 'VN', tail(35)), join('AQ', 'VN', tail(34))],
  [
    'age',
    join('AGE-SECRET', '-KEY-1', tail(58).toUpperCase()),
    join('AGE-SECRET', '-KEY-1', tail(57).toUpperCase()),
  ],
];

const findingsOf = (line: string) => scanText('src/client.ts', `${line}\n`, new Set());

describe('токены по форме', () => {
  it('выборка не выродилась: у каждого вида из словаря есть пара', () => {
    const kinds = new Set(SHAPES.map(([kind]) => kind));
    for (const { kind } of KNOWN_TOKEN_SHAPES) {
      expect([kind, kinds.has(kind)]).toEqual([kind, true]);
    }
  });

  it.each(SHAPES)('%s: полная длина — находка с видом токена', (kind, token) => {
    const findings = findingsOf(`const value = '${token}';`);
    expect(findings.map(({ key }) => key)).toEqual([`токен ${kind}`]);
    expect(findings[0]?.report).toContain(`токен ${kind} — литерал длиной ${token.length}`);
  });

  it.each(SHAPES)('%s: на символ короче нижней границы — тишина', (_kind, _token, short) => {
    expect(findingsOf(`const value = '${short}';`)).toEqual([]);
  });

  it('токен внутри слова — не токен: граница слова слева', () => {
    expect(findingsOf(`const value = 'x${join('AKIA', '2OGYBAH6QKZXT7NA')}';`)).toEqual([]);
  });
});
