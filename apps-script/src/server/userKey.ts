/**
 * 無料枠カウント用の「安定ユーザーキー」導出（§6・§12-5）。
 *
 * OAuth スコープは3点固定（CR-7）のため `openid` / `ScriptApp.getIdentityToken()` は
 * 使用不可。その制約下で、以下の優先順に安定キーを導出する:
 *   1. `Session.getActiveUser().getEmail()` が非空
 *      → `"em:" + SHA-256hex(小文字化・trimしたemail + SALT)`
 *        （SALT は Script Properties `USER_KEY_SALT`。未設定なら明示エラー）
 *   2. email が空 → UserProperties の `STABLE_USER_KEY_UUID`（初回アクセス時に生成・保存）
 *      を使い `"up:" + uuid`（ハッシュ不要・PII でないため生値）
 *   3. UserProperties も例外を投げる → `"tmp:" + Session.getTemporaryActiveUserKey()`
 *      （約30日でローテーションする既知の劣化モード）
 *
 * プレフィックス（em:/up:/tmp:）はバックエンド側で品質を観測するための識別子。
 *
 * 純関数部（bytesToHex / normalizeEmail / selectKeySource）は GAS グローバルに
 * 依存せず vitest でテスト可能。GAS 依存部（getStableUserKey / debugUserKeyProbe）は
 * Session / PropertiesService / Utilities を参照するが、関数本体の実行時のみ評価される
 * ため、モジュール import 自体は GAS 環境外でも安全。
 */

/** Script Properties のキー名。SALT（em: 経路のハッシュに使う秘匿値）。 */
const USER_KEY_SALT_PROP = 'USER_KEY_SALT';

/** UserProperties のキー名。up: 経路で使う安定 UUID の保存先。 */
const STABLE_USER_KEY_UUID = 'STABLE_USER_KEY_UUID';

// ---------------------------------------------------------------------------
// 純関数部（GAS 非依存・vitest でテスト可能）
// ---------------------------------------------------------------------------

/**
 * バイト配列を小文字16進文字列に変換する。
 *
 * GAS の `Utilities.computeDigest` は signed byte（-128〜127）の配列を返すため、
 * 負値を 0-255 に正規化してから2桁 hex 化する（`& 0xff` で下位8ビットを取る）。
 *
 * @param bytes signed byte を想定した数値配列（0-255 の値もそのまま扱える）
 * @returns 各バイトを2桁 hex（0 埋め）で連結した文字列。空配列なら空文字。
 */
