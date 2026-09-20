/**
 * Escapes a value for a CSV cell that may be opened in spreadsheet software.
 *
 * Quoting alone does not stop Excel-compatible programs from evaluating a
 * leading formula character, so prefix potentially executable cells with an
 * apostrophe before applying RFC 4180-style quote escaping.
 *
 * Plain numeric values are exempt from the guard. A bare number (including a
 * negative one like "-2.56") cannot execute as a spreadsheet formula, and the
 * export path passes formatted numbers as strings (e.g. changePct.toFixed(2)).
 * Prefixing those with an apostrophe corrupts the data: spreadsheets store the
 * cell as text with a stray apostrophe instead of a numeric value, breaking
 * every negative 前日比/寄与度 cell in the CSV export.
 */
export function escapeCsvCell(value: unknown): string {
  const raw = String(value ?? "");
  const isPlainNumber = raw.trim() !== "" && Number.isFinite(Number(raw));
  const formulaSafe =
    !isPlainNumber && /^[\s\uFEFF]*[=+\-@|]/u.test(raw) ? `'${raw}` : raw;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
}
