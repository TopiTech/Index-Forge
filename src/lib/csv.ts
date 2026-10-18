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
  // アポストロフィ除去は escapeCsvCell が付与する数式ガードのときだけ行う
  // (付与条件 /^[\s\uFEFF]*[=+\-@|]/ と対になるよう、空白/BOM を挟んでよい)。
  // 全セルから機械的に除去すると正当な文字 (例: 'Tis) が失われる。
  const val = wasQuoted ? raw : raw.trim();
  return /^'[\s\uFEFF]*[=+\-@|]/u.test(val) ? val.slice(1) : val;
}

