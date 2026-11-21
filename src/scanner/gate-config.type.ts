/** Проектное — `committed-secrets.json` корня проекта. */
export interface GateConfig {
  readonly minFiles: number;
  readonly requiredKinds: readonly string[];
  readonly fixturesPath: string;
  readonly deliveryPattern: string;
  readonly serviceCodeRoot: string;
  readonly extraPlaceholders: readonly string[];
  /** Код сервиса, который перечень фикстур освобождает: спеки и обвязка тестов (регулярные выражения). */
  readonly testCodePatterns: readonly string[];
  /** Базовая линия (отпечатки принятых находок) или `null`. */
  readonly baselinePath: string | null;
}
