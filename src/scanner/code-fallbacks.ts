import { expressionExtent } from './expression-extent';
import type { LineSink } from './line-sink';
import { isSecretKey } from './secret-key';
import { isLiteralSecret, literalParts } from './secret-value';

/**
 * Литерал по умолчанию в коде: значение под секретным ключом — выражение, но
 * в нём литерал на случай «не задано» (`process.env.X ?? 'литерал'`,
 * `config.get('KEY', 'литерал')`, `.default('литерал')`, `Buffer.from('…')`).
 * Такой литерал уезжает в прод, как только переменную забыли задать.
 */
export class CodeFallbacks {
  /** Обратная кавычка: в режиме `u` экранировать её в регулярке нельзя. */
  private static readonly BT = '`';

  private static readonly QUOTED =
    String.raw`("[^"\n]*"|'[^'\n]*'|${CodeFallbacks.BT}[^${CodeFallbacks.BT}\n]*${CodeFallbacks.BT})`;

  /**
   * Ключ, оператор и выражение до конца инструкции. Выражение — в ПРОСМОТРЕ
   * вперёд: прежде совпадение поглощало строку до конца, и ключ правее первого
   * присваивания (`const c = { apiKey: … }`) не рассматривался вовсе. Граница
   * значения — `expressionExtent`.
   */
  private static readonly ASSIGNMENT = new RegExp(
    String.raw`(?<kq>["'${CodeFallbacks.BT}]?)(?<![\p{L}\p{N}\p{M}_$.-])(?<key>[A-Za-z_][A-Za-z0-9_]*)\k<kq>\s*(?::\s*[A-Za-z_][\w.<>\[\]|, ]*?\s*=|:=|=>|:|=)(?!=)\s*(?=(?<expr>[^;\n]*))`,
    'gu',
  );

  private static readonly GETTER =
    String.raw`\b(?:get|getenv|getEnv|get_env|getOrDefault|getString|getValue|fetch|env|config)\s*(?:<[^<>()\n]*>)?\s*\(`;

  /** Формы литерала по умолчанию в выражении под секретным ключом. */
  private static readonly FORMS: readonly RegExp[] = [
    new RegExp(String.raw`(?:\?\?|\|\||\bor\b|\?:)\s*${CodeFallbacks.QUOTED}`, 'gu'),
    new RegExp(
      String.raw`\.(?:default|defaultValue|withDefault|unwrap_or|unwrapOr|getOrElse|orElse|getOrDefault)\s*\(\s*${CodeFallbacks.QUOTED}`,
      'gu',
    ),
    new RegExp(
      String.raw`${CodeFallbacks.GETTER}\s*${CodeFallbacks.QUOTED}\s*,\s*${CodeFallbacks.QUOTED}`,
      'gu',
    ),
    new RegExp(
      String.raw`\b(?:Buffer\.from|bytes\.fromhex|bytes\.fromHex|hex\.DecodeString|atob|b64decode|decode64)\s*\(\s*${CodeFallbacks.QUOTED}`,
      'gu',
    ),
  ];

  /** Переменная окружения с секретным именем и литерал по умолчанию — под любым ключом. */
  private static readonly ENV_DEFAULT = new RegExp(
    String.raw`(?:process\.env|import\.meta\.env|Deno\.env|os\.environ|\bENV|\benv)(?:\.([A-Za-z_]\w*)|\[\s*["']([^"'\n]+)["']\s*\])\s*(?:\?\?|\|\||\bor\b)\s*${CodeFallbacks.QUOTED}`,
    'gu',
  );

  /** Чтение настройки с секретным именем и литералом по умолчанию: `get('DB_PASSWORD', '…')`. */
  private static readonly NAMED_GETTER = new RegExp(
    String.raw`${CodeFallbacks.GETTER}\s*${CodeFallbacks.QUOTED}\s*,\s*${CodeFallbacks.QUOTED}`,
    'gu',
  );

  /** Дешёвая отсечка: без этих подстрок форм в строке нет. */
  private static readonly HINT =
    /\?\?|\|\||\bor\b|\?:|default|get|env|fetch|config|unwrap|orElse|Buffer|bytes|hex|atob|decode/u;

  public static scan(line: string, sink: LineSink, placeholders: ReadonlySet<string>): void {
    if (!CodeFallbacks.HINT.test(line)) {
      return;
    }
    const report = (key: string, quoted: string | undefined): void => {
      // Подстановка внутри шаблона (`'${…}'`) — выражение, а не литерал: те же части, что у ключа.
      for (const value of literalParts((quoted ?? '').slice(1, -1))) {
        if (isLiteralSecret(value, placeholders)) {
          sink.add(
            key,
            'fallback-literal',
            `${key} — литерал по умолчанию длиной ${[...value].length}`,
            value,
          );
        }
      }
    };
    for (const match of line.matchAll(CodeFallbacks.ASSIGNMENT)) {
      const key = match.groups?.key ?? '';
      // Тернарный оператор (`flag ? 'token' : 'modifier'`) — не пара ключ–значение.
      if (!isSecretKey(key) || line.slice(0, match.index).trimEnd().endsWith('?')) {
        continue;
      }
      const expr = expressionExtent(match.groups?.expr ?? '');
      for (const form of CodeFallbacks.FORMS) {
        for (const found of expr.matchAll(form)) {
          report(key, found.at(-1));
        }
      }
    }
    for (const match of line.matchAll(CodeFallbacks.ENV_DEFAULT)) {
      const name = match[1] ?? match[2] ?? '';
      if (isSecretKey(name)) {
        report(name, match[3]);
      }
    }
    for (const match of line.matchAll(CodeFallbacks.NAMED_GETTER)) {
      const name = (match[1] ?? '').slice(1, -1);
      if (isSecretKey(name)) {
        report(name, match[2]);
      }
    }
  }
}
