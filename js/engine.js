/* Расчётное ядро: учебные данные, z-score, симулятор сделок.
   Не зависит от интерфейса и проверяется скриптом test/engine.test.js в Node. */
(function (root) {
  'use strict';

  const round2 = (x) => Math.round(x * 100) / 100;

  // Детерминированный генератор: один и тот же seed всегда даёт одни и те же «рыночные» данные.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeGauss(rand) {
    let spare = null;
    return function () {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0;
      while (u === 0) u = rand();
      const v = rand();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    };
  }

  /* Два инструмента A и B движутся вместе (общий случайный дрейф «рынка»),
     а разница между ними колеблется вокруг среднего уровня и тянется к нему.
     breakAt: с этого дня связь «ломается» и спред уходит в сторону (режим рынка меняется). */
  function generate(opts) {
    const o = Object.assign(
      { seed: 7, n: 320, base: 1000, level: 60, reversion: 0.12, noise: 2.2, walkStep: 4, breakAt: null, breakDrift: 0.6 },
      opts || {}
    );
    const gauss = makeGauss(mulberry32(o.seed));
    const a = [], b = [], spread = [];
    let walk = o.base, dev = 0;
    for (let t = 0; t < o.n; t++) {
      walk += o.walkStep * gauss();
      dev += -o.reversion * dev + o.noise * gauss();
      const drift = o.breakAt !== null && t >= o.breakAt ? o.breakDrift * (t - o.breakAt) : 0;
      const pb = round2(walk);
      const pa = round2(walk + o.level + dev + drift);
      b.push(pb); a.push(pa); spread.push(round2(pa - pb));
    }
    return { a, b, spread, opts: o };
  }

  /* Скользящие среднее, стандартное отклонение (делим на N) и z-score.
     Окно из N последних значений включает текущий день и не содержит будущих данных. */
  function rolling(series, n) {
    const len = series.length;
    const mean = new Array(len).fill(null);
    const std = new Array(len).fill(null);
    const z = new Array(len).fill(null);
    for (let t = n - 1; t < len; t++) {
      let sum = 0;
      for (let k = t - n + 1; k <= t; k++) sum += series[k];
      const m = sum / n;
      let sq = 0;
      for (let k = t - n + 1; k <= t; k++) { const d = series[k] - m; sq += d * d; }
      const sd = Math.sqrt(sq / n);
      mean[t] = m;
      std[t] = sd;
      z[t] = sd > 1e-9 ? (series[t] - m) / sd : null;
    }
    return { mean, std, z };
  }

  /* Все промежуточные числа для одного дня: то, что показывает экран «Пошаговый разбор». */
  function explainBar(series, n, t) {
    if (t < n - 1) return null;
    const rows = [];
    let sum = 0;
    for (let k = t - n + 1; k <= t; k++) { rows.push({ idx: k, value: series[k] }); sum += series[k]; }
    const mean = sum / n;
    let sumSq = 0;
    rows.forEach((r) => { r.dev = r.value - mean; r.sq = r.dev * r.dev; sumSq += r.sq; });
    const variance = sumSq / n;
    const std = Math.sqrt(variance);
    return { rows, sum, mean, sumSq, variance, std, value: series[t], z: std > 1e-9 ? (series[t] - mean) / std : null };
  }

  function decide(pos, z, held, p) {
    if (z === null) return null;
    if (pos === 0) {
      if (z <= -p.entryZ) return { type: 'open', dir: 1, reason: 'entry' };
      if (z >= p.entryZ) return { type: 'open', dir: -1, reason: 'entry' };
      return null;
    }
    const stopHit = p.stopZ != null && ((pos === 1 && z <= -p.stopZ) || (pos === -1 && z >= p.stopZ));
    if (stopHit) return { type: 'close', reason: 'stop' };
    if ((pos === 1 && z >= -p.exitZ) || (pos === -1 && z <= p.exitZ)) return { type: 'close', reason: 'target' };
    if (p.maxHold > 0 && held >= p.maxHold) return { type: 'close', reason: 'time' };
    return null;
  }

  const DEFAULTS = { n: 30, entryZ: 2, exitZ: 0.5, stopZ: 3.5, maxHold: 0, cost: 0.5, delay: 0 };

  /* Позиция: +1 = «лонг спреда» (купили A, продали B), −1 = «шорт спреда» (продали A, купили B),
     0 = вне рынка. Результат сделки в пунктах = направление × (спред на выходе − спред на входе) − издержки. */
  function backtest(series, params) {
    const p = Object.assign({}, DEFAULTS, params || {});
    const len = series.length;
    const { mean, std, z } = rolling(series, p.n);
    const trades = [];
    const equity = new Array(len).fill(0);
    const pos = new Array(len).fill(0);
    const signal = new Array(len).fill(null);
    const executed = new Array(len).fill(null);
    let cur = 0, entry = null, realized = 0, pending = null;

    function apply(act, t, signalIdx) {
      if (act.type === 'open') {
        cur = act.dir;
        entry = { dir: act.dir, signalIdx, execIdx: t, s: series[t], z: z[signalIdx] };
        realized -= p.cost;
      } else {
        const gross = entry.dir * (series[t] - entry.s);
        trades.push({
          dir: entry.dir, signalIn: entry.signalIdx, entryIdx: entry.execIdx, exitIdx: t,
          signalOut: signalIdx, entryS: entry.s, exitS: series[t], entryZ: entry.z, exitZ: z[signalIdx],
          reason: act.reason, gross, cost: p.cost, net: gross - p.cost, bars: t - entry.execIdx
        });
        realized += gross;
        cur = 0; entry = null;
      }
      executed[t] = act;
    }

    for (let t = 0; t < len; t++) {
      if (pending) { apply(pending.act, t, pending.signalIdx); pending = null; }
      if (z[t] !== null) {
        const held = cur !== 0 ? t - entry.execIdx : 0;
        const act = decide(cur, z[t], held, p);
        if (act) {
          signal[t] = act;
          if (p.delay === 0) apply(act, t, t);
          else if (t < len - 1) pending = { act, signalIdx: t };
        }
      }
      pos[t] = cur;
      equity[t] = realized + (cur !== 0 ? cur * (series[t] - entry.s) : 0);
    }
    if (cur !== 0) {
      const last = len - 1;
      apply({ type: 'close', reason: 'end' }, last, last);
      pos[last] = 0;
      equity[last] = realized;
    }
    return { params: p, trades, equity, pos, signal, executed, mean, std, z, metrics: metrics(trades, equity, pos) };
  }

  function metrics(trades, equity, pos) {
    const count = trades.length;
    const wins = trades.filter((x) => x.net > 0).length;
    const total = trades.reduce((s, x) => s + x.net, 0);
    const gp = trades.filter((x) => x.net > 0).reduce((s, x) => s + x.net, 0);
    const gl = trades.filter((x) => x.net < 0).reduce((s, x) => s + x.net, 0);
    let peak = 0, maxDD = 0;
    equity.forEach((e) => { if (e > peak) peak = e; if (peak - e > maxDD) maxDD = peak - e; });
    const inMarket = pos.filter((x) => x !== 0).length;
    return {
      count, wins, total,
      winRate: count ? wins / count : null,
      avg: count ? total / count : null,
      avgBars: count ? trades.reduce((s, x) => s + x.bars, 0) / count : null,
      profitFactor: gl < 0 ? gp / -gl : null,
      maxDD,
      exposure: equity.length ? inMarket / equity.length : 0
    };
  }

  // Согласует параметры при переборе: стоп дальше входа, выход ближе к среднему, чем вход.
  function tune(base, n, e) {
    const p = Object.assign({}, base, { n, entryZ: e });
    if (p.stopZ != null && p.stopZ <= e) p.stopZ = e + 1;
    if (p.exitZ >= e) p.exitZ = Math.max(0, e - 0.5);
    return p;
  }

  // Суммарный результат для сетки «окно × порог входа» (карта чувствительности).
  function sweep(series, base, windows, entries) {
    return windows.map((n) => entries.map((e) => backtest(series, tune(base, n, e)).metrics.total));
  }

  // Приближение функции ошибок (Абрамовиц–Стиган 7.1.26), точность порядка 1e-7.
  function erf(x) {
    const s = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * ax);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
    return s * y;
  }
  // Вероятность того, что нормальная величина отклонится от среднего больше чем на k сигм (в любую сторону).
  const tailTwoSided = (k) => 1 - erf(k / Math.SQRT2);

  const api = { generate, rolling, explainBar, decide, backtest, sweep, tune, tailTwoSided, DEFAULTS, mulberry32, round2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
