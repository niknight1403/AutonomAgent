import { calculateNetProfit, evaluateRisk } from "./index.js";

export type DemoCandidate = {
  id: string;
  title: string;
  buyPriceCents: bigint;
  resalePriceCents: bigint;
  source: "LOCAL_DEMO";
};

export type DemoResult = {
  candidate: DemoCandidate;
  netProfitCents: bigint;
  roiBasisPoints: bigint | null;
  rejectionReasons: string[];
  listingDrafts: { channel: string; text: string; status: "DRAFT_ONLY" }[];
  reachIdea: string;
  approval: "PENDING_APPROVAL" | "REJECTED";
};

const CATALOG: readonly DemoCandidate[] = [
  { id: "demo-camera", title: "Gebrauchte Kompaktkamera", buyPriceCents: 4_900n, resalePriceCents: 10_900n, source: "LOCAL_DEMO" },
  { id: "demo-lamp", title: "Vintage Tischleuchte", buyPriceCents: 2_900n, resalePriceCents: 4_200n, source: "LOCAL_DEMO" },
  { id: "demo-console", title: "Gebrauchte Spielkonsole", buyPriceCents: 24_900n, resalePriceCents: 32_900n, source: "LOCAL_DEMO" },
];

/** Explicit, deterministic local example. Values are invented, not provider observations. */
export function runLocalDemo(): DemoResult[] {
  return CATALOG.map((candidate) => {
    const profit = calculateNetProfit({
      buyPriceCents: candidate.buyPriceCents,
      resalePriceCents: candidate.resalePriceCents,
      inboundShippingCents: 500n,
      outboundShippingCents: 600n,
      marketplaceFeeCents: 900n,
      paymentFeeCents: 300n,
      packagingCents: 150n,
      riskReserveCents: 500n,
    });
    const rejectionReasons = evaluateRisk({
      totalCostCents: profit.totalCostCents,
      expectedProfitCents: profit.netProfitCents,
      roiBasisPoints: profit.roiBasisPoints,
      openTrades: 0,
      dailyLossCents: 0n,
    }, {
      maxTradeCents: 20_000n,
      maxOpenTrades: 1,
      maxDailyLossCents: 5_000n,
      minProfitCents: 2_000n,
      minRoiBasisPoints: 2_500n,
    });
    return {
      candidate,
      netProfitCents: profit.netProfitCents,
      roiBasisPoints: profit.roiBasisPoints,
      rejectionReasons,
      listingDrafts: rejectionReasons.length ? [] : [
        { channel: "Marktplatz", text: `${candidate.title} · Zustand vor Veröffentlichung prüfen; Bilder und Angaben ergänzen.`, status: "DRAFT_ONLY" as const },
        { channel: "Eigener Shop", text: `${candidate.title} · Beschreibung, Versand und Rückgabe vor Freigabe prüfen.`, status: "DRAFT_ONLY" as const },
      ],
      reachIdea: "Demo-Idee: passende Kategorien und Suchbegriffe prüfen; keine gemessene Reichweite.",
      approval: rejectionReasons.length ? "REJECTED" as const : "PENDING_APPROVAL" as const,
    };
  });
}
