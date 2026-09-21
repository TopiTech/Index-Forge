import { beforeEach, describe, it, expect, vi } from "vitest";
import worker, {
  clearAuthCache,
  resetPasswordTableEnsured,
} from "../../worker/index";
import { normalizeTicker } from "./indexEngine";

const TEST_ADMIN_PASSWORD = "test-admin-password";

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
});

interface PasswordRecord {
  id: string;
  name: string;
  password_hash: string;
  role: "admin" | "user";
  max_stocks: number | null;
  max_indices?: number | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

function createTestEnv() {
  const passwords = new Map<string, PasswordRecord>();

  const executeAll = async (query: string, params: unknown[] = []) => {
    if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
      const master = passwords.get("admin-master");
      return { results: master ? [master] : [] };
    }
    if (query.includes("FROM access_passwords") && query.includes("id != 'admin-master'")) {
      let matches = Array.from(passwords.values()).filter((p) => p.id !== "admin-master");
      if (query.includes("is_active = 1")) {
        matches = matches.filter((p) => p.is_active === 1);
      }
      if (params.length > 0 && typeof params[0] === "string") {
        matches = matches.filter((p) => p.id !== params[0]);
      }
      matches.sort((a, b) => a.created_at - b.created_at);
      return { results: matches };
    }
    return { results: [] };
  };

  const executeRun = async (query: string, params: unknown[] = []) => {
    if (query.includes("INSERT INTO access_passwords") || query.includes("INSERT OR REPLACE INTO access_passwords")) {
      if (query.includes("'admin-master'")) {
        passwords.set("admin-master", {
          id: "admin-master",
          name: "マスター管理者",
          password_hash: params[0] as string,
          role: "admin",
          max_stocks: null,
          is_active: 1,
          created_at: params[1] as number,
          updated_at: params[2] as number,
        });
      } else {
        const id = params[0] as string;
        const name = params[1] as string;
        const hash = params[2] as string;
        const role = params[3] as "admin" | "user";
        const maxStocks = params[4] as number | null;
        let maxIndices: number | null = null;
        let now1: number;
        let now2: number;
        if (params.length >= 8) {
          maxIndices = params[5] as number | null;
          now1 = params[6] as number;
          now2 = params[7] as number;
        } else {
          now1 = params[5] as number;
          now2 = params[6] as number;
        }
        passwords.set(id, {
          id,
          name,
          password_hash: hash,
          role,
          max_stocks: maxStocks,
          max_indices: maxIndices,
          is_active: 1,
          created_at: now1,
          updated_at: now2,
        });
      }
      return { success: true };
    }
    if (query.includes("UPDATE access_passwords")) {
      const targetId = params[params.length - 1] as string;
      const existing = passwords.get(targetId);
      if (existing) {
        if (query.includes("password_hash = ?")) {
          existing.password_hash = params[0] as string;
          existing.updated_at = params[1] as number;
        }
      }
      return { success: true };
    }
    return { success: true };
  };

  const prepare = vi.fn().mockImplementation((query: string) => {
    return {
      bind: (...params: unknown[]) => ({
        all: () => executeAll(query, params),
        run: () => executeRun(query, params),
      }),
      all: () => executeAll(query, []),
      run: () => executeRun(query, []),
    };
  });

  const env = {
    DB: {
      prepare,
      batch: async () => [],
    } as unknown as D1Database,
    ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
  };

  return { env, passwords };
}

