import { GateHarness } from '../testing/gate-harness';
import { scanText } from './scan-text';

/**
 * Значение без кавычек — секрет только в файле конфигурации; в коде это
 * выражение. Класс файла решает, какую форму искать, поэтому у каждого правила
 * класса своя проверка: та же строка в файле другого класса молчит.
 */
const { VALUE } = GateHarness;
const BARE = `ENV API_TOKEN=${VALUE}`;
const keysOf = (path: string, text: string): string[] =>
  scanText(path, text, new Set()).map(({ key }) => key);

describe('класс файла', () => {
  it.each([
    'Dockerfile',
    'deploy/Dockerfile.prod',
    'deploy/api.Dockerfile',
    'deploy/run',
    'deploy/app.conf',
    '.env',
    'deploy/.env.local',
  ])('%s — конфигурация: значение без кавычек — находка', (path) => {
    expect(keysOf(path, `${BARE}\n`)).toEqual(['API_TOKEN']);
  });

  it.each(['src/a.ts', 'deploy/prod.Dockerfile.md', 'docs/run.md'])(
    '%s — не конфигурация: значение без кавычек молчит',
    (path) => {
      expect(keysOf(path, `${BARE}\n`)).toEqual([]);
    },
  );

  describe('Markdown: блок кода — конфигурация, проза — нет', () => {
    it('в прозе пара без кавычек молчит, в блоке ``` — находка', () => {
      expect(keysOf('docs/a.md', `${BARE}\n`)).toEqual([]);
      expect(keysOf('docs/a.md', `\`\`\`bash\n${BARE}\n\`\`\`\n`)).toEqual(['API_TOKEN']);
    });

    it('блок с отступом открывается так же', () => {
      expect(keysOf('docs/a.md', `   \`\`\`bash\n${BARE}\n   \`\`\`\n`)).toEqual(['API_TOKEN']);
    });

    it('блок ~~~ — тоже блок кода; ``` внутри него блок не закрывает', () => {
      expect(keysOf('docs/a.md', `~~~sh\n${BARE}\n~~~\n`)).toEqual(['API_TOKEN']);
      expect(keysOf('docs/a.md', `~~~\n\`\`\`\n${BARE}\n~~~\n`)).toEqual(['API_TOKEN']);
    });

    it('после закрытия блока — снова проза', () => {
      expect(keysOf('docs/a.md', `\`\`\`\n\`\`\`\n${BARE}\n`)).toEqual([]);
    });

    it('``` в файле кода — не блок: значение без кавычек молчит', () => {
      expect(keysOf('src/a.ts', `\`\`\`\n${BARE}\n\`\`\`\n`)).toEqual([]);
    });
  });
});
