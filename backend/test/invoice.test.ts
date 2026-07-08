import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import {
  createInvoiceClient,
  type InvoiceFetch,
  type InvoiceStatus,
} from '../src/clients/invoice.js';
import { registerInvoiceRoute } from '../src/routes/invoice.js';
import { createSerialQueue } from '../src/queue.js';

/**
 * インボイスクライアント（FR-5）＋ /invoice ルートのユニットテスト。
 * CR-1〜5 の独立検証は cr-compliance.test.ts 側で行う（本ファイルは挙動の検証）。
 */

function loadFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/invoice/${name}`, import.meta.url));
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return parsed;
}

interface StubFetch {
  readonly fn: InvoiceFetch;
  readonly calls: string[];
}

/** URL に応じて status / body を返す fetch スタブ。呼び出しURLを記録する。 */
function stubFetch(handler: (url: string) => { status: number; body: unknown }): StubFetch {
  const calls: string[] = [];
  const fn: InvoiceFetch = (url) => {
    calls.push(url);
    const { status, body } = handler(url);
    return Promise.resolve({ status, json: () => Promise.resolve(body) });
  };
  return { fn, calls };
}

/** テスト用クライアント生成。既定は設定済み（apiBase/appId 非空）・高速キュー。 */
function makeClient(options: {
  fetchFn: InvoiceFetch;
  logAccess?: (input: { userKey: string; registrationNumber: string }) => void;
  apiBase?: string;
  appId?: string;
}) {
  return createInvoiceClient({
    apiBase: options.apiBase ?? 'https://verify.invoice.example',
    appId: options.appId ?? '1234567890123',
    queue: createSerialQueue(1000), // 1ms 間隔（テスト高速化）
    fetchFn: options.fetchFn,
    logAccess: options.logAccess ?? (() => undefined),
  });
}

/** T+13桁の妥当な登録番号を index から機械生成する。 */
function makeNumber(i: number): string {
  return `T${String(i).padStart(13, '0')}`;
}

/** URL の number= に含まれる登録番号の件数を数える。 */
function countNumbersInUrl(url: string): number {
  const match = /[?&]number=([^&]+)/.exec(url);
  if (match === null || match[1] === undefined) return 0;
  return match[1].split(',').length;
}

describe('createInvoiceClient.lookupByRegistrationNumbers', () => {
  it('正常系: fixture の複数件を found/registered/取消/失効へ整形する', async () => {
    const body = loadFixture('mixed.json');
    const { fn } = stubFetch(() => ({ status: 200, body }));
    const client = makeClient({ fetchFn: fn });

    const results = await client.lookupByRegistrationNumbers(
      ['T1111111111111', 'T2222222222222', 'T3333333333333'],
      { userKey: 'user-1' },
    );

    expect(results).toEqual<InvoiceStatus[]>([
      {
        registrationNumber: 'T1111111111111',
        found: true,
        registered: true,
        registrationDate: '2023-10-01',
      },
      {
        registrationNumber: 'T2222222222222',
        found: true,
        registered: false,
        registrationDate: '2022-04-01',
        disposalDate: '2024-03-31',
      },
      {
        registrationNumber: 'T3333333333333',
        found: true,
        registered: false,
        registrationDate: '2021-11-01',
        expireDate: '2023-12-31',
      },
    ]);
  });

  it('応答に無い登録番号は found=false（エラーではない）', async () => {
    const body = loadFixture('active.json');
    const { fn } = stubFetch(() => ({ status: 200, body }));
    const client = makeClient({ fetchFn: fn });

    const results = await client.lookupByRegistrationNumbers(
      ['T1111111111111', 'T9999999999999'],
      { userKey: 'user-1' },
    );

    expect(results[0]).toEqual({
      registrationNumber: 'T1111111111111',
      found: true,
      registered: true,
      registrationDate: '2023-10-01',
    });
    expect(results[1]).toEqual({
      registrationNumber: 'T9999999999999',
      found: false,
      registered: false,
    });
  });

  it('10件ずつ分割: 25件は 3 リクエスト（10/10/5件）になる', async () => {
    const { fn, calls } = stubFetch(() => ({ status: 200, body: { count: '0', announcement: [] } }));
    const client = makeClient({ fetchFn: fn });

    const numbers = Array.from({ length: 25 }, (_, i) => makeNumber(i));
    const results = await client.lookupByRegistrationNumbers(numbers, { userKey: 'user-1' });

    expect(calls).toHaveLength(3);
    expect(calls.map(countNumbersInUrl)).toEqual([10, 10, 5]);
    expect(results).toHaveLength(25);
    // 応答が空配列なので全件 found=false（エラーではない）。
    expect(results.every((r) => r.found === false && r.error === undefined)).toBe(true);
    // 入力順が保存されている。
    expect(results.map((r) => r.registrationNumber)).toEqual(numbers);
  });

  it('不正形式の登録番号は照会せず行単位エラー（invalid_format）にする', async () => {
    const body = loadFixture('active.json');
    const logged: string[] = [];
    const { fn, calls } = stubFetch(() => ({ status: 200, body }));
    const client = makeClient({
      fetchFn: fn,
      logAccess: (input) => logged.push(input.registrationNumber),
    });

    const results = await client.lookupByRegistrationNumbers(
      ['T1111111111111', 'BADNUMBER', 'T123', 't1111111111111'],
      { userKey: 'user-1' },
    );

    expect(results[0]?.found).toBe(true);
    expect(results[1]?.error?.code).toBe('invalid_format');
    expect(results[2]?.error?.code).toBe('invalid_format');
    // 小文字 t は不正形式。
    expect(results[3]?.error?.code).toBe('invalid_format');
    // 照会・ログは妥当な番号のみ。
    expect(logged).toEqual(['T1111111111111']);
    expect(calls.map(countNumbersInUrl)).toEqual([1]);
  });

  it('HTTP 400 のチャンクは行単位エラー、他チャンクは継続する（FR-8）', async () => {
    // index0 を含むチャンク（1件目）を 400 に、残りは 200。
    const { fn } = stubFetch((url) => {
      if (url.includes(makeNumber(0))) return { status: 400, body: {} };
      return { status: 200, body: { count: '0', announcement: [] } };
    });
    const client = makeClient({ fetchFn: fn });

    const numbers = Array.from({ length: 15 }, (_, i) => makeNumber(i)); // 10 + 5
    const results = await client.lookupByRegistrationNumbers(numbers, { userKey: 'user-1' });

    // 先頭チャンク（0..9）は http_error。
    for (let i = 0; i < 10; i += 1) {
      expect(results[i]?.error?.code).toBe('http_error');
    }
    // 後続チャンク（10..14）は継続し found=false（エラーなし）。
    for (let i = 10; i < 15; i += 1) {
      expect(results[i]?.found).toBe(false);
      expect(results[i]?.error).toBeUndefined();
    }
  });

  it('HTTP エラーのメッセージにアプリID・登録番号が漏れない（redact）', async () => {
    const { fn } = stubFetch(() => ({ status: 500, body: {} }));
    const client = makeClient({ fetchFn: fn, appId: '9998887776665' });
    const results = await client.lookupByRegistrationNumbers(['T1111111111111'], {
      userKey: 'user-1',
    });
    const message = results[0]?.error?.message ?? '';
    expect(results[0]?.error?.code).toBe('http_error');
    expect(message).not.toContain('9998887776665');
    expect(message).not.toContain('T1111111111111');
  });

  it('CR-5: 照会した登録番号ごとに logAccess が userKey 付きで1回ずつ呼ばれる', async () => {
    const body = loadFixture('mixed.json');
    const { fn } = stubFetch(() => ({ status: 200, body }));
    const logAccess = vi.fn();
    const client = makeClient({ fetchFn: fn, logAccess });

    await client.lookupByRegistrationNumbers(
      ['T1111111111111', 'T2222222222222', 'T3333333333333'],
      { userKey: 'user-xyz' },
    );

    expect(logAccess).toHaveBeenCalledTimes(3);
    expect(logAccess).toHaveBeenCalledWith({ userKey: 'user-xyz', registrationNumber: 'T1111111111111' });
    expect(logAccess).toHaveBeenCalledWith({ userKey: 'user-xyz', registrationNumber: 'T2222222222222' });
    expect(logAccess).toHaveBeenCalledWith({ userKey: 'user-xyz', registrationNumber: 'T3333333333333' });
  });

  it('未設定（apiBase/appId 空）時は照会もログもせず not_configured エラーを返す', async () => {
    const { fn, calls } = stubFetch(() => ({ status: 200, body: {} }));
    const logAccess = vi.fn();
    const client = makeClient({ fetchFn: fn, logAccess, apiBase: '', appId: '' });

    const results = await client.lookupByRegistrationNumbers(['T1111111111111'], {
      userKey: 'user-1',
    });

    expect(results[0]?.error?.code).toBe('not_configured');
    expect(calls).toHaveLength(0);
    expect(logAccess).not.toHaveBeenCalled();
  });

  it('空配列の入力は空配列を返す（照会なし）', async () => {
    const { fn, calls } = stubFetch(() => ({ status: 200, body: {} }));
    const client = makeClient({ fetchFn: fn });
    const results = await client.lookupByRegistrationNumbers([], { userKey: 'user-1' });
    expect(results).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('POST /invoice ルート', () => {
  async function postInvoice(app: Hono, body: unknown): Promise<Response> {
    return app.request('/invoice', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('INVOICE_ENABLED=false のとき 503 と invoice_disabled を返し lookup を呼ばない', async () => {
    const app = new Hono();
    const lookup = vi.fn(() => Promise.resolve<InvoiceStatus[]>([]));
    registerInvoiceRoute(app, { invoiceEnabled: false, lookup });

    const res = await postInvoice(app, { userKey: 'u', registrationNumbers: ['T1111111111111'] });

    expect(res.status).toBe(503);
    const json: unknown = await res.json();
    expect(json).toEqual({ error: 'invoice_disabled', message: '準備中' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('有効時は lookup 結果を { results } で返す', async () => {
    const statuses: InvoiceStatus[] = [
      { registrationNumber: 'T1111111111111', found: true, registered: true, registrationDate: '2023-10-01' },
    ];
    const app = new Hono();
    const lookup = vi.fn(() => Promise.resolve(statuses));
    registerInvoiceRoute(app, { invoiceEnabled: true, lookup });

    const res = await postInvoice(app, { userKey: 'u', registrationNumbers: ['T1111111111111'] });

    expect(res.status).toBe(200);
    const json: unknown = await res.json();
    expect(json).toEqual({ results: statuses });
    expect(lookup).toHaveBeenCalledWith(['T1111111111111'], { userKey: 'u' });
  });

  it('userKey が無い / registrationNumbers が配列でない場合は 400', async () => {
    const app = new Hono();
    registerInvoiceRoute(app, {
      invoiceEnabled: true,
      lookup: () => Promise.resolve<InvoiceStatus[]>([]),
    });

    const noKey = await postInvoice(app, { registrationNumbers: ['T1111111111111'] });
    expect(noKey.status).toBe(400);

    const notArray = await postInvoice(app, { userKey: 'u', registrationNumbers: 'T1111111111111' });
    expect(notArray.status).toBe(400);
  });

  it('登録番号が上限（50件）を超えると 400', async () => {
    const app = new Hono();
    registerInvoiceRoute(app, {
      invoiceEnabled: true,
      lookup: () => Promise.resolve<InvoiceStatus[]>([]),
    });
    const numbers = Array.from({ length: 51 }, (_, i) => makeNumber(i));
    const res = await postInvoice(app, { userKey: 'u', registrationNumbers: numbers });
    expect(res.status).toBe(400);
  });
});
