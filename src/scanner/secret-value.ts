import { codePoints } from './code-points';
import { DATA_FILE_NAME } from './data-file-name.constant';
import { DOCUMENTED_EXAMPLE_SECRETS } from './documented-example-secrets.constant';
import { AUTH_SCHEME_VALUE } from './known-token-shapes.constant';
import { isSecretKey, namesSecret, wordsOf } from './secret-key';
import {
  DESCRIBED,
  DESCRIBED_CAMEL,
  ENV_NAME,
  FILE_PATH,
  MIN_SECRET_LENGTH,
  PLACEHOLDER_SHAPE,
  REFERENCE_PATH,
  SECRET_WORDS,
  SUBST_DEFAULT,
} from './secret-rules';
import { VOLUME_MODE } from './volume-mode.constant';

/**
 * Литералы значения: само значение или значения по умолчанию подстановок.
 * Подстановка без значения по умолчанию, вызов команды, переменная оболочки,
 * шаблон форматирования — выражение, а не литерал.
 */
export function literalParts(value: string): string[] {
  if (value.includes('${')) {
    return [...value.matchAll(SUBST_DEFAULT)]
      .map((match) => match[1] ?? '')
      .filter((part) => !part.includes('$'));
  }
  if (
    value.startsWith('$') ||
    value.includes('$(') ||
    value.includes('%s') ||
    // Интерполяция configparser: `%(DB_PASSWORD)s`.
    value.includes('%(') ||
    value.includes('{}') ||
    value.includes('{{')
  ) {
    return [];
  }
  // `Bearer <токен>`: секрет — токен после схемы (пробел иначе снимал значение целиком).
  const scheme = AUTH_SCHEME_VALUE.exec(value);
  if (scheme?.[1] !== undefined) {
    return literalParts(scheme[1]);
  }
  return [value];
}

/**
 * Значение, которое секретом быть не может, — по ФОРМЕ, а не по префиксу.
 * Зашифрованное значение (SOPS `ENC[AES256_GCM,data:…]`, Maven `{…}`) —
 * правильное хранение, а не утечка.
 */
export function isPlaceholder(value: string, placeholders: ReadonlySet<string>): boolean {
  if (DOCUMENTED_EXAMPLE_SECRETS.has(value)) {
    return true;
  }
  if (placeholders.has(value.toLowerCase()) || PLACEHOLDER_SHAPE.test(value) || ENV_NAME.test(value)) {
    return true;
  }
  if (/^ENC\[[A-Z0-9_]+,data:[^\]]*\]$/u.test(value) || /^\{[A-Za-z0-9+/]{8,}={0,2}\}$/u.test(value)) {
    return true;
  }
  const last = REFERENCE_PATH.exec(value)?.groups?.last;
  if (last !== undefined && (ENV_NAME.test(last) || isSecretKey(last))) {
    return true;
  }
  // Том compose «путь:путь[:режим]» (`./key.json:/run/secrets/key.json:ro`):
  // значение — путь в контейнере с режимом монтирования.
  if (FILE_PATH.test(value) || FILE_PATH.test(value.replace(VOLUME_MODE, ''))) {
    return true;
  }
  // Имя файла или путь без `./` (`gl-secret-detection-report.json` под ключом
  // отчёта CI, `keys/client-secret.json`): ссылка на файл, а не литерал.
  if (DATA_FILE_NAME.test(value)) {
    return true;
  }
  // Имя переменной окружения одним словом (`PGPASSWORD`): заглавные буквы, слово секрета в конце.
  if (/^[A-Z][A-Z0-9]*$/u.test(value) && namesSecret([value.toLowerCase()])) {
    return true;
  }
  // Описание словами (`bookmarks-to-saved-secrets`): слово секрета и во множественном числе.
  const described = DESCRIBED.test(value) || DESCRIBED_CAMEL.test(value);
  return (
    described &&
    namesSecret(
      wordsOf(value).map((word) =>
        word.endsWith('s') && SECRET_WORDS.has(word.slice(0, -1)) ? word.slice(0, -1) : word,
      ),
    )
  );
}

export function isLiteralSecret(value: string, placeholders: ReadonlySet<string>): boolean {
  // Пробел внутри — текст или выражение, а не значение секрета.
  if (codePoints(value) < MIN_SECRET_LENGTH || /\s/u.test(value)) {
    return false;
  }
  return !isPlaceholder(value, placeholders);
}
