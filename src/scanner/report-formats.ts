import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { GateReport } from './gate-report.type';
import { RULE_CATALOG } from './rule-catalog.constant';

/**
 * Машинные форматы отчёта: собственный JSON, SARIF 2.1.0 (интерфейс
 * GitHub/GitLab/IDE) и отчёт GitLab Secret Detection (находки в MR). Поля
 * перечислены явно: значения секрета в находке нет, и ни один формат не
 * выводит объект находки целиком.
 */
export class ReportFormats {
  public static readonly NAME = 'committed-secrets';

  /** Версия схемы отчёта GitLab Secret Detection. */
  public static readonly GITLAB_SCHEMA = '15.2.1';

  /** Версия пакета: из package.json рядом со сборкой. */
  public static version(): string {
    return (
      JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version: string }
    ).version;
  }

  public static render(format: 'json' | 'sarif' | 'gitlab', report: GateReport): string {
    const document =
      format === 'json'
        ? ReportFormats.json(report)
        : format === 'sarif'
          ? ReportFormats.sarif(report)
          : ReportFormats.gitlab(report);
    return `${JSON.stringify(document, null, 2)}\n`;
  }

  private static ruleText(rule: string): string {
    return RULE_CATALOG[rule] ?? (rule.startsWith('token-') ? `Токен по форме (${rule.slice(6)})` : rule);
  }

  private static json(report: GateReport): object {
    return {
      version: 1,
      tool: { name: ReportFormats.NAME, version: report.version },
      findings: report.findings.map(({ file, line, commit, key, rule, description, fingerprint }) => ({
        file,
        line,
        commit,
        key,
        rule,
        description,
        fingerprint,
      })),
    };
  }

  private static sarif(report: GateReport): object {
    const rules = [...new Set(report.findings.map(({ rule }) => rule))].sort();
    return {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: ReportFormats.NAME,
              version: report.version,
              rules: rules.map((id) => ({ id, shortDescription: { text: ReportFormats.ruleText(id) } })),
            },
          },
          results: report.findings.map(({ file, line, commit, key, rule, description, fingerprint }) => ({
            ruleId: rule,
            level: 'error',
            message: { text: description },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: isAbsolute(file) ? pathToFileURL(file).href : encodeURI(file) },
                  region: { startLine: line },
                },
              },
            ],
            partialFingerprints: { 'committedSecrets/v1': fingerprint },
            properties: commit === null ? { key } : { key, commit },
          })),
        },
      ],
    };
  }

  private static gitlab(report: GateReport): object {
    const time = (date: Date): string => date.toISOString().slice(0, 19);
    const scanner = {
      id: ReportFormats.NAME,
      name: ReportFormats.NAME,
      version: report.version,
      vendor: { name: '@hoshinotatsuya' },
    };
    return {
      version: ReportFormats.GITLAB_SCHEMA,
      scan: {
        analyzer: scanner,
        scanner,
        type: 'secret_detection',
        start_time: time(report.startedAt),
        end_time: time(report.finishedAt),
        status: 'success',
      },
      vulnerabilities: report.findings.map(({ file, line, commit, rule, description, fingerprint }) => {
        const id = createHash('sha256').update(`${fingerprint}\0${file}\0${line}`).digest('hex');
        return {
          id: `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`,
          name: ReportFormats.ruleText(rule),
          description,
          severity: 'Critical',
          location: {
            file,
            start_line: line,
            commit: { sha: commit ?? report.head ?? '0000000000000000000000000000000000000000' },
          },
          identifiers: [
            { type: 'committed_secrets_rule', name: `${ReportFormats.NAME} ${rule}`, value: rule },
          ],
        };
      }),
    };
  }
}
