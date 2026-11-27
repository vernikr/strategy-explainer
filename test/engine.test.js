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

// 17. Регрессия: ручной пример. B = 101…105, A = 214, 216, 217, 218, 220.
// Средние: B̄ = 103, Ā = 217. Σ(x−x̄)² = 10, Σ(x−x̄)(y−ȳ) = 14 → k = 1,4; alpha = 217 − 1,4·103 = 72,8.
{
  const B = [101, 102, 103, 104, 105], Aa = [214, 216, 217, 218, 220];
  const f = E.ols(B, Aa);
  close(f.mx, 103); close(f.my, 217); close(f.sxx, 10); close(f.sxy, 14); close(f.syy, 20);
  close(f.k, 1.4); close(f.alpha, 72.8);
  close(f.rss, 0.4);                           // остатки −0,2; 0,4; 0; −0,4; 0,2 → квадраты 0,04+0,16+0+0,16+0,04
  close(f.se, Math.sqrt(0.4 / 3 / 10));        // √(0,4 ÷ (5−2) ÷ 10)
  close(f.r, 14 / Math.sqrt(200)); close(f.r2, 0.98);
  const res = B.map((x, i) => Aa[i] - f.alpha - f.k * x);
  close(res.reduce((q, v) => q + v, 0), 0);    // остатки в сумме дают ноль
  [-0.2, 0.4, 0, -0.4, 0.2].forEach((v, i) => close(res[i], v));
  // z-score на последний день: спред A − 1,4·B = 73,0; среднее окна = alpha = 72,8; σ = √(0,4 ÷ 5) = √0,08
  const h = E.hedgeStats(Aa, B, 5);
  close(h.k[4], 1.4); close(h.kUsed[4], 1.4); close(h.mean[4], 72.8); close(h.std[4], Math.sqrt(0.08));
  close(h.spread[4], 73); close(h.z[4], 0.2 / Math.sqrt(0.08));
  assert.strictEqual(h.z[3], null);
  // округление до целых контрактов: на lots контрактов A берём round(k·lots) контрактов B
  close(E.roundK(1.4, 0), 1.4); close(E.roundK(1.4, 1), 1); close(E.roundK(1.4, 2), 1.5); close(E.roundK(1.4, 5), 1.4); close(E.roundK(1.4, 10), 1.4);
  close(E.roundK(1.46, 10), 1.5);
  const hr = E.hedgeStats(Aa, B, 5, { lots: 1 });
  close(hr.kUsed[4], 1); close(hr.spread[4], 220 - 105);
  // B не меняется: регрессия невозможна, z нет
  const flat = E.hedgeStats(Aa, [100, 100, 100, 100, 100], 5);
  assert.strictEqual(flat.k[4], null); assert.strictEqual(flat.z[4], null);
}

// 18. Генератор: при beta = 1 данные те же, что раньше; beta плавно меняется; хедж «снимает» beta.
{
  const old = E.generate({ seed: 3 }), nw = E.generate({ seed: 3, beta: 1 });
  assert.deepStrictEqual(old.a, nw.a); assert.deepStrictEqual(old.spread, nw.spread);
  const dr = E.genHedge(3, E.HEDGE_SCENARIOS[2]);
  close(dr.beta[0], 1); close(dr.beta[80], 1); close(dr.beta[160], 1.4); close(dr.beta[240], 1.8); close(dr.beta[319], 1.8);
  // A − B при beta = 1,6 уходит намного дальше, чем спред с верным k
  const cs = E.genHedge(3, E.HEDGE_SCENARIOS[1]);
  const range = (x) => Math.max(...x) - Math.min(...x);
  assert.ok(range(cs.spread) > 3 * range(cs.a.map((v, i) => v - 1.6 * cs.b[i])), 'A−B должен уходить намного дальше');
  // хедж не зависит от beta: при beta = 1 и beta = 1,6 спред с пересчётом k почти один и тот же
  const h1 = E.hedgeStats(E.genHedge(3, E.HEDGE_SCENARIOS[0]).a, E.genHedge(3, E.HEDGE_SCENARIOS[0]).b, 30);
  const h2 = E.hedgeStats(cs.a, cs.b, 30);
  for (let t = 29; t < 320; t += 17) { close(h2.k[t] - h1.k[t], 0.6, 0.02); close(h1.z[t], h2.z[t], 0.02); }
  // k действительно следует за beta
  const hd = E.hedgeStats(dr.a, dr.b, 40);
  let err = 0, cnt = 0;
  for (let t = 39; t < 320; t++) { err += Math.abs(hd.k[t] - dr.beta[t]); cnt++; }
  assert.ok(err / cnt < 0.35, 'средняя ошибка k ' + err / cnt);
  close(hd.k[319], 1.8, 0.4);
}

// 19. Разбор дня совпадает с расчётом; нет заглядывания в будущее.
{
  const d = E.genHedge(4, E.HEDGE_SCENARIOS[2]);
  for (const lots of [0, 3]) {
    for (const n of [10, 30, 61]) {
      const h = E.hedgeStats(d.a, d.b, n, { lots });
      for (const t of [n - 1, 120, 319]) {
        const ex = E.explainHedge(d.a, d.b, n, t, { lots });
        close(ex.k, h.k[t]); close(ex.kUsed, h.kUsed[t]); close(ex.alpha, h.alpha[t]); close(ex.se, h.se[t]);
        close(ex.mean, h.mean[t]); close(ex.std, h.std[t]); close(ex.z, h.z[t]); close(ex.value, h.spread[t]);
        close(ex.rows.reduce((q, r) => q + r.dxy, 0), ex.sxy, 1e-6); close(ex.rows.reduce((q, r) => q + r.dxx, 0), ex.sxx, 1e-6);
        close(ex.rows.reduce((q, r) => q + r.res, 0), 0, 1e-6);
        close(ex.rows.reduce((q, r) => q + r.res2, 0), ex.rss, 1e-6);
        if (!lots) close(ex.mean, ex.alpha, 1e-6); // без округления среднее спреда равно alpha
      }
    }
  }
  const a2 = d.a.slice(), b2 = d.b.slice();
  for (let i = 151; i < 320; i++) { a2[i] += 40; b2[i] -= 25; }
  const h = E.hedgeStats(d.a, d.b, 25), g2 = E.hedgeStats(a2, b2, 25);
  for (let t = 0; t <= 150; t++) { assert.strictEqual(h.z[t], g2.z[t]); assert.strictEqual(h.k[t], g2.k[t]); }
}

// 20. Бэктест хеджа: P&L пересчитывается независимо по ногам с k на момент решения (он заморожен в сделке).
{
  for (const seed of [1, 2, 3, 4, 5]) {
    const d = E.genHedge(seed, E.HEDGE_SCENARIOS[2]);
    for (const delay of [0, 1]) {
      for (const lots of [0, 4]) {
        const res = E.backtestHedge(d.a, d.b, { delay, lots, maxHold: 15 });
        close(res.equity[res.equity.length - 1], res.metrics.total, 1e-6);
        assert.ok(res.trades.length > 3);
        res.trades.forEach((q) => {
          close(q.k, res.hedge.kUsed[q.signalIn], 1e-12);   // k взят в день решения, а не в день исполнения
          const legsPnl = q.dir * ((d.a[q.exitIdx] - d.a[q.entryIdx]) - q.k * (d.b[q.exitIdx] - d.b[q.entryIdx]));
          close(q.gross, legsPnl, 1e-9);
          close(q.net, q.dir * (q.exitS - q.entryS) - q.cost, 1e-9);
          if (lots) close(q.k * lots, Math.round(q.k * lots), 1e-9); // число контрактов B — целое
        });
      }
    }
  }
  // сценарий без заглядывания: тот же бэктест на обрезанных данных даёт те же первые сделки
  const d = E.genHedge(2, E.HEDGE_SCENARIOS[1]);
  const full = E.backtestHedge(d.a, d.b, { delay: 0 }), cut = E.backtestHedge(d.a.slice(0, 200), d.b.slice(0, 200), { delay: 0 });
  const done = (r) => r.trades.filter((q) => q.reason !== 'end' && q.exitIdx < 190);
  assert.deepStrictEqual(done(full).map((q) => [q.entryIdx, q.exitIdx, q.net]), done(cut).map((q) => [q.entryIdx, q.exitIdx, q.net]));
}

