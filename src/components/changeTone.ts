/**
 * Zero-safe tone helpers for signed market values (UI-28).
 *
 * A 0% move is neither a gain nor a loss. Formatting it as `-0.0%` or colouring
 * it green/red with a `+` prefix claimed a direction the data does not support,
 * which is exactly what the UI-28 finding reported for the market overview, the
 * portfolio P&L and the simulation drawdown.
 *
 * This module lives next to the components that consume it (it is shared by
 * MarketOverviewPage / PortfolioManagerPage / SimulationPreview) so the three
 * pages cannot drift apart again.
 */

export type ChangeTone = "positive" | "negative" | "neutral";

/**
 * Resolve the display tone of a signed number.
 *
 * `digits` is the number of decimals the value is rendered with: anything that
 * rounds to zero at that precision is neutral. That is what keeps a raw
 * `-0.0001` (rendered as `0.00`) out of the "loss" bucket, and it makes `-0`
 * neutral as well.
 */
export function changeTone(value: number | null | undefined, digits = 2): ChangeTone {
  if (typeof value !== "number" || !Number.isFinite(value)) return "neutral";
  if (Object.is(value, -0)) return "neutral";
  const safeDigits = Math.max(0, Math.trunc(digits));
  const halfUnitAtPrecision = 0.5 / Math.pow(10, safeDigits);
  if (Math.abs(value) < halfUnitAtPrecision) return "neutral";
  return value > 0 ? "positive" : "negative";
}

/**
 * Format a percentage with a sign that matches its tone.
 * Neutral values are printed without a sign and without a `-0.00` artefact.
 */
export function formatSignedPercent(value: number, digits = 2): string {
  const tone = changeTone(value, digits);
  if (tone === "neutral") return `${(0).toFixed(digits)}%`;
  return `${tone === "positive" ? "+" : ""}${value.toFixed(digits)}%`;
}

/**
 * Format a signed amount (e.g. a P&L figure) with a tone-aware `+` prefix.
 * Zero and near-zero amounts carry no sign at all.
 */
export function formatSignedAmount(value: number, format: (n: number) => string): string {
  const tone = changeTone(value, 2);
  if (tone === "neutral") return format(0);
  return `${tone === "positive" ? "+" : ""}${format(value)}`;
}

/**
 * Format a drawdown magnitude as a percentage with a leading minus sign.
 * A zero (or a value that rounds to zero) is printed as `0.0%`, never `-0.0%`.
 */
export function formatDrawdownPercent(magnitude: number, digits = 1): string {
  const safe = Number.isFinite(magnitude) ? Math.abs(magnitude) : 0;
  if (changeTone(safe, digits) === "neutral") return `${(0).toFixed(digits)}%`;
  return `-${safe.toFixed(digits)}%`;
}
