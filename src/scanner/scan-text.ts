import type { Finding } from './finding.type';
import { TextScanner } from './text-scanner';

/** Находки файла по тексту; `shown` — путь в отчёте (по нему же выбирается класс файла). */
export function scanText(shown: string, text: string, placeholders: ReadonlySet<string>): Finding[] {
  return new TextScanner(shown, placeholders).scan(text);
}
