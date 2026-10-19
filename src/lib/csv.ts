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
 *
 * A value that already starts with an apostrophe is guarded as well: the
 * reader has to be able to tell an exporter-applied guard apart from a
 * legitimate leading apostrophe, otherwise "'-review" loses its apostrophe on
 * every round trip.
 */
export function escapeCsvCell(value: unknown): string {
  const raw = String(value ?? "");
  const isPlainNumber = raw.trim() !== "" && Number.isFinite(Number(raw));
  const startsWithFormulaChar = /^[\s\uFEFF]*[=+\-@|]/u.test(raw);
  const startsWithApostrophe = raw.startsWith("'");
  const formulaSafe =
    !isPlainNumber && (startsWithFormulaChar || startsWithApostrophe) ? `'${raw}` : raw;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
}

/**
 * Parses a CSV string conforming to RFC 4180.
 *
 * Supports:
 * - Multi-line fields inside quotes (`"line1\nline2"`)
 * - Escaped quotes (`""` -> `"`)
 * - CRLF (`\r\n`), LF (`\n`), and CR (`\r`) line breaks
 * - Strips UTF-8 BOM if present
 * - Un-escapes spreadsheet formula injection guards (leading apostrophe)
 * - Safely handles edge cases like trailing commas and trailing newlines
 */
export function parseCsv(text: string): string[][] {
  const stripped = typeof text === "string" ? text.replace(/^\uFEFF/, "") : "";
  if (!stripped.trim()) {
    return [];
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let insideQuotes = false;
  let fieldWasQuoted = false;

  for (let i = 0; i < stripped.length; i++) {
    const char = stripped[i];

    if (insideQuotes) {
      if (char === '"') {
        if (i + 1 < stripped.length && stripped[i + 1] === '"') {
          currentField += '"';
          i++; // skip escaped quote
        } else {
          insideQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
        fieldWasQuoted = true;
      } else if (char === ",") {
        currentRow.push(cleanParsedCell(currentField, fieldWasQuoted));
        currentField = "";
        fieldWasQuoted = false;
      } else if (char === "\r") {
        if (i + 1 < stripped.length && stripped[i + 1] === "\n") {
          i++;
        }
        currentRow.push(cleanParsedCell(currentField, fieldWasQuoted));
        currentField = "";
        fieldWasQuoted = false;
        rows.push(currentRow);
        currentRow = [];
      } else if (char === "\n") {
        currentRow.push(cleanParsedCell(currentField, fieldWasQuoted));
        currentField = "";
        fieldWasQuoted = false;
        rows.push(currentRow);
        currentRow = [];
      } else {
        currentField += char;
      }
    }
  }

  // Push final field / row if pending
  if (currentField.length > 0 || currentRow.length > 0 || fieldWasQuoted) {
    currentRow.push(cleanParsedCell(currentField, fieldWasQuoted));
    rows.push(currentRow);
  }

  // Filter out any trailing empty lines (e.g. trailing newlines at end of file)
  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 0 || (last.length === 1 && last[0].trim() === "")) {
      rows.pop();
    } else {
      break;
    }
  }

  return rows;
}

function cleanParsedCell(raw: string, wasQuoted: boolean): string {
  // クォート済みフィールドは RFC 4180 に従い原文を保持する (前後空白は有意)。
  // アポストロフィ除去は escapeCsvCell が付与するガードのときだけ行う。
  // escapeCsvCell は 2 種類を保護する:
  //   1) 空白/BOM の後に数式文字 ( = + - @ | ) がある → 先頭に ' を付与
  //   2) 値が ' で始まる → 先頭に ' を付与 (正当な先頭アポストロフィと
  //      区別するために必要)
  // 除去側はこの 2 種類の正確な逆として実装する。
  const val = wasQuoted ? raw : raw.trim();
  if (val.startsWith("''")) {
    // escapeCsvCell が先頭アポストロフィを保護するために付けた ' を 1 つ戻す。
    return val.slice(1);
  }
  return /^'[\s\uFEFF]*[=+\-@|]/u.test(val) ? val.slice(1) : val;
}