// 21. Старые стратегии не изменились после выделения simulate(): ручной пример из теста 1 даёт прежние сделки.
{
  const r2 = E.backtest(s, base);
  assert.strictEqual(r2.trades.length, 2); assert.strictEqual(r2.trades[0].k, null);
}

// 22. Сводка по хеджу (смотрим глазами).
for (const sc of E.HEDGE_SCENARIOS) {
  let pl = 0, hg = 0;
  [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42].forEach((sd) => {
    const d = E.genHedge(sd, sc);
    pl += E.backtest(d.spread, {}).metrics.total; hg += E.backtestHedge(d.a, d.b, {}).metrics.total;
  });
  console.log('хедж, сценарий «' + sc.name + '»: простой A−B ' + pl.toFixed(0) + ', с хеджем ' + hg.toFixed(0));
}

// 8. Сводка по учебным данным (смотрим глазами, что сделок достаточно).
for (const seed of [7, 11]) {
  const m = E.backtest(E.generate({ seed }).spread, {}).metrics;
  console.log('seed', seed, 'сделок', m.count, 'итог', m.total.toFixed(1), 'винрейт', (m.winRate * 100).toFixed(0) + '%', 'просадка', m.maxDD.toFixed(1));
}
const br = E.backtest(E.generate({ seed: 7, breakAt: 200 }).spread, {}).metrics;
console.log('со сломом связи: сделок', br.count, 'итог', br.total.toFixed(1), 'просадка', br.maxDD.toFixed(1));

// 23. Коинтеграция: ручной пример на 6 днях — все промежуточные числа точные!
// B = [104, 101, 103, 103, 102, 105], A = [260, 253, 254, 255, 254, 260].
// Шаг 1: B̄ = 103, Ā = 256, Σ(B−B̄)² = 10, Σ(B−B̄)(A−Ā) = 20 → k = 2, c = 50, остатки e = [2, 1, −2, −1, 0, 0].
// Шаг 2: вчера = [2, 1, −2, −1, 0] (среднее 0), шаг = [−1, −3, 1, 1, 0] (среднее −0,4),
// Σx² = 10, Σxy = −8 → b = −0,8, RSS = 4,8, se = √(4,8 ÷ 3 ÷ 10) = 0,4, τ = −0,8 ÷ 0,4 = −2,0.
{
  const B6 = [104, 101, 103, 103, 102, 105], A6 = [260, 253, 254, 255, 254, 260];
  const ct = E.cointTest(A6, B6);
  close(ct.k, 2); close(ct.alpha, 50); close(ct.seK, 0.5); close(ct.r2, 0.8);
  [2, 1, -2, -1, 0, 0].forEach((v, i) => close(ct.res[i], v));
  close(ct.mx, 0); close(ct.my, -0.4); close(ct.sxx, 10); close(ct.sxy, -8);
  close(ct.b, -0.8); close(ct.a, -0.4); close(ct.rss, 4.8); close(ct.se, 0.4);
  close(ct.tau, -2.0); close(ct.halfLife, Math.log(0.5) / Math.log(0.2));
  assert.strictEqual(ct.passed, false); // на 6 точках порог Энгла — Грейнджера около −4,02, τ = −2,0 не проходит
  // Если ряд не сжимается (b >= 0), полувозврат не определён (null)
  const up = E.dfTest([1, 2, 5, 9, 18]);
  assert.ok(up.b > 0 && up.tau > 0);
  assert.strictEqual(up.halfLife, null);
  assert.strictEqual(E.dfTest([1, 2, 4, 8, 16]).tau, null); // нулевые остатки → se = 0 → делить не на что
  // Критические пороги Энгла — Грейнджера строже (меньше) Дики — Фуллера, а на коротком окне строже, чем на длинном
  assert.ok(E.egCrit(100, 5) < E.dfCrit(100, 5));
  assert.ok(E.egCrit(50, 5) < E.egCrit(300, 5));
  assert.ok(E.egCrit(100, 1) < E.egCrit(100, 5) && E.egCrit(100, 5) < E.egCrit(100, 10));
}

// 24. Свойства теста на учебных сценариях и отсутствие заглядывания в будущее у rollingCoint / explainCoint.
{
  const seeds = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  const passTrue = seeds.filter((sd) => { const d = E.genCoint(sd, E.COINT_SCENARIOS[0]); return E.cointTest(d.a, d.b).passed; }).length;
  const passFake = seeds.filter((sd) => { const d = E.genCoint(sd, E.COINT_SCENARIOS[1]); return E.cointTest(d.a, d.b).passed; }).length;
  assert.strictEqual(passTrue, 11);
  assert.ok(passFake <= 2, 'ложных срабатываний не должно быть много: ' + passFake);

  const d = E.genCoint(7, E.COINT_SCENARIOS[2]);
  const rc = E.rollingCoint(d.a, d.b, 90);
  assert.strictEqual(rc.tau[88], null);
  for (const t of [89, 150, 319]) {
    const ex = E.explainCoint(d.a, d.b, 90, 30, t);
    close(ex.coint.tau, rc.tau[t]);
    close(ex.coint.b, rc.b[t]);
    assert.strictEqual(ex.ok, rc.ok[t]);
    assert.strictEqual(ex.steps.length, 89);
    close(ex.steps.reduce((q, r) => q + r.dxx, 0), ex.coint.sxx, 1e-6);
    close(ex.steps.reduce((q, r) => q + r.dxy, 0), ex.coint.sxy, 1e-6);
  }
  // проверка отсутствия заглядывания в будущее: испортим данные после 180-го дня
  const a2 = d.a.slice(), b2 = d.b.slice();
  for (let i = 181; i < a2.length; i++) { a2[i] += 90; b2[i] -= 50; }
  const rc2 = E.rollingCoint(a2, b2, 90);
  for (let t = 0; t <= 180; t++) assert.strictEqual(rc.tau[t], rc2.tau[t]);
}

// 25. backtestCoint: согласованность P&L, отсутствие заглядывания в будущее, блокировка входов на ложной паре.
{
  for (const mode of ['none', 'prescreen', 'rolling']) {
    for (const sd of [1, 3, 7]) {
      const d = E.genCoint(sd, E.COINT_SCENARIOS[0]);
      const res = E.backtestCoint(d.a, d.b, { filterMode: mode, cointWin: 90, delay: 1 });
      close(res.equity[res.equity.length - 1], res.metrics.total, 1e-6);
      res.trades.forEach((q) => {
        const legsPnl = q.dir * ((d.a[q.exitIdx] - d.a[q.entryIdx]) - q.k * (d.b[q.exitIdx] - d.b[q.entryIdx]));
        close(q.gross, legsPnl, 1e-9);
        if (mode !== 'none') assert.ok(q.signalIn >= 89);
      });
    }
  }
  // На обрезанных данных первые завершённые сделки у скользящего фильтра те же самые
  const d = E.genCoint(2, E.COINT_SCENARIOS[0]);
  const full = E.backtestCoint(d.a, d.b, { filterMode: 'rolling', cointWin: 80 });
  const cut = E.backtestCoint(d.a.slice(0, 220), d.b.slice(0, 220), { filterMode: 'rolling', cointWin: 80 });
  const done = (r) => r.trades.filter((q) => q.reason !== 'end' && q.exitIdx < 210);
  assert.deepStrictEqual(done(full).map((q) => [q.entryIdx, q.exitIdx, q.net]), done(cut).map((q) => [q.entryIdx, q.exitIdx, q.net]));

  // Корзина из 16 пар детерминирована
  const p1 = E.genCointPool(7), p2 = E.genCointPool(7);
  assert.strictEqual(p1.length, 16);
  assert.deepStrictEqual(p1[0].a, p2[0].a);
}

