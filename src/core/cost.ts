export interface CostInput {
  promptTokens: number;
  completionTokens: number;
  /**
   * Цена за 1M входных токенов в микро-долларах.
   * 1 USD = 1_000_000 микро-долларов.
   */
  inputPriceMicrosPer1m: number;
  /**
   * Цена за 1M выходных токенов в микро-долларах.
   */
  outputPriceMicrosPer1m: number;
}

const TOKENS_PER_PRICE_UNIT = 1_000_000;

/**
 * Считает стоимость запроса в целых микро-долларах.
 *
 * Цены в БД заданы за 1M токенов. Поэтому:
 *
 *   cost = (promptTokens * inputPrice + completionTokens * outputPrice) / 1M
 *
 * Результат округляется до ближайшего микро-доллара. Для учебного
 * проекта этого достаточно; строгий биллинг обычно использует
 * `ceil` или отдельную точность.
 */
export function calculateCostMicros(input: CostInput): number {
  const inputCost =
    input.promptTokens * input.inputPriceMicrosPer1m;
  const outputCost =
    input.completionTokens * input.outputPriceMicrosPer1m;

  return Math.round(
    (inputCost + outputCost) / TOKENS_PER_PRICE_UNIT,
  );
}
