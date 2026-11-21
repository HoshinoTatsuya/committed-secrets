import { AUTH_HEADER_VALUE } from './auth-header-value.constant';
import { codePoints } from './code-points';
import { isCredential } from './credential-value';
import { AUTH_SCHEME_VALUE } from './known-token-shapes.constant';
import type { LineSink } from './line-sink';
import { PEM_PRIVATE } from './secret-rules';
import { isLiteralSecret, literalParts } from './secret-value';

/**
 * Секрет в base64: `auth` Docker `config.json`, `*-data` kubeconfig, схема
 * `Basic`. Энтропией base64 не отличить от хэша — поэтому значение
 * декодируется и судится по содержимому: закрытый ключ PEM или
 * «логин:пароль» с паролем, который не заглушка. Значение в отчёт не
 * попадает ни в каком виде — ни base64, ни декодированное.
 */
export class Base64Credentials {
  private static readonly BASE64 = /^[A-Za-z0-9+/_-]{8,}={0,2}$/u;

  /** base64 строки `-----BEGIN` — закрытый ключ PEM без ключа рядом. */
  private static readonly PEM_BASE64 = /\bLS0tLS1CRUdJTi[A-Za-z0-9+/]{16,}={0,2}/gu;

  /** Ключ, значение которого — base64 учётных данных, а не произвольные данные. */
  public static appliesTo(key: string): boolean {
    return key.toLowerCase() === 'auth' || /[-_]data$/iu.test(key) || /[a-z]Data$/u.test(key);
  }

  /** Содержимое base64: закрытый ключ, пароль из «логин:пароль» или ничего. */
  public static decode(value: string): { readonly pem: true } | { readonly password: string } | null {
    if (!Base64Credentials.BASE64.test(value)) {
      return null;
    }
    const text = Buffer.from(value, 'base64').toString('utf8');
    if (PEM_PRIVATE.test(text)) {
      return { pem: true };
    }
    // biome-ignore lint/suspicious/noControlCharactersInRegex: управляющие символы — признак двоичных данных, а не текста
    if (text.includes('�') || /[\x00-\x08\x0e-\x1f]/u.test(text)) {
      return null;
    }
    const pair = /^([^:\s]{1,256}):(\S+)$/su.exec(text);
    return pair === null ? null : { password: pair[2] as string };
  }

  /** Значение ключа `auth`/`*-data`: находка, если внутри ключ или пароль. */
  public static judgeKey(
    key: string,
    value: string,
    sink: LineSink,
    placeholders: ReadonlySet<string>,
  ): void {
    const decoded = Base64Credentials.decode(value);
    if (decoded === null) {
      return;
    }
    if ('pem' in decoded) {
      sink.add(key, 'base64-private-key', `${key} — закрытый ключ PEM в base64`, value);
    } else if (isCredential(decoded.password, placeholders)) {
      Base64Credentials.reportPair(key, value, decoded.password, sink);
    }
  }

  /**
   * Значение заголовка авторизации со схемой. `Basic` декодируется: заглушка
   * в пароле (`user:password`) — не находка; не «логин:пароль» — судится как
   * литерал. Остальные схемы — токен после схемы. Схема вне списка (`ApiKey`,
   * `HMAC`, `SSWS`) и сырой токен без схемы (с 0.6.0) — учётные данные судятся,
   * если похожи на токен (буквы и цифры): одно слово без цифр под ключом
   * `authorization` (`required`, `disabled`) — настройка, а не секрет.
   */
  public static judgeAuthorization(
    key: string,
    value: string,
    sink: LineSink,
    placeholders: ReadonlySet<string>,
  ): void {
    const scheme = AUTH_SCHEME_VALUE.exec(value);
    const token = scheme?.[1];
    if (token !== undefined && /^basic\s/iu.test(value)) {
      const decoded = Base64Credentials.decode(token);
      if (decoded !== null && 'password' in decoded) {
        if (isCredential(decoded.password, placeholders)) {
          Base64Credentials.reportPair(key, token, decoded.password, sink);
        }
        return;
      }
    }
    if (token !== undefined) {
      for (const part of literalParts(value)) {
        if (isLiteralSecret(part, placeholders)) {
          sink.literal(key, 'key-literal', part);
        }
      }
      return;
    }
    const credential = AUTH_HEADER_VALUE.exec(value)?.groups?.credential;
    if (
      credential !== undefined &&
      !credential.includes('$') &&
      /\d/u.test(credential) &&
      /\p{L}/u.test(credential) &&
      isLiteralSecret(credential, placeholders)
    ) {
      sink.literal(key, 'key-literal', credential);
    }
  }

  /** `LS0tLS1CRUdJTi…` где угодно: base64 закрытого ключа PEM. */
  public static pemShapes(line: string, sink: LineSink): void {
    if (!line.includes('LS0tLS1CRUdJTi')) {
      return;
    }
    for (const match of line.matchAll(Base64Credentials.PEM_BASE64)) {
      const decoded = Base64Credentials.decode(match[0]);
      if (decoded !== null && 'pem' in decoded) {
        sink.add('PEM', 'base64-private-key', 'закрытый ключ PEM в base64', match[0]);
      }
    }
  }

  private static reportPair(key: string, encoded: string, password: string, sink: LineSink): void {
    sink.add(
      key,
      'base64-credentials',
      `${key} — base64 «логин:пароль», пароль длиной ${codePoints(password)}`,
      encoded,
    );
  }
}