// 26. Сводка по коинтеграции (смотрим глазами).
for (const sc of E.COINT_SCENARIOS) {
  let no = 0, pr = 0, rl = 0;
  [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42].forEach((sd) => {
    const d = E.genCoint(sd, sc);
    no += E.backtestCoint(d.a, d.b, { filterMode: 'none', startAt: 100 }).metrics.total;
    pr += E.backtestCoint(d.a, d.b, { filterMode: 'prescreen', cointWin: 100 }).metrics.total;
    rl += E.backtestCoint(d.a, d.b, { filterMode: 'rolling', cointWin: 100, startAt: 100 }).metrics.total;
  });
  console.log('коинтеграция, «' + sc.name + '»: без фильтра ' + no.toFixed(0) + ', отбор ' + pr.toFixed(0) + ', скользящий ' + rl.toFixed(0));
}

// 27. Календарный спред: ручная проверка формулы стоимости переноса (carryFair).
// Спот = 1000, ставка r = 15%, хранение u = 5%, выгода владения y = 0%, разница сроков = 73 дня (ровно 0,2 года):
// 1000 × (0,15 + 0,05 − 0) × 0,2 = +40 пунктов (контанго). При дефиците y = 25% → −10 пунктов (бэквордация).
{
  close(E.carryFair(1000, 0.15, 0.05, 0, 73), 40);
  close(E.carryFair(1000, 0.15, 0.05, 0.25, 73), -10);
  close(E.carryFair(1000, 0.12, 0.03, 0.15, 90), 0);
}

// 28. Календарный спред: бесшовная склейка без заглядывания в будущее и точное совпадение P&L по сериям при ролле.
{
  const c = E.genCalScenario(7, E.CAL_SCENARIOS[0]);
  assert.strictEqual(c.raw.length, 320);
  // Внутри одной серии изменение stitched за день равно изменению raw; на переходе через день ролла — изменению новой серии (raw[t] − nextRaw[t−1])
  for (let t = 1; t < c.raw.length; t++) {
    const expectedStep = c.isRoll[t - 1] ? c.raw[t] - c.nextRaw[t - 1] : c.raw[t] - c.raw[t - 1];
    close(c.stitched[t] - c.stitched[t - 1], expectedStep, 1e-9);
    close(c.far[t] - c.near[t], c.raw[t], 1e-9);
  }
  // Для каждой сделки с роллом валовая прибыль равна сумме прибылей отдельных серий в legs!
  for (const mode of ['naive', 'close', 'roll']) {
    for (const seasonal of [false, true]) {
      const bt = E.backtestCalendar(c, { expiryMode: mode, seasonal, rollCost: 0.7 });
      close(bt.equity[bt.equity.length - 1], bt.metrics.total, 1e-6);
      bt.trades.forEach((tr) => {
        const legSum = tr.legs.reduce((s, lg) => s + tr.dir * (lg.rawOut - lg.rawIn), 0);
        close(tr.gross, legSum, 1e-6);
        close(tr.net, tr.gross - (bt.params.cost + tr.rolls * 0.7), 1e-6);
        if (mode === 'close') assert.strictEqual(tr.rolls, 0);
      });
    }
  }
  // explainCalendar совпадает с расчётом backtestCalendar и не заглядывает в будущее
  const btR = E.backtestCalendar(c, { expiryMode: 'roll', seasonal: true, n: 30 });
  for (const t of [29, 63, 128, 319]) {
    const ex = E.explainCalendar(c, 30, t, { expiryMode: 'roll', seasonal: true });
    close(ex.mean, btR.mean[t]); close(ex.std, btR.std[t]); close(ex.z, btR.z[t]);
  }
}

// 29. Сводка по календарному спреду (смотрим глазами).
for (const sc of E.CAL_SCENARIOS) {
  let nv = 0, cl = 0, rl = 0, rs = 0;
  [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42].forEach((sd) => {
    const c = E.genCalScenario(sd, sc);
    nv += E.backtestCalendar(c, { expiryMode: 'naive', seasonal: false }).metrics.total;
    cl += E.backtestCalendar(c, { expiryMode: 'close', seasonal: false }).metrics.total;
    rl += E.backtestCalendar(c, { expiryMode: 'roll', seasonal: false }).metrics.total;
    rs += E.backtestCalendar(c, { expiryMode: 'roll', seasonal: true }).metrics.total;
  });
  console.log('календарный, «' + sc.name + '»: наивная ' + nv.toFixed(0) + ', выход до эксп. ' + cl.toFixed(0) + ', ролл ' + rl.toFixed(0) + ', ролл+сезон ' + rs.toFixed(0));
}

// 30. Приёмы (#35): эквивалентность базе при выключенных флагах, ручные проверки лог-спреда, разворота, лесенки и фильтра σ.
{
  const g = E.generate({ seed: 21 });
  const baseBt = E.backtest(g.spread, { n: 30, entryZ: 2, exitZ: 0.5, stopZ: 3.5, cost: 0.5 });
  const tacBt = E.backtestTactics(g, { n: 30, entryZ: 2, exitZ: 0.5, stopZ: 3.5, cost: 0.5 });
  assert.strictEqual(tacBt.metrics.count, baseBt.metrics.count);
  close(tacBt.metrics.total, baseBt.metrics.total, 1e-9);
  for (let i = 0; i < g.spread.length; i++) close(tacBt.equity[i], baseBt.equity[i], 1e-9);

  // Лог-спред с выравниванием денежного объёма: при пропорциональном росте обеих цен на +50% прибыль = 0!
  const dScale = {
    a: [150, 150, 150, 150, 120, 225],
    b: [100, 100, 100, 100, 100, 150],
    spread: [50, 50, 50, 50, 20, 75]
  };
  const btNotional = E.backtestTactics(dScale, { n: 5, entryZ: 1.5, exitZ: 0.2, stopZ: 10, cost: 0, logMode: 'notional', notionalBase: 100 });
  assert.strictEqual(btNotional.trades.length, 1);
  // На входе A=120, B=100 (ln(1,2)); на выходе A=225 (+87,5%), B=150 (+50%) → чистый процентный возврат = 87,5% − 50% = +37,5 п.
  close(btNotional.trades[0].gross, 37.5, 1e-6);

  // Отсутствие заглядывания в будущее для всех 4 режимов
  const dFull = E.genTacticScenario(7, E.TACTIC_SCENARIOS[2]);
  const cut = 180;
  const dCut = { a: dFull.a.slice(0, cut), b: dFull.b.slice(0, cut), spread: dFull.spread.slice(0, cut) };
  for (const cfg of [
    { logMode: 'notional' },
    { reversal: true, reboundZ: 0.45 },
    { scaleIn: true, entryZ1: 1.65, addZ: 0.85, partialExit: true },
    { volFilter: true, volLong: 90, volRatioMax: 1.35 }
  ]) {
    const f1 = E.backtestTactics(dFull, cfg);
    const f2 = E.backtestTactics(dCut, cfg);
    for (let i = 0; i < cut - 1; i++) {
      assert.strictEqual(f1.pos[i], f2.pos[i]);
      close(f1.equity[i], f2.equity[i], 1e-9);
    }
  }
}

// 31. Сводка по 4 приёмам (смотрим глазами).
for (const sc of E.TACTIC_SCENARIOS) {
  let b = 0, lg = 0, rv = 0, sl = 0, vf = 0;
  [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42].forEach((sd) => {
    const d = E.genTacticScenario(sd, sc);
    b += E.backtestTactics(d, {}).metrics.total;
    lg += E.backtestTactics(d, { logMode: 'notional' }).metrics.total;
    rv += E.backtestTactics(d, { reversal: true, reboundZ: 0.45 }).metrics.total;
    sl += E.backtestTactics(d, { scaleIn: true, entryZ1: 1.65, addZ: 0.85, partialExit: true }).metrics.total;
    vf += E.backtestTactics(d, { volFilter: true, volLong: 100, volRatioMax: 1.35 }).metrics.total;
  });
  console.log('приёмы, «' + sc.name + '»: база ' + b.toFixed(0) + ', лог ' + lg.toFixed(0) + ', разворот ' + rv.toFixed(0) + ', лесенка ' + sl.toFixed(0) + ', фильтр_σ ' + vf.toFixed(0));
}

