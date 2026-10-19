import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable=\"true\"]",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

function isTopmostDialog(dialog: HTMLElement): boolean {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>("[data-modal-dialog]"));
  return dialogs[dialogs.length - 1] === dialog;
}

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0,
  );
}

let activeModalCount = 0;
let originalBodyOverflow: string | null = null;

/** Adds Escape handling, focus trapping, initial focus, and focus restoration to a modal. */
export function useModalFocus<T extends HTMLElement>(
  isOpen: boolean,
  dialogRef: RefObject<T | null>,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  const onCloseRef = useRef(onClose);
  // The ref must not be written during render: React forbids it, and a
  // discarded render could leave the hook holding a callback closed over
  // props that were never committed. The effect keeps it current instead.
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen || !dialogRef.current) return;

    const dialog = dialogRef.current;
    const previousActiveElement = document.activeElement as HTMLElement | null;
    if (activeModalCount === 0) {
      originalBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    activeModalCount++;

    const initialTarget = initialFocusRef?.current;
    const isTargetFocusable =
      initialTarget &&
      dialog.contains(initialTarget) &&
      !("disabled" in initialTarget && (initialTarget as { disabled?: boolean }).disabled);
    const target = isTargetFocusable ? initialTarget : getFocusableElements(dialog)[0];
    target?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopmostDialog(dialog)) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      activeModalCount = Math.max(0, activeModalCount - 1);
      if (activeModalCount === 0) {
        document.body.style.overflow = originalBodyOverflow ?? "";
        originalBodyOverflow = null;
      }
      if (previousActiveElement?.isConnected) previousActiveElement.focus();
    };
  }, [dialogRef, initialFocusRef, isOpen]);
}
