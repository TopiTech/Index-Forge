// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { GlobalSearchModal } from "./GlobalSearchModal";
import { RoleRadioGroup } from "./RoleRadioGroup";

// jsdom scrollIntoView mock
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = vi.fn();
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Comprehensive Code Review Fixes: Accessibility & Forms", () => {
  it("renders GlobalSearchModal input combobox with accessible aria-label", () => {
    render(
      <GlobalSearchModal
        isOpen={true}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    const combobox = screen.getByRole("combobox", { name: "銘柄・テーマ・指数の検索" });
    expect(combobox).toBeTruthy();
    expect(combobox.getAttribute("aria-label")).toBe("銘柄・テーマ・指数の検索");
    expect(combobox.getAttribute("role")).toBe("combobox");
  });

  it("renders RoleRadioGroup with explicit accessible labels for screen readers", () => {
    const handleChange = vi.fn();
    render(<RoleRadioGroup value="user" onChange={handleChange} />);

    const userRadio = screen.getByRole("radio", { name: "ユーザー（銘柄制限あり）" }) as HTMLInputElement;
    const adminRadio = screen.getByRole("radio", { name: "副管理者（無制限）" }) as HTMLInputElement;

    expect(userRadio).toBeTruthy();
    expect(userRadio.checked).toBe(true);
    expect(adminRadio).toBeTruthy();
    expect(adminRadio.checked).toBe(false);

    expect(userRadio.getAttribute("aria-label")).toBe("ユーザー（銘柄制限あり）");
    expect(adminRadio.getAttribute("aria-label")).toBe("副管理者（無制限）");
  });
});