// 32. Межбиржевой и валютный спред (#40): паритет, тождество 3 ног и отсутствие заглядывания в будущее.
{
  // Золото: 2650 $/унц × 90 ₽/$ ÷ 31,1035 г/унц ≈ 7667,95 ₽/г
  close(E.fxParity(2650, 90, 31.1035), (2650 * 90) / 31.1035, 1e-9);
  close(E.fxParity(100, 92, 100), 92, 1e-9);

  const fxD = E.genFxScenario(7, E.FX_SCENARIOS[1]);
  for (const mode of ['noFx', 'stale', 'hedged']) {
    const bt = E.backtestFx(fxD, { fxMode: mode, cost: 0.6, fxCostMult: 1.35 });
    close(bt.equity[bt.equity.length - 1], bt.metrics.total, 1e-6);
    bt.trades.forEach((tr) => {
      close(tr.gross, tr.pnlDom + tr.pnlWorldRub + tr.pnlFxRub, 1e-9);
      if (mode !== 'noFx') {
        // Сумма трёх ног с точностью до копеечного округления паритета равна изменению синхронного спреда
        const exactSIn = tr.domIn - (tr.worldIn * tr.fxIn) / 100;
        const exactSOut = tr.domOut - (tr.worldOut * tr.fxOut) / 100;
        close(tr.gross, tr.dir * (exactSOut - exactSIn), 1e-9);
      } else {
        assert.strictEqual(tr.pnlFxRub, 0);
      }
    });
  }

  // Отсутствие заглядывания в будущее
  const cut = 175;
  const sub = {};
  ['pWorld', 'fx', 'parity', 'pDom', 'syncSpread', 'pWorldObs', 'obsSpread', 'isStale'].forEach((k) => { sub[k] = fxD[k].slice(0, cut); });
  for (const mode of ['noFx', 'stale', 'hedged']) {
    const b1 = E.backtestFx(fxD, { fxMode: mode });
    const b2 = E.backtestFx(sub, { fxMode: mode });
    for (let i = 0; i < cut - 1; i++) {
      assert.strictEqual(b1.pos[i], b2.pos[i]);
      close(b1.equity[i], b2.equity[i], 1e-9);
    }
  }
}

// 33. Сводка по межбиржевому и валютному спреду (смотрим глазами).
for (const sc of E.FX_SCENARIOS) {
  let nf = 0, st = 0, hg = 0;
  [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42].forEach((sd) => {
    const d = E.genFxScenario(sd, sc);
    nf += E.backtestFx(d, { fxMode: 'noFx' }).metrics.total;
    st += E.backtestFx(d, { fxMode: 'stale' }).metrics.total;
    hg += E.backtestFx(d, { fxMode: 'hedged' }).metrics.total;
  });
  console.log('межбиржевой FX, «' + sc.name + '»: 2 ноги без FX ' + nf.toFixed(0) + ', несинхр. ' + st.toFixed(0) + ', 3 ноги ' + hg.toFixed(0));
}

// 34. Корзины из 3+ инструментов (#43): множественная регрессия, лоты, пороги Маккиннона и отсутствие заглядывания в будущее.
{
  // Точное восстановление плоскости y = 5 + 2*x1 - 0.5*x2
  const x1 = [10, 12, 15, 11, 18, 20];
  const x2 = [8, 14, 10, 16, 12, 6];
  const y = x1.map((v, i) => 5 + 2 * v - 0.5 * x2[i]);
  const fit = E.olsMulti(y, [x1, x2]);
  close(fit.c, 5, 1e-6);
  close(fit.weights[0], 2, 1e-6);
  close(fit.weights[1], -0.5, 1e-6);
  close(fit.r2, 1, 1e-9);

  // Пороги Маккиннона ужесточаются с ростом числа ног
  assert(E.basketCrit(5, 80) < E.basketCrit(3, 80) && E.basketCrit(3, 80) < E.basketCrit(2, 80));

  // Подбор целых лотов для пропорции крэка 2/3 и 1/3 -> [3, 2, 1]
  const lots = E.roundBasketLots([2 / 3, 1 / 3], 6);
  assert.strictEqual(lots.qA, 3);
  assert.deepStrictEqual(lots.qs, [2, 1]);

  // Сверка счёта сделок и отсутствие заглядывания в будущее
  const bkD = E.genBasketScenario(7, E.BASKET_SCENARIOS[0]);
  const cut = 185;
  const sub = { a: bkD.a.slice(0, cut), b: bkD.b.slice(0, cut), c: bkD.c.slice(0, cut), trueSpread: bkD.trueSpread.slice(0, cut), extras: [] };
  for (const mode of ['pair', 'fixed', 'ols', 'ols_coint']) {
    const b1 = E.backtestBasket(bkD, { basketMode: mode });
    close(b1.equity[b1.equity.length - 1], b1.metrics.total, 1e-6);
    b1.trades.forEach((tr) => {
      close(tr.gross, tr.pnlA + tr.pnlB + tr.pnlC, 1e-9);
      close(tr.gross, tr.dir * (tr.exitS - tr.entryS), 1e-9);
    });
    const b2 = E.backtestBasket(sub, { basketMode: mode });
    for (let i = 0; i < cut - 1; i++) {
      assert.strictEqual(b1.pos[i], b2.pos[i]);
      close(b1.equity[i], b2.equity[i], 1e-9);
    }
  }
}

// 35. Сводка по корзинам из 3+ инструментов (смотрим глазами).
for (const sc of E.BASKET_SCENARIOS) {
  let pr = 0, fx = 0, ol = 0, oc = 0;
  [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42].forEach((sd) => {
    const d = E.genBasketScenario(sd, sc);
    pr += E.backtestBasket(d, { basketMode: 'pair' }).metrics.total;
    fx += E.backtestBasket(d, { basketMode: 'fixed' }).metrics.total;
    ol += E.backtestBasket(d, { basketMode: 'ols' }).metrics.total;
    oc += E.backtestBasket(d, { basketMode: 'ols_coint' }).metrics.total;
  });
  console.log('корзины 3+, «' + sc.name + '»: пара ' + pr.toFixed(0) + ', фикс ' + fx.toFixed(0) + ', OLS ' + ol.toFixed(0) + ', OLS+Маккиннон ' + oc.toFixed(0));
}

// 36. Микроструктура MOEX (#53): формула VM, выравнивание full/mini, 4 слоя издержек, RoM и честность симулятора.
{
  // USDRUBF: шаг R = 0.01, стоимость шага W = 10 ₽ -> рост с 90.20 до 91.45 даёт +1250 ₽ на 1 лот
  close(E.calcVM(90.20, 91.45, 0.01, 10, 1), 1250, 1e-9);
  // MIX против MXI (номиналы 300 000 ₽ и 30 000 ₽) -> 1 MIX : 10 MXI
  const mm = E.matchContractLots(300000, 30000, 5);
  assert.strictEqual(mm.qA, 1);
  assert.strictEqual(mm.qB, 10);
  close(mm.relErr, 0, 1e-12);

  // Нативный стакан в штиль дешевле ручного леггирования, а в стресс сравнивается с ним
  const cNat = E.decomposeCosts({ nativeBook: true, stressed: false });
  const cLeg = E.decomposeCosts({ nativeBook: false, stressed: false });
  assert(cNat.total < cLeg.total && cNat.usedNative === true);
  const cStr = E.decomposeCosts({ nativeBook: true, stressed: true });
  assert.strictEqual(cStr.usedNative, false);

  // RoM со скидкой 72% выше стрессового RoM
  const rom = E.calcRoM(25, 90, 0.72, 1.7, 0.15);
  assert(rom.calmGo < rom.stressGo && rom.romCalmPct > rom.romStressPct);

  // Проверка отсутствия заглядывания в будущее и точного баланса сделок
  const mxD = E.genMoexScenario(7, E.MOEX_SCENARIOS[3]);
  const cut = 180;
  const sub = { opts: mxD.opts };
  ['spPerp', 'spQuart', 'spRaw', 'lastRaw', 'fairBasis', 'cleanSpread', 'swapPaid', 'swapExtraDay', 'carryDays', 'isWeekend', 'isDivDay', 'divGapArr', 'inStress', 'reqGo'].forEach((k) => { sub[k] = mxD[k].slice(0, cut); });
  for (const mode of ['naive_last', 'raw_sp', 'clean_leg', 'moex_pro']) {
    const b1 = E.backtestMoex(mxD, { moexMode: mode });
    close(b1.equity[b1.equity.length - 1], b1.metrics.total, 1e-6);
    b1.trades.forEach((tr) => {
      close(tr.gross, tr.priceVm + tr.divComp + tr.swapFlow, 1e-9);
      close(tr.net, tr.gross - tr.cost, 1e-9);
    });
    const b2 = E.backtestMoex(sub, { moexMode: mode });
    for (let i = 0; i < cut - 1; i++) {
      assert.strictEqual(b1.pos[i], b2.pos[i]);
      close(b1.equity[i], b2.equity[i], 1e-9);
    }
  }
}

