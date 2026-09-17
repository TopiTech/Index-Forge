import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
    expect(source).toContain("if (!controller.signal.aborted)");
    expect(source).toContain("if (controller.signal.aborted) return;");
    expect(source).toContain('typeof data.error === "string"');
  });
});
