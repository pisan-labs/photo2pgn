// What credits are and what they cost: the one place the app, the terms of
// service and the refund policy take them from (tests/legal.test.ts holds the
// pages to these numbers). 1 credit = one reading of one game, one or two
// photos. Owner, 13 Nov 2026: photo2pgn only; packs chosen by the builder.

export const FREE_PER_DAY = 3;
export const FREE_PER_WEEK = 9;

export interface CreditPack {
  id: string;
  credits: number;
  priceUsd: number;
}

export const CREDIT_PACKS: CreditPack[] = [
  { id: "pack-20", credits: 20, priceUsd: 5 },
  { id: "pack-50", credits: 50, priceUsd: 10 },
];

/** "20 credits for US$5" */
export function packLabel(p: CreditPack): string {
  const price = Number.isInteger(p.priceUsd) ? String(p.priceUsd) : p.priceUsd.toFixed(2);
  return `${p.credits} credits for US$${price}`;
}

/** Days within which an unused pack is refunded in full. */
export const REFUND_DAYS = 14;
