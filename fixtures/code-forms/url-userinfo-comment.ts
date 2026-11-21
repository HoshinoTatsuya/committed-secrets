  try {
    const parsed = new URL(url);
    const asciiHost = parsed.hostname;
    const unicodeHost = toUnicodeHost(asciiHost);

    // Если перевод ничего не изменил — возвращаем исходную строку без лишних аллокаций
    if (unicodeHost === asciiHost) {
      return url;
    }

    // Собираем адрес из частей, подменяя ТОЛЬКО хост.
    // Почему не url.replace(asciiHost, ...): String.replace без флага 'g'
    // заменяет ПЕРВОЕ вхождение. Если хост встречается раньше (в userinfo —
    // "https://user:xn--...@xn--...", в схеме и т.п.), замена попадёт не туда и
    // испортит учётные данные и структуру адреса.
    // Почему не parsed.toString(): WHATWG URL снова кодирует non-ASCII хост
    // в punycode при сериализации. Строка собирается вручную — только для
    // показа, с исходным (percent-)кодированием остальных частей.
    const auth = parsed.username
      ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@`
      : '';
    const portPart = parsed.port ? `:${parsed.port}` : '';

    return `${parsed.protocol}//${auth}${unicodeHost}${portPart}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (error) {