// 37. Сводка по микроструктуре MOEX (смотрим глазами).
for (const sc of E.MOEX_SCENARIOS) {
  let nl = 0, rs = 0, cl = 0, mp = 0, mc = 0;
  [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42].forEach((sd) => {
    const d = E.genMoexScenario(sd, sc);
    nl += E.backtestMoex(d, { moexMode: 'naive_last' }).metrics.total;
    rs += E.backtestMoex(d, { moexMode: 'raw_sp' }).metrics.total;
    const rcl = E.backtestMoex(d, { moexMode: 'clean_leg' });
    cl += rcl.metrics.total; mc += rcl.marginCalls;
    mp += E.backtestMoex(d, { moexMode: 'moex_pro' }).metrics.total;
  });
  console.log('MOEX, «' + sc.name + '»: ласт ' + nl.toFixed(0) + ', сырой SP ' + rs.toFixed(0) + ', чистый+легг ' + cl.toFixed(0) + ' (MC ' + mc + '), MOEX Pro ' + mp.toFixed(0));
}

// 38. Фильтр Калмана, TLS, Theil–Sen, KPSS, Хёрст, CUSUM и ERT (#56, #47).
{
  const dg = E.genDiagScenario(7, E.DIAG_SCENARIOS[1]);
  const ortXY = E.tls(dg.b, dg.a), ortYX = E.tls(dg.a, dg.b);
  close(ortXY.k * ortYX.k, 1.0, 1e-9);

  const cleanX = [10, 20, 30, 40, 50, 60, 70, 80];
  const cleanY = cleanX.map((v) => 5 + 1.5 * v);
  const dirtyY = cleanY.slice();
  dirtyY[7] += 250;
  close(E.theilSen(cleanX, dirtyY).k, 1.5, 1e-9);
  assert.ok(Math.abs(E.ols(cleanX, dirtyY).k - 1.5) > 0.4);

  const kfFull = E.kalmanHedge(dg.b, dg.a, { huberK: 2.1 });
  const kfCut = E.kalmanHedge(dg.b.slice(0, 150), dg.a.slice(0, 150), { huberK: 2.1 });
  for (let i = 0; i < 150; i++) {
    close(kfFull.priorBeta[i], kfCut.priorBeta[i], 1e-12);
    close(kfFull.innov[i], kfCut.innov[i], 1e-12);
  }

  const dgClean = E.genDiag({ seed: 11, n: 220, beta0: 1.2, beta1: 1.2, ouRho: 0.55, ouSd: 1.5, xNoise: 0.05 });
  const cleanRes = dgClean.a.map((v, i) => v - 12 - 1.2 * dgClean.b[i]);
  const rwSeries = [];
  let acc = 0;
  for (let i = 0; i < 220; i++) { acc += cleanRes[i] * 0.6; rwSeries.push(acc); }
  const smOu = E.stationarityMatrix(cleanRes);
  const smRw = E.stationarityMatrix(rwSeries);
  assert.strictEqual(smOu.verdict, 'confirmed');
  assert.ok(smOu.hurst < 0.45);
  assert.strictEqual(smRw.verdict, 'random_walk');
  assert.ok(smRw.hurst > 0.48);

  const hlDist = E.halfLifeDist(cleanRes, 50, 10);
  assert.ok(hlDist.values.length >= 15 && hlDist.p25 <= hlDist.median && hlDist.median <= hlDist.p75);

  const ertFast = E.calcERT(cleanRes, { sigmaMin: 0.8 });
  const ertTiny = E.calcERT(cleanRes.map((v) => v * 0.02), { sigmaMin: 0.8 });
  assert.ok(ertFast.valid && ertFast.ert < 8);
  assert.ok(!ertTiny.valid);
}

// 39. Каузальность backtestDiag и сводка 4 сценария × 11 историй (#56, #47).
{
  const dg = E.genDiagScenario(7, E.DIAG_SCENARIOS[2]);
  ['ols_plain', 'robust_tls', 'kalman_only', 'kalman_health'].forEach((md) => {
    const full = E.backtestDiag(dg, { diagMode: md });
    const cutDg = {
      a: dg.a.slice(0, 190), b: dg.b.slice(0, 190),
      aExec: dg.aExec.slice(0, 190), bExec: dg.bExec.slice(0, 190),
      trueBeta: dg.trueBeta.slice(0, 190), trueAlpha: dg.trueAlpha.slice(0, 190),
      isGlitch: dg.isGlitch.slice(0, 190), opts: dg.opts
    };
    const part = E.backtestDiag(cutDg, { diagMode: md });
    for (let i = 0; i < 189; i++) {
      assert.strictEqual(full.pos[i], part.pos[i]);
      close(full.z[i] || 0, part.z[i] || 0, 1e-9);
    }
  });

  const seeds = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  E.DIAG_SCENARIOS.forEach((sc) => {
    let tOls = 0, tRob = 0, tKal = 0, tPro = 0;
    seeds.forEach((sd) => {
      const d = E.genDiagScenario(sd, sc);
      tOls += E.backtestDiag(d, { diagMode: 'ols_plain' }).metrics.total;
      tRob += E.backtestDiag(d, { diagMode: 'robust_tls' }).metrics.total;
      tKal += E.backtestDiag(d, { diagMode: 'kalman_only' }).metrics.total;
      tPro += E.backtestDiag(d, { diagMode: 'kalman_health' }).metrics.total;
    });
    console.log('диагностика, «' + sc.name + '»: OLS ' + tOls.toFixed(0) + ', TLS/TS ' + tRob.toFixed(0) + ', Калман ' + tKal.toFixed(0) + ', Калман+Здоровье ' + tPro.toFixed(0));
  });
}

// 40. Модель OU, оптимальные границы Бертрама, волю-адаптивные полосы и carry-overlay (#59, #48).
{
  const bLow = E.bertramBands(0.18, 2.0, 0.20);
  const bMid = E.bertramBands(0.18, 2.0, 0.90);
  const bHigh = E.bertramBands(0.18, 2.0, 2.40);
  assert.ok(bLow.entryZ <= bMid.entryZ && bMid.entryZ <= bHigh.entryZ && bLow.entryZ < bHigh.entryZ);
  assert.ok(bLow.rate100d > bHigh.rate100d && bHigh.hystZ >= 0.35);

  const bd = E.genBand({ seed: 11, n: 260, phi: 0.80, sdCalm: 1.6, sdStorm: 1.6 });
  const ou = E.ouFit(bd.clean);
  assert.ok(ou.theta > 0.12 && ou.theta < 0.35 && ou.halfLife > 1.5 && ou.halfLife < 6.0);

  const ov = E.carryOverlayBands(1.5, 0.3, 0.38, 1.4, 6.0);
  assert.ok(ov.shortEntry < 1.5 && ov.longEntry > 1.5 && ov.blockLong);
  assert.strictEqual(ov.label, 'drift_against_long');
}

