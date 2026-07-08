/**
 * プロセス内直列キュー（N-1）。
 *
 * 全公的API呼び出しはここを通す前提の汎用キュー。
 * - 直列実行: enqueue されたタスクは登録順に 1 つずつ実行される（同時実行は常に 1）。
 * - レート制御: タスクの**開始間隔**を最低 1/RATE_RPS 秒空ける。
 * - 堅牢性: あるタスクが reject/throw しても後続は詰まらず継続する（呼び出し元へは
 *   個別に reject を伝播する）。
 */

export interface SerialQueue {
  /** fn を直列キューに積み、実行結果を返す Promise を得る。 */
  enqueue<T>(fn: () => T | Promise<T>): Promise<T>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * @param ratePerSecond 1秒あたりの最大タスク開始数（> 0）。1/ratePerSecond 秒が最小開始間隔。
 */
export function createSerialQueue(ratePerSecond: number): SerialQueue {
  if (!Number.isFinite(ratePerSecond) || ratePerSecond <= 0) {
    throw new Error('ratePerSecond must be a positive finite number');
  }
  const minIntervalMs = 1000 / ratePerSecond;

  // 直列性の担保: 各タスクは前タスクの完了（成否問わず）を待ってから走る。
  let tail: Promise<unknown> = Promise.resolve();
  // 直近タスクの開始時刻。undefined は「まだ一度も開始していない」ことを表す
  // （0 を sentinel にすると epoch 0 と衝突しうるため undefined を使う）。
  let lastStart: number | undefined;

  function enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
    const run: Promise<T> = tail.then(async () => {
      if (lastStart !== undefined) {
        const wait = minIntervalMs - (Date.now() - lastStart);
        if (wait > 0) await delay(wait);
      }
      lastStart = Date.now();
      return fn();
    });

    // tail は成否を握りつぶして次タスクへ繋ぐ（エラー後も後続が詰まらない）。
    // 呼び出し元へは run 経由で reject をそのまま伝播する。
    tail = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  }

  return { enqueue };
}
