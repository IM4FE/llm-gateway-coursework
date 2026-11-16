import { describe, expect, it } from 'vitest';

import { calculateCostMicros } from './cost.js';

describe('calculateCostMicros', () => {
  it('returns zero when both prices are zero', () => {
    expect(
      calculateCostMicros({
        promptTokens: 1_000,
        completionTokens: 2_000,
        inputPriceMicrosPer1m: 0,
        outputPriceMicrosPer1m: 0,
      }),
    ).toBe(0);
  });

  it('charges only input tokens when the output price is zero', () => {
    expect(
      calculateCostMicros({
        promptTokens: 1_000_000,
        completionTokens: 500_000,
        inputPriceMicrosPer1m: 150,
        outputPriceMicrosPer1m: 0,
      }),
    ).toBe(150);
  });

  it('charges only output tokens when the input price is zero', () => {
    expect(
      calculateCostMicros({
        promptTokens: 1_000_000,
        completionTokens: 500_000,
        inputPriceMicrosPer1m: 0,
        outputPriceMicrosPer1m: 600,
      }),
    ).toBe(300);
  });

  it('sums input and output cost', () => {
    expect(
      calculateCostMicros({
        promptTokens: 1_000,
        completionTokens: 2_000,
        inputPriceMicrosPer1m: 250,
        outputPriceMicrosPer1m: 750,
      }),
    ).toBe(2);
  });

  it('rounds a sub-micro-dollar result to zero', () => {
    expect(
      calculateCostMicros({
        promptTokens: 1,
        completionTokens: 0,
        inputPriceMicrosPer1m: 400,
        outputPriceMicrosPer1m: 0,
      }),
    ).toBe(0);
  });

  it('rounds half a micro-dollar up', () => {
    expect(
      calculateCostMicros({
        promptTokens: 1,
        completionTokens: 0,
        inputPriceMicrosPer1m: 500_000,
        outputPriceMicrosPer1m: 0,
      }),
    ).toBe(1);
  });

  it('rounds a realistic request to the nearest micro-dollar', () => {
    expect(
      calculateCostMicros({
        promptTokens: 1_234_567,
        completionTokens: 7_654,
        inputPriceMicrosPer1m: 150_000,
        outputPriceMicrosPer1m: 600_000,
      }),
    ).toBe(189_777);
  });
});
