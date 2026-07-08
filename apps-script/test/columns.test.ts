import { describe, it, expect } from 'vitest';
import {
  guessColumnMapping,
  isReprocessTarget,
  statusError,
  STATUS,
  OUTPUT_COLUMNS,
} from '../src/server/columns';

describe('guessColumnMapping（FR-1 ヘッダー自動推定）', () => {
  it('社名・法人番号・登録番号を推定する（1始まりの列番号）', () => {
    expect(guessColumnMapping(['社名', '法人番号', '登録番号'])).toEqual({
      nameCol: 1,
      corpNumCol: 2,
      regNumCol: 3,
    });
  });

  it('「会社名」「取引先名」なども社名として推定する', () => {
    expect(guessColumnMapping(['会社名']).nameCol).toBe(1);
    expect(guessColumnMapping(['取引先名']).nameCol).toBe(1);
    expect(guessColumnMapping(['商号']).nameCol).toBe(1);
  });

  it('「インボイス登録番号」は登録番号列に推定する（法人番号ではない）', () => {
    const m = guessColumnMapping(['インボイス登録番号']);
    expect(m.regNumCol).toBe(1);
    expect(m.corpNumCol).toBeUndefined();
  });

  it('該当ヘッダーが無ければキー未設定', () => {
    expect(guessColumnMapping(['メモ', '担当者'])).toEqual({});
  });

  it('空配列でも落ちない（境界: 空）', () => {
    expect(guessColumnMapping([])).toEqual({});
  });

  it('leftmost 一致を採用する（同種が複数あっても最初の列）', () => {
    expect(guessColumnMapping(['社名', '会社名']).nameCol).toBe(1);
  });

  it('本ツールの出力列ヘッダーは推定対象から除外する（C6 誤認防止）', () => {
    // 「法人番号(結果)」は出力列なので corpNumCol に取られない。
    const headers = ['社名', '法人番号(結果)', 'ステータス'];
    expect(guessColumnMapping(headers)).toEqual({ nameCol: 1 });
  });

  it('null や数値ヘッダーが混ざっても落ちない', () => {
    const headers: unknown[] = [null, 123, '社名'];
    expect(guessColumnMapping(headers).nameCol).toBe(3);
  });

  it('前後空白を無視して一致する', () => {
    expect(guessColumnMapping(['  法人番号  ']).corpNumCol).toBe(1);
  });
});

describe('isReprocessTarget（FR-8 ステータス判定）', () => {
  it("'成功' は再実行対象でない", () => {
    expect(isReprocessTarget(STATUS.success)).toBe(false);
  });

  it("空文字・未処理・候補選択待ち・エラーは再実行対象", () => {
    expect(isReprocessTarget('')).toBe(true);
    expect(isReprocessTarget(STATUS.unprocessed)).toBe(true);
    expect(isReprocessTarget(STATUS.pending)).toBe(true);
    expect(isReprocessTarget(statusError('法人番号APIがHTTP 500 を返しました'))).toBe(true);
  });

  it("前後空白付きの '成功' も成功扱い（再実行対象でない）", () => {
    expect(isReprocessTarget(' 成功 ')).toBe(false);
  });
});

describe('OUTPUT_COLUMNS', () => {
  it('ステータス列を含み、ヘッダー名は一意', () => {
    const headers = OUTPUT_COLUMNS.map((c) => c.header);
    expect(headers).toContain('ステータス');
    expect(new Set(headers).size).toBe(headers.length);
  });
});
