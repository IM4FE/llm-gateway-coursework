import { describe, expect, it } from 'vitest';

import {
  clientKeyPrefix,
  generateClientKey,
  hashClientKey,
} from './clientKeys.js';

describe('client keys', () => {
  it('generates unique keys with a recognizable prefix', () => {
    const first = generateClientKey();
    const second = generateClientKey();

    expect(first).toMatch(/^lgw_[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  it('hashes keys deterministically as SHA-256 hex', () => {
    const key = 'lgw_test-key';

    expect(hashClientKey(key)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashClientKey(key)).toBe(hashClientKey(key));
    expect(hashClientKey('lgw_other-key')).not.toBe(hashClientKey(key));
  });

  it('stores only a short, bounded prefix', () => {
    expect(clientKeyPrefix('lgw_abcdefghijklmnop')).toBe('lgw_abcdefgh');

    expect(() => clientKeyPrefix('lgw_x', 0)).toThrow();
    expect(() => clientKeyPrefix('lgw_x', 17)).toThrow();
    expect(() => clientKeyPrefix('lgw_x', 1.5)).toThrow();
  });
});
