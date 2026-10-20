import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ADMIN_SESSION_EXPIRED_MESSAGE,
  reportAdminFailure,
} from "../components/AdminDashboard";

const editModalSource = () =>
  readFileSync(resolve("src/components/EditPasswordModal.tsx"), "utf8");
const adminDashboardSource = () =>
  readFileSync(resolve("src/components/AdminDashboard.tsx"), "utf8");

describe("review follow-ups: modal backdrop safety and admin refresh guards", () => {
  it("guards the edit-password dialog against backdrop drag-through closes", () => {
    const source = editModalSource();
    expect(source).toContain("isBackdropMouseDownRef");
    expect(source).toContain("onMouseDown={handleBackdropMouseDown}");
    expect(source).toContain("onMouseDown={(e) => e.stopPropagation()}");
  });

  it("ignores aborted admin password-list responses instead of surfacing stale state", () => {
    const source = adminDashboardSource();

    // The password list request owns an AbortController and a ref, so a newer
    // request aborts the previous one instead of racing it.
    expect(source).toContain("const abortControllerRef = useRef<AbortController | null>(null);");
    expect(source).toContain("if (abortControllerRef.current) {");
    expect(source).toContain("abortControllerRef.current.abort();");
    expect(source).toContain("const controller = new AbortController();");
    expect(source).toContain("abortControllerRef.current = controller;");

    // A response that was aborted must not write any state: neither the error
    // nor the rows.
    expect(source).toContain("if (!controller.signal.aborted) setPasswordFetchError(errText);");
    expect(source).toContain("} else if (!controller.signal.aborted) {");
    expect(source).toContain("if (controller.signal.aborted) return;");
    // The rows are published inside that guarded branch, after the payload was
    // validated (UI-16), so an aborted response can never render rows.
    const guardIndex = source.indexOf("} else if (!controller.signal.aborted) {");
    const publishIndex = source.indexOf("setPasswords(rows);");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(guardIndex);
    expect(source).toContain("sanitizeUserPasswordList(payload)");

    // A non-JSON error body must not throw (UI-38), and the message is read
    // through the shared helper instead of an unchecked `data.error` access.
    expect(source).toContain("const payload: unknown = await res.json().catch(() => ({}));");
    expect(source).toContain("reportAdminFailure(payload, res.status,");
  });

  it("turns a refused administrator call into a re-login message", () => {
    // The administrator session expires after eight hours. A 403 must clear
    // the dead token and tell the operator to log in again, instead of
    // showing a generic failure.
    expect(reportAdminFailure({ error: "管理者権限が必要です" }, 403, "fallback")).toBe(
      ADMIN_SESSION_EXPIRED_MESSAGE,
    );
    // Every other status keeps the Worker's own message.
    expect(reportAdminFailure({ error: "サーバーエラー" }, 500, "fallback")).toBe("サーバーエラー");
    // Without a message from the Worker the fallback is used, enriched with the
    // status so the console stays diagnosable.
    expect(reportAdminFailure({}, 500, "fallback")).toContain("fallback");
  });

  it("guards the admin telemetry request with a request generation", () => {
    const source = adminDashboardSource();
    // UI-17: a slow older telemetry response must never overwrite a newer one
    // and nothing may be written after the unmount.
    expect(source).toContain("const statsGenerationRef = useRef(0);");
    expect(source).toContain("const generation = statsGenerationRef.current + 1;");
    expect(source).toContain("statsGenerationRef.current = generation;");
    expect(source).toContain("generation === statsGenerationRef.current &&");
    expect(source).toContain("!controller.signal.aborted;");
    expect(source).toContain("if (!isCurrent()) return;");
  });
});
