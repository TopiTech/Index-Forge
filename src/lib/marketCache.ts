// Tokyo Stock Exchange regular-session cache policy. Keeping this pure helper
// shared by the Worker and browser prevents browser-side cache decisions from
// overriding the Worker after the market closes.
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MARKET_OPEN_JST = 9 * 60;
const MARKET_CLOSE_JST = 15 * 60 + 30;

function getJstParts(date: Date): { day: number; minutes: number } {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  return {
    day: jst.getUTCDay(),
    minutes: jst.getUTCHours() * 60 + jst.getUTCMinutes(),
  };
}

function secondsUntilNextMarketOpen(day: number, minutes: number): number {
  let minutesUntilOpen: number;
  const isWeekday = day >= 1 && day <= 5;

  if (isWeekday && minutes < MARKET_OPEN_JST) {
    // Weekday morning before 09:00 JST (including Friday): opens today at 09:00 JST.
    minutesUntilOpen = MARKET_OPEN_JST - minutes;
  } else if (day === 5) {
    // Friday after market close through Monday 09:00 JST.
    minutesUntilOpen = 3 * 24 * 60 + MARKET_OPEN_JST - minutes;
  } else if (day === 6) {
    // Saturday through Monday 09:00 JST.
    minutesUntilOpen = 2 * 24 * 60 + MARKET_OPEN_JST - minutes;
  } else if (day === 0) {
    // Sunday through Monday 09:00 JST.
    minutesUntilOpen = 24 * 60 + MARKET_OPEN_JST - minutes;
  } else {
    // Weekday after market close through the following morning 09:00 JST.
    minutesUntilOpen = 24 * 60 + MARKET_OPEN_JST - minutes;
  }
  return Math.max(60, minutesUntilOpen * 60);
}

/** Returns the cache lifetime for a price synchronized at `now`. */
export function getMarketAwareCacheDuration(now: Date = new Date()): number {
  const { day, minutes } = getJstParts(now);
  const isWeekday = day >= 1 && day <= 5;
  if (!isWeekday || minutes < MARKET_OPEN_JST || minutes >= MARKET_CLOSE_JST) {
    // Expire exactly at the next market open instead of rounding to the next
    // whole hour and serving stale data after the market has opened.
    return secondsUntilNextMarketOpen(day, minutes);
  }
  // During trading hours: cache until 30 minutes after market close so fresh
  // closing prices are fetched once the session ends.  The old fixed 12-hour
  // value kept data "fresh" well past the close, which was harmless only
  // because `isPriceCacheFresh` had a secondary guard; using a tighter TTL
  // here makes the function accurate on its own.
  const minutesUntilSettlement = (MARKET_CLOSE_JST + 30) - minutes;
  return Math.max(60, minutesUntilSettlement * 60);
}

/** Maximum tolerated clock skew between browser and Worker (5 minutes). */
export const MAX_CACHE_CLOCK_SKEW_SECONDS = 5 * 60;

/** Determines whether a cached stock-price synchronization is still fresh. */
export function isPriceCacheFresh(nowSec: number, lastSyncedSec: number): boolean {
  if (!Number.isFinite(nowSec) || !Number.isFinite(lastSyncedSec) || nowSec <= 0 || lastSyncedSec <= 0) {
    return false;
  }
  // Clock-skew protection, bounded: a far-future timestamp (corrupt storage)
  // must not mark the cache fresh forever.
  if (nowSec < lastSyncedSec) return lastSyncedSec - nowSec <= MAX_CACHE_CLOCK_SKEW_SECONDS;

  const syncDate = new Date(lastSyncedSec * 1000);
  if (nowSec - lastSyncedSec >= getMarketAwareCacheDuration(syncDate)) {
    return false;
  }

  const sync = getJstParts(syncDate);
  const now = getJstParts(new Date(nowSec * 1000));
  const syncedDuringTrading =
    sync.day >= 1 &&
    sync.day <= 5 &&
    sync.minutes >= MARKET_OPEN_JST &&
    sync.minutes < MARKET_CLOSE_JST;

  if (syncedDuringTrading) {
    const syncJst = new Date(syncDate.getTime() + JST_OFFSET_MS);
    const nowJst = new Date(nowSec * 1000 + JST_OFFSET_MS);
    const isSameDay =
      syncJst.getUTCFullYear() === nowJst.getUTCFullYear() &&
      syncJst.getUTCMonth() === nowJst.getUTCMonth() &&
      syncJst.getUTCDate() === nowJst.getUTCDate();
    if (isSameDay && now.minutes >= MARKET_CLOSE_JST) return false;
  }

  return true;
}
