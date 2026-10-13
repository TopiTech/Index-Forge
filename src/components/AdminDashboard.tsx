import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import {
  Shield,
  KeyRound,
  Users,
  Sliders,
  Settings,
  Plus,
  Trash2,
  Copy,
  Check,
  RefreshCw,
  ArrowLeft,
  Lock,
  AlertCircle,
  Sparkles,
  Edit2,
  Eye,
  EyeOff,
  Activity,
  Server,
  Database,
  CheckCircle2,
  Clock,
  ShieldAlert,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { storeAuth, generateSecurePassword } from "../lib/auth";
import { getTurnstileConfig, changeAdminSecretCode } from "../lib/auth";
import { toFiniteNumberOr } from "../lib/downloadFileName";
import { SYSTEM_INDICES, type CustomIndex } from "../data/indices";
import type { BasketItem, UserPasswordItem } from "../types";
import { Card, Tag, Badge } from "./ui";
import { EditPasswordModal } from "./EditPasswordModal";
import { ConfirmModal } from "./ConfirmModal";
import { ModalBase } from "./ModalBase";
import { useToast } from "./Toast";
import { equalizeWeightsExact, normalizeTicker } from "../lib/indexEngine";
import { TurnstileWidget, type TurnstileWidgetRef } from "./TurnstileWidget";

export function getPasswordStrength(pwd: string): {
  score: number;
  label: string;
  color: string;
  widthPercent: number;
} {
  if (!pwd) return { score: 0, label: "未入力", color: "var(--border-subtle)", widthPercent: 0 };
  let score = 0;
  if (pwd.length >= 8) score += 1;
  if (pwd.length >= 12) score += 1;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score += 1;
  if (/[0-9]/.test(pwd)) score += 1;
  if (/[^A-Za-z0-9]/.test(pwd)) score += 1;

  if (score <= 1) return { score: 1, label: "脆弱 (Weak)", color: "var(--neon-red)", widthPercent: 25 };
  if (score === 2) return { score: 2, label: "普通 (Fair)", color: "var(--neon-amber)", widthPercent: 50 };
  if (score === 3 || score === 4) return { score: 3, label: "良好 (Good)", color: "#38bdf8", widthPercent: 75 };
  return { score: 5, label: "強固 (Strong)", color: "var(--neon-green)", widthPercent: 100 };
}

export function PasswordStrengthBar({ password }: { password: string }) {
  const strength = getPasswordStrength(password);
  if (!password) return null;
  return (
    <div style={{ marginTop: 6 }} className="password-strength-container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
        <span className="tiny muted mono" style={{ fontSize: "0.72rem" }}>パスワード強度:</span>
        <span className="tiny mono bold" style={{ fontSize: "0.72rem", color: strength.color }}>{strength.label}</span>
      </div>
      <div style={{ height: 4, width: "100%", background: "var(--surface-control)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${strength.widthPercent}%`, background: strength.color, transition: "width 0.3s ease" }} />
      </div>
    </div>
  );
}

interface AdminDashboardProps {
  indices: CustomIndex[];
  onBackToApp: () => void;
  onRefreshIndices: () => Promise<void>;
  saveCustomIndex: (index: CustomIndex, ownerToken?: string) => Promise<{ ok: boolean; error?: string }>;
  deleteCustomIndex: (id: string) => Promise<{ ok: boolean; error?: string }>;
}

export function AdminDashboard({
  indices,
  onBackToApp,
  onRefreshIndices,
  saveCustomIndex,
  deleteCustomIndex,
}: AdminDashboardProps) {
  const { session, isAdmin, adminLogin, logout, getHeaders } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();

  // Admin login state if not admin
  const [adminPasswordInput, setAdminPasswordInput] = useState("");
  const [showAdminLoginPassword, setShowAdminLoginPassword] = useState(false);
  const [adminSecretCodeInput, setAdminSecretCodeInput] = useState("");
  const [showAdminSecretCode, setShowAdminSecretCode] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("1x00000000000000000000AA");
  const [isLocked, setIsLocked] = useState(false);
  const [lockoutRemainingSeconds, setLockoutRemainingSeconds] = useState(0);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const turnstileRef = useRef<TurnstileWidgetRef>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  // Secret code change state
  const [currentSecretCodeInput, setCurrentSecretCodeInput] = useState("");
  const [newSecretCodeInput, setNewSecretCodeInput] = useState("");
  const [confirmSecretCodeInput, setConfirmSecretCodeInput] = useState("");
  const [showCurrentSecretCode, setShowCurrentSecretCode] = useState(false);
  const [showNewSecretCode, setShowNewSecretCode] = useState(false);
  const [showConfirmSecretCode, setShowConfirmSecretCode] = useState(false);
  const [updatingSecretCode, setUpdatingSecretCode] = useState(false);
  const [secretCodeError, setSecretCodeError] = useState<string | null>(null);
  const [secretCodeSuccess, setSecretCodeSuccess] = useState<string | null>(null);

  // Tabs
  const [activeTab, setActiveTab] = useState<"passwords" | "indices" | "system" | "settings">("passwords");

  // Passwords state
  const [passwords, setPasswords] = useState<UserPasswordItem[]>([]);
  const [loadingPasswords, setLoadingPasswords] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingPasswordItem, setEditingPasswordItem] = useState<UserPasswordItem | null>(null);
  const [passwordToDelete, setPasswordToDelete] = useState<{ id: string; name: string } | null>(null);
  const [deletingPassword, setDeletingPassword] = useState(false);

  // New password form
  const [newUserName, setNewUserName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState(() => generateSecurePassword());
  const [showNewUserPassword, setShowNewUserPassword] = useState(false);
  const [newUserMaxStocks, setNewUserMaxStocks] = useState<number | null>(10);
  const [newUserMaxIndices, setNewUserMaxIndices] = useState<number | null>(5);
  const [newUserRole, setNewUserRole] = useState<"user" | "admin">("user");
  const [creatingPassword, setCreatingPassword] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [issuedPassword, setIssuedPassword] = useState<{ name: string; password: string } | null>(null);

  // Full Index Edit state
  const [selectedEditIndexId, setSelectedEditIndexId] = useState<string>(
    indices.length > 0 ? indices[0].id : ""
  );
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editBaseValue, setEditBaseValue] = useState(1000);
  const [editBasket, setEditBasket] = useState<BasketItem[]>([]);
  const [savingIndex, setSavingIndex] = useState(false);
  const [indexEditMessage, setIndexEditMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [indexToDelete, setIndexToDelete] = useState<{ id: string; name: string } | null>(null);
  const [deletingIndex, setDeletingIndex] = useState(false);

  // Add stock to edit index inline
  const [addTicker, setAddTicker] = useState("");
  const [addName, setAddName] = useState("");
  const [addTheme, setAddTheme] = useState("");
  const [addWeight, setAddWeight] = useState(10);

  // Create new index modal state
  const [isCreateIndexModalOpen, setIsCreateIndexModalOpen] = useState(false);
  const [newIndexName, setNewIndexName] = useState("");
  const [newIndexDesc, setNewIndexDesc] = useState("");
  const [newIndexBaseValue, setNewIndexBaseValue] = useState(1000);
  const [creatingIndex, setCreatingIndex] = useState(false);

  // Change admin password state
  const [currentAdminPassword, setCurrentAdminPassword] = useState("");
  const [showCurrentAdminPassword, setShowCurrentAdminPassword] = useState(false);
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [showNewAdminPassword, setShowNewAdminPassword] = useState(false);
  const [confirmAdminPassword, setConfirmAdminPassword] = useState("");
  const [showConfirmAdminPassword, setShowConfirmAdminPassword] = useState(false);
  const [updatingAdminPwd, setUpdatingAdminPwd] = useState(false);
  const [adminPwdMessage, setAdminPwdMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // System Stats & Telemetry state
  interface SystemStatsData {
    dbStatus: string;
    indicesCount: number;
    totalConstituents: number;
    avgConstituentsPerIndex?: number;
    userPasswordsCount: number;
    activeUsersCount: number;
    adminUsersCount: number;
    cacheStats: {
      hits?: number;
      misses?: number;
      hitRatio: string;
    };
    serverTime: string;
    version: string;
  }
  const [systemStats, setSystemStats] = useState<SystemStatsData | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  const fetchSystemStats = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingStats(true);
    setStatsError(null);
    try {
      const res = await fetch("/api/admin/system-stats", {
        headers: getHeaders(),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setSystemStats(data.stats);
      } else {
        setStatsError(data.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : "テレメトリ取得に失敗しました");
    } finally {
      setLoadingStats(false);
    }
  }, [isAdmin, getHeaders]);

  // Fetch passwords
  const [passwordFetchError, setPasswordFetchError] = useState<string | null>(null);
  const isFetchingPasswordsRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchPasswords = useCallback(async () => {
    if (!isAdmin || isFetchingPasswordsRef.current) return;
    isFetchingPasswordsRef.current = true;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setLoadingPasswords(true);
      setPasswordFetchError(null);
      const res = await fetch("/api/admin/passwords", {
        headers: getHeaders(),
        signal: controller.signal,
      });
      if (res.ok) {
        if (!controller.signal.aborted) {
          const data = await res.json();
          setPasswords(Array.isArray(data) ? data : []);
        }
      } else {
        const data = await res.json().catch(() => ({}));
        const errText = typeof data.error === "string" ? data.error : `エラー (${res.status})`;
        console.error("Failed to fetch passwords:", errText);
        if (!controller.signal.aborted) setPasswordFetchError(errText);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : "パスワード一覧の取得に失敗しました";
      console.error("Failed to fetch passwords:", err);
      if (!controller.signal.aborted) setPasswordFetchError(msg);
    } finally {
      // An aborted request must not clear the loading state or release the
      // in-flight guard: the effect cleanup aborts and immediately re-runs
      // fetchPasswords, and the new invocation would otherwise be rejected by
      // the guard, leaving the table stuck on an empty list that looks like
      // "no passwords issued yet".
      if (!controller.signal.aborted) {
        setLoadingPasswords(false);
        isFetchingPasswordsRef.current = false;
      }
    }
  }, [isAdmin, getHeaders]);

  useEffect(() => {
    if (isAdmin && activeTab === "passwords") {
      fetchPasswords();
    }
    if (isAdmin && activeTab === "system") {
      void fetchSystemStats();
    }
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        // Release the guard synchronously so the next invocation can start.
        isFetchingPasswordsRef.current = false;
      }
    };
  }, [isAdmin, activeTab, fetchPasswords, fetchSystemStats]);

  const prevSelectedIdRef = useRef<string | null>(null);

  // Sync selected index data into edit fields
  useEffect(() => {
    const found = indices.find((idx) => idx.id === selectedEditIndexId) || indices[0];
    if (found) {
      const isInitialOrChanged = prevSelectedIdRef.current !== found.id;
      if (selectedEditIndexId !== found.id) {
        setSelectedEditIndexId(found.id);
      }
      if (isInitialOrChanged) {
        prevSelectedIdRef.current = found.id;
        setEditName(found.name);
        setEditDescription(found.description);
        setEditBaseValue(found.baseValue);
        setEditBasket([...found.basket]);
        setIndexEditMessage(null);
      }
    }
  }, [selectedEditIndexId, indices]);

  // Fetch Turnstile config and initial lockout status
  useEffect(() => {
    if (!isAdmin) {
      getTurnstileConfig().then((cfg) => {
        if (cfg.siteKey) setTurnstileSiteKey(cfg.siteKey);
        if (cfg.lockout?.locked) {
          setIsLocked(true);
          setLockoutRemainingSeconds(cfg.lockout.remainingSeconds);
        }
        if (typeof cfg.lockout?.remainingAttempts === "number") {
          setRemainingAttempts(cfg.lockout.remainingAttempts);
        }
      });
    }
  }, [isAdmin]);

  // Lockout countdown timer
  useEffect(() => {
    if (!isLocked || lockoutRemainingSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockoutRemainingSeconds((prev) => {
        if (prev <= 1) {
          setIsLocked(false);
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isLocked, lockoutRemainingSeconds]);

  // Admin login submit with Turnstile, secret code, and lockout handling
  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) {
      setLoginError("試行回数上限に達したためロックされています。解除までお待ちください。");
      return;
    }
    if (!adminPasswordInput.trim()) {
      setLoginError("管理者パスワードを入力してください");
      return;
    }
    if (!adminSecretCodeInput.trim()) {
      setLoginError("秘密の暗号を入力してください");
      return;
    }
    if (!turnstileToken.trim()) {
      setLoginError("Turnstile認証（ロボット確認）を完了してください");
      return;
    }

    setLoggingIn(true);
    setLoginError(null);
    const res = await adminLogin(
      adminPasswordInput.trim(),
      adminSecretCodeInput.normalize("NFC").trim(),
      turnstileToken.trim(),
    );
    setLoggingIn(false);

    if (!res.ok) {
      setLoginError(res.error || "管理者パスワードまたは秘密の暗号が正しくありません");
      if (res.locked) {
        setIsLocked(true);
        if (typeof res.remainingSeconds === "number") {
          setLockoutRemainingSeconds(res.remainingSeconds);
        }
      }
      if (typeof res.remainingAttempts === "number") {
        setRemainingAttempts(res.remainingAttempts);
      }
      turnstileRef.current?.reset();
      setTurnstileToken("");
    }
  };

  // Change admin secret code submit
  const handleChangeSecretCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setSecretCodeError(null);
    setSecretCodeSuccess(null);

    const normNew = newSecretCodeInput.normalize("NFC").trim();
    const normConfirm = confirmSecretCodeInput.normalize("NFC").trim();
    const normCurrent = currentSecretCodeInput.normalize("NFC").trim();

    if (!normCurrent) {
      setSecretCodeError("現在の秘密の暗号を入力してください");
      return;
    }
    if (!normNew || normNew.length < 6) {
      setSecretCodeError(`新しい秘密の暗号は6文字以上で入力してください（現在: ${normNew.length}文字）`);
      return;
    }
    if (normNew.length > 100) {
      setSecretCodeError("新しい秘密の暗号は100文字以内で入力してください");
      return;
    }
    if (normNew !== normConfirm) {
      setSecretCodeError("新しい秘密の暗号（確認）が一致しません");
      return;
    }

    setUpdatingSecretCode(true);
    const res = await changeAdminSecretCode(
      normCurrent,
      normNew,
      getHeaders(),
    );
    setUpdatingSecretCode(false);

    if (!res.ok) {
      setSecretCodeError(res.error || "秘密の暗号の更新に失敗しました");
    } else {
      setSecretCodeSuccess("秘密の暗号を正常に更新しました");
      setCurrentSecretCodeInput("");
      setNewSecretCodeInput("");
      setConfirmSecretCodeInput("");
      toastSuccess("秘密の暗号を更新しました");
    }
  };

  // Create user password submit
  const handleCreatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserPassword.trim()) {
      setCreateError("ユーザー名とパスワードは必須です");
      return;
    }
    if (newUserName.trim().length > 100) {
      setCreateError("ユーザー名は100文字以内で入力してください");
      return;
    }
    if (newUserPassword.trim().length > 100) {
      setCreateError("パスワードは100文字以内で入力してください");
      return;
    }
    setCreatingPassword(true);
    setCreateError(null);
    setCreateSuccess(null);
    setIssuedPassword(null);

    try {
      const res = await fetch("/api/admin/passwords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getHeaders(),
        },
        body: JSON.stringify({
          name: newUserName.trim(),
          password: newUserPassword.trim(),
          maxStocks: newUserRole === "admin" ? null : newUserMaxStocks,
          maxIndices: newUserRole === "admin" ? null : newUserMaxIndices,
          role: newUserRole,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "パスワード作成に失敗しました");
      }

      // The plaintext password is the value the operator just generated.
      // It must be shown once here and never round-tripped through the API
      // response, where it would be exposed to server logs and caches.
      const initialPassword = newUserPassword.trim();
      setCreateSuccess(`パスワードを作成しました: [${newUserName.trim()}] / 銘柄制限: ${newUserRole === "admin" ? "無制限" : `${newUserMaxStocks}銘柄`} / 指数上限: ${newUserRole === "admin" ? "無制限" : `${newUserMaxIndices}件`}`);
      if (initialPassword) {
        setIssuedPassword({ name: newUserName.trim(), password: initialPassword });
      }
      setNewUserName("");
      setNewUserPassword(generateSecurePassword());
      await fetchPasswords();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "パスワード作成に失敗しました");
    } finally {
      setCreatingPassword(false);
    }
  };

  // Delete password confirmation
  const confirmDeletePassword = async () => {
    if (!passwordToDelete) return;
    setDeletingPassword(true);
    try {
      const res = await fetch(`/api/admin/passwords?id=${encodeURIComponent(passwordToDelete.id)}`, {
        method: "DELETE",
        headers: getHeaders(),
      });
      if (res.ok) {
        toastSuccess(`パスワード「${passwordToDelete.name}」を削除しました`);
        setPasswordToDelete(null);
        await fetchPasswords();
      } else {
        const data = await res.json().catch(() => ({}));
        toastError("削除に失敗しました: " + (data.error || `HTTP ${res.status}`));
      }
    } catch (err) {
      toastError("削除に失敗しました: " + (err instanceof Error ? err.message : ""));
    } finally {
      setDeletingPassword(false);
    }
  };

  // Copy password to clipboard
  const handleCopy = async (text: string, id: string) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.warn("Failed to copy password:", err);
    }
  };

  // Toggle active password
  const handleToggleActive = async (item: UserPasswordItem) => {
    try {
      const nextActive = item.is_active !== 1;
      const res = await fetch("/api/admin/passwords", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...getHeaders(),
        },
        body: JSON.stringify({
          id: item.id,
          isActive: nextActive,
        }),
      });
      if (res.ok) {
        toastSuccess(`「${item.name}」を${nextActive ? "有効化" : "無効化"}しました`);
        await fetchPasswords();
      } else {
        const data = await res.json().catch(() => ({}));
        toastError("状態更新に失敗しました: " + (data.error || `HTTP ${res.status}`));
      }
    } catch (err) {
      console.error("状態更新エラー:", err);
      toastError("状態更新に失敗しました: " + (err instanceof Error ? err.message : ""));
    }
  };

  // Add stock to edit basket
  const handleAddStockToBasket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addTicker.trim() || !addName.trim()) return;
    const cleanTicker = normalizeTicker(addTicker);
    if (!/^[A-Za-z0-9.-]+$/.test(cleanTicker) || cleanTicker.length > 20) {
      setIndexEditMessage({ type: "error", text: "有効な銘柄コードを入力してください（英数字・ドット・ハイフンのみ、20文字以内）" });
      return;
    }
    if (editBasket.some((b) => normalizeTicker(b.ticker) === cleanTicker)) {
      setIndexEditMessage({ type: "error", text: `銘柄コード ${cleanTicker} は既に追加されています` });
      return;
    }
    setEditBasket([
      ...editBasket,
      {
        ticker: cleanTicker,
        name: addName.trim(),
        theme: addTheme.trim() || "カスタム",
        weight: Math.max(0.1, Number(addWeight) || 10),
      },
    ]);
    setAddTicker("");
    setAddName("");
    setAddTheme("");
    setIndexEditMessage(null);
  };

  // Save index full edit
  const handleSaveIndexFullEdit = async () => {
    if (!editName.trim()) {
      setIndexEditMessage({ type: "error", text: "指数名は必須です" });
      return;
    }
    if (editName.trim().length > 100) {
      setIndexEditMessage({ type: "error", text: "指数名は100文字以内で入力してください" });
      return;
    }
    if (editDescription.trim().length > 500) {
      setIndexEditMessage({ type: "error", text: "指数説明は500文字以内で入力してください" });
      return;
    }
    if (isNaN(editBaseValue) || editBaseValue <= 0 || editBaseValue > 1000000) {
      setIndexEditMessage({ type: "error", text: "基準値は0より大きく1,000,000以下の数値を入力してください" });
      return;
    }
    if (editBasket.length === 0) {
      setIndexEditMessage({ type: "error", text: "最低1銘柄の構成銘柄が必要です" });
      return;
    }

    setSavingIndex(true);
    setIndexEditMessage(null);
    const effectiveIndexId = selectedEditIndexId || indices.find((idx) => idx.id === selectedEditIndexId)?.id || indices[0]?.id || "";
    if (!effectiveIndexId) {
      setSavingIndex(false);
      setIndexEditMessage({ type: "error", text: "編集対象の指数が見つかりません" });
      return;
    }
    const currentIndex = indices.find((idx) => idx.id === effectiveIndexId);
    const updated: CustomIndex = {
      id: effectiveIndexId,
      name: editName.trim(),
      description: editDescription.trim(),
      baseValue: editBaseValue,
      basket: editBasket,
      sortOrder: currentIndex?.sortOrder,
    };

    const res = await saveCustomIndex(updated);
    setSavingIndex(false);
    if (res.ok) {
      setIndexEditMessage({ type: "success", text: "指数と構成銘柄を保存しました！" });
      await onRefreshIndices();
    } else {
      setIndexEditMessage({ type: "error", text: res.error || "保存に失敗しました" });
    }
  };

  // Delete custom index confirmation
  const confirmDeleteIndex = async () => {
    if (!indexToDelete) return;
    setDeletingIndex(true);
    try {
      const targetId = indexToDelete.id;
      const res = await deleteCustomIndex(targetId);
      if (res.ok) {
        toastSuccess(`カスタム指数「${indexToDelete.name}」を削除しました`);
        setIndexToDelete(null);
        await onRefreshIndices();
        const remaining = indices.filter((idx) => idx.id !== targetId);
        if (remaining.length > 0) {
          setSelectedEditIndexId(remaining[0].id);
        }
      } else {
        toastError(res.error || "指数の削除に失敗しました");
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : "指数の削除に失敗しました");
    } finally {
      setDeletingIndex(false);
    }
  };

  // Create new custom index modal submit
  const handleCreateNewIndexSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIndexName.trim()) {
      toastError("指数名を入力してください");
      return;
    }
    setCreatingIndex(true);
    const newId = `idx-admin-${Date.now()}`;
    const newIndex: CustomIndex = {
      id: newId,
      name: newIndexName.trim(),
      description: newIndexDesc.trim() || "管理者作成のカスタムインデックス",
      baseValue: Number(newIndexBaseValue) || 1000,
      basket: [
        { ticker: "7203", name: "トヨタ自動車", theme: "モビリティ", weight: 33.3 },
        { ticker: "6758", name: "ソニーグループ", theme: "エンタメ・技術", weight: 33.3 },
        { ticker: "8035", name: "東京エレクトロン", theme: "半導体", weight: 33.4 },
      ],
    };
    const res = await saveCustomIndex(newIndex);
    setCreatingIndex(false);
    if (res.ok) {
      toastSuccess(`新規指数「${newIndex.name}」を作成しました`);
      await onRefreshIndices();
      setSelectedEditIndexId(newId);
      setIsCreateIndexModalOpen(false);
      setNewIndexName("");
      setNewIndexDesc("");
      setNewIndexBaseValue(1000);
    } else {
      toastError(res.error || "指数の作成に失敗しました");
    }
  };

  // Equalize weights
  const handleEqualWeights = () => {
    if (editBasket.length === 0) return;
    setEditBasket(equalizeWeightsExact(editBasket));
  };

  // Number inputs fire onChange with an empty string while the user is
  // clearing the field; Number("") is 0 and Number("12.") is NaN. A NaN weight
  // would poison the saved basket and later index calculations.
  const handleEditWeightChange = (ticker: string, raw: string) => {
    const cleanTicker = normalizeTicker(ticker);
    const next = toFiniteNumberOr(raw, 0.1);
    const safeWeight = Math.min(100, Math.max(0.1, next));
    setEditBasket(editBasket.map((item) => (normalizeTicker(item.ticker) === cleanTicker ? { ...item, weight: safeWeight } : item)));
  };

  // Change Master Admin Password
  const handleUpdateAdminPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    // The Worker trims password input before hashing and authenticating. Keep
    // the session value in exactly the same canonical form, otherwise a
    // password with accidental edge whitespace appears to succeed but every
    // subsequent request from this tab is rejected.
    const normalizedPassword = newAdminPassword.trim();
    const normalizedConfirmation = confirmAdminPassword.trim();
    if (normalizedPassword.length < 8 || normalizedPassword.length > 100) {
      setAdminPwdMessage({ type: "error", text: "パスワードは8〜100文字で入力してください" });
      return;
    }
    if (normalizedPassword !== normalizedConfirmation) {
      setAdminPwdMessage({ type: "error", text: "確認用パスワードが一致しません" });
      return;
    }

    setUpdatingAdminPwd(true);
    setAdminPwdMessage(null);
    try {
      const res = await fetch("/api/admin/admin-password", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...getHeaders(),
        },
        body: JSON.stringify({
          currentPassword: currentAdminPassword.trim() || undefined,
          newPassword: normalizedPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "管理者パスワードの更新に失敗しました");
      }
      setAdminPwdMessage({ type: "success", text: "管理者パスワードを正常に変更しました" });
      const updatedPassword = normalizedPassword;
      setNewAdminPassword("");
      setConfirmAdminPassword("");
      setCurrentAdminPassword("");
      if (session) {
        storeAuth({ ...session, password: updatedPassword });
      }
    } catch (err) {
      setAdminPwdMessage({ type: "error", text: err instanceof Error ? err.message : "更新に失敗しました" });
    } finally {
      setUpdatingAdminPwd(false);
    }
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const tabs = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') || [],
    );
    const currentIndex = tabs.indexOf(event.currentTarget);
    if (currentIndex < 0) return;

    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;

    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
  };

  // If not authenticated as Admin, show login screen
  if (!isAdmin) {
    return (
      <div className="app" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <header className="top-header">
          <div className="row space-between">
            <div className="row" style={{ gap: 10 }}>
              <button
                type="button"
                onClick={onBackToApp}
                className="btn btn-sm btn-outline"
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <ArrowLeft size={14} /> ダッシュボードに戻る
              </button>
            </div>
            <Badge variant="magenta">
              <Shield size={12} /> ADMIN ACCESS REQUIRED
            </Badge>
          </div>
        </header>

        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            style={{
              width: "100%",
              maxWidth: 460,
              background: "var(--bg-surface)",
              border: "1px solid var(--border-cyan)",
              borderRadius: 14,
              boxShadow: "0 20px 60px rgba(0,0,0,0.8), 0 0 30px rgba(0,229,255,0.2)",
              padding: 28,
            }}
          >
            <div style={{ textAlign: "center", marginBottom: 22 }}>
              <div
                style={{
                  width: 54,
                  height: 54,
                  margin: "0 auto 12px",
                  borderRadius: "50%",
                  background: "rgba(0, 229, 255, 0.12)",
                  border: "1px solid var(--border-cyan)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Shield size={26} style={{ color: "var(--neon-cyan)" }} />
              </div>
              <h2 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 700 }}>
                管理者ポータル ログイン
              </h2>
              <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                ユーザー用パスワードの発行（銘柄数制限設定）や、全指数のフル編集権限を利用するには管理者パスワードを入力してください。
              </p>
            </div>

            {isLocked && (
              <div
                className="row"
                style={{
                  gap: 10,
                  padding: "12px 14px",
                  background: "rgba(255, 51, 102, 0.2)",
                  border: "1px solid var(--neon-red)",
                  borderRadius: 8,
                  color: "var(--neon-red)",
                  fontSize: 13,
                  marginBottom: 16,
                  alignItems: "flex-start",
                }}
              >
                <ShieldAlert size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>
                    セキュリティロック発動中
                  </div>
                  <div>
                    試行回数上限（5回）に達したため、管理者ログインは一時的にロックされています。
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginTop: 6,
                      fontWeight: 600,
                      color: "#fff",
                    }}
                  >
                    <Clock size={14} />
                    <span>
                      解除まで残り: {Math.floor(lockoutRemainingSeconds / 60)}分
                      {String(lockoutRemainingSeconds % 60).padStart(2, "0")}秒
                    </span>
                  </div>
                </div>
              </div>
            )}

            {!isLocked && remainingAttempts !== null && remainingAttempts < 5 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 12px",
                  background: "rgba(255, 170, 0, 0.12)",
                  border: "1px solid rgba(255, 170, 0, 0.4)",
                  borderRadius: 6,
                  fontSize: 12,
                  color: "var(--neon-amber, #ffaa00)",
                  marginBottom: 14,
                }}
              >
                <span>⚠️ 認証失敗の試行履歴があります</span>
                <span style={{ fontWeight: 700 }}>
                  残り試行可能回数: {remainingAttempts}回 / 5回
                </span>
              </div>
            )}

            {loginError && !isLocked && (
              <div
                className="row"
                style={{
                  gap: 8,
                  padding: "10px 14px",
                  background: "rgba(255, 51, 102, 0.15)",
                  border: "1px solid var(--neon-red)",
                  borderRadius: 8,
                  color: "var(--neon-red)",
                  fontSize: 13,
                  marginBottom: 16,
                }}
              >
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{loginError}</span>
              </div>
            )}

            <form onSubmit={handleAdminLogin}>
              <div style={{ marginBottom: 16 }}>
                <label
                  htmlFor="admin-password-input"
                  style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}
                >
                  管理者マスターパスワード <span style={{ color: "var(--neon-red)" }}>*</span>
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    id="admin-password-input"
                    type={showAdminLoginPassword ? "text" : "password"}
                    value={adminPasswordInput}
                    onChange={(e) => setAdminPasswordInput(e.target.value)}
                    placeholder="設定済みの管理者パスワード"
                    autoComplete="current-password"
                    disabled={isLocked || loggingIn}
                    autoFocus
                    style={{
                      width: "100%",
                      padding: "11px 40px 11px 14px",
                      background: "var(--bg-input)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 8,
                      color: "var(--text-primary)",
                      fontSize: 14,
                      boxSizing: "border-box",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowAdminLoginPassword(!showAdminLoginPassword)}
                    aria-label={showAdminLoginPassword ? "パスワードを非表示" : "パスワードを表示"}
                    style={{
                      position: "absolute",
                      right: 10,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "transparent",
                      border: "none",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      padding: 4,
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    {showAdminLoginPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label
                  htmlFor="admin-secret-code-input"
                  style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}
                >
                  秘密の暗号 (Admin Secret Code) <span style={{ color: "var(--neon-red)" }}>*必須</span>
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    id="admin-secret-code-input"
                    type="text"
                    inputMode="text"
                    lang="ja"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck="false"
                    value={adminSecretCodeInput}
                    onChange={(e) => setAdminSecretCodeInput(e.target.value)}
                    placeholder="管理者専用の秘密の暗号（ひらがな・カタカナ可）"
                    disabled={isLocked || loggingIn}
                    style={{
                      width: "100%",
                      padding: "11px 40px 11px 14px",
                      background: "var(--bg-input)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 8,
                      color: "var(--text-primary)",
                      fontSize: 14,
                      boxSizing: "border-box",
                      WebkitTextSecurity: showAdminSecretCode ? "none" : "disc",
                    } as React.CSSProperties}
                  />
                  <button
                    type="button"
                    onClick={() => setShowAdminSecretCode(!showAdminSecretCode)}
                    aria-label={showAdminSecretCode ? "秘密の暗号を非表示" : "秘密の暗号を表示"}
                    style={{
                      position: "absolute",
                      right: 10,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "transparent",
                      border: "none",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      padding: 4,
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    {showAdminSecretCode ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="muted tiny" style={{ marginTop: 6, lineHeight: 1.4 }}>
                  ※ 不正アクセス防御のため、秘密の暗号の入力が必須です（ひらがな・カタカナ・英数字・記号入力対応）。未変更時の初期値は環境変数 <code>ADMIN_SECRET_CODE</code> または開発用暗号です。
                </div>
              </div>

              {!isLocked && (
                <TurnstileWidget
                  ref={turnstileRef}
                  siteKey={turnstileSiteKey}
                  onVerify={(token) => {
                    setTurnstileToken(token);
                    setLoginError(null);
                  }}
                  onExpire={() => setTurnstileToken("")}
                  onError={() => setTurnstileToken("")}
                />
              )}

              <button
                type="submit"
                disabled={
                  isLocked ||
                  loggingIn ||
                  !adminPasswordInput.trim() ||
                  !adminSecretCodeInput.trim() ||
                  !turnstileToken.trim()
                }
                className="btn btn-default"
                style={{ width: "100%", padding: "10px 16px" }}
              >
                {isLocked
                  ? "一時的にロックされています"
                  : loggingIn
                  ? "認証中..."
                  : "管理者としてログイン"}
              </button>
            </form>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="app" style={{ minHeight: "100vh" }}>
      {/* Top Header */}
      <header className="top-header" style={{ marginBottom: 20 }}>
        <div className="row space-between flex-wrap" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 12 }}>
            <button
              type="button"
              onClick={onBackToApp}
              className="btn btn-sm btn-outline"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <ArrowLeft size={14} /> ダッシュボードに戻る
            </button>
            <div>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <h1 style={{ fontSize: 20, margin: 0, fontWeight: 700 }}>
                  管理者コンソール // FULL PRIVILEGES
                </h1>
                <Badge variant="cyan">ADMIN</Badge>
              </div>
              <div className="muted tiny" style={{ marginTop: 2 }}>
                ユーザーパスワード作成・上限銘柄数制限・全指数フル編集
              </div>
            </div>
          </div>

          <div className="row" style={{ gap: 10 }}>
            <button
              type="button"
              onClick={logout}
              className="btn btn-sm btn-outline"
              style={{ borderColor: "rgba(255,51,102,0.4)", color: "var(--neon-red)" }}
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div
        className="row admin-tabs"
        role="tablist"
        aria-label="管理者コンソールの設定項目"
        style={{
          gap: 8,
          marginBottom: 20,
          borderBottom: "1px solid var(--border-subtle)",
          paddingBottom: 10,
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab("passwords")}
          id="admin-tab-passwords"
          role="tab"
          aria-selected={activeTab === "passwords"}
          aria-controls="admin-panel-passwords"
          tabIndex={activeTab === "passwords" ? 0 : -1}
          onKeyDown={handleTabKeyDown}
          className={`btn btn-sm admin-tab ${activeTab === "passwords" ? "btn-default" : "btn-outline"}`}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <KeyRound size={14} /> ユーザー用パスワード管理
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("indices")}
          id="admin-tab-indices"
          role="tab"
          aria-selected={activeTab === "indices"}
          aria-controls="admin-panel-indices"
          tabIndex={activeTab === "indices" ? 0 : -1}
          onKeyDown={handleTabKeyDown}
          className={`btn btn-sm admin-tab ${activeTab === "indices" ? "btn-default" : "btn-outline"}`}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <Sliders size={14} /> 全指数 & 銘柄フル編集
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("system")}
          id="admin-tab-system"
          role="tab"
          aria-selected={activeTab === "system"}
          aria-controls="admin-panel-system"
          tabIndex={activeTab === "system" ? 0 : -1}
          onKeyDown={handleTabKeyDown}
          className={`btn btn-sm admin-tab ${activeTab === "system" ? "btn-default" : "btn-outline"}`}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <Activity size={14} /> システム運用健全性
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("settings")}
          id="admin-tab-settings"
          role="tab"
          aria-selected={activeTab === "settings"}
          aria-controls="admin-panel-settings"
          tabIndex={activeTab === "settings" ? 0 : -1}
          onKeyDown={handleTabKeyDown}
          className={`btn btn-sm admin-tab ${activeTab === "settings" ? "btn-default" : "btn-outline"}`}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <Settings size={14} /> 管理者設定
        </button>
      </div>

      {/* TAB 1: Passwords Management */}
      {activeTab === "passwords" && (
        <div
          id="admin-panel-passwords"
          role="tabpanel"
          aria-labelledby="admin-tab-passwords"
          tabIndex={0}
          className="admin-passwords-layout admin-tabpanel"
        >
          {/* Create Password Form */}
          <Card className="section">
            <div className="row" style={{ gap: 8, marginBottom: 14 }}>
              <Plus size={16} style={{ color: "var(--neon-cyan)" }} />
              <h2 style={{ fontSize: 16, margin: 0, fontWeight: 700 }}>
                ユーザー用パスワード新規作成
              </h2>
            </div>
            <p className="muted tiny" style={{ marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>
              ユーザーに配布するパスワードを発行します。パスワードごとに追加可能な構成銘柄数の上限を設定できます。
            </p>

            {createError && (
              <div
                className="row"
                style={{
                  gap: 8,
                  padding: "8px 12px",
                  background: "rgba(255, 51, 102, 0.15)",
                  border: "1px solid var(--neon-red)",
                  borderRadius: 6,
                  color: "var(--neon-red)",
                  fontSize: 12,
                  marginBottom: 14,
                }}
              >
                <AlertCircle size={14} />
                <span>{createError}</span>
              </div>
            )}

            {createSuccess && (
              <div
                className="row"
                style={{
                  gap: 8,
                  padding: "8px 12px",
                  background: "rgba(0, 255, 157, 0.15)",
                  border: "1px solid var(--neon-green)",
                  borderRadius: 6,
                  color: "var(--neon-green)",
                  fontSize: 12,
                  marginBottom: 14,
                }}
              >
                <Check size={14} />
                <span>{createSuccess}</span>
              </div>
            )}

            {issuedPassword && (
              <div
                role="status"
                aria-live="polite"
                style={{
                  padding: "10px 12px",
                  background: "rgba(0, 229, 255, 0.1)",
                  border: "1px solid var(--border-cyan)",
                  borderRadius: 6,
                  marginBottom: 14,
                }}
              >
                <div className="muted tiny" style={{ marginBottom: 6 }}>
                  {issuedPassword.name} の初期パスワード（この画面でのみ表示）
                </div>
                <div className="row space-between" style={{ gap: 8 }}>
                  <code style={{ color: "var(--neon-cyan)", wordBreak: "break-all" }}>
                    {issuedPassword.password}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy(issuedPassword.password, "issued-password")}
                    className="btn btn-sm btn-outline"
                    aria-label={copiedId === "issued-password" ? "初期パスワードをコピー済み" : "初期パスワードをコピー"}
                  >
                    {copiedId === "issued-password" ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={handleCreatePassword}>
              <div style={{ marginBottom: 14 }}>
                <label htmlFor="new-user-name" style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                  ユーザー名 / 組織名 <span style={{ color: "var(--neon-red)" }}>*</span>
                </label>
                <input
                  id="new-user-name"
                  type="text"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="例: リサーチチームA, 外部アナリスト"
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    background: "var(--bg-input)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 6,
                    color: "var(--text-primary)",
                    fontSize: 13,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <div className="row space-between" style={{ marginBottom: 4 }}>
                  <label htmlFor="new-user-password" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    パスワード <span style={{ color: "var(--neon-red)" }}>*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setNewUserPassword(generateSecurePassword())}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--neon-cyan)",
                      fontSize: 11,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Sparkles size={12} /> ランダム再生成
                  </button>
                </div>
                <div style={{ position: "relative" }}>
                  <input
                    id="new-user-password"
                    type={showNewUserPassword ? "text" : "password"}
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                    autoComplete="new-password"
                    style={{
                      width: "100%",
                      padding: "8px 36px 8px 10px",
                      background: "var(--bg-input)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 6,
                      color: "var(--neon-cyan)",
                      fontFamily: "monospace",
                      fontSize: 14,
                      boxSizing: "border-box",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewUserPassword(!showNewUserPassword)}
                    aria-label={showNewUserPassword ? "パスワードを非表示" : "パスワードを表示"}
                    style={{
                      position: "absolute",
                      right: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "transparent",
                      border: "none",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      padding: 2,
                      display: "flex",
                    }}
                  >
                    {showNewUserPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <PasswordStrengthBar password={newUserPassword} />
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
                  追加可能銘柄数（制限）
                </div>
                <div className="row flex-wrap" style={{ gap: 6, marginBottom: 8 }} role="group" aria-label="追加可能銘柄数（制限）のプリセット">
                  {[3, 5, 10, 20].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setNewUserMaxStocks(preset)}
                      aria-pressed={newUserMaxStocks === preset}
                      className={`btn btn-sm ${newUserMaxStocks === preset ? "btn-default" : "btn-outline"}`}
                      style={{ padding: "4px 10px", fontSize: 11 }}
                    >
                      {preset} 銘柄
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setNewUserMaxStocks(null)}
                    aria-pressed={newUserMaxStocks === null}
                    className={`btn btn-sm ${newUserMaxStocks === null ? "btn-default" : "btn-outline"}`}
                    style={{ padding: "4px 10px", fontSize: 11 }}
                  >
                    無制限
                  </button>
                </div>

                {newUserMaxStocks !== null && (
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    <label htmlFor="new-user-max-stocks" style={{ fontSize: 12, color: "var(--text-secondary)" }}>カスタム上限:</label>
                    <input
                      id="new-user-max-stocks"
                      type="number"
                      aria-label="カスタム上限銘柄数"
                      min="1"
                      max="500"
                      value={newUserMaxStocks}
                      onChange={(e) =>
                        setNewUserMaxStocks(
                          Math.min(500, Math.max(1, Math.floor(toFiniteNumberOr(e.target.value, 1)))),
                        )
                      }
                      style={{
                        width: 80,
                        padding: "6px 8px",
                        background: "var(--bg-input)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: 6,
                        color: "var(--text-primary)",
                        fontSize: 12,
                      }}
                    />
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>銘柄まで追加可能</span>
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
                  追加可能指数数（制限）
                </div>
                <div className="row flex-wrap" style={{ gap: 6, marginBottom: 8 }} role="group" aria-label="追加可能指数数（制限）のプリセット">
                  {[1, 3, 5, 10].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setNewUserMaxIndices(preset)}
                      aria-pressed={newUserMaxIndices === preset}
                      className={`btn btn-sm ${newUserMaxIndices === preset ? "btn-default" : "btn-outline"}`}
                      style={{ padding: "4px 10px", fontSize: 11 }}
                    >
                      {preset} 件
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setNewUserMaxIndices(null)}
                    aria-pressed={newUserMaxIndices === null}
                    className={`btn btn-sm ${newUserMaxIndices === null ? "btn-default" : "btn-outline"}`}
                    style={{ padding: "4px 10px", fontSize: 11 }}
                  >
                    無制限
                  </button>
                </div>

                {newUserMaxIndices !== null && (
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    <label htmlFor="new-user-max-indices" style={{ fontSize: 12, color: "var(--text-secondary)" }}>カスタム上限:</label>
                    <input
                      id="new-user-max-indices"
                      type="number"
                      aria-label="カスタム上限指数数"
                      min="1"
                      max="100"
                      value={newUserMaxIndices}
                      onChange={(e) =>
                        setNewUserMaxIndices(
                          Math.min(100, Math.max(1, Math.floor(toFiniteNumberOr(e.target.value, 1)))),
                        )
                      }
                      style={{
                        width: 80,
                        padding: "6px 8px",
                        background: "var(--bg-input)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: 6,
                        color: "var(--text-primary)",
                        fontSize: 12,
                      }}
                    />
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>指数まで作成可能</span>
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
                  権限ロール
                </label>
                <div className="row" style={{ gap: 10 }}>
                  <label className="row" style={{ gap: 6, fontSize: 12, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="userRole"
                      checked={newUserRole === "user"}
                      onChange={() => setNewUserRole("user")}
                    />
                    <span>ユーザー（銘柄制限あり）</span>
                  </label>
                  <label className="row" style={{ gap: 6, fontSize: 12, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="userRole"
                      checked={newUserRole === "admin"}
                      onChange={() => setNewUserRole("admin")}
                    />
                    <span>副管理者（無制限）</span>
                  </label>
                </div>
              </div>

              <button
                type="submit"
                disabled={creatingPassword || !newUserName.trim() || !newUserPassword.trim()}
                className="btn btn-default"
                style={{ width: "100%", padding: "9px 14px" }}
              >
                {creatingPassword ? "作成中..." : "ユーザーパスワードを発行"}
              </button>
            </form>
          </Card>

          {/* Passwords List */}
          <Card className="section">
            <div className="row space-between" style={{ marginBottom: 14 }}>
              <div className="row" style={{ gap: 8 }}>
                <Users size={16} style={{ color: "var(--neon-cyan)" }} />
                <h2 style={{ fontSize: 16, margin: 0, fontWeight: 700 }}>
                  発行済みパスワード一覧
                </h2>
                <Badge variant="cyan">{passwords.length} 件</Badge>
              </div>
              <button
                type="button"
                onClick={fetchPasswords}
                className="btn btn-sm btn-outline"
                title="一覧を再読み込み"
              >
                <RefreshCw size={12} /> 更新
              </button>
            </div>

            {passwordFetchError && (
              <div
                className="row space-between"
                style={{
                  padding: "10px 14px",
                  background: "rgba(255, 51, 102, 0.15)",
                  border: "1px solid var(--neon-red)",
                  borderRadius: 8,
                  color: "var(--neon-red)",
                  fontSize: 12,
                  marginBottom: 14,
                }}
              >
                <div className="row" style={{ gap: 8 }}>
                  <AlertCircle size={15} style={{ flexShrink: 0 }} />
                  <span>{passwordFetchError}</span>
                </div>
                <button
                  type="button"
                  onClick={fetchPasswords}
                  className="btn btn-sm btn-outline"
                  style={{ borderColor: "var(--neon-red)", color: "var(--neon-red)", padding: "2px 8px", fontSize: 11 }}
                >
                  再試行
                </button>
              </div>
            )}

            {loadingPasswords ? (
              <div style={{ textAlign: "center", padding: "30px 0" }} className="muted">
                読み込み中...
              </div>
            ) : passwords.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0" }} className="muted">
                発行されたユーザーパスワードはまだありません。左のフォームから作成してください。
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th style={{ width: "20%" }}>名前 / ラベル</th>
                      <th style={{ width: "12%" }}>ロール</th>
                      <th style={{ width: "22%" }}>銘柄 / 指数 上限</th>
                      <th style={{ width: "24%" }}>パスワード</th>
                      <th style={{ width: "11%" }}>状態</th>
                      <th style={{ width: "11%", textAlign: "center" }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {passwords.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{item.name}</div>
                          <div className="muted tiny mono">
                            {new Date(item.created_at * 1000).toLocaleDateString("ja-JP")}
                          </div>
                        </td>
                        <td>
                          {item.role === "admin" ? (
                            <Badge variant="magenta">管理者</Badge>
                          ) : (
                            <Badge variant="cyan">ユーザー</Badge>
                          )}
                        </td>
                        <td>
                          <div>
                            {item.max_stocks ? (
                              <span className="mono" style={{ color: "var(--neon-cyan)", fontWeight: 600, fontSize: 12 }}>
                                銘柄: 最大 {item.max_stocks} 銘柄
                              </span>
                            ) : (
                              <span className="muted tiny">銘柄: 無制限</span>
                            )}
                          </div>
                          <div style={{ marginTop: 3 }}>
                            {item.max_indices ? (
                              <span className="mono" style={{ color: "var(--neon-magenta)", fontWeight: 600, fontSize: 12 }}>
                                指数: 最大 {item.max_indices} 件
                              </span>
                            ) : (
                              <span className="muted tiny">指数: 無制限</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className="muted tiny">（作成時のみ表示）</span>
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => handleToggleActive(item)}
                            className="btn btn-sm"
                            style={{
                              padding: "2px 6px",
                              fontSize: 10,
                              background: item.is_active === 1 ? "rgba(0, 255, 157, 0.15)" : "rgba(255, 51, 102, 0.15)",
                              color: item.is_active === 1 ? "var(--neon-green)" : "var(--neon-red)",
                              border: `1px solid ${item.is_active === 1 ? "rgba(0,255,157,0.3)" : "rgba(255,51,102,0.3)"}`,
                            }}
                          >
                            {item.is_active === 1 ? "有効" : "停止"}
                          </button>
                        </td>
                         <td style={{ textAlign: "center" }}>
                          <div className="row" style={{ gap: 4, justifyContent: "center" }}>
                            <button
                              type="button"
                              onClick={() => setEditingPasswordItem(item)}
                              aria-label={`${item.name}のパスワード設定を編集`}
                              title="設定編集"
                              style={{
                                background: "transparent",
                                border: "none",
                                color: "var(--neon-cyan)",
                                cursor: "pointer",
                                padding: 4,
                              }}
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setPasswordToDelete({ id: item.id, name: item.name })}
                              aria-label={`${item.name}のパスワードを削除`}
                              title="削除"
                              style={{
                                background: "transparent",
                                border: "none",
                                color: "var(--neon-red)",
                                cursor: "pointer",
                                padding: 4,
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* TAB 2: Full Edit of Indices & Constituents */}
      {activeTab === "indices" && (
        <div
          id="admin-panel-indices"
          role="tabpanel"
          aria-labelledby="admin-tab-indices"
          tabIndex={0}
          className="grid admin-tabpanel"
          style={{ gap: 20 }}
        >
          <Card className="section">
            <div className="row space-between flex-wrap" style={{ gap: 12, marginBottom: 16 }}>
              <div className="row" style={{ gap: 8 }}>
                <Sliders size={18} style={{ color: "var(--neon-cyan)" }} />
                <div>
                  <h2 style={{ fontSize: 16, margin: 0, fontWeight: 700 }}>
                    全指数 & 構成銘柄フル編集（制限なし）
                  </h2>
                  <div className="muted tiny">
                    管理者特権により、銘柄数制限を受けずに任意の銘柄追加・削除・比率変更が可能です。
                  </div>
                </div>
              </div>

              {/* Index selector & creator controls */}
              <div className="row flex-wrap" style={{ gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => setIsCreateIndexModalOpen(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, borderColor: "var(--neon-cyan)", color: "var(--neon-cyan)" }}
                  title="管理者権限で新しいカスタムインデックスを作成"
                >
                  <Plus size={14} /> 新規指数作成
                </button>
                <label htmlFor="admin-select-edit-index" style={{ fontSize: 12, color: "var(--text-secondary)" }}>編集対象指数:</label>
                <select
                  id="admin-select-edit-index"
                  aria-label="編集対象指数を選択"
                  value={selectedEditIndexId}
                  onChange={(e) => setSelectedEditIndexId(e.target.value)}
                  style={{
                    padding: "6px 12px",
                    background: "var(--bg-input)",
                    border: "1px solid var(--border-cyan)",
                    borderRadius: 6,
                    color: "var(--text-primary)",
                    fontSize: 13,
                  }}
                >
                  {indices.map((idx) => (
                    <option key={idx.id} value={idx.id}>
                      {idx.name} ({idx.basket.length}銘柄)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {indexEditMessage && (
              <div
                className="row"
                style={{
                  gap: 8,
                  padding: "10px 14px",
                  background: indexEditMessage.type === "success" ? "rgba(0,255,157,0.15)" : "rgba(255,51,102,0.15)",
                  border: `1px solid ${indexEditMessage.type === "success" ? "var(--neon-green)" : "var(--neon-red)"}`,
                  borderRadius: 8,
                  color: indexEditMessage.type === "success" ? "var(--neon-green)" : "var(--neon-red)",
                  fontSize: 13,
                  marginBottom: 16,
                }}
              >
                {indexEditMessage.type === "success" ? <Check size={16} /> : <AlertCircle size={16} />}
                <span>{indexEditMessage.text}</span>
              </div>
            )}

            {/* Index Metadata Settings */}
            <div className="admin-index-meta-grid">
              <div>
                <label htmlFor="admin-edit-index-name" style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                  指数名
                </label>
                <input
                  id="admin-edit-index-name"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    background: "var(--bg-input)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 6,
                    color: "var(--text-primary)",
                    fontSize: 14,
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label htmlFor="admin-edit-base-value" style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                  基準値 (Base Value)
                </label>
                <input
                  id="admin-edit-base-value"
                  type="number"
                  min="1"
                  max="1000000"
                  step="any"
                  value={editBaseValue}
                  onChange={(e) => setEditBaseValue(toFiniteNumberOr(e.target.value, 1000))}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    background: "var(--bg-input)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 6,
                    color: "var(--text-primary)",
                    fontSize: 14,
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label htmlFor="admin-edit-description" style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                指数の説明
              </label>
              <textarea
                id="admin-edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={2}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  background: "var(--bg-input)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 6,
                  color: "var(--text-primary)",
                  fontSize: 13,
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Constituents Table */}
            <div style={{ marginBottom: 16 }}>
              <div className="row space-between" style={{ marginBottom: 10 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>構成銘柄リスト</span>
                  <Tag variant="cyan" className="mono tiny">{editBasket.length} 銘柄</Tag>
                  <span className="muted tiny">合計ウェイト: {editBasket.reduce((a, b) => a + b.weight, 0).toFixed(1)}%</span>
                </div>
                <button
                  type="button"
                  onClick={handleEqualWeights}
                  className="btn btn-sm btn-outline"
                  style={{ fontSize: 11 }}
                >
                  均等配分 (Equalize)
                </button>
              </div>

              <div className="table-wrapper" style={{ maxHeight: 340, overflowY: "auto" }}>
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th style={{ width: "15%" }}>コード</th>
                      <th style={{ width: "35%" }}>銘柄名</th>
                      <th style={{ width: "20%" }}>テーマ</th>
                      <th style={{ width: "20%" }}>比率 (%)</th>
                      <th style={{ width: "10%", textAlign: "center" }}>削除</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editBasket.map((b) => (
                      <tr key={b.ticker}>
                        <td className="mono" style={{ color: "var(--neon-cyan)" }}>{b.ticker}</td>
                        <td>{b.name}</td>
                        <td className="muted">{b.theme}</td>
                        <td>
                          <input
                            type="number"
                            aria-label={`${b.name} (${b.ticker}) の比率 (%)`}
                            min="0.1"
                            max="100"
                            step="0.5"
                            value={b.weight}
                            onChange={(e) => handleEditWeightChange(b.ticker, e.target.value)}
                            style={{
                              width: 70,
                              padding: "4px 6px",
                              background: "var(--bg-input)",
                              border: "1px solid var(--border-subtle)",
                              borderRadius: 4,
                              color: "var(--text-primary)",
                              fontSize: 12,
                            }}
                          />
                        </td>
                         <td style={{ textAlign: "center" }}>
                          <button
                            type="button"
                            onClick={() => setEditBasket(editBasket.filter((item) => normalizeTicker(item.ticker) !== normalizeTicker(b.ticker)))}
                            aria-label={`${b.name} (${b.ticker}) を削除`}
                            style={{
                              background: "transparent",
                              border: "none",
                              color: "var(--neon-red)",
                              cursor: "pointer",
                              padding: 4,
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Quick Inline Add Stock */}
            <form
              onSubmit={handleAddStockToBasket}
              style={{
                padding: "12px 14px",
                background: "var(--surface-inset)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                marginBottom: 20,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--neon-cyan)" }}>
                + 銘柄を追加（制限なし）
              </div>
              <div className="admin-quick-add-stock-row">
                <input
                  type="text"
                  aria-label="銘柄コード"
                  placeholder="コード (例: 6758)"
                  className="admin-add-ticker-input"
                  value={addTicker}
                  onChange={(e) => setAddTicker(e.target.value.toUpperCase())}
                  style={{
                    padding: "6px 8px",
                    background: "var(--bg-input)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 4,
                    color: "var(--text-primary)",
                    fontSize: 12,
                  }}
                />
                <input
                  type="text"
                  aria-label="銘柄名"
                  placeholder="銘柄名 (例: ソニーグループ)"
                  className="admin-add-name-input"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  style={{
                    padding: "6px 8px",
                    background: "var(--bg-input)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 4,
                    color: "var(--text-primary)",
                    fontSize: 12,
                  }}
                />
                <input
                  type="text"
                  aria-label="テーマ"
                  placeholder="テーマ"
                  className="admin-add-theme-input"
                  value={addTheme}
                  onChange={(e) => setAddTheme(e.target.value)}
                  style={{
                    padding: "6px 8px",
                    background: "var(--bg-input)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 4,
                    color: "var(--text-primary)",
                    fontSize: 12,
                  }}
                />
                <input
                  type="number"
                  aria-label="比率"
                  placeholder="比率"
                  className="admin-add-weight-input"
                  value={addWeight}
                  onChange={(e) => setAddWeight(toFiniteNumberOr(e.target.value, 10))}
                  style={{
                    padding: "6px 8px",
                    background: "var(--bg-input)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 4,
                    color: "var(--text-primary)",
                    fontSize: 12,
                  }}
                />
                <button
                  type="submit"
                  className="btn btn-sm btn-default admin-add-submit-btn"
                  disabled={!addTicker.trim() || !addName.trim()}
                >
                  追加
                </button>
              </div>
            </form>

            {/* Action Bar */}
            <div className="row space-between flex-wrap admin-index-edit-actions" style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 16, gap: 12 }}>
              <div>
                {!SYSTEM_INDICES.has(selectedEditIndexId) && (
                  <button
                    type="button"
                    onClick={() => {
                      setIndexToDelete({
                        id: selectedEditIndexId,
                        name: editName || "選択中の指数",
                      });
                    }}
                    className="btn btn-sm btn-outline"
                    style={{ borderColor: "rgba(255,51,102,0.4)", color: "var(--neon-red)" }}
                  >
                    このカスタム指数を削除
                  </button>
                )}
              </div>

              <div className="row" style={{ gap: 10 }}>
                <button
                  type="button"
                  onClick={handleSaveIndexFullEdit}
                  disabled={savingIndex}
                  className="btn btn-default"
                  style={{ minWidth: 140, padding: "8px 18px" }}
                >
                  {savingIndex ? "保存中..." : "変更をD1に保存"}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* TAB: System Telemetry & Operations */}
      {activeTab === "system" && (
        <div
          id="admin-panel-system"
          role="tabpanel"
          aria-labelledby="admin-tab-system"
          tabIndex={0}
          className="admin-tabpanel"
        >
          <Card className="section">
            <div className="row space-between flex-wrap" style={{ gap: 12, marginBottom: 16 }}>
              <div className="row" style={{ gap: 8 }}>
                <Activity size={18} style={{ color: "var(--neon-cyan)" }} />
                <div>
                  <h2 style={{ fontSize: 16, margin: 0, fontWeight: 700 }}>
                    システム運用健全性 & テレメトリモニタリング
                  </h2>
                  <div className="muted tiny">
                    D1データベース接続、キャッシュ効率、登録指数構成、セキュリティ権限状態のリアルタイム診断
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => void fetchSystemStats()}
                disabled={loadingStats}
              >
                <RefreshCw size={12} className={loadingStats ? "spin" : ""} />
                <span>テレメトリ再取得</span>
              </button>
            </div>

            {statsError && (
              <div
                className="row"
                style={{
                  gap: 8,
                  padding: "10px 14px",
                  background: "rgba(255, 51, 102, 0.15)",
                  border: "1px solid var(--neon-red)",
                  borderRadius: 8,
                  color: "var(--neon-red)",
                  fontSize: 13,
                  marginBottom: 16,
                }}
              >
                <AlertCircle size={16} />
                <span>{statsError}</span>
              </div>
            )}

            {systemStats && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
                {/* DB Status */}
                <div className="card" style={{ padding: 16, background: "var(--bg-surface)" }}>
                  <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                    <Database size={15} style={{ color: "var(--neon-green)" }} />
                    <span className="tiny muted mono uppercase">データベース状態</span>
                  </div>
                  <div className="row" style={{ gap: 6, alignItems: "center" }}>
                    <CheckCircle2 size={16} style={{ color: "var(--neon-green)" }} />
                    <span className="bold" style={{ color: "var(--neon-green)", fontSize: "1.1rem" }}>
                      {systemStats.dbStatus}
                    </span>
                  </div>
                  <span className="tiny muted">Cloudflare D1 / Primary Replica</span>
                </div>

                {/* Index Telemetry */}
                <div className="card" style={{ padding: 16, background: "var(--bg-surface)" }}>
                  <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                    <Sliders size={15} style={{ color: "var(--neon-cyan)" }} />
                    <span className="tiny muted mono uppercase">インデックス運用規模</span>
                  </div>
                  <div className="bold mono" style={{ fontSize: "1.2rem", color: "var(--neon-cyan)" }}>
                    {systemStats.indicesCount} 指数
                  </div>
                  <span className="tiny muted">
                    総構成銘柄: {systemStats.totalConstituents} (平均{" "}
                    {typeof systemStats.avgConstituentsPerIndex === "number"
                      ? systemStats.avgConstituentsPerIndex
                      : systemStats.indicesCount > 0
                      ? Number((systemStats.totalConstituents / systemStats.indicesCount).toFixed(1))
                      : 0}{" "}
                    銘柄/指数)
                  </span>
                </div>

                {/* User & Auth Telemetry */}
                <div className="card" style={{ padding: 16, background: "var(--bg-surface)" }}>
                  <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                    <Users size={15} style={{ color: "var(--neon-amber)" }} />
                    <span className="tiny muted mono uppercase">発行ユーザー・権限</span>
                  </div>
                  <div className="bold mono" style={{ fontSize: "1.2rem", color: "var(--neon-amber)" }}>
                    {systemStats.userPasswordsCount} アカウント
                  </div>
                  <span className="tiny muted">
                    管理者: {systemStats.adminUsersCount}名 / 一般: {systemStats.activeUsersCount}名
                  </span>
                </div>

                {/* Cache Telemetry */}
                <div className="card" style={{ padding: 16, background: "var(--bg-surface)" }}>
                  <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                    <Server size={15} style={{ color: "#a855f7" }} />
                    <span className="tiny muted mono uppercase">市場データキャッシュ効率</span>
                  </div>
                  <div className="bold mono" style={{ fontSize: "1.2rem", color: "#a855f7" }}>
                    {systemStats.cacheStats.hitRatio}
                  </div>
                  <span className="tiny muted">
                    Hits: {systemStats.cacheStats.hits ?? 0} / Misses: {systemStats.cacheStats.misses ?? 0}
                  </span>
                </div>

                {/* System Environment */}
                <div className="card" style={{ padding: 16, background: "var(--bg-surface)", gridColumn: "1 / -1" }}>
                  <div className="row space-between flex-wrap" style={{ gap: 10 }}>
                    <div>
                      <span className="tiny muted mono">RUNNING VERSION:</span>{" "}
                      <span className="badge badge-accent mono tiny">{systemStats.version}</span>
                    </div>
                    <div>
                      <span className="tiny muted mono">SERVER UTC TIME:</span>{" "}
                      <span className="mono tiny muted">{systemStats.serverTime}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* TAB 4: Settings */}
      {activeTab === "settings" && (
        <div
          id="admin-panel-settings"
          role="tabpanel"
          aria-labelledby="admin-tab-settings"
          tabIndex={0}
          className="admin-tabpanel"
          style={{ maxWidth: 500 }}
        >
          <Card className="section">
            <div className="row" style={{ gap: 8, marginBottom: 14 }}>
              <Lock size={16} style={{ color: "var(--neon-cyan)" }} />
              <h2 style={{ fontSize: 16, margin: 0, fontWeight: 700 }}>管理者マスターパスワード変更</h2>
            </div>
            <p className="muted tiny" style={{ marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>
              管理コンソールへのアクセスに必要なマスターパスワードを更新します。8〜100文字で入力してください。
            </p>

            {session?.id !== "admin-master" ? (
              <div className="muted tiny" role="status">
                マスターパスワードを変更できるのはマスター管理者だけです。
              </div>
            ) : (
              <>
              {adminPwdMessage && (
              <div
                className="row"
                style={{
                  gap: 8,
                  padding: "8px 12px",
                  background: adminPwdMessage.type === "success" ? "rgba(0,255,157,0.15)" : "rgba(255,51,102,0.15)",
                  border: `1px solid ${adminPwdMessage.type === "success" ? "var(--neon-green)" : "var(--neon-red)"}`,
                  borderRadius: 6,
                  color: adminPwdMessage.type === "success" ? "var(--neon-green)" : "var(--neon-red)",
                  fontSize: 12,
                  marginBottom: 14,
                }}
              >
                {adminPwdMessage.type === "success" ? <Check size={14} /> : <AlertCircle size={14} />}
                <span>{adminPwdMessage.text}</span>
              </div>
            )}

            <form onSubmit={handleUpdateAdminPassword}>
              <div style={{ marginBottom: 14 }}>
                <label htmlFor="current-admin-password" style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                  現在の管理者パスワード (確認用)
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    id="current-admin-password"
                    type={showCurrentAdminPassword ? "text" : "password"}
                    value={currentAdminPassword}
                    onChange={(e) => setCurrentAdminPassword(e.target.value)}
                    autoComplete="current-password"
                    placeholder="現在のパスワード (任意入力)"
                    style={{
                      width: "100%",
                      padding: "8px 36px 8px 10px",
                      background: "var(--bg-input)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 6,
                      color: "var(--text-primary)",
                      fontSize: 13,
                      boxSizing: "border-box",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentAdminPassword(!showCurrentAdminPassword)}
                    aria-label={showCurrentAdminPassword ? "現在のパスワードを非表示" : "現在のパスワードを表示"}
                    style={{
                      position: "absolute",
                      right: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "transparent",
                      border: "none",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      padding: 2,
                      display: "flex",
                    }}
                  >
                    {showCurrentAdminPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label htmlFor="new-admin-password" style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                  新しい管理者パスワード
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    id="new-admin-password"
                    type={showNewAdminPassword ? "text" : "password"}
                    value={newAdminPassword}
                    onChange={(e) => setNewAdminPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder="新しいパスワード (8〜100文字)"
                    style={{
                      width: "100%",
                      padding: "8px 36px 8px 10px",
                      background: "var(--bg-input)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 6,
                      color: "var(--text-primary)",
                      fontSize: 13,
                      boxSizing: "border-box",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewAdminPassword(!showNewAdminPassword)}
                    aria-label={showNewAdminPassword ? "新しいパスワードを非表示" : "新しいパスワードを表示"}
                    style={{
                      position: "absolute",
                      right: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "transparent",
                      border: "none",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      padding: 2,
                      display: "flex",
                    }}
                  >
                    {showNewAdminPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <PasswordStrengthBar password={newAdminPassword} />
              </div>

              <div style={{ marginBottom: 18 }}>
                <label htmlFor="confirm-admin-password" style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                  新しい管理者パスワード（確認）
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    id="confirm-admin-password"
                    type={showConfirmAdminPassword ? "text" : "password"}
                    value={confirmAdminPassword}
                    onChange={(e) => setConfirmAdminPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder="もう一度入力してください"
                    style={{
                      width: "100%",
                      padding: "8px 36px 8px 10px",
                      background: "var(--bg-input)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 6,
                      color: "var(--text-primary)",
                      fontSize: 13,
                      boxSizing: "border-box",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmAdminPassword(!showConfirmAdminPassword)}
                    aria-label={showConfirmAdminPassword ? "確認用パスワードを非表示" : "確認用パスワードを表示"}
                    style={{
                      position: "absolute",
                      right: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "transparent",
                      border: "none",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      padding: 2,
                      display: "flex",
                    }}
                  >
                    {showConfirmAdminPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {confirmAdminPassword.length > 0 && newAdminPassword.trim() !== confirmAdminPassword.trim() && (
                  <div style={{ fontSize: 11, color: "var(--neon-red)", marginTop: 4 }}>
                    ⚠️ パスワード（確認）が一致していません
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={updatingAdminPwd}
                className="btn btn-default"
                style={{ width: "100%" }}
              >
                {updatingAdminPwd ? "更新中..." : "管理者パスワードを更新"}
              </button>
            </form>
              </>
            )}
          </Card>

          <Card className="section" style={{ marginTop: 20 }}>
            <div className="row" style={{ gap: 8, marginBottom: 14 }}>
              <KeyRound size={16} style={{ color: "var(--neon-cyan)" }} />
              <h2 style={{ fontSize: 16, margin: 0, fontWeight: 700 }}>秘密の暗号（Admin Secret Code）変更</h2>
            </div>
            <p className="muted tiny" style={{ marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>
              管理者ログイン時に必須となる「秘密の暗号」を更新します。6〜100文字で設定してください。平文は保存されず暗号化ハッシュとして安全に記録されます。
            </p>

            {session?.id !== "admin-master" ? (
              <div className="muted tiny" role="status">
                秘密の暗号を変更できるのはマスター管理者だけです。
              </div>
            ) : (
              <>
                {secretCodeError && (
                  <div
                    className="row"
                    style={{
                      gap: 8,
                      padding: "8px 12px",
                      background: "rgba(255,51,102,0.15)",
                      border: "1px solid var(--neon-red)",
                      borderRadius: 6,
                      color: "var(--neon-red)",
                      fontSize: 12,
                      marginBottom: 14,
                    }}
                  >
                    <AlertCircle size={14} />
                    <span>{secretCodeError}</span>
                  </div>
                )}

                {secretCodeSuccess && (
                  <div
                    className="row"
                    style={{
                      gap: 8,
                      padding: "8px 12px",
                      background: "rgba(0,255,157,0.15)",
                      border: "1px solid var(--neon-green)",
                      borderRadius: 6,
                      color: "var(--neon-green)",
                      fontSize: 12,
                      marginBottom: 14,
                    }}
                  >
                    <Check size={14} />
                    <span>{secretCodeSuccess}</span>
                  </div>
                )}

                <form onSubmit={handleChangeSecretCode}>
                  <div style={{ marginBottom: 14 }}>
                    <label htmlFor="current-secret-code" style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                      現在の秘密の暗号 (確認用)
                    </label>
                    <div style={{ position: "relative" }}>
                      <input
                        id="current-secret-code"
                        type="text"
                        inputMode="text"
                        lang="ja"
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck="false"
                        value={currentSecretCodeInput}
                        onChange={(e) => setCurrentSecretCodeInput(e.target.value)}
                        placeholder="現在の秘密の暗号 (ひらがな・カタカナ可)"
                        style={{
                          width: "100%",
                          padding: "8px 36px 8px 10px",
                          background: "var(--bg-input)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: 6,
                          color: "var(--text-primary)",
                          fontSize: 13,
                          boxSizing: "border-box",
                          WebkitTextSecurity: showCurrentSecretCode ? "none" : "disc",
                        } as React.CSSProperties}
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentSecretCode(!showCurrentSecretCode)}
                        aria-label={showCurrentSecretCode ? "秘密の暗号を非表示" : "秘密の暗号を表示"}
                        style={{
                          position: "absolute",
                          right: 8,
                          top: "50%",
                          transform: "translateY(-50%)",
                          background: "transparent",
                          border: "none",
                          color: "var(--text-muted)",
                          cursor: "pointer",
                          padding: 2,
                          display: "flex",
                        }}
                      >
                        {showCurrentSecretCode ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <label htmlFor="new-secret-code" style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                      新しい秘密の暗号 (6〜100文字・ひらがな/カタカナ可)
                    </label>
                    <div style={{ position: "relative" }}>
                      <input
                        id="new-secret-code"
                        type="text"
                        inputMode="text"
                        lang="ja"
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck="false"
                        value={newSecretCodeInput}
                        onChange={(e) => setNewSecretCodeInput(e.target.value)}
                        placeholder="新しい秘密の暗号 (ひらがな・カタカナ・英数字・記号)"
                        style={{
                          width: "100%",
                          padding: "8px 36px 8px 10px",
                          background: "var(--bg-input)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: 6,
                          color: "var(--text-primary)",
                          fontSize: 13,
                          boxSizing: "border-box",
                          WebkitTextSecurity: showNewSecretCode ? "none" : "disc",
                        } as React.CSSProperties}
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewSecretCode(!showNewSecretCode)}
                        aria-label={showNewSecretCode ? "新しい秘密の暗号を非表示" : "新しい秘密の暗号を表示"}
                        style={{
                          position: "absolute",
                          right: 8,
                          top: "50%",
                          transform: "translateY(-50%)",
                          background: "transparent",
                          border: "none",
                          color: "var(--text-muted)",
                          cursor: "pointer",
                          padding: 2,
                          display: "flex",
                        }}
                      >
                        {showNewSecretCode ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    {newSecretCodeInput.length > 0 && newSecretCodeInput.trim().length < 6 && (
                      <div style={{ fontSize: 11, color: "var(--neon-red)", marginTop: 4 }}>
                        ⚠️ 6文字以上入力してください（現在: {newSecretCodeInput.trim().length}文字）
                      </div>
                    )}
                  </div>

                  <div style={{ marginBottom: 18 }}>
                    <label htmlFor="confirm-secret-code" style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                      新しい秘密の暗号（確認）
                    </label>
                    <div style={{ position: "relative" }}>
                      <input
                        id="confirm-secret-code"
                        type="text"
                        inputMode="text"
                        lang="ja"
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck="false"
                        value={confirmSecretCodeInput}
                        onChange={(e) => setConfirmSecretCodeInput(e.target.value)}
                        placeholder="もう一度入力してください"
                        style={{
                          width: "100%",
                          padding: "8px 36px 8px 10px",
                          background: "var(--bg-input)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: 6,
                          color: "var(--text-primary)",
                          fontSize: 13,
                          boxSizing: "border-box",
                          WebkitTextSecurity: showConfirmSecretCode ? "none" : "disc",
                        } as React.CSSProperties}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmSecretCode(!showConfirmSecretCode)}
                        aria-label={showConfirmSecretCode ? "確認用暗号を非表示" : "確認用暗号を表示"}
                        style={{
                          position: "absolute",
                          right: 8,
                          top: "50%",
                          transform: "translateY(-50%)",
                          background: "transparent",
                          border: "none",
                          color: "var(--text-muted)",
                          cursor: "pointer",
                          padding: 2,
                          display: "flex",
                        }}
                      >
                        {showConfirmSecretCode ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    {confirmSecretCodeInput.length > 0 && newSecretCodeInput.trim() !== confirmSecretCodeInput.trim() && (
                      <div style={{ fontSize: 11, color: "var(--neon-red)", marginTop: 4 }}>
                        ⚠️ 新しい秘密の暗号と一致していません
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={updatingSecretCode}
                    className="btn btn-default"
                    style={{ width: "100%" }}
                  >
                    {updatingSecretCode ? "更新中..." : "秘密の暗号を更新"}
                  </button>
                </form>
              </>
            )}
          </Card>
        </div>
      )}

      {/* Edit Password Modal */}
      <EditPasswordModal
        isOpen={editingPasswordItem !== null}
        onClose={() => setEditingPasswordItem(null)}
        item={editingPasswordItem}
        onSuccess={fetchPasswords}
        getHeaders={getHeaders}
      />

      {/* Delete Password Confirm Modal */}
      <ConfirmModal
        isOpen={Boolean(passwordToDelete)}
        onClose={() => {
          if (!deletingPassword) setPasswordToDelete(null);
        }}
        onConfirm={confirmDeletePassword}
        title="パスワード削除の確認"
        description={passwordToDelete ? `パスワード「${passwordToDelete.name}」を削除しますか？\nこのパスワードを使用しているユーザーは編集できなくなります。` : ""}
        confirmText="削除する"
        variant="danger"
        loading={deletingPassword}
      />

      {/* Delete Index Confirm Modal */}
      <ConfirmModal
        isOpen={Boolean(indexToDelete)}
        onClose={() => {
          if (!deletingIndex) setIndexToDelete(null);
        }}
        onConfirm={confirmDeleteIndex}
        title="カスタム指数削除の確認"
        description={indexToDelete ? `指数「${indexToDelete.name}」を完全に削除しますか？\nこの操作は元に戻せません。` : ""}
        confirmText="完全に削除"
        variant="danger"
        loading={deletingIndex}
      />

      {/* Create New Index Modal for Admins */}
      <ModalBase
        isOpen={isCreateIndexModalOpen}
        onClose={() => {
          if (!creatingIndex) setIsCreateIndexModalOpen(false);
        }}
        ariaLabel="新規カスタム指数の作成"
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Plus size={18} style={{ color: "var(--neon-cyan)" }} />
            <span>新規カスタム指数の作成</span>
          </div>
        }
        maxWidth={480}
      >
        <form onSubmit={handleCreateNewIndexSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label htmlFor="create-index-name" style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
              指数名 <span style={{ color: "var(--neon-red)" }}>*</span>
            </label>
            <input
              id="create-index-name"
              type="text"
              value={newIndexName}
              onChange={(e) => setNewIndexName(e.target.value)}
              placeholder="例: 次世代モビリティ & AI指数"
              maxLength={100}
              required
              autoFocus
              style={{
                width: "100%",
                padding: "8px 10px",
                background: "var(--bg-input)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 6,
                color: "var(--text-primary)",
                fontSize: 13,
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label htmlFor="create-index-desc" style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
              指数の概要・説明
            </label>
            <textarea
              id="create-index-desc"
              value={newIndexDesc}
              onChange={(e) => setNewIndexDesc(e.target.value)}
              placeholder="例: 国内主要モビリティおよびテックリーダー企業で構成されるカスタムテーマ指数"
              maxLength={500}
              rows={3}
              style={{
                width: "100%",
                padding: "8px 10px",
                background: "var(--bg-input)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 6,
                color: "var(--text-primary)",
                fontSize: 13,
                boxSizing: "border-box",
                resize: "vertical",
              }}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label htmlFor="create-index-base-val" style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
              基準値 (Base Value)
            </label>
            <input
              id="create-index-base-val"
              type="number"
              value={newIndexBaseValue}
              onChange={(e) => setNewIndexBaseValue(Number(e.target.value) || 1000)}
              min={1}
              max={1000000}
              style={{
                width: "100%",
                padding: "8px 10px",
                background: "var(--bg-input)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 6,
                color: "var(--text-primary)",
                fontSize: 13,
                boxSizing: "border-box",
              }}
            />
            <span className="tiny muted" style={{ display: "block", marginTop: 4 }}>
              ※ 初期の基準値（標準: 1,000）
            </span>
          </div>

          <div
            style={{
              padding: "10px 12px",
              background: "var(--surface-control)",
              borderRadius: 6,
              marginBottom: 16,
              fontSize: "0.8rem",
            }}
          >
            <span className="mono bold block" style={{ color: "var(--neon-cyan)", marginBottom: 4 }}>
              初期組み入れプリセット (3銘柄):
            </span>
            <div className="tiny muted">
              7203 トヨタ (33.3%) / 6758 ソニーG (33.3%) / 8035 東エレク (33.4%)
            </div>
            <span className="tiny muted" style={{ display: "block", marginTop: 4 }}>
              ※ 作成後に「全指数 & 銘柄フル編集」タブから任意の銘柄・比率に自由に変更できます。
            </span>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setIsCreateIndexModalOpen(false)}
              disabled={creatingIndex}
            >
              キャンセル
            </button>
            <button
              type="submit"
              className="btn btn-sm btn-default"
              disabled={creatingIndex || !newIndexName.trim()}
            >
              {creatingIndex ? "作成中..." : "指数を作成"}
            </button>
          </div>
        </form>
      </ModalBase>
    </div>
  );
}
