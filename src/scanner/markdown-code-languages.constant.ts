/**
 * Языки блока кода Markdown, строки которого судятся как КОД (литерал в
 * кавычках, литерал по умолчанию), а не как конфигурация (значение без
 * кавычек). Блок без языка и с языком конфигурации (`yaml`, `env`, `sh`,
 * `dockerfile`, `ini`…) — по-прежнему конфигурация: там команды и `KEY=…`.
 */
export const MARKDOWN_CODE_LANGUAGES: ReadonlySet<string> = new Set([
  'ts',
  'typescript',
  'tsx',
  'js',
  'javascript',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'python',
  'go',
  'java',
  'kotlin',
  'kt',
  'scala',
  'rust',
  'rs',
  'rb',
  'ruby',
  'php',
  'cs',
  'csharp',
  'c#',
  'swift',
  'dart',
  'c',
  'cpp',
  'c++',
]);
