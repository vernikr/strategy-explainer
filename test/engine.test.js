// Запуск: node test/engine.test.js
const assert = require('assert');
const E = require('../js/engine.js');
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// 1. Ручной пример: числа посчитаны на бумаге.
const s = [10, 10, 10, 10, 13, 11, 8, 12];
const base = { n: 3, entryZ: 1, exitZ: 0, stopZ: null, maxHold: 0, cost: 0, delay: 0 };
let r = E.backtest(s, base);
close(r.z[4], 2 / Math.sqrt(2));
close(r.z[5], (11 - 34 / 3) / Math.sqrt(14 / 9));
assert.strictEqual(r.trades.length, 2);
assert.deepStrictEqual([r.trades[0].dir, r.trades[0].entryIdx, r.trades[0].exitIdx, r.trades[0].net], [-1, 4, 5, 2]);
assert.deepStrictEqual([r.trades[1].dir, r.trades[1].entryIdx, r.trades[1].exitIdx, r.trades[1].net], [1, 6, 7, 4]);
close(r.equity[7], 6);

// 2. Исполнение на следующий день.
r = E.backtest(s, Object.assign({}, base, { delay: 1 }));
assert.deepStrictEqual([r.trades[0].entryIdx, r.trades[0].exitIdx, r.trades[0].net], [5, 6, 3]);
assert.strictEqual(r.trades[1].reason, 'end');

// 3. Издержки вычитаются из каждой сделки.
r = E.backtest(s, Object.assign({}, base, { cost: 0.5 }));
close(r.metrics.total, 5);

// 4. Окно считается по тем же числам, что показывает пошаговый разбор.
const g = E.generate({ seed: 3 });
const roll = E.rolling(g.spread, 20);
for (const t of [19, 100, 250, 319]) {
  const ex = E.explainBar(g.spread, 20, t);
  close(ex.mean, roll.mean[t]); close(ex.std, roll.std[t]); close(ex.z, roll.z[t]);
}
assert.strictEqual(roll.z[18], null);

// 5. Нет заглядывания в будущее: смена будущих данных не меняет прошлые z.
const t0 = 150;
const changed = g.spread.slice(); for (let i = t0 + 1; i < changed.length; i++) changed[i] += 50;
const roll2 = E.rolling(changed, 20);
for (let t = 0; t <= t0; t++) assert.strictEqual(roll.z[t], roll2.z[t]);

// 6. Детерминизм и согласованность итогов.
assert.deepStrictEqual(E.generate({ seed: 5 }).spread, E.generate({ seed: 5 }).spread);
for (const seed of [1, 2, 3, 4, 5]) {
  const d = E.generate({ seed });
  for (const delay of [0, 1]) {
    const res = E.backtest(d.spread, { delay, maxHold: 15 });
    close(res.equity[res.equity.length - 1], res.metrics.total, 1e-6);
    res.trades.forEach((x) => close(x.net, x.dir * (x.exitS - x.entryS) - x.cost, 1e-9));
  }
}

// 7. Нормальные вероятности хвостов.
close(E.tailTwoSided(1), 0.3173, 1e-3); close(E.tailTwoSided(2), 0.0455, 1e-3); close(E.tailTwoSided(3), 0.0027, 1e-3);

// 9. EWMA: ручной пример x = [10, 12, 14], N = 3 (alpha = 0,5, веса 1; 0,5; 0,25).
{
  const x = [10, 12, 14];
  const W = 1.75, m = 22.5 / W; // 14 + 0,5·12 + 0,25·10 = 22,5
  const v = (1 * (14 - m) ** 2 + 0.5 * (12 - m) ** 2 + 0.25 * (10 - m) ** 2) / W;
  const r = E.ewma(x, 3);
  close(E.alphaOf(3), 0.5); close(r.mean[2], m); close(r.std[2], Math.sqrt(v)); close(r.z[2], (14 - m) / Math.sqrt(v));
  assert.strictEqual(r.z[1], null);
  close(E.halfLife(3), 1); // при alpha = 0,5 вес падает вдвое за один день
  close(E.weightShare(3, 1), 0.5);
}

// 10. Рекурсия совпадает с прямой формулой по всей истории.
for (const n of [5, 20, 60]) {
  const r = E.ewma(g.spread, n);
  for (const t of [n - 1, n + 7, 150, 319]) {
    const ex = E.explainEwma(g.spread, n, t, 12);
    close(ex.mean, r.mean[t], 1e-8); close(ex.std, r.std[t], 1e-6); close(ex.z, r.z[t], 1e-6);
    // строки таблицы и блок «более ранние дни» вместе дают полные суммы
    const w = ex.rows.reduce((a, q) => a + q.w, 0) + ex.earlier.w;
    const wsq = ex.rows.reduce((a, q) => a + q.wsq, 0) + ex.earlier.wsq;
    close(w, ex.W, 1e-9); close(wsq, ex.Wsq, 1e-9);
    close(ex.rows.reduce((a, q) => a + q.share, 0) + ex.earlierShare, 1, 1e-9);
  }
}

