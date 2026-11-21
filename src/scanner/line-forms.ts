import { isCredential } from './credential-value';
import type { LineSink } from './line-sink';
import { isSecretKey } from './secret-key';
import { isLiteralSecret, literalParts } from './secret-value';

/**
 * Формы, где имя секрета и значение — не «ключ = значение»:
 *  - пара `name`/`value` в одной строке (ECS, `{ name: 'DB_PASSWORD', value: '…' }`,
 *    `<add key="DbPassword" value="…"/>`);
 *  - элемент XML `<password>…</password>`, `<entry key="password">…</entry>`;
 *  - директива через пробел (`requirepass …` redis.conf, `user … on >пароль` ACL);
 *  - `.netrc` (`machine … login … password …`) и `.pgpass` (пятое поле).
 */
export class LineForms {
  private static readonly NAME_VALUE =
    /["']?\b(?:name|key)["']?\s*[:=]\s*(?<q>["'])(?<key>[A-Za-z_][\w.-]*)\k<q>\s*,?\s*["']?value["']?\s*[:=]\s*(?:"(?<dq>[^"\n]*)"|'(?<sq>[^'\n]*)')/gu;

  /** Та же пара в обратном порядке: `{ value: '…', name: 'DB_PASSWORD' }`. */
  private static readonly VALUE_NAME =
    /["']?\bvalue["']?\s*[:=]\s*(?:"(?<dq>[^"\n]*)"|'(?<sq>[^'\n]*)')\s*,?\s*["']?(?:name|key)["']?\s*[:=]\s*(?<q>["'])(?<key>[A-Za-z_][\w.-]*)\k<q>/gu;

  private static readonly XML_ELEMENT =
    /<(?<key>[A-Za-z_][\w.-]*)(?:\s[^<>]*)?>(?<value>[^<>\s]+)<\/\k<key>>/gu;

  private static readonly XML_NAMED =
    /<(?<tag>[A-Za-z_][\w.-]*)\s+(?:name|key)\s*=\s*["'](?<key>[^"'<>]+)["'][^<>]*>(?<value>[^<>\s]+)<\/\k<tag>>/gu;

  private static readonly DIRECTIVE =
    /^\s*(?<key>[A-Za-z_][\w.-]*)\s+(?:"(?<dq>[^"\n]*)"|'(?<sq>[^'\n]*)'|(?<bare>[^\s"'#;]+))\s*;?\s*(?:#.*)?$/u;

  /** ACL Redis: `user <имя> on >пароль ~* +@all`. */
  private static readonly REDIS_ACL = /^\s*user\s+\S+.*?\s>(?<value>\S+)/u;

  private static readonly NETRC = /\b(?<key>password|passwd)\s+(?<value>\S+)/gu;

  public static nameValue(line: string, sink: LineSink, placeholders: ReadonlySet<string>): void {
    if (!line.includes('value')) {
      return;
    }
    for (const pattern of [LineForms.NAME_VALUE, LineForms.VALUE_NAME]) {
      for (const match of line.matchAll(pattern)) {
        const key = match.groups?.key ?? '';
        LineForms.literal(key, match.groups?.dq ?? match.groups?.sq ?? '', sink, placeholders);
      }
    }
  }

  public static xml(line: string, sink: LineSink, placeholders: ReadonlySet<string>): void {
    if (!line.includes('</')) {
      return;
    }
    for (const pattern of [LineForms.XML_ELEMENT, LineForms.XML_NAMED]) {
      for (const match of line.matchAll(pattern)) {
        LineForms.literal(match.groups?.key ?? '', match.groups?.value ?? '', sink, placeholders);
      }
    }
  }

  public static directive(line: string, sink: LineSink, placeholders: ReadonlySet<string>): void {
    const match = LineForms.DIRECTIVE.exec(line);
    if (match !== null) {
      const key = match.groups?.key ?? '';
      LineForms.literal(
        key,
        match.groups?.dq ?? match.groups?.sq ?? match.groups?.bare ?? '',
        sink,
        placeholders,
      );
    }
    const acl = LineForms.REDIS_ACL.exec(line)?.groups?.value;
    if (acl !== undefined && isCredential(acl, placeholders)) {
      sink.literal('user', 'key-literal', acl);
    }
  }

  public static netrc(line: string, sink: LineSink, placeholders: ReadonlySet<string>): void {
    for (const match of line.matchAll(LineForms.NETRC)) {
      const value = match.groups?.value ?? '';
      if (isCredential(value, placeholders)) {
        sink.literal(match.groups?.key ?? '', 'key-literal', value);
      }
    }
  }

  /** `хост:порт:база:пользователь:пароль`, `\:` — двоеточие внутри поля. */
  public static pgpass(line: string, sink: LineSink, placeholders: ReadonlySet<string>): void {
    if (line.trimStart().startsWith('#')) {
      return;
    }
    const fields = line.split(/(?<!\\):/u);
    if (fields.length >= 5) {
      const password = fields.slice(4).join(':').replace(/\\(.)/gu, '$1');
      if (isCredential(password, placeholders)) {
        sink.literal('password', 'key-literal', password);
      }
    }
  }

  private static literal(
    key: string,
    value: string,
    sink: LineSink,
    placeholders: ReadonlySet<string>,
  ): void {
    if (!isSecretKey(key)) {
      return;
    }
    for (const part of literalParts(value)) {
      if (isLiteralSecret(part, placeholders)) {
        sink.literal(key, 'key-literal', part);
      }
    }
  }
}
