// Retry once after a deployment-skew or temporary static-asset failure. This
// stays outside index.html so the production Content Security Policy can keep
// script-src limited to same-origin external scripts.
(() => {
  window.addEventListener(
    "error",
    (event) => {
      const target = event.target || event.srcElement;
      const isScriptOrLink = target instanceof HTMLElement &&
        (target.tagName === "SCRIPT" || target.tagName === "LINK");
      if (!isScriptOrLink) return;

      const retryKey = `asset_reload_retry_${window.location.pathname}`;
      // sessionStorage may be unavailable (blocked storage); a throw here
      // would break the recovery path from inside the capture-phase listener.
      let alreadyRetried = true;
      try {
        alreadyRetried = Boolean(sessionStorage.getItem(retryKey));
        if (!alreadyRetried) sessionStorage.setItem(retryKey, "true");
      } catch {
        alreadyRetried = false;
      }
      if (!alreadyRetried) {
        window.setTimeout(() => window.location.reload(), 1000);
        return;
      }

      const root = document.getElementById("root");
      if (!root || root.hasChildNodes()) return;

      const shell = document.createElement("div");
      shell.style.cssText = "min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;color:#f8fafc;font-family:sans-serif;padding:20px;text-align:center;";
      const panel = document.createElement("div");
      panel.style.cssText = "background:#1e293b;border:1px solid #334155;border-radius:12px;padding:32px;max-width:480px;box-shadow:0 10px 25px rgba(0,0,0,0.5);";

      const icon = document.createElement("div");
      icon.textContent = "⚠️";
      icon.style.cssText = "font-size:40px;margin-bottom:16px;";
      const heading = document.createElement("h2");
      heading.textContent = "リソースの読み込みに失敗しました";
      heading.style.cssText = "margin:0 0 12px;font-size:20px;font-weight:700;color:#38bdf8;";
      const message = document.createElement("p");
      message.textContent = "Cloudflareエッジまたはネットワークの一時的なエラーにより、最新のアプリケーションスクリプトが取得できませんでした。";
      message.style.cssText = "margin:0 0 20px;font-size:14px;color:#94a3b8;line-height:1.6;";
      const retryButton = document.createElement("button");
      retryButton.type = "button";
      retryButton.textContent = "再読み込み";
      retryButton.style.cssText = "background:#0284c7;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px;";
      retryButton.addEventListener("click", () => {
        try {
          sessionStorage.removeItem(retryKey);
        } catch {
          // ignore storage-denied contexts
        }
        window.location.reload();
      });

      panel.append(icon, heading, message, retryButton);
      shell.append(panel);
      root.replaceChildren(shell);
    },
    true,
  );
})();
