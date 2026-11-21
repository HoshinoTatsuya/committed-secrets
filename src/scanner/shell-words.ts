import type { ShellToken } from './shell-token.type';

/**
 * Слова команд без исполнения: разбор оболочки (кавычки, экранирование,
 * разделители команд) и exec-форма (`["redis-server", "--requirepass", "…"]`).
 * Цель — найти пары «флаг → значение», а не повторить bash: подстановка
 * (`$X`, `$(…)`, обратные кавычки) помечает слово как НЕ литерал.
 */
export class ShellWords {
  /** Разделители команд: `;`, `|`, `&`, скобки, перенаправления, перевод строки. */
  private static readonly SEPARATORS = new Set([';', '|', '&', '(', ')', '<', '>', '\n', '\r']);

  /**
   * Массив без вложенных скобок; строка перед ним (`spawn('redis-cli', [...])`) —
   * имя команды. Скобки ВНУТРИ строковых элементов — часть элемента:
   * `'http://[::1]:8080'`, `'if [ -f x ]; then …'` прежде срывали разбор всего массива.
   */
  private static readonly ARRAY =
    /(?:(["'`])([^"'`\n]*)\1\s*,\s*)?\[((?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`\n]*`|[^[\]"'`\n])*)\]/gu;

  /** Команды строки: слова, разбитые разделителями. */
  public static segments(text: string): ShellToken[][] {
    const segments: ShellToken[][] = [];
    let current: ShellToken[] = [];
    let word = '';
    let started = false;
    let literal = true;
    const flush = (): void => {
      if (started) {
        current.push({ text: word, literal });
      }
      word = '';
      started = false;
      literal = true;
    };
    const cut = (): void => {
      flush();
      if (current.length > 0) {
        segments.push(current);
      }
      current = [];
    };
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index] as string;
      if (char === ' ' || char === '\t') {
        flush();
      } else if (ShellWords.SEPARATORS.has(char)) {
        cut();
      } else if (char === "'") {
        started = true;
        const end = text.indexOf("'", index + 1);
        const stop = end === -1 ? text.length : end;
        word += text.slice(index + 1, stop);
        index = stop;
      } else if (char === '"') {
        started = true;
        index += 1;
        while (index < text.length && text[index] !== '"') {
          const inner = text[index] as string;
          if (inner === '\\' && index + 1 < text.length) {
            index += 1;
            word += text[index];
          } else {
            literal = literal && inner !== '$' && inner !== '`';
            word += inner;
          }
          index += 1;
        }
      } else if (char === '\\') {
        started = true;
        if (index + 1 < text.length) {
          index += 1;
          word += text[index];
        }
      } else {
        started = true;
        literal = literal && char !== '$' && char !== '`';
        word += char;
      }
    }
    cut();
    return segments;
  }

  /**
   * Массивы строки как списки слов: exec-форма compose/Dockerfile/k8s и
   * массивы аргументов в коде. Элемент в кавычках — литерал; без кавычек —
   * литерал только в конфигурации (`[redis-server, --requirepass, x]` YAML), в
   * коде это выражение.
   */
  public static arrays(line: string, bareLiteral: boolean): ShellToken[][] {
    const arrays: ShellToken[][] = [];
    for (const match of line.matchAll(ShellWords.ARRAY)) {
      const items = ShellWords.items(match[3] ?? '', bareLiteral);
      if (match[2] !== undefined) {
        items.unshift({ text: match[2], literal: !match[2].includes('$') });
      }
      if (items.length >= 2) {
        arrays.push(items);
      }
    }
    return arrays;
  }

  private static items(content: string, bareLiteral: boolean): ShellToken[] {
    const raw: string[] = [];
    let current = '';
    let quote = '';
    for (let index = 0; index < content.length; index += 1) {
      const char = content[index] as string;
      if (quote !== '') {
        current += char;
        if (char === '\\' && index + 1 < content.length) {
          index += 1;
          current += content[index];
        } else if (char === quote) {
          quote = '';
        }
      } else if (char === ',') {
        raw.push(current.trim());
        current = '';
      } else {
        if (char === '"' || char === "'" || char === '`') {
          quote = char;
        }
        current += char;
      }
    }
    raw.push(current.trim());
    return raw
      .filter((item) => item !== '')
      .map((item) => {
        const quoted = /^(["'`])([\s\S]*)\1$/u.exec(item);
        if (quoted !== null) {
          const text = (quoted[2] ?? '').replace(/\\(.)/gu, '$1');
          return { text, literal: !text.includes('$') };
        }
        return { text: item, literal: bareLiteral && /^[^\s'"`$]+$/u.test(item) };
      });
  }
}
