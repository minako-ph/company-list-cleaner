import { describe, it, expect } from 'vitest';
import {
  registrationNumberFromCorporateNumber,
  isCorporateNumber,
  isRegistrationNumber,
  extractDigits,
  formatKind,
  formatFlag,
  outcomeText,
  formatInvoiceStatus,
  basicAddressText,
  gbizEmployeesText,
} from '../src/server/format';
import type { FieldOutcome, BasicData, GbizBasicData, InvoiceStatus } from '../src/server/backendDto';

describe('registrationNumberFromCorporateNumber（CR-1 登録番号の機械生成）', () => {
  it('法人番号13桁 → T＋13桁', () => {
    expect(registrationNumberFromCorporateNumber('1234567890123')).toBe('T1234567890123');
  });

  it('13桁でなければ空文字（生成不能）', () => {
    expect(registrationNumberFromCorporateNumber('123')).toBe('');
    expect(registrationNumberFromCorporateNumber('12345678901234')).toBe('');
    expect(registrationNumberFromCorporateNumber('')).toBe('');
  });

  it('数字以外を含むと空文字', () => {
    expect(registrationNumberFromCorporateNumber('T1234567890123')).toBe('');
    expect(registrationNumberFromCorporateNumber('123456789012a')).toBe('');
  });
});

describe('extractDigits / 番号判定', () => {
  it('数値として読まれたセルからも数字を取り出す', () => {
    expect(extractDigits(1234567890123)).toBe('1234567890123');
    expect(extractDigits('123-4567-890123')).toBe('1234567890123');
    expect(extractDigits(null)).toBe('');
    expect(extractDigits(undefined)).toBe('');
  });

  it('isCorporateNumber は数字13桁のみ true', () => {
    expect(isCorporateNumber('1234567890123')).toBe(true);
    expect(isCorporateNumber('123')).toBe(false);
  });

  it('isRegistrationNumber は T＋数字13桁のみ true', () => {
    expect(isRegistrationNumber('T1234567890123')).toBe(true);
    expect(isRegistrationNumber('1234567890123')).toBe(false);
  });
});

describe('formatKind', () => {
  it('既知コードは表示名へ', () => {
    expect(formatKind('301')).toBe('株式会社');
    expect(formatKind('305')).toBe('合同会社');
  });
  it('未知コードはそのまま・空は空', () => {
    expect(formatKind('999')).toBe('999');
    expect(formatKind('')).toBe('');
  });
});

describe('formatFlag（FR-6）', () => {
  it('有無＋件数を表示', () => {
    expect(formatFlag({ has: true, recentCount: 3 })).toBe('有（3件）');
    expect(formatFlag({ has: false, recentCount: 0 })).toBe('無');
  });
});

describe('outcomeText（結果→表示文字列の共通変換）', () => {
  const ok: FieldOutcome<BasicData> = { status: 'ok', data: { name: 'A', address: '東京都', kind: '301' } };
  const notFound: FieldOutcome<BasicData> = { status: 'not_found' };
  const error: FieldOutcome<BasicData> = { status: 'error', error: { code: 'http_error', message: '法人番号APIがHTTP 500 を返しました' } };

  it('ok は data 変換、not_found は 該当なし、error は エラー: 付き', () => {
    expect(basicAddressText(ok)).toBe('東京都');
    expect(basicAddressText(notFound)).toBe('該当なし');
    expect(basicAddressText(error)).toBe('エラー: 法人番号APIがHTTP 500 を返しました');
  });

  it('undefined（付与しなかった）は undefined（セルを書かない）', () => {
    expect(outcomeText(undefined, () => 'x')).toBeUndefined();
  });

  it('従業員数の未設定は空文字', () => {
    const noEmp: FieldOutcome<GbizBasicData> = { status: 'ok', data: { name: 'A' } };
    expect(gbizEmployeesText(noEmp)).toBe('');
    const withEmp: FieldOutcome<GbizBasicData> = { status: 'ok', data: { name: 'A', employeeNumber: 50 } };
    expect(gbizEmployeesText(withEmp)).toBe('50');
  });
});

describe('formatInvoiceStatus（FR-5 found=false→未登録 等）', () => {
  it('found=false は 未登録', () => {
    const s: InvoiceStatus = { registrationNumber: 'T1', found: false, registered: false };
    expect(formatInvoiceStatus(s)).toBe('未登録');
  });

  it('registered=true は 登録あり（登録日）', () => {
    const s: InvoiceStatus = { registrationNumber: 'T1', found: true, registered: true, registrationDate: '2023-10-01' };
    expect(formatInvoiceStatus(s)).toBe('登録あり（登録日 2023-10-01）');
  });

  it('登録日が無い登録ありは 登録あり', () => {
    const s: InvoiceStatus = { registrationNumber: 'T1', found: true, registered: true };
    expect(formatInvoiceStatus(s)).toBe('登録あり');
  });

  it('取消済み・失効を区別して表示', () => {
    expect(
      formatInvoiceStatus({ registrationNumber: 'T1', found: true, registered: false, disposalDate: '2024-03-31' }),
    ).toBe('取消済み（2024-03-31）');
    expect(
      formatInvoiceStatus({ registrationNumber: 'T1', found: true, registered: false, expireDate: '2024-06-30' }),
    ).toBe('失効（2024-06-30）');
  });

  it('error はエラー表示', () => {
    const s: InvoiceStatus = { registrationNumber: 'T1', found: false, registered: false, error: { code: 'http_error', message: 'インボイスAPIがHTTP 500 を返しました' } };
    expect(formatInvoiceStatus(s)).toBe('エラー: インボイスAPIがHTTP 500 を返しました');
  });
});
