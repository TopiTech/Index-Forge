/**
 * Builds a safe download file name from arbitrary user-supplied text.
 *
 * Control characters and reserved filesystem characters are replaced with "_",
 * the result is trimmed, clamped to a conservative length, and a fallback is
 * used when nothing usable remains. Download file names flow into DOM
 * attributes and OS-level paths, so unbounded or control-character input from
 * an index name must never reach them verbatim.
 */
export function toSafeDownloadFileName(raw: string, fallback = "download"): string {
  const characters = Array.from(raw ?? "", (character) => {
    const code = character.codePointAt(0) ?? 0;
    // C0/C1 control characters and DEL are unusable in file names.
    if (code <= 31 || (code >= 127 && code <= 159)) return "_";
    // BOM and bidi/format controls are invisible and can make a file name
    // display differently from its real bytes (e.g. a spoofed extension).
    if (
      code === 0xfeff ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      return "_";
    }
    return character;
  });

  const cleaned = characters
    .join("")
    .replace(/[/\\?%*:|"<>]/g, "_")
    .trim();
  // The suffix (_constituents_YYYY-MM-DD.csv) adds roughly 30 characters; keep
  // the user portion modest so total length stays filesystem-safe. Clamp by
  // code points so an astral character (emoji) is never split into lone
  // surrogates at the boundary.
  const clamped = Array.from(cleaned).slice(0, 80).join("");
  return clamped.length > 0 ? clamped : fallback;
}

/**
 * Parses a numeric input value without ever producing NaN.
 *
 * `<input type="number">` reports "" while the user is clearing the field and
 * partial values such as "12." while typing; Number("") is 0 (not the intended
 * fallback) and Number("12.") is NaN. A NaN that reaches state would poison
 * saved baskets, quota settings, and index calculations, so every numeric
 * input handler funnels through this helper.
 */
export function toFiniteNumberOr(raw: unknown, fallback: number): number {
  if (raw === null || raw === undefined) return fallback;
  const trimmed = String(raw).trim();
  if (trimmed === "") return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}
