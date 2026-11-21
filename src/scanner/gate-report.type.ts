import type { ReportedFinding } from './reported-finding.type';

/** Итог прогона для машинных форматов: только новые находки, без значений. */
export interface GateReport {
  readonly findings: readonly ReportedFinding[];
  readonly version: string;
  /** HEAD репозитория (для `location.commit` GitLab), `null` — без коммитов. */
  readonly head: string | null;
  readonly startedAt: Date;
  readonly finishedAt: Date;
}