// 11. EWMA не заглядывает в будущее и даёт согласованный бэктест.
{
  const a = E.ewma(g.spread, 20), b = E.ewma(changed, 20);
  for (let t = 0; t <= t0; t++) close(a.z[t], b.z[t], 1e-9);
  assert.strictEqual(a.z[18], null);
  for (const seed of [1, 2, 3, 4, 5]) {
    const d = E.generate({ seed });
    for (const delay of [0, 1]) {
      const res = E.backtest(d.spread, { mode: 'ewma', delay, maxHold: 15 });
      close(res.equity[res.equity.length - 1], res.metrics.total, 1e-6);
      res.trades.forEach((x) => close(x.net, x.dir * (x.exitS - x.entryS) - x.cost, 1e-9));
    }
  }
  // режим по умолчанию остаётся простым окном
  assert.deepStrictEqual(E.backtest(g.spread, {}).z, E.backtest(g.spread, { mode: 'sma' }).z);
  assert.notDeepStrictEqual(E.backtest(g.spread, { mode: 'ewma' }).z, E.backtest(g.spread, {}).z);
}

// 12. Когда всплеск покидает окно, σ окна падает скачком, а σ EWMA — плавно.
{
  const sp = g.spread.slice(); sp[100] += 40;
  const w = E.rolling(sp, 30).std, e = E.ewma(sp, 30).std;
  const dropW = w[129] - w[130], dropE = e[129] - e[130];
  assert.ok(dropW > 1 && dropE < dropW / 3, `окно ${dropW}, ewma ${dropE}`);
}

// 13. Сценарий выбросов детерминирован и меняет только малую долю дней.
{
  const a = E.spiky(g.spread, 5), b = E.spiky(g.spread, 5);
  assert.deepStrictEqual(a, b);
  const changed2 = a.filter((v, i) => v !== g.spread[i]).length;
  assert.ok(changed2 > 3 && changed2 < 30, 'изменено дней: ' + changed2);
  assert.deepStrictEqual(a.slice(0, 40), g.spread.slice(0, 40));
}

// 14. Робастный z: ручной пример [1, 2, 3, 4, 100], N = 5.
{
  const x = [1, 2, 3, 4, 100];
  const r = E.robust(x, 5);
  close(r.mean[4], 3);                    // медиана
  close(r.std[4], 1.4826 * 1);            // отклонения 2, 1, 0, 1, 97 → по порядку 0, 1, 1, 2, 97 → MAD = 1
  close(r.z[4], 97 / 1.4826);
  // обычные среднее и σ на тех же числах «обмануты» выбросом
  const cl = E.rolling(x, 5);
  close(cl.mean[4], 22);
  assert.ok(cl.z[4] < 2.1 && r.z[4] > 60, `классический z ${cl.z[4]}, робастный ${r.z[4]}`);
  close(E.median([4, 1, 3, 2]), 2.5);     // чётное число значений: среднее двух средних
  close(E.median([5]), 5);
}

// 15. Робастный z: пошаговый разбор совпадает с расчётом, нет заглядывания в будущее, бэктест согласован.
{
  for (const n of [5, 20, 31]) {
    const r = E.robust(g.spread, n);
    for (const t of [n - 1, 120, 319]) {
      const ex = E.explainRobust(g.spread, n, t);
      close(ex.median, r.mean[t]); close(ex.std, r.std[t]); close(ex.z, r.z[t]);
      assert.strictEqual(ex.sorted.length, n);
    }
  }
  const a = E.robust(g.spread, 20), b = E.robust(changed, 20);
  for (let t = 0; t <= t0; t++) close(a.z[t], b.z[t], 1e-12);
  assert.strictEqual(a.z[18], null);
  for (const seed of [1, 2, 3, 4, 5]) {
    const d = E.generate({ seed });
    for (const delay of [0, 1]) {
      const res = E.backtest(d.spread, { mode: 'robust', delay, maxHold: 15 });
      close(res.equity[res.equity.length - 1], res.metrics.total, 1e-6);
      res.trades.forEach((q) => close(q.net, q.dir * (q.exitS - q.entryS) - q.cost, 1e-9));
    }
  }
}

// 16. Один выброс почти не меняет робастную σ, а обычную раздувает.
{
  const clean = g.spread.slice(0, 200), spiked = clean.slice(); spiked[150] += 60;
  const c = E.robust(clean, 30), sp = E.robust(spiked, 30), c0 = E.rolling(clean, 30), s0 = E.rolling(spiked, 30);
  const robustJump = Math.max(...[150, 160, 170, 179].map((t) => Math.abs(sp.std[t] - c.std[t])));
  const plainJump = Math.max(...[150, 160, 170, 179].map((t) => s0.std[t] - c0.std[t]));
  assert.ok(plainJump > 4 * robustJump + 3, `обычная +${plainJump}, робастная +${robustJump}`);
}

// 8. Сводка по учебным данным (смотрим глазами, что сделок достаточно).
for (const seed of [7, 11]) {
  const m = E.backtest(E.generate({ seed }).spread, {}).metrics;
  console.log('seed', seed, 'сделок', m.count, 'итог', m.total.toFixed(1), 'винрейт', (m.winRate * 100).toFixed(0) + '%', 'просадка', m.maxDD.toFixed(1));
}
const br = E.backtest(E.generate({ seed: 7, breakAt: 200 }).spread, {}).metrics;
console.log('со сломом связи: сделок', br.count, 'итог', br.total.toFixed(1), 'просадка', br.maxDD.toFixed(1));
console.log('OK: все проверки пройдены');
