// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthModal } from "./AuthModal";

const { getTurnstileConfigMock } = vi.hoisted(() => ({
  getTurnstileConfigMock: vi.fn(async () => ({ siteKey: "", unavailable: true })),
}));

vi.mock("../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return { ...actual, getTurnstileConfig: getTurnstileConfigMock };
});

describe("AuthModal when Turnstile config is unavailable", () => {
  it("hides the widget and disables the admin submit instead of using a test key", async () => {
    render(<AuthModal isOpen onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/ロボット確認を利用できません/)).toBeTruthy();
    });
    expect(screen.queryByText(/ロボット検証 \(Turnstile\)/)).toBeNull();

    const submit = screen
      .getAllByRole("button", { name: "管理者ログイン" })
      .find((button) => button.getAttribute("type") === "submit");
    expect(submit).toBeDefined();
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });
});
