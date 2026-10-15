/**
 * Reports the outcome of an "add this stock to my index" mutation as a toast.
 *
 * The mutation runs asynchronously and can fail (rate limit, per-user stock
 * quota, D1 outage, server error). Callers must therefore wait for the Worker
 * response: announcing success unconditionally tells the user a constituent
 * was stored when the index was left unchanged, and the mistake is only
 * discovered at the next reload.
 *
 * A rejected promise is treated the same way as an explicit failure so a
 * transport-level error can never surface as a success message.
 */

export interface AddStockResult {
  ok: boolean;
  error?: string;
}

export interface FeedbackToasts {
  success: (message: string) => void;
  error: (message: string) => void;
}

export function reportAddStockResult(
  pending: PromiseLike<AddStockResult>,
  name: string,
  toasts: FeedbackToasts,
): void {
  void Promise.resolve(pending)
    .then((result) => {
      if (result && result.ok) {
        toasts.success(`「${name}」を指数に追加しました`);
      } else {
        toasts.error(result?.error || `「${name}」の指数への追加に失敗しました`);
      }
    })
    .catch(() => {
      toasts.error(`「${name}」の指数への追加に失敗しました`);
    });
}
