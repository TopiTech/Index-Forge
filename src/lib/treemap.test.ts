import { describe, expect, it } from "vitest";
import { createTreemapLayout } from "./treemap";

describe("createTreemapLayout", () => {
  it("keeps every tile inside the chart and preserves weighted area", () => {
    const layout = createTreemapLayout([
      { key: "large", value: 60 },
      { key: "medium", value: 30 },
      { key: "small", value: 10 },
    ]);

    expect(layout).toHaveLength(3);
    for (const tile of layout) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.x + tile.width).toBeLessThanOrEqual(1.000001);
      expect(tile.y + tile.height).toBeLessThanOrEqual(1.000001);
    }

    const areas = new Map(layout.map((tile) => [tile.key, tile.width * tile.height]));
    expect(areas.get("large")! / areas.get("small")!).toBeCloseTo(6, 4);
    expect(areas.get("medium")! / areas.get("small")!).toBeCloseTo(3, 4);
  });

  it("returns visible fallback tiles when all values are zero", () => {
    const layout = createTreemapLayout([
      { key: "first", value: 0 },
      { key: "second", value: 0 },
    ]);

    expect(layout).toHaveLength(2);
    expect(layout[0].width * layout[0].height).toBeGreaterThan(0);
    expect(layout[1].width * layout[1].height).toBeGreaterThan(0);
  });

  it("returns empty array for empty inputs without error or division-by-zero", () => {
    expect(createTreemapLayout([])).toEqual([]);
  });

  it("handles a single tile occupying the full layout", () => {
    const layout = createTreemapLayout([{ key: "only", value: 100 }]);
    expect(layout).toHaveLength(1);
    expect(layout[0].x).toBe(0);
    expect(layout[0].y).toBe(0);
    expect(layout[0].width).toBeCloseTo(1, 4);
    expect(layout[0].height).toBeCloseTo(1, 4);
  });
});
