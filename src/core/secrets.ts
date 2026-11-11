import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export interface EncryptedSecret {
  encryptedKey: string;
  iv: string;
  authTag: string;
}

/**
 * Декодирует мастер-ключ из base64 и проверяет длину.
 *
 * AES-256 требует ровно 32 байта. Если передать ключ другой длины,
 * Node.js выбросит невнятную ошибку при первом запросе, поэтому
 * лучше проверить это на старте приложения.
 */
export function decodeEncryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');

  if (key.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`,
    );
  }

  return key;
}

/**
 * Шифрует секрет алгоритмом AES-256-GCM.
 *
 * GCM выбран потому, что он не только шифрует, но и проверяет
 * целостность через authentication tag. Если кто-то изменит
 * зашифрованное значение в БД, расшифровка упадёт, а не вернёт мусор.
 *
 * IV должен быть случайным для каждого шифрования: повторное
 * использование IV с одним и тем же ключом ломает безопасность GCM.
 */
export function encryptSecret(
  plaintext: string,
  key: Buffer,
): EncryptedSecret {
  assertKeyLength(key);

  if (plaintext.length === 0) {
    throw new Error('Secret must not be empty');
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return {
    encryptedKey: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

/**
 * Расшифровывает секрет и проверяет authentication tag.
 * Любое несоответствие ключа или повреждение данных превращается
 * в понятную ошибку без вывода самого секрета.
 */
export function decryptSecret(
  secret: EncryptedSecret,
  key: Buffer,
): string {
  assertKeyLength(key);

  const iv = Buffer.from(secret.iv, 'base64');
  const authTag = Buffer.from(secret.authTag, 'base64');
  const encrypted = Buffer.from(secret.encryptedKey, 'base64');

  if (iv.length !== IV_BYTES) {
    throw new Error(`Invalid IV length: expected ${IV_BYTES} bytes`);
  }

  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new Error(
      `Invalid auth tag length: expected ${AUTH_TAG_BYTES} bytes`,
    );
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });

    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    throw new Error('Failed to decrypt secret: wrong key or corrupted data', {
      cause: error,
    });
  }
}

/**
 * Стабильный отпечаток секрета.
 *
 * Нужен, чтобы в БД можно было запретить дубликаты ключей
 * (`api_keys_provider_fingerprint_uq`) и при этом не хранить
 * сам ключ в открытом виде.
 */
export function fingerprintSecret(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Безопасная подсказка для логов и админки: последние несколько
 * символов. Полный ключ наружу не попадает.
 */
export function hintSecret(value: string, visible: number = 4): string {
  if (!Number.isInteger(visible) || visible < 1) {
    throw new Error('visible must be a positive integer');
  }

  return `...${value.slice(-visible)}`;
}

function assertKeyLength(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `Encryption key must be ${KEY_BYTES} bytes, got ${key.length}`,
    );
  }
}
