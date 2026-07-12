import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

// バンドル起動スモーク（docs/tasks-bundling.md Step 2）。
// `node dist/index.js` を Secret 系一切未設定で起動し（InMemoryQuotaStore／license系503の正規縮退経路）、
// /health が 200 + JSON を返せばバンドル成立とみなす。
// routes/index.ts が services/firestore.js を static import しているため、この1本で
// Firestore SDK 含む全依存のバンドル成立とモジュールロードが検証できる。

const PORT = '8790';
const POLL_INTERVAL_MS = 250;
const TIMEOUT_MS = 10_000;

// 環境変数は最小限のみ渡す（Secret 系の混入を構造的に防ぐ）
const child = spawn('node', ['dist/index.js'], {
  env: { PATH: process.env.PATH ?? '', PORT, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stderrBuf = '';
let stdoutBuf = '';
child.stderr.on('data', (chunk) => {
  stderrBuf += String(chunk);
});
child.stdout.on('data', (chunk) => {
  stdoutBuf += String(chunk);
});
let exited = false;
child.on('exit', () => {
  exited = true;
});

function fail(reason) {
  child.kill('SIGTERM');
  const summary = (stderrBuf || stdoutBuf).split('\n').slice(0, 12).join('\n');
  console.error(`[smoke] FAIL: ${reason}`);
  if (summary.trim() !== '') console.error(`[smoke] child output:\n${summary}`);
  process.exit(1);
}

const deadline = Date.now() + TIMEOUT_MS;
let lastError = 'まだ応答なし';
while (Date.now() < deadline) {
  if (exited) fail(`サーバプロセスが早期終了しました（code取得前にexit）`);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`);
    if (res.status === 200) {
      const body = await res.json(); // JSONでなければthrow→fail扱い
      console.log(`[smoke] OK: /health 200 ${JSON.stringify(body)}`);
      child.kill('SIGTERM');
      process.exit(0);
    }
    lastError = `HTTP ${res.status}`;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
  await sleep(POLL_INTERVAL_MS);
}
fail(`${TIMEOUT_MS / 1000}秒以内に /health 200+JSON に到達せず（最終状態: ${lastError}）`);
