// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EditPasswordModal } from "./EditPasswordModal";
import { NETWORK_UNREACHABLE_MESSAGE } from "../lib/apiContract";
import type { UserPasswordItem } from "../types";

const item: UserPasswordItem = {
  id: "user-1",
  name: "テストユーザー",
  role: "user",
  max_stocks: 10,
  max_indices: 5,
  is_active: 1,
  created_at: 1,
};

describe("EditPasswordModal network-failure message", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the shared connection message instead of the raw browser error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    render(
      <EditPasswordModal
        isOpen
        item={item}
        onClose={() => {}}
        onSuccess={() => {}}
        getHeaders={() => ({ "x-admin-session": "token" })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));

    expect(await screen.findByText(NETWORK_UNREACHABLE_MESSAGE)).toBeTruthy();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });
});
