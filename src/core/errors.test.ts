import { describe, expect, it } from 'vitest';

import { GatewayError, isGatewayError, toGatewayError } from './errors.js';

describe('GatewayError', () => {
  it('uses HTTP status and retryability defaults for the error code', () => {
    const error = new GatewayError({
      code: 'rate_limited',
      message: 'Too many requests',
    });

    expect(error.name).toBe('GatewayError');
    expect(error.httpStatus).toBe(429);
    expect(error.retryable).toBe(true);
  });

  it('marks client errors as non-retryable by default', () => {
    const error = new GatewayError({
      code: 'invalid_request',
      message: 'Invalid request',
    });

    expect(error.httpStatus).toBe(400);
    expect(error.retryable).toBe(false);
  });

  it('allows overriding defaults', () => {
    const error = new GatewayError({
      code: 'upstream_error',
      message: 'Provider failed',
      httpStatus: 418,
      retryable: false,
    });

    expect(error.httpStatus).toBe(418);
    expect(error.retryable).toBe(false);
  });

  it('keeps provider status, details and cause', () => {
    const cause = new Error('socket hang up');
    const error = new GatewayError({
      code: 'provider_timeout',
      message: 'Provider timed out',
      providerStatus: 504,
      details: { provider: 'openrouter' },
      cause,
    });

    expect(error.providerStatus).toBe(504);
    expect(error.details).toEqual({ provider: 'openrouter' });
    expect(error.cause).toBe(cause);
  });

  it('detects GatewayError instances', () => {
    expect(isGatewayError(new GatewayError({ code: 'no_route', message: 'No route' }))).toBe(
      true,
    );
    expect(isGatewayError(new Error('regular error'))).toBe(false);
    expect(isGatewayError('not an error')).toBe(false);
  });

  it('returns the same instance when wrapping a GatewayError', () => {
    const original = new GatewayError({
      code: 'provider_unavailable',
      message: 'Provider unavailable',
    });

    expect(toGatewayError(original)).toBe(original);
  });

  it('wraps unknown Error instances as internal errors', () => {
    const cause = new Error('database exploded');
    const error = toGatewayError(cause);

    expect(error.code).toBe('internal_error');
    expect(error.httpStatus).toBe(500);
    expect(error.retryable).toBe(false);
    expect(error.cause).toBe(cause);
  });

  it('wraps non-Error values as internal errors with details', () => {
    const error = toGatewayError({ unexpected: true });

    expect(error.code).toBe('internal_error');
    expect(error.details).toEqual({ unexpected: true });
  });
});
