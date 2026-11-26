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
      { seed: 7, n: 320, base: 1000, level: 60, reversion: 0.12, noise: 2.2, walkStep: 4, breakAt: null, breakDrift: 0.6, beta: 1, betaTo: null, betaStart: 0, betaEnd: null },
      opts || {}
    );
    // beta: во сколько раз инструмент A «размашистее» B при общем движении рынка (1 — одинаково).
    // Если задан betaTo, beta плавно меняется от beta до betaTo между днями betaStart и betaEnd.
    const betaAt = (t) => {
      if (o.betaTo === null) return o.beta;
      const e = o.betaEnd === null ? o.n - 1 : o.betaEnd;
      const f = Math.min(1, Math.max(0, (t - o.betaStart) / Math.max(1, e - o.betaStart)));
      return o.beta + (o.betaTo - o.beta) * f;
    };
    const gauss = makeGauss(mulberry32(o.seed));
    const a = [], b = [], spread = [], beta = [];
    let walk = o.base, dev = 0;
    for (let t = 0; t < o.n; t++) {
      walk += o.walkStep * gauss();
      dev += -o.reversion * dev + o.noise * gauss();
      const drift = o.breakAt !== null && t >= o.breakAt ? o.breakDrift * (t - o.breakAt) : 0;
      const bt = betaAt(t);
      const wa = bt === 1 ? walk : o.base + bt * (walk - o.base); // при beta = 1 числа те же, что и раньше
      const pb = round2(walk);
      const pa = round2(wa + o.level + dev + drift);
      b.push(pb); a.push(pa); spread.push(round2(pa - pb)); beta.push(bt);
    }
    return { a, b, spread, beta, opts: o };
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

  /* Экспоненциальное взвешивание. Скорость забывания задаётся «эквивалентной длиной» N:
     alpha = 2 / (N + 1). Вес дня, прошедшего k дней назад, равен (1 − alpha)^k (сегодня k = 0, вес 1).
     Среднее и разброс считаются как взвешенные по ВСЕЙ прошлой истории и делятся на сумму весов.
     Рекуррентная запись S_t = x_t + (1 − alpha) * S_(t−1) даёт те же числа без перебора истории. */
  const alphaOf = (n) => 2 / (n + 1);
  const halfLife = (n) => Math.log(0.5) / Math.log(1 - alphaOf(n));
  // Доля всего веса, которая приходится на k последних дней (для длинной истории).
  const weightShare = (n, k) => 1 - Math.pow(1 - alphaOf(n), k);

  function ewma(series, n) {
    const len = series.length;
    const q = 1 - alphaOf(n);
    const mean = new Array(len).fill(null);
    const std = new Array(len).fill(null);
    const z = new Array(len).fill(null);
    let W = 0, S1 = 0, S2 = 0;
    for (let t = 0; t < len; t++) {
      const x = series[t];
      W = 1 + q * W; S1 = x + q * S1; S2 = x * x + q * S2;
      if (t < n - 1) continue;
      const m = S1 / W;
      const sd = Math.sqrt(Math.max(0, S2 / W - m * m));
      mean[t] = m; std[t] = sd;
      z[t] = sd > 1e-9 ? (x - m) / sd : null;
    }
    return { mean, std, z };
  }

  // Прямая формула (медленная, по всей истории): для сверки с рекурсией и для пошагового разбора.
  function explainEwma(series, n, t, shown, force) {
    if (t < n - 1 && !force) return null;
    const alpha = alphaOf(n), q = 1 - alpha;
    let W = 0, Wx = 0;
    for (let k = 0; k <= t; k++) { const w = Math.pow(q, k); W += w; Wx += w * series[t - k]; }
    const mean = Wx / W;
    const rows = [];
    let Wsq = 0;
    const earlier = { count: 0, w: 0, wx: 0, wsq: 0 };
    for (let k = 0; k <= t; k++) {
      const idx = t - k, w = Math.pow(q, k), dev = series[idx] - mean, wsq = w * dev * dev;
      Wsq += wsq;
      if (k < shown) rows.push({ idx, k, value: series[idx], w, share: 0, wx: w * series[idx], dev, wsq });
      else { earlier.count++; earlier.w += w; earlier.wx += w * series[idx]; earlier.wsq += wsq; }
    }
    rows.forEach((r) => { r.share = r.w / W; });
    rows.reverse();
    const variance = Wsq / W, std = Math.sqrt(variance);
    return { alpha, halfLife: halfLife(n), rows, earlier, earlierShare: earlier.w / W, W, Wx, mean, Wsq, variance, std, value: series[t], z: std > 1e-9 ? (series[t] - mean) / std : null };
  }

  /* Робастный вариант: вместо среднего и σ берутся медиана и медианное абсолютное отклонение (MAD).
     MAD = медиана значений |x − медиана|. Чтобы MAD можно было читать как «сигму», его умножают на 1,4826:
     для нормального распределения это число делает MAD равным σ. */
  const MAD_SCALE = 1.4826;
  const median = (arr) => {
    const a = arr.slice().sort((x, y) => x - y), m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };

  function robust(series, n) {
    const len = series.length;
    const mean = new Array(len).fill(null);
    const std = new Array(len).fill(null);
    const z = new Array(len).fill(null);
    for (let t = n - 1; t < len; t++) {
      const win = series.slice(t - n + 1, t + 1);
      const med = median(win);
      const sd = MAD_SCALE * median(win.map((v) => Math.abs(v - med)));
      mean[t] = med; std[t] = sd;
      z[t] = sd > 1e-9 ? (series[t] - med) / sd : null;
    }
    return { mean, std, z };
  }

  // Все промежуточные числа робастного расчёта для одного дня (для пошагового разбора).
  function explainRobust(series, n, t) {
    if (t < n - 1) return null;
    const rows = [];
    for (let k = t - n + 1; k <= t; k++) rows.push({ idx: k, value: series[k] });
    const sorted = rows.map((r) => r.value).sort((a, b) => a - b);
    const med = median(sorted);
    rows.forEach((r) => { r.dev = r.value - med; r.abs = Math.abs(r.dev); });
    const absSorted = rows.map((r) => r.abs).sort((a, b) => a - b);
    const mad = median(absSorted);
    const std = MAD_SCALE * mad;
    return { rows, sorted, median: med, absSorted, mad, std, value: series[t], z: std > 1e-9 ? (series[t] - med) / std : null, even: n % 2 === 0 };
  }


  /* ---------- Динамический хедж ---------- */
  /* Линейная регрессия y = alpha + k·x методом наименьших квадратов.
     k = Σ(x − x̄)(y − ȳ) ÷ Σ(x − x̄)²  — «ковариация ÷ дисперсия» без деления на N;
     alpha = ȳ − k·x̄. Здесь y — цена A, x — цена B: k показывает, на сколько пунктов в среднем
     двигается A, когда B двигается на один пункт. Остатки (y − alpha − k·x) в сумме дают 0. */
  function ols(x, y) {
    const n = x.length;
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
    const mx = sx / n, my = sy / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    if (!(sxx > 1e-12)) return { n, mx, my, sxx, sxy, syy, k: null, alpha: null, rss: null, r: null, r2: null, se: null };
    const k = sxy / sxx, alpha = my - k * mx;
    let rss = 0;
    for (let i = 0; i < n; i++) { const e = y[i] - alpha - k * x[i]; rss += e * e; }
    const r = syy > 1e-12 ? sxy / Math.sqrt(sxx * syy) : null;
    // стандартная ошибка наклона: насколько «шатается» k из-за шума в окне (делим на N − 2: две величины, k и alpha, уже оценены)
    const se = n > 2 ? Math.sqrt(rss / (n - 2) / sxx) : null;
    return { n, mx, my, sxx, sxy, syy, k, alpha, rss, r, r2: r === null ? null : r * r, se };
  }

  /* Число контрактов B на lots контрактов A при целочисленном округлении; lots = 0 — округления нет. */
  const roundK = (k, lots) => (lots > 0 ? Math.round(k * lots) / lots : k);

  /* Спред A − k·B с ежедневным пересчётом k по окну из N последних дней (включая сегодня, без будущего).
     Дальше работает обычный z-score: берём спред, посчитанный с СЕГОДНЯШНИМ k по всем дням окна,
     и сравниваем сегодняшнее значение со средним и σ (делим на N) этого окна.
     Без округления среднее спреда равно alpha, а σ — корню из среднего квадрата остатков регрессии. */
  function hedgeStats(a, b, n, opts) {
    const lots = (opts && opts.lots) || 0, len = a.length;
    const mk = () => new Array(len).fill(null);
    const out = { k: mk(), kUsed: mk(), alpha: mk(), se: mk(), r: mk(), r2: mk(), mean: mk(), std: mk(), z: mk(), spread: mk() };
    for (let t = n - 1; t < len; t++) {
      const wa = a.slice(t - n + 1, t + 1), wb = b.slice(t - n + 1, t + 1);
      const f = ols(wb, wa);
      if (f.k === null) continue;
      const ku = roundK(f.k, lots);
      let sum = 0;
      for (let j = 0; j < n; j++) sum += wa[j] - ku * wb[j];
      const m = sum / n;
      let sq = 0;
      for (let j = 0; j < n; j++) { const d = wa[j] - ku * wb[j] - m; sq += d * d; }
      const sd = Math.sqrt(sq / n), st = a[t] - ku * b[t];
      out.k[t] = f.k; out.kUsed[t] = ku; out.alpha[t] = f.alpha; out.se[t] = f.se; out.r[t] = f.r; out.r2[t] = f.r2;
      out.mean[t] = m; out.std[t] = sd; out.spread[t] = st;
      out.z[t] = sd > 1e-9 ? (st - m) / sd : null;
    }
    return out;
  }

  // Все промежуточные числа одного дня для экрана «Пошаговый разбор».
  function explainHedge(a, b, n, t, opts) {
    if (t < n - 1) return null;
    const lots = (opts && opts.lots) || 0;
    const wa = a.slice(t - n + 1, t + 1), wb = b.slice(t - n + 1, t + 1);
    const f = ols(wb, wa);
    if (f.k === null) return null;
    const kUsed = roundK(f.k, lots);
    const rows = wa.map((y, j) => {
      const x = wb[j], dx = x - f.mx, dy = y - f.my, fit = f.alpha + f.k * x, res = y - fit;
      return { idx: t - n + 1 + j, x, y, dx, dy, dxx: dx * dx, dxy: dx * dy, fit, res, res2: res * res, spread: y - kUsed * x };
    });
    const mean = rows.reduce((q, r) => q + r.spread, 0) / n;
    const variance = rows.reduce((q, r) => q + (r.spread - mean) * (r.spread - mean), 0) / n;
    const std = Math.sqrt(variance), cur = rows[rows.length - 1].spread;
    return Object.assign({ rows, kUsed, lots, mean, variance, std, value: cur, z: std > 1e-9 ? (cur - mean) / std : null }, f);
  }

  /* Бэктест динамического хеджа: те же правила и издержки, что у остальных стратегий. */
  function backtestHedge(a, b, params) {
    const p = Object.assign({}, DEFAULTS, { lots: 0 }, params || {});
    const h = hedgeStats(a, b, p.n, { lots: p.lots });
    const res = simulate(h.spread, h, p, { a, b, k: h.kUsed });
    res.hedge = h;
    return res;
  }

  // Учебные сценарии «инструменты двигаются в разной степени». beta — во сколько раз A размашистее B.
  const HEDGE_SCENARIOS = [
    { id: 'one', name: 'Равные движения (β = 1)', opts: { beta: 1 }, note: 'A и B двигаются вместе один в один. Простой спред A − B уже «чистый»: коэффициент хеджирования, равный 1, здесь верен.' },
    { id: 'const', name: 'A размашистее в 1,6 раза', opts: { beta: 1.6 }, note: 'Когда рынок меняется на 10 пунктов, B меняется на 10, а A — на 16. Простой спред A − B получает «чужой» тренд, а верный коэффициент всё время 1,6.' },
    { id: 'drift', name: 'Связь меняется со временем', opts: { beta: 1, betaTo: 1.8, betaStart: 80, betaEnd: 240 }, note: 'С 80-го по 240-й день A становится всё размашистее: верный коэффициент плавно растёт с 1,0 до 1,8. Его надо отслеживать.' },
    { id: 'break', name: 'A размашистее + слом связи', opts: { beta: 1.6, breakAt: 200 }, note: 'Как второй сценарий, но с 200-го дня связь ломается: A устойчиво уходит от B и не возвращается.' }
  ];
  const genHedge = (seed, scn) => generate(Object.assign({ seed }, scn.opts));

  const stats = (series, n, mode) => (mode === 'ewma' ? ewma(series, n) : mode === 'robust' ? robust(series, n) : rolling(series, n));

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

  const DEFAULTS = { mode: 'sma', n: 30, entryZ: 2, exitZ: 0.5, stopZ: 3.5, maxHold: 0, cost: 0.5, delay: 0 };

  /* Позиция: +1 = «лонг спреда» (купили A, продали B), −1 = «шорт спреда» (продали A, купили B),
     0 = вне рынка. Результат сделки в пунктах = направление × (спред на выходе − спред на входе) − издержки. */
  function backtest(series, params) {
    const p = Object.assign({}, DEFAULTS, params || {});
    return simulate(series, stats(series, p.n, p.mode), p, null);
  }

  /* Ядро симулятора. legs === null: спред — готовый ряд series (A − B).
     legs = { a, b, k }: спред A − k·B, где k пересчитывается каждый день; но в сделке k ЗАМОРАЖИВАЕТСЯ
     на значении момента решения (число контрактов уже куплено и не меняется), поэтому результат
     сделки считается как (A на выходе − A на входе) − k × (B на выходе − B на входе). */
  function simulate(series, st, p, legs) {
    const len = series.length;
    const { mean, std, z } = st;
    const val = (t, k) => (legs ? legs.a[t] - k * legs.b[t] : series[t]);
    const trades = [];
    const equity = new Array(len).fill(0);
    const pos = new Array(len).fill(0);
    const signal = new Array(len).fill(null);
    const executed = new Array(len).fill(null);
    let cur = 0, entry = null, realized = 0, pending = null;

    function apply(act, t, signalIdx) {
      if (act.type === 'open') {
        cur = act.dir;
        const k = legs ? legs.k[signalIdx] : null;
        entry = { dir: act.dir, signalIdx, execIdx: t, k, s: val(t, k), z: z[signalIdx] };
        realized -= p.cost;
      } else {
        const exitS = val(t, entry.k);
        const gross = entry.dir * (exitS - entry.s);
        trades.push({
          dir: entry.dir, signalIn: entry.signalIdx, entryIdx: entry.execIdx, exitIdx: t,
          signalOut: signalIdx, entryS: entry.s, exitS, entryZ: entry.z, exitZ: z[signalIdx], k: entry.k,
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
      equity[t] = realized + (cur !== 0 ? cur * (val(t, entry.k) - entry.s) : 0);
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

  // Учебный сценарий «редкие выбросы»: детерминированно добавляет одиночные всплески в случайные дни.
  function spiky(series, seed, prob, lo, hi) {
    const r = mulberry32(seed * 7 + 1), d = series.slice();
    const p = prob === undefined ? 0.03 : prob, a = lo === undefined ? 25 : lo, b = hi === undefined ? 40 : hi;
    for (let i = 40; i < d.length; i++) if (r() < p) d[i] += (r() < 0.5 ? 1 : -1) * (a + r() * (b - a));
    return d;
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

  const api = { generate, ols, roundK, hedgeStats, explainHedge, backtestHedge, HEDGE_SCENARIOS, genHedge, rolling, ewma, robust, explainRobust, median, MAD_SCALE, explainEwma, alphaOf, halfLife, weightShare, explainBar, decide, backtest, sweep, tune, spiky, tailTwoSided, DEFAULTS, mulberry32, round2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
