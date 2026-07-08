/**
 * 無料枠カウント用の「安定ユーザーキー」導出（追補v1.1 R3-1で確定）。
 *
 * 方式（UserProperties UUID 単独方式）:
 *   初回起動時に `Utilities.getUuid()` で UUID を生成し
 *   `PropertiesService.getUserProperties()` の `STABLE_USER_KEY_UUID` に保存、
 *   以後これを安定ユーザーキーとする（ユーザー毎・スクリプト毎に分離され追加スコープ不要）。
 *   プレフィックス（em:/up:/tmp:）は単独方式のため不要・廃止した。
 *
 * 方式確定の理由:
 *   - `Session.getActiveUser().getEmail()` は OAuth スコープ3点固定（CR-7）の構成では
 *     空文字になり得て信頼できない（メール取得には追加スコープが必要でスコープ固定と衝突）。
 *     そのため email 取得・SHA-256・SALT は使用しない（旧3段フォールバックは全廃）。
 *   - ライセンス紐付けは「キー⇄Stripe購読」が真実源であり、この UUID は無料枠カウント専用。
 *
 * 悪用余地（R3-1-3）:
 *   ユーザーが UserProperties を消去すれば無料枠（月50行）がリセットされる余地があるが、
 *   上限が小さく実害僅少・対策の複雑化コストの方が大きいため**対策コードは書かない**（許容）。
 *
 * 純関数部（isValidUuid）は GAS グローバルに依存せず vitest でテスト可能。
 * GAS 依存部（getStableUserKey / debugUserKeyProbe）は PropertiesService / Utilities を
 * 参照するが、関数本体の実行時のみ評価されるため import 自体は GAS 環境外でも安全。
 */

/** UserProperties のキー名。安定 UUID の保存先。 */
const STABLE_USER_KEY_UUID = 'STABLE_USER_KEY_UUID';

// ---------------------------------------------------------------------------
// 純関数部（GAS 非依存・vitest でテスト可能）
// ---------------------------------------------------------------------------

/** `Utilities.getUuid()` 形式（8-4-4-4-12 の hex・ハイフン区切り）の検証用。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `Utilities.getUuid()` 形式の UUID かどうかを検証する。
 *
 * 8-4-4-4-12 の hex（大文字小文字問わず）をハイフン区切りで並べた形式のみ true。
 *
 * @param value 検証対象の文字列
 * @returns UUID 形式なら true
 */
export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// ---------------------------------------------------------------------------
// GAS 依存部
// ---------------------------------------------------------------------------

/** unknown なエラーから安全にメッセージ文字列を取り出す。 */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 無料枠カウント用の安定ユーザーキーを取得する（追補v1.1 R3-1）。
 *
 * UserProperties の `STABLE_USER_KEY_UUID` を読み、あればそれを返す。
 * 無ければ `Utilities.getUuid()` で生成・保存してから返す（初回起動時のみ生成）。
 *
 * @returns UUID 形式の安定ユーザーキー
 */
export function getStableUserKey(): string {
  const props = PropertiesService.getUserProperties();
  const existing = props.getProperty(STABLE_USER_KEY_UUID);
  if (existing != null && existing !== '') {
    return existing;
  }
  const uuid = Utilities.getUuid();
  props.setProperty(STABLE_USER_KEY_UUID, uuid);
  return uuid;
}

/**
 * UserProperties 方式の動作確認用プローブ（追補v1.1 R3-1: §12-5の読み替え）。
 *
 * GAS エディタから手動実行し、出力 JSON を docs/decisions.md へ反映する。
 * 確認項目: UserProperties の読み書き可否／既存キーの有無（今回新規生成したか）／
 * 得られたキー／isValidUuid 結果。各シグナルは try/catch で包み、プローブ全体は落とさない。
 *
 * @returns 検証シグナルをまとめた JSON 文字列
 */
export function debugUserKeyProbe(): string {
  let userPropertiesReadWrite: string;
  try {
    const props = PropertiesService.getUserProperties();
    const probeKey = '__user_key_probe__';
    props.setProperty(probeKey, '1');
    props.getProperty(probeKey);
    props.deleteProperty(probeKey);
    userPropertiesReadWrite = 'ok';
  } catch (e) {
    userPropertiesReadWrite = 'error: ' + errorMessage(e);
  }

  let keyExistedBeforeProbe: boolean | string;
  try {
    const existing = PropertiesService.getUserProperties().getProperty(
      STABLE_USER_KEY_UUID,
    );
    keyExistedBeforeProbe = existing != null && existing !== '';
  } catch (e) {
    keyExistedBeforeProbe = 'error: ' + errorMessage(e);
  }

  let stableUserKey: string;
  let stableUserKeyIsValidUuid: boolean | string;
  try {
    const key = getStableUserKey();
    stableUserKey = key;
    stableUserKeyIsValidUuid = isValidUuid(key);
  } catch (e) {
    stableUserKey = 'error: ' + errorMessage(e);
    stableUserKeyIsValidUuid = 'error: ' + errorMessage(e);
  }

  const result: {
    userPropertiesReadWrite: string;
    keyExistedBeforeProbe: boolean | string;
    stableUserKey: string;
    stableUserKeyIsValidUuid: boolean | string;
  } = {
    userPropertiesReadWrite,
    keyExistedBeforeProbe,
    stableUserKey,
    stableUserKeyIsValidUuid,
  };

  return JSON.stringify(result, null, 2);
}
