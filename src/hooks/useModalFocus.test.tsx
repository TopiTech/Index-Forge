// @vitest-environment jsdom
/**
 * DOM-level contract for `useModalFocus`.
 *
 * The hook's guarantees are behavioral: which element receives focus, where
 * Tab wraps, which dialog owns Escape, and what the document looks like after
 * the last dialog closes. Asserting on the source text cannot prove any of
 * that, so these tests drive a real dialog through a real keydown sequence.
 */
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useModalFocus } from "./useModalFocus";

// jsdom has no layout engine, so every element reports an empty rect list and
// the hook's visibility filter would hide every control. Give attached
// elements a rect so the tests exercise the focus behavior itself.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    const rect = new DOMRect(0, 0, 10, 10);
    return Object.assign([rect], { item: (index: number) => (index === 0 ? rect : null) }) as unknown as DOMRectList;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.style.overflow = "";
});

interface DialogProps {
  label: string;
  onClose?: () => void;
  initialFocusLabel?: string;
  withInitialFocus?: boolean;
}

function Dialog({ label, onClose = () => {}, initialFocusLabel, withInitialFocus = false }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  useModalFocus(true, dialogRef, onClose, withInitialFocus ? initialFocusRef : undefined);

  return (
    <div ref={dialogRef} data-modal-dialog role="dialog" aria-label={label}>
      <button type="button" ref={withInitialFocus ? initialFocusRef : undefined}>
        {initialFocusLabel ?? `${label}-first`}
      </button>
      <button type="button">{label}-last</button>
    </div>
  );
}

/** Opens a dialog from a trigger so focus restoration has somewhere to go. */
function Harness({ onClose, withInitialFocus = false }: { onClose?: () => void; withInitialFocus?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setIsOpen(true)}>
        open
      </button>
      <button type="button" onClick={() => setIsOpen(false)}>
        close
      </button>
      {isOpen && (
        <Dialog
          label="test-dialog"
          onClose={() => {
            onClose?.();
            setIsOpen(false);
          }}
          withInitialFocus={withInitialFocus}
        />
      )}
    </div>
  );
}

describe("useModalFocus", () => {
  it("moves focus into the dialog on open and restores it on close", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "outside";
    document.body.appendChild(trigger);
    trigger.focus();

    const { getByText, queryByRole } = render(<Harness />);
    fireEvent.click(getByText("open"));

    expect(document.activeElement).toBe(getByText("test-dialog-first"));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  it("honours an explicit initial focus target inside the dialog", () => {
    const { getByText } = render(<Harness withInitialFocus />);
    fireEvent.click(getByText("open"));

    expect(document.activeElement).toBe(getByText("test-dialog-first"));
  });

  it("wraps Tab at both ends of the dialog", () => {
    const { getByText, getByRole } = render(<Harness />);
    fireEvent.click(getByText("open"));

    const buttons = Array.from(getByRole("dialog").querySelectorAll("button"));
    const first = buttons[0];
    const last = buttons[buttons.length - 1];

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("gives Escape to the topmost dialog only", () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();

    render(
      <>
        <Dialog label="outer" onClose={outerClose} />
        <Dialog label="inner" onClose={innerClose} />
      </>,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });

  it("locks body scrolling while open and releases it after the last close", () => {
    document.body.style.overflow = "auto";

    const { getByText, unmount } = render(<Harness />);
    fireEvent.click(getByText("open"));
    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    expect(document.body.style.overflow).toBe("auto");
  });
});
