import { describe, expect, it } from "vitest";
import { toSafeDownloadFileName, toFiniteNumberOr } from "./downloadFileName";

describe("toSafeDownloadFileName", () => {
  it("keeps ordinary Japanese and ASCII names", () => {
    expect(toSafeDownloadFileName("AI・半導体強化指数")).toBe("AI・半導体強化指数");
  });

  it("replaces reserved filesystem characters", () => {
    expect(toSafeDownloadFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
  });

  it("replaces C0 control characters, DEL, and C1 range with underscores", () => {
    expect(toSafeDownloadFileName("a\u0000b\u001fc\u007fd\u009fe")).toBe("a_b_c_d_e");
  });

  it("falls back when the name is empty or whitespace only", () => {
    expect(toSafeDownloadFileName("", "custom_index")).toBe("custom_index");
    expect(toSafeDownloadFileName("   ", "custom_index")).toBe("custom_index");
  });

  it("caps the name length so the download suffix stays filesystem-safe", () => {
    const long = "x".repeat(500);
    expect(toSafeDownloadFileName(long).length).toBeLessThanOrEqual(80);
  });

  it("never splits a surrogate pair at the length boundary", () => {
    // 79 ASCII characters followed by an astral character (emoji = 2 code
    // units): slicing by code units produced a lone surrogate.
    const name = `${"x".repeat(79)}😀${"y".repeat(10)}`;
    const safe = toSafeDownloadFileName(name);
    expect(safe).toBe(`${"x".repeat(79)}😀`);
    // No lone surrogates may remain.
    for (let i = 0; i < safe.length; i += 1) {
      const code = safe.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = safe.charCodeAt(i + 1);
        expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
        i += 1;
      } else {
        expect(code >= 0xdc00 && code <= 0xdfff).toBe(false);
      }
    }
  });

  it("strips bidi overrides and BOM that could spoof the extension", () => {
    expect(toSafeDownloadFileName("index\u202Egnp.exe")).toBe("index_gnp.exe");
    expect(toSafeDownloadFileName("\uFEFFname\u200F")).toBe("_name_");
    expect(toSafeDownloadFileName("a\u2066b\u2069c")).toBe("a_b_c");
  });

  it("handles undefined-like input gracefully", () => {
    expect(toSafeDownloadFileName(undefined as unknown as string, "fallback")).toBe("fallback");
  });
});

describe("toFiniteNumberOr", () => {
  it("parses ordinary numeric strings", () => {
    expect(toFiniteNumberOr("12", 0)).toBe(12);
    expect(toFiniteNumberOr(" 3.5 ", 0)).toBe(3.5);
    expect(toFiniteNumberOr("-2", 0)).toBe(-2);
  });

  it("returns the fallback for an empty string (cleared number input)", () => {
    expect(toFiniteNumberOr("", 10)).toBe(10);
  });

  it("returns the fallback for partial input that Number rejects", () => {
    expect(toFiniteNumberOr("12.", 10)).toBe(12); // "12." is valid JS numeric syntax
    expect(toFiniteNumberOr("1e", 10)).toBe(10);
    expect(toFiniteNumberOr("abc", 10)).toBe(10);
  });

  it("returns the fallback for null/undefined", () => {
    expect(toFiniteNumberOr(null as unknown as string, 7)).toBe(7);
    expect(toFiniteNumberOr(undefined as unknown as string, 7)).toBe(7);
  });

  it("never returns NaN", () => {
    for (const raw of ["", "abc", "NaN", "Infinity", "1e999"]) {
      expect(Number.isFinite(toFiniteNumberOr(raw, 5))).toBe(true);
    }
  });
});
