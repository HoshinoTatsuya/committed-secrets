/**
 * Токены с известным префиксом — секрет по ФОРМЕ, под любым ключом (`auth:`,
 * `headers.Authorization`, логин в URL `https://ghp_…@host`). Только формы с
 * длинным хвостом фиксированного алфавита: короткий или общий префикс дал бы
 * шум, и гейт отключили бы.
 */
/**
 * `hints` — подстроки, без которых форма в строке невозможна: дешёвая отсечка
 * перед регулярным выражением (форм полтора десятка, строк — миллионы).
 */
export const KNOWN_TOKEN_SHAPES: ReadonlyArray<{
  readonly kind: string;
  readonly hints: readonly string[];
  readonly pattern: RegExp;
}> = [
  {
    kind: 'GitHub',
    hints: ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_'],
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g,
  },
  // С 0.5.0 — все виды токенов GitLab: личный, раннера, развёртывания, триггера, агента…
  {
    kind: 'GitLab',
    hints: ['gl'],
    pattern: /\bgl(?:pat|rt|dt|ptt|ft|imt|cbt|soat|oas|agent|ffct|wt)-[A-Za-z0-9_-]{20,}\b/g,
  },
  { kind: 'Slack', hints: ['xox'], pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: 'AWS', hints: ['AKIA', 'ASIA'], pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'Google', hints: ['AIza'], pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'Stripe', hints: ['_live_'], pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/g },
  { kind: 'npm', hints: ['npm_'], pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  // Ключи OpenAI: проектный/сервисный префикс или маркер `T3BlbkFJ` (base64 «OpenAI»).
  {
    kind: 'OpenAI',
    hints: ['sk-'],
    pattern: /\bsk-(?:(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}|[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20})\b/g,
  },
  { kind: 'Anthropic', hints: ['sk-ant-'], pattern: /\bsk-ant-[a-z]{3,8}\d{2}-[A-Za-z0-9_-]{32,}/g },
  {
    kind: 'JWT',
    hints: ['eyJ'],
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}/g,
  },
  // Yandex Cloud: OAuth `y0_`, IAM `t1.9eu…`, API-ключ `AQVN…`.
  { kind: 'Yandex OAuth', hints: ['y0_', 'y1_', 'y2_', 'y3_'], pattern: /\by[0-3]_[A-Za-z0-9_-]{40,}/g },
  {
    kind: 'Yandex IAM',
    hints: ['t1.9eu'],
    pattern: /\bt1\.9eu[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]{20,})?=*/g,
  },
  { kind: 'Yandex API', hints: ['AQVN'], pattern: /\bAQVN[A-Za-z0-9_-]{35,}/g },
  { kind: 'age', hints: ['AGE-SECRET-KEY-1'], pattern: /\bAGE-SECRET-KEY-1[0-9A-Z]{58}\b/g },
];

/** Закрытый ключ PGP: тот же класс, что PEM. */
export const PGP_PRIVATE = /-----BEGIN PGP PRIVATE KEY BLOCK-----/u;

/** Значение заголовка авторизации: схема и токен через пробел. */
export const AUTH_SCHEME_VALUE = /^(?:Bearer|Basic|Token|Bot)\s+(\S+)$/iu;
