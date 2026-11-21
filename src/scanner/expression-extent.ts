/**
 * Выражение значения ключа до его границы: первой запятой, `;` или закрывающей
 * скобки ВНЕ вложенных скобок и строк. `apiKey: process.env.API_KEY, region:
 * env.REGION ?? 'x'` — значение `apiKey` кончается на запятой: литерал соседнего
 * свойства ему не принадлежит. Запятая внутри вызова (`get('KEY', 'x')`) — не
 * граница.
 */
export function expressionExtent(text: string): string {
  let depth = 0;
  let quote = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (quote !== '') {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = '';
      }
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === '(' || char === '[' || char === '{') {
      depth += 1;
    } else if (char === ')' || char === ']' || char === '}') {
      if (depth === 0) {
        return text.slice(0, index);
      }
      depth -= 1;
    } else if ((char === ',' || char === ';') && depth === 0) {
      return text.slice(0, index);
    }
  }
  return text;
}
