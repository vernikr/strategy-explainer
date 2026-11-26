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

// 8. Сводка по учебным данным (смотрим глазами, что сделок достаточно).
for (const seed of [7, 11]) {
  const m = E.backtest(E.generate({ seed }).spread, {}).metrics;
  console.log('seed', seed, 'сделок', m.count, 'итог', m.total.toFixed(1), 'винрейт', (m.winRate * 100).toFixed(0) + '%', 'просадка', m.maxDD.toFixed(1));
}
const br = E.backtest(E.generate({ seed: 7, breakAt: 200 }).spread, {}).metrics;
console.log('со сломом связи: сделок', br.count, 'итог', br.total.toFixed(1), 'просадка', br.maxDD.toFixed(1));
console.log('OK: все проверки пройдены');
