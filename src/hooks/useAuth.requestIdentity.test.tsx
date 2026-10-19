// @vitest-environment jsdom
/**
 * Regression tests for the authentication hook's request identity.
 *
 * Without a request identity, a login that was still in flight when the user
 * logged out resolved afterwards and silently re-authenticated (and
 * re-persisted) the session, and the first of two concurrent attempts
 * cleared the busy state while the second was still running.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useAuth } from "./useAuth";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useAuth request identity", () => {
  it("does not re-authenticate when a login resolves after a logout", async () => {
    const pending = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => pending.promise),
    );

    let session: { role: string } | null = null;
    let auth: ReturnType<typeof useAuth> | null = null;

    function Harness() {
      auth = useAuth();
      session = auth.session;
      return <span data-testid="role">{auth.session?.role ?? "anonymous"}</span>;
    }

    const { getByTestId } = render(<Harness />);

    await act(async () => {
      void auth!.login("secret");
    });

    // The user logs out while the login request is still in flight.
    await act(async () => {
      auth!.logout();
    });

    // The login now resolves: it must not resurrect the session.
    await act(async () => {
      pending.resolve(
        new Response(JSON.stringify({ ok: true, role: "user", name: "user", id: "u1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      await Promise.resolve();
    });

    expect(getByTestId("role").textContent).toBe("anonymous");
    expect(session).toBeNull();
    expect(window.sessionStorage.getItem("custom_stock_index_auth")).toBeNull();
  });

  it("keeps the busy state until the newest attempt settles", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    let call = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        return call === 1 ? first.promise : second.promise;
      }),
    );

    let auth: ReturnType<typeof useAuth> | null = null;
    function Harness() {
      auth = useAuth();
      return <span data-testid="loading">{String(auth.loading)}</span>;
    }

    const { getByTestId } = render(<Harness />);

    await act(async () => {
      void auth!.login("first");
    });
    await act(async () => {
      void auth!.login("second");
    });

    expect(getByTestId("loading").textContent).toBe("true");

    // The superseded first attempt settles: the busy state must remain, the
    // newest attempt is still running.
    await act(async () => {
      first.resolve(
        new Response(JSON.stringify({ ok: true, role: "user", name: "user" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      await Promise.resolve();
    });
    expect(getByTestId("loading").textContent).toBe("true");

    await act(async () => {
      second.resolve(
        new Response(JSON.stringify({ ok: true, role: "user", name: "user" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      await Promise.resolve();
    });
    expect(getByTestId("loading").textContent).toBe("false");
  });

  it("cancels a login that was started by a different hook instance", async () => {
    // `useAuth()` is used by a dozen components: the login is started by the
    // auth modal while the logout is performed in the header. The attempt
    // identity therefore has to be shared, not per instance.
    const pending = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => pending.promise),
    );

    let modalAuth: ReturnType<typeof useAuth> | null = null;
    let headerAuth: ReturnType<typeof useAuth> | null = null;

    function Modal() {
      modalAuth = useAuth();
      return null;
    }
    function Header() {
      headerAuth = useAuth();
      return <span data-testid="role">{headerAuth.session?.role ?? "anonymous"}</span>;
    }

    const { getByTestId } = render(
      <>
        <Modal />
        <Header />
      </>,
    );

    await act(async () => {
      void modalAuth!.login("secret");
    });

    // The logout happens in the other instance.
    await act(async () => {
      headerAuth!.logout();
    });

    await act(async () => {
      pending.resolve(
        new Response(JSON.stringify({ ok: true, role: "user", name: "user", id: "u1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      await Promise.resolve();
    });

    expect(getByTestId("role").textContent).toBe("anonymous");
    expect(window.sessionStorage.getItem("custom_stock_index_auth")).toBeNull();
  });

  it("reports a superseded attempt as cancelled instead of a failed login", async () => {
    const pending = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => pending.promise),
    );

    let auth: ReturnType<typeof useAuth> | null = null;
    function Harness() {
      auth = useAuth();
      return null;
    }
    render(<Harness />);

    let result: Awaited<ReturnType<ReturnType<typeof useAuth>["login"]>> | null = null;
    await act(async () => {
      void auth!.login("secret").then((res) => {
        result = res;
      });
    });

    await act(async () => {
      auth!.logout();
    });

    await act(async () => {
      pending.resolve(
        new Response(JSON.stringify({ ok: true, role: "user", name: "user" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      await Promise.resolve();
    });

    // The caller must be able to tell "superseded" from "wrong password": a
    // cancellation is not an error and must not reset the Turnstile widget.
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    expect(result!.cancelled).toBe(true);
    expect(result!.error).toBeUndefined();
  });
});
