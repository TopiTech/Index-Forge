import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chartModalSource = readFileSync(
  new URL("./TradingViewChartModal.tsx", import.meta.url),
  "utf8",
);
const tutorialPageSource = readFileSync(new URL("./TutorialPage.tsx", import.meta.url), "utf8");
const tutorialCanvasSource = readFileSync(
  new URL("./Tutorial3DCanvas.tsx", import.meta.url),
  "utf8",
);
const modalBaseSource = readFileSync(new URL("./ModalBase.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const uiSource = readFileSync(new URL("./ui.tsx", import.meta.url), "utf8");
const simulationSource = readFileSync(
  new URL("./SimulationPreview.tsx", import.meta.url),
  "utf8",
);
const themeControlsSource = readFileSync(
  new URL("./ThemeControls.tsx", import.meta.url),
  "utf8",
);
const constituentsSource = readFileSync(
  new URL("./ConstituentsTable.tsx", import.meta.url),
  "utf8",
);
const cssSource = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const adminSource = readFileSync(new URL("./AdminDashboard.tsx", import.meta.url), "utf8");
const builderSource = readFileSync(
  new URL("./IndexBuilderContent.tsx", import.meta.url),
  "utf8",
);
const errorFallbackSource = readFileSync(
  new URL("./ErrorFallback.tsx", import.meta.url),
  "utf8",
);
const performanceChartSource = readFileSync(
  new URL("./PerformanceChart.tsx", import.meta.url),
  "utf8",
);

/**
 * Regression guards for defects found in the comprehensive UI review.
 *
 * These assert the structural properties that produced the bugs, so the
 * failures recur if the fixes are undone.
 */
describe("TradingView chart modal resize re-entrancy", () => {
  it("guards the synthetic resize dispatch against re-entrancy", () => {
    // The window "resize" listener calls notifyTradingViewResize() when the card
    // is maximized. Without a guard that dispatch re-entered the listener and
    // recursed until "Maximum call stack size exceeded" froze the tab.
    expect(chartModalSource).toContain("isNotifyingResizeRef");
    expect(chartModalSource).toMatch(
      /if \(isNotifyingResizeRef\.current\) return;[\s\S]{0,200}isNotifyingResizeRef\.current = true;[\s\S]{0,400}finally \{[\s\S]{0,120}isNotifyingResizeRef\.current = false;/,
    );
  });

  it("keeps the resize handler free of impure state updaters", () => {
    // Side effects (localStorage write + global event dispatch) inside a
    // setState updater re-entered the listener while the update queue was still
    // being built.
    const handler = chartModalSource.slice(
      chartModalSource.indexOf("const handleWindowResize"),
      chartModalSource.indexOf("const handleResizePointerDown"),
    );
    expect(handler).not.toMatch(/setDimensions\(\s*\(\s*current\s*\)\s*=>/);
    expect(handler).toContain("saveDimensions(clamped)");
  });
});

describe("Tutorial keyboard handling", () => {
  it("does not let the 3D canvas and the page both consume the same arrow key", () => {
    // The canvas calls preventDefault() (which does not stop propagation) for
    // the same arrows the page uses for step navigation. A single ArrowRight
    // both rotated the camera and advanced the tutorial — and finished it on the
    // last step.
    expect(tutorialCanvasSource).toContain('case "ArrowRight"');
    expect(tutorialPageSource).toContain("if (e.defaultPrevented) return;");
    expect(tutorialPageSource).toContain('closest(".tutorial-3d-container")');
  });
});

describe("dialog accessible names", () => {
  it("labels the dialog from its heading when no explicit label is passed", () => {
    expect(modalBaseSource).toContain("aria-labelledby={resolvedLabelledBy}");
    expect(modalBaseSource).toMatch(/<h2 className="modal-title" id=\{titleId\}>/);
  });

  it("keeps an explicit ariaLabel authoritative", () => {
    expect(modalBaseSource).toContain("aria-label={ariaLabel}");
  });
});

describe("Card forwards aria props", () => {
  it("does not drop aria-label passed to the Card wrapper", () => {
    // aria-label on a role="region" is ignored by assistive technology, so a
    // silently dropped label removed the landmark from the screen-reader rotor.
    expect(uiSource).toContain("aria-label={ariaLabel}");
    expect(uiSource).toContain("aria-describedby={ariaDescribedBy}");
  });
});

describe("mobile sidebar focus handoff", () => {
  it("does not steal focus back from a modal that the close just opened", () => {
    expect(appSource).toMatch(
      /if \(!document\.querySelector\("\[data-modal-dialog\]"\)\) \{\s*sidebarToggleRef\.current\?\.focus\(\);/,
    );
  });
});

describe("simulation timeframe selected state", () => {
  it("exposes the active period to assistive technology", () => {
    expect(simulationSource).toContain("aria-pressed={timeframe === tf.value}");
    expect(simulationSource).toContain('aria-label="シミュレーションの表示期間"');
  });
});

describe("accent palette focus management", () => {
  it("returns focus to the toggle when the popover closes", () => {
    expect(themeControlsSource).toContain("toggleRef.current?.focus()");
    expect(themeControlsSource).toContain("ref={toggleRef}");
  });
});

describe("sortable table headers", () => {
  it("does not rename column headers via aria-label", () => {
    // aria-label replaces the header text as the accessible name for the whole
    // column, so screen readers announced "コードで並べ替え" instead of "コード".
    expect(constituentsSource).not.toMatch(/aria-label="[^"]*で並べ替え"/);
    // The sort affordance stays available via aria-sort and the title hint.
    expect(constituentsSource).toContain("aria-sort=");
  });
});

describe("heatmap mobile layout", () => {
  it("does not force a minimum tile size that breaks the percentage treemap", () => {
    const mobileBlock = cssSource.slice(cssSource.indexOf("/* 7. Theme Heatmap Mobile Polish"));
    expect(mobileBlock).toMatch(/\.heatmap-tile\s*\{[\s\S]{0,400}?min-width:\s*0;/);
    expect(mobileBlock).not.toMatch(/\.heatmap-tile\s*\{[\s\S]{0,400}?min-width:\s*3[0-9]px;/);
  });
});

describe("admin limit presets", () => {
  it("exposes the active preset instead of signalling it by colour only", () => {
    expect(adminSource).toContain("aria-pressed={newUserMaxStocks === preset}");
    expect(adminSource).toContain("aria-pressed={newUserMaxStocks === null}");
    expect(adminSource).toContain("aria-pressed={newUserMaxIndices === preset}");
    expect(adminSource).toContain("aria-pressed={newUserMaxIndices === null}");
  });
});

describe("builder mobile tablist", () => {
  it("wires tabs and panels together with the ARIA tabs pattern", () => {
    // Without aria-controls/aria-labelledby the screen reader announced
    // "tab, selected, 1 of 2" with no indication of the controlled panel and
    // no way to move between tabs except Tab.
    expect(builderSource).toContain('aria-controls="builder-panel-builder"');
    expect(builderSource).toContain('aria-controls="builder-panel-simulation"');
    expect(builderSource).toContain('role="tabpanel"');
    expect(builderSource).toContain('aria-labelledby="builder-tab-builder"');
    expect(builderSource).toContain('aria-labelledby="builder-tab-simulation"');
    expect(builderSource).toContain("tabIndex={activeTab === \"builder\" ? 0 : -1}");
  });

  it("supports arrow-key navigation between the tabs", () => {
    expect(builderSource).toContain("handleMobileTabKeyDown");
    expect(builderSource).toMatch(
      /e\.key === "ArrowRight" \|\| e\.key === "ArrowDown"|current === "builder" \? "simulation" : "builder"/,
    );
  });
});

describe("explicit button types", () => {
  it("does not let action buttons default to type=submit", () => {
    for (const [name, source] of [
      ["ErrorFallback", errorFallbackSource],
      ["PerformanceChart", performanceChartSource],
    ] as const) {
      for (const match of source.matchAll(/<button\b[^>]*>/g)) {
        expect(`${name}: ${match[0]}`, `${name} button must declare type`).toMatch(/type="/);
      }
    }
  });
});
