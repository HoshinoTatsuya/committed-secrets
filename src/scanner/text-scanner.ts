import { AUTH_HEADER_VALUE } from './auth-header-value.constant';
import { Base64Credentials } from './base64-credentials';
import { CodeFallbacks } from './code-fallbacks';
import { codePoints } from './code-points';
import { CommandRules } from './command-rules';
import { isCredential } from './credential-value';
import { DOCUMENTED_EXAMPLE_SECRETS } from './documented-example-secrets.constant';
import type { FileKind } from './file-kind.type';
import { FileKinds } from './file-kinds';
import type { Finding } from './finding.type';
import { KNOWN_TOKEN_SHAPES, PGP_PRIVATE } from './known-token-shapes.constant';
import { LineForms } from './line-forms';
import { LineSink } from './line-sink';
import { MARKDOWN_CODE_LANGUAGES } from './markdown-code-languages.constant';
import { isSecretKey, wordsOf } from './secret-key';
import { CODE_ASSIGN, CONFIG_ASSIGN, PEM_PRIVATE, URL_PASSWORD } from './secret-rules';
import { isLiteralSecret, literalParts } from './secret-value';
import type { ShellToken } from './shell-token.type';
import { ShellWords } from './shell-words';

/**
 * Сканер текста одного файла. Построчный, но со СТРУКТУРОЙ, которая
 * переходит через строки: блок кода Markdown, блок YAML `|`, список YAML
 * (аргументы команды по строке), пара `name:`/`value:` (env Kubernetes),
 * `encryptedData` SealedSecret (зашифровано — не находка).
 */
export class TextScanner {
  /** Ключ находки «пароль в адресе» в перечне фикстур. */
  public static readonly URL_FINDING_KEY = 'адрес';

  /** Разрыв строки: те же разделители, что у `str.splitlines()` Python, — номера строк совпадают. */
  // biome-ignore lint/suspicious/noControlCharactersInRegex: те же разделители строк, что у splitlines Python (\x1c–\x1e, \x85)
  private static readonly LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/u;

  /** Граница блока кода Markdown и язык блока (`​```ts`, `~~~ yaml`). */
  private static readonly FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/u;

  private static readonly BLOCK_INDICATOR = /^[|>][+-]?\d?$/u;

  /** Строка-комментарий кода или конфигурации. */
  private static readonly COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|#|--|<!--)/u;

  /**
   * Колонка SQL (`secrets.id`) значением квалифицированного ключа
   * (`secret_state.secret_id = secrets.id`) — сравнение колонок, а не секрет.
   */
  private static readonly COLUMN_REFERENCE = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/u;