// 41. Каузальность backtestBands и сводка 4 сценария × 11 историй (#59, #48).
{
  const bd = E.genBandScenario(7, E.BAND_SCENARIOS[2]);
  ['no_hyst', 'fixed_2s', 'vol_adapt', 'ou_carry_pro'].forEach((md) => {
    const full = E.backtestBands(bd, { bandMode: md });
    const cutBd = {
      clean: bd.clean.slice(0, 185), raw: bd.raw.slice(0, 185),
      inStorm: bd.inStorm.slice(0, 185), opts: bd.opts
    };
    const part = E.backtestBands(cutBd, { bandMode: md });
    for (let i = 0; i < 184; i++) {
      assert.strictEqual(full.pos[i], part.pos[i]);
      close(full.upBand[i] || 0, part.upBand[i] || 0, 1e-9);
    }
  });

  const seeds = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  E.BAND_SCENARIOS.forEach((sc) => {
    let tNh = 0, tFx = 0, tVa = 0, tOu = 0;
    seeds.forEach((sd) => {
      const d = E.genBandScenario(sd, sc);
      tNh += E.backtestBands(d, { bandMode: 'no_hyst' }).metrics.total;
      tFx += E.backtestBands(d, { bandMode: 'fixed_2s' }).metrics.total;
      tVa += E.backtestBands(d, { bandMode: 'vol_adapt' }).metrics.total;
      tOu += E.backtestBands(d, { bandMode: 'ou_carry_pro' }).metrics.total;
    });
    console.log('полосы OU, «' + sc.name + '»: без гист. ' + tNh.toFixed(0) + ', 2σ ' + tFx.toFixed(0) + ', волю-адапт. ' + tVa.toFixed(0) + ', Бертрам+Carry ' + tOu.toFixed(0));
  });
}

// 42. Математика HMM-режимов (фильтр Гамильтона, энтропия неуверенности) и копул (хвостовая зависимость, dC/dv)
{
  // Проверка обратной нормальной функции и t-распределения
  for (const z of [-2.3, -1.1, 0, 0.85, 2.1]) {
    close(E.normInv(E.normCdf(z)), z, 1e-5);
  }
  close(E.t2Inv(0.5), 0, 1e-9);
  close(E.t3Cdf(0), 0.5, 1e-9);

  // Аналитическая производная dC(u,v)/dv = copulaH совпадает с разностной
  const u = 0.24, v = 0.43, eps = 1e-6;
  const cClay = (uu, vv, th) => Math.pow(Math.pow(uu, -th) + Math.pow(vv, -th) - 1, -1 / th);
  const cGumb = (uu, vv, th) => Math.exp(-Math.pow(Math.pow(-Math.log(uu), th) + Math.pow(-Math.log(vv), th), 1 / th));
  close(E.copulaH(u, v, 'clayton', 2.4), (cClay(u, v + eps, 2.4) - cClay(u, v - eps, 2.4)) / (2 * eps), 1e-7);
  close(E.copulaH(u, v, 'gumbel', 2.2), (cGumb(u, v + eps, 2.2) - cGumb(u, v - eps, 2.2)) / (2 * eps), 1e-7);

  // Хвостовая зависимость: у Гауссовой 0/0, у Клейтона нижний хвост > 0, у Гамбеля верхний > 0, у Стьюдента оба > 0
  const tdG = E.copulaTailDep('gaussian', 0.75);
  const tdC = E.copulaTailDep('clayton', 2.5);
  const tdGu = E.copulaTailDep('gumbel', 2.5);
  const tdSt = E.copulaTailDep('student', 0.75);
  assert.strictEqual(tdG.lower, 0);
  assert.strictEqual(tdG.upper, 0);
  assert(tdC.lower > 0.70 && tdC.upper === 0);
  assert(tdGu.upper > 0.65 && tdGu.lower === 0);
  assert(tdSt.lower > 0.50 && Math.abs(tdSt.lower - tdSt.upper) < 1e-9);

  // Энтропия и режимный гейт: максимальная неуверенность при [1/3, 1/3, 1/3] ставит паузу
  close(E.hmmEntropy([1 / 3, 1 / 3, 1 / 3]), 1.0, 1e-6);
  assert(E.hmmEntropy([0.90, 0.06, 0.04]) < 0.40);
  assert.strictEqual(E.regimeGate([0.34, 0.34, 0.32]).state, 'paused_uncertain');
  assert.strictEqual(E.regimeGate([0.34, 0.34, 0.32]).sizeMult, 0);
  assert.strictEqual(E.regimeGate([0.15, 0.20, 0.65]).state, 'blocked_break');
  assert.strictEqual(E.regimeGate([0.15, 0.20, 0.65]).forceExit, true);
  assert.strictEqual(E.regimeGate([0.82, 0.11, 0.07]).sizeMult, 1.0);
}

// 43. Отсутствие заглядывания в будущее и сравнение 4 схем × 11 историй в разделе «Режимы HMM и копулы»
{
  const rg = E.genRegimeScenario(7, E.REGIME_SCENARIOS[2]);
  ['naive_z', 'hmm_gate', 'copula_only', 'hmm_copula'].forEach((md) => {
    const full = E.backtestRegimeCopula(rg, { mode: md });
    const cutRg = {
      legA: rg.legA.slice(0, 190), legB: rg.legB.slice(0, 190),
      spread: rg.spread.slice(0, 190), execSpread: rg.execSpread.slice(0, 190),
      trueState: rg.trueState.slice(0, 190), opts: rg.opts
    };
    const part = E.backtestRegimeCopula(cutRg, { mode: md });
    for (let i = 0; i < 189; i++) {
      close(full.pos[i], part.pos[i], 1e-9);
      close(full.signalArr[i] || 0, part.signalArr[i] || 0, 1e-9);
    }
  });

  const seeds = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  const agg = {};
  E.REGIME_SCENARIOS.forEach((sc) => {
    let tNz = 0, tHm = 0, tCo = 0, tHc = 0;
    seeds.forEach((sd) => {
      const d = E.genRegimeScenario(sd, sc);
      const feat = E.prepareRegimeFeatures(d, 45);
      tNz += E.backtestRegimeCopula(d, { mode: 'naive_z', precomputed: feat }).metrics.total;
      tHm += E.backtestRegimeCopula(d, { mode: 'hmm_gate', precomputed: feat }).metrics.total;
      tCo += E.backtestRegimeCopula(d, { mode: 'copula_only', precomputed: feat }).metrics.total;
      tHc += E.backtestRegimeCopula(d, { mode: 'hmm_copula', precomputed: feat }).metrics.total;
    });
    agg[sc.id] = { tNz, tHm, tCo, tHc };
    console.log('режимы и копулы, «' + sc.name + '»: Z ' + tNz.toFixed(0) + ', HMM ' + tHm.toFixed(0) + ', копула ' + tCo.toFixed(0) + ', HMM+копула ' + tHc.toFixed(0));
  });
  assert(agg.quiet_break.tHm > 50 && agg.quiet_break.tNz < -300 && agg.quiet_break.tCo < -300);
  assert(agg.storm_grey.tHm > 0 && agg.storm_grey.tHc > 0 && agg.storm_grey.tNz < 0);
  assert(agg.clayton_tails.tHc > 30 && agg.clayton_tails.tHm < 10 && agg.clayton_tails.tCo < 0);
  assert(agg.short_sample_v3.tHm > agg.short_sample_v3.tHc && agg.short_sample_v3.tHm > agg.short_sample_v3.tCo);
}

