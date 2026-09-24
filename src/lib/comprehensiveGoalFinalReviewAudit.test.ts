import { describe, it, expect, vi, beforeEach } from "vitest";
import worker, {
  hashPassword,
  clearAuthCache,
  resetPasswordTableEnsured,
} from "../../worker/index";
import { getStockCurrency, formatStockPrice, formatStockChange } from "./currency";
import { normalizeTicker } from "./indexEngine";

const TEST_ADMIN_PASSWORD = "MasterAdminPassword123!";
const SHARED_USER_PASSWORD = "SharedUserSecretPassword456!";

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
});

async function createMultiUserTestEnv() {
  const masterHash = await hashPassword(TEST_ADMIN_PASSWORD);
  const user1Hash = await hashPassword(SHARED_USER_PASSWORD);

  const mockUsers = [
    {
      id: "user-1",
      name: "ユーザー1",
      password_hash: user1Hash,
      role: "user",
      max_stocks: 20,
      max_indices: 5,
      is_active: 1,
      created_at: 1000,
      updated_at: 1000,
    },
  ];

  const prepare = vi.fn().mockImplementation((query: string) => {
    return {
      bind: vi.fn().mockImplementation((...params: unknown[]) => {
        return {
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockImplementation(async () => {
            if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
              return {
                results: [
                  {
                    id: "admin-master",
                    name: "マスター管理者",
                    password_hash: masterHash,
                    role: "admin",
                    max_stocks: null,
                    max_indices: null,
                    is_active: 1,
                  },
                ],
              };
            }
            if (query.includes("WHERE id != ? AND id != 'admin-master'")) {
              const excludedId = params[0];
              const filtered = mockUsers.filter((u) => u.id !== excludedId);
              return { results: filtered };
            }
            if (query.includes("WHERE id != 'admin-master'")) {
              return { results: mockUsers };
            }
            return { results: [] };
          }),
          run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
        };
      }),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockImplementation(async () => {
        if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
          return {
            results: [
              {
                id: "admin-master",
                name: "マスター管理者",
                password_hash: masterHash,
                role: "admin",
                max_stocks: null,
                max_indices: null,
                is_active: 1,
              },
            ],
          };
        }
        if (query.includes("WHERE id != 'admin-master'")) {
          return { results: mockUsers };
        }
        return { results: [] };
      }),
      run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
    };
  });

  return {
    DB: {
      prepare,
      batch: vi.fn().mockResolvedValue([{ success: true, meta: { changes: 1 } }]),
    },
    ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    ASSETS: {
      fetch: vi.fn().mockResolvedValue(new Response("asset content", { status: 200 })),
    },
  };
}

describe("Comprehensive Goal Final Review Audit Tests", () => {
  describe("Password Collision Security Boundaries (/api/admin/passwords)", () => {
    it("POST /api/admin/passwords rejects new account colliding with master admin account", async () => {
      const env = await createMultiUserTestEnv();
      const req = new Request("http://localhost/api/admin/passwords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          name: "管理者同値ユーザー",
          password: TEST_ADMIN_PASSWORD, // Collides with master admin
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data).toEqual({ error: "管理者アカウントと同一のパスワードは設定できません" });
    });

    it("PUT /api/admin/passwords rejects updating user password to master admin password", async () => {
      const env = await createMultiUserTestEnv();
      const req = new Request("http://localhost/api/admin/passwords", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          id: "user-1",
          password: TEST_ADMIN_PASSWORD, // Collides with master admin
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data).toEqual({ error: "管理者アカウントと同一のパスワードは設定できません" });
    });

    it("POST /api/admin/passwords allows creating an account with unique password", async () => {
      const env = await createMultiUserTestEnv();
      const req = new Request("http://localhost/api/admin/passwords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          name: "新規一意アカウント",
          password: "BrandNewUniquePassword123!",
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.password.name).toBe("新規一意アカウント");
    });
  });

  describe("Defensive Currency and Index Engine Utilities", () => {
    it("getStockCurrency safely handles null, undefined, empty, and non-string inputs", () => {
      expect(getStockCurrency(null)).toBe("$");
      expect(getStockCurrency(undefined)).toBe("$");
      expect(getStockCurrency("")).toBe("$");
      expect(getStockCurrency(123 as any)).toBe("$");
      expect(getStockCurrency("7203")).toBe("¥");
      expect(getStockCurrency("AAPL")).toBe("$");
    });

    it("formatStockPrice safely handles null, undefined, non-finite, and zero prices", () => {
      expect(formatStockPrice(null, "7203")).toBe("---");
      expect(formatStockPrice(undefined, "AAPL")).toBe("---");
      expect(formatStockPrice(-5, "7203")).toBe("---");
      expect(formatStockPrice(0, "AAPL")).toBe("---");
      expect(formatStockPrice(Number.NaN, "7203")).toBe("---");
      expect(formatStockPrice(1000, null)).toBe("$1,000.00");
      expect(formatStockPrice(1000, "7203")).toBe("¥1,000");
    });

    it("formatStockChange safely handles null, undefined, and non-finite change values", () => {
      expect(formatStockChange(null, "7203")).toBe("---");
      expect(formatStockChange(undefined, "AAPL")).toBe("---");
      expect(formatStockChange(Number.NaN, "7203")).toBe("---");
      expect(formatStockChange(25, "7203")).toBe("+¥25");
      expect(formatStockChange(-10.5, "AAPL")).toBe("-$10.50");
    });

    it("normalizeTicker safely handles null, undefined, and non-string inputs", () => {
      expect(normalizeTicker(null)).toBe("");
      expect(normalizeTicker(undefined)).toBe("");
      expect(normalizeTicker(123 as any)).toBe("");
      expect(normalizeTicker(" aapl ")).toBe("AAPL");
      expect(normalizeTicker("7203")).toBe("7203");
    });
  });
});
