/**
 * Regression tests for the mobile/tablet chrome fixes:
 *
 * - the header control cluster (menu/login) must stay reachable in the
 *   769–1080px band, where `body { overflow-x: hidden }` would otherwise clip
 *   the overflowing controls off-screen;
 * - the fullscreen ⌘K search must not be centred inside a padded overlay
 *   (which clipped ~16px off every edge);
 * - toasts must clear the fixed bottom nav on phones;
 * - the mobile result lists need a role their `aria-label` is allowed on.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

function section(startMarker: string, length = 2500): string {
  const start = css.indexOf(startMarker);
  expect(start, `marker not found: ${startMarker}`).toBeGreaterThan(-1);
  return css.slice(start, start + length);
}

describe("header control cluster at 769–1080px", () => {
  const headerSection = section("keep the menu/login controls on screen");

  it("drops the duplicated desktop status row for the whole ≤1080 range", () => {
    expect(headerSection).toMatch(
      /@media \(max-width: 1080px\) \{\s*\.header-status-desktop \{[^}]*display:\s*none !important;/,
    );
  });

  it("lets the brand yield space and wraps the row as a safety net", () => {
    expect(headerSection).toMatch(/\.header-brand \{[^}]*flex-shrink:\s*1;/);
    expect(headerSection).toMatch(
      /@media \(min-width: 769px\) and \(max-width: 1080px\) \{\s*\.header-inner-row \{[^}]*flex-wrap:\s*wrap;/,
    );
  });
});

describe("fullscreen global search overlay", () => {
  it("removes the overlay padding so the 100vw/100dvh dialog is not clipped", () => {
    expect(css).toMatch(
      /@media \(max-width: 768px\)[\s\S]*?\.modal-overlay:has\(\.global-search-modal\) \{\s*padding:\s*0 !important;/,
    );
    // The dialog itself still fills the viewport (pinned by an existing test).
    expect(css).toMatch(
      /\.global-search-modal \{\s*width: 100vw !important;\s*height: 100dvh !important;/,
    );
  });
});

describe("toast placement above the fixed bottom nav", () => {
  it("offsets the toast container by the nav height plus safe-area inset", () => {
    expect(css).toMatch(
      /@media \(max-width: 768px\)[\s\S]*?\.toast-container \{\s*bottom: calc\(56px \+ env\(safe-area-inset-bottom, 0px\) \+ 12px\);/,
    );
  });
});

describe("mobile result list semantics", () => {
  const screener = readFileSync(
    resolve(process.cwd(), "src/components/ScreenerPage.tsx"),
    "utf8",
  );
  const portfolio = readFileSync(
    resolve(process.cwd(), "src/components/PortfolioManagerPage.tsx"),
    "utf8",
  );
  const constituents = readFileSync(
    resolve(process.cwd(), "src/components/ConstituentsTable.tsx"),
    "utf8",
  );

  it("labels the screener card container with a role that permits aria-label", () => {
    // Cards are role="button" containers, so the wrapper must be a group:
    // aria-label is prohibited on the generic default role, and role="list"
    // would require listitem children.
    expect(screener).toMatch(/className="screener-mobile-list"\s+role="group"\s+aria-label="/);
    expect(screener).not.toMatch(/className="screener-mobile-list" aria-label="/);
  });

  it("exposes the portfolio holdings as a labelled list", () => {
    expect(portfolio).toMatch(/className="portfolio-mobile-list"\s+role="list"\s+aria-label="/);
    expect(portfolio).toMatch(/role="listitem"\s+className="portfolio-mobile-card"/);
  });

  it("exposes the constituents as a labelled list (group while empty)", () => {
    expect(constituents).toMatch(/role=\{filteredAndSorted\.length > 0 \? "list" : "group"\}/);
    expect(constituents).toMatch(/role="listitem"\s+className="constituent-mobile-card"/);
  });
});