export function bytesToHex(bytes: number[]): string {
  let hex = '';
  for (const b of bytes) {
    hex += (b & 0xff).toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * email を正規化する（trim + 小文字化）。ハッシュ入力の安定化に使う。
 *
 * @param email 生の email 文字列
 * @returns trim して小文字化した文字列
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * email の有無からキー導出経路を選ぶ。
 *
 * @param email `Session.getActiveUser().getEmail()` の戻り（null/undefined/空もあり得る）
 * @returns trim 後に非空なら 'email'、それ以外は 'userProperties'
 */
export function selectKeySource(
  email: string | null | undefined,
): 'email' | 'userProperties' {
  if (email == null) return 'userProperties';
  return email.trim() !== '' ? 'email' : 'userProperties';
}

// ---------------------------------------------------------------------------
// GAS 依存部
// ---------------------------------------------------------------------------

/** unknown なエラーから安全にメッセージ文字列を取り出す。 */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * アクティブユーザーの email を安全に読む。失敗・null は空文字にフォールバックし、
 * 呼び出し側で up: 経路へ倒せるようにする。
 */
function readActiveUserEmail(): string {
  try {
    const email = Session.getActiveUser().getEmail();
    return email == null ? '' : email;
  } catch {
    return '';
  }
}

/**
 * Script Properties から SALT を取得する。未設定なら明示エラーを投げる。
 * SALT の生値はエラーメッセージにも戻り値にも含めない。
 */
function getUserKeySalt(): string {
  const salt = PropertiesService.getScriptProperties().getProperty(
    USER_KEY_SALT_PROP,
  );
  if (salt == null || salt === '') {
    throw new Error('USER_KEY_SALTをScript Propertiesに設定してください');
  }
  return salt;
}

/** em: 経路。正規化 email + SALT の SHA-256 を hex 化して返す（生 email は返さない）。 */
function hashEmail(email: string): string {
  const salt = getUserKeySalt();
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    normalizeEmail(email) + salt,
    Utilities.Charset.UTF_8,
  );
  return bytesToHex(bytes);
}

/**
 * up: 経路。UserProperties の安定 UUID を返す（無ければ生成・保存）。
 * PropertiesService が例外を投げた場合は呼び出し側へ伝播させ、tmp: 経路へ倒す。
 */
function getOrCreateStableUuid(): string {
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
 * 無料枠カウント用の安定ユーザーキーを導出する（§6 の優先順）。
 *
 * @returns `"em:" | "up:" | "tmp:"` のいずれかのプレフィックスを持つキー文字列
 * @throws USER_KEY_SALT 未設定時（em: 経路に限る）
 */
export function getStableUserKey(): string {
  const email = readActiveUserEmail();
  if (selectKeySource(email) === 'email') {
    // SALT 未設定なら hashEmail が明示エラーを投げ、ここで伝播させる（握り潰さない）。
    return 'em:' + hashEmail(email);
  }
  // email 空 → up: 経路。UserProperties が落ちる場合のみ tmp: へ最終フォールバック。
  try {
    return 'up:' + getOrCreateStableUuid();
  } catch {
    return 'tmp:' + Session.getTemporaryActiveUserKey();
  }
}

/** キー文字列から `em:` / `up:` / `tmp:` のプレフィックス部を取り出す。 */
function keyPrefix(key: string): string {
  const idx = key.indexOf(':');
  return idx === -1 ? '(no prefix)' : key.slice(0, idx + 1);
}

/** 各シグナルを try/catch で包み、boolean か "error: <message>" を返す。 */
function probeBoolean(fn: () => boolean): boolean | string {
  try {
    return fn();
  } catch (e) {
    return 'error: ' + errorMessage(e);
  }
}

/**
 * §12-5 実機検証用のプローブ。GAS エディタから手動実行し、出力 JSON を
 * docs/decisions.md へ反映して安定キー方式（①/②のどちらが主経路か）を確定する。
 *
 * PII 保護（絶対制約）: email の生値・SALT の生値は一切含めない。email は有無の
 * boolean のみ。導出された安定ユーザーキー自体はハッシュ/UUID/不透明キーで PII では
 * ないため、方式検証のためプレフィックスと全体を含める。各シグナルは try/catch で
 * 包み、失敗は "error: <message>" として記録する（プローブ全体は落とさない）。
 *
 * @returns 検証シグナルをまとめた JSON 文字列
 */
export function debugUserKeyProbe(): string {
  const activeUserEmailPresent = probeBoolean(() => {
    const e = Session.getActiveUser().getEmail();
    return e != null && e.trim() !== '';
  });

  const effectiveUserEmailPresent = probeBoolean(() => {
    const e = Session.getEffectiveUser().getEmail();
    return e != null && e.trim() !== '';
  });

  const temporaryActiveUserKeyAvailable = probeBoolean(() => {
    const k = Session.getTemporaryActiveUserKey();
    return k != null && k !== '';
  });

  const userKeySaltConfigured = probeBoolean(() => {
    const s = PropertiesService.getScriptProperties().getProperty(
      USER_KEY_SALT_PROP,
    );
    return s != null && s !== '';
  });

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

  let resultKeyPrefix: string;
  let stableUserKey: string;
  try {
    const key = getStableUserKey();
    stableUserKey = key;
    resultKeyPrefix = keyPrefix(key);
  } catch (e) {
    stableUserKey = 'error: ' + errorMessage(e);
    resultKeyPrefix = 'error: ' + errorMessage(e);
  }

  const result: {
    activeUserEmailPresent: boolean | string;
    effectiveUserEmailPresent: boolean | string;
    temporaryActiveUserKeyAvailable: boolean | string;
    userKeySaltConfigured: boolean | string;
    userPropertiesReadWrite: string;
    resultKeyPrefix: string;
    stableUserKey: string;
  } = {
    activeUserEmailPresent,
    effectiveUserEmailPresent,
    temporaryActiveUserKeyAvailable,
    userKeySaltConfigured,
    userPropertiesReadWrite,
    resultKeyPrefix,
    stableUserKey,
  };

  return JSON.stringify(result, null, 2);
}
