import { describe, expect, it } from "vitest";
import {
  ACCOUNT_NOT_FOUND_MESSAGE,
  ADMIN_REQUIRED_MESSAGE,
  ADMIN_SESSION_INVALID_MESSAGE,
  BASKET_MIN_ITEMS_MESSAGE,
  BASKET_TOTAL_WEIGHT_MESSAGE,
  CANNOT_DELETE_SYSTEM_INDEX_MESSAGE,
  CREATOR_STOCK_LIMIT_UNKNOWN_MESSAGE,
  ENDPOINT_NOT_FOUND_MESSAGE,
  INCORRECT_PASSWORD_MESSAGE,
  INDEX_ID_FORMAT_MESSAGE,
  INDEX_ID_REQUIRED_MESSAGE,
  INDEX_ID_TICKER_REQUIRED_MESSAGE,
  INDEX_NOT_FOUND_MESSAGE,
  INDEX_UPDATE_TOKEN_MISMATCH_MESSAGE,
  INDEX_UPDATE_TOKEN_REQUIRED_MESSAGE,
  INTERNAL_SERVER_ERROR_MESSAGE,
  INVALID_BASE_VALUE_MESSAGE,
  INVALID_DESCRIPTION_MESSAGE,
  INVALID_INDEX_ID_MESSAGE,
  INVALID_INDEX_NAME_MESSAGE,
  INVALID_JSON_BODY_MESSAGE,
  INVALID_JSON_OBJECT_MESSAGE,
  INVALID_PASSWORD_ID_MESSAGE,
  INVALID_PASSWORD_LENGTH_MESSAGE,
  INVALID_SORT_ORDER_MESSAGE,
  INVALID_SYMBOL_MESSAGE,
  INVALID_TICKER_FORMAT_MESSAGE,
  INVALID_TICKER_VALUE_MESSAGE,
  INVALID_USER_LABEL_MESSAGE,
  MAX_INDICES_RANGE_MESSAGE,
  MAX_STOCKS_RANGE_MESSAGE,
  METHOD_NOT_ALLOWED_GET_MESSAGE,
  METHOD_NOT_ALLOWED_POST_MESSAGE,
  METHOD_NOT_ALLOWED_PUT_MESSAGE,
  METHOD_NOT_ALLOWED_INDICES_MESSAGE,
  METHOD_NOT_ALLOWED_INDICES_STOCK_MESSAGE,
  METHOD_NOT_ALLOWED_PASSWORDS_MESSAGE,
  METHOD_NOT_ALLOWED_SECRET_CODE_MESSAGE,
  MISSING_PASSWORD_ID_MESSAGE,
  PROTECTED_INDEX_UPDATE_MESSAGE,
  REQUEST_BODY_TOO_LARGE_MESSAGE,
  STATIC_ASSET_HANDLER_UNAVAILABLE_MESSAGE,
  STATIC_ASSET_LOAD_FAILED_MESSAGE,
  TICKERS_ARRAY_EMPTY_MESSAGE,
  TICKERS_ARRAY_REQUIRED_MESSAGE,
  TICKER_REQUIRED_MESSAGE,
  UNSUPPORTED_SYMBOL_MESSAGE,
  INDEX_LIMIT_MIGRATION_MESSAGE,
  adminLoginLockoutMessage,
  basketMaxItemsMessage,
  invalidOwnerTokenMessage,
  ownerTokenLengthMessage,
  yahooNoDataMessage,
} from "../../worker/internal-impl";

/**
 * FINISH follow-up to U-8 M-7: the user-facing error wording lives exactly
 * once, in the `worker/internal-impl.ts` message catalog.
 *
 * Behavioral tests (`workerHttpContract`, `workerApi`, …) assert the same
 * strings on the wire; this suite locks the catalog values themselves, so a
 * wording change is a single deliberate edit here and in the catalog — never
 * a silent drift between call sites.
 */
