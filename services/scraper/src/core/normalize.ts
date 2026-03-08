import type { Money } from "../types";

export function parseMoney(value?: string, currency = "USD"): Money | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[^0-9.]/g, "");
  if (!cleaned) return undefined;
  const amount = Number.parseFloat(cleaned);
  if (Number.isNaN(amount)) return undefined;
  return { amount, currency };
}

export function toNumber(value?: string | number): number | undefined {
  if (value === undefined || value === null) return undefined;
  const num = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isNaN(num) ? undefined : num;
}