// 44. Метрики честной валидации: PSR, DSR (плата за попытки и хвосты), CPCV (C(6,3)=20), PBO, стресс и гейт PASS
{
  assert.strictEqual(E.CPCV_SPLITS_6_3.length, 20);
  assert.strictEqual(E.expectedMaxSR(1, 0.6), 0);
  assert(E.expectedMaxSR(100, 0.6) > E.expectedMaxSR(10, 0.6));

  // DSR монотонно падает с ростом числа попыток N и при утяжелении эксцесса kurt
  const d1 = E.calcDSR(1.8, 360, 0, 3, 1, 0.55);
  const d20 = E.calcDSR(1.8, 360, 0, 3, 20, 0.55);
  const d300 = E.calcDSR(1.8, 360, 0, 3, 300, 0.55);
  const dFat = E.calcDSR(1.8, 360, -0.9, 9.0, 20, 0.55);
  assert(d1.dsr > 0.96 && d1.dsr > d20.dsr && d20.dsr > d300.dsr);
  assert(d20.dsr > dFat.dsr);

  // Проверка 6 условий промоушн-гейта PASS / BORDERLINE / REJECT (разд. 7.4)
  const gPass = E.evalPromotionGate({ dsr: 0.98, pbo: 0.18, plateau: 0.78, oosBlocksPos: 4, stress2022Pos: true, hasThesis: true, enoughData: true });
  assert.strictEqual(gPass.verdict, 'PASS');
  const gBord = E.evalPromotionGate({ dsr: 0.92, pbo: 0.52, plateau: 0.65, oosBlocksPos: 3, stress2022Pos: true, hasThesis: true, enoughData: true });
  assert.strictEqual(gBord.verdict, 'BORDERLINE');
  const gNoThesis = E.evalPromotionGate({ dsr: 0.99, pbo: 0.10, plateau: 0.85, oosBlocksPos: 5, stress2022Pos: true, hasThesis: false, enoughData: true });
  assert.strictEqual(gNoThesis.verdict, 'REJECT');
  const gDeepFail = E.evalPromotionGate({ dsr: 0.98, pbo: 0.70, plateau: 0.80, oosBlocksPos: 4, stress2022Pos: true, hasThesis: true, enoughData: true });
  assert.strictEqual(gDeepFail.verdict, 'REJECT');

  // Стресс издержек и блочный бутстрап
  const vdRob = E.genValidScenario(7, E.VALID_SCENARIOS[3]);
  const stCost = E.costStressTest(vdRob.spread.slice(0, 360), 35, 1.85, 0.30, 0.45);
  assert(stCost.breakEvenCost > 0.9 && stCost.survives2x);
  const runRob = E.quickSpreadRun(vdRob.spread.slice(0, 360), 35, 1.85, 0.30, 0.45);
  const boot = E.blockBootstrapCI(runRob.diffs.slice(35), { blockLen: 12, reps: 120, seed: 7 });
  assert(boot.hi90 > boot.medianSR && boot.medianSR > boot.lo90 && boot.probPos > 0.80);
}

// 45. Сравнение 4 подходов к отбору параметров на неприкосновенном Holdout (4 сценария × 11 историй)
{
  const seeds = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  const agg = {};
  E.VALID_SCENARIOS.forEach((sc) => {
    let tPk = 0, tLk = 0, tPl = 0, tAu = 0, rej = 0;
    seeds.forEach((sd) => {
      const vd = E.genValidScenario(sd, sc);
      const r = E.backtestValidApproaches(vd);
      if (r.gate.verdict === 'REJECT') rej++;
      tPk += r.holdout.naive_peak.total;
      tLk += r.holdout.leaky_wfo.total;
      tPl += r.holdout.plateau_wfo.total;
      tAu += r.holdout.full_audit.total;
    });
    agg[sc.id] = { tPk, tLk, tPl, tAu, rej };
    console.log('валидация holdout, «' + sc.name + '»: пик ' + tPk.toFixed(0) + ', без чистки ' + tLk.toFixed(0) + ', плато ' + tPl.toFixed(0) + ', полный аудит ' + tAu.toFixed(0) + ' (REJECT ' + rej + '/11)');
  });
  assert(agg.spurious_peak.tPl > 150 && agg.spurious_peak.tPk < -100);
  assert.strictEqual(agg.noise_mirage.rej, 11);
  assert.strictEqual(agg.noise_mirage.tAu, 0);
  assert(agg.noise_mirage.tPk < -200);
  assert(agg.leak_overlap.tPl > 150 && agg.leak_overlap.tLk < 0);
  assert(agg.robust_pass.tAu > 200 && agg.robust_pass.rej === 0);
}

// 46. Размер позиции (дробный Келли, vol-targeting, вместимость, целые лоты) и субмодулярность отбора книги (#51)
{
  const kc = E.kellyCurve({ srEst: 1.25, volAnn: 0.25, edgeHaircut: 0.72, tailKurt: 3.0, kClones: 1, rho: 0 });
  assert(Math.abs(kc.paperRetentionHalf - 0.75) < 1e-6);
  assert(kc.growthAtHalf > 0.25 && kc.growthAtFull < 0);
  const kcClones = E.kellyCurve({ srEst: 1.25, volAnn: 0.25, edgeHaircut: 0.72, tailKurt: 3.0, kClones: 4, rho: 0.85 });
  assert(kcClones.optMTrue <= kc.optMTrue && kcClones.growthAtFull < -2.0);

  const cap = E.capacityCurve({ grossEdgeRub: 960, fixedFeeRub: 180, impactCoeffRub: 410, depthLots: 24 });
  assert(cap.safeCapQ > 0 && cap.safeCapQ <= cap.optQ && cap.optQ < cap.maxViableQ);

  const ih = E.integerHedgeResiduals({ beta: 0.37, priceA: 32000, priceB: 32000, maxLotsA: 12 });
  assert(!ih.naive1to1.passesGate && ih.bestPair.passesGate && ih.bestPair.residualPct < 0.02);

  const szCalm = E.sizePosition({ capitalRub: 5000000, targetVolAnn: 0.06, spreadSigmaDayRub: 1400, depthLots: 40 });
  const szStorm = E.sizePosition({ capitalRub: 5000000, targetVolAnn: 0.06, spreadSigmaDayRub: 4200, depthLots: 40 });
  assert(szStorm.qFinal < szCalm.qFinal && szStorm.qFinal >= 1);

  // Строгая проверка свойства субмодулярности (убывающей отдачи): F(A ∪ {e}) − F(A) ≥ F(B ∪ {e}) − F(B) для A ⊆ B
  const univ = E.genBookUniverse(7, E.BOOK_SCENARIOS[0]);
  const sub = E.greedySubmodularSelect(univ.pairs, { t0: 0, t1: univ.splitIdx, maxK: 4 });
  const A = [0];
  const B = [0, 4, 6];
  for (let e = 0; e < 8; e++) {
    if (B.indexOf(e) !== -1) continue;
    const gainA = sub.evalSubmodularF(A.concat([e])) - sub.evalSubmodularF(A);
    const gainB = sub.evalSubmodularF(B.concat([e])) - sub.evalSubmodularF(B);
    assert(gainA >= gainB - 1e-9);
  }
  assert(sub.ratioToOpt >= sub.theoreticalBound && sub.greedyF > sub.soloTopF);
  // В жадной корзине из 4 пар не должно быть дублей с ρ ≥ 0.60, тогда как в наивном Топ-4 их 6 рёбер!
  const bmTop = E.bookMetrics(univ.pairs, sub.soloTopIds, null, { t0: 0, t1: univ.splitIdx });
  const bmSub = E.bookMetrics(univ.pairs, sub.selectedIds, null, { t0: 0, t1: univ.splitIdx });
  assert(bmTop.dupAlerts.length >= 4 && bmSub.dupAlerts.length === 0 && bmSub.effBets > bmTop.effBets * 1.8);
}

