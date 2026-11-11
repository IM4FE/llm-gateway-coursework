import { describe, expect, it } from 'vitest';

import {
  decodeEncryptionKey,
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
  hintSecret,
} from './secrets.js';

const KEY = Buffer.alloc(32, 7);
const KEY_BASE64 = KEY.toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9);

describe('secrets', () => {
  it('round-trips a secret through AES-256-GCM', () => {
    const encrypted = encryptSecret('sk-or-v1-abcdef123456', KEY);

    expect(encrypted.encryptedKey).not.toContain('sk-or-v1');
    expect(decryptSecret(encrypted, KEY)).toBe('sk-or-v1-abcdef123456');
  });

  it('supports unicode secrets', () => {
    const encrypted = encryptSecret('ключ-🔑-значение', KEY);

    expect(decryptSecret(encrypted, KEY)).toBe('ключ-🔑-значение');
  });

  it('uses a fresh random IV for every encryption', () => {
    const first = encryptSecret('same-secret', KEY);
    const second = encryptSecret('same-secret', KEY);

    expect(first.iv).not.toBe(second.iv);
    expect(first.encryptedKey).not.toBe(second.encryptedKey);
    expect(decryptSecret(first, KEY)).toBe('same-secret');
    expect(decryptSecret(second, KEY)).toBe('same-secret');
  });

  it('fails to decrypt with a different key', () => {
    const encrypted = encryptSecret('secret', KEY);

    expect(() => decryptSecret(encrypted, OTHER_KEY)).toThrow(
      'Failed to decrypt secret: wrong key or corrupted data',
    );
  });

  it('detects tampered ciphertext', () => {
    const encrypted = encryptSecret('secret', KEY);
    const bytes = Buffer.from(encrypted.encryptedKey, 'base64');
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;

    expect(() =>
      decryptSecret(
        { ...encrypted, encryptedKey: bytes.toString('base64') },
        KEY,
      ),
    ).toThrow('Failed to decrypt secret');
  });

  it('detects a tampered authentication tag', () => {
    const encrypted = encryptSecret('secret', KEY);
    const tag = Buffer.from(encrypted.authTag, 'base64');
    tag[0] = (tag[0] ?? 0) ^ 0xff;

    expect(() =>
      decryptSecret({ ...encrypted, authTag: tag.toString('base64') }, KEY),
    ).toThrow('Failed to decrypt secret');
  });

  it('rejects malformed IV and auth tag lengths before decrypting', () => {
    const encrypted = encryptSecret('secret', KEY);

    expect(() =>
      decryptSecret({ ...encrypted, iv: Buffer.alloc(4).toString('base64') }, KEY),
    ).toThrow('Invalid IV length');

    expect(() =>
      decryptSecret(
        { ...encrypted, authTag: Buffer.alloc(4).toString('base64') },
        KEY,
      ),
    ).toThrow('Invalid auth tag length');
  });

  it('rejects encryption keys that are not 32 bytes', () => {
    expect(() => encryptSecret('secret', Buffer.alloc(16))).toThrow(
      'Encryption key must be 32 bytes, got 16',
    );
    expect(() => decryptSecret(
      encryptSecret('secret', KEY),
      Buffer.alloc(16),
    )).toThrow('Encryption key must be 32 bytes, got 16');
  });

  it('rejects an empty secret', () => {
    expect(() => encryptSecret('', KEY)).toThrow('Secret must not be empty');
  });

  it('decodes a base64 encryption key and validates its length', () => {
    expect(decodeEncryptionKey(KEY_BASE64).equals(KEY)).toBe(true);
    expect(() =>
      decodeEncryptionKey(Buffer.alloc(16).toString('base64')),
    ).toThrow('ENCRYPTION_KEY must decode to 32 bytes, got 16');
  });

  it('computes a stable fingerprint without embedding the secret', () => {
    const first = fingerprintSecret('secret');
    const second = fingerprintSecret('secret');

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain('secret');
    expect(fingerprintSecret('another-secret')).not.toBe(first);
  });

  it('builds a short hint from the end of the secret', () => {
    expect(hintSecret('sk-or-v1-abcdef123456')).toBe('...3456');
    expect(hintSecret('sk-or-v1-abcdef123456', 2)).toBe('...56');
    expect(() => hintSecret('secret', 0)).toThrow(
      'visible must be a positive integer',
    );
  });
});
