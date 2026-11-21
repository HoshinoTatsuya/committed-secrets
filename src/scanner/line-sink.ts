import { codePoints } from './code-points';
import type { Finding } from './finding.type';

/**
 * Находки одной строки. Один литерал — одна находка: значение, уже названное
 * одним правилом, второе правило не называет (токен внутри значения ключа,
 * токен в пароле адреса, флаг команды и присваивание в той же строке).
 */
export class LineSink {
  private readonly secrets: string[] = [];

  public readonly findings: Finding[] = [];

  public constructor(
    private readonly shown: string,
    private readonly line: number,
  ) {}

  /** `dedupe: false` — находка без значения-литерала (заголовок PEM): не сравнивается с соседями. */
  public add(key: string, rule: string, description: string, secret: string, dedupe = true): void {
    if (
      dedupe &&
      this.secrets.some((seen) => seen.includes(secret) || (codePoints(seen) >= 4 && secret.includes(seen)))
    ) {
      return;
    }
    if (dedupe) {
      this.secrets.push(secret);
    }
    this.findings.push({
      key,
      rule,
      line: this.line,
      description,
      report: `  ${this.shown}:${this.line}  ${description}`,
      secret: () => secret,
    });
  }

  /** Находка «литерал»: ключ и длина, без значения. */
  public literal(key: string, rule: string, value: string): void {
    this.add(key, rule, `${key} — литерал длиной ${codePoints(value)}`, value);
  }
}