  /** Хэш (MD5, SHA-1, SHA-256) — вид значения в `@example` документации. */
  private static readonly HEX_DIGEST = /^(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64})$/iu;

  /**
   * Пароль адреса в комментарии-примере, который сам говорит «заглушка»:
   * `postgres://user:secret@host`. В коде тот же адрес — находка.
   */
  private static readonly EXAMPLE_PASSWORD =
    /^(?:my|your|db|app|user)?(?:pass|passw(?:or)?d|pwd|secret|s3cret|changeme|example|test)\d{0,3}$/iu;

  /** Пароль адреса, оборванный многоточием (`user:xn--...@host`), — пропуск в примере, а не значение. */
  private static readonly ELIDED = /(?:\.{3}|…)$/u;

  /**
   * Идентификатор SQL в кавычках, за которым идёт колонка: `"таблица"."колонка"`
   * или `"таблица".колонка` (не вызов метода `"…".trim()`). Значение — ссылка на
   * колонку, а не строковый литерал.
   */
  private static readonly SQL_IDENTIFIER = /^[a-z_][a-z0-9_]*$/u;

  private static readonly SQL_COLUMN_AFTER = /^\.(?:"[a-z_][a-z0-9_]*"|[a-z_][a-z0-9_]*(?![\w$(]))/u;

  /** Тег JSDoc в начале строки комментария: `* @example`, `/** @returns`. */
  private static readonly DOC_TAG = /^\s*(?:\/\*\*?|\*)\s*@([A-Za-z]+)/u;

  private readonly kind: FileKind;

  private readonly findings: Finding[] = [];

  private lines: string[] = [];

  private fence: string | null = null;

  /**
   * Блок кода Markdown на языке программирования (`​```ts`, `​```python`): строки
   * судятся как код, а не как конфигурация. Прежде любой блок был YAML: литерал
   * по умолчанию в коде (`?? '…'`) не искался, а аннотация типа под секретным
   * ключом (`apiKey: CustomToken`) была находкой.
   */
  private codeFence = false;

  /**
   * `value:` выше `name:` в элементе env (`- value: …` / `  name: DB_PASSWORD`):
   * значение ждёт имени в той же колонке.
   */
  private pendingValue: { value: string; column: number; line: number } | null = null;

  /** Ключ кода без значения в строке (`const dbPassword =`): литерал — на следующей. */
  private pendingCodeKey: string | null = null;

  /** Блок YAML `ключ: |`: ключ, отступ ключа, строки значения. */
  private block: { key: string; indent: number; values: Array<{ line: number; text: string }> } | null = null;

  /** Отступ `encryptedData:` — всё глубже зашифровано. */
  private encryptedIndent: number | null = null;

  /** `- name: DB_PASSWORD`: ждём `value:` в той же колонке. */
  private pendingName: { key: string; column: number } | null = null;

  /** Список YAML (`command:` построчно) как слова одной команды. */
  private list: { indent: number; tokens: ShellToken[] } | null = null;

  /**
   * Строка — в разделе `@example` комментария: от тега до следующего тега
   * или конца комментария. Пример вызова идёт блоком кода через несколько
   * строк после тега, а не на строке самого тега.
   */
  private example = false;

  public constructor(
    private readonly shown: string,
    private readonly placeholders: ReadonlySet<string>,
  ) {
    this.kind = FileKinds.of(shown);
  }

  public scan(text: string): Finding[] {
    this.lines = text.split(TextScanner.LINE_BREAK);
    this.lines.forEach((line, index) => {
      this.scanLine(line, index);
    });
    this.closeBlock();
    return this.findings;
  }

  private scanLine(line: string, index: number): void {
    const sink = new LineSink(this.shown, index + 1);
    if (this.kind.markdown && this.toggleFence(line)) {
      return;
    }
    const fenced = this.kind.markdown && this.fence !== null;
    const config = this.kind.config || (fenced && !this.codeFence);
    const structured = this.kind.yaml || (fenced && !this.codeFence);
    this.trackExample(line);
    if (!structured || this.structure(line, index, sink)) {
      // В прозе Markdown «Пароль:» и строка в кавычках ниже — текст, а не присваивание.
      if (!config && (!this.kind.markdown || this.codeFence)) {
        this.continuedLiteral(line, sink);
      }
      this.keyValues(line, config, structured, sink);
      if (!config) {
        CodeFallbacks.scan(line, sink, this.placeholders);
      }
      LineForms.nameValue(line, sink, this.placeholders);
      LineForms.xml(line, sink, this.placeholders);
      this.commands(line, config, sink);
      if (this.kind.directives) {
        LineForms.directive(line, sink, this.placeholders);
      }
      if (this.kind.netrc) {
        LineForms.netrc(line, sink, this.placeholders);
      }
      if (this.kind.pgpass) {
        LineForms.pgpass(line, sink, this.placeholders);
      }
    }
    this.shapes(line, index, sink);
    this.findings.push(...sink.findings);
    // Конец комментария закрывает и раздел `@example`.
    if (line.includes('*/')) {
      this.example = false;
    }
  }

  /** Раздел `@example`: открывает тег `@example`, закрывают другой тег, строка вне комментария, конец комментария. */
  private trackExample(line: string): void {
    if (!this.isComment(line)) {
      this.example = false;
      return;
    }
    const tag = TextScanner.DOC_TAG.exec(line)?.[1];
    if (tag !== undefined) {
      this.example = tag === 'example';
    }
  }

  /** Граница блока кода Markdown: ``` или ~~~, закрывает тот же знак не короче открывшего. */
  private toggleFence(line: string): boolean {
    const fence = TextScanner.FENCE.exec(line);
    const marker = fence?.[1];
    if (marker === undefined) {
      return false;
    }
    if (this.fence === null) {
      this.fence = marker;
      this.codeFence = MARKDOWN_CODE_LANGUAGES.has((fence?.[2] ?? '').toLowerCase());
      this.pendingCodeKey = null;
      return true;
    }
    if (marker[0] === this.fence[0] && marker.length >= this.fence.length && line.trim() === marker) {
      this.fence = null;
      this.codeFence = false;
      this.pendingCodeKey = null;
      return true;
    }
    return false;
  }

  /**
   * Структура YAML через строки. `false` — строка целиком принадлежит
   * структуре (продолжение блока, зашифрованное значение): правила
   * «ключ–значение» к ней не применяются, формы токенов — применяются.
   */
  private structure(line: string, index: number, sink: LineSink): boolean {
    const trimmed = line.trim();
    const blank = trimmed === '';
    const indent = line.length - line.trimStart().length;
    if (this.block !== null) {
      if (blank || indent > this.block.indent) {
        if (!blank) {
          this.block.values.push({ line: index, text: trimmed });
        }
        return false;
      }
      this.closeBlock();
    }
    if (this.encryptedIndent !== null) {
      if (blank || indent > this.encryptedIndent) {
        return false;
      }
      this.encryptedIndent = null;
    }
    if (/^encryptedData:\s*(?:#.*)?$/u.test(trimmed)) {
      this.encryptedIndent = indent;
      return false;
    }
    if (this.pendingName !== null && !blank) {
      const value = /^(\s*)value:\s*(.*)$/u.exec(line);
      if (value !== null && (value[1] as string).length === this.pendingName.column) {
        const scalar = TextScanner.scalar(value[2] as string);
        if (TextScanner.BLOCK_INDICATOR.test(scalar)) {
          // `value: |` — значение блоком на следующих строках, а не строка «|».
          if (isSecretKey(this.pendingName.key)) {
            this.block = { key: this.pendingName.key, indent, values: [] };
          }
        } else if (isSecretKey(this.pendingName.key)) {
          // Только секретное имя: `- name: IMAGE_TAG` / `value: a1b2c3d4…` — не секрет
          // (прежде любое значение от 8 символов под любым именем было находкой).
          this.judgeLiteral(this.pendingName.key, scalar, sink);
        }
      }
      if (indent <= this.pendingName.column) {
        this.pendingName = null;
      }
    }
    // Элемент списка начинается заново — значение без имени к нему уже не относится.
    if (this.pendingValue !== null && !blank && indent < this.pendingValue.column && !/^\s*-\s/u.test(line)) {
      this.pendingValue = null;
    }
    const name = /^(\s*(?:-\s+)?)name:\s*["']?([A-Za-z_][\w.-]*)["']?\s*(?:#.*)?$/u.exec(line);
    if (name !== null) {
      const column = (name[1] as string).length;
      const key = name[2] as string;
      if (this.pendingValue !== null && this.pendingValue.column === column) {
        // Значение было выше имени: находка — на строке значения; пара закрыта в любом случае.
        if (isSecretKey(key)) {
          const valueSink = new LineSink(this.shown, this.pendingValue.line + 1);
          this.judgeLiteral(key, this.pendingValue.value, valueSink);
          this.findings.push(...valueSink.findings);
        }
        this.pendingValue = null;
      } else {
        this.pendingName = { key, column };
      }
    } else {
      const valueFirst = /^(\s*-\s+)value:\s*(.*)$/u.exec(line);
      if (valueFirst !== null) {
        this.pendingValue = {
          value: TextScanner.scalar(valueFirst[2] as string),
          column: (valueFirst[1] as string).length,
          line: index,
        };
      }
    }
    this.listItem(line, sink, blank);
    return true;
  }

  /** Элемент списка YAML — слово команды; список — одна команда. */
  private listItem(line: string, sink: LineSink, blank: boolean): void {
    const item = /^(\s*)-\s+(.*)$/u.exec(line);
    const value = item?.[2]?.trim() ?? '';
    // Отображение (`- name: x`) или вложенная коллекция — не слово команды.
    if (item === null || /^[[{]/u.test(value) || /^[^'"\s]*:(?:\s|$)/u.test(value)) {
      if (!blank) {
        this.list = null;
      }
      return;
    }
    const indent = (item[1] as string).length;
    const token = TextScanner.scalarToken(value);
    if (this.list?.indent === indent) {
      this.list.tokens.push(token);
    } else {
      this.list = { indent, tokens: [token] };
    }
    CommandRules.evaluate(this.list.tokens, sink, this.placeholders, this.list.tokens.length - 1);
    // `- "redis-cli -a … ping"` после `- sh` / `- -c`: элемент в кавычках — сама команда, как в
    // exec-форме. Без кавычек строку целиком уже разобрал `commands` (скрипт CI `- docker build …`).
    if (token.literal && /^(["']).*\1$/u.test(value) && /\s/u.test(token.text)) {
      for (const segment of ShellWords.segments(token.text)) {
        CommandRules.evaluate(segment, sink, this.placeholders);
      }
    }
  }

  /** Комментарий кода или конфигурации; в Markdown `#` и `*` — разметка, а не комментарий. */
  private isComment(line: string): boolean {
    return !this.kind.markdown && TextScanner.COMMENT_LINE.test(line);
  }

  private closeBlock(): void {
    const block = this.block;
    this.block = null;
    // Значение в блоке — одна строка; многострочный блок — текст, а не значение секрета.
    if (block?.values.length === 1) {
      const [only] = block.values as [{ line: number; text: string }];
      const sink = new LineSink(this.shown, only.line + 1);
      this.judgeLiteral(block.key, only.text, sink);
      this.findings.push(...sink.findings);
    }
  }

  private keyValues(line: string, config: boolean, structured: boolean, sink: LineSink): void {
    const pattern = config ? CONFIG_ASSIGN : CODE_ASSIGN;
    for (const match of line.matchAll(pattern)) {
      const key = match.groups?.key ?? '';
      const groups = match.groups ?? {};
      let value = TextScanner.unescape(groups, config);
      // Заголовок авторизации без кавычек в конфигурации — до конца строки: схема и токен через пробел.
      if (config && groups.bare !== undefined && /authorization/iu.test(key)) {
        const start = (match.index ?? 0) + match[0].length - groups.bare.length;
        // Схема и одно слово после неё; хвост прозы (`<ключ>).` в комментарии) — не часть значения.
        value = (/^\S+(?:[ \t]+\S+)?/u.exec(line.slice(start))?.[0] ?? '').replace(/[).,;:]+$/u, '');
      }
      // Тернарный оператор (`flag ? 'token' : 'modifier'`) — не пара ключ–значение.
      if (line.slice(0, match.index).trimEnd().endsWith('?')) {
        continue;
      }
      if (key.includes('.') && groups.bare !== undefined && TextScanner.COLUMN_REFERENCE.test(value)) {
        continue;
      }
      // `= "таблица"."колонка"` — колонка SQL в кавычках, а не строка.
      if (
        (groups.dq !== undefined || groups.sq !== undefined) &&
        TextScanner.SQL_IDENTIFIER.test(value) &&
        TextScanner.SQL_COLUMN_AFTER.test(line.slice((match.index ?? 0) + match[0].length))
      ) {
        continue;
      }
      // Хэш в разделе `@example` документации (`@example secretId: 'e3b0c442…'` или в
      // блоке кода через несколько строк после тега) — пример вида значения.
      if (
        this.isComment(line) &&
        (line.includes('@example') || this.example) &&
        TextScanner.HEX_DIGEST.test(value)
      ) {
        continue;
      }
      if (config && structured && groups.bare !== undefined && TextScanner.BLOCK_INDICATOR.test(value)) {
        if (isSecretKey(key)) {
          this.block = { key, indent: line.length - line.trimStart().length, values: [] };
        }
        continue;
      }
      // Заголовок авторизации — секрет только по ФОРМЕ значения (`Bearer <токен>`):
      // слово «auth» в имени ключа само по себе давало шум (`IClientAuth: 'interface'`).
      if (
        /authorization/iu.test(key) &&
        wordsOf(key).includes('authorization') &&
        AUTH_HEADER_VALUE.test(value)
      ) {
        Base64Credentials.judgeAuthorization(key, value, sink, this.placeholders);
      } else if (key === '_auth' && Base64Credentials.decode(value) !== null) {
        // `_auth` .npmrc — base64 «логин:пароль»: судится по содержимому, как `auth`
        // (заглушка `user:password` — не находка); не base64 — литералом ниже.
        Base64Credentials.judgeKey(key, value, sink, this.placeholders);
      } else if (isSecretKey(key)) {
        this.judgeLiteral(key, value, sink);
      } else if (Base64Credentials.appliesTo(key)) {
        Base64Credentials.judgeKey(key, value, sink, this.placeholders);
      }
    }
  }

  /**
   * Литерал на строке после ключа (`const dbPassword =` / `password:` и с новой
   * строки `"…",` — перенос форматтера). Ключ без значения запоминается, литерал
   * судится на следующей непустой строке, если строка — только он.
   */
  private continuedLiteral(line: string, sink: LineSink): void {
    const trimmed = line.trim();
    if (this.pendingCodeKey !== null && trimmed !== '') {
      const key = this.pendingCodeKey;
      this.pendingCodeKey = null;
      const literal = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\$]|\\.)*)`)\s*[,;)]?\s*$/u.exec(
        trimmed,
      );
      if (literal !== null) {
        this.judgeLiteral(
          key,
          (literal[1] ?? literal[2] ?? literal[3] ?? '').replace(/\\(["'`\\])/gu, '$1'),
          sink,
        );
        return;
      }
    }
    const opened =
      /(?:^|[\s{,(])["']?([A-Za-z_][\w]*)["']?\s*(?::\s*[A-Za-z_][\w.<>[\]|, ]*?\s*=|:=|=>|:|=)\s*\(?\s*$/u.exec(
        line,
      );
    if (opened !== null && isSecretKey(opened[1] as string) && !this.isComment(line)) {
      this.pendingCodeKey = opened[1] as string;
    }
  }

  /** Значение группы: экранированная кавычка — часть значения (`\"` в коде и в «"…"», `''` в «'…'» YAML). */
  private static unescape(groups: Record<string, string | undefined>, config: boolean): string {
    if (groups.sq !== undefined) {
      return config ? groups.sq.replace(/''/gu, "'") : groups.sq.replace(/\\(["'`\\])/gu, '$1');
    }
    const quoted = groups.dq ?? groups.bq;
    if (quoted !== undefined) {
      return quoted.replace(/\\(["'`\\])/gu, '$1');
    }
    return groups.enc ?? groups.bare ?? '';
  }

  private judgeLiteral(key: string, value: string, sink: LineSink): void {
    for (const part of literalParts(value)) {
      if (isLiteralSecret(part, this.placeholders)) {
        sink.literal(key, 'key-literal', part);
      }
    }
  }

  /**
   * Командная строка: в конфигурации — строка целиком, в прозе Markdown —
   * встроенный код, в коде — содержимое строковых литералов с пробелом
   * (`execSync('curl -u …')`); везде — массивы (exec-форма).
   */
  private commands(line: string, config: boolean, sink: LineSink): void {
    const sources: string[] = [];
    if (config) {
      sources.push(line);
    } else if (this.kind.markdown) {
      // В прозе команда — только во встроенном коде (`redis-cli -a …`): пара без
      // кавычек в тексте — проза, как и прежде.
      for (const span of line.matchAll(/`([^`\n]+)`/gu)) {
        sources.push(span[1] ?? '');
      }
    } else if (/['"`]/u.test(line)) {
      for (const literal of line.matchAll(
        /"([^"\n]*\s[^"\n]*)"|'([^'\n]*\s[^'\n]*)'|`([^`\n]*\s[^`\n]*)`/gu,
      )) {
        sources.push(literal[1] ?? literal[2] ?? literal[3] ?? '');
      }
    }
    for (const source of sources) {
      if (/[-=]|\bset\b/u.test(source)) {
        for (const segment of ShellWords.segments(source)) {
          CommandRules.evaluate(segment, sink, this.placeholders);
        }
      }
    }
    if (line.includes('[')) {
      for (const array of ShellWords.arrays(line, config)) {
        CommandRules.evaluate(array, sink, this.placeholders);
        // `["sh", "-c", "redis-cli -a … ping"]`, `["CMD-SHELL", "…"]`: элемент — сама команда.
        for (const item of array) {
          if (item.literal && /\s/u.test(item.text)) {
            for (const segment of ShellWords.segments(item.text)) {
              CommandRules.evaluate(segment, sink, this.placeholders);
            }
          }
        }
      }
    }
  }

  /** Формы, не зависящие от ключа: токены, base64 PEM, пароль в адресе, закрытые ключи. */
  private shapes(line: string, index: number, sink: LineSink): void {
    for (const { kind, hints, pattern } of KNOWN_TOKEN_SHAPES) {
      if (!hints.some((hint) => line.includes(hint))) {
        continue;
      }
      for (const match of line.matchAll(pattern)) {
        if (DOCUMENTED_EXAMPLE_SECRETS.has(match[0])) {
          continue;
        }
        sink.add(
          `токен ${kind}`,
          `token-${kind.toLowerCase().replaceAll(' ', '-')}`,
          `токен ${kind} — литерал длиной ${codePoints(match[0])}`,
          match[0],
        );
      }
    }
    Base64Credentials.pemShapes(line, sink);
    // Пароль в адресе — литерал любой длины: трёхбуквенный пароль — тоже пароль.
    for (const match of line.includes('://') ? line.matchAll(URL_PASSWORD) : []) {
      const user = /:\/\/([^:/@]*):/u.exec(match[0])?.[1] ?? '';
      for (const part of literalParts(match.groups?.val ?? '')) {
        const example =
          part === user || TextScanner.EXAMPLE_PASSWORD.test(part) || TextScanner.ELIDED.test(part);
        if (isCredential(part, this.placeholders) && !(example && this.isComment(line))) {
          sink.add(
            TextScanner.URL_FINDING_KEY,
            'url-password',
            `пароль в адресе — литерал длиной ${codePoints(part)}`,
            part,
          );
        }
      }
    }
    // Отпечаток ключа — по первой строке тела: заголовок одинаков у всех ключей.
    const body = this.lines[index + 1] ?? '';
    if (!line.includes('-----BEGIN')) {
      return;
    }
    if (PEM_PRIVATE.test(line)) {
      sink.add('PEM', 'private-key', 'закрытый ключ PEM', `${line}\n${body}`, false);
    }
    if (PGP_PRIVATE.test(line)) {
      sink.add('PGP', 'private-key', 'закрытый ключ PGP', `${line}\n${body}`, false);
    }
  }

  /** Скаляр YAML без кавычек. */
  private static scalar(text: string): string {
    const value = text.trim().replace(/\s+#.*$/u, '');
    const quoted = /^(["'])(.*)\1$/u.exec(value);
    return quoted === null ? value : (quoted[2] as string);
  }

  private static scalarToken(text: string): ShellToken {
    const quoted = /^(["'])(.*)\1$/u.exec(text);
    const value = quoted === null ? text.replace(/\s+#.*$/u, '') : (quoted[2] as string);
    return { text: value, literal: !value.includes('$') };
  }
}
