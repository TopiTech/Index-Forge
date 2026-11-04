/**
 * Contract for the biquote/MQL5 macro-calendar provider.
 *
 * The provider reports the same numeric value in different scales
 * (`unit` + `multiplier` + `digits`), so the raw number is never safe to
 * display as a percentage. This module owns the provider's wire shape, its
 * runtime validation, and the single formatter every value goes through.
 * Keeping it free of Worker/DOM dependencies makes the contract directly
 * testable without mocking the whole calendar endpoint.
 */
import { isRecord } from "../src/lib/apiContract";

/**
 * One item from the live macro-calendar provider.
 *
 * `revisedPrevious` is the provider's revised previous reading, and `revision`
 * is how many times that reading was revised. They are exposed separately
 * from `previous` so consumers that only know the original field keep their
 * existing behavior.
 */
export interface MacroCalendarApiItem {
  time: string;
  countryCode: string;
  name: string;
  unit: string;
  multiplier: string;
  digits: number;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  revisedPrevious: number | null;
  revision: number | null;
}

function toFiniteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toNonNegativeIntegerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export function parseMacroCalendarApiItem(value: unknown): MacroCalendarApiItem | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.time !== "string" ||
    typeof value.countryCode !== "string" ||
    typeof value.name !== "string"
  ) {
    return null;
  }
  const rawDigits = toFiniteNumberOrNull(value.digits);
  return {
    time: value.time,
    countryCode: value.countryCode,
    name: value.name,
    unit: typeof value.unit === "string" ? value.unit : "none",
    multiplier: typeof value.multiplier === "string" ? value.multiplier : "none",
    digits: rawDigits !== null && rawDigits >= 0 && rawDigits <= 6 ? Math.floor(rawDigits) : 2,
    actual: toFiniteNumberOrNull(value.actual),
    forecast: toFiniteNumberOrNull(value.forecast),
    previous: toFiniteNumberOrNull(value.previous),
    revisedPrevious: toFiniteNumberOrNull(value.revisedPrevious),
    revision: toNonNegativeIntegerOrNull(value.revision),
  };
}

function countDecimalPlaces(value: number): number {
  const text = String(value);
  const exponentIndex = text.toLowerCase().indexOf("e-");
  if (exponentIndex >= 0) {
    const fraction = text.slice(0, exponentIndex);
    const dot = fraction.indexOf(".");
    const fractionDigits = dot >= 0 ? fraction.length - dot - 1 : 0;
    return fractionDigits + Number(text.slice(exponentIndex + 2));
  }
  const dot = text.indexOf(".");
  return dot >= 0 ? text.length - dot - 1 : 0;
}

function trimFixedNumber(value: number, digits: number): string {
  if (!Number.isFinite(value)) return "-";
  const normalized = Object.is(value, -0) ? 0 : value;
  const fixed = normalized.toFixed(Math.max(0, Math.min(6, digits)));
  const trimmed = fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
  return trimmed === "-0" ? "0" : trimmed;
}

/**
 * Format a provider value using the provider's unit metadata.
 *
 * `digits` is a maximum for display rounding, but the value's own precision is
 * preserved up to six decimals (the provider marks BoJ's 1.25 with digits=1;
 * rounding that to 1.3 would invent a precision loss that is not in the data).
 */
export function formatMacroCalendarValue(value: number, item: MacroCalendarApiItem): string {
  const unit = item.unit.toLowerCase();
  const multiplier = item.multiplier.toLowerCase();
  let displayValue = value;
  let suffix = "";

  if (unit === "percent") {
    suffix = "%";
  } else if (unit === "job") {
    if (multiplier === "thousands") {
      // 1万人 = 10,000 people; the provider reports thousands.
      displayValue = value / 10;
      suffix = "万人";
    } else if (multiplier === "millions") {
      displayValue = value * 100;
      suffix = "万人";
    } else {
      suffix = "人";
    }
  } else if (multiplier === "thousands") {
    suffix = unit !== "none" && unit !== "job" ? `千${unit}` : "千人";
  } else if (multiplier === "millions") {
    suffix = "百万";
  }

  const decimals = Math.max(item.digits, Math.min(6, countDecimalPlaces(displayValue)));
  return `${trimFixedNumber(displayValue, decimals)}${suffix}`;
}
