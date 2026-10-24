// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import { Header, type HeaderProps } from "./Header";
import { ToastProvider } from "./Toast";
import {
  FreshnessProvider,
  useActiveFreshness,
  useRegisterFreshness,
} from "../contexts/FreshnessContext";

/**
 * The header and the freshness registry used to speak two different
 * vocabularies for the same state: the header declared `dataLoading` /
 * `benchmarkStale`, the registry (`TabFreshness`) used `loading` / `stale`.
 *
 * `useActiveFreshness(currentView, headerProps)` therefore read `loading` and
 * `stale` from an object that only carried the other two names, so both
 * resolved to `undefined`. The header then always reported "not loading" and
 * "not stale": the "データ更新中" indicator could never appear and the LIVE
 * badge was shown even when the Worker had served an older snapshot.
 *
 * These tests pin the behaviour that was broken.
 */
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ToastProvider>
    <FreshnessProvider>{children}</FreshnessProvider>
  </ToastProvider>
);

describe("header and freshness registry share one vocabulary", () => {
  it("keeps the loading flag the header was given", () => {
    const headerProps: HeaderProps = { loading: true, stale: false };
    const { result } = renderHook(() => useActiveFreshness("dashboard", headerProps), {
      wrapper,
    });
    expect(result.current.loading).toBe(true);
  });

  it("keeps the stale flag the header was given", () => {
    const headerProps: HeaderProps = { loading: false, stale: true };
    const { result } = renderHook(() => useActiveFreshness("dashboard", headerProps), {
      wrapper,
    });
    expect(result.current.stale).toBe(true);
  });

  it("reports neither loading nor stale when the header says neither", () => {
    const headerProps: HeaderProps = {};
    const { result } = renderHook(() => useActiveFreshness("dashboard", headerProps), {
      wrapper,
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.stale).toBe(false);
  });

  it("uses the explicit props when the view registered nothing", () => {
    const headerProps: HeaderProps = { loading: true, stale: true };
    const { result } = renderHook(() => useActiveFreshness("market", headerProps), {
      wrapper,
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.stale).toBe(true);
  });

  it("lets a view's own registered freshness win over the explicit props", () => {
    const { result } = renderHook(
      () => {
        useRegisterFreshness("market", { loading: false, stale: false, updatedAt: 1_700_000_000_000 });
        return useActiveFreshness("market", { loading: true, stale: true });
      },
      { wrapper },
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.stale).toBe(false);
  });
});

describe("the header renders the freshness state it is given", () => {
  const renderHeader = (props: HeaderProps) =>
    render(
      <ToastProvider>
        <Header {...props} />
      </ToastProvider>,
    );

  it("shows the updating state while data is loading", () => {
    renderHeader({ loading: true });
    expect(screen.getByText("データ更新中")).toBeTruthy();
    expect(screen.queryByText(/^LIVE$/)).toBeNull();
  });

  it("shows STANDBY instead of LIVE when the data is stale", () => {
    renderHeader({ stale: true, benchmarkUpdatedAt: 1_700_000_000_000 });
    expect(screen.getByText("STANDBY")).toBeTruthy();
    expect(screen.queryByText(/^LIVE$/)).toBeNull();
    expect(screen.getByText("最新データを取得できず、古いキャッシュを表示中")).toBeTruthy();
  });

  it("shows LIVE when the data is current", () => {
    renderHeader({ stale: false, benchmarkUpdatedAt: 1_700_000_000_000 });
    expect(screen.getByText(/^LIVE$/)).toBeTruthy();
    expect(screen.queryByText("STANDBY")).toBeNull();
  });
});
