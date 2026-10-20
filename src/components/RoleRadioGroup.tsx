import type { AuthRole } from "../types";

interface RoleRadioGroupProps {
  value: AuthRole;
  onChange: (role: AuthRole) => void;
}

/**
 * Role selector for the "issue a user password" form.
 *
 * Kept as its own component so the radiogroup semantics (one named group, two
 * native radios) are owned and tested in one place instead of being asserted
 * against the surrounding 2,800-line dashboard by string matching.
 */
export function RoleRadioGroup({ value, onChange }: RoleRadioGroupProps) {
  return (
    <div role="radiogroup" aria-label="権限ロール" style={{ marginBottom: 18 }}>
      <div
        style={{
          display: "block",
          fontSize: 12,
          color: "var(--text-secondary)",
          marginBottom: 6,
        }}
      >
        権限ロール
      </div>
      <div className="row" style={{ gap: 10 }}>
        <label className="row" style={{ gap: 6, fontSize: 12, cursor: "pointer" }}>
          <input
            type="radio"
            name="userRole"
            checked={value === "user"}
            onChange={() => onChange("user")}
          />
          <span>ユーザー（銘柄制限あり）</span>
        </label>
        <label className="row" style={{ gap: 6, fontSize: 12, cursor: "pointer" }}>
          <input
            type="radio"
            name="userRole"
            checked={value === "admin"}
            onChange={() => onChange("admin")}
          />
          <span>副管理者（無制限）</span>
        </label>
      </div>
    </div>
  );
}
