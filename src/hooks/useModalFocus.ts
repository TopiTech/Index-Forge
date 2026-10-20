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

let activeScrollLocks = 0;
let originalBodyOverflow: string | null = null;

/**
 * Last element outside every dialog that held focus.
 *
 * A chained dialog is often swapped for another one in the same commit: the
 * opening dialog is removed (its cleanup runs immediately) and the new dialog
 * mounts afterwards. By the time the cleanup runs, the element the closing
 * dialog wanted to restore to can already be detached, and the new dialog has
 * captured `document.activeElement === <body>`. Remembering the last target
 * that is known to be connected (and outside any dialog) lets the chain end on
 * a real control instead of dropping focus to `<body>`.
 */
let lastConnectedRestoreTarget: HTMLElement | null = null;

/** A restore target must still exist and must not live inside a dialog. */
function isRestorableElement(element: HTMLElement | null): element is HTMLElement {
  if (!element || !element.isConnected || element === document.body) return false;
  return element.closest("[data-modal-dialog]") === null;
}

export interface ModalFocusOptions {
  /**
   * Move focus into the dialog when it opens (default `true`).
   * Hover previews pass `false` so a pointer passing over a trigger does not
   * yank the caret away from what the user was doing.
   */
  focusOnOpen?: boolean;
  /**
   * Prevent the page behind the dialog from scrolling (default `true`).
   * Non-blocking popovers pass `false` to keep the page scrollable.
   */
  lockScroll?: boolean;
}

/** Adds Escape handling, focus trapping, initial focus, and focus restoration to a modal. */
export function useModalFocus<T extends HTMLElement>(
  isOpen: boolean,
  dialogRef: RefObject<T | null>,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
  options?: ModalFocusOptions,
): void {
  const focusOnOpen = options?.focusOnOpen !== false;
  const lockScroll = options?.lockScroll !== false;

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

    // Only remember targets that live outside a dialog: the element a nested
    // dialog was opened from is another dialog's content, which disappears
    // when that dialog closes.
    if (isRestorableElement(previousActiveElement)) {
      lastConnectedRestoreTarget = previousActiveElement;
    }

    if (lockScroll) {
      if (activeScrollLocks === 0) {
        originalBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
      }
      activeScrollLocks++;
    }

    if (focusOnOpen) {
      const initialTarget = initialFocusRef?.current;
      const isTargetFocusable =
        initialTarget &&
        dialog.contains(initialTarget) &&
        !("disabled" in initialTarget && (initialTarget as { disabled?: boolean }).disabled);
      const target = isTargetFocusable ? initialTarget : getFocusableElements(dialog)[0];
      target?.focus();
    }

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
      if (lockScroll) {
        activeScrollLocks = Math.max(0, activeScrollLocks - 1);
        if (activeScrollLocks === 0) {
          document.body.style.overflow = originalBodyOverflow ?? "";
          originalBodyOverflow = null;
        }
      }

      // A dialog that never took focus (hover preview) must not hand focus
      // back either: nothing was taken, so nothing may move.
      if (!focusOnOpen) return;

      const activeElement = document.activeElement as HTMLElement | null;
      const focusWasLost =
        !activeElement || activeElement === document.body || !activeElement.isConnected;
      if (!focusWasLost) return;

      // Prefer the element this dialog was opened from; when a chained dialog
      // replaced it in the same commit that element is already detached, so
      // fall back to the last target known to be connected.
      const preferred = isRestorableElement(previousActiveElement) ? previousActiveElement : null;
      const fallback = isRestorableElement(lastConnectedRestoreTarget)
        ? lastConnectedRestoreTarget
        : null;
      const target = preferred ?? fallback;
      if (target) target.focus();

      // The chain has ended: the next dialog captures a fresh target.
      if (activeScrollLocks === 0) {
        lastConnectedRestoreTarget = null;
      }
    };
  }, [dialogRef, focusOnOpen, initialFocusRef, isOpen, lockScroll]);
}
