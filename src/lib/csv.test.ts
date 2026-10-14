import { describe, expect, it } from "vitest";
import { escapeCsvCell, parseCsv } from "./csv";

describe("escapeCsvCell", () => {
  // "-10" is intentionally absent: it is a plain numeric string and cannot
  // execute as a formula, so it must export as a numeric cell (see the
  // regression test below) rather than as apostrophe-prefixed text.
  it.each(["=SUM(A1:A2)", "+CMD()", "@SUM(A1:A2)", " =1+1", "\t=1+1", "\uFEFF=1+1", "|' /C calc'!A0"])(
    "prevents spreadsheet formula evaluation for %s",
    (value) => {
      expect(escapeCsvCell(value)).toBe(`"'${value}"`);
    },
  );

  it("exports plain numeric values (number or numeric string) as numeric cells", () => {
    // Regression: the export path formats numbers with toFixed(2), which
    // produces strings. Negative values like "-2.56" used to trigger the
    // formula guard and were exported as "'-2.56" (text with a stray
    // apostrophe), corrupting every losing stock's 前日比/寄与度 column in
    // spreadsheet software. A bare number cannot be a formula, so it must
    // keep its numeric form.
    expect(escapeCsvCell(-2.56)).toBe('"-2.56"');
    expect(escapeCsvCell("-2.56")).toBe('"-2.56"');
    expect(escapeCsvCell((-6.96).toFixed(2))).toBe('"-6.96"');
    expect(escapeCsvCell(-10)).toBe('"-10"');
    expect(escapeCsvCell(0)).toBe('"0"');
    expect(escapeCsvCell(15)).toBe('"15"');
    expect(escapeCsvCell((15).toFixed(2))).toBe('"15.00"');
    expect(escapeCsvCell(1234.5678)).toBe('"1234.5678"');
  });

  it("guards non-numeric text that merely starts with a hyphen or plus", () => {
    // Text is data, not a number literal: hyphen/plus-prefixed prose could
    // still be attacker-controlled, so the apostrophe guard must stay.
    expect(escapeCsvCell("-foo")).toBe("\"'-foo\"");
    expect(escapeCsvCell("+bar")).toBe("\"'+bar\"");
    expect(escapeCsvCell("通常のテキスト")).toBe('"通常のテキスト"');
  });

  it("does not prefix non-finite numeric values", () => {
    // NaN/Infinity degrade to their string form; Number("NaN") is NaN, so
    // they are not treated as numeric cells.
    expect(escapeCsvCell(Number.NaN)).toBe('"NaN"');
  });

  it("quotes ordinary text and escapes embedded quotes", () => {
    expect(escapeCsvCell('A "quoted" company')).toBe('"A ""quoted"" company"');
  });
});

describe("parseCsv (RFC 4180)", () => {
  it("handles basic comma-separated rows", () => {
    const csv = "a,b,c\n1,2,3";
    expect(parseCsv(csv)).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles CRLF line breaks", () => {
    const csv = "col1,col2\r\nval1,val2\r\nval3,val4";
    expect(parseCsv(csv)).toEqual([
      ["col1", "col2"],
      ["val1", "val2"],
      ["val3", "val4"],
    ]);
  });

  it("handles multi-line fields enclosed in quotes without splitting the row", () => {
    const csv = 'code,notes\n"7203","Line 1\nLine 2"\n"9984","Single line"';
    const parsed = parseCsv(csv);
    expect(parsed).toEqual([
      ["code", "notes"],
      ["7203", "Line 1\nLine 2"],
      ["9984", "Single line"],
    ]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    const csv = 'name,desc\n"Toyota","The ""best"" maker"';
    expect(parseCsv(csv)).toEqual([
      ["name", "desc"],
      ["Toyota", 'The "best" maker'],
    ]);
  });

  it("strips UTF-8 BOM if present", () => {
    const csv = '\uFEFFticker,name\n"AAPL","Apple"';
    expect(parseCsv(csv)).toEqual([
      ["ticker", "name"],
      ["AAPL", "Apple"],
    ]);
  });

  it("strips formula injection protection apostrophes", () => {
    const csv = 'formula,calc\n"\'+SUM(A1:A2)","\'-2.56"';
    expect(parseCsv(csv)).toEqual([
      ["formula", "calc"],
      ["+SUM(A1:A2)", "-2.56"],
    ]);
  });

  it("returns empty array for empty or whitespace-only input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("   \n\n\r\n  ")).toEqual([]);
  });

  it("ignores trailing empty lines", () => {
    const csv = "a,b\n1,2\n\n\n";
    expect(parseCsv(csv)).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