describe("Comprehensive Goal Resolution: Password Privilege Escalation Protection", () => {
  it("rejects creating a user account whose password matches the env ADMIN_PASSWORD", async () => {
    const { env } = createTestEnv();

    const res = await worker.fetch(
      new Request("http://localhost/api/admin/passwords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          name: "Escalation Candidate",
          password: TEST_ADMIN_PASSWORD,
          role: "user",
        }),
      }),
      env,
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("管理者アカウントと同一のパスワードは設定できません");
  });

  it("rejects updating an existing user password to match admin-master", async () => {
    const { env } = createTestEnv();

    // 1. Create a legitimate user
    const createRes = await worker.fetch(
      new Request("http://localhost/api/admin/passwords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          name: "Standard User",
          password: "legitimate-user-pwd",
          role: "user",
        }),
      }),
      env,
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    const userId = created.password.id;

    // 2. Try to update user's password to match admin-master
    const updateRes = await worker.fetch(
      new Request("http://localhost/api/admin/passwords", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          id: userId,
          password: TEST_ADMIN_PASSWORD,
        }),
      }),
      env,
    );

    expect(updateRes.status).toBe(400);
    const data = await updateRes.json();
    expect(data.error).toBe("管理者アカウントと同一のパスワードは設定できません");
  });

  it("rejects updating admin-master password to match an existing user's password", async () => {
    const { env } = createTestEnv();

    // 1. Create a user with password "user-secret-12345"
    const createRes = await worker.fetch(
      new Request("http://localhost/api/admin/passwords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          name: "Existing User",
          password: "user-secret-12345",
          role: "user",
        }),
      }),
      env,
    );
    expect(createRes.status).toBe(201);

    // 2. Admin tries to change master password to "user-secret-12345"
    const updateAdminRes = await worker.fetch(
      new Request("http://localhost/api/admin/admin-password", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          newPassword: "user-secret-12345",
        }),
      }),
      env,
    );

    expect(updateAdminRes.status).toBe(400);
    const data = await updateAdminRes.json();
    expect(data.error).toBe("既存のユーザーアカウントで使用されているパスワードは管理者に設定できません");
  });

  it("allows updating admin-master password to a unique new password", async () => {
    const { env } = createTestEnv();

    const updateAdminRes = await worker.fetch(
      new Request("http://localhost/api/admin/admin-password", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          newPassword: "brand-new-admin-password-999",
        }),
      }),
      env,
    );

    expect(updateAdminRes.status).toBe(200);
    const data = await updateAdminRes.json();
    expect(data.ok).toBe(true);
  });
});

describe("Comprehensive Goal Resolution: Ticker Normalization and Casing Consistency", () => {
  it("normalizeTicker trims whitespace and capitalizes tickers", () => {
    expect(normalizeTicker(" aapl ")).toBe("AAPL");
    expect(normalizeTicker("7203")).toBe("7203");
    expect(normalizeTicker("nvda.o")).toBe("NVDA.O");
    expect(normalizeTicker("brk-b")).toBe("BRK-B");
  });

  it("detects case-insensitive duplicates in basket operations", () => {
    const basket = [
      { ticker: "AAPL", name: "Apple", theme: "Tech", weight: 50 },
      { ticker: "7203", name: "Toyota", theme: "Auto", weight: 50 },
    ];

    const isDuplicate = (candidate: string) => {
      const clean = normalizeTicker(candidate);
      return basket.some((b) => normalizeTicker(b.ticker) === clean);
    };

    expect(isDuplicate("aapl")).toBe(true);
    expect(isDuplicate("AAPL")).toBe(true);
    expect(isDuplicate(" 7203 ")).toBe(true);
    expect(isDuplicate("MSFT")).toBe(false);
  });

  it("removes stocks correctly regardless of ticker casing", () => {
    const basket = [
      { ticker: "AAPL", name: "Apple", theme: "Tech", weight: 50 },
      { ticker: "MSFT", name: "Microsoft", theme: "Tech", weight: 50 },
    ];

    const removeStock = (ticker: string) => {
      const clean = normalizeTicker(ticker);
      return basket.filter((b) => normalizeTicker(b.ticker) !== clean);
    };

    const remaining = removeStock("aapl");
    expect(remaining.length).toBe(1);
    expect(remaining[0].ticker).toBe("MSFT");
  });

  it("updates stock weight correctly regardless of ticker casing", () => {
    const basket = [
      { ticker: "AAPL", name: "Apple", theme: "Tech", weight: 50 },
      { ticker: "MSFT", name: "Microsoft", theme: "Tech", weight: 50 },
    ];

    const updateWeight = (ticker: string, weight: number) => {
      const clean = normalizeTicker(ticker);
      return basket.map((b) => (normalizeTicker(b.ticker) === clean ? { ...b, weight } : b));
    };

    const updated = updateWeight("msft", 70);
    expect(updated.find((b) => b.ticker === "MSFT")?.weight).toBe(70);
    expect(updated.find((b) => b.ticker === "AAPL")?.weight).toBe(50);
  });
});
