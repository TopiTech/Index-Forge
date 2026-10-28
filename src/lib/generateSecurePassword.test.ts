/**
 * N-5: generateSecurePassword の拒否サンプリング (rejection sampling) 検証。
 *
 * 従来は `uint32 % 54` で文字を選んでいたが、2^32 が 54 で割り切れないため
 * 剰余 0〜21 の文字がわずかに選ばれやすいモジュロバイアスがあった。本スイート
 * は決定的な乱数シーケンスで「偏りを生む上端の乱数が棄却されること」を検証し、
 * 一様性の回復を回帰防止する (実在 crypto の互換性は comprehensiveAuditFixes
 * 側で既に検証済み)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateSecurePassword } from "./auth";

const CHARS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CHARS_LENGTH = CHARS.length; // 55。2^32 mod 55 = 26 → 単純な % ではバイアスが生じる
const UNIFORM_BOUND = Math.floor(0x1_0000_0000 / CHARS_LENGTH) * CHARS_LENGTH; // 4,294,967,270

/**
 * `crypto.getRandomValues` を決定的な値の列に差し替える。
 * 列を使い切るとテスト不備として明示的に throw する (暗黙の繰り返しで
 * 引き直しの検証が空振りするのを防ぐ)。
 */
function stubRandomValues(sequence: number[]): number[] {
  const consumed: number[] = [];
  let offset = 0;
  vi.stubGlobal("crypto", {
    getRandomValues(array: Uint32Array): Uint32Array {
      for (let i = 0; i < array.length; i++) {
        if (offset >= sequence.length) {
          throw new Error("stub sequence exhausted");
        }
        const value = sequence[offset++];
        array[i] = value;
        consumed.push(value);
      }
      return array;
    },
  });
  return consumed;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateSecurePassword rejection sampling (N-5)", () => {
  it("discards the biased high-end values and redraws instead of taking the modulo", () => {
    // 0xFFFFFFFF (= 4,294,967,295) は uniformBound 以上 → 棄却される。
    // 旧実装なら chars[4294967295 % 54] = chars[21] = "v" が返っていた。
    const consumed = stubRandomValues([0xffff_ffff, 0]);

    expect(generateSecurePassword(1)).toBe(CHARS[0]); // "a"
    // 1 文字目は棄却され、2 回目の引き直しで採用されている
    expect(consumed).toEqual([0xffff_ffff, 0]);
  });

  it("accepts the value exactly below the bound and rejects the bound itself", () => {
    // 下限側の境界: uniformBound - 1 は採用 (剰余 = charsLength - 1 = 最後の文字)
    stubRandomValues([UNIFORM_BOUND - 1]);
    expect(generateSecurePassword(1)).toBe(CHARS[CHARS_LENGTH - 1]); // "9"

    // uniformBound 自体は剰余の偏りを生むため棄却 → 境界が 1 過ぎても 1 足り
    // なくても動く
    const consumed = stubRandomValues([UNIFORM_BOUND, UNIFORM_BOUND - 1]);
    expect(generateSecurePassword(1)).toBe(CHARS[CHARS_LENGTH - 1]);
    expect(consumed).toEqual([UNIFORM_BOUND, UNIFORM_BOUND - 1]);
  });

  it("maps every residue of the accepted range onto the full charset exactly once", () => {
    // 0..53 を順に渡すと文字セットが順序どおりに 1 周する = 各文字が同じ確率で
    // 到達できることの決定的な証明 (統計テストに頼らない一様性の回帰防止)。
    const sequence = Array.from({ length: CHARS_LENGTH }, (_, i) => i);
    stubRandomValues(sequence);

    expect(generateSecurePassword(CHARS_LENGTH)).toBe(CHARS);
  });

  it("keeps the charset, length semantics and error contract compatible", () => {
    // 長さの互換性 (実在 crypto)
    expect(generateSecurePassword(0)).toBe("");
    expect(generateSecurePassword(12)).toHaveLength(12);
    for (const char of generateSecurePassword(32)) {
      expect(CHARS.includes(char)).toBe(true);
    }

    // 不正な長さは RangeError (旧実装の new Uint32Array(length) と同型)
    expect(() => generateSecurePassword(-1)).toThrow(RangeError);
    expect(() => generateSecurePassword(1.5)).toThrow(RangeError);
    expect(() => generateSecurePassword(Number.NaN)).toThrow(RangeError);
  });

  it("keeps each drawn value's residue in range on the real path", () => {
    // 棄却ループの残りパス (1 バッチで収まる場合) も壊れていないことの実在 crypto
    // によるスモーク。文字集合と長さの契約は comprehensiveAuditFixes 側と共有。
    const pwd = generateSecurePassword(10);
    expect(pwd).toHaveLength(10);
    expect(new Set(pwd.split("")).size).toBeGreaterThanOrEqual(4);
  });
});
