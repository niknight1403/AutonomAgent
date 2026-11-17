import { calculateNetProfit, evaluateRisk, type ProfitInput, type RiskLimits } from "./index";

export interface DealProduct {
  providerId: string;
  externalId: string;
  title: string;
  url: string;
  currency: string;
  priceMinor: number;
  observedAt: string;
  simulated: boolean;
}

export interface DealCostProfile {
  inboundShippingCents: bigint;
  outboundShippingCents: bigint;
  marketplaceFeeCents: bigint;
  paymentFeeCents: bigint;
  packagingCents: bigint;
  riskReserveCents: bigint;
}

export interface DealScanContext {
  resalePriceCents: bigint;
  openTrades: number;
  dailyLossCents: bigint;
  riskLimits: RiskLimits;
}

export interface DealAnalysis {
  providerId: string;
  externalId: string;
  title: string;
  url: string;
  currency: string;
  observedAt: string;
  simulated: boolean;
  totalCostCents: bigint;
  expectedProfitCents: bigint;
  roiBasisPoints: bigint | null;
  approvedByRiskRules: boolean;
  riskReasons: string[];
}

function toCents(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Provider price must be a non-negative safe integer in minor units");
  }
  return BigInt(value);
}

function validateNonNegative(name: string, value: bigint): void {
  if (value < 0n) throw new Error(`${name} must be non-negative`);
}

/**
 * Converts read-only provider results into transparent deal candidates.
 * This function never reserves funds, places orders, or claims realized profit.
 */
export function analyzeDeals(
  products: readonly DealProduct[],
  costs: DealCostProfile,
  context: DealScanContext,
): DealAnalysis[] {
  for (const [name, value] of Object.entries(costs)) {
    validateNonNegative(name, value);
  }
  validateNonNegative("resalePriceCents", context.resalePriceCents);
  validateNonNegative("dailyLossCents", context.dailyLossCents);
  if (!Number.isInteger(context.openTrades) || context.openTrades < 0) {
    throw new Error("openTrades must be a non-negative integer");
  }

  const seen = new Set<string>();
  return products.map((product) => {
    if (product.currency !== "EUR") {
      throw new Error("Deal scan currently requires EUR prices; currency conversion is not implemented");
    }
    const identity = `${product.providerId}:${product.externalId}`;
    if (seen.has(identity)) throw new Error("Provider returned duplicate product identity");
    seen.add(identity);

    const profitInput: ProfitInput = {
      buyPriceCents: toCents(product.priceMinor),
      ...costs,
      resalePriceCents: context.resalePriceCents,
    };
    const profit = calculateNetProfit(profitInput);
    const reasons = evaluateRisk({
      totalCostCents: profit.totalCostCents,
      expectedProfitCents: profit.netProfitCents,
      roiBasisPoints: profit.roiBasisPoints,
      openTrades: context.openTrades,
      dailyLossCents: context.dailyLossCents,
    }, context.riskLimits);

    return {
      providerId: product.providerId,
      externalId: product.externalId,
      title: product.title,
      url: product.url,
      currency: product.currency,
      observedAt: product.observedAt,
      simulated: product.simulated,
      totalCostCents: profit.totalCostCents,
      expectedProfitCents: profit.netProfitCents,
      roiBasisPoints: profit.roiBasisPoints,
      approvedByRiskRules: reasons.length === 0,
      riskReasons: reasons,
    };
  });
}
