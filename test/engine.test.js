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

console.log('OK: все проверки пройдены');
