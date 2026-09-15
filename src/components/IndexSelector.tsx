import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, Tag, Badge, SearchInput } from "./ui";
import { ChevronDown, Layers, CheckCircle2, Plus, Trash2, UserCheck } from "lucide-react";
import { SYSTEM_INDEX_IDS, type CustomIndex } from "../data/indices";
import { normalizeWeights } from "../lib/indexEngine";
import { isIndexOwner } from "../lib/ownership";
import { ConfirmModal } from "./ConfirmModal";
import { useToast } from "./Toast";

interface IndexSelectorProps {
  indices: CustomIndex[];
  selectedIndex: CustomIndex | null;
  onSelect: (index: CustomIndex) => void;
  onCreateIndex?: () => void;
  onDeleteIndex?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  isOwner?: (id: string) => boolean;
}

export function IndexSelector({
  indices,
  selectedIndex,
  onSelect,
  onCreateIndex,
  onDeleteIndex,
  isOwner,
}: IndexSelectorProps) {
  const { success, error: toastError } = useToast();
  const [search, setSearch] = useState("");
  const [isExpanded, setIsExpanded] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<CustomIndex | null>(null);
  const [deletingIndex, setDeletingIndex] = useState(false);

  const filteredIndices = useMemo(() => {
    if (!search.trim()) return indices;
    const q = search.trim().toLowerCase();
    return indices.filter(
      (idx) =>
        idx.name.toLowerCase().includes(q) ||
        idx.description.toLowerCase().includes(q) ||
        idx.basket.some((b) => b.name.toLowerCase().includes(q) || b.ticker.toLowerCase().includes(q)),
    );
  }, [indices, search]);

  // Normalize weights for display so bars always sum to 100%
  const top3Normalized = useMemo(() => {
    if (!selectedIndex) return [];
    const normalized = normalizeWeights(selectedIndex.basket);
    return [...normalized]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3);
  }, [selectedIndex]);

  return (
    <Card className="section index-selector-card" style={{ height: "fit-content" }}>
      <div className={`index-selector-header ${isExpanded ? "is-expanded" : ""}`}>
        <button
          type="button"
          className="index-selector-toggle"
          onClick={() => setIsExpanded((expanded) => !expanded)}
          aria-expanded={isExpanded}
          aria-controls="index-selector-content"
          title={isExpanded ? "指数セレクターを閉じる" : "指数セレクターを開く"}
        >
          <span className="index-selector-toggle-title">
            <Layers size={16} style={{ color: "var(--accent-color)" }} />
            <span>指数セレクター</span>
          </span>
          <span className="index-selector-toggle-meta">
            <Badge variant="cyan">{indices.length} 指数</Badge>
            <ChevronDown
              size={17}
              className="index-selector-chevron"
              aria-hidden="true"
            />
          </span>
        </button>
      </div>

      {!isExpanded && (
        <div className="index-selector-collapsed-summary" aria-live="polite">
          <span className="mono tiny uppercase muted">選択中</span>
          <strong>{selectedIndex?.name || "指数を選択してください"}</strong>
          {selectedIndex && (
            <span className="mono tiny muted">{selectedIndex.basket.length} 銘柄</span>
          )}
        </div>
      )}

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            id="index-selector-content"
            key="index-selector-content"
            className="index-selector-content"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22 }}
            style={{ overflow: "hidden" }}
          >
            {onCreateIndex && (
              <button
                type="button"
                onClick={onCreateIndex}
                className="btn btn-default"
                style={{ width: "100%", marginTop: 2, marginBottom: 12, padding: "8px 12px", position: "relative", zIndex: 1 }}
              >
                <Plus size={14} /> 独自指数を新規作成
              </button>
            )}

            <div style={{ marginBottom: 12 }}>
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="指数・銘柄検索..."
              />
            </div>

            <div className="index-list" aria-label="指数一覧">
        {filteredIndices.map((idx) => {
          const isSelected = selectedIndex?.id === idx.id;
          const isSystem = SYSTEM_INDEX_IDS.has(idx.id);
          const checkOwner = isOwner || isIndexOwner;
          const isMyIndex = !isSystem && checkOwner(idx.id);

          return (
            <motion.article
              key={idx.id}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              className={`index-item ${isSelected ? "active" : ""}`}
              onClick={() => onSelect(idx)}
            >
              <div className="row space-between index-item-header" style={{ marginBottom: 4 }}>
                <button
                  type="button"
                  className="index-select-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(idx);
                  }}
                  aria-pressed={isSelected}
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    margin: 0,
                    cursor: "pointer",
                    textAlign: "left",
                    color: "inherit",
                    font: "inherit",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 6,
                    flex: 1,
                  }}
                >
                  <span className="index-item-name" style={{ fontWeight: 700, fontSize: 14, color: isSelected ? "var(--accent-text)" : "var(--text-heading)" }}>
                    {idx.name}
                  </span>
                  {isMyIndex && (
                    <span
                      className="tag index-item-owner"
                      style={{
                        fontSize: 9,
                        padding: "1px 6px",
                        background: "var(--accent-subtle)",
                        color: "var(--accent-text)",
                        border: "1px solid var(--accent-border)",
                        borderRadius: 4,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                      }}
                      title="あなたが作成した独自指数です"
                    >
                      <UserCheck size={10} /> My 指数
                    </span>
                  )}
                </button>
                <div className="row index-item-actions" style={{ gap: 6 }}>
                  {isMyIndex && onDeleteIndex && (
                    <button
                      type="button"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        setDeleteTarget(idx);
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--neon-red)",
                        cursor: "pointer",
                        padding: 2,
                        opacity: 0.7,
                      }}
                      title="指数を削除 (作成者のみ)"
                      aria-label={`指数「${idx.name}」を削除`}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                  {isSelected ? (
                    <CheckCircle2 size={16} style={{ color: "var(--accent-color)", flexShrink: 0 }} />
                  ) : null}
                </div>
              </div>

              <div className="muted tiny" style={{ lineHeight: 1.4, marginBottom: 8, fontSize: 11, wordBreak: "break-word", overflowWrap: "anywhere" }}>
                {idx.description}
              </div>

              <div className="column" style={{ gap: 6, marginTop: 4 }}>
                <div className="row space-between flex-wrap index-item-meta" style={{ gap: 6, alignItems: "flex-start" }}>
                  <div className="row index-item-basket-tags" style={{ gap: 4 }}>
                    <Tag variant="cyan" style={{ fontSize: 10, padding: "1px 6px" }}>
                      {idx.basket.length} 銘柄
                    </Tag>
                    <Tag variant="muted" style={{ fontSize: 10, padding: "1px 6px" }}>
                      BASE {idx.baseValue}
                    </Tag>
                  </div>

                  <div className="row index-item-stock-tags" style={{ gap: 3 }}>
                    {idx.basket.slice(0, 2).map((b) => (
                      <span
                        key={b.ticker}
                        className="tag tag-muted index-item-stock-tag"
                        style={{
                          fontSize: 9,
                          padding: "1px 4px",
                        }}
                        title={b.name}
                      >
                        {b.name}
                      </span>
                    ))}
                    {idx.basket.length > 2 && (
                      <span className="tag tag-muted" style={{ fontSize: 9, padding: "1px 4px" }}>
                        +{idx.basket.length - 2}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </motion.article>
          );
        })}

              {filteredIndices.length === 0 && (
                <div style={{ textAlign: "center", padding: "24px 0" }} className="muted tiny mono">
                  一致する指数がありません
                </div>
              )}
            </div>

            <AnimatePresence mode="wait">
              {selectedIndex && (
                <motion.div
                  key={selectedIndex.id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3 }}
                  style={{ overflow: "hidden" }}
                >
                  <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border-subtle)" }}>
              <div className="row space-between" style={{ marginBottom: 10 }}>
                <div className="muted tiny uppercase mono">
                  主要ウェイト TOP 3
                </div>
                <div className="muted tiny mono">
                  シェア計 {top3Normalized.reduce((acc, c) => acc + c.weight, 0).toFixed(1)}%
                </div>
              </div>

              <div className="grid" style={{ gap: 6 }}>
                {top3Normalized.map((item) => (
                  <div
                    key={item.ticker}
                    style={{
                      padding: "8px 12px",
                      background: "var(--surface-inset)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 6,
                    }}
                  >
                    <div className="row space-between">
                      <div className="row" style={{ gap: 8 }}>
                        <span className="mono" style={{ color: "var(--accent-text)", fontWeight: 600, fontSize: 12 }}>
                          {item.ticker}
                        </span>
                        <span style={{ fontSize: 12 }}>{item.name}</span>
                      </div>
                      <div className="mono tiny" style={{ fontWeight: 600 }}>
                        {item.weight.toFixed(1)}%
                      </div>
                    </div>
                    <div className="weight-progress-bg" style={{ marginTop: 6 }}>
                      <motion.div
                        className="weight-progress-bar"
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(item.weight, 100)}%` }}
                        transition={{ duration: 0.6 }}
                      />
                    </div>
                  </div>
                ))}
              </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="指数の削除"
        description={`独自指数「${deleteTarget?.name}」を削除しますか？\n（この操作は取り消せません。作成者のみ削除可能です）`}
        confirmText="削除する"
        cancelText="キャンセル"
        variant="danger"
        loading={deletingIndex}
        onConfirm={async () => {
          if (!deleteTarget || !onDeleteIndex) return;

          setDeletingIndex(true);
          try {
            const result = await onDeleteIndex(deleteTarget.id);
            if (!result.ok) {
              toastError(result.error || "指数の削除に失敗しました");
              return;
            }
            const name = deleteTarget.name;
            setDeleteTarget(null);
            success(`指数「${name}」を削除しました`);
          } catch (err) {
            toastError(err instanceof Error ? err.message : "指数の削除に失敗しました");
          } finally {
            setDeletingIndex(false);
          }
        }}
      />
    </Card>
  );
}
