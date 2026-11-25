// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthModal } from "./AuthModal";

const { getTurnstileConfigMock, turnstileFallbackSiteKeyMock } = vi.hoisted(() => ({
  getTurnstileConfigMock: vi.fn<() => Promise<{ siteKey: string; unavailable?: boolean }>>(
    async () => ({ siteKey: "", unavailable: true }),
  ),
  turnstileFallbackSiteKeyMock: vi.fn((hostname: string) =>
    !hostname || hostname === "localhost" || hostname === "127.0.0.1"
      ? "1x00000000000000000000AA"
      : "",
  ),
}));

vi.mock("../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    getTurnstileConfig: getTurnstileConfigMock,
    turnstileFallbackSiteKey: turnstileFallbackSiteKeyMock,
  };
});

beforeEach(() => {
  getTurnstileConfigMock.mockReset();
  getTurnstileConfigMock.mockResolvedValue({ siteKey: "", unavailable: true });
  turnstileFallbackSiteKeyMock.mockReset();
  turnstileFallbackSiteKeyMock.mockImplementation((hostname: string) =>
    !hostname || hostname === "localhost" || hostname === "127.0.0.1"
      ? "1x00000000000000000000AA"
      : "",
  );
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

  it("never mounts a test Turnstile key on production hosts while config is loading or empty", async () => {
    turnstileFallbackSiteKeyMock.mockReturnValue("");
    let resolveConfig!: (cfg: { siteKey: string; unavailable?: boolean }) => void;
    getTurnstileConfigMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConfig = resolve;
        }),
    );

    render(<AuthModal isOpen onClose={vi.fn()} />);

    // While loading on a production origin, the test widget must not mount.
    expect(screen.getByText(/ロボット確認を読み込み中/)).toBeTruthy();
    expect(screen.queryByText(/ロボット検証 \(Turnstile\)/)).toBeNull();

    resolveConfig({ siteKey: "" });
    await waitFor(() => {
      expect(screen.getByText(/ロボット確認を利用できません/)).toBeTruthy();
    });
    expect(screen.queryByText(/ロボット検証 \(Turnstile\)/)).toBeNull();
    const submit = screen
      .getAllByRole("button", { name: "管理者ログイン" })
      .find((button) => button.getAttribute("type") === "submit");
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });
});