// 47. Сравнение 4 подходов к сборке и сайзингу книги (4 сценария × 11 историй)
{
  const seeds = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  const agg = {};
  E.BOOK_SCENARIOS.forEach((sc) => {
    let tNv = 0, tFk = 0, tVo = 0, tSb = 0, srNv = 0, srSb = 0, ddNv = 0, ddSb = 0;
    seeds.forEach((sd) => {
      const u = E.genBookUniverse(sd, sc);
      const r = E.backtestBookApproaches(u);
      tNv += r.approaches.naive_top.total;
      tFk += r.approaches.full_kelly_top.total;
      tVo += r.approaches.vol_only_top.total;
      tSb += r.approaches.submod_book.total;
      srNv += r.approaches.naive_top.srAnn / seeds.length;
      srSb += r.approaches.submod_book.srAnn / seeds.length;
      ddNv += r.approaches.naive_top.maxDD / seeds.length;
      ddSb += r.approaches.submod_book.maxDD / seeds.length;
    });
    agg[sc.id] = { tNv, tFk, tVo, tSb, srNv, srSb, ddNv, ddSb };
    console.log('книга спредов, «' + sc.name + '»: топ-4 фикс ' + tNv.toFixed(0) + ', полный Келли ' + tFk.toFixed(0) + ', топ-4+vol ' + tVo.toFixed(0) + ', субмод. книга ' + tSb.toFixed(0) + ' (SR ' + srSb.toFixed(2) + ')');
  });
  assert(agg.clone_shock.tSb > 2500 && agg.clone_shock.tNv < -5000 && agg.clone_shock.tVo < 0);
  assert(agg.vol_storm_kelly.tSb > 3000 && agg.vol_storm_kelly.tVo > 500 && agg.vol_storm_kelly.tFk < -10000);
  assert(agg.thin_capacity.tSb > agg.thin_capacity.tNv && agg.thin_capacity.tFk < -10000);
  assert(agg.balanced_year.srSb > agg.balanced_year.srNv + 1.2 && agg.balanced_year.ddSb < agg.balanced_year.ddNv * 0.65);
}

// 48. Осторожные ML-надстройки: тройной барьер, выживаемость P(T ≤ H), конформный интервал и предохранители RL (#52)
{
  const sp = [0, -2.0, -1.5, -0.8, 0.1, 0.5];
  const tbTake = E.tripleBarrierLabel(sp, 1, 1, { sigmaBar: 1.0, ptMult: 1.4, slMult: 1.5, maxHold: 4, cost: 0.2 });
  assert.strictEqual(tbTake.outcome, 'take');
  assert.strictEqual(tbTake.metaTarget, 1);

  // Правостороннее цензурирование на границе обучения maxKnownIdx (никакого подглядывания в тест!)
  const spSplit = [0, -2.2, -2.1, -2.0, 0.5, 0.8];
  const tbPurged = E.tripleBarrierLabel(spSplit, 1, 1, { sigmaBar: 1.0, ptMult: 1.4, slMult: 1.5, maxHold: 4, maxKnownIdx: 3 });
  assert.strictEqual(tbPurged.truncatedBySplit, true);
  assert.strictEqual(tbPurged.outcome, 'purged_right');

  // Кривая Каплана — Мейера P(T_conv ≤ H) монотонно не убывает по H
  const eps = [
    { holdBars: 4, converged: true }, { holdBars: 6, converged: true }, { holdBars: 9, converged: true },
    { holdBars: 14, converged: true }, { holdBars: 18, converged: false }, { holdBars: 12, converged: true }
  ];
  const km = E.kaplanMeierSurvival(eps, { maxH: 30, daysToExpiry: 5, minProbGate: 0.50 });
  assert(km.p5 <= km.p10 && km.p10 <= km.p20 && km.p20 <= km.p40);
  assert(!km.passesExpiryGate);

  // Конформное предсказание и downweighting за широкую неопределённость (§7.6)
  const cTight = E.conformalInterval([0.81, 0.84, 0.82, 0.85, 0.80, 0.83, 0.84, 0.82, 0.81], [0.82, 0.83, 0.81, 0.84, 0.82, 0.82, 0.83, 0.83, 0.82], 0.83, { alpha: 0.10 });
  const cWide  = E.conformalInterval([0.60, 0.96, 0.55, 0.92, 0.58, 0.95, 0.61, 0.94, 0.57], [0.85, 0.82, 0.84, 0.80, 0.85, 0.81, 0.84, 0.82, 0.83], 0.85, { alpha: 0.10 });
  assert(cTight.width < cWide.width && cTight.effectiveScore > cWide.effectiveScore);

  // 5 предохранителей research-only RL (§4.9)
  const rlBlocked = E.evalRlSafeguards({ beatsBenchmark: true, walkForwardClean: true, realisticCosts: false, leverageCapped: true, killSwitchArmed: true });
  const rlSandbox = E.evalRlSafeguards({ beatsBenchmark: true, walkForwardClean: true, realisticCosts: true, leverageCapped: true, killSwitchArmed: true });
  assert(!rlBlocked.allowedInSandbox && rlSandbox.allowedInSandbox && rlSandbox.neverProdEngine);
}

// 49. Сравнение 4 подходов (базовый Z, чёрный ящик, бесконтрольный RL, Meta+Survival) на 4 сценариях × 11 историях
{
  const seeds = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  const agg = {};
  E.ML_SCENARIOS.forEach((sc) => {
    let tBz = 0, tBb = 0, tRl = 0, tMs = 0, ddBz = 0, ddMs = 0;
    seeds.forEach((sd) => {
      const md = E.genMlScenario(sd, sc);
      const r = E.backtestMlApproaches(md);
      tBz += r.approaches.base_z.total;
      tBb += r.approaches.blackbox_ml.total;
      tRl += r.approaches.naive_rl.total;
      tMs += r.approaches.meta_survival.total;
      ddBz += r.approaches.base_z.maxDD / seeds.length;
      ddMs += r.approaches.meta_survival.maxDD / seeds.length;
    });
    agg[sc.id] = { tBz, tBb, tRl, tMs, ddBz, ddMs };
    console.log('ML-оверлеи, «' + sc.name + '»: база Z ' + tBz.toFixed(0) + ', чёрный ящик ' + tBb.toFixed(0) + ', наивный RL ' + tRl.toFixed(0) + ', Meta+Survival ' + tMs.toFixed(0));
  });
  assert(agg.noisy_traps.tMs > agg.noisy_traps.tBz + 40 && agg.noisy_traps.ddMs < agg.noisy_traps.ddBz * 0.65 && agg.noisy_traps.tBb < -200);
  assert(agg.expiry_crunch.tMs > 40 && agg.expiry_crunch.tBz < 0 && agg.expiry_crunch.tRl < -150);
  assert(agg.pure_noise_overfit.tMs > agg.pure_noise_overfit.tBb + 150 && agg.pure_noise_overfit.tMs > agg.pure_noise_overfit.tRl + 150);
  assert(agg.clean_reversion.tMs > 150 && agg.clean_reversion.tBb < 0);
}

// 50. Метрики риска/доходности (§5.8), 5 жёстких гейтов, композитный скор (§7.1–7.5) и pre-trade checklist (§8.5)
{
  const steady = [], cliff = [];
  for (let i = 0; i < 252; i++) {
    steady.push(i % 2 === 0 ? 0.22 : -0.06);
    cliff.push((i === 90 || i === 195) ? -4.8 : 0.12);
  }
  const mSteady = E.riskAdjustedMetrics(steady, 16);
  const mCliff = E.riskAdjustedMetrics(cliff, 16);
  assert(mSteady.srExcess < mSteady.srRaw);
  assert(mCliff.skew < -1.5 && mCliff.exKurt > 3.0);
  assert(mSteady.sortino > mCliff.sortino && mSteady.calmar > mCliff.calmar);

  const p17 = E.SCREENER_POOL_SAMPLE[0];
  const g17 = E.evalHardGates(p17);
  const cs17 = E.calcCompositeScore(p17.comp, [0.25, 0.25, 0.15, 0.20, 0.15]);
  assert(g17.passed && Math.abs(cs17.score - 0.8265) < 1e-6); // 0.8265 -> 0.83 при округлении до сотых (§7.5)

  const pThin = E.SCREENER_POOL_SAMPLE[4];
  assert(!E.evalHardGates(pThin).passed);

  const chkOk = E.evalPreTradeChecklist({ signalAgeMin: 10, ttlMin: 45, liveSlipRatio: 1.05 });
  const chkExpired = E.evalPreTradeChecklist({ signalAgeMin: 65, ttlMin: 45, liveSlipRatio: 1.05 });
  const chkDrift = E.evalPreTradeChecklist({ signalAgeMin: 10, ttlMin: 45, liveSlipRatio: 1.65 });
  assert(chkOk.canSend && !chkExpired.canSend && !chkDrift.canSend && chkDrift.driftWarn);
}

console.log('OK: все проверки пройдены');
