/**
 * CR-5 アクセスログ。
 *
 * 出力は `{ user_key, timestamp, registration_number }` の**3フィールドのみ**
 * （社名・照会結果など公表情報は一切含めない。CR-3/CR-5）。
 *
 * 入力型 AccessLogInput は userKey / registrationNumber の 2 つしか受け取れない。
 * timestamp はモジュール内部で生成する。社名・応答ボディを渡す余地を**型で塞ぐ**ため、
 * この型に他フィールドを足してはならない（足すとスナップショットテストが落ちる）。
 */

export interface AccessLogInput {
  /** 利用者ID（安定ユーザーキー）。 */
  readonly userKey: string;
  /** 照会した登録番号。 */
  readonly registrationNumber: string;
}

/** stdout へ書き出す構造化ログレコード（Cloud Logging）。キーはこの3つで固定。 */
interface AccessLogRecord {
  readonly user_key: string;
  readonly timestamp: string;
  readonly registration_number: string;
}

/**
 * CR-5 の3点のみを 1 行の JSON として stdout へ出力する。
 * @param input userKey と registrationNumber のみ（他は型で受け付けない）
 */
export function logAccess(input: AccessLogInput): void {
  const record: AccessLogRecord = {
    user_key: input.userKey,
    timestamp: new Date().toISOString(),
    registration_number: input.registrationNumber,
  };
  process.stdout.write(`${JSON.stringify(record)}\n`);
}
