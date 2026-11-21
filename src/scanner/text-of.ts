/**
 * Текст файла или `null` для двоичного. UTF-16 (с BOM или без — по нулям через
 * байт в начале) — текст: секрет в файле, сохранённом редактором Windows,
 * остаётся секретом, а NUL каждого второго байта прежде делал его «двоичным».
 */
export function textOf(data: Buffer): string | null {
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
    return data.subarray(2).toString('utf16le');
  }
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    // Нечётный хвост отбрасывается, как и без BOM ниже: swap16 на нечётной длине бросает RangeError.
    const body = data.subarray(2, data.length - (data.length % 2));
    return Buffer.from(body).swap16().toString('utf16le');
  }
  const head = data.subarray(0, 8192);
  if (!head.includes(0)) {
    const text = data.toString('utf8');
    return text.startsWith('﻿') ? text.slice(1) : text;
  }
  // Без BOM: в тексте ASCII на UTF-16 ноль — почти каждый второй байт, и только он.
  const pairs = head.length >> 1;
  let evenZero = 0;
  let oddZero = 0;
  for (let index = 0; index < pairs * 2; index += 2) {
    evenZero += head[index] === 0 ? 1 : 0;
    oddZero += head[index + 1] === 0 ? 1 : 0;
  }
  if (pairs >= 4 && oddZero > pairs * 0.4 && evenZero === 0) {
    return data.subarray(0, data.length - (data.length % 2)).toString('utf16le');
  }
  if (pairs >= 4 && evenZero > pairs * 0.4 && oddZero === 0) {
    return Buffer.from(data.subarray(0, data.length - (data.length % 2)))
      .swap16()
      .toString('utf16le');
  }
  return null;
}
