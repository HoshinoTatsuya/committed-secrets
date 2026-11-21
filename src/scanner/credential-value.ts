import { URL_PLACEHOLDERS } from './secret-rules';
import { isPlaceholder } from './secret-value';

/**
 * Пароль без нижней границы длины — там, где форма сама говорит «это пароль»:
 * адрес, `curl -u логин:пароль`, `sshpass -p`, base64 «логин:пароль».
 * Трёхбуквенный пароль — тоже пароль; заглушки (`password`, `<pw>`) — нет.
 */
export function isCredential(value: string, placeholders: ReadonlySet<string>): boolean {
  return (
    value !== '' &&
    !/\s/u.test(value) &&
    !isPlaceholder(value, placeholders) &&
    !URL_PLACEHOLDERS.has(value.toLowerCase())
  );
}
