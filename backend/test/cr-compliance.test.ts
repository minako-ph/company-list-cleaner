import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 国税庁承認条件（CR-1〜5）のソーススキャンによる明示的検証（要件書 §8-1: CRはコードレビューの明示項目）。
 *
 * ここでの検証は「静的なコード上の縛り」。CR-3 の実体的防御（ログに応答が乗らない）は
 * accessLog.test.ts の 3 キースナップショット（Step1 済み）との**二重防御**である。
 */

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));
const INVOICE_CLIENT = join(SRC_DIR, 'clients', 'invoice.ts');

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...listTsFiles(path));
    } else if (name.endsWith('.ts')) {
      out.push(path);
    }
  }
  return out;
}

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('CR-1/2: インボイス照会は登録番号のみ（名称系の経路を型・引数レベルで存在させない）', () => {
  const source = read(INVOICE_CLIENT);

  it('(a) 公開する値 export は createInvoiceClient のみ（照会手段は lookupByRegistrationNumbers だけ）', () => {
    const valueExports: string[] = [];
    for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) {
      if (match[1] !== undefined) valueExports.push(match[1]);
    }
    for (const match of source.matchAll(/export\s+const\s+(\w+)/g)) {
      if (match[1] !== undefined) valueExports.push(match[1]);
    }
    for (const match of source.matchAll(/export\s+class\s+(\w+)/g)) {
      if (match[1] !== undefined) valueExports.push(match[1]);
    }

    expect(valueExports).toEqual(['createInvoiceClient']);
    // 照会手段は登録番号版だけが存在する。
    expect(source).toContain('lookupByRegistrationNumbers');
  });

  it('(a) 登録番号以外で照会する関数・メソッドの識別子が存在しない', () => {
    const forbiddenIdentifiers = [
      'lookupByName',
      'searchByName',
      'findByName',
      'lookupByAddress',
      'searchByAddress',
      'findByAddress',
      'lookupByCorporateName',
    ];
    for (const id of forbiddenIdentifiers) {
      expect(source).not.toContain(id);
    }
  });

  it('(b) 名称・住所を照会パラメータとして組み立てる文字列が存在しない', () => {
    // クエリキーとしての name= / address=、および文字列リテラルとしての 'name' / 'address'。
    const forbiddenParamPatterns = [
      /[?&]name=/,
      /[?&]address=/,
      /['"]name['"]/,
      /['"]address['"]/,
    ];
    for (const pattern of forbiddenParamPatterns) {
      expect(pattern.test(source)).toBe(false);
    }
  });
});

describe('CR-4: /diff・/point・全件ダウンロードを呼ぶコードが存在しない', () => {
  it('backend/src 配下のどのファイルも /diff・/point・download を含まない', () => {
    const files = listTsFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = read(file);
      expect(content, `${file} に /diff が含まれる`).not.toContain('/diff');
      expect(content, `${file} に /point が含まれる`).not.toContain('/point');
      expect(content.toLowerCase(), `${file} に download が含まれる`).not.toContain('download');
    }
    // 使用する唯一のエンドポイントは /1/num であることを確認（適法な照会形態）。
    expect(read(INVOICE_CLIENT)).toContain('/1/num');
  });
});

describe('CR-3: 応答の永続化経路・応答を logAccess へ渡す経路が存在しない', () => {
  it('backend/src 配下にファイル永続化 API（writeFile 等）が存在しない', () => {
    const files = listTsFiles(SRC_DIR);
    const forbidden = ['writeFile', 'appendFile', 'createWriteStream'];
    for (const file of files) {
      const content = read(file);
      for (const api of forbidden) {
        expect(content, `${file} に ${api} が含まれる`).not.toContain(api);
      }
    }
  });

  it('logAccess の呼び出しは userKey / registrationNumber のみを渡す（応答フィールドを渡さない）', () => {
    const files = listTsFiles(SRC_DIR);
    const forbiddenInLog = [
      'registrationDate',
      'disposalDate',
      'expireDate',
      'response',
      'body',
      'found',
      'registered',
      'result',
      'name',
      'address',
    ];
    // 実引数付きの logAccess(...) 呼び出しを全て収集する（型注釈 `logAccess:` は対象外）。
    let callCount = 0;
    for (const file of files) {
      const content = read(file);
      for (const match of content.matchAll(/logAccess\(\s*\{[^}]*\}\s*\)/g)) {
        callCount += 1;
        const call = match[0];
        expect(call).toContain('userKey');
        expect(call).toContain('registrationNumber');
        for (const forbidden of forbiddenInLog) {
          expect(call, `logAccess 呼び出しに ${forbidden} が含まれる`).not.toContain(forbidden);
        }
      }
    }
    // 実際に照会時のログ呼び出しが存在すること（CR-5 の裏取り）。
    expect(callCount).toBeGreaterThanOrEqual(1);
  });
});
