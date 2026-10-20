// @vitest-environment jsdom
/**
 * Behavioral contract for the post-login save retry.
 *
 * R32 fixed a ref that was written during render: a discarded render could
 * leave the retry holding a closure over a name/basket that was never
 * committed. A source-text assertion cannot observe that, so this test drives
 * the actual flow: attempt a save while signed out, edit the form, complete
 * authentication, and assert the saved payload carries the edited name.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    session: null,
    isAuthenticated: false,
    isUser: false,
    isAdmin: false,
    maxStocks: null,
    maxIndices: null,
  }),
}));

vi.mock("../hooks/useSimulation", () => ({
  useSimulation: () => ({}),
}));

vi.mock("./SimulationPreview", () => ({
  SimulationPreview: () => null,
}));

vi.mock("./Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock("./AuthModal", () => ({
  AuthModal: ({ isOpen, onSuccess }: { isOpen: boolean; onSuccess: () => void }) =>
    isOpen ? (
      <button type="button" onClick={onSuccess}>
        complete-login
      </button>
    ) : null,
}));

import { IndexBuilderContent } from "./IndexBuilderContent";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("IndexBuilderContent post-login save", () => {
  it("saves the name committed after login, not the one captured before it", async () => {
    const onSave = vi.fn(async () => ({ ok: true }));
    render(<IndexBuilderContent onSave={onSave} />);

    const nameInput = screen.getByLabelText(/指数名/);
    fireEvent.change(nameInput, { target: { value: "ログイン前の名前" } });

    fireEvent.click(screen.getByRole("button", { name: /認証して指数を保存/ }));
    expect(onSave).not.toHaveBeenCalled();

    // The form stays editable behind the auth modal; this edit must be the one
    // the retry saves.
    fireEvent.change(nameInput, { target: { value: "ログイン後の名前" } });
    fireEvent.click(screen.getByText("complete-login"));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [savedIndex] = onSave.mock.calls[0] as unknown as [{ name: string }];
    expect(savedIndex.name).toBe("ログイン後の名前");
  });
});
