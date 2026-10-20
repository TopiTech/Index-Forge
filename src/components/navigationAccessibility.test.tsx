// @vitest-environment jsdom
/**
 * DOM-level accessibility contract for R36.
 *
 * Both the desktop rail and the mobile drawer render a navigation landmark,
 * so the two must carry distinct accessible names. The admin role selector
 * must expose one named radiogroup containing both radios. Asserting these on
 * the rendered accessibility tree is the only way to prove the semantics; a
 * source grep proves only that the attributes were typed.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { RoleRadioGroup } from "./RoleRadioGroup";

afterEach(() => {
  cleanup();
});

describe("navigation landmarks", () => {
  it("gives the desktop rail and the mobile drawer distinct names", () => {
    render(
      <Sidebar
        currentView="dashboard"
        navigateTo={vi.fn()}
        isOpen
        onRequestClose={vi.fn()}
      />,
    );

    const navs = screen.getAllByRole("navigation");
    expect(navs).toHaveLength(2);

    const labels = navs.map((nav) => nav.getAttribute("aria-label"));
    expect(labels.every((label) => Boolean(label))).toBe(true);
    expect(new Set(labels).size).toBe(2);
  });
});

describe("admin role selector", () => {
  it("exposes one named radiogroup with both roles", () => {
    render(<RoleRadioGroup value="user" onChange={vi.fn()} />);

    const group = screen.getByRole("radiogroup", { name: "権限ロール" });
    const radios = screen.getAllByRole("radio");

    expect(group.contains(radios[0])).toBe(true);
    expect(group.contains(radios[1])).toBe(true);
    expect(radios).toHaveLength(2);
    expect((radios[0] as HTMLInputElement).checked).toBe(true);
    expect((radios[1] as HTMLInputElement).checked).toBe(false);
  });

  it("reports the selected role to its owner", () => {
    const onChange = vi.fn();
    render(<RoleRadioGroup value="user" onChange={onChange} />);

    fireEvent.click(screen.getByLabelText("副管理者（無制限）"));

    expect(onChange).toHaveBeenCalledWith("admin");
  });
});
