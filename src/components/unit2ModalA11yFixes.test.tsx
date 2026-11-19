// @vitest-environment jsdom
/**
 * Behavioural regressions for the UI-2 review items C2 (background inert),
 * C3 (Sidebar Escape must not steal a modal's Escape), and C9 (label/control
 * parity in EditPasswordModal). Queries use rendered DOM only — no source
 * string assertions.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { useState } from "react";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { ModalBase } from "./ModalBase";
import { Sidebar } from "./Sidebar";
import { EditPasswordModal } from "./EditPasswordModal";
import { ConfirmModal } from "./ConfirmModal";
import { useModalFocus } from "../hooks/useModalFocus";

function isBackgroundHidden(element: HTMLElement): boolean {
  return element.hasAttribute("inert") || element.getAttribute("aria-hidden") === "true";
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
  localStorage.clear();
});

describe("C2: modal background is inert", () => {
  it("hides the app shell while a dialog is open and restores it on close", () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" data-testid="toggle" onClick={() => setOpen((v) => !v)}>
            背景の切り替え
          </button>
          <ModalBase isOpen={open} onClose={() => setOpen(false)} title="テストダイアログ">
            <button type="button">ダイアログ内</button>
          </ModalBase>
        </>
      );
    }
    const { container } = render(<Harness />);
    expect(isBackgroundHidden(container)).toBe(true);

    const dialog = document.querySelector<HTMLElement>("[data-modal-dialog]");
    expect(dialog).not.toBeNull();
    expect(isBackgroundHidden(dialog as HTMLElement)).toBe(false);

    fireEvent.click(container.querySelector<HTMLElement>('[data-testid="toggle"]') as HTMLElement);
    expect(isBackgroundHidden(container)).toBe(false);
    expect(document.querySelectorAll("[data-modal-dialog]")).toHaveLength(0);
  });

  it("keeps the background inert until the innermost of nested dialogs closes", () => {
    function Harness() {
      const [outer, setOuter] = useState(true);
      const [inner, setInner] = useState(true);
      return (
        <>
          <button type="button" data-testid="close-outer" onClick={() => setOuter(false)}>
            外側を閉じる
          </button>
          <ModalBase isOpen={outer} onClose={() => setOuter(false)} title="外側">
            <button type="button">外側の内容</button>
          </ModalBase>
          <ModalBase isOpen={inner} onClose={() => setInner(false)} title="内側">
            <button type="button" data-testid="close-inner" onClick={() => setInner(false)}>
              内側を閉じる
            </button>
          </ModalBase>
        </>
      );
    }
    const { container } = render(<Harness />);
    expect(document.querySelectorAll("[data-modal-dialog]")).toHaveLength(2);
    expect(isBackgroundHidden(container)).toBe(true);

    // Close the outer dialog first: the inner one still owns the lock.
    fireEvent.click(container.querySelector<HTMLElement>('[data-testid="close-outer"]') as HTMLElement);
    expect(document.querySelectorAll("[data-modal-dialog]")).toHaveLength(1);
    expect(isBackgroundHidden(container)).toBe(true);

    fireEvent.click(screen.getByTestId("close-inner"));
    expect(document.querySelectorAll("[data-modal-dialog]")).toHaveLength(0);
    expect(isBackgroundHidden(container)).toBe(false);
  });

  it("applies the same background protection to a hand-built dialog using the hook", () => {
    const { container } = render(
      <EditPasswordModal
        isOpen
        onClose={() => {}}
        item={{
          id: "user-1",
          name: "ユーザー",
          role: "user",
          max_stocks: 10,
          max_indices: 5,
          is_active: 1,
          created_at: 1700000000,
        }}
        onSuccess={() => {}}
        getHeaders={() => ({})}
      />,
    );
    expect(document.querySelector("[data-modal-dialog]")).not.toBeNull();
    expect(isBackgroundHidden(container)).toBe(true);
  });
});

describe("C3: Sidebar Escape defers to an open modal", () => {
  const renderHarness = (modalOpen: boolean, onRequestClose: () => void, onModalClose: () => void) =>
    render(
      <>
        <Sidebar
          currentView="market"
          navigateTo={() => {}}
          isOpen
          onRequestClose={onRequestClose}
        />
        <ModalBase isOpen={modalOpen} onClose={onModalClose} title="モーダル">
          <button type="button">モーダル内</button>
        </ModalBase>
      </>,
    );

  it("closes only the modal when Escape is pressed with both open", () => {
    const onRequestClose = vi.fn();
    const onModalClose = vi.fn();
    renderHarness(true, onRequestClose, onModalClose);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onModalClose).toHaveBeenCalledTimes(1);
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it("still closes the drawer with Escape when no modal is open", () => {
    const onRequestClose = vi.fn();
    const onModalClose = vi.fn();
    renderHarness(false, onRequestClose, onModalClose);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(onModalClose).not.toHaveBeenCalled();
  });
});

describe("C9: EditPasswordModal labels match their rendered controls", () => {
  const item = {
    id: "user-1",
    name: "ユーザー",
    role: "user" as const,
    max_stocks: null,
    max_indices: null,
    is_active: 1,
    created_at: 1700000000,
  };

  it("does not point labels at absent inputs, and associates them once shown", () => {
    render(
      <EditPasswordModal
        isOpen
        onClose={() => {}}
        item={item}
        onSuccess={() => {}}
        getHeaders={() => ({})}
      />,
    );

    const stocksLabel = screen.getByText(/最大銘柄数制限/).closest("label") as HTMLLabelElement;
    const indicesLabel = screen.getByText(/作成可能 指数上限数/).closest("label") as HTMLLabelElement;
    expect(document.getElementById("edit-pw-max-stocks")).toBeNull();
    expect(document.getElementById("edit-pw-max-indices")).toBeNull();
    expect(stocksLabel.control).toBeNull();
    expect(indicesLabel.control).toBeNull();

    fireEvent.click(screen.getByLabelText("構成銘柄数を無制限に設定"));
    fireEvent.click(screen.getByLabelText("作成可能指数上限数を無制限に設定"));

    const stocksInput = document.getElementById("edit-pw-max-stocks") as HTMLInputElement;
    const indicesInput = document.getElementById("edit-pw-max-indices") as HTMLInputElement;
    expect(stocksInput).not.toBeNull();
    expect(indicesInput).not.toBeNull();
    expect(stocksLabel.control).toBe(stocksInput);
    expect(indicesLabel.control).toBe(indicesInput);
  });
});

describe("C8: generated DOM ids are unique per instance", () => {
  it("gives two open confirm dialogs distinct description ids", () => {
    render(
      <>
        <ConfirmModal isOpen onClose={() => {}} onConfirm={() => {}} title="一つ目" description="内容1" />
        <ConfirmModal isOpen onClose={() => {}} onConfirm={() => {}} title="二つ目" description="内容2" />
      </>,
    );

    const descriptions = Array.from(document.querySelectorAll("[data-modal-dialog]")).map(
      (dialog) => dialog.getAttribute("aria-describedby"),
    );
    expect(descriptions.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    descriptions.forEach((id) => expect(document.getElementById(id ?? "")).not.toBeNull());
  });
});

describe("C2: background inert inside a non-body portal root", () => {
  it("hides siblings of the dialog inside a fullscreen-like host", () => {
    const host = document.createElement("div");
    const background = document.createElement("div");
    const dialog = document.createElement("div");
    dialog.setAttribute("data-modal-dialog", "");
    host.append(background, dialog);
    document.body.appendChild(host);
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: host,
    });

    try {
      const dialogRef = { current: dialog };
      const { unmount } = renderHook(() => useModalFocus(true, dialogRef, () => {}));

      expect(isBackgroundHidden(background)).toBe(true);
      unmount();
      expect(isBackgroundHidden(background)).toBe(false);
    } finally {
      Object.defineProperty(document, "fullscreenElement", {
        configurable: true,
        value: null,
      });
      host.remove();
    }
  });
});
