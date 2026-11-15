import { describe, expect, it } from 'vitest';

import { FixedWindowRateLimiter } from './RateLimiter.js';

describe('FixedWindowRateLimiter', () => {
  it('allows requests up to the limit and rejects the next one', () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 60_000 });

    const first = limiter.check('client-1', 2, 1_000);

    expect(first).toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      retryAfterSeconds: 0,
      resetAt: 61_000,
    });

    expect(limiter.check('client-1', 2, 1_001)).toMatchObject({
      allowed: true,
      remaining: 0,
    });

    const rejected = limiter.check('client-1', 2, 1_002);

    expect(rejected).toMatchObject({
      allowed: false,
      limit: 2,
      remaining: 0,
      retryAfterSeconds: 60,
      resetAt: 61_000,
    });
  });

  it('resets the counter after the window', () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 1_000 });

    expect(limiter.check('client-1', 1, 1_000).allowed).toBe(true);
    expect(limiter.check('client-1', 1, 1_999).allowed).toBe(false);
    expect(limiter.check('client-1', 1, 2_000).allowed).toBe(true);
  });

  it('keeps independent counters per key', () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 1_000 });

    expect(limiter.check('client-1', 1, 1_000).allowed).toBe(true);
    expect(limiter.check('client-2', 1, 1_000).allowed).toBe(true);
    expect(limiter.check('client-1', 1, 1_000).allowed).toBe(false);
  });

  it('applies the limit passed to each check', () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 1_000 });

    expect(limiter.check('client-1', 1, 1_000).allowed).toBe(true);
    expect(limiter.check('client-1', 2, 1_000).allowed).toBe(true);
    expect(limiter.check('client-1', 2, 1_000).allowed).toBe(false);
  });

  it('rejects invalid arguments', () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 1_000 });

    expect(() => limiter.check('', 1, 0)).toThrow();
    expect(() => limiter.check('client-1', 0, 0)).toThrow();
    expect(() => limiter.check('client-1', 1.5, 0)).toThrow();
    expect(() => limiter.check('client-1', 1, Number.NaN)).toThrow();
  });

  it('rejects an invalid window', () => {
    expect(() => new FixedWindowRateLimiter({ windowMs: 0 })).toThrow();
    expect(() => new FixedWindowRateLimiter({ windowMs: 1.5 })).toThrow();
  });
});
