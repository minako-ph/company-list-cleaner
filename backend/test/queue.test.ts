import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSerialQueue } from '../src/queue.js';

describe('createSerialQueue', () => {
  describe('直列性', () => {
    it('並行 enqueue でも登録順に実行され、同時実行は常に 1 である', async () => {
      const queue = createSerialQueue(1000); // 間隔 1ms（本ケースは順序のみ検証）
      const order: number[] = [];
      let active = 0;
      let maxActive = 0;

      const makeTask = (id: number) => async (): Promise<number> => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        // マイクロタスクを跨いでも同時実行 1 を維持することを確認する。
        await Promise.resolve();
        order.push(id);
        active -= 1;
        return id;
      };

      const results = await Promise.all([
        queue.enqueue(makeTask(1)),
        queue.enqueue(makeTask(2)),
        queue.enqueue(makeTask(3)),
      ]);

      expect(order).toEqual([1, 2, 3]);
      expect(results).toEqual([1, 2, 3]);
      expect(maxActive).toBe(1);
    });
  });

  describe('レート制御（fake timers）', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('タスクの開始間隔が最低 1/RATE_RPS 秒空く', async () => {
      const queue = createSerialQueue(1); // 1 req/秒 = 最小間隔 1000ms
      const startTimes: number[] = [];

      const makeTask = () => (): void => {
        startTimes.push(Date.now());
      };

      const p1 = queue.enqueue(makeTask());
      const p2 = queue.enqueue(makeTask());
      const p3 = queue.enqueue(makeTask());

      // 全タイマーを進めつつ保留 Promise を解決させる。
      await vi.runAllTimersAsync();
      await Promise.all([p1, p2, p3]);

      expect(startTimes).toHaveLength(3);
      const first = startTimes[0];
      const second = startTimes[1];
      const third = startTimes[2];
      if (first === undefined || second === undefined || third === undefined) {
        throw new Error('start times missing');
      }
      expect(second - first).toBeGreaterThanOrEqual(1000);
      expect(third - second).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('エラー後の継続', () => {
    it('あるタスクが reject しても後続は実行され、reject は呼び出し元へ伝播する', async () => {
      const queue = createSerialQueue(1000);
      const executed: string[] = [];

      const failing = queue.enqueue(async (): Promise<never> => {
        executed.push('failing');
        throw new Error('boom');
      });
      const following = queue.enqueue(async (): Promise<string> => {
        executed.push('following');
        return 'ok';
      });

      await expect(failing).rejects.toThrow('boom');
      await expect(following).resolves.toBe('ok');
      expect(executed).toEqual(['failing', 'following']);
    });
  });

  describe('入力バリデーション', () => {
    it('ratePerSecond が 0 以下だと生成時に throw する（ゼロ除算の先回り防止）', () => {
      expect(() => createSerialQueue(0)).toThrow();
      expect(() => createSerialQueue(-1)).toThrow();
    });
  });
});
