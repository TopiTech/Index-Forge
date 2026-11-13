import { daysInMonth } from "./apiContract";
import { jstDateString } from "./marketCache";

/**
 * Window (in months) used to decide which year a month/day-only event belongs
 * to. An event more than six months behind the current month is next year's
 * event, and one more than six months ahead is last year's.
 */
const YEAR_INFERENCE_WINDOW_MONTHS = 6;

/**
 * Resolve the calendar year of an event that only carries `MM/DD`.
 *
 * The rule is "the occurrence nearest to the current month": a December event
 * seen in January is next year's, a January event seen in December is this
 * year's. Three consumers used to spell this out separately (the month grid,
 * the weekday label and the ICS export), and all three read the *local* clock,
 * so a user west of JST resolved a different year than the rest of the app for
 * the first hours of every month. The current month is the JST month, matching
 * the trading calendar the events are scheduled against.
 *
 * Returns `null` when `month`/`day` is not a real date in the resolved year
 * (February 30, April 31, February 29 of a non-leap year), so callers render
 * no weekday and no calendar entry instead of a date the calendar rolled over.
 */
export function resolveEventYear(
  month: number,
  day: number,
  now: Date = new Date(),
): number | null {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1) return null;

  const [yearText, monthText] = jstDateString(now).split("-");
  const currentYear = Number(yearText);
  const currentMonth = Number(monthText);

  let year = currentYear;
  if (month < currentMonth && currentMonth - month >= YEAR_INFERENCE_WINDOW_MONTHS) {
    year += 1;
  } else if (month > currentMonth && month - currentMonth >= YEAR_INFERENCE_WINDOW_MONTHS) {
    year -= 1;
  }

  if (day > daysInMonth(year, month)) return null;
  return year;
}
