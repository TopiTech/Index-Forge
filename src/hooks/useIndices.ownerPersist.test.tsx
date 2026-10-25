// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useIndices } from "./useIndices";
import { saveIndexOwnerToken } from "../lib/ownership";
import type { CustomIndex } from "../data/indices";

const OWNER_STORE_KEY = "custom_index_owners";

const NEW_INDEX: CustomIndex = {
  id: "idx-1",
  name: "Test Index",
  description: "",
  baseValue: 1000,
  basket: [{ ticker: "7203", name: "Toyota", theme: "Auto", weight: 100 }],
};

/** Local owner-store entry as persisted by ownership.ts. */
function readOwnerEntry(indexId: string): { token: string; issuedAt: number } | null {
  const raw = window.localStorage.getItem(OWNER_STORE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Record<string, { token: string; issuedAt: number }>;
  return parsed[indexId] ?? null;
}

/**
 * Install a fetch mock where POST /api/indices answers `postBody` and
 * GET /api/indices answers a list containing the saved index.
 */
function installIndicesFetch(postBody: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST" && url.endsWith("/api/indices")) {
      return new Response(JSON.stringify(postBody), { status: 200 });
    }
    return new Response(
      JSON.stringify([
        {
          id: NEW_INDEX.id,
          name: NEW_INDEX.name,
          description: NEW_INDEX.description,
          baseValue: NEW_INDEX.baseValue,
          basket: NEW_INDEX.basket,
        },
      ]),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("useIndices.saveCustomIndex owner persistence (C-3 pair)", () => {
  it("stores the echoed token with the server seconds age converted to milliseconds", async () => {
    installIndicesFetch({ id: NEW_INDEX.id, ownerToken: "tok-echo", ownerTokenIssuedAt: 1700000000 });

    const { result } = renderHook(() => useIndices());
    let outcome: Awaited<ReturnType<typeof result.current.saveCustomIndex>> | undefined;
    await act(async () => {
      outcome = await result.current.saveCustomIndex(NEW_INDEX);
    });

    expect(outcome?.ok).toBe(true);
    expect(readOwnerEntry(NEW_INDEX.id)).toEqual({ token: "tok-echo", issuedAt: 1700000000000 });
  });

  it("leaves the store untouched when the server echoes nothing (no sliding expiry)", async () => {
    // Regression: the previous implementation rewrote the stored fallback
    // token with issuedAt=now on every save, sliding the client-side expiry
    // while the Worker enforces the original absolute age.
    const storedAt = Date.now() - 60_000;
    saveIndexOwnerToken(NEW_INDEX.id, "tok-stored", storedAt);
    installIndicesFetch({ id: NEW_INDEX.id });

    const { result } = renderHook(() => useIndices());
    await act(async () => {
      await result.current.saveCustomIndex(NEW_INDEX);
    });

    expect(readOwnerEntry(NEW_INDEX.id)).toEqual({ token: "tok-stored", issuedAt: storedAt });
  });

  it("keeps the stored age when the echo carries no issuance time", async () => {
    // The Worker preserves the original issuance time on edit; an echo
    // without ownerTokenIssuedAt must not reset the age to now.
    const storedAt = Date.now() - 60_000;
    saveIndexOwnerToken(NEW_INDEX.id, "tok-stored", storedAt);
    installIndicesFetch({ id: NEW_INDEX.id, ownerToken: "tok-stored" });

    const { result } = renderHook(() => useIndices());
    await act(async () => {
      await result.current.saveCustomIndex(NEW_INDEX);
    });

    expect(readOwnerEntry(NEW_INDEX.id)).toEqual({ token: "tok-stored", issuedAt: storedAt });
  });
});
