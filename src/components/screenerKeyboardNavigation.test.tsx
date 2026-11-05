// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ScreenerPage } from "./ScreenerPage";
import { ToastProvider } from "./Toast";

describe("ScreenerPage Keyboard Event Bubbling Isolation (TASK-06)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("triggers onOpenStockDetail when Enter or Space is pressed directly on the table row", () => {
    const onOpenStockDetail = vi.fn();
    const { container } = render(
      <ToastProvider>
        <ScreenerPage onNavigate={vi.fn()} onOpenStockDetail={onOpenStockDetail} />
      </ToastProvider>,
    );

    const rows = container.querySelectorAll<HTMLTableRowElement>("tbody tr.screener-row");
    expect(rows.length).toBeGreaterThan(0);
    const firstRow = rows[0];

    // Pressing Enter directly on the row activates detail view
    fireEvent.keyDown(firstRow, { key: "Enter" });
    expect(onOpenStockDetail).toHaveBeenCalledTimes(1);

    // Pressing Space directly on the row activates detail view
    fireEvent.keyDown(firstRow, { key: " " });
    expect(onOpenStockDetail).toHaveBeenCalledTimes(2);
  });

  it("does NOT trigger onOpenStockDetail when Enter or Space is pressed on child elements (checkbox button)", () => {
    const onOpenStockDetail = vi.fn();
    const { container } = render(
      <ToastProvider>
        <ScreenerPage onNavigate={vi.fn()} onOpenStockDetail={onOpenStockDetail} />
      </ToastProvider>,
    );

    const rows = container.querySelectorAll<HTMLTableRowElement>("tbody tr.screener-row");
    expect(rows.length).toBeGreaterThan(0);
    const firstRow = rows[0];
    const checkboxButton = firstRow.querySelector<HTMLButtonElement>("button[role='checkbox']");
    expect(checkboxButton).not.toBeNull();

    // Keydown on child checkbox must NOT trigger row navigation
    fireEvent.keyDown(checkboxButton!, { key: "Enter" });
    expect(onOpenStockDetail).not.toHaveBeenCalled();

    fireEvent.keyDown(checkboxButton!, { key: " " });
    expect(onOpenStockDetail).not.toHaveBeenCalled();
  });

  it("does NOT trigger onOpenStockDetail when Enter or Space is pressed on mobile card checkbox", () => {
    const onOpenStockDetail = vi.fn();
    const { container } = render(
      <ToastProvider>
        <ScreenerPage onNavigate={vi.fn()} onOpenStockDetail={onOpenStockDetail} />
      </ToastProvider>,
    );

    const mobileCards = container.querySelectorAll<HTMLElement>(".screener-mobile-card");
    expect(mobileCards.length).toBeGreaterThan(0);
    const firstCard = mobileCards[0];
    const mobileCheckbox = firstCard.querySelector<HTMLButtonElement>("button[role='checkbox']");
    expect(mobileCheckbox).not.toBeNull();

    // Keydown on mobile checkbox must NOT trigger card navigation
    fireEvent.keyDown(mobileCheckbox!, { key: "Enter" });
    expect(onOpenStockDetail).not.toHaveBeenCalled();

    fireEvent.keyDown(mobileCheckbox!, { key: " " });
    expect(onOpenStockDetail).not.toHaveBeenCalled();

    // Direct keydown on mobile card activates detail view
    fireEvent.keyDown(firstCard, { key: "Enter" });
    expect(onOpenStockDetail).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(firstCard, { key: " " });
    expect(onOpenStockDetail).toHaveBeenCalledTimes(2);
  });
});
