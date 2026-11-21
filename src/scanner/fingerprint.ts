import { scryptSync } from 'node:crypto';

/**
 * Отпечаток находки для базовой линии и отчётов: от файла, ключа и ЗНАЧЕНИЯ,
 * но не от номера строки (строки сдвигаются при любой правке выше). Медленный
 * хэш (scrypt), а не SHA-256: отпечаток лежит в отчётах CI, и подбор слабого
 * пароля по быстрому хэшу стоил бы секунды. Соль — путь и ключ: одинаковые
 * значения в разных местах дают разные отпечатки.
 */
export function fingerprintOf(file: string, key: string, secret: string): string {
  return scryptSync(secret, `committed-secrets/1\0${file}\0${key}`, 16, { N: 1024, r: 8, p: 1 }).toString(
    'hex',
  );
}