describe("worker error message catalog (U-8 M-7 follow-up)", () => {
  it("keeps every protocol and validation message word-for-word", () => {
    expect(INTERNAL_SERVER_ERROR_MESSAGE).toBe(
      "サーバーでエラーが発生しました。しばらくしてから再試行してください。",
    );
    expect(REQUEST_BODY_TOO_LARGE_MESSAGE).toBe(
      "リクエストが大きすぎます。銘柄数や説明文を減らして再試行してください。",
    );
    expect(INVALID_JSON_BODY_MESSAGE).toBe("リクエストの形式が正しくありません。");
    expect(INVALID_JSON_OBJECT_MESSAGE).toBe("リクエストはオブジェクト形式で送信してください。");
    expect(METHOD_NOT_ALLOWED_GET_MESSAGE).toBe(
      "このエンドポイントではGETメソッドのみ利用できます。",
    );
    expect(METHOD_NOT_ALLOWED_POST_MESSAGE).toBe(
      "このエンドポイントではPOSTメソッドのみ利用できます。",
    );
    expect(METHOD_NOT_ALLOWED_PUT_MESSAGE).toBe(
      "このエンドポイントではPUTメソッドのみ利用できます。",
    );
    expect(METHOD_NOT_ALLOWED_INDICES_MESSAGE).toBe(
      "このエンドポイントではGET, POST, DELETEメソッドのみ利用できます。",
    );
    expect(METHOD_NOT_ALLOWED_INDICES_STOCK_MESSAGE).toBe(
      "このエンドポイントではPOST, DELETEメソッドのみ利用できます。",
    );
    expect(METHOD_NOT_ALLOWED_PASSWORDS_MESSAGE).toBe(
      "このエンドポイントではGET, POST, PUT, DELETEメソッドのみ利用できます。",
    );
    expect(METHOD_NOT_ALLOWED_SECRET_CODE_MESSAGE).toBe(
      "このエンドポイントではPUT, POSTメソッドのみ利用できます。",
    );
    expect(INDEX_NOT_FOUND_MESSAGE).toBe("指数が見つかりません。");
    expect(ENDPOINT_NOT_FOUND_MESSAGE).toBe("エンドポイントが見つかりません。");
    expect(STATIC_ASSET_HANDLER_UNAVAILABLE_MESSAGE).toBe(
      "静的アセットのハンドラが利用できません。",
    );
    expect(STATIC_ASSET_LOAD_FAILED_MESSAGE).toBe("静的アセットの読み込みに失敗しました。");
    expect(INVALID_INDEX_ID_MESSAGE).toBe("指数IDの形式が正しくありません。");
    expect(INDEX_ID_REQUIRED_MESSAGE).toBe("指数IDを指定してください。");
    expect(INDEX_ID_FORMAT_MESSAGE).toBe(
      "指数IDを指定してください（1〜100文字の英数字・ドット・ハイフン・アンダースコア）。",
    );
    expect(INDEX_ID_TICKER_REQUIRED_MESSAGE).toBe("指数IDとティッカーを指定してください。");
    expect(TICKER_REQUIRED_MESSAGE).toBe("ティッカーを指定してください。");
    expect(INVALID_TICKER_VALUE_MESSAGE).toBe("ティッカーの値が正しくありません。");
    expect(INVALID_TICKER_FORMAT_MESSAGE).toBe("ティッカーの形式が正しくありません。");
    expect(INVALID_SYMBOL_MESSAGE).toBe("シンボルの指定が正しくありません。");
    expect(UNSUPPORTED_SYMBOL_MESSAGE).toBe("対応していないシンボルです。");
    expect(INVALID_INDEX_NAME_MESSAGE).toBe("名前は1〜100文字で入力してください。");
    expect(INVALID_DESCRIPTION_MESSAGE).toBe("説明文は500文字以内で入力してください。");
    expect(INVALID_BASE_VALUE_MESSAGE).toBe("基準値は0より大きく1000000以下で入力してください。");
    expect(BASKET_MIN_ITEMS_MESSAGE).toBe("銘柄を1件以上指定してください。");
    expect(BASKET_TOTAL_WEIGHT_MESSAGE).toBe("合計ウェイトは0より大きく10000以下にしてください。");
    expect(TICKERS_ARRAY_REQUIRED_MESSAGE).toBe("ティッカーの配列を指定してください。");
    expect(TICKERS_ARRAY_EMPTY_MESSAGE).toBe("ティッカーを1件以上指定してください。");
    expect(INVALID_SORT_ORDER_MESSAGE).toBe("表示順は0〜9999の数値で指定してください。");
    expect(INVALID_PASSWORD_ID_MESSAGE).toBe("パスワードIDの形式が正しくありません。");
    expect(MISSING_PASSWORD_ID_MESSAGE).toBe("パスワードIDを指定してください。");
    expect(CANNOT_DELETE_SYSTEM_INDEX_MESSAGE).toBe("組み込みの指数は削除できません。");
  });

  it("keeps the pre-existing admin/quota messages word-for-word", () => {
    expect(CREATOR_STOCK_LIMIT_UNKNOWN_MESSAGE).toBe(
      "作成者の銘柄数上限を確認できないため、後で再試行してください",
    );
    expect(ADMIN_SESSION_INVALID_MESSAGE).toBe("管理者セッションが無効または期限切れです");
    expect(ADMIN_REQUIRED_MESSAGE).toBe("管理者権限が必要です");
    expect(MAX_STOCKS_RANGE_MESSAGE).toBe("銘柄数上限は1〜500の数値を指定してください");
    expect(INDEX_LIMIT_MIGRATION_MESSAGE).toBe(
      "指数上限を保存するにはデータベースのマイグレーションが必要です",
    );
    expect(MAX_INDICES_RANGE_MESSAGE).toBe("指数上限は1〜100の数値を指定してください");
    expect(ACCOUNT_NOT_FOUND_MESSAGE).toBe("指定されたIDのアカウントが見つかりません");
    expect(INVALID_USER_LABEL_MESSAGE).toBe("ユーザー名/ラベルは1〜100文字で入力してください");
    expect(INVALID_PASSWORD_LENGTH_MESSAGE).toBe("パスワードは8〜100文字で入力してください");
    expect(INCORRECT_PASSWORD_MESSAGE).toBe("パスワードが正しくありません");
    expect(INDEX_UPDATE_TOKEN_REQUIRED_MESSAGE).toBe(
      "この指数を更新する権限がありません（作成者トークンが必要です）",
    );
    expect(INDEX_UPDATE_TOKEN_MISMATCH_MESSAGE).toBe(
      "この指数を更新する権限がありません（作成者トークンが一致しません）",
    );
    expect(PROTECTED_INDEX_UPDATE_MESSAGE).toBe(
      "この指数は保護されているため更新できません（管理者権限が必要です）",
    );
  });

  it("builds the parameterized messages from the shared limits", () => {
    expect(yahooNoDataMessage("^N225")).toBe(
      "Yahoo Financeから^N225のデータを取得できませんでした。",
    );
    expect(basketMaxItemsMessage()).toBe("銘柄は最大500件まで指定できます。");
    expect(invalidOwnerTokenMessage()).toBe(
      "作成者トークンは256文字以内の文字列で指定してください。",
    );
    expect(ownerTokenLengthMessage()).toBe("作成者トークンは256文字以内で指定してください");
    expect(adminLoginLockoutMessage(5)).toBe(
      "試行回数の上限（5回）に達したためロックされました。約5分後に再試行してください。",
    );
  });
});
