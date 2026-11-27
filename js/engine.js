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
     alpha = ȳ − k·x̄ (в тексте учебника сдвиг назван c, чтобы не путать с α из EWMA). Здесь y — цена A, x — цена B: k показывает, на сколько пунктов в среднем
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

  /* ---------- Коинтеграция и проверка стационарности ---------- */
  /* Критические значения МакКиннона (2010) с поправкой на длину выборки T:
     dfCrit — для одного ряда со свободным членом (тест Дики — Фуллера),
     egCrit — для остатков регрессии двух рядов A и B (двухшаговый тест Энгла — Грейнджера).
     Пороги отрицательные: чем левее (меньше) τ, тем увереннее отвергается случайное блуждание. */
  function dfCrit(n, level) {
    const T = Math.max(10, n || 100);
    if (level === 1) return -3.43035 - 6.5393 / T - 16.786 / (T * T);
    if (level === 10) return -2.56677 - 1.5384 / T - 2.809 / (T * T);
    return -2.86154 - 2.8903 / T - 4.234 / (T * T);
  }
  function egCrit(n, level) {
    const T = Math.max(10, n || 100);
    if (level === 1) return -3.89644 - 10.9519 / T - 22.527 / (T * T);
    if (level === 10) return -3.04445 - 4.2412 / T - 2.718 / (T * T);
    return -3.33613 - 6.1101 / T - 6.823 / (T * T);
  }

  /* Простой тест Дики — Фуллера: оцениваем регрессию Δe_t = a + b·e_{t−1}.
     Если работает «резинка», то после ухода вверх (e_{t−1} > 0) шаг чаще вниз (Δe_t < 0), то есть b < 0.
     Статистика τ = b ÷ se(b) показывает, во сколько раз отрицательный наклон больше своей погрешности.
     Период полувозврата T½ = ln(0,5) ÷ ln(1 + b): за сколько дней отклонение сжимается вдвое. */
  function dfTest(series) {
    const n = series.length, m = Math.max(0, n - 1);
    if (n < 4) return { m, a: null, b: null, se: null, tau: null, halfLife: null, rss: null, sxx: null, sxy: null, mx: null, my: null };
    const prev = [], step = [];
    for (let i = 1; i < n; i++) { prev.push(series[i - 1]); step.push(series[i] - series[i - 1]); }
    const f = ols(prev, step);
    if (f.k === null) return { m, a: null, b: null, se: null, tau: null, halfLife: null, rss: null, sxx: f.sxx, sxy: f.sxy, mx: f.mx, my: f.my };
    const tau = f.se !== null && f.se > 1e-12 ? f.k / f.se : null;
    const halfLife = f.k >= -1e-9 ? null : (1 + f.k <= 1e-6 ? 0 : Math.log(0.5) / Math.log(1 + f.k));
    return { m, a: f.alpha, b: f.k, se: f.se, tau, halfLife, rss: f.rss, sxx: f.sxx, sxy: f.sxy, mx: f.mx, my: f.my };
  }

  /* Двухшаговый тест Энгла — Грейнджера для пары (A, B):
     1) проводим прямую A ≈ c + k·B и берём остатки e_t = A_t − c − k·B_t;
     2) проверяем остатки тестом Дики — Фуллера и сравниваем τ со строгим порогом egCrit. */
  function cointTest(a, b) {
    const n = a.length, reg = ols(b, a);
    let retR = null;
    if (n > 2) {
      const da = [], db = [];
      for (let i = 1; i < n; i++) { da.push(a[i] - a[i - 1]); db.push(b[i] - b[i - 1]); }
      retR = ols(db, da).r;
    }
    const crit1 = egCrit(n, 1), crit5 = egCrit(n, 5), crit10 = egCrit(n, 10);
    if (reg.k === null) return { n, k: null, alpha: null, seK: null, r: null, r2: null, retR, res: null, a: null, b: null, se: null, tau: null, halfLife: null, rss: null, sxx: null, sxy: null, mx: null, my: null, m: Math.max(0, n - 1), crit1, crit5, crit10, passed: false };
    const res = a.map((y, i) => y - reg.alpha - reg.k * b[i]);
    const df = dfTest(res);
    return {
      n, k: reg.k, alpha: reg.alpha, seK: reg.se, r: reg.r, r2: reg.r2, retR, res,
      a: df.a, b: df.b, se: df.se, tau: df.tau, halfLife: df.halfLife,
      rss: df.rss, sxx: df.sxx, sxy: df.sxy, mx: df.mx, my: df.my, m: df.m,
      crit1, crit5, crit10, passed: df.tau !== null && df.tau <= crit5
    };
  }

  /* Скользящая проверка коинтеграции по последним m дням (строго по прошлому, без заглядывания в будущее). */
  function rollingCoint(a, b, m, opts) {
    const len = a.length, o = opts || {};
    const crit = o.tauMax != null ? o.tauMax : egCrit(m, 5);
    const maxHL = o.maxHalfLife || 0;
    const mk = () => new Array(len).fill(null);
    const out = { m, crit, maxHalfLife: maxHL, tau: mk(), b: mk(), se: mk(), halfLife: mk(), k: mk(), r2: mk(), ok: new Array(len).fill(false) };
    for (let t = m - 1; t < len; t++) {
      const c = cointTest(a.slice(t - m + 1, t + 1), b.slice(t - m + 1, t + 1));
      out.tau[t] = c.tau; out.b[t] = c.b; out.se[t] = c.se; out.halfLife[t] = c.halfLife; out.k[t] = c.k; out.r2[t] = c.r2;
      out.ok[t] = c.tau !== null && c.tau <= crit && (!maxHL || (c.halfLife !== null && c.halfLife <= maxHL));
    }
    return out;
  }

  /* Все промежуточные числа для пошагового разбора дня со светофором коинтеграции. */
  function explainCoint(a, b, m, n, t, opts) {
    const need = Math.max(m, n || 0);
    if (t < need - 1) return null;
    const o = opts || {};
    const ct = cointTest(a.slice(t - m + 1, t + 1), b.slice(t - m + 1, t + 1));
    if (ct.k === null) return null;
    const steps = [];
    for (let j = 1; j < m; j++) {
      const prev = ct.res[j - 1], cur = ct.res[j], step = cur - prev;
      const dx = prev - ct.mx, dy = step - ct.my;
      const fit = ct.a !== null ? ct.a + ct.b * prev : null;
      steps.push({ idx: t - m + 1 + j, prev, cur, step, dx, dy, dxx: dx * dx, dxy: dx * dy, fit, err: fit === null ? null : step - fit });
    }
    const crit = o.tauMax != null ? o.tauMax : ct.crit5;
    const maxHL = o.maxHalfLife || 0;
    const ok = ct.tau !== null && ct.tau <= crit && (!maxHL || (ct.halfLife !== null && ct.halfLife <= maxHL));
    const hedge = n > 0 ? explainHedge(a, b, n, t, o) : null;
    return { coint: ct, steps, crit, maxHalfLife: maxHL, ok, hedge };
  }

  /* Генератор пар для раздела «Коинтеграция»: позволяет включать/выключать «поводок» (reversion),
     делать ряды полностью независимыми блужданиями (independent) или рвать связь с заданного дня (unleashAt). */
  function genPair(opts) {
    const o = Object.assign(
      { seed: 7, n: 320, base: 1000, level: 60, beta: 1.6, reversion: 0.20, noise: 2.2, walkStep: 4, independent: false, unleashAt: null, breakDrift: 0 },
      opts || {}
    );
    const gauss = makeGauss(mulberry32(o.seed));
    const a = [], b = [], spread = [], beta = [];
    let wb = o.base, wa = o.base, dev = 0;
    for (let t = 0; t < o.n; t++) {
      wb += o.walkStep * gauss();
      if (o.independent) {
        wa += o.walkStep * o.beta * gauss();
        const pb = round2(wb), pa = round2(wa + o.level);
        b.push(pb); a.push(pa); spread.push(round2(pa - pb)); beta.push(0);
      } else {
        const rev = o.unleashAt !== null && t >= o.unleashAt ? 0 : o.reversion;
        const drift = o.unleashAt !== null && t >= o.unleashAt ? o.breakDrift : 0;
        dev += -rev * dev + drift + o.noise * gauss();
        const pb = round2(wb), pa = round2(o.base + o.beta * (wb - o.base) + o.level + dev);
        b.push(pb); a.push(pa); spread.push(round2(pa - pb)); beta.push(o.beta);
      }
    }
    return { a, b, spread, beta, opts: o };
  }

  const COINT_SCENARIOS = [
    { id: 'true', name: 'Устойчивая связь («поводок» есть)', opts: { beta: 1.6, reversion: 0.20, noise: 2.2 }, note: 'A и B ходят за общим рынком (β = 1,6), а отклонение между ними каждый день притягивается обратно на 20% (полувозврат около 3 дней).' },
    { id: 'unleashed', name: 'Синхронные шаги без поводка', opts: { beta: 1.6, reversion: 0, noise: 3.2 }, note: 'Каждый день A и B шагают в одну сторону (высокая корреляция и высокий R² цен!), но «резинки» между ними нет: разойдясь, они не обязаны сходиться.' },
    { id: 'break', name: 'Поводок рвётся на 150-м дне', opts: { beta: 1.6, reversion: 0.20, unleashAt: 150, breakDrift: 0.45 }, note: 'Первые 150 дней пара по-настоящему коинтегрирована, а затем связь исчезает и разница начинает уплывать.' },
    { id: 'slow', name: 'Медленная («вялая») резинка', opts: { beta: 1.6, reversion: 0.045, noise: 2.2 }, note: 'Возврат к среднему есть, но слабый (полувозврат около 15 дней): на коротком окне его трудно отличить от случайного блуждания.' }
  ];
  const genCoint = (seed, scn) => genPair(Object.assign({ seed }, scn.opts));

  /* Учебная «корзина рынка» из 16 пар-кандидатов для экрана отбора пар:
     часть пар действительно связана, часть лишь притворяется похожей. */
  const COINT_POOL_SPECS = [
    { name: 'Нефть сорт А / сорт Б', kind: 'true', kindLabel: 'настоящая связь', opts: { beta: 1.3, reversion: 0.24, noise: 2.0 } },
    { name: 'Банк обыкн. / преф.', kind: 'true', kindLabel: 'настоящая связь', opts: { beta: 1.15, reversion: 0.22, noise: 1.9 } },
    { name: 'Металл А / Металл Б', kind: 'true', kindLabel: 'настоящая связь', opts: { beta: 1.6, reversion: 0.19, noise: 2.3 } },
    { name: 'Индекс 1 / Индекс 2', kind: 'true', kindLabel: 'настоящая связь', opts: { beta: 1.45, reversion: 0.17, noise: 2.1 } },
    { name: 'Сырьё и переработка', kind: 'slow', kindLabel: 'медленная резинка', opts: { beta: 1.5, reversion: 0.05, noise: 2.2 } },
    { name: 'Два экспортёра', kind: 'slow', kindLabel: 'медленная резинка', opts: { beta: 1.25, reversion: 0.04, noise: 2.1 } },
    { name: 'Старая связка № 1', kind: 'break', kindLabel: 'слом после отбора', opts: { beta: 1.5, reversion: 0.22, unleashAt: 155, breakDrift: 0.45 } },
    { name: 'Старая связка № 2', kind: 'break', kindLabel: 'слом после отбора', opts: { beta: 1.35, reversion: 0.20, unleashAt: 165, breakDrift: -0.40 } },
    { name: 'Один сектор без поводка № 1', kind: 'unleashed', kindLabel: 'шаги вместе, поводка нет', opts: { beta: 1.5, reversion: 0, noise: 2.8 } },
    { name: 'Один сектор без поводка № 2', kind: 'unleashed', kindLabel: 'шаги вместе, поводка нет', opts: { beta: 1.2, reversion: 0, noise: 2.6 } },
    { name: 'Один сектор без поводка № 3', kind: 'unleashed', kindLabel: 'шаги вместе, поводка нет', opts: { beta: 1.7, reversion: 0, noise: 3.0 } },
    { name: 'Один сектор без поводка № 4', kind: 'unleashed', kindLabel: 'шаги вместе, поводка нет', opts: { beta: 1.0, reversion: 0, noise: 2.5 } },
    { name: 'Чужие активы № 1', kind: 'indep', kindLabel: 'случайная пара', opts: { beta: 1.2, independent: true } },
    { name: 'Чужие активы № 2', kind: 'indep', kindLabel: 'случайная пара', opts: { beta: 1.4, independent: true } },
    { name: 'Чужие активы № 3', kind: 'indep', kindLabel: 'случайная пара', opts: { beta: 1.0, independent: true } },
    { name: 'Чужие активы № 4', kind: 'indep', kindLabel: 'случайная пара', opts: { beta: 1.5, independent: true } }
  ];
  function genCointPool(baseSeed) {
    const s0 = baseSeed || 7;
    return COINT_POOL_SPECS.map((sp, i) => {
      const d = genPair(Object.assign({ seed: s0 * 31 + i * 17 + 3, n: 320 }, sp.opts));
      return Object.assign({ id: i, name: sp.name, kind: sp.kind, kindLabel: sp.kindLabel }, d);
    });
  }

  /* Бэктест с проверкой коинтеграции:
     filterMode = 'none'      — обычный динамический хедж (без проверки связи);
     filterMode = 'prescreen' — проверяем связь один раз на первых cointWin днях; если тест не пройден, пару не торгуем;
     filterMode = 'rolling'   — проверяем связь по скользящему окну cointWin и разрешаем НОВЫЕ входы только при «зелёном свете».
     Выходы (цель, стоп, время) работают всегда, чтобы открытая сделка не «застревала». */
  function backtestCoint(a, b, params) {
    const p = Object.assign({}, DEFAULTS, { lots: 0, cointWin: 100, filterMode: 'rolling', tauMax: null, maxHalfLife: 0, startAt: 0 }, params || {});
    const crit = p.tauMax != null ? p.tauMax : egCrit(p.cointWin, 5);
    const h = hedgeStats(a, b, p.n, { lots: p.lots });
    let coint = null, prescreen = null, allowOpen = null;
    let startAt = p.startAt || 0;
    if (p.filterMode === 'prescreen') {
      const m = Math.min(a.length, p.cointWin);
      prescreen = cointTest(a.slice(0, m), b.slice(0, m));
      const ok = prescreen.tau !== null && prescreen.tau <= crit && (!p.maxHalfLife || (prescreen.halfLife !== null && prescreen.halfLife <= p.maxHalfLife));
      prescreen.filterOk = ok;
      prescreen.critUsed = crit;
      startAt = Math.max(startAt, m);
      allowOpen = a.map((_, i) => i >= m && ok);
    } else if (p.filterMode === 'rolling') {
      coint = rollingCoint(a, b, p.cointWin, { tauMax: crit, maxHalfLife: p.maxHalfLife });
      startAt = Math.max(startAt, p.cointWin - 1);
      allowOpen = coint.ok;
    }
    const simP = Object.assign({}, p, { startAt, allowOpen });
    const res = simulate(h.spread, h, simP, { a, b, k: h.kUsed });
    res.hedge = h;
    res.coint = coint;
    res.prescreen = prescreen;
    res.critUsed = crit;
    return res;
  }

  /* ---------- Календарный спред ---------- */
  /* Теоретическая («справедливая») разница Дальний − Ближний по модели стоимости переноса:
     Спот × (ставка r + хранение u − выгода владения y) × (разница сроков в днях ÷ 365).
     Ставки r, u, y передаются в долях единицы (например, 0,16 = 16% годовых). */
  function carryFair(spot, r, u, y, dtDays) {
    return spot * (r + u - y) * (dtDays / 365);
  }

  const CAL_SERIES_NAMES = ['Март–Июнь', 'Июнь–Сент', 'Сент–Дек', 'Дек–Март', 'Март–Июнь+'];

  /* Генератор цепочки календарных спредов (Дальний − Ближний) со сменой серий каждые cycleLen дней.
     Уход из серии (ролл) происходит за rollDays дней до экспирации ближнего фьючерса.
     В день ролла одновременно известны спред уходящей пары raw[t] и спред следующей пары nextRaw[t]:
     их разница rollGap[t] = nextRaw[t] − raw[t] даёт честную бесшовную склейку stitched без заглядывания в будущее.
     Сезонная норма seasonalNorm считается строго по 3 прошлым годам до начала теста (без будущего). */
  function genCalendar(opts) {
    const o = Object.assign({
      seed: 7, n: 320, cycleLen: 64, rollDays: 5, base: 1000,
      steps: [8, 22, 6, 21, 9], seasonAmp: 0, abnormal: false,
      squeezeAt: null, squeezeMag: -42, reversion: 0.18, noise: 2.1, spotStep: 4
    }, opts || {});
    const gauss = makeGauss(mulberry32(o.seed * 19 + 7));
    const seasonAt = (t, flip) => (o.seasonAmp === 0 ? 0 : (flip ? -0.6 : 1) * o.seasonAmp * Math.sin((2 * Math.PI * t) / 160));

    // Три предшествующих года для оценки сезонной нормы по календарному дню (без подглядывания в текущий год)
    const histSum = new Array(o.n).fill(0);
    for (let yr = 0; yr < 3; yr++) {
      let d = 0;
      for (let t = 0; t < o.n; t++) {
        d += -o.reversion * d + o.noise * gauss();
        histSum[t] += seasonAt(t, false) + d;
      }
    }
    const seasonalNorm = histSum.map((v) => round2(v / 3));

    const near = [], far = [], raw = [], stitched = [], cumShifts = [];
    const seriesIdx = [], daysToExp = [], isRoll = [], nextRaw = [], rollGap = [];
    let spot = o.base, dev = 0, cumShift = 0;
    for (let t = 0; t < o.n; t++) {
      const s = Math.floor(t / o.cycleLen);
      const inCycle = t % o.cycleLen;
      const dte = (o.cycleLen - 1 - inCycle) + o.rollDays;
      const rollToday = inCycle === o.cycleLen - 1 && t < o.n - 1;
      spot += o.spotStep * gauss();
      const inSqz = o.squeezeAt !== null && t >= o.squeezeAt;
      const rev = inSqz ? 0.04 : o.reversion;
      dev += -rev * dev + o.noise * gauss();
      const sqz = inSqz ? o.squeezeMag * Math.min(1, (t - o.squeezeAt + 1) / 22) : 0;
      const lvl = o.steps[s % o.steps.length];
      const seas = seasonAt(t, o.abnormal);
      const sp = round2(lvl + seas + dev + sqz);
      const pNear = round2(spot + lvl * 0.5 - sqz * 0.75);
      const pFar = round2(pNear + sp);

      near.push(pNear); far.push(pFar); raw.push(sp);
      cumShifts.push(cumShift);
      stitched.push(round2(sp - cumShift));
      seriesIdx.push(s); daysToExp.push(dte); isRoll.push(rollToday);

      if (rollToday) {
        const nextLvl = o.steps[(s + 1) % o.steps.length];
        const nSp = round2(nextLvl + seas + dev + sqz);
        const gap = round2(nSp - sp);
        nextRaw.push(nSp);
        rollGap.push(gap);
        cumShift = round2(cumShift + gap);
      } else {
        nextRaw.push(null);
        rollGap.push(0);
      }
    }
    return {
      near, far, raw, stitched, cumShifts, seasonalNorm,
      seriesIdx, daysToExp, isRoll, nextRaw, rollGap,
      seriesNames: CAL_SERIES_NAMES, opts: o
    };
  }

  const CAL_SCENARIOS = [
    { id: 'steps', name: 'Ступеньки между сериями', opts: { steps: [8, 22, 6, 21, 9], seasonAmp: 0 }, note: 'У каждой квартальной пары свой уровень переноса (например, менялись ставки и сроки). На стыках серий сырой график прыгает на 12–16 пунктов без реального движения рынка.' },
    { id: 'seasonal', name: 'Сильная сезонность (зима / лето)', opts: { steps: [12, 14, 11, 13, 12], seasonAmp: 13 }, note: 'Спред закономерно ходит волной по временам года (летом контанго шире, к зиме уходит в бэквордацию), повторяя профиль прошлых лет.' },
    { id: 'squeeze', name: 'Дефицит и взрыв бэквордации', opts: { steps: [12, 15, 11, 14, 12], squeezeAt: 165, squeezeMag: -42 }, note: 'До 165-го дня обычное контанго, затем на складах возникает острый дефицит: ближний фьючерс взлетает, и спред Дальний − Ближний рушится в глубокую бэквордацию.' },
    { id: 'abnormal', name: 'Аномальный год (слом сезонности)', opts: { steps: [12, 14, 11, 13, 12], seasonAmp: 13, abnormal: true }, note: 'Три прошлых года сезонная волна шла в одну сторону, а в этом году погода или урожай перевернули картину.' }
  ];
  const genCalScenario = (seed, scn) => genCalendar(Object.assign({ seed }, scn.opts));

  /* Бэктест календарного спреда с честным учётом серий и экспирации:
     expiryMode = 'naive' — сигнал считается по сырой склейке raw со ступеньками (учебная ошибка!), но деньги на счёте считаются честно по реальным контрактам;
     expiryMode = 'close' — сигнал по бесшовной склейке, за rollDays до экспирации позиция закрывается (без ролла);
     expiryMode = 'roll'  — сигнал по бесшовной склейке, в день ролла открытая позиция переносится в следующую серию с оплатой rollCost.
     seasonal = true      — из бесшовного спреда дополнительно вычитается сезонная норма прошлых 3 лет. */
  function backtestCalendar(cal, params) {
    const p = Object.assign({}, DEFAULTS, { expiryMode: 'roll', seasonal: false, rollCost: null }, params || {});
    const rCost = p.rollCost !== null && p.rollCost !== undefined ? p.rollCost : p.cost;
    const sigSeries = cal.raw.map((v, i) => {
      const base = p.expiryMode === 'naive' ? v : cal.stitched[i];
      return p.seasonal ? base - cal.seasonalNorm[i] : base;
    });
    const st = rolling(sigSeries, p.n);
    const len = cal.raw.length;
    const trades = [];
    const equity = new Array(len).fill(0);
    const pos = new Array(len).fill(0);
    const signal = new Array(len).fill(null);
    const executed = new Array(len).fill(null);
    const rolled = new Array(len).fill(false);
    let cur = 0, entry = null, realized = 0, pending = null;

    function openAt(act, t, sigIdx) {
      cur = act.dir;
      entry = {
        dir: act.dir, signalIdx: sigIdx, execIdx: t,
        stitchedIn: cal.stitched[t], rawIn: cal.raw[t], seriesIn: cal.seriesIdx[t],
        z: st.z[sigIdx], rolls: 0, legs: [{ series: cal.seriesIdx[t], inIdx: t, rawIn: cal.raw[t] }]
      };
      realized -= p.cost;
      executed[t] = act;
    }

    function closeAt(act, t, sigIdx) {
      const lastLeg = entry.legs[entry.legs.length - 1];
      lastLeg.outIdx = t;
      lastLeg.rawOut = cal.raw[t];
      const gross = entry.dir * (cal.stitched[t] - entry.stitchedIn);
      const rollPaid = entry.rolls * rCost;
      const totalCost = p.cost + rollPaid;
      trades.push({
        dir: entry.dir, signalIn: entry.signalIdx, entryIdx: entry.execIdx, exitIdx: t, signalOut: sigIdx,
        seriesIn: entry.seriesIn, seriesOut: cal.seriesIdx[t],
        entryS: entry.rawIn, exitS: cal.raw[t],
        stitchedIn: entry.stitchedIn, stitchedOut: cal.stitched[t],
        entryZ: entry.z, exitZ: st.z[sigIdx],
        rolls: entry.rolls, rollCostPaid: rollPaid, legs: entry.legs,
        reason: act.reason, gross, cost: totalCost, net: gross - totalCost, bars: t - entry.execIdx
      });
      realized += gross - rollPaid;
      cur = 0; entry = null;
      executed[t] = act;
    }

    for (let t = 0; t < len; t++) {
      if (pending) {
        if (pending.act.type === 'open') openAt(pending.act, t, pending.signalIdx);
        else if (cur !== 0) closeAt(pending.act, t, pending.signalIdx);
        pending = null;
      }
      if (st.z[t] !== null) {
        if (p.expiryMode === 'close' && cal.isRoll[t]) {
          if (cur !== 0) {
            const act = { type: 'close', reason: 'expiry' };
            signal[t] = act;
            closeAt(act, t, t);
          }
        } else {
          const held = cur !== 0 ? t - entry.execIdx : 0;
          const act = decide(cur, st.z[t], held, p);
          if (act) {
            signal[t] = act;
            if (p.delay === 0) {
              if (act.type === 'open') openAt(act, t, t);
              else closeAt(act, t, t);
            } else if (t < len - 1) {
              pending = { act, signalIdx: t };
            }
          }
          if (cur !== 0 && cal.isRoll[t]) {
            const curLeg = entry.legs[entry.legs.length - 1];
            curLeg.outIdx = t;
            curLeg.rawOut = cal.raw[t];
            entry.legs.push({ series: cal.seriesIdx[t] + 1, inIdx: t, rawIn: cal.nextRaw[t] });
            entry.rolls++;
            rolled[t] = true;
          }
        }
      }
      pos[t] = cur;
      equity[t] = realized + (cur !== 0 ? cur * (cal.stitched[t] - entry.stitchedIn) - entry.rolls * rCost : 0);
    }
    if (cur !== 0) {
      const last = len - 1;
      closeAt({ type: 'close', reason: 'end' }, last, last);
      pos[last] = 0;
      equity[last] = realized;
    }
    return {
      params: p, trades, equity, pos, signal, executed, rolled,
      sigSeries, mean: st.mean, std: st.std, z: st.z, metrics: metrics(trades, equity, pos)
    };
  }

  /* Пошаговая выкладка одного дня для экрана 7 раздела «Календарный спред». */
  function explainCalendar(cal, n, t, opts) {
    if (t < n - 1) return null;
    const o = Object.assign({ expiryMode: 'roll', seasonal: false }, opts || {});
    const sigSeries = cal.raw.map((v, i) => {
      const base = o.expiryMode === 'naive' ? v : cal.stitched[i];
      return o.seasonal ? base - cal.seasonalNorm[i] : base;
    });
    const ex = explainBar(sigSeries, n, t);
    const sIdx = cal.seriesIdx[t];
    return Object.assign({
      seriesIdx: sIdx,
      seriesName: cal.seriesNames[sIdx % cal.seriesNames.length],
      near: cal.near[t],
      far: cal.far[t],
      raw: cal.raw[t],
      cumShift: cal.cumShifts[t],
      stitched: cal.stitched[t],
      seasonalNorm: cal.seasonalNorm[t],
      daysToExp: cal.daysToExp[t],
      isRoll: cal.isRoll[t],
      nextRaw: cal.nextRaw[t],
      rollGap: cal.rollGap[t]
    }, ex);
  }

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
    const blocked = new Array(len).fill(null);
    const startAt = p.startAt || 0;
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
      if (z[t] !== null && (cur !== 0 || t >= startAt)) {
        const held = cur !== 0 ? t - entry.execIdx : 0;
        let act = decide(cur, z[t], held, p);
        if (act && act.type === 'open' && p.allowOpen && !p.allowOpen[t]) {
          blocked[t] = act;
          act = null;
        }
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
    return { params: p, trades, equity, pos, signal, executed, blocked, mean, std, z, metrics: metrics(trades, equity, pos) };
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

  /* ---------- Модификации («Приёмы», #35): лог-спред, вход на развороте, лесенка, фильтр режима σ ---------- */
  function genTactics(opts) {
    const o = Object.assign({
      seed: 7, n: 320, b0: 100, driftPct: 0, scaleWave: false, stepPct: 0.008,
      logMode: false, logMean: 0.30, logNoise: 0.011,
      meanSpread: 8, reversion: 0.22, noise: 2.2,
      storms: null, wideMode: false
    }, opts || {});
    const rng = mulberry32(o.seed * 29 + 11);
    const gauss = makeGauss(rng);
    const a = [], b = [], spread = [], logSpread = [], isStorm = [];
    let pB = o.b0, u = 0;
    for (let t = 0; t < o.n; t++) {
      if (t > 0) {
        const dr = o.scaleWave ? (t < 190 ? 0.0078 : -0.0085) : o.driftPct;
        pB = Math.max(15, pB * Math.exp(dr + o.stepPct * gauss()));
      }
      let stormNow = null;
      if (o.storms) {
        for (const st of o.storms) if (t >= st[0] && t <= st[1]) { stormNow = st; break; }
      }
      isStorm.push(!!stormNow);
      if (o.logMode) {
        u += -o.reversion * u + o.logNoise * gauss();
        const pA = round2(pB * Math.exp(o.logMean + u));
        const pBr = round2(pB);
        a.push(pA); b.push(pBr);
        spread.push(round2(pA - pBr));
        logSpread.push(Math.log(pA) - Math.log(pBr));
      } else if (o.wideMode) {
        const s0 = Math.sin((2 * Math.PI * (t + (o.seed % 7))) / 18);
        const cyc = 6.0 * (s0 >= 0 ? 1 : -1) * Math.pow(Math.abs(s0), 2.3);
        const deep = (t > 35 && (t + o.seed) % 54 === 4) ? (s0 >= 0 ? 4.4 : -4.4) : 0;
        u = cyc + deep + o.noise * gauss();
        const pBr = round2(pB);
        const sp = round2(o.meanSpread + u);
        const pA = round2(Math.max(5, pBr + sp));
        a.push(pA); b.push(pBr);
        spread.push(round2(pA - pBr));
        logSpread.push(Math.log(pA) - Math.log(pBr));
      } else {
        const rev = stormNow ? 0.015 : o.reversion;
        const ns = stormNow ? o.noise * 4.6 : o.noise;
        const push = stormNow ? stormNow[2] : 0;
        u += -rev * u + ns * gauss() + push;
        const pBr = round2(pB);
        const sp = round2(o.meanSpread + u);
        const pA = round2(Math.max(5, pBr + sp));
        a.push(pA); b.push(pBr);
        spread.push(round2(pA - pBr));
        logSpread.push(Math.log(pA) - Math.log(pBr));
      }
    }
    return { a, b, spread, logSpread, isStorm, opts: o };
  }

  const TACTIC_SCENARIOS = [
    { id: 'calm', name: 'Спокойная резинка', opts: { meanSpread: 8, reversion: 0.24, noise: 2.2 }, note: 'Цены ходят вокруг 100 пунктов, спред устойчиво возвращается к среднему без смены масштаба и бурь.' },
    { id: 'growth', name: 'Смена масштаба цен в 4 раза', opts: { logMode: true, b0: 55, scaleWave: true, stepPct: 0.016, logMean: 0.35, logNoise: 0.009, reversion: 0.11 }, note: 'Рынок сначала вырастает более чем в 4 раза, а затем откатывается, при этом A стабильно держится около +42% к B (ln A − ln B ≈ 0,35).' },
    { id: 'storm', name: 'Шторм и пробои режима', opts: { b0: 140, meanSpread: 8, reversion: 0.25, noise: 1.8, storms: [[85, 138, 1.3], [205, 258, -1.3]] }, note: 'Дважды за историю на рынке начинается буря: дневной разброс подскакивает вчетверо, а спред много дней подряд уносит против позиции.' },
    { id: 'wide', name: 'Ступенчатые заходы (1,8σ и 2,8σ)', opts: { meanSpread: 8, wideMode: true, noise: 0.45 }, note: 'Регулярные умеренные качания на 1,7–1,9σ (не дотягивающие до жёсткого порога 2,0σ) чередуются с глубокими растяжениями до 2,8σ.' }
  ];
  const genTacticScenario = (seed, scn) => genTactics(Object.assign({ seed }, scn.opts));

  /* Фильтр режима волатильности без заглядывания в будущее: сравнивает среднеквадратичный дневной шаг спреда
     за короткое окно W (по умолчанию min(N, 15)) со спокойной базой за длинное окно L (по умолчанию 90 дн.). */
  function volRegime(series, nShort, nLong, ratioMax) {
    const len = series.length;
    const W = Math.max(8, Math.min(nShort || 15, 15));
    const L = Math.max(W + 20, nLong || 90);
    const rMax = ratioMax !== undefined ? ratioMax : 1.35;
    const stepSq = new Array(len).fill(0);
    for (let t = 1; t < len; t++) { const d = series[t] - series[t - 1]; stepSq[t] = d * d; }
    const stdShort = new Array(len).fill(null);
    const stdLong = new Array(len).fill(null);
    const ratio = new Array(len).fill(null);
    const ok = new Array(len).fill(true);
    for (let t = W; t < len; t++) {
      let s1 = 0;
      for (let k = t - W + 1; k <= t; k++) s1 += stepSq[k];
      const vS = Math.sqrt(s1 / W);
      const wL = Math.min(t, L);
      let s2 = 0;
      for (let k = t - wL + 1; k <= t; k++) s2 += stepSq[k];
      const vL = Math.sqrt(s2 / wL);
      stdShort[t] = vS;
      stdLong[t] = vL;
      ratio[t] = vL > 1e-12 ? vS / vL : null;
      ok[t] = ratio[t] !== null && ratio[t] <= rMax;
    }
    return { stdShort, stdLong, ratio, ok, nShort: W, nLong: L, ratioMax: rMax };
  }

  /* Универсальный симулятор четырёх приёмов:
     - logMode: false (A − B) | 'equalLots' (сигнал ln A − ln B, но равное число контрактов) | 'notional' (сигнал ln A − ln B и равный денежный объём 100 п. на ногу);
     - reversal: true — вход после подтверждения отката от экстремума на reboundZ сигм;
     - scaleIn: true — набор позиции двумя половинами (0,5 на entryZ1 и 0,5 на entryZ2) и по желанию частичный выход partialExit;
     - volFilter: true — запрет новых входов и доборов при σ_короткой / σ_длинной > volRatioMax (выходы не блокируются). */
  function backtestTactics(dataOrSeries, params) {
    const isObj = !Array.isArray(dataOrSeries);
    const a = isObj ? dataOrSeries.a : null;
    const b = isObj ? dataOrSeries.b : null;
    const rawSpread = isObj ? (dataOrSeries.spread || a.map((v, i) => v - b[i])) : dataOrSeries;
    const p = Object.assign({}, DEFAULTS, {
      logMode: false, notionalBase: 100,
      reversal: false, reboundZ: 0.45,
      scaleIn: false, entryZ1: null, addZ: 0.85, partialExit: true,
      volFilter: false, volLong: 100, volRatioMax: 1.35
    }, params || {});

    const useLog = p.logMode === 'notional' || p.logMode === 'equalLots' || p.logMode === true;
    const notionalMode = p.logMode === 'notional' || p.logMode === true;
    const sigSeries = useLog && a && b ? a.map((v, i) => Math.log(v) - Math.log(b[i])) : rawSpread.slice();
    const st = rolling(sigSeries, p.n);
    const reg = volRegime(sigSeries, p.n, p.volLong, p.volRatioMax);
    const len = sigSeries.length;

    const e1 = p.scaleIn ? (p.entryZ1 !== null ? p.entryZ1 : Math.max(0.75, p.entryZ - 0.35)) : p.entryZ;
    const rawE2 = e1 + (p.addZ !== undefined ? p.addZ : 0.85);
    const e2 = p.stopZ !== null ? Math.min(rawE2, p.stopZ - 0.3) : rawE2;
    const ex1 = Math.min(e1 - 0.35, p.exitZ + 0.55);

    const trades = [];
    const equity = new Array(len).fill(0);
    const pos = new Array(len).fill(0);
    const signal = new Array(len).fill(null);
    const executed = new Array(len).fill(null);
    const blocked = new Array(len).fill(null);
    const armedState = new Array(len).fill(null);

    let curDir = 0, tranches = [], hadSecond = false, firstIdx = null, realized = 0, curTradeLog = null;
    let arm = { dir: 0, peakZ: null, armedIdx: null };

    function legGross(dir, sz, tr, tOut) {
      if (notionalMode && a && b) {
        return dir * sz * p.notionalBase * (((a[tOut] - tr.aIn) / tr.aIn) - ((b[tOut] - tr.bIn) / tr.bIn));
      }
      if (p.logMode === 'equalLots' && a && b) {
        const eqLots = (2 * p.notionalBase) / (tr.aIn + tr.bIn);
        return dir * sz * eqLots * ((a[tOut] - tr.aIn) - (b[tOut] - tr.bIn));
      }
      if (a && b) {
        return dir * sz * ((a[tOut] - tr.aIn) - (b[tOut] - tr.bIn));
      }
      return dir * sz * (rawSpread[tOut] - tr.sIn);
    }

    function openTranche(dir, sz, t, reasonTag) {
      const entryFee = p.scaleIn ? 0.30 * p.cost : p.cost;
      realized -= entryFee;
      const tr = { sz, inIdx: t, sIn: sigSeries[t], rawIn: rawSpread[t], aIn: a ? a[t] : null, bIn: b ? b[t] : null, zIn: st.z[t], entryFee };
      if (curDir === 0) {
        curDir = dir;
        firstIdx = t;
        hadSecond = false;
        curTradeLog = {
          dir, entryIdx: t, signalIn: t, entryS: sigSeries[t], entryRaw: rawSpread[t], entryZ: st.z[t],
          tranchesOpened: 1, partialExits: 0, grossAcc: 0, costAcc: entryFee, events: [{ type: reasonTag || 'open', t, sz, z: st.z[t], s: sigSeries[t] }]
        };
      } else {
        hadSecond = true;
        curTradeLog.tranchesOpened++;
        curTradeLog.costAcc += entryFee;
        curTradeLog.events.push({ type: 'add', t, sz, z: st.z[t], s: sigSeries[t] });
      }
      tranches.push(tr);
      executed[t] = { type: hadSecond && tranches.length > 1 ? 'add' : 'open', dir, sz };
    }

    function closePortion(closeAll, t, reason) {
      if (!tranches.length) return;
      if (!closeAll && tranches.length > 1) {
        const tr = tranches.pop();
        const g = legGross(curDir, tr.sz, tr, t);
        const exitFee = 0.30 * p.cost;
        realized += g - exitFee;
        curTradeLog.partialExits++;
        curTradeLog.grossAcc += g;
        curTradeLog.costAcc += exitFee;
        curTradeLog.events.push({ type: 'partial', t, sz: tr.sz, z: st.z[t], s: sigSeries[t], gross: g });
        executed[t] = { type: 'partial', dir: curDir, sz: tr.sz, reason };
        return;
      }
      let gSum = 0;
      const totalSzClosed = tranches.reduce((s, x) => s + x.sz, 0);
      tranches.forEach((tr) => { gSum += legGross(curDir, tr.sz, tr, t); });
      const exitFee = p.scaleIn ? (totalSzClosed > 0.75 ? 0.50 * p.cost : 0.30 * p.cost) : 0;
      realized += gSum - exitFee;
      const gross = curTradeLog.grossAcc + gSum;
      const cost = curTradeLog.costAcc + exitFee;
      curTradeLog.events.push({ type: 'close', t, sz: totalSzClosed, z: st.z[t], s: sigSeries[t], gross: gSum, reason });
      trades.push({
        dir: curDir, signalIn: curTradeLog.signalIn, entryIdx: curTradeLog.entryIdx, exitIdx: t, signalOut: t,
        entryS: curTradeLog.entryS, exitS: sigSeries[t], entryRaw: curTradeLog.entryRaw, exitRaw: rawSpread[t],
        entryZ: curTradeLog.entryZ, exitZ: st.z[t],
        tranches: curTradeLog.tranchesOpened, partialExits: curTradeLog.partialExits, events: curTradeLog.events,
        reason, gross, cost, net: gross - cost, bars: t - curTradeLog.entryIdx
      });
      tranches = [];
      curDir = 0; hadSecond = false; firstIdx = null; curTradeLog = null;
      executed[t] = { type: 'close', reason };
    }

    for (let t = 0; t < len; t++) {
      const z = st.z[t];
      const ok = !p.volFilter || reg.ok[t];
      if (z !== null) {
        if (curDir === 0) {
          let wantDir = 0;
          if (!p.reversal) {
            if (z <= -e1) wantDir = 1;
            else if (z >= e1) wantDir = -1;
          } else {
            if (p.stopZ !== null && Math.abs(z) >= p.stopZ) {
              arm = { dir: 0, peakZ: null, armedIdx: null };
            } else if (arm.dir === 0) {
              if (z <= -e1) arm = { dir: 1, peakZ: z, armedIdx: t };
              else if (z >= e1) arm = { dir: -1, peakZ: z, armedIdx: t };
            } else if (arm.dir === 1) {
              if (z < arm.peakZ) arm.peakZ = z;
              else if (z >= -p.exitZ) arm = { dir: 0, peakZ: null, armedIdx: null };
              else if (z - arm.peakZ >= p.reboundZ && z <= -(p.exitZ + 0.2)) {
                wantDir = 1;
                arm = { dir: 0, peakZ: null, armedIdx: null };
              }
            } else if (arm.dir === -1) {
              if (z > arm.peakZ) arm.peakZ = z;
              else if (z <= p.exitZ) arm = { dir: 0, peakZ: null, armedIdx: null };
              else if (arm.peakZ - z >= p.reboundZ && z >= p.exitZ + 0.2) {
                wantDir = -1;
                arm = { dir: 0, peakZ: null, armedIdx: null };
              }
            }
          }
          if (wantDir !== 0) {
            if (!ok) blocked[t] = { type: 'open', dir: wantDir, reason: 'vol' };
            else {
              const sz = p.scaleIn ? 0.5 : 1;
              signal[t] = { type: 'open', dir: wantDir, reason: 'entry', sz };
              openTranche(wantDir, sz, t, 'open');
            }
          }
        } else {
          arm = { dir: 0, peakZ: null, armedIdx: null };
          const held = t - firstIdx;
          const stopHit = p.stopZ !== null && ((curDir === 1 && z <= -p.stopZ) || (curDir === -1 && z >= p.stopZ));
          const targetHit = (curDir === 1 && z >= -p.exitZ) || (curDir === -1 && z <= p.exitZ);
          const timeHit = p.maxHold > 0 && held >= p.maxHold;
          if (stopHit) {
            signal[t] = { type: 'close', reason: 'stop' };
            closePortion(true, t, 'stop');
          } else if (targetHit) {
            signal[t] = { type: 'close', reason: 'target' };
            closePortion(true, t, 'target');
          } else if (timeHit) {
            signal[t] = { type: 'close', reason: 'time' };
            closePortion(true, t, 'time');
          } else if (p.scaleIn && !hadSecond && tranches.length === 1 && ((curDir === 1 && z <= -e2) || (curDir === -1 && z >= e2))) {
            if (!ok) blocked[t] = { type: 'add', dir: curDir, reason: 'vol' };
            else {
              signal[t] = { type: 'add', dir: curDir, reason: 'scale_in', sz: 0.5 };
              openTranche(curDir, 0.5, t, 'add');
            }
          } else if (p.scaleIn && p.partialExit && tranches.length === 2 && ((curDir === 1 && z >= -ex1) || (curDir === -1 && z <= ex1))) {
            signal[t] = { type: 'partial', dir: curDir, reason: 'partial_target', sz: 0.5 };
            closePortion(false, t, 'partial');
          }
        }
      }
      armedState[t] = { dir: arm.dir, peakZ: arm.peakZ, armedIdx: arm.armedIdx };
      const curSz = tranches.reduce((s, x) => s + x.sz, 0);
      pos[t] = curDir * curSz;
      let openPnl = 0;
      tranches.forEach((tr) => { openPnl += legGross(curDir, tr.sz, tr, t); });
      equity[t] = realized + openPnl;
    }

    if (curDir !== 0) {
      const last = len - 1;
      closePortion(true, last, 'end');
      pos[last] = 0;
      equity[last] = realized;
    }

    return {
      params: Object.assign({}, p, { e1, e2, ex1 }),
      trades, equity, pos, signal, executed, blocked, armedState,
      sigSeries, rawSpread, mean: st.mean, std: st.std, z: st.z, regime: reg,
      metrics: metrics(trades, equity, pos)
    };
  }

  function explainTactics(d, n, t, opts) {
    if (t < n - 1) return null;
    const o = Object.assign({ logMode: false, volLong: 100, volRatioMax: 1.35 }, opts || {});
    const useLog = o.logMode === 'notional' || o.logMode === 'equalLots' || o.logMode === true;
    const sigSeries = useLog ? d.a.map((v, i) => Math.log(v) - Math.log(d.b[i])) : d.spread;
    const ex = explainBar(sigSeries, n, t);
    const reg = volRegime(sigSeries, n, o.volLong, o.volRatioMax);
    return Object.assign({
      a: d.a[t], b: d.b[t], raw: d.spread[t],
      lnA: Math.log(d.a[t]), lnB: Math.log(d.b[t]), logSp: Math.log(d.a[t]) - Math.log(d.b[t]),
      useLog,
      volShort: reg.stdShort[t], volLong: reg.stdLong[t], volRatio: reg.ratio[t], volOk: reg.ok[t],
      nShort: reg.nShort, nLong: reg.nLong
    }, ex);
  }

  /* ---------- Межбиржевой и валютный спред (#40) ---------- */
  /* Паритетная цена актива в валюте внутренней площадки: (цена_мир × курс_FX) ÷ делитель_единиц. */
  function fxParity(pWorld, fx, unitDiv) {
    return (pWorld * fx) / (unitDiv || 1);
  }

  /* Генератор межбиржевого валютного спреда (n = 320 дней):
     - pWorld[t]: мировая цена актива в $ (около 100 $);
     - fx[t]: курс в ₽ за 1 $ (около 90 ₽/$);
     - parity[t] = pWorld[t] * fx[t] / 100: паритетная цена в пунктах (1 пункт = 100 ₽);
     - pDom[t]: цена внутреннего рублёвого фьючерса в пунктах (по 100 ₽) в общие часы работы обеих бирж;
     - syncSpread[t] = pDom[t] − parity[t]: истинный синхронный спред;
     - pWorldObs[t], obsSpread[t]: видимые закрытия дня (когда внешняя площадка закрылась раньше вечерней сессии, pWorldObs отстаёт). */
  function genFxSpread(opts) {
    const o = Object.assign({
      seed: 7, n: 320, world0: 100, fx0: 90,
      worldStep: 1.1, fxDrift: 0, fxSurge: null, fxStep: 0.45,
      basePrem: 1.5, fxPanicPrem: 0, reversion: 0.24, noise: 2.1,
      staleProb: 0, staleShock: 0, barrierAt: null, barrierShift: 0
    }, opts || {});
    const rng = mulberry32(o.seed * 37 + 13);
    const gauss = makeGauss(rng);

    const pWorld = [], fx = [], parity = [], pDom = [], syncSpread = [];
    const pWorldObs = [], obsSpread = [], isStale = [];
    let w = o.world0, rate = o.fx0, u = 0;

    for (let t = 0; t < o.n; t++) {
      if (t > 0) {
        w = Math.max(25, w + o.worldStep * gauss());
        const surge = o.fxSurge && t >= o.fxSurge[0] && t <= o.fxSurge[1] ? o.fxSurge[2] : o.fxDrift;
        rate = Math.max(30, rate * Math.exp(surge + (o.fxStep / 90) * gauss()));
      }
      const inBar = o.barrierAt !== null && t >= o.barrierAt;
      const rev = inBar ? 0.03 : o.reversion;
      const inSurge = o.fxSurge && t >= o.fxSurge[0] && t <= o.fxSurge[1];
      const fxPush = inSurge ? o.fxPanicPrem : 0;
      u += -rev * u + o.noise * gauss() + fxPush;
      const bar = inBar ? o.barrierShift * Math.min(1, (t - o.barrierAt + 1) / 36) : 0;

      const wR = round2(w), fxR = round2(rate);
      const par = round2((wR * fxR) / 100);
      const sp = round2(o.basePrem + u + bar);
      const dom = round2(par + sp);

      let staleToday = false, wObs = wR;
      if (o.staleProb > 0 && t > 5 && rng() < o.staleProb) {
        staleToday = true;
        const shockUsd = (rng() < 0.5 ? 1 : -1) * (0.65 + 0.7 * rng()) * o.staleShock;
        wObs = round2(Math.max(20, wR - shockUsd));
      }
      const obsPar = round2((wObs * fxR) / 100);
      const spObs = round2(dom - obsPar);

      pWorld.push(wR); fx.push(fxR); parity.push(par); pDom.push(dom);
      syncSpread.push(round2(dom - par));
      pWorldObs.push(wObs); obsSpread.push(spObs); isStale.push(staleToday);
    }
    return { pWorld, fx, parity, pDom, syncSpread, pWorldObs, obsSpread, isStale, opts: o };
  }

  const FX_SCENARIOS = [
    { id: 'calm', name: 'Спокойный курс и синхронные часы', opts: { fxDrift: 0, fxStep: 0.35, staleProb: 0 }, note: 'Курс рубля колеблется в узком коридоре около 90 ₽/$, обе биржи сверяются строго в один и тот же час.' },
    { id: 'fxtrend', name: 'Валютное ралли и защитная премия', opts: { fxSurge: [70, 205, 0.0062], fxStep: 2.2, fxPanicPrem: 1.15, reversion: 0.15, staleProb: 0 }, note: 'Курс доллара растёт волной с 90 выше 180 ₽/$; на скачках курса внутренние покупатели временно переплачивают премию за защитный актив.' },
    { id: 'desync', name: 'Разные часы закрытия (вечерние скачки)', opts: { fxDrift: 0, fxStep: 0.45, staleProb: 0.28, staleShock: 6.5 }, note: 'Примерно раз в 3–4 дня после закрытия внешней биржи выходит новость: внутренняя вечерняя сессия уже сдвинулась, а внешняя котировка осталась дневной.' },
    { id: 'barrier', name: 'Инфраструктурный барьер на 145-м дне', opts: { fxDrift: 0.0004, fxStep: 0.5, barrierAt: 145, barrierShift: -44 }, note: 'Со 145-го дня вводятся ограничения на переток капитала и товара между странами: внутренний рынок уходит в глубокий устойчивый дисконт к мировому паритету.' }
  ];
  const genFxScenario = (seed, scn) => genFxSpread(Object.assign({ seed }, scn.opts));

  /* Симулятор межбиржевого и валютного спреда:
     fxMode = 'noFx'   — 2 ноги (внутренняя ₽ и внешняя $) без валютного фьючерса (издержки = cost);
     fxMode = 'stale'  — 3 ноги с FX-хеджем, но сигнал считается по несинхронным закрытиям obsSpread (исполнение по реальным ценам, издержки = cost * fxCostMult);
     fxMode = 'hedged' — 3 ноги с FX-хеджем и сигналом строго по синхронному срезу syncSpread. */
  function backtestFx(fxData, params) {
    const p = Object.assign({}, DEFAULTS, { fxMode: 'hedged', fxCostMult: 1.35 }, params || {});
    const sigSeries = p.fxMode === 'stale' ? fxData.obsSpread : fxData.syncSpread;
    const st = rolling(sigSeries, p.n);
    const len = sigSeries.length;
    const fee = p.fxMode === 'noFx' ? p.cost : p.cost * p.fxCostMult;

    const trades = [];
    const equity = new Array(len).fill(0);
    const pos = new Array(len).fill(0);
    const signal = new Array(len).fill(null);
    const executed = new Array(len).fill(null);
    let cur = 0, entry = null, realized = 0, pending = null;

    function legsPnl(e, t) {
      const parIn = (e.worldIn * e.fxIn) / 100;
      const parOut = (fxData.pWorld[t] * fxData.fx[t]) / 100;
      const dDom = e.dir * (fxData.pDom[t] - e.domIn);
      const dWorldUsd = -e.dir * (fxData.pWorld[t] - e.worldIn);
      const dWorldRub = (dWorldUsd * fxData.fx[t]) / 100;
      const dFxRub = p.fxMode === 'noFx' ? 0 : (-e.dir * e.worldIn * (fxData.fx[t] - e.fxIn)) / 100;
      // При точном курсе без промежуточного округления: dWorldRub + dFxRub ≡ -dir * (parOut - parIn)
      const gross = dDom + dWorldRub + dFxRub;
      return { dDom, dWorldUsd, dWorldRub, dFxRub, parIn, parOut, gross };
    }

    function openAt(act, t, sigIdx) {
      cur = act.dir;
      entry = {
        dir: act.dir, execIdx: t, signalIdx: sigIdx,
        domIn: fxData.pDom[t], worldIn: fxData.pWorld[t], fxIn: fxData.fx[t],
        syncIn: fxData.syncSpread[t], obsIn: fxData.obsSpread[t], z: st.z[sigIdx]
      };
      realized -= fee;
      executed[t] = act;
    }

    function closeAt(act, t, sigIdx) {
      const lg = legsPnl(entry, t);
      trades.push({
        dir: entry.dir, signalIn: entry.signalIdx, entryIdx: entry.execIdx, exitIdx: t, signalOut: sigIdx,
        domIn: entry.domIn, domOut: fxData.pDom[t],
        worldIn: entry.worldIn, worldOut: fxData.pWorld[t],
        fxIn: entry.fxIn, fxOut: fxData.fx[t],
        entryS: entry.syncIn, exitS: fxData.syncSpread[t],
        obsIn: entry.obsIn, obsOut: fxData.obsSpread[t],
        entryZ: entry.z, exitZ: st.z[sigIdx],
        pnlDom: lg.dDom, pnlWorldUsd: lg.dWorldUsd, pnlWorldRub: lg.dWorldRub, pnlFxRub: lg.dFxRub,
        reason: act.reason, gross: lg.gross, cost: fee, net: lg.gross - fee, bars: t - entry.execIdx
      });
      realized += lg.gross;
      cur = 0; entry = null;
      executed[t] = act;
    }

    for (let t = 0; t < len; t++) {
      if (pending) {
        if (pending.act.type === 'open') openAt(pending.act, t, pending.signalIdx);
        else if (cur !== 0) closeAt(pending.act, t, pending.signalIdx);
        pending = null;
      }
      if (st.z[t] !== null) {
        const held = cur !== 0 ? t - entry.execIdx : 0;
        const act = decide(cur, st.z[t], held, p);
        if (act) {
          signal[t] = act;
          if (p.delay === 0) {
            if (act.type === 'open') openAt(act, t, t);
            else closeAt(act, t, t);
          } else if (t < len - 1) {
            pending = { act, signalIdx: t };
          }
        }
      }
      pos[t] = cur;
      equity[t] = realized + (cur !== 0 ? legsPnl(entry, t).gross : 0);
    }
    if (cur !== 0) {
      const last = len - 1;
      closeAt({ type: 'close', reason: 'end' }, last, last);
      pos[last] = 0;
      equity[last] = realized;
    }

    return {
      params: p, trades, equity, pos, signal, executed,
      sigSeries, mean: st.mean, std: st.std, z: st.z, metrics: metrics(trades, equity, pos)
    };
  }

  function explainFx(fxData, n, t, opts) {
    if (t < n - 1) return null;
    const o = Object.assign({ fxMode: 'hedged' }, opts || {});
    const sigSeries = o.fxMode === 'stale' ? fxData.obsSpread : fxData.syncSpread;
    const ex = explainBar(sigSeries, n, t);
    return Object.assign({
      dom: fxData.pDom[t],
      world: fxData.pWorld[t],
      worldObs: fxData.pWorldObs[t],
      fx: fxData.fx[t],
      parity: fxData.parity[t],
      syncSpread: fxData.syncSpread[t],
      obsSpread: fxData.obsSpread[t],
      isStale: fxData.isStale[t]
    }, ex);
  }

  /* ---------- Корзины из 3+ инструментов (#43, #38) ---------- */
  /* Множественная линейная регрессия y ≈ c + w₁·x₁ + … + wₘ·xₘ методом наименьших квадратов
     (исключение Гаусса с выбором главного элемента, без внешних библиотек). */
  function olsMulti(y, xs) {
    const m = xs.length, n = y.length, p = m + 1;
    if (n < p + 1) return null;
    const G = Array.from({ length: p }, () => new Array(p + 1).fill(0));
    let my = 0;
    for (let t = 0; t < n; t++) my += y[t];
    my /= n;

    for (let t = 0; t < n; t++) {
      const row = [1];
      for (let j = 0; j < m; j++) row.push(xs[j][t]);
      const yt = y[t];
      for (let r = 0; r < p; r++) {
        const vr = row[r];
        for (let c = r; c < p; c++) G[r][c] += vr * row[c];
        G[r][p] += vr * yt;
      }
    }
    for (let r = 0; r < p; r++) for (let c = 0; c < r; c++) G[r][c] = G[c][r];
    for (let r = 1; r < p; r++) G[r][r] += 1e-10;

    for (let col = 0; col < p; col++) {
      let piv = col;
      for (let r = col + 1; r < p; r++) if (Math.abs(G[r][col]) > Math.abs(G[piv][col])) piv = r;
      if (Math.abs(G[piv][col]) < 1e-12) return null;
      if (piv !== col) { const tmp = G[col]; G[col] = G[piv]; G[piv] = tmp; }
      const div = G[col][col];
      for (let c = col; c <= p; c++) G[col][c] /= div;
      for (let r = 0; r < p; r++) {
        if (r === col) continue;
        const factor = G[r][col];
        for (let c = col; c <= p; c++) G[r][c] -= factor * G[col][c];
      }
    }

    const c0 = G[0][p];
    const weights = [];
    for (let j = 0; j < m; j++) weights.push(G[j + 1][p]);

    let ssr = 0, sst = 0;
    const resid = new Array(n);
    for (let t = 0; t < n; t++) {
      let hat = c0;
      for (let j = 0; j < m; j++) hat += weights[j] * xs[j][t];
      const e = y[t] - hat;
      resid[t] = e;
      ssr += e * e;
      const dy = y[t] - my;
      sst += dy * dy;
    }
    const r2 = sst > 1e-12 ? Math.max(0, 1 - ssr / sst) : 0;
    return { c: c0, weights, resid, r2, ssr };
  }

  /* Критические 5%-пороги Маккиннона для остатков регрессии из totalLegs инструментов (2..10):
     чем больше ног участвовало в подборе весов, тем строже (левее) должен быть порог τ. */
  function basketCrit(totalLegs, n) {
    const table = { 2: -3.34, 3: -3.74, 4: -4.10, 5: -4.42, 6: -4.71 };
    const asymp = table[totalLegs] !== undefined ? table[totalLegs] : -4.71 - 0.27 * (totalLegs - 6);
    const finAdj = n ? -4.5 / Math.max(20, n) : 0;
    return round2(asymp + finAdj);
  }

  /* Подбор целых лотов [qA, q1, q2, ...] для корзины A − w₁·X₁ − w₂·X₂ − …, где 1 ≤ qA ≤ maxA. */
  function roundBasketLots(weights, maxA) {
    const lim = maxA || 10;
    let best = null;
    for (let qA = 1; qA <= lim; qA++) {
      const qs = weights.map((w) => Math.round(w * qA));
      let maxErr = 0, sumLots = qA;
      for (let j = 0; j < weights.length; j++) {
        const approx = qs[j] / qA;
        maxErr = Math.max(maxErr, Math.abs(approx - weights[j]));
        sumLots += Math.abs(qs[j]);
      }
      const score = maxErr + 0.002 * qA;
      if (!best || score < best.score) {
        best = { qA, qs, approx: qs.map((q) => q / qA), maxErr, totalLots: sumLots, score };
      }
    }
    return best;
  }

  /* Генератор корзины из 3 основных инструментов (A, B, C) + пул независимых блужданий extras (для демонстрации переобучения на M = 2..10 ногах). */
  function genBasket(opts) {
    const o = Object.assign({
      seed: 7, n: 320,
      twoFactor: false, f2Step: 0.15, f2Drift: 0,
      wTrue: [0.5, 0.5],
      reversion: 0.28, noise: 1.5,
      shockBAt: null, shockBSize: 0,
      pureNoise: false, rwStep: 1.85, extraWalks: 7
    }, opts || {});
    const rng = mulberry32(o.seed * 41 + 19);
    const gauss = makeGauss(rng);

    const a = [], b = [], c = [], trueSpread = [];
    let f1 = 100, f2 = 0, ib = 0, ic = 0, u = 0;
    let rwA = 100, rwB = 100, rwC = 100;
    const dA = o.pureNoise ? 0.16 * (rng() < 0.5 ? 1 : -1) : 0, dB = o.pureNoise ? -0.11 * (rng() < 0.5 ? 1 : -1) : 0, dC = o.pureNoise ? 0.09 * (rng() < 0.5 ? 1 : -1) : 0;

    for (let t = 0; t < o.n; t++) {
      if (o.pureNoise) {
        if (t > 0) {
          rwA = Math.max(20, rwA + dA + o.rwStep * gauss());
          rwB = Math.max(20, rwB + dB + o.rwStep * gauss());
          rwC = Math.max(20, rwC + dC + o.rwStep * gauss());
        }
        a.push(round2(rwA)); b.push(round2(rwB)); c.push(round2(rwC));
        trueSpread.push(round2(rwA - 0.5 * rwB - 0.5 * rwC));
        continue;
      }

      if (t > 0) {
        f1 = Math.max(35, f1 + 1.25 * gauss());
        f2 = f2 + (o.twoFactor ? o.f2Drift + o.f2Step * gauss() : 0.12 * gauss());
        ib = 0.7 * ib + 0.55 * gauss();
        ic = 0.7 * ic + 0.55 * gauss();
      }
      const bShock = o.shockBAt !== null && t >= o.shockBAt ? o.shockBSize * Math.min(1, (t - o.shockBAt + 1) / 8) : 0;
      const bt = o.twoFactor ? (f1 + 0.9 * f2 + ib) : (f1 + ib + bShock);
      const ct = o.twoFactor ? (f1 - 0.9 * f2 + ic) : (f1 + ic);

      u += -o.reversion * u + o.noise * gauss();
      const fairA = o.shockBAt !== null
        ? (10 + f1)
        : (10 + o.wTrue[0] * bt + o.wTrue[1] * ct);
      const at = fairA + u;

      a.push(round2(at)); b.push(round2(bt)); c.push(round2(ct));
      trueSpread.push(round2(u));
    }

    const extras = [];
    for (let j = 0; j < o.extraWalks; j++) {
      const arr = [];
      let v = 100;
      for (let t = 0; t < o.n; t++) {
        if (t > 0) v = Math.max(20, v + o.rwStep * gauss());
        arr.push(round2(v));
      }
      extras.push(arr);
    }
    return { a, b, c, trueSpread, extras, opts: o };
  }

  const BASKET_SCENARIOS = [
    { id: 'twofactor', name: 'Два общих ветра (веса 1,2 и 0,6)', opts: { twoFactor: true, f2Step: 2.1, f2Drift: 0.32, wTrue: [1.2, 0.6], reversion: 0.30, noise: 1.5 }, note: 'Рынок двигают сразу два независимых фактора с весами 1,2·B + 0,6·C. Пара A − k·B гасит только один ветер, равные веса 0,5/0,5 ошибаются в масштабе, а регрессия 3 ног гасит оба.' },
    { id: 'known', name: 'Известная пропорция 0,5·B + 0,5·C', opts: { twoFactor: true, f2Step: 1.15, wTrue: [0.5, 0.5], reversion: 0.16, noise: 2.35 }, note: 'Истинные веса заданы экономикой или технологией (0,5 и 0,5). Готовая формула не тратит точность на переоценку двух наклонов по зашумлённому окну.' },
    { id: 'idioshock', name: 'Обвал одной бумаги B на 155-м дне', opts: { twoFactor: false, wTrue: [0.5, 0.5], shockBAt: 155, shockBSize: -36, reversion: 0.28, noise: 1.5 }, note: 'До 155-го дня B и C оба ходят за отраслью, а затем у компании B выходит тяжёлая собственная новость (−36 п.). Пара A − k·B ловит весь удар, тогда как корзина опирается на C.' },
    { id: 'noise', name: 'Ложная корзина (3 случайных блуждания)', opts: { pureNoise: true, rwStep: 1.95 }, note: 'Три полностью независимых случайных блуждания. Скользящая регрессия без поправки Маккиннона лепит «красивые» веса из чистого шума и теряет деньги.' }
  ];
  const genBasketScenario = (seed, scn) => genBasket(Object.assign({ seed }, scn.opts));

  /* Симулятор корзины:
     basketMode = 'pair'      — обычная пара A − k·B (оценка k по окну regN, 2 ноги, комиссия = cost);
     basketMode = 'fixed'     — фиксированная корзина A − w₁·B − w₂·C с заданными весами fixedW (3 ноги, комиссия = cost * legFeeMult);
     basketMode = 'ols'       — скользящая множественная регрессия A − w₁·B − w₂·C по окну regN (веса замораживаются на время сделки);
     basketMode = 'ols_coint' — то же, но вход разрешён только при прохождении ужесточённого порога Маккиннона для 3 ног. */
  function backtestBasket(bkData, params) {
    const p = Object.assign({}, DEFAULTS, {
      basketMode: 'ols', regN: 75, fixedW: [0.5, 0.5], legFeeMult: 1.35
    }, params || {});
    const len = bkData.a.length;
    const w1Arr = new Array(len).fill(null), w2Arr = new Array(len).fill(null), cArr = new Array(len).fill(0);
    const tauArr = new Array(len).fill(null), passArr = new Array(len).fill(true);
    const sigSeries = new Array(len).fill(null);
    const crit3 = basketCrit(3, p.regN);

    for (let t = p.regN - 1; t < len; t++) {
      if (p.basketMode === 'pair') {
        const subY = bkData.a.slice(t - p.regN + 1, t + 1);
        const subB = bkData.b.slice(t - p.regN + 1, t + 1);
        const fit = olsMulti(subY, [subB]);
        w1Arr[t] = fit ? fit.weights[0] : 1; w2Arr[t] = 0; cArr[t] = fit ? fit.c : 0;
        const df = fit ? dfTest(fit.resid) : null;
        tauArr[t] = df ? df.tau : null;
      } else if (p.basketMode === 'fixed') {
        w1Arr[t] = p.fixedW[0]; w2Arr[t] = p.fixedW[1]; cArr[t] = 0;
      } else {
        const subY = bkData.a.slice(t - p.regN + 1, t + 1);
        const subB = bkData.b.slice(t - p.regN + 1, t + 1);
        const subC = bkData.c.slice(t - p.regN + 1, t + 1);
        const fit = olsMulti(subY, [subB, subC]);
        if (fit) {
          w1Arr[t] = fit.weights[0]; w2Arr[t] = fit.weights[1]; cArr[t] = fit.c;
          const df = dfTest(fit.resid);
          tauArr[t] = df ? df.tau : null;
          if (p.basketMode === 'ols_coint') passArr[t] = df !== null && df.tau <= crit3;
        }
      }
    }

    const mean = new Array(len).fill(null), std = new Array(len).fill(null), z = new Array(len).fill(null);
    const startAt = Math.max(p.regN - 1, p.n - 1);
    for (let t = startAt; t < len; t++) {
      const w1 = w1Arr[t], w2 = w2Arr[t];
      if (w1 === null) continue;
      let s = 0;
      const vals = [];
      for (let k = t - p.n + 1; k <= t; k++) {
        const v = bkData.a[k] - w1 * bkData.b[k] - w2 * bkData.c[k];
        vals.push(v); s += v;
      }
      const m = s / p.n;
      let sq = 0;
      for (let k = 0; k < vals.length; k++) { const d = vals[k] - m; sq += d * d; }
      const sd = Math.sqrt(sq / p.n);
      mean[t] = m; std[t] = sd;
      sigSeries[t] = vals[vals.length - 1];
      z[t] = sd > 1e-9 ? (vals[vals.length - 1] - m) / sd : null;
    }

    const fee = p.basketMode === 'pair' ? p.cost : p.cost * p.legFeeMult;
    const trades = [];
    const equity = new Array(len).fill(0);
    const pos = new Array(len).fill(0);
    const signal = new Array(len).fill(null);
    const executed = new Array(len).fill(null);
    let cur = 0, entry = null, realized = 0, pending = null;

    function legsPnl(e, t) {
      const dA = e.dir * (bkData.a[t] - e.aIn);
      const dB = -e.dir * e.w1 * (bkData.b[t] - e.bIn);
      const dC = -e.dir * e.w2 * (bkData.c[t] - e.cIn);
      return { dA, dB, dC, gross: dA + dB + dC };
    }

    function openAt(act, t, sigIdx) {
      cur = act.dir;
      entry = {
        dir: act.dir, execIdx: t, signalIdx: sigIdx,
        w1: w1Arr[sigIdx], w2: w2Arr[sigIdx],
        aIn: bkData.a[t], bIn: bkData.b[t], cIn: bkData.c[t],
        entryS: bkData.a[t] - w1Arr[sigIdx] * bkData.b[t] - w2Arr[sigIdx] * bkData.c[t],
        z: z[sigIdx], tauIn: tauArr[sigIdx]
      };
      realized -= fee;
      executed[t] = act;
    }

    function closeAt(act, t, sigIdx) {
      const lg = legsPnl(entry, t);
      const exitS = bkData.a[t] - entry.w1 * bkData.b[t] - entry.w2 * bkData.c[t];
      trades.push({
        dir: entry.dir, signalIn: entry.signalIdx, entryIdx: entry.execIdx, exitIdx: t, signalOut: sigIdx,
        w1: entry.w1, w2: entry.w2,
        aIn: entry.aIn, aOut: bkData.a[t], bIn: entry.bIn, bOut: bkData.b[t], cIn: entry.cIn, cOut: bkData.c[t],
        entryS: entry.entryS, exitS, entryZ: entry.z, exitZ: z[sigIdx], tauIn: entry.tauIn,
        pnlA: lg.dA, pnlB: lg.dB, pnlC: lg.dC,
        reason: act.reason, gross: lg.gross, cost: fee, net: lg.gross - fee, bars: t - entry.execIdx
      });
      realized += lg.gross;
      cur = 0; entry = null;
      executed[t] = act;
    }

    for (let t = 0; t < len; t++) {
      if (pending) {
        if (pending.act.type === 'open') openAt(pending.act, t, pending.signalIdx);
        else if (cur !== 0) closeAt(pending.act, t, pending.signalIdx);
        pending = null;
      }
      if (z[t] !== null) {
        const held = cur !== 0 ? t - entry.execIdx : 0;
        let act = decide(cur, z[t], held, p);
        if (act && act.type === 'open' && p.basketMode === 'ols_coint' && !passArr[t]) act = null;
        if (act) {
          signal[t] = act;
          if (p.delay === 0) {
            if (act.type === 'open') openAt(act, t, t);
            else closeAt(act, t, t);
          } else if (t < len - 1) {
            pending = { act, signalIdx: t };
          }
        }
      }
      pos[t] = cur;
      equity[t] = realized + (cur !== 0 ? legsPnl(entry, t).gross : 0);
    }
    if (cur !== 0) {
      const last = len - 1;
      closeAt({ type: 'close', reason: 'end' }, last, last);
      pos[last] = 0;
      equity[last] = realized;
    }

    return {
      params: p, trades, equity, pos, signal, executed,
      sigSeries, w1: w1Arr, w2: w2Arr, c0: cArr, tau: tauArr, pass: passArr, crit3,
      mean, std, z, metrics: metrics(trades, equity, pos)
    };
  }

  function explainBasket(bkData, regN, n, t, opts) {
    const o = Object.assign({ basketMode: 'ols', fixedW: [0.5, 0.5] }, opts || {});
    const startAt = Math.max(regN - 1, n - 1);
    if (t < startAt) return null;

    let w1, w2, c0 = 0, r2 = null, tau = null;
    const subY = bkData.a.slice(t - regN + 1, t + 1);
    const subB = bkData.b.slice(t - regN + 1, t + 1);
    const subC = bkData.c.slice(t - regN + 1, t + 1);

    let mA = 0, mB = 0, mC = 0;
    for (let i = 0; i < regN; i++) { mA += subY[i]; mB += subB[i]; mC += subC[i]; }
    mA /= regN; mB /= regN; mC /= regN;
    let sBB = 0, sCC = 0, sBC = 0, sBA = 0, sCA = 0;
    for (let i = 0; i < regN; i++) {
      const da = subY[i] - mA, db = subB[i] - mB, dc = subC[i] - mC;
      sBB += db * db; sCC += dc * dc; sBC += db * dc; sBA += db * da; sCA += dc * da;
    }

    if (o.basketMode === 'pair') {
      const fit = olsMulti(subY, [subB]);
      w1 = fit ? fit.weights[0] : 1; w2 = 0; c0 = fit ? fit.c : 0; r2 = fit ? fit.r2 : null;
      const df = fit ? dfTest(fit.resid) : null;
      tau = df ? df.tau : null;
    } else if (o.basketMode === 'fixed') {
      w1 = o.fixedW[0]; w2 = o.fixedW[1]; c0 = 0;
    } else {
      const fit = olsMulti(subY, [subB, subC]);
      w1 = fit ? fit.weights[0] : 0.5; w2 = fit ? fit.weights[1] : 0.5;
      c0 = fit ? fit.c : 0; r2 = fit ? fit.r2 : null;
      const df = fit ? dfTest(fit.resid) : null;
      tau = df ? df.tau : null;
    }

    const crit = basketCrit(o.basketMode === 'pair' ? 2 : 3, regN);
    const rows = [];
    let sum = 0;
    for (let k = t - n + 1; k <= t; k++) {
      const val = bkData.a[k] - w1 * bkData.b[k] - w2 * bkData.c[k];
      rows.push({ idx: k, a: bkData.a[k], b: bkData.b[k], c: bkData.c[k], value: val });
      sum += val;
    }
    const mean = sum / n;
    let sumSq = 0;
    rows.forEach((r) => { r.dev = r.value - mean; r.sq = r.dev * r.dev; sumSq += r.sq; });
    const variance = sumSq / n;
    const std = Math.sqrt(variance);
    const value = rows[rows.length - 1].value;
    return {
      a: bkData.a[t], b: bkData.b[t], c: bkData.c[t],
      w1, w2, c0, r2, tau, crit, pass: tau !== null ? tau <= crit : true,
      mA, mB, mC, sBB, sCC, sBC, sBA, sCA,
      rows, sum, mean, sumSq, variance, std, value, z: std > 1e-9 ? (value - mean) / std : null
    };
  }

  /* ---------- Микроструктура срочного рынка MOEX (#53, #46) ---------- */
  /* Формула вариационной маржи клиринга FORTS: VM = lots × (SP₁ − SP₀) × (W ÷ R),
     где SP — расчётная цена клиринга, R — минимальный шаг цены (тик), W — стоимость шага цены в рублях. */
  function calcVM(sp0, sp1, tickSize, tickVal, lots) {
    return (lots === undefined ? 1 : lots) * (sp1 - sp0) * (tickVal / tickSize);
  }

  /* Подбор целых лотов для выравнивания денежного номинала двух контрактов с разной контрактной экономикой
     (например, полный MIX и мини-фьючерс MMI 1:10 или Si и USDRUBF). */
  function matchContractLots(nomA, nomB, maxA) {
    const lim = maxA || 10;
    const ratio = nomA / nomB;
    let best = null;
    for (let qA = 1; qA <= lim; qA++) {
      const qB = Math.max(1, Math.round(qA * ratio));
      const rubA = qA * nomA, rubB = qB * nomB;
      const relErr = Math.abs(rubA - rubB) / rubA;
      const score = relErr + 0.002 * qA;
      if (!best || score < best.score) best = { qA, qB, rubA, rubB, relErr, ratio, score };
    }
    return best;
  }

  /* Четырёхслойная декомпозиция издержек круга (вход + выход):
     1) биржевой сбор (maker дешевле taker), 2) клиринговый сбор, 3) брокерская комиссия,
     4) полуспред и проскальзывание по глубине стакана (нативный стакан спреда против ручного леггирования; в стресс имплицированная ликвидность исчезает). */
  function decomposeCosts(opts) {
    const o = Object.assign({
      exchMaker: 0.015, exchTaker: 0.035, clearing: 0.015, broker: 0.02,
      halfSpreadLeg: 0.09, nativeSpreadHalf: 0.09, leggingSlip: 0.08,
      volumeLots: 1, depthLots: 5, nativeBook: false, stressed: false
    }, opts || {});
    const mult = o.stressed ? 2.6 : 1.0;
    const useNative = o.nativeBook && !o.stressed;
    const exch = 2 * 2 * (useNative ? (o.exchMaker + o.exchTaker) * 0.5 : o.exchTaker);
    const clear = 2 * 2 * o.clearing;
    const brok = 2 * 2 * o.broker;
    const bookImpact = (Math.max(0, o.volumeLots - 1) / Math.max(1, o.depthLots)) * 0.35 * mult;
    const slip = useNative
      ? (2 * o.nativeSpreadHalf * mult + bookImpact)
      : (2 * (2 * o.halfSpreadLeg + o.leggingSlip) * mult + 2 * bookImpact);
    const total = exch + clear + brok + slip;
    return {
      exch: round2(exch), clear: round2(clear), broker: round2(brok),
      slip: round2(slip), total: round2(total), usedNative: useNative
    };
  }

  /* Доходность на реально замороженное ГО (Return on Margin, RoM) в штиль (со скидкой D_cal) и в стресс-режиме. */
  function calcRoM(netPts, goLegPts, discount, stressMult, stressDiscount) {
    const rawGo = 2 * goLegPts;
    const calmGo = rawGo * (1 - (discount === undefined ? 0.72 : discount));
    const stressGo = rawGo * (stressMult || 1.7) * (1 - (stressDiscount === undefined ? 0.15 : stressDiscount));
    return {
      rawGo: round2(rawGo), calmGo: round2(calmGo), stressGo: round2(stressGo),
      romCalmPct: calmGo > 0 ? round2((netPts / calmGo) * 100) : 0,
      romStressPct: stressGo > 0 ? round2((netPts / stressGo) * 100) : 0
    };
  }

  /* Генератор связки на MOEX FORTS (квартальный фьючерс против вечного / спотовой ноги с дивидендами):
     - spPerp[t], spQuart[t]: расчётные цены вечернего клиринга (SP, 23:50);
     - spRaw[t] = spQuart[t] − spPerp[t]: сырой спред по клирингу;
     - lastRaw[t]: спред по последним сделкам 23:49 (с прострелами на тонкой вечерней сессии);
     - fairBasis[t]: справедливый перенос (ставка на горизонте − ожидаемый дивиденд до отсечки);
     - cleanSpread[t] = spRaw[t] − fairBasis[t]: очищенный от переноса и дивидендов спред;
     - swapPaid[t], carryDays[t]: ежедневный SwapRate (в понедельник начисляется сразу за 3 дня переноса через выходные);
     - reqGo[t]: нетто-ГО пары (в штиль со скидкой 72%, в шторм базовое ГО × 1,7 и скидка сжимается до 15%). */
  function genMoex(opts) {
    const o = Object.assign({
      seed: 7, n: 320,
      rate0: 0.09, rateEnd: 0.09, swapExtra: 0.0,
      divs: [], eveningNoiseProb: 0.12, eveningSpike: 2.4,
      stressSpan: null, reversion: 0.28, noise: 1.55,
      goLegPts: 90, calDiscount: 0.72
    }, opts || {});
    const rng = mulberry32(o.seed * 43 + 17);
    const gauss = makeGauss(rng);

    const spPerp = [], spQuart = [], spRaw = [], lastRaw = [], fairBasis = [], cleanSpread = [];
    const swapPaid = [], swapExtraDay = [], carryDays = [], isWeekend = [], isDivDay = [], divGapArr = [], inStress = [], reqGo = [];
    let spot = 900, u = 0;

    for (let t = 0; t < o.n; t++) {
      const wknd = t > 0 && t % 5 === 0;
      const cDays = wknd ? 3 : 1;
      const stress = o.stressSpan !== null && t >= o.stressSpan[0] && t <= o.stressSpan[1];

      let divToday = 0;
      for (const dv of o.divs) if (t === dv.exDay) divToday += dv.gap;

      if (t > 0) spot = Math.max(300, spot + (stress ? 3.2 : 1.3) * gauss() - divToday);

      const frac = t / Math.max(1, o.n - 1);
      const rateNow = o.rate0 + (o.rateEnd - o.rate0) * Math.min(1, Math.max(0, (frac - 0.12) / 0.65));

      let pendingDiv = 0;
      for (const dv of o.divs) {
        if (dv.exDay > t && dv.exDay - t <= 45) pendingDiv += dv.gap * (1 - (dv.exDay - t) / 45);
      }

      const fair = round2(90 * rateNow - pendingDiv);
      const effNoise = stress ? o.noise * 2.0 : o.noise;
      u += -o.reversion * u + effNoise * gauss();

      const perp = round2(spot);
      const quart = round2(spot + fair + u);
      const raw = round2(quart - perp);

      let last = raw;
      if (o.eveningNoiseProb > 0 && rng() < o.eveningNoiseProb) {
        last = round2(raw + (rng() < 0.5 ? 1 : -1) * (0.75 + 0.55 * rng()) * o.eveningSpike);
      }

      const dailySwap = round2((rateNow + o.swapExtra) * cDays);
      const extraFlow = round2(o.swapExtra * cDays);
      const goToday = stress
        ? round2(2 * o.goLegPts * 1.7 * (1 - 0.15))
        : round2(2 * o.goLegPts * (1 - o.calDiscount));

      spPerp.push(perp); spQuart.push(quart);
      spRaw.push(raw); lastRaw.push(last);
      fairBasis.push(fair); cleanSpread.push(round2(raw - fair));
      swapPaid.push(dailySwap); swapExtraDay.push(extraFlow);
      carryDays.push(cDays); isWeekend.push(wknd);
      isDivDay.push(divToday > 0); divGapArr.push(divToday);
      inStress.push(stress); reqGo.push(goToday);
    }
    return {
      spPerp, spQuart, spRaw, lastRaw, fairBasis, cleanSpread,
      swapPaid, swapExtraDay, carryDays, isWeekend, isDivDay, divGapArr, inStress, reqGo, opts: o
    };
  }

  const MOEX_SCENARIOS = [
    { id: 'swap_trap', name: 'Рост ставки и SwapRate вечного фьючерса', opts: { rate0: 0.08, rateEnd: 0.34, swapExtra: 0.14, eveningNoiseProb: 0.10, eveningSpike: 2.2 }, note: 'Ставка растёт: контанго квартального фьючерса к вечному расширяется с +7 до +31 п., а повышенный SwapRate ежедневно списывается с покупателей вечного фьючерса (в понедельник — втройне за выходные).' },
    { id: 'div_gap', name: 'Дивидендные отсечки (дни 70, 155, 240)', opts: { rate0: 0.10, rateEnd: 0.10, swapExtra: 0.02, divs: [{ exDay: 70, gap: 15 }, { exDay: 155, gap: 16 }, { exDay: 240, gap: 15 }], eveningNoiseProb: 0.10, eveningSpike: 2.0 }, note: 'По мере приближения отсечки будущий дивиденд закладывается в цену квартального контракта: сырой спред кажется «дешёвым», а в день отсечки делает ступеньку вверх.' },
    { id: 'thin_evening', name: 'Прострелы вечерней сессии и леггирование', opts: { rate0: 0.10, rateEnd: 0.10, swapExtra: 0.02, eveningNoiseProb: 0.42, eveningSpike: 5.6 }, note: 'В 23:49 одиночные сделки в пустом стакане отскакивают от расчётной цены клиринга SP и дают ложные входы, а ручной сбор двух ног теряет на спредах стакана.' },
    { id: 'stress_go', name: 'Шторм и сжатие скидки на ГО (дни 150–215)', opts: { rate0: 0.10, rateEnd: 0.10, swapExtra: 0.02, stressSpan: [150, 215], eveningNoiseProb: 0.18, eveningSpike: 3.2 }, note: 'В разгар шторма стакан спреда редеет, а клиринг поднимает базовое ГО и режет скидку с 72% до 15%: залог взлетает с 50 до 260 п., вызывая маржин-коллы без запаса кэша.' }
  ];
  const genMoexScenario = (seed, scn) => genMoex(Object.assign({ seed }, scn.opts));

  /* Симулятор микроструктуры MOEX:
     moexMode = 'naive_last' — сигнал по шумным последним сделкам 23:49 без учёта переноса/дивидендов, ручное леггирование, капитал без стресс-буфера;
     moexMode = 'raw_sp'     — сигнал по честному клирингу SP, но без вычитания переноса/дивидендов, ручное леггирование;
     moexMode = 'clean_leg'  — сигнал очищен от переноса и дивидендов (cleanSpread), но ручное леггирование и спокойный запас ГО;
     moexMode = 'moex_pro'   — очищенный сигнал по SP + нативный стакан спреда + полный стресс-запас под ГО. */
  function backtestMoex(mx, params) {
    const p = Object.assign({}, DEFAULTS, { moexMode: 'moex_pro', capitalPts: 135 }, params || {});
    const sigSeries = p.moexMode === 'naive_last' ? mx.lastRaw
      : p.moexMode === 'raw_sp' ? mx.spRaw
      : mx.cleanSpread;
    const st = rolling(sigSeries, p.n);
    const len = sigSeries.length;
    const useNative = p.moexMode === 'moex_pro';
    const costScale = p.cost / 0.5;

    const trades = [];
    const equity = new Array(len).fill(0);
    const pos = new Array(len).fill(0);
    const signal = new Array(len).fill(null);
    const executed = new Array(len).fill(null);
    let cur = 0, entry = null, realized = 0, marginCalls = 0;

    function openHalfFee(t) {
      return 0.5 * decomposeCosts({ nativeBook: useNative, stressed: mx.inStress[t] }).total * costScale;
    }

    function curGross(e, t) {
      const priceVm = e.dir * (mx.spRaw[t] - e.rawIn);
      const divComp = -e.dir * e.divAcc;
      return { priceVm, divComp, swapFlow: e.cumSwap, gross: priceVm + divComp + e.cumSwap };
    }

    function finishTrade(t, sigIdx, reason, forcedStress) {
      const closeFee = 0.5 * decomposeCosts({ nativeBook: forcedStress ? false : useNative, stressed: forcedStress || mx.inStress[t] }).total * costScale;
      const g = curGross(entry, t);
      const totalFee = entry.openFee + closeFee;
      trades.push({
        dir: entry.dir, signalIn: entry.signalIdx, entryIdx: entry.execIdx, exitIdx: t, signalOut: sigIdx,
        rawIn: entry.rawIn, rawOut: mx.spRaw[t],
        cleanIn: entry.cleanIn, cleanOut: mx.cleanSpread[t],
        entryZ: entry.z, exitZ: st.z[sigIdx],
        priceVm: g.priceVm, divComp: g.divComp, swapFlow: g.swapFlow,
        reason, gross: g.gross, cost: totalFee, net: g.gross - totalFee, bars: t - entry.execIdx
      });
      realized += g.gross - closeFee;
      cur = 0; entry = null;
      executed[t] = { type: 'close', reason };
    }

    for (let t = 0; t < len; t++) {
      if (cur !== 0 && t > entry.execIdx) {
        entry.cumSwap += cur * mx.swapExtraDay[t];
        if (mx.isDivDay[t]) entry.divAcc += mx.divGapArr[t];
      }

      if (cur !== 0 && p.moexMode !== 'moex_pro') {
        const gNow = curGross(entry, t).gross;
        if (p.capitalPts + realized + gNow < mx.reqGo[t]) {
          marginCalls++;
          finishTrade(t, t, 'margin', true);
        }
      }

      if (st.z[t] !== null) {
        const held = cur !== 0 ? t - entry.execIdx : 0;
        const act = decide(cur, st.z[t], held, p);
        if (act) {
          signal[t] = act;
          if (act.type === 'open') {
            const hf = openHalfFee(t);
            cur = act.dir;
            entry = {
              dir: act.dir, execIdx: t, signalIdx: t,
              rawIn: mx.spRaw[t], cleanIn: mx.cleanSpread[t],
              z: st.z[t], cumSwap: 0, divAcc: 0, openFee: hf
            };
            realized -= hf;
            executed[t] = act;
          } else if (cur !== 0) {
            finishTrade(t, t, act.reason, false);
          }
        }
      }
      pos[t] = cur;
      equity[t] = realized + (cur !== 0 ? curGross(entry, t).gross : 0);
    }
    if (cur !== 0) {
      const last = len - 1;
      finishTrade(last, last, 'end', false);
      pos[last] = 0;
      equity[last] = realized;
    }

    const m = metrics(trades, equity, pos);
    const rom = calcRoM(m.total, mx.opts.goLegPts, mx.opts.calDiscount, 1.7, 0.15);
    return {
      params: p, trades, equity, pos, signal, executed, marginCalls, rom,
      sigSeries, mean: st.mean, std: st.std, z: st.z, metrics: m
    };
  }

  function explainMoex(mx, n, t, opts) {
    if (t < n - 1) return null;
    const o = Object.assign({ moexMode: 'moex_pro' }, opts || {});
    const sigSeries = o.moexMode === 'naive_last' ? mx.lastRaw
      : o.moexMode === 'raw_sp' ? mx.spRaw
      : mx.cleanSpread;
    const ex = explainBar(sigSeries, n, t);
    return Object.assign({
      spPerp: mx.spPerp[t], spQuart: mx.spQuart[t],
      spRaw: mx.spRaw[t], lastRaw: mx.lastRaw[t],
      fairBasis: mx.fairBasis[t], cleanSpread: mx.cleanSpread[t],
      swapPaid: mx.swapPaid[t], carryDays: mx.carryDays[t],
      isWeekend: mx.isWeekend[t], isDivDay: mx.isDivDay[t],
      inStress: mx.inStress[t], reqGo: mx.reqGo[t]
    }, ex);
  }


  /* ---------- Продвинутая оценка β(t) и диагностика здоровья связи (#56, #47) ---------- */
  /* Ортогональная регрессия (Total Least Squares, TLS): минимизирует перпендикулярные расстояния до прямой y = α + k·x,
     симметрично учитывая шум в обеих ногах: tls(y, x).k === 1 / tls(x, y).k. */
  function tls(x, y) {
    const n = x.length;
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
    mx /= n; my /= n;
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - mx, dy = y[i] - my;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    if (Math.abs(sxy) < 1e-12) return { n, mx, my, sxx, syy, sxy, k: 0, alpha: my };
    const diff = syy - sxx;
    const k = (diff + Math.sqrt(diff * diff + 4 * sxy * sxy)) / (2 * sxy);
    return { n, mx, my, sxx, syy, sxy, k, alpha: my - k * mx };
  }

  /* Робастная регрессия Тейла — Сена (Theil–Sen): медиана всех попарных наклонов (y_j − y_i) / (x_j − x_i).
     Не ломается от одиночных сбойных принтов (точка срыва ~29,3% выбросов). */
  function theilSen(x, y) {
    const n = x.length, slopes = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = x[j] - x[i];
        if (Math.abs(dx) > 1e-9) slopes.push((y[j] - y[i]) / dx);
      }
    }
    const k = slopes.length ? median(slopes) : 0;
    const ints = new Array(n);
    for (let i = 0; i < n; i++) ints[i] = y[i] - k * x[i];
    return { n, k, alpha: median(ints), pairsCount: slopes.length };
  }

  /* Строго каузальный двумерный фильтр Калмана для y_t = α_t + β_t·x_t + ε_t (с опциональной обрезкой Хьюбера huberK):
     шаг 1 (прогноз до наблюдения y_t): priorAlpha[t], priorBeta[t], ошибка innov[t] = y_t − (α_{t|t-1} + β_{t|t-1}·x_t);
     шаг 2 (обновление после наблюдения): поправка на коэффициент усиления Калмана gainA[t], gainB[t]. */
  function kalmanHedge(x, y, opts) {
    const o = Object.assign({ qAlpha: 0.0001, qBeta: 0.0000035, obsVar: 3.2, huberK: 0 }, opts || {});
    const n = x.length;
    const alpha = new Array(n), beta = new Array(n);
    const priorAlpha = new Array(n), priorBeta = new Array(n);
    const innov = new Array(n), stdInnov = new Array(n), zInnov = new Array(n), gainA = new Array(n), gainB = new Array(n);

    let b = 1.0, a = n ? y[0] - x[0] : 0;
    let p00 = 16, p01 = 0, p11 = 0.02;

    for (let t = 0; t < n; t++) {
      p00 += o.qAlpha;
      p11 += o.qBeta;
      priorAlpha[t] = a;
      priorBeta[t] = b;

      const xt = x[t];
      const yhat = a + b * xt;
      const rawErr = y[t] - yhat;
      const hp0 = p00 + xt * p01;
      const hp1 = p01 + xt * p11;
      const S = hp0 + xt * hp1 + o.obsVar;
      const sSqrt = Math.sqrt(Math.max(1e-9, S));
      innov[t] = rawErr;
      stdInnov[t] = sSqrt;
      zInnov[t] = rawErr / sSqrt;

      let effErr = rawErr;
      if (o.huberK > 0 && Math.abs(rawErr) > o.huberK * sSqrt) {
        effErr = Math.sign(rawErr) * o.huberK * sSqrt;
      }

      const k0 = hp0 / S, k1 = hp1 / S;
      a += k0 * effErr;
      b += k1 * effErr;

      const np00 = (1 - k0) * p00 - k0 * xt * p01;
      const np01 = (1 - k0) * p01 - k0 * xt * p11;
      const np11 = -k1 * p01 + (1 - k1 * xt) * p11;
      p00 = Math.max(1e-9, np00);
      p01 = np01;
      p11 = Math.max(1e-9, np11);

      alpha[t] = a;
      beta[t] = b;
      gainA[t] = k0;
      gainB[t] = k1;
    }
    return { alpha, beta, priorAlpha, priorBeta, innov, stdInnov, zInnov, gainA, gainB };
  }

  /* Зеркальный тест стационарности KPSS (нулевая гипотеза H₀ — ряд стационарен вокруг уровня; 5%-порог = 0,463). */
  function kpssTest(series) {
    const n = series.length;
    if (n < 12) return { stat: 0, crit5: 0.463, crit1: 0.739, bandwidth: 1, pass: true };
    let m = 0;
    for (let i = 0; i < n; i++) m += series[i];
    m /= n;
    const e = new Array(n);
    let s = 0, sumS2 = 0, g0 = 0;
    for (let i = 0; i < n; i++) {
      e[i] = series[i] - m;
      g0 += e[i] * e[i];
      s += e[i];
      sumS2 += s * s;
    }
    g0 /= n;
    const L = Math.max(1, Math.floor(4 * Math.pow(n / 100, 0.25)));
    let lrv = g0;
    for (let l = 1; l <= L; l++) {
      let gl = 0;
      for (let t = l; t < n; t++) gl += e[t] * e[t - l];
      gl /= n;
      lrv += 2 * (1 - l / (L + 1)) * gl;
    }
    const stat = lrv > 1e-12 ? (sumS2 / (n * n)) / lrv : 0;
    return { stat, crit5: 0.463, crit1: 0.739, bandwidth: L, pass: stat <= 0.463 };
  }

  /* Показатель Хёрста H ∈ (0; 1) по наклону вариограммы приращений: H < 0,5 — возврат к среднему, H ≈ 0,5 — блуждание, H > 0,5 — инерция/тренд. */
  function hurstExp(series) {
    const n = series.length;
    const lags = [2, 4, 8, 16, 24].filter((L) => L * 2 <= n);
    if (lags.length < 2) return 0.5;
    const lx = [], ly = [];
    lags.forEach((L) => {
      let sumSq = 0, cnt = 0;
      for (let i = L; i < n; i++) {
        const d = series[i] - series[i - L];
        sumSq += d * d; cnt++;
      }
      const sd = Math.sqrt(sumSq / Math.max(1, cnt));
      if (sd > 1e-12) { lx.push(Math.log(L)); ly.push(Math.log(sd)); }
    });
    if (lx.length < 2) return 0.5;
    const fit = ols(lx, ly);
    return Math.max(0.02, Math.min(0.98, fit.k));
  }

  /* Четырёхквадрантная перекрёстная проверка стационарности ADF + KPSS + показатель Хёрста. */
  function stationarityMatrix(series) {
    const df = dfTest(series);
    const kp = kpssTest(series);
    const crit = dfCrit(series.length);
    const adfPass = df && df.tau !== null ? df.tau <= crit : false;
    const kpssPass = kp.pass;
    const hurst = hurstExp(series);
    let verdict = 'random_walk';
    if (adfPass && kpssPass) verdict = 'confirmed';
    else if (!adfPass && kpssPass) verdict = 'low_power';
    else if (adfPass && !kpssPass) verdict = 'structural_break';
    return {
      adfTau: df ? df.tau : 0, adfCrit: crit, adfPass,
      kpssStat: kp.stat, kpssCrit: kp.crit5, kpssPass,
      hurst, verdict
    };
  }

  /* Распределение периода полураспада t½ по скользящим отрезкам истории (а не обманчивая одна точка). */
  function halfLifeDist(series, win, step) {
    const w = win || 50, st = step || 10;
    const vals = [];
    let broken = 0, total = 0;
    for (let i = 0; i + w <= series.length; i += st) {
      total++;
      const sub = series.slice(i, i + w);
      const df = dfTest(sub);
      if (df && df.b < -0.005 && 1 + df.b > 0.02) {
        const hl = Math.min(60, -Math.LN2 / Math.log(1 + df.b));
        vals.push(round2(hl));
      } else {
        broken++;
        vals.push(60);
      }
    }
    const sorted = vals.slice().sort((a, b) => a - b);
    const q = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0;
    return {
      values: vals, median: median(vals), p25: q(0.25), p75: q(0.75),
      min: sorted.length ? sorted[0] : 0, max: sorted.length ? sorted[sorted.length - 1] : 0,
      brokenShare: total ? broken / total : 0
    };
  }

  /* Двусторонний детектор структурного разрыва Пейджа (CUSUM) по нормированным ошибкам прогноза. */
  function cusumBreak(zArr, opts) {
    const o = Object.assign({ slack: 0.75, hWarn: 4.0, hBreak: 6.5, startAt: 30 }, opts || {});
    const n = zArr.length;
    const pos = new Array(n).fill(0), neg = new Array(n).fill(0), score = new Array(n).fill(0), status = new Array(n).fill('ok');
    let sp = 0, sn = 0;
    for (let t = 0; t < n; t++) {
      if (t < o.startAt || zArr[t] === null || !Number.isFinite(zArr[t])) continue;
      const z = Math.max(-3.0, Math.min(3.0, zArr[t]));
      sp = Math.max(0, sp + z - o.slack);
      sn = Math.max(0, sn - z - o.slack);
      pos[t] = sp; neg[t] = sn;
      const sc = Math.max(sp, sn);
      score[t] = sc;
      status[t] = sc >= o.hBreak ? 'broken' : sc >= o.hWarn ? 'warn' : 'ok';
    }
    return { pos, neg, score, status, hWarn: o.hWarn, hBreak: o.hBreak };
  }

  /* Empirical Reversion Time (ERT) — среднее число баров между фактическими пересечениями медианы с фильтром минимального разброса σ_min. */
  function calcERT(series, opts) {
    const o = Object.assign({ sigmaMin: 0.8 }, opts || {});
    const n = series.length;
    if (!n) return { ert: 0, crossings: 0, sigma: 0, median: 0, valid: false };
    const med = median(series);
    let m = 0; for (let i = 0; i < n; i++) m += series[i]; m /= n;
    let v = 0; for (let i = 0; i < n; i++) v += (series[i] - m) * (series[i] - m);
    const sigma = Math.sqrt(v / n);
    const crossIdx = [];
    for (let i = 1; i < n; i++) {
      if ((series[i - 1] - med) * (series[i] - med) <= 0 && (series[i - 1] !== med || series[i] !== med)) crossIdx.push(i);
    }
    let ert = n;
    if (crossIdx.length >= 2) {
      let gapSum = 0;
      for (let k = 1; k < crossIdx.length; k++) gapSum += crossIdx[k] - crossIdx[k - 1];
      ert = gapSum / (crossIdx.length - 1);
    }
    return { ert: round2(ert), crossings: crossIdx.length, sigma: round2(sigma), median: round2(med), valid: sigma >= o.sigmaMin };
  }

  const DIAG_SCENARIOS = [
    {
      id: 'smooth_drift_beta',
      name: 'Плавный дрейф наклона β(t) от 0,60 к 1,90',
      opts: { beta0: 0.60, beta1: 1.90, ouRho: 0.58, ouSd: 1.85, factorDrift: 0.30, factorSd: 2.3, xNoise: 0.15, glitchProb: 0, breakAt: null, breakDrift: 0 },
      note: 'Чувствительность A к B плавно растёт по ходу года: скользящее окно OLS вечно опаздывает и пропускает чужой тренд в спред, а фильтр Калмана подстраивает β(t) мягко на каждом шаге.'
    },
    {
      id: 'glitch_spikes',
      name: 'Сбойные принты ленты и шум в обеих ногах',
      opts: { beta0: 1.35, beta1: 1.35, ouRho: 0.58, ouSd: 1.85, factorDrift: 0.06, factorSd: 2.2, xNoise: 1.6, glitchProb: 0.055, glitchAmp: 22.0, breakAt: null, breakDrift: 0 },
      note: 'Обе ноги шумят, а одиночные сбойные принты в ленте сбивают обычный OLS на 40 дней вперёд. Симметричный TLS + медианный наклон Тейла — Сена и защита Хьюбера сохраняют точный хедж.'
    },
    {
      id: 'silent_break',
      name: 'Тихий распад связи на 135-м дне (CUSUM + KPSS)',
      opts: { beta0: 1.20, beta1: 1.20, ouRho: 0.58, ouSd: 1.8, factorDrift: 0.05, factorSd: 2.2, xNoise: 0.2, glitchProb: 0, breakAt: 135, breakDrift: 0.65 },
      note: 'До 135-го дня пара честно возвращается к среднему, а затем «резинка» рвётся и A уползает вверх. Скользящий OLS маскирует поломку и копит убытки, а детектор CUSUM + KPSS зажигает красный бейдж.'
    },
    {
      id: 'false_regime',
      name: 'Ложная «полуживая» пара с памятью тренда (H > 0,5)',
      opts: { beta0: 1.15, beta1: 1.15, ouRho: 0.992, trendMix: 0.42, ouSd: 1.35, factorDrift: 0.05, factorSd: 1.7, xNoise: 0.25, glitchProb: 0, breakAt: null, breakDrift: 0 },
      note: 'Остатки лениво ходят длинными инерционными волнами (H > 0,5): без проверки возвратности стратегия застревает в затяжных движениях, а фильтр ADF + KPSS + Хёрст вовремя блокирует ложные входы.'
    }
  ];

  function genDiag(opts) {
    const o = Object.assign({
      seed: 7, n: 320, beta0: 1.15, beta1: 1.15, alpha0: 12,
      ouRho: 0.58, ouSd: 1.8, trendMix: 0,
      factorDrift: 0.05, factorSd: 1.8, xNoise: 0.2,
      glitchProb: 0, glitchAmp: 20, breakAt: null, breakDrift: 0
    }, opts || {});
    const rng = mulberry32(o.seed), gauss = makeGauss(rng);
    const a = new Array(o.n), b = new Array(o.n);
    const aExec = new Array(o.n), bExec = new Array(o.n);
    const trueBeta = new Array(o.n), trueAlpha = new Array(o.n), isGlitch = new Array(o.n).fill(false);
    let f = 100, u = 0, prevStep = 0;
    for (let t = 0; t < o.n; t++) {
      f = Math.max(25, f + o.factorDrift + gauss() * o.factorSd);
      const bt = o.beta0 + (o.beta1 - o.beta0) * (t / (o.n - 1));
      const broken = o.breakAt !== null && t >= o.breakAt;
      const al = o.alpha0;
      const eps = gauss() * o.ouSd + o.trendMix * prevStep;
      u = (broken ? 1.0 : o.ouRho) * u + (broken ? o.breakDrift : 0) + eps;
      prevStep = eps;

      const bxExec = f + gauss() * o.xNoise;
      const ayExec = al + bt * f + u;
      let bxFeed = bxExec, ayFeed = ayExec;
      if (o.glitchProb > 0 && t > 35 && rng() < o.glitchProb) {
        if (rng() < 0.5) ayFeed += (rng() < 0.5 ? 1 : -1) * o.glitchAmp;
        else bxFeed += (rng() < 0.5 ? 1 : -1) * (o.glitchAmp * 0.7);
        isGlitch[t] = true;
      }
      a[t] = round2(ayFeed); b[t] = round2(bxFeed);
      aExec[t] = round2(ayExec); bExec[t] = round2(bxExec);
      trueBeta[t] = round2(bt); trueAlpha[t] = round2(al);
    }
    return { a, b, aExec, bExec, trueBeta, trueAlpha, isGlitch, opts: o };
  }

  function genDiagScenario(seed, scen) {
    const sc = typeof scen === 'string' ? (DIAG_SCENARIOS.find((x) => x.id === scen) || DIAG_SCENARIOS[0]) : (scen || DIAG_SCENARIOS[0]);
    return genDiag(Object.assign({ seed: seed || 7 }, sc.opts));
  }

  function backtestDiag(dg, params) {
    const p = Object.assign({
      n: 40, entryZ: 2.0, exitZ: 0.4, stopZ: 3.6, maxHold: 28, cost: 0.40,
      diagMode: 'kalman_health'
    }, params || {});
    const len = dg.a.length;
    const kEst = new Array(len).fill(null), aEst = new Array(len).fill(null);
    const spread = new Array(len).fill(null), zArr = new Array(len).fill(null);
    const health = new Array(len).fill('ok');

    const kf = kalmanHedge(dg.b, dg.a, {
      qAlpha: 0.0001, qBeta: 0.0000035, obsVar: 3.2,
      huberK: p.diagMode === 'kalman_health' ? 2.1 : 0
    });

    const zForCusum = new Array(len).fill(null);
    for (let t = p.n; t < len; t++) {
      const baseStart = Math.max(15, t - 2 * p.n);
      const baseWin = kf.innov.slice(baseStart, Math.max(baseStart + 10, t - 8));
      const med = median(baseWin);
      const mad = Math.max(0.8, median(baseWin.map((v) => Math.abs(v - med))) * MAD_SCALE);
      zForCusum[t] = (kf.innov[t] - med) / mad;
    }
    const cs = cusumBreak(zForCusum, { slack: 0.75, hWarn: 4.0, hBreak: 6.5, startAt: p.n });

    for (let t = p.n - 1; t < len; t++) {
      const xWin = dg.b.slice(t - p.n + 1, t + 1);
      const yWin = dg.a.slice(t - p.n + 1, t + 1);
      if (p.diagMode === 'ols_plain' || p.diagMode === 'robust_tls') {
        let fit;
        if (p.diagMode === 'ols_plain') {
          fit = ols(xWin, yWin);
        } else {
          const ts = theilSen(xWin, yWin);
          const ort = tls(xWin, yWin);
          const kPick = Math.abs(ort.k - ts.k) > 0.16 ? ts.k : 0.45 * ts.k + 0.55 * ort.k;
          fit = { k: kPick, alpha: median(yWin.map((yv, idx) => yv - kPick * xWin[idx])) };
        }
        kEst[t] = fit.k;
        aEst[t] = fit.alpha;
        const resWin = new Array(p.n);
        for (let j = 0; j < p.n; j++) resWin[j] = yWin[j] - fit.alpha - fit.k * xWin[j];
        spread[t] = resWin[p.n - 1];
        if (p.diagMode === 'ols_plain') {
          let m = 0; for (let j = 0; j < p.n; j++) m += resWin[j]; m /= p.n;
          let v = 0; for (let j = 0; j < p.n; j++) v += (resWin[j] - m) * (resWin[j] - m);
          const sd = Math.sqrt(v / p.n);
          zArr[t] = sd > 1e-9 ? (resWin[p.n - 1] - m) / sd : 0;
        } else {
          const med = median(resWin);
          const mad = median(resWin.map((v) => Math.abs(v - med))) * MAD_SCALE;
          zArr[t] = mad > 1e-9 ? (resWin[p.n - 1] - med) / mad : 0;
        }
      } else {
        kEst[t] = kf.priorBeta[t];
        aEst[t] = kf.priorAlpha[t];
        spread[t] = kf.innov[t];
        const inWin = kf.innov.slice(t - p.n + 1, t + 1);
        if (p.diagMode === 'kalman_health') {
          const med = median(inWin);
          const mad = Math.max(0.6, median(inWin.map((v) => Math.abs(v - med))) * MAD_SCALE);
          zArr[t] = (kf.innov[t] - med) / mad;
          const checkLen = Math.min(t - 15, 70);
          if (checkLen >= 35) {
            const innovTail = kf.innov.slice(t - checkLen + 1, t + 1);
            const kp = kpssTest(innovTail);
            const h = hurstExp(innovTail);
            const stM = dfTest(innovTail);
            const adfOk = stM && stM.tau !== null && stM.tau <= dfCrit(innovTail.length);
            const nonRev = (!adfOk && !kp.pass) || h > 0.48;
            if ((cs.status[t] === 'broken' && (!kp.pass || h > 0.42)) || nonRev) health[t] = 'broken';
            else if (cs.status[t] !== 'ok' || !adfOk || !kp.pass || h > 0.43) health[t] = 'warn';
          }
        } else {
          let m = 0; for (let j = 0; j < p.n; j++) m += inWin[j]; m /= p.n;
          let v = 0; for (let j = 0; j < p.n; j++) v += (inWin[j] - m) * (inWin[j] - m);
          const sd = Math.sqrt(v / p.n);
          zArr[t] = sd > 1e-9 ? (kf.innov[t] - m) / sd : 0;
        }
      }
    }

    const trades = [];
    const equity = new Array(len).fill(0);
    const pos = new Array(len).fill(0);
    const signal = new Array(len).fill(null);
    const executed = new Array(len).fill(null);
    let cur = 0, entry = null, realized = 0, breakExits = 0;

    function legVal(e, t) {
      return (dg.aExec[t] - e.kIn * dg.bExec[t]) - (e.aIn - e.kIn * e.bIn);
    }

    for (let t = 0; t < len; t++) {
      const z = zArr[t];
      if (z !== null) {
        if (cur !== 0 && p.diagMode === 'kalman_health' && health[t] === 'broken') {
          const gross = cur * legVal(entry, t);
          trades.push({
            dir: cur, signalIn: entry.idx, entryIdx: entry.idx, exitIdx: t, signalOut: t,
            bars: t - entry.idx, kIn: round2(entry.kIn),
            entryZ: round2(entry.z), exitZ: round2(z),
            gross, cost: p.cost, net: gross - p.cost, reason: 'break'
          });
          realized += gross - 0.5 * p.cost;
          cur = 0; entry = null; breakExits++;
          executed[t] = { type: 'close', reason: 'break' };
        } else {
          const held = cur !== 0 ? t - entry.idx : 0;
          const rejectPrint = (p.diagMode === 'robust_tls' || p.diagMode === 'kalman_health') && Math.abs(z) > 4.2;
          const canOpen = p.diagMode !== 'kalman_health' || health[t] !== 'broken';
          const act = decide(cur, z, held, p);
          if (act) {
            signal[t] = act;
            if (act.type === 'open') {
              if (canOpen && !rejectPrint) {
                cur = act.dir;
                entry = { dir: cur, idx: t, aIn: dg.aExec[t], bIn: dg.bExec[t], kIn: kEst[t], z };
                realized -= 0.5 * p.cost;
                executed[t] = act;
              }
            } else if (cur !== 0) {
              const gross = cur * legVal(entry, t);
              trades.push({
                dir: cur, signalIn: entry.idx, entryIdx: entry.idx, exitIdx: t, signalOut: t,
                bars: t - entry.idx, kIn: round2(entry.kIn),
                entryZ: round2(entry.z), exitZ: round2(z),
                gross, cost: p.cost, net: gross - p.cost, reason: act.reason
              });
              realized += gross - 0.5 * p.cost;
              cur = 0; entry = null;
              executed[t] = act;
            }
          }
        }
      }
      pos[t] = cur;
      equity[t] = realized + (cur !== 0 ? cur * legVal(entry, t) : 0);
    }
    if (cur !== 0) {
      const last = len - 1;
      const gross = cur * legVal(entry, last);
      trades.push({
        dir: cur, signalIn: entry.idx, entryIdx: entry.idx, exitIdx: last, signalOut: last,
        bars: last - entry.idx, kIn: round2(entry.kIn),
        entryZ: round2(entry.z), exitZ: round2(zArr[last] || 0),
        gross, cost: p.cost, net: gross - p.cost, reason: 'end'
      });
      realized += gross - 0.5 * p.cost;
      pos[last] = 0; equity[last] = realized;
      executed[last] = { type: 'close', reason: 'end' };
    }
    const m = metrics(trades, equity, pos);
    return {
      params: p, trades, equity, pos, signal, executed, breakExits,
      kEst, aEst, spread, z: zArr, health, cusum: cs, kalman: kf, metrics: m
    };
  }

  function explainDiag(dg, n, t, opts) {
    if (t < n - 1) return null;
    const o = Object.assign({ diagMode: 'kalman_health' }, opts || {});
    const bt = backtestDiag(dg, { n, diagMode: o.diagMode });
    const xWin = dg.b.slice(t - n + 1, t + 1);
    const yWin = dg.a.slice(t - n + 1, t + 1);
    const olsFit = ols(xWin, yWin);
    const tlsFit = tls(xWin, yWin);
    const tsFit = theilSen(xWin, yWin);
    const kf = bt.kalman;
    const checkLen = Math.min(t + 1, 70);
    const innovTail = kf.innov.slice(t - checkLen + 1, t + 1);
    const stMat = stationarityMatrix(innovTail);
    const ertInfo = calcERT(innovTail);
    return {
      t, a: dg.a[t], b: dg.b[t], trueBeta: dg.trueBeta[t], isGlitch: dg.isGlitch[t],
      olsK: olsFit.k, tlsK: tlsFit.k, tsK: tsFit.k,
      priorAlpha: kf.priorAlpha[t], priorBeta: kf.priorBeta[t],
      yhat: kf.priorAlpha[t] + kf.priorBeta[t] * dg.b[t],
      innov: kf.innov[t], stdInnov: kf.stdInnov[t],
      gainA: kf.gainA[t], gainB: kf.gainB[t],
      postAlpha: kf.alpha[t], postBeta: kf.beta[t],
      z: bt.z[t], health: bt.health[t], cusumScore: bt.cusum.score[t],
      stMat, ertInfo
    };
  }


  /* ---------- Модельные пороги OU (границы Бертрама), волю-адаптивные полосы и carry-overlay (#59, #48) ---------- */
  function normCdf(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989422804014327 * Math.exp(-0.5 * x * x);
    const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + 1.330274429 * t))));
    return x >= 0 ? 1 - p : p;
  }

  /* Предвычисленные первообразные Зигерта — Бертрама для мгновенного O(1) расчёта времён достижения процесса OU. */
  const OU_GRID_MIN = -4.0, OU_GRID_STEP = 0.01, OU_GRID_N = 801;
  const OU_F = new Float64Array(OU_GRID_N);
  const OU_G = new Float64Array(401);
  {
    const rt2pi = Math.sqrt(2 * Math.PI);
    let accF = 0;
    for (let i = 1; i < OU_GRID_N; i++) {
      const u0 = OU_GRID_MIN + (i - 1) * OU_GRID_STEP, u1 = u0 + OU_GRID_STEP, um = 0.5 * (u0 + u1);
      const f0 = rt2pi * Math.exp(0.5 * u0 * u0) * normCdf(u0);
      const fm = rt2pi * Math.exp(0.5 * um * um) * normCdf(um);
      const f1 = rt2pi * Math.exp(0.5 * u1 * u1) * normCdf(u1);
      accF += (OU_GRID_STEP / 6) * (f0 + 4 * fm + f1);
      OU_F[i] = accF;
    }
    let accG = 0;
    for (let i = 1; i <= 400; i++) {
      const x0 = (i - 1) * OU_GRID_STEP, x1 = x0 + OU_GRID_STEP, xm = 0.5 * (x0 + x1);
      const g0 = rt2pi * Math.exp(0.5 * x0 * x0) * (normCdf(x0) - 0.5);
      const gm = rt2pi * Math.exp(0.5 * xm * xm) * (normCdf(xm) - 0.5);
      const g1 = rt2pi * Math.exp(0.5 * x1 * x1) * (normCdf(x1) - 0.5);
      accG += (OU_GRID_STEP / 6) * (g0 + 4 * gm + g1);
      OU_G[i] = accG;
    }
  }
  function interpOuF(u) {
    const c = Math.max(-4, Math.min(4, u));
    const pos = (c - OU_GRID_MIN) / OU_GRID_STEP;
    const idx = Math.min(OU_GRID_N - 2, Math.max(0, Math.floor(pos)));
    return OU_F[idx] + (pos - idx) * (OU_F[idx + 1] - OU_F[idx]);
  }
  function interpOuG(x) {
    const c = Math.max(0, Math.min(4, x));
    const pos = c / OU_GRID_STEP;
    const idx = Math.min(399, Math.max(0, Math.floor(pos)));
    return OU_G[idx] + (pos - idx) * (OU_G[idx + 1] - OU_G[idx]);
  }

  /* Оценка параметров непрерывного процесса Орнштейна — Уленбека dX = θ(μ − X)dt + σ_ou dW по дискретному ряду. */
  function ouFit(series) {
    const n = series.length;
    if (n < 10) return { theta: 0.15, halfLife: Math.LN2 / 0.15, mu: 0, sigmaEq: 1.5, sigmaOu: 1.0, phi: 0.86 };
    const xPrev = series.slice(0, n - 1), xNext = series.slice(1, n);
    const fit = ols(xPrev, xNext);
    const phi = Math.max(0.08, Math.min(0.985, fit.k));
    const theta = -Math.log(phi);
    const mu = Math.abs(1 - phi) > 1e-4 ? fit.alpha / (1 - phi) : fit.my;
    const resVar = fit.rss / Math.max(1, n - 2);
    const sigmaEq = Math.sqrt(Math.max(1e-6, resVar / Math.max(0.02, 1 - phi * phi)));
    const sigmaOu = sigmaEq * Math.sqrt(2 * theta);
    return { theta, halfLife: Math.LN2 / theta, mu, sigmaEq, sigmaOu, phi };
  }

  /* Точные модельные метрики одного торгового цикла OU (Bertram 2010): ожидание времени в сделке, ожидания входа и скорости прибыли. */
  function ouCycleMetrics(entryZ, exitZ, theta, sigmaEq, costPts) {
    const a = entryZ, m = exitZ;
    if (a <= m + 0.03 || theta <= 0 || sigmaEq <= 0) {
      return { holdDays: 999, waitDays: 999, cycleDays: 1998, netPerTrade: -costPts, ratePerDay: -costPts, rate100d: -100 * costPts };
    }
    const holdDays = Math.max(0.2, (interpOuF(-m) - interpOuF(-a)) / theta);
    const mAbs = Math.min(a - 0.02, Math.abs(m));
    const waitDays = Math.max(0.1, (interpOuG(a) - interpOuG(mAbs)) / theta);
    const cycleDays = holdDays + waitDays;
    const netPerTrade = (a - m) * sigmaEq - costPts;
    const ratePerDay = netPerTrade / cycleDays;
    return { holdDays, waitDays, cycleDays, netPerTrade, ratePerDay, rate100d: ratePerDay * 100 };
  }

  /* Оптимальные по модели OU границы Бертрама под заданные (θ, σ_eq, c): шире издержки c → шире оптимальный порог входа. */
  function bertramBands(theta, sigmaEq, costPts, opts) {
    const o = Object.assign({ minHyst: 0.35, holdPenalty: 0.05 }, opts || {});
    let best = null;
    for (let m = 0.0; m <= 0.80; m += 0.10) {
      for (let a = Math.max(0.70, m + o.minHyst); a <= 3.10; a += 0.10) {
        const met = ouCycleMetrics(a, m, theta, sigmaEq, costPts);
        const adjNet = met.netPerTrade - o.holdPenalty * sigmaEq * (met.holdDays / 10);
        const score = (adjNet / met.cycleDays) / Math.sqrt(1 + 0.04 * met.holdDays);
        if (!best || score > best.score) {
          best = Object.assign({ entryZ: round2(a), exitZ: round2(m), hystZ: round2(a - m), score }, met);
        }
      }
    }
    return best;
  }

  /* Волю-адаптивные полосы (Стратегия C): плавное сужение в тихий рынок и расширение при всплеске волатильности (EWMA/GARCH-логика). */
  function volAdaptiveBands(series, opts) {
    const o = Object.assign({ baseEntry: 1.75, baseExit: 0.30, gamma: 0.85, minMult: 0.65, maxMult: 1.95 }, opts || {});
    const n = series.length;
    const fastVol = new Array(n).fill(null), slowVol = new Array(n).fill(null);
    const mult = new Array(n).fill(1), entryBand = new Array(n).fill(o.baseEntry), exitBand = new Array(n).fill(o.baseExit);
    if (!n) return { fastVol, slowVol, mult, entryBand, exitBand };
    let vFast = 1.5, vSlow = 1.5;
    for (let t = 1; t < n; t++) {
      const r = series[t] - series[t - 1], r2 = r * r;
      vFast = 0.24 * r2 + 0.76 * vFast;
      vSlow = 0.025 * r2 + 0.975 * vSlow;
      const sf = Math.sqrt(Math.max(1e-6, vFast)), ss = Math.sqrt(Math.max(1e-6, vSlow));
      fastVol[t] = sf; slowVol[t] = ss;
      const m = Math.max(o.minMult, Math.min(o.maxMult, Math.pow(sf / ss, o.gamma)));
      mult[t] = m;
      entryBand[t] = round2(o.baseEntry * m);
      exitBand[t] = round2(o.baseExit * Math.min(1.25, m));
    }
    return { fastVol, slowVol, mult, entryBand, exitBand };
  }

  /* Carry-overlay: асимметричные пороги по знаку систематического переноса и блокировка входа против сильного дрейфа. */
  function carryOverlayBands(baseEntryZ, baseExitZ, dailyCarry, sigmaEq, holdDaysEst) {
    const safeSig = Math.max(0.25, sigmaEq);
    const expectedCarryPts = dailyCarry * Math.max(2, holdDaysEst || 6);
    const carryInSigma = expectedCarryPts / safeSig;
    const shift = Math.min(0.85, Math.abs(carryInSigma) * 0.65);
    let shortEntry = baseEntryZ, longEntry = baseEntryZ;
    let blockLong = false, blockShort = false, label = 'neutral';
    if (dailyCarry > 0.01) {
      shortEntry = Math.max(0.80, baseEntryZ - shift * 0.65);
      longEntry = baseEntryZ + shift * 1.20;
      if (carryInSigma > 0.55 * baseEntryZ) { blockLong = true; label = 'drift_against_long'; }
      else label = 'short_favored';
    } else if (dailyCarry < -0.01) {
      longEntry = Math.max(0.80, baseEntryZ - shift * 0.65);
      shortEntry = baseEntryZ + shift * 1.20;
      if (-carryInSigma > 0.55 * baseEntryZ) { blockShort = true; label = 'drift_against_short'; }
      else label = 'long_favored';
    }
    return {
      shortEntry: round2(shortEntry), longEntry: round2(longEntry), exitZ: round2(baseExitZ),
      carryInSigma: round2(carryInSigma), blockLong, blockShort, label
    };
  }

  const BAND_SCENARIOS = [
    {
      id: 'fast_tight_cost',
      name: 'Быстрая пружина и низкая комиссия (t½ ≈ 3,1 дн., c = 0,30 п.)',
      opts: { phi: 0.80, sdCalm: 1.6, sdStorm: 1.6, stormStart: -1, stormEnd: -1, cost: 0.30, dailyCarry: 0 },
      note: 'Спред быстро сходится при скромных издержках: шаблон «ждать 2,0σ» упускает две трети рабочих движений, а границы Бертрама опускают порог к ~1,0σ с правильным зазором гистерезиса.'
    },
    {
      id: 'heavy_friction',
      name: 'Тяжёлые издержки широкого стакана (c = 2,20 п. на круг)',
      opts: { phi: 0.88, sdCalm: 1.25, sdStorm: 1.25, stormStart: -1, stormEnd: -1, cost: 2.20, dailyCarry: 0 },
      note: 'Высокое трение стакана: узкий зазор без гистерезиса превращается в убыточную «пилу» на комиссиях, тогда как модель Бертрама автоматически раздвигает полосы под дорогую сделку.'
    },
    {
      id: 'vol_clusters',
      name: 'Кластеры волатильности: тихий плёс и бурный шторм',
      opts: { phi: 0.87, sdCalm: 0.70, sdStorm: 3.80, stormStart: 100, stormEnd: 220, cost: 0.95, dailyCarry: 0 },
      note: 'Полгода спред еле шевелится, а в середине года налетает шторм с двойным проскальзыванием. Волю-адаптивные полосы сжимаются в штиль и расширяются в бурю, обходя неподвижный шаблон 2σ.'
    },
    {
      id: 'strong_carry',
      name: 'Сильный перенос в пользу шорта (+0,38 п./день)',
      opts: { phi: 0.87, sdCalm: 1.35, sdStorm: 1.35, stormStart: -1, stormEnd: -1, cost: 0.65, dailyCarry: 0.38 },
      note: 'Устойчивый контанго-перенос тянет сырой спред вниз: наивные стратегии путают плановый дрейф с «дешёвой ценой» и покупают против течения, а Carry-overlay блокирует встречный вход и собирает премию.'
    }
  ];

  function genBand(opts) {
    const o = Object.assign({
      seed: 7, n: 320, phi: 0.78, sdCalm: 1.8, sdStorm: 1.8,
      stormStart: -1, stormEnd: -1, cost: 0.45, dailyCarry: 0
    }, opts || {});
    const rng = mulberry32(o.seed), gauss = makeGauss(rng);
    const clean = new Array(o.n), raw = new Array(o.n), inStorm = new Array(o.n).fill(false);
    let u = 0, carryCum = 0;
    for (let t = 0; t < o.n; t++) {
      const storm = o.stormStart >= 0 && t >= o.stormStart && t <= o.stormEnd;
      inStorm[t] = storm;
      const sd = storm ? o.sdStorm : o.sdCalm;
      u = o.phi * u + gauss() * sd;
      carryCum -= o.dailyCarry;
      clean[t] = round2(u);
      raw[t] = round2(u + carryCum);
    }
    return { clean, raw, inStorm, opts: o };
  }

  function genBandScenario(seed, scen) {
    const sc = typeof scen === 'string' ? (BAND_SCENARIOS.find((x) => x.id === scen) || BAND_SCENARIOS[0]) : (scen || BAND_SCENARIOS[0]);
    return genBand(Object.assign({ seed: seed || 7 }, sc.opts));
  }

  function backtestBands(bd, params) {
    const p = Object.assign({
      n: 45, stopZ: 3.6, maxHold: 30,
      bandMode: 'ou_carry_pro'
    }, params || {});
    const baseCost = p.cost !== undefined ? p.cost : bd.opts.cost;
    const barCost = (idx) => baseCost * (bd.inStorm[idx] ? 2.4 : 1.0);
    const dailyCarry = bd.opts.dailyCarry || 0;
    const len = bd.clean.length;

    const sigSer = p.bandMode === 'ou_carry_pro' ? bd.clean : bd.raw;
    const st = rolling(sigSer, p.n);
    const va = volAdaptiveBands(sigSer, { baseEntry: 1.75, baseExit: 0.30, gamma: 0.85 });

    const upBand = new Array(len).fill(null), dnBand = new Array(len).fill(null), exBand = new Array(len).fill(null);
    const carryLabel = new Array(len).fill('neutral');
    const trades = [], equity = new Array(len).fill(0), pos = new Array(len).fill(0);
    let cur = 0, entry = null, realized = 0;

    for (let t = 0; t < len; t++) {
      const z = st.z[t];
      if (z !== null) {
        let shortIn = 2.0, longIn = 2.0, outZ = 0.4, allowLong = true, allowShort = true;
        if (p.bandMode === 'no_hyst') {
          shortIn = 0.70; longIn = 0.70; outZ = 0.65;
        } else if (p.bandMode === 'fixed_2s') {
          shortIn = 2.0; longIn = 2.0; outZ = 0.40;
        } else if (p.bandMode === 'vol_adapt') {
          shortIn = va.entryBand[t]; longIn = va.entryBand[t]; outZ = va.exitBand[t];
        } else {
          const sub = bd.clean.slice(Math.max(0, t - 60), t + 1);
          const ou = ouFit(sub);
          const bb = bertramBands(ou.theta, Math.max(0.5, st.std[t]), baseCost);
          const ov = carryOverlayBands(bb.entryZ, bb.exitZ, dailyCarry, Math.max(0.5, st.std[t]), bb.holdDays);
          shortIn = ov.shortEntry; longIn = ov.longEntry; outZ = ov.exitZ;
          allowLong = !ov.blockLong; allowShort = !ov.blockShort;
          carryLabel[t] = ov.label;
        }
        upBand[t] = shortIn; dnBand[t] = -longIn; exBand[t] = outZ;

        if (cur !== 0) entry.carryAcc += (-cur) * dailyCarry;

        if (cur === 0) {
          if (z >= shortIn && allowShort) {
            cur = -1;
            const hf = 0.5 * barCost(t);
            entry = { dir: -1, idx: t, valIn: bd.clean[t], zIn: z, carryAcc: 0, openFee: hf };
            realized -= hf;
          } else if (z <= -longIn && allowLong) {
            cur = 1;
            const hf = 0.5 * barCost(t);
            entry = { dir: 1, idx: t, valIn: bd.clean[t], zIn: z, carryAcc: 0, openFee: hf };
            realized -= hf;
          }
        } else {
          const held = t - entry.idx;
          const hitTarget = (cur === -1 && z <= outZ) || (cur === 1 && z >= -outZ);
          const hitStop = (cur === -1 && z >= Math.max(p.stopZ, shortIn + 1.3)) || (cur === 1 && z <= -Math.max(p.stopZ, longIn + 1.3));
          const hitTime = p.maxHold > 0 && held >= p.maxHold;
          if (hitTarget || hitStop || hitTime) {
            const reason = hitStop ? 'stop' : hitTarget ? 'target' : 'time';
            const pricePnl = cur * (bd.clean[t] - entry.valIn);
            const gross = pricePnl + entry.carryAcc;
            const cf = 0.5 * barCost(t);
            const totCost = entry.openFee + cf;
            trades.push({
              dir: cur, signalIn: entry.idx, entryIdx: entry.idx, exitIdx: t, signalOut: t, bars: held,
              entryZ: round2(entry.zIn), exitZ: round2(z),
              pricePnl: round2(pricePnl), carryPnl: round2(entry.carryAcc),
              gross: round2(gross), cost: round2(totCost), net: round2(gross - totCost), reason
            });
            realized += gross - cf;
            cur = 0; entry = null;
          }
        }
      }
      pos[t] = cur;
      equity[t] = realized + (cur !== 0 ? cur * (bd.clean[t] - entry.valIn) + entry.carryAcc : 0);
    }
    if (cur !== 0) {
      const last = len - 1;
      const pricePnl = cur * (bd.clean[last] - entry.valIn);
      const gross = pricePnl + entry.carryAcc;
      const cf = 0.5 * barCost(last);
      const totCost = entry.openFee + cf;
      trades.push({
        dir: cur, signalIn: entry.idx, entryIdx: entry.idx, exitIdx: last, signalOut: last, bars: last - entry.idx,
        entryZ: round2(entry.zIn), exitZ: round2(st.z[last] || 0),
        pricePnl: round2(pricePnl), carryPnl: round2(entry.carryAcc),
        gross: round2(gross), cost: round2(totCost), net: round2(gross - totCost), reason: 'end'
      });
      realized += gross - cf;
      pos[last] = 0; equity[last] = realized;
    }
    const m = metrics(trades, equity, pos);
    return {
      params: p, trades, equity, pos, upBand, dnBand, exBand, carryLabel,
      z: st.z, mean: st.mean, std: st.std, volAdapt: va, metrics: m
    };
  }

  function explainBands(bd, n, t, opts) {
    if (t < n - 1) return null;
    const o = Object.assign({ bandMode: 'ou_carry_pro' }, opts || {});
    const baseCost = bd.opts.cost;
    const dailyCarry = bd.opts.dailyCarry || 0;
    const sub = bd.clean.slice(Math.max(0, t - 60), t + 1);
    const ou = ouFit(sub);
    const exClean = explainBar(bd.clean, n, t);
    const exRaw = explainBar(bd.raw, n, t);
    const bb = bertramBands(ou.theta, Math.max(0.5, exClean.std), baseCost);
    const ov = carryOverlayBands(bb.entryZ, bb.exitZ, dailyCarry, Math.max(0.5, exClean.std), bb.holdDays);
    const va = volAdaptiveBands(bd.clean.slice(0, t + 1), { baseEntry: 1.75, baseExit: 0.30, gamma: 0.85 });
    return {
      t, cleanVal: bd.clean[t], rawVal: bd.raw[t], inStorm: bd.inStorm[t],
      dailyCarry, baseCost, effCost: baseCost * (bd.inStorm[t] ? 2.4 : 1.0),
      ou, bertram: bb, overlay: ov,
      volMult: va.mult[t], volEntry: va.entryBand[t], volExit: va.exitBand[t],
      zClean: exClean.z, zRaw: exRaw.z, stdClean: exClean.std, meanClean: exClean.mean
    };
  }

  /* ===== Переключение режимов (HMM) и копула-зависимость с Mispricing Index (#62, #49) ===== */

  function normInv(p) {
    const q = Math.max(1e-6, Math.min(1 - 1e-6, p));
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const pLow = 0.02425, pHigh = 1 - pLow;
    if (q < pLow) {
      const r = Math.sqrt(-2 * Math.log(q));
      return (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) /
             ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
    }
    if (q <= pHigh) {
      const r = q - 0.5, s = r * r;
      return (((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r /
             (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1);
    }
    const r = Math.sqrt(-2 * Math.log(1 - q));
    return -(((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) /
             ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
  }

  function t2Inv(p) {
    const q = Math.max(1e-5, Math.min(1 - 5e-6, p));
    return 2 * (q - 0.5) / Math.sqrt(2 * q * (1 - q));
  }

  function t3Cdf(x) {
    const s3 = Math.sqrt(3);
    return 0.5 + (1 / Math.PI) * ((x / (s3 * (1 + x * x / 3))) + Math.atan(x / s3));
  }

  const HMM_DEFAULT_TRANS = [
    [0.93, 0.04, 0.03],
    [0.14, 0.83, 0.03],
    [0.04, 0.04, 0.92]
  ];

  function gaussPdf(x, mu, sig) {
    const s = Math.max(1e-4, sig);
    const z = (x - mu) / s;
    return Math.exp(-0.5 * z * z) / (2.5066282746310002 * s);
  }

  function hmmEntropy(probs) {
    let h = 0;
    for (let k = 0; k < 3; k++) {
      const p = Math.max(1e-9, probs[k]);
      h -= p * Math.log(p);
    }
    return Math.max(0, Math.min(1, h / Math.log(3)));
  }

  /* Один каузальный шаг фильтра Гамильтона (3 режима: 0=возврат, 1=шторм, 2=распад/дрейф). */
  function hmmStep(prevProbs, dx, devPrev, recentDrift, dirRatio, baseSig, trans) {
    const P = trans || HMM_DEFAULT_TRANS;
    const s0 = Math.max(0.25, baseSig * 1.05);
    const s1 = Math.max(0.65, baseSig * 3.25);
    const s2 = Math.max(0.35, baseSig * 1.20);

    const pred = [0, 0, 0];
    for (let j = 0; j < 3; j++) {
      pred[j] = prevProbs[0] * P[0][j] + prevProbs[1] * P[1][j] + prevProbs[2] * P[2][j];
    }

    // Режим 0 (возврат): пружина тянет назад (-0.25 * devPrev), умеренный шум s0
    // Режим 1 (шторм): двусторонняя болтанка широкой амплитуды s1 (низкая однонаправленность dirRatio)
    // Режим 2 (распад/дрейф): однонаправленный уход от равновесия (высокий dirRatio и выход за коридор стационарности)
    const mu0 = -0.25 * devPrev;
    const mu1 = 0;
    const signDrift = (recentDrift !== 0 ? recentDrift : devPrev) >= 0 ? 1 : -1;
    const mu2 = signDrift * Math.max(0.42 * baseSig, Math.abs(recentDrift));

    const stretch = Math.abs(devPrev) / Math.max(0.5, 4.0 * baseSig);
    const isOneWay = Math.max(0, (dirRatio || 0) - 0.38);

    const l0 = gaussPdf(dx, mu0, s0) * (stretch > 1.15 ? Math.exp(-1.1 * (stretch - 1.15) * (stretch - 1.15)) : 1);
    const l1 = gaussPdf(dx, mu1, s1) * (1 - 0.45 * isOneWay);
    const l2 = gaussPdf(dx, mu2, s2) * Math.exp(1.25 * isOneWay + (stretch > 1.05 ? 0.65 * Math.min(2, stretch - 1.05) : -0.35));

    const raw = [pred[0] * l0, pred[1] * l1, pred[2] * l2];
    const norm = raw[0] + raw[1] + raw[2] || 1e-12;
    const post = [raw[0] / norm, raw[1] / norm, raw[2] / norm];
    const entropy = hmmEntropy(post);
    return {
      pred,
      lik: [l0, l1, l2],
      post,
      entropy,
      confidence: 1 - entropy,
      means: [mu0, mu1, mu2],
      sigmas: [s0, s1, s2]
    };
  }

  function regimeGate(probs, opts) {
    const o = Object.assign({ breakCut: 0.42, exitBreakCut: 0.58, stormCut: 0.38, uncertCut: 0.84 }, opts || {});
    const pRev = probs[0], pStorm = probs[1], pBreak = probs[2];
    const entropy = hmmEntropy(probs);
    const conf = 1 - entropy;
    if (pBreak >= o.breakCut) {
      return {
        state: 'blocked_break',
        sizeMult: 0,
        bandMult: 1.8,
        forceExit: pBreak >= o.exitBreakCut,
        entropy,
        confidence: conf,
        label: 'Распад связи — запрет входа'
      };
    }
    if (entropy >= o.uncertCut) {
      return {
        state: 'paused_uncertain',
        sizeMult: 0,
        bandMult: 1.5,
        forceExit: false,
        entropy,
        confidence: conf,
        label: 'Серая зона 50/50 — пауза'
      };
    }
    if (pStorm >= o.stormCut) {
      return {
        state: 'storm_cautious',
        sizeMult: 0.25,
        bandMult: 1.55,
        forceExit: false,
        entropy,
        confidence: conf,
        label: 'Волатильный шторм — четверть лота'
      };
    }
    // В уверенном возвратном режиме (pRev >= 0.62) работаем полным лотом 1.0, при сомнениях плавно снижаем
    const rawSize = pRev >= 0.62 && entropy < 0.72 ? 1.0 : Math.min(1.0, Math.max(0.5, pRev / 0.62));
    return {
      state: 'active_rev',
      sizeMult: Math.round(rawSize * 20) / 20,
      bandMult: 1.0,
      forceExit: false,
      entropy,
      confidence: conf,
      label: 'Спокойный возврат — рабочий вход'
    };
  }

  function hmmFilter(series, opts) {
    const o = Object.assign({ anchorWin: 55, driftWin: 12, trans: HMM_DEFAULT_TRANS }, opts || {});
    const len = series.length;
    const pRev = new Array(len).fill(0.82);
    const pStorm = new Array(len).fill(0.11);
    const pBreak = new Array(len).fill(0.07);
    const entropy = new Array(len).fill(hmmEntropy([0.82, 0.11, 0.07]));
    const gates = new Array(len).fill(null);

    let cur = [0.82, 0.11, 0.07];
    gates[0] = regimeGate(cur, o);

    let calmSig = 1.0;
    for (let t = 1; t < len; t++) {
      const aEnd = Math.max(1, t - 12);
      const aStart = Math.max(0, aEnd - o.anchorWin);
      const anchorSlice = series.slice(aStart, aEnd);
      const anchorMean = anchorSlice.length ? median(anchorSlice) : series[0];

      const dStart = Math.max(1, t - o.anchorWin);
      const absDiffs = [];
      for (let k = dStart; k < t; k++) absDiffs.push(Math.abs(series[k] - series[k - 1]));
      if (absDiffs.length >= 8) {
        const medSig = Math.max(0.35, median(absDiffs) * MAD_SCALE * 0.90);
        calmSig = t < 25 ? medSig : (0.95 * calmSig + 0.05 * Math.min(calmSig * 1.35, medSig));
      }

      const j0 = Math.max(1, t - o.driftWin);
      let drSum = 0, absSum = 0, drCnt = 0;
      for (let k = j0; k <= t; k++) {
        const stepD = series[k] - series[k - 1];
        drSum += stepD;
        absSum += Math.abs(stepD);
        drCnt++;
      }
      const recentDrift = drCnt > 0 ? drSum / drCnt : 0;
      const dirRatio = absSum > 1e-6 ? Math.abs(drSum) / absSum : 0;

      const dx = series[t] - series[t - 1];
      const devPrev = series[t - 1] - anchorMean;
      const step = hmmStep(cur, dx, devPrev, recentDrift, dirRatio, calmSig, o.trans);
      cur = step.post;
      pRev[t] = cur[0];
      pStorm[t] = cur[1];
      pBreak[t] = cur[2];
      entropy[t] = step.entropy;
      gates[t] = regimeGate(cur, o);
    }
    return { pRev, pStorm, pBreak, entropy, gates };
  }

  function copulaParamFromTau(family, tauRaw) {
    const tau = Math.max(0.05, Math.min(0.88, tauRaw));
    if (family === 'clayton') return (2 * tau) / (1 - tau);
    if (family === 'gumbel') return 1 / (1 - tau);
    return Math.sin(0.5 * Math.PI * tau);
  }

  function copulaH(uRaw, vRaw, family, param) {
    const u = Math.max(0.002, Math.min(0.998, uRaw));
    const v = Math.max(0.002, Math.min(0.998, vRaw));
    if (family === 'clayton') {
      const th = Math.max(0.05, param);
      const sum = Math.pow(u, -th) + Math.pow(v, -th) - 1;
      if (sum <= 0) return 0.5;
      return Math.max(0.001, Math.min(0.999, Math.pow(v, -(th + 1)) * Math.pow(sum, -(1 + 1 / th))));
    }
    if (family === 'gumbel') {
      const th = Math.max(1.01, param);
      const x = -Math.log(u), y = -Math.log(v);
      const s = Math.pow(x, th) + Math.pow(y, th);
      const A = Math.pow(s, 1 / th);
      const C = Math.exp(-A);
      const h = C * Math.pow(s, 1 / th - 1) * Math.pow(y, th - 1) / v;
      return Math.max(0.001, Math.min(0.999, h));
    }
    if (family === 'student') {
      const rho = Math.max(-0.96, Math.min(0.96, param));
      const tu = t2Inv(u), tv = t2Inv(v);
      const scale = Math.sqrt(((2 + tv * tv) * (1 - rho * rho)) / 3);
      return Math.max(0.001, Math.min(0.999, t3Cdf((tu - rho * tv) / Math.max(1e-6, scale))));
    }
    const rho = Math.max(-0.96, Math.min(0.96, param));
    const zu = normInv(u), zv = normInv(v);
    return Math.max(0.001, Math.min(0.999, normCdf((zu - rho * zv) / Math.sqrt(1 - rho * rho))));
  }

  function copulaTailDep(family, param) {
    if (family === 'clayton') {
      const th = Math.max(0.05, param);
      return { lower: Math.pow(2, -1 / th), upper: 0 };
    }
    if (family === 'gumbel') {
      const th = Math.max(1.01, param);
      return { lower: 0, upper: 2 - Math.pow(2, 1 / th) };
    }
    if (family === 'student') {
      const rho = Math.max(-0.96, Math.min(0.96, param));
      const lam = 2 * t3Cdf(-Math.sqrt(3 * (1 - rho) / (1 + rho)));
      return { lower: lam, upper: lam };
    }
    return { lower: 0, upper: 0 };
  }

  function copulaSample2D(seed, count, family, tau) {
    const rng = mulberry32(seed);
    const param = copulaParamFromTau(family, tau);
    const pts = [];
    for (let i = 0; i < count; i++) {
      const u = 0.004 + 0.992 * rng();
      const w = 0.004 + 0.992 * rng();
      let uOut = u, vOut = w;
      if (family === 'clayton') {
        const th = Math.max(0.05, param);
        vOut = Math.pow((Math.pow(w, -th / (1 + th)) - 1) * Math.pow(u, -th) + 1, -1 / th);
        vOut = Math.max(0.002, Math.min(0.998, vOut));
      } else if (family === 'gumbel') {
        let lo = 0.002, hi = 0.998;
        for (let it = 0; it < 14; it++) {
          const mid = 0.5 * (lo + hi);
          if (copulaH(mid, u, 'gumbel', param) < w) lo = mid; else hi = mid;
        }
        vOut = 0.5 * (lo + hi);
      } else if (family === 'student') {
        const q = Math.max(1e-4, rng());
        const scale = Math.sqrt(2 / (-2 * Math.log(q)));
        const z1 = normInv(u), z2 = param * z1 + Math.sqrt(1 - param * param) * normInv(w);
        const t1 = scale * z1, t2 = scale * z2;
        uOut = Math.max(0.002, Math.min(0.998, 0.5 + t1 / (2 * Math.sqrt(2 + t1 * t1))));
        vOut = Math.max(0.002, Math.min(0.998, 0.5 + t2 / (2 * Math.sqrt(2 + t2 * t2))));
      } else {
        const z1 = normInv(u), z2 = param * z1 + Math.sqrt(1 - param * param) * normInv(w);
        vOut = Math.max(0.002, Math.min(0.998, normCdf(z2)));
      }
      pts.push({ u: uOut, v: vOut, x: normInv(uOut), y: normInv(vOut) });
    }
    return { family, tau, param, tails: copulaTailDep(family, param), pts };
  }

  function fastWindowTau(subA, subB) {
    const n = subA.length;
    if (n < 6) return 0.5;
    const idxA = new Array(n), idxB = new Array(n);
    for (let i = 0; i < n; i++) { idxA[i] = i; idxB[i] = i; }
    idxA.sort((i, j) => subA[i] - subA[j]);
    idxB.sort((i, j) => subB[i] - subB[j]);
    const rA = new Array(n), rB = new Array(n);
    for (let r = 0; r < n; r++) { rA[idxA[r]] = r; rB[idxB[r]] = r; }
    let d2 = 0;
    for (let i = 0; i < n; i++) { const d = rA[i] - rB[i]; d2 += d * d; }
    const rhoS = 1 - (6 * d2) / (n * (n * n - 1));
    return Math.max(0.08, Math.min(0.86, (2 / Math.PI) * Math.asin(Math.max(-0.98, Math.min(0.98, rhoS)))));
  }

  function mispricingIndex(legA, legB, opts) {
    const o = Object.assign({ win: 60, family: 'student', decay: 0.72 }, opts || {});
    const len = legA.length;
    const uArr = new Array(len).fill(0.5);
    const vArr = new Array(len).fill(0.5);
    const h12 = new Array(len).fill(0.5);
    const h21 = new Array(len).fill(0.5);
    const tauArr = new Array(len).fill(0.55);
    const rankSpread = new Array(len).fill(0.5);
    const mi = new Array(len).fill(0);

    const dA = new Array(len).fill(0), dB = new Array(len).fill(0);
    for (let t = 1; t < len; t++) {
      dA[t] = legA[t] - legA[t - 1];
      dB[t] = legB[t] - legB[t - 1];
    }

    let cumStep = 0, lastTau = 0.55;
    for (let t = 1; t < len; t++) {
      const i0 = Math.max(1, t - o.win);
      const cnt = t - i0;
      if (cnt < 10) continue;

      let lessA = 0, lessB = 0, lessSp = 0;
      const spNow = legA[t] - legB[t];
      for (let k = i0; k < t; k++) {
        if (dA[k] < dA[t]) lessA++; else if (dA[k] === dA[t]) lessA += 0.5;
        if (dB[k] < dB[t]) lessB++; else if (dB[k] === dB[t]) lessB += 0.5;
        const spK = legA[k] - legB[k];
        if (spK < spNow) lessSp++; else if (spK === spNow) lessSp += 0.5;
      }
      const u = Math.max(0.015, Math.min(0.985, (lessA + 0.5) / (cnt + 1)));
      const v = Math.max(0.015, Math.min(0.985, (lessB + 0.5) / (cnt + 1)));
      const rSp = Math.max(0.015, Math.min(0.985, (lessSp + 0.5) / (cnt + 1)));

      if (t % 3 === 0 || t < i0 + 14) {
        lastTau = fastWindowTau(dA.slice(i0, t), dB.slice(i0, t));
      }
      const param = copulaParamFromTau(o.family, lastTau);
      const p12 = copulaH(u, v, o.family, param);
      const p21 = copulaH(v, u, o.family, param);

      const stepMis = (p12 - 0.5) - (p21 - 0.5);
      cumStep = o.decay * cumStep + stepMis;
      const rankZ = normInv(rSp);

      // Шкала сопоставима с z-score (порог входа ±1,75): ранговый уровень + условный импульс копулы
      const rawMi = 0.76 * rankZ + 0.95 * cumStep;
      uArr[t] = u; vArr[t] = v;
      h12[t] = p12; h21[t] = p21;
      tauArr[t] = lastTau;
      rankSpread[t] = rSp;
      mi[t] = Math.max(-3.6, Math.min(3.6, rawMi));
    }
    return { u: uArr, v: vArr, h12, h21, tau: tauArr, rankSpread, mi };
  }

  const REGIME_SCENARIOS = [
    {
      id: 'quiet_break',
      name: 'Тихий распад связи без всплеска шума',
      note: 'До 145-го дня пара образцово возвращается к среднему, а затем без грома и всплеска волатильности уходит в снос: ни обычный Z-score, ни чистая копула без HMM не видят поломки.',
      opts: { mode: 'quiet_break', cost: 0.38, copulaFamily: 'student', copulaWin: 60 }
    },
    {
      id: 'storm_grey',
      name: 'Чередование штиля, дорогих бурь и серых зон 50/50',
      note: 'В штормовых эпизодах стакан пустеет (издержки ×4,5) и уровень спреда блуждает со сдвигом плато: торговля полным объёмом в бурю и в серых зонах 50/50 сжигает счёт.',
      opts: { mode: 'storm_grey', cost: 0.50, copulaFamily: 'student', copulaWin: 60 }
    },
    {
      id: 'clayton_tails',
      name: 'Совместные обвалы в нижнем хвосте и тяжёлые шпили',
      note: 'Ноги сцеплены копулой Клейтона в обвалах, а редкие экстремальные шпили раздувают линейное σ на месяцы вперёд, ослепляя обычный Z-score на рабочих расхождениях.',
      opts: { mode: 'clayton_tails', cost: 0.35, copulaFamily: 'clayton', copulaWin: 65 }
    },
    {
      id: 'short_sample_v3',
      name: 'Короткая шумная выборка (урок осторожности v3)',
      note: 'Окно калибровки копулы сжато до W = 12 дней при широком стакане (c = 1,15 п.) и микрошуме ног: тонкая хвостовая модель переторговывает шум и уступает простому HMM-гейту.',
      opts: { mode: 'short_sample_v3', cost: 1.15, copulaFamily: 'gumbel', copulaWin: 12 }
    }
  ];

  function genRegime(opts) {
    const o = Object.assign({
      seed: 7, len: 320, mode: 'quiet_break', cost: 0.45, copulaFamily: 'student', copulaWin: 60
    }, opts || {});
    const rng = mulberry32(o.seed);
    const randn = () => {
      const u1 = Math.max(1e-7, rng()), u2 = rng();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    };

    const legA = new Array(o.len).fill(100);
    const legB = new Array(o.len).fill(100);
    const spread = new Array(o.len).fill(0);
    const execSpread = new Array(o.len).fill(0);
    const trueState = new Array(o.len).fill(0); // 0=rev, 1=storm, 2=break

    let b = 100, sp = 0, anchor = 0, st = 0;
    for (let t = 1; t < o.len; t++) {
      const prevSt = st;
      if (o.mode === 'quiet_break') {
        st = t < 145 ? 0 : 2;
      } else if (o.mode === 'storm_grey') {
        if ((t >= 85 && t <= 115) || (t >= 195 && t <= 230)) st = 1;
        else if (t >= 275 && t <= 302) st = 2;
        else st = 0;
      } else if (o.mode === 'clayton_tails') {
        st = t < 245 ? 0 : 2;
      } else {
        st = ((t >= 105 && t <= 128) || (t >= 225 && t <= 248)) ? 1 : 0;
      }
      trueState[t] = st;

      if (o.mode === 'clayton_tails') {
        const u1 = 0.004 + 0.992 * rng(), w = 0.004 + 0.992 * rng();
        const th = 2.9;
        const v1 = Math.max(0.002, Math.min(0.998, Math.pow((Math.pow(w, -th / (1 + th)) - 1) * Math.pow(u1, -th) + 1, -1 / th)));
        b += normInv(v1);
        if (st === 0) {
          const innov = (normInv(u1) - normInv(v1)) * 1.15;
          sp = 0.66 * sp + innov;
        } else {
          sp = sp + (o.seed % 2 === 0 ? 0.62 : -0.62) + randn() * 0.95;
        }
        // Редкие неликвидные тени в стакане раздувают обычное std на 45 баров вперёд, но не ломают ранговый MI;
        // для фильтра режимов одиночная тень на 1 бар отличается от затяжного шторма.
        const fatShadow = (rng() < 0.065 && st === 0 && (t < 3 || spread[t - 1] === execSpread[t - 1])) ? (rng() < 0.5 ? 12.5 : -12.5) : 0;
        execSpread[t] = sp;
        spread[t] = sp + fatShadow;
        legB[t] = b;
        legA[t] = b + spread[t];
      } else if (o.mode === 'storm_grey') {
        b += randn() * (st === 1 ? 2.2 : 1.0);
        if (prevSt !== 0 && st === 0) anchor = sp;
        if (st === 0) {
          sp = anchor + 0.64 * (sp - anchor) + randn() * 1.25;
        } else if (st === 1) {
          // В бурю возвратная пружина выключается (блуждание с выносом стопов в пустом стакане ×5.5)
          sp = sp + randn() * 3.6;
        } else {
          sp = sp + (o.seed % 2 === 0 ? 0.66 : -0.66) + randn() * 1.0;
        }
        execSpread[t] = sp;
        spread[t] = sp;
        legB[t] = b;
        legA[t] = b + sp;
      } else if (o.mode === 'short_sample_v3') {
        b += randn();
        if (prevSt !== 0 && st === 0) anchor = sp;
        if (st === 0) {
          sp = anchor + 0.66 * (sp - anchor) + randn() * 1.25;
        } else {
          sp = sp + randn() * 3.4;
        }
        const jitter = (rng() < 0.38 ? -3.5 : 1.2) * randn();
        execSpread[t] = sp;
        spread[t] = sp;
        legB[t] = b + jitter;
        legA[t] = b + jitter + sp;
      } else {
        b += randn();
        if (st === 0) {
          sp = 0.72 * sp + randn() * 1.05;
        } else {
          const driftStep = (o.seed % 2 === 0 ? 1 : -1) * 0.56;
          sp = sp + driftStep + randn() * 0.90;
        }
        execSpread[t] = sp;
        spread[t] = sp;
        legB[t] = b;
        legA[t] = b + sp;
      }
    }
    return { legA, legB, spread, execSpread, trueState, opts: o };
  }

  function genRegimeScenario(seed, scen) {
    const s = scen || REGIME_SCENARIOS[0];
    return genRegime(Object.assign({ seed }, s.opts));
  }

  function hmmCausalSeries(spread) {
    const out = new Array(spread.length);
    out[0] = spread[0];
    for (let t = 1; t < spread.length; t++) {
      const jump = spread[t] - out[t - 1];
      out[t] = Math.abs(jump) > 8.5 ? out[t - 1] + Math.sign(jump) * 2.2 : spread[t];
    }
    return out;
  }

  function prepareRegimeFeatures(rg, n) {
    return {
      st: rolling(rg.spread, n),
      hmm: hmmFilter(hmmCausalSeries(rg.spread), { anchorWin: n }),
      cop: mispricingIndex(rg.legA, rg.legB, {
        win: rg.opts.copulaWin || 60,
        family: rg.opts.copulaFamily || 'student'
      })
    };
  }

  function backtestRegimeCopula(rg, params) {
    const p = Object.assign({
      n: 45, entryZ: 1.75, exitZ: 0.28, entryMi: 1.75, exitMi: 0.28,
      stopZ: 4.2, maxBars: 26, mode: 'hmm_copula', precomputed: null
    }, params || {});

    const len = rg.spread.length;
    const baseCost = rg.opts.cost;
    const feat = p.precomputed || prepareRegimeFeatures(rg, p.n);
    const st = feat.st, hmm = feat.hmm, cop = feat.cop;

    const useHmm = (p.mode === 'hmm_gate' || p.mode === 'hmm_copula');
    const useCop = (p.mode === 'copula_only' || p.mode === 'hmm_copula');

    const pos = new Array(len).fill(0);
    const sizeArr = new Array(len).fill(0);
    const equity = new Array(len).fill(0);
    const signalArr = new Array(len).fill(null);
    const trades = [];

    let curDir = 0, curSize = 0, entryIdx = -1, entryExec = 0, entrySig = 0, entryFee = 0, realized = 0;

    for (let t = 0; t < len; t++) {
      const z = st.z[t];
      const mi = cop.mi[t];
      const sig = useCop ? mi : z;
      signalArr[t] = sig;

      const inStorm = rg.trueState[t] === 1;
      const halfCost = 0.5 * baseCost * (inStorm ? 5.5 : 1.0);
      const gate = hmm.gates[t];

      if (z === null || t < p.n) {
        equity[t] = realized;
        continue;
      }

      if (curDir !== 0) {
        const held = t - entryIdx;
        const exThr = useCop ? p.exitMi : p.exitZ;
        const hitTarget = (curDir === 1 && sig >= -exThr) || (curDir === -1 && sig <= exThr);
        const hitStop = !useCop && Math.abs(z) >= p.stopZ;
        const hitCopStop = useCop && Math.abs(rg.execSpread[t] - entryExec) >= 4.2 * Math.max(0.8, st.std[t] || 1);
        const hitTime = held >= p.maxBars;
        const hitRegime = useHmm && (gate.forceExit || (gate.state === 'storm_cautious' && held >= 4 && curDir * (rg.execSpread[t] - entryExec) < -1.5));

        if (hitTarget || hitStop || hitCopStop || hitTime || hitRegime) {
          const exitFee = curSize * halfCost;
          const gross = curDir * curSize * (rg.execSpread[t] - entryExec);
          const totCost = entryFee + exitFee;
          const net = gross - totCost;
          realized += net;
          trades.push({
            entryIdx, exitIdx: t, bars: held, dir: curDir, size: curSize,
            entrySig, exitSig: sig, gross, cost: totCost, net,
            reason: hitRegime ? 'stop' : (hitTarget ? 'target' : ((hitStop || hitCopStop) ? 'stop' : 'time')),
            regimeNote: hitRegime ? 'защита HMM' : gate.label
          });
          curDir = 0; curSize = 0; entryIdx = -1;
        }
      }

      if (curDir === 0) {
        const sizeMult = useHmm ? gate.sizeMult : 1.0;
        const bandMult = useHmm ? gate.bandMult : 1.0;
        const enThr = (useCop ? p.entryMi : p.entryZ) * bandMult;
        const singleBarJump = Math.abs(rg.spread[t] - rg.spread[t - 1]);
        const shadowGuard = useCop && singleBarJump > 6.5;
        if (sizeMult > 0 && !shadowGuard && (useCop || Math.abs(z) < p.stopZ)) {
          if (sig >= enThr) {
            curDir = -1; curSize = sizeMult; entryIdx = t;
            entryExec = rg.execSpread[t]; entrySig = sig; entryFee = curSize * halfCost;
          } else if (sig <= -enThr) {
            curDir = 1; curSize = sizeMult; entryIdx = t;
            entryExec = rg.execSpread[t]; entrySig = sig; entryFee = curSize * halfCost;
          }
        }
      }

      pos[t] = curDir * curSize;
      sizeArr[t] = curSize;
      const unreal = curDir !== 0 ? (curDir * curSize * (rg.execSpread[t] - entryExec) - entryFee) : 0;
      equity[t] = realized + unreal;
    }

    if (curDir !== 0) {
      const last = len - 1;
      const exitFee = curSize * 0.5 * baseCost * (rg.trueState[last] === 1 ? 4.5 : 1.0);
      const gross = curDir * curSize * (rg.execSpread[last] - entryExec);
      const totCost = entryFee + exitFee;
      const net = gross - totCost;
      realized += net;
      trades.push({
        entryIdx, exitIdx: last, bars: last - entryIdx, dir: curDir, size: curSize,
        entrySig, exitSig: signalArr[last], gross, cost: totCost, net, reason: 'end', regimeNote: 'конец ряда'
      });
      pos[last] = 0; equity[last] = realized;
    }

    const m = metrics(trades, equity, pos);
    return {
      params: p, trades, equity, pos, sizeArr, signalArr,
      z: st.z, mean: st.mean, std: st.std, hmm, copula: cop, metrics: m
    };
  }

  function explainRegimeCopula(rg, n, t) {
    if (t < n) return null;
    const subSp = rg.spread.slice(0, t + 1);
    const subA = rg.legA.slice(0, t + 1);
    const subB = rg.legB.slice(0, t + 1);
    const exZ = explainBar(subSp, n, t);
    const hmm = hmmFilter(hmmCausalSeries(subSp), { anchorWin: n });
    const cop = mispricingIndex(subA, subB, {
      win: rg.opts.copulaWin || 60,
      family: rg.opts.copulaFamily || 'student'
    });
    const fam = rg.opts.copulaFamily || 'student';
    const param = copulaParamFromTau(fam, cop.tau[t]);
    const tails = copulaTailDep(fam, param);
    return {
      t, spreadVal: rg.spread[t], execVal: rg.execSpread[t], trueState: rg.trueState[t],
      z: exZ.z, mean: exZ.mean, std: exZ.std,
      probs: [hmm.pRev[t], hmm.pStorm[t], hmm.pBreak[t]],
      entropy: hmm.entropy[t], confidence: 1 - hmm.entropy[t],
      gate: hmm.gates[t],
      u: cop.u[t], v: cop.v[t], h12: cop.h12[t], h21: cop.h21[t],
      tau: cop.tau[t], family: fam, param, tails, mi: cop.mi[t], rankSpread: cop.rankSpread[t]
    };
  }



  /* ===== Честная валидация: WFO (purging/embargo), плато/WFC, CPCV/PBO, PSR/DSR и гейт PASS (#65, #50) ===== */

  const EULER_GAMMA = 0.5772156649015329;

  function returnStats(pnlDiffs) {
    const n = pnlDiffs.length;
    if (n < 3) return { n, mean: 0, std: 0, srBar: 0, srAnn: 0, sortinoAnn: 0, skew: 0, kurt: 3, total: 0, maxDD: 0 };
    let sum = 0, eq = 0, peak = 0, maxDD = 0;
    for (let i = 0; i < n; i++) {
      sum += pnlDiffs[i];
      eq += pnlDiffs[i];
      if (eq > peak) peak = eq;
      if (peak - eq > maxDD) maxDD = peak - eq;
    }
    const mean = sum / n;
    let m2 = 0, m3 = 0, m4 = 0, down2 = 0;
    for (let i = 0; i < n; i++) {
      const d = pnlDiffs[i] - mean;
      const d2 = d * d;
      m2 += d2;
      m3 += d2 * d;
      m4 += d2 * d2;
      if (pnlDiffs[i] < 0) down2 += pnlDiffs[i] * pnlDiffs[i];
    }
    const variance = m2 / Math.max(1, n - 1);
    const std = Math.sqrt(variance);
    const downStd = Math.sqrt(down2 / n);
    if (std < 1e-8) {
      return { n, mean, std: 0, srBar: 0, srAnn: 0, sortinoAnn: 0, skew: 0, kurt: 3, total: sum, maxDD };
    }
    const srBar = mean / std;
    const srAnn = srBar * Math.sqrt(252);
    const sortinoAnn = downStd > 1e-8 ? (mean / downStd) * Math.sqrt(252) : srAnn;
    const skew = (m3 / n) / Math.pow(std, 3);
    const kurt = Math.max(1.5, (m4 / n) / Math.pow(std, 4));
    return { n, mean, std, srBar, srAnn, sortinoAnn, skew, kurt, total: sum, maxDD };
  }

  /* Probabilistic Sharpe Ratio (Bailey & López de Prado 2012): P(SR_true > srBenchAnn). */
  function calcPSR(srAnn, T, skew, kurt, srBenchAnn) {
    const nObs = Math.max(5, T || 252);
    const sr = srAnn / Math.sqrt(252);
    const sr0 = (srBenchAnn || 0) / Math.sqrt(252);
    const g3 = skew || 0;
    const g4 = Math.max(1.5, kurt === undefined ? 3 : kurt);
    const varSr = Math.max(1e-8, (1 - g3 * sr + ((g4 - 1) / 4) * sr * sr) / (nObs - 1));
    const z = (sr - sr0) / Math.sqrt(varSr);
    return { psr: normCdf(z), z, seAnn: Math.sqrt(varSr * 252) };
  }

  /* Ожидаемый максимальный годовой Sharpe среди N независимых шумовых попыток. */
  function expectedMaxSR(trialsN, stdAcrossTrialsAnn) {
    const N = Math.max(1, Math.round(trialsN || 1));
    if (N <= 1) return 0;
    const sd = Math.max(0.05, stdAcrossTrialsAnn === undefined ? 0.55 : stdAcrossTrialsAnn);
    const p1 = Math.min(0.999999, 1 - 1 / N);
    const p2 = Math.min(0.999999, 1 - 1 / (N * Math.E));
    const zMax = (1 - EULER_GAMMA) * normInv(p1) + EULER_GAMMA * normInv(p2);
    return Math.max(0, sd * zMax);
  }

  /* Deflated Sharpe Ratio (Bailey & López de Prado 2014): сдутый Шарп с учётом N попыток и хвостов. */
  function calcDSR(srAnn, T, skew, kurt, trialsN, stdAcrossTrialsAnn) {
    const sr0Ann = expectedMaxSR(trialsN, stdAcrossTrialsAnn);
    const res = calcPSR(srAnn, T, skew, kurt, sr0Ann);
    return { dsr: res.psr, sr0Ann, z: res.z, seAnn: res.seAnn };
  }

  /* Быстрый прогон Z-score стратегии на ряду спреда с возвратом пошаговых приращений P&L. */
  function quickSpreadRun(series, n, entryZ, exitZ, cost, bonusSpec) {
    const len = series.length;
    const st = rolling(series, n);
    const diffs = new Array(len).fill(0);
    // Узкий порог входа (< 1,05σ) имитирует агрессивный скальпинг с малым зазором (пилу вне выборки)
    const effExit = entryZ < 1.05 ? entryZ - 0.04 : exitZ;
    const effCost = entryZ < 1.05 ? cost * 3.1 : cost;
    let pos = 0, entryP = 0, trades = 0, grossTot = 0, feeTot = 0, prevEq = 0, realized = 0;

    for (let t = 0; t < len; t++) {
      const z = st.z[t];
      if (z === null || t < n) {
        diffs[t] = 0;
        continue;
      }
      if (pos !== 0) {
        const hitEx = (pos === 1 && z >= -effExit) || (pos === -1 && z <= effExit);
        const hitStop = Math.abs(z) >= 4.2;
        if (hitEx || hitStop) {
          const bAdd = (bonusSpec && bonusSpec.amt && t >= bonusSpec.t0 && t <= bonusSpec.t1) ? bonusSpec.amt : 0;
          const gr = pos * (series[t] - entryP) + bAdd;
          realized += gr - 0.5 * effCost;
          grossTot += gr;
          feeTot += effCost;
          trades++;
          pos = 0;
        }
      }
      if (pos === 0 && Math.abs(z) < 4.2) {
        if (z >= entryZ) {
          pos = -1; entryP = series[t]; realized -= 0.5 * effCost;
        } else if (z <= -entryZ) {
          pos = 1; entryP = series[t]; realized -= 0.5 * effCost;
        }
      }
      const unreal = pos !== 0 ? pos * (series[t] - entryP) : 0;
      const eq = realized + unreal;
      const leakEdge = (bonusSpec && bonusSpec.daily && t >= bonusSpec.t0 && t <= bonusSpec.t1) ? bonusSpec.daily : 0;
      diffs[t] = (eq - prevEq) + leakEdge;
      prevEq = eq;
    }
    const rs = returnStats(diffs.slice(n));
    return { diffs, stats: rs, trades, grossTot, feeTot, netTot: prevEq };
  }

  const VALID_N_GRID = [10, 20, 30, 40, 50, 60];
  const VALID_Z_GRID = [0.95, 1.30, 1.65, 1.95, 2.25, 2.55];

  function pearsonFlat(a, b) {
    const n = a.length;
    if (n < 3) return 0;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) {
      const xa = a[i] - ma, xb = b[i] - mb;
      num += xa * xb; da += xa * xa; db += xb * xb;
    }
    return (da > 1e-9 && db > 1e-9) ? num / Math.sqrt(da * db) : 0;
  }

  /* 2D-поверхность параметров (N × entryZ): сравнение плато и пика + расчёт WFC (Walk-Forward Correlation). */
  function paramSurface(series, opts) {
    const o = Object.assign({
      splitIdx: Math.floor(series.length * 0.62),
      purgeBars: 8,
      embargoBars: 8,
      cost: 0.45,
      nGrid: VALID_N_GRID,
      zGrid: VALID_Z_GRID,
      spikeMirage: null
    }, opts || {});

    const R = o.nGrid.length, C = o.zGrid.length;
    const isGrid = Array.from({ length: R }, () => new Array(C).fill(0));
    const oosGrid = Array.from({ length: R }, () => new Array(C).fill(0));
    const plateauGrid = Array.from({ length: R }, () => new Array(C).fill(0));
    const flatIs = [], flatOos = [];

    const isEnd = Math.max(40, o.splitIdx - o.purgeBars);
    const oosStart = Math.min(series.length - 20, o.splitIdx + o.embargoBars);

    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const nWin = o.nGrid[r], zEn = o.zGrid[c];
        const exitZ = Math.min(0.30, zEn * 0.32);
        // Мираж одиночного пика (если задан сценарием) действует только в узкой клетке на обучении
        const bonus = (o.spikeMirage && r === o.spikeMirage.r && c === o.spikeMirage.c) ? o.spikeMirage : null;
        const fullRun = quickSpreadRun(series, nWin, zEn, exitZ, o.cost, bonus);
        const isStats = returnStats(fullRun.diffs.slice(nWin, isEnd));
        const oosStats = returnStats(fullRun.diffs.slice(Math.max(nWin, oosStart)));
        isGrid[r][c] = isStats.srAnn;
        oosGrid[r][c] = oosStats.srAnn;
        flatIs.push(isStats.srAnn);
        flatOos.push(oosStats.srAnn);
      }
    }

    let peakR = 0, peakC = 0, bestPeak = -1e9;
    let platR = 2, platC = 2, bestPlatScore = -1e9;

    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        let nbSum = 0, nbCnt = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < R && nc >= 0 && nc < C) {
              nbSum += isGrid[nr][nc];
              nbCnt++;
            }
          }
        }
        const nbMean = nbCnt > 0 ? nbSum / nbCnt : isGrid[r][c];
        const centerVal = isGrid[r][c];
        const ratio = centerVal > 0.15 ? Math.max(0, Math.min(1.25, nbMean / centerVal)) : 0;
        plateauGrid[r][c] = ratio;

        if (centerVal > bestPeak) {
          bestPeak = centerVal; peakR = r; peakC = c;
        }
        // Выбираем центр широкого плато: высокое среднее соседей + штраф за обрыв краёв
        const platScore = (ratio >= 0.70 ? 0.5 : 0) + 0.30 * centerVal + 0.70 * nbMean;
        if (platScore > bestPlatScore) {
          bestPlatScore = platScore; platR = r; platC = c;
        }
      }
    }

    const wfc = pearsonFlat(flatIs, flatOos);
    // СКО годовых Sharpe по сетке нужно для честного расчёта DSR при M = R * C попытках
    const srGridStats = returnStats(flatIs);
    const stdAcrossTrials = srGridStats.std;

    return {
      nGrid: o.nGrid,
      zGrid: o.zGrid,
      isGrid,
      oosGrid,
      plateauGrid,
      wfc,
      trialsCount: R * C,
      stdAcrossTrials,
      peak: {
        r: peakR, c: peakC, n: o.nGrid[peakR], entryZ: o.zGrid[peakC],
        isSR: isGrid[peakR][peakC], oosSR: oosGrid[peakR][peakC], plateauRatio: plateauGrid[peakR][peakC]
      },
      plateau: {
        r: platR, c: platC, n: o.nGrid[platR], entryZ: o.zGrid[platC],
        isSR: isGrid[platR][platC], oosSR: oosGrid[platR][platC], plateauRatio: plateauGrid[platR][platC]
      }
    };
  }

  /* Комбинаторная пурдж-кросс-валидация CPCV на 6 блоках (C(6,3) = 20 разбиений) и расчёт PBO. */
  const CPCV_SPLITS_6_3 = (function () {
    const out = [];
    for (let a = 0; a < 6; a++) {
      for (let b = a + 1; b < 6; b++) {
        for (let c = b + 1; c < 6; c++) {
          const train = [a, b, c];
          const test = [0, 1, 2, 3, 4, 5].filter((x) => !train.includes(x));
          out.push({ id: out.length + 1, train, test });
        }
      }
    }
    return out; // ровно 20 комбинаций
  })();

  function runCPCV(series, opts) {
    const o = Object.assign({
      cost: 0.45,
      purgeBars: 6,
      embargoBars: 6,
      nList: [12, 24, 38, 52],
      zList: [1.05, 1.45, 1.85, 2.25],
      spikeMirage: null
    }, opts || {});

    const len = series.length;
    const configs = [];
    for (let r = 0; r < o.nList.length; r++) {
      for (let c = 0; c < o.zList.length; c++) {
        const nWin = o.nList[r], zEn = o.zList[c];
        const bonus = (o.spikeMirage && r === (o.spikeMirage.r === 5 ? 3 : 0) && c === 0) ? o.spikeMirage : null;
        const run = quickSpreadRun(series, nWin, zEn, Math.min(0.30, zEn * 0.32), o.cost, bonus);
        configs.push({ idx: configs.length, n: nWin, entryZ: zEn, diffs: run.diffs });
      }
    }

    const M = configs.length;
    const blockLen = Math.floor(len / 6);
    const bounds = Array.from({ length: 6 }, (_, k) => [k * blockLen, k === 5 ? len : (k + 1) * blockLen]);

    const splits = [];
    let overfitCount = 0;

    for (let s = 0; s < CPCV_SPLITS_6_3.length; s++) {
      const sp = CPCV_SPLITS_6_3[s];
      const testMask = new Uint8Array(len);
      const forbidTrain = new Uint8Array(len);

      for (const tb of sp.test) {
        const [b0, b1] = bounds[tb];
        for (let t = b0; t < b1; t++) testMask[t] = 1;
        const p0 = Math.max(0, b0 - o.purgeBars);
        const e1 = Math.min(len, b1 + o.embargoBars);
        for (let t = p0; t < e1; t++) forbidTrain[t] = 1;
      }

      const isSR = new Array(M), oosSR = new Array(M);
      let bestM = 0, bestVal = -1e9;
      for (let m = 0; m < M; m++) {
        const trDiffs = [], teDiffs = [];
        const startBar = configs[m].n;
        for (let t = startBar; t < len; t++) {
          if (testMask[t]) teDiffs.push(configs[m].diffs[t]);
          else if (!forbidTrain[t]) trDiffs.push(configs[m].diffs[t]);
        }
        isSR[m] = returnStats(trDiffs).srAnn;
        oosSR[m] = returnStats(teDiffs).srAnn;
        if (isSR[m] > bestVal) { bestVal = isSR[m]; bestM = m; }
      }

      // Какое место чемпион обучения bestM занял вне выборки среди всех M конфигураций?
      const champOos = oosSR[bestM];
      let worseCount = 0;
      for (let m = 0; m < M; m++) {
        if (oosSR[m] < champOos) worseCount++;
        else if (oosSR[m] === champOos && m !== bestM) worseCount += 0.5;
      }
      const omega = Math.max(1 / (M + 1), Math.min(M / (M + 1), (worseCount + 0.5) / M));
      const logit = Math.log(omega / (1 - omega));
      const belowMedian = omega <= 0.5;
      if (belowMedian) overfitCount++;

      splits.push({
        id: sp.id,
        trainBlocks: sp.train.map((x) => x + 1),
        testBlocks: sp.test.map((x) => x + 1),
        winnerIdx: bestM,
        winnerCfg: { n: configs[bestM].n, entryZ: configs[bestM].entryZ },
        winnerIsSR: bestVal,
        winnerOosSR: champOos,
        omega,
        logit,
        belowMedian
      });
    }

    const pbo = overfitCount / splits.length;
    return { pbo, overfitCount, totalSplits: splits.length, splits, configsCount: M };
  }

  /* Блочный бутстрап доверительного интервала Sharpe (с сохранением временной автокорреляции). */
  function blockBootstrapCI(pnlDiffs, opts) {
    const o = Object.assign({ blockLen: 12, reps: 200, seed: 42 }, opts || {});
    const n = pnlDiffs.length;
    if (n < 15) return { medianSR: 0, lo90: 0, hi90: 0, probPos: 0.5, samples: [0] };
    const rng = mulberry32(o.seed);
    const B = Math.max(1, Math.min(n - 2, o.blockLen));
    const samples = [];
    let posCnt = 0;
    for (let r = 0; r < o.reps; r++) {
      const boot = [];
      while (boot.length < n) {
        const start = Math.floor(rng() * (n - B + 1));
        for (let k = 0; k < B && boot.length < n; k++) boot.push(pnlDiffs[start + k]);
      }
      const sr = returnStats(boot).srAnn;
      samples.push(sr);
      if (sr > 0) posCnt++;
    }
    samples.sort((a, b) => a - b);
    return {
      medianSR: samples[Math.floor(samples.length * 0.50)],
      lo90: samples[Math.floor(samples.length * 0.05)],
      hi90: samples[Math.floor(samples.length * 0.95)],
      probPos: posCnt / samples.length,
      samples
    };
  }

  /* Стресс-проверка издержек: оптимистичный (0,5×), базовый (1×), 2× cost и точка безубыточности break-even. */
  function costStressTest(series, n, entryZ, exitZ, baseCost) {
    const rOpt = quickSpreadRun(series, n, entryZ, exitZ, baseCost * 0.5);
    const rBase = quickSpreadRun(series, n, entryZ, exitZ, baseCost);
    const r2x = quickSpreadRun(series, n, entryZ, exitZ, baseCost * 2.0);
    // Без издержек валовый доход / число сделок даёт точную цену на круг, при которой нетто = 0
    const rZero = quickSpreadRun(series, n, entryZ, exitZ, 0);
    const breakEvenCost = rZero.trades > 0 ? Math.max(0, rZero.netTot / rZero.trades) : 0;
    return {
      opt: { cost: baseCost * 0.5, srAnn: rOpt.stats.srAnn, net: rOpt.netTot, trades: rOpt.trades },
      base: { cost: baseCost, srAnn: rBase.stats.srAnn, net: rBase.netTot, trades: rBase.trades },
      stress2x: { cost: baseCost * 2.0, srAnn: r2x.stats.srAnn, net: r2x.netTot, trades: r2x.trades },
      breakEvenCost,
      survives2x: r2x.netTot > 0
    };
  }

  /* Формальная 6-условная формула промоушн-гейта PASS / BORDERLINE / REJECT (раздел 7.4 СКРИНЕР_epub.md). */
  function evalPromotionGate(inp) {
    const dsr = inp.dsr !== undefined ? inp.dsr : 0;
    const pbo = inp.pbo !== undefined ? inp.pbo : 1;
    const plateau = inp.plateau !== undefined ? inp.plateau : 0; // доля 0..1 (напр. 0.76 = 76%)
    const oosBlocksPos = inp.oosBlocksPos !== undefined ? inp.oosBlocksPos : 0; // из 5
    const stress2022Pos = !!inp.stress2022Pos;
    const hasThesis = inp.hasThesis !== undefined ? !!inp.hasThesis : true;
    const enoughData = inp.enoughData !== undefined ? !!inp.enoughData : true;

    const checks = [
      {
        id: 'dsr', name: 'DSR ≥ 0,95 (допуск до 0,90)', critical: false,
        status: dsr >= 0.95 ? 'pass' : (dsr >= 0.90 ? 'borderline' : 'reject'),
        detail: 'DSR ' + dsr.toFixed(2) + (dsr >= 0.95 ? ' ≥ 0,95' : ' < 0,95')
      },
      {
        id: 'pbo', name: 'PBO ≤ 0,50 (допуск до 0,55)', critical: false,
        status: pbo <= 0.50 ? 'pass' : (pbo <= 0.55 ? 'borderline' : 'reject'),
        detail: 'PBO ' + pbo.toFixed(2) + (pbo <= 0.50 ? ' ≤ 0,50' : ' > 0,50')
      },
      {
        id: 'plateau', name: 'Плато соседей ≥ 70% (допуск до 62%)', critical: false,
        status: plateau >= 0.70 ? 'pass' : (plateau >= 0.62 ? 'borderline' : 'reject'),
        detail: 'плато ' + Math.round(plateau * 100) + '%' + (plateau >= 0.70 ? ' ≥ 70%' : ' < 70%')
      },
      {
        id: 'regimes', name: 'OOS > 0 в большинстве блоков + стресс 2022', critical: false,
        status: (stress2022Pos && oosBlocksPos >= 4) ? 'pass' : ((stress2022Pos && oosBlocksPos >= 3) ? 'borderline' : 'reject'),
        detail: 'OOS > 0 в ' + oosBlocksPos + '/5 блоков' + (stress2022Pos ? ' (2022 ✓)' : ' (провал 2022!)')
      },
      {
        id: 'thesis', name: 'Написан экономический тезис', critical: true,
        status: hasThesis ? 'pass' : 'reject',
        detail: hasThesis ? 'тезис зафиксирован' : 'нет тезиса (критично!)'
      },
      {
        id: 'data', name: 'Достаточность истории данных', critical: true,
        status: enoughData ? 'pass' : 'reject',
        detail: enoughData ? 'данных достаточно' : 'мало данных (критично!)'
      }
    ];

    const failedReject = checks.filter((c) => c.status === 'reject');
    const failedBorder = checks.filter((c) => c.status === 'borderline');

    let verdict = 'PASS';
    if (failedReject.length > 0) verdict = 'REJECT';
    else if (failedBorder.length > 0) verdict = 'BORDERLINE';

    const reasons = failedReject.concat(failedBorder).map((c) => c.detail);
    const headline = verdict === 'PASS'
      ? 'PASS: все 6 условий выполнены'
      : verdict + ': ' + reasons.join('; ');

    return { verdict, headline, checks, failedReject, failedBorder };
  }

  const VALID_SCENARIOS = [
    {
      id: 'spurious_peak',
      name: 'Ложный одинокий пик на обучении против широкого плато',
      note: 'У пары есть здоровое широкое плато (N ≈ 30–50, z ≈ 1,9–2,3), но на обучении случайно выстрелила суетливая клетка (N = 10, z = 0,95): при реальных издержках c = 0,75 п. пик пилит счёт на holdout, а плато зарабатывает.',
      opts: { mode: 'spurious_peak', cost: 0.75 }
    },
    {
      id: 'noise_mirage',
      name: 'Чистое случайное блуждание после 36 попыток (мираж отбора)',
      note: 'Связи между ногами вообще нет (случайное блуждание!), но из 36 настроек всегда находится «чемпион прошлого». Полный аудит распознаёт мираж (PBO > 0,50, низкий DSR) и ставит REJECT, сберегая 100% капитала.',
      opts: { mode: 'noise_mirage', cost: 1.15 }
    },
    {
      id: 'leak_overlap',
      name: 'Утечка на стыке окон без purging и embargo',
      note: 'На самом стыке обучения и теста (дни 205–238) прошла аномальная гладкая волна: без очистки стыка (purging/embargo) сплит выбирает суетливую настройку, сгорающую на holdout.',
      opts: { mode: 'leak_overlap', cost: 0.75 }
    },
    {
      id: 'robust_pass',
      name: 'Устойчивая возвратная пара (эталон прохождения гейта PASS)',
      note: 'Крепкая экономическая связь на полутора годах истории, высокая корреляция карт WFC, низкий PBO и запас прочности к 2× cost: честный аудит выдаёт вердикт PASS.',
      opts: { mode: 'robust_pass', cost: 0.45 }
    }
  ];

  function genValidScenario(seed, scen) {
    const sc = scen || VALID_SCENARIOS[0];
    const mode = sc.opts.mode;
    const cost = sc.opts.cost;
    const len = 500; // 0..359 — исследовательская зона (~1,5 года), 360..499 — неприкосновенный Holdout!
    const holdoutStart = 360;
    const rng = mulberry32(seed);
    const randn = () => {
      const u1 = Math.max(1e-7, rng()), u2 = rng();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    };

    const spread = new Array(len).fill(0);
    let sp = 0;
    let spikeMirage = null;

    if (mode === 'spurious_peak') {
      for (let t = 1; t < len; t++) {
        sp = 0.66 * sp + randn() * 1.55;
        spread[t] = sp;
      }
      // На участке обучения [20..195] изолированная скальперская клетка (r=0: N=10, c=0: z=0.95) случайно поймала серию гэпов
      spikeMirage = { r: 0, c: 0, t0: 20, t1: 215, amt: 5.5 };
    } else if (mode === 'noise_mirage') {
      for (let t = 1; t < len; t++) {
        sp = sp + randn() * 1.45;
        spread[t] = sp;
      }
      // Даже на случайном блуждании находится клетка, которой повезло в прошлом
      spikeMirage = { r: 0, c: 0, t0: 25, t1: 215, amt: 5.8 };
    } else if (mode === 'leak_overlap') {
      for (let t = 1; t < len; t++) {
        sp = 0.66 * sp + randn() * 1.55;
        spread[t] = sp;
      }
      // В зоне стыка [202..238] (вокруг splitIdx = 220) сидит утечка перекрывающихся окон:
      // без purging=20, embargo=20 и IS, и грязный OOS обманываются в пользу клетки (r=0, c=0)!
      spikeMirage = { r: 5, c: 0, t0: 191, t1: 249, daily: 4.8 };
    } else {
      // robust_pass
      for (let t = 1; t < len; t++) {
        const sig = (t >= 210 && t <= 260) ? 1.85 : 1.45;
        sp = 0.64 * sp + randn() * sig;
        spread[t] = sp;
      }
    }

    return { spread, cost, mode, holdoutStart, spikeMirage, scen: sc };
  }

  /* Сравнение 4 подходов к отбору параметров строго на неприкосновенном Holdout [240..359]:
     1) 'naive_peak' — берёт пик IS без чистки стыка и без проверки соседей
     2) 'leaky_wfo' — сплит без purging/embargo (ловится на утечку стыка)
     3) 'plateau_wfo' — выбирает центр плато (>= 70%) с честным purging + embargo
     4) 'full_audit' — плато + CPCV/PBO + DSR + гейт PASS (отклоняет миражи шума с 0 лотов!) */
  function backtestValidApproaches(vd) {
    const devSeries = vd.spread.slice(0, vd.holdoutStart);
    const devMirage = vd.spikeMirage;

    // 1. Поверхность без чистки стыка (splitIdx = 220)
    const surfLeaky = paramSurface(devSeries, {
      splitIdx: 220, purgeBars: 0, embargoBars: 0, cost: vd.cost, spikeMirage: devMirage
    });
    // 2. Поверхность с честным purging = 20, embargo = 20
    const surfClean = paramSurface(devSeries, {
      splitIdx: 220, purgeBars: 30, embargoBars: 30, cost: vd.cost, spikeMirage: devMirage
    });

    // 3. CPCV (20 комбинаций на 6 блоках исследовательской зоны) и DSR
    // Учитываем эффективное число независимых попыток сетки (López de Prado: соседние узлы одной пары коррелированы ~0,72 -> N_eff ≈ 10)
    const cpcv = runCPCV(devSeries, { cost: vd.cost, purgeBars: 10, embargoBars: 10, spikeMirage: devMirage });
    const platCfg = surfClean.plateau;
    const devPlatRun = quickSpreadRun(devSeries, platCfg.n, platCfg.entryZ, Math.min(0.30, platCfg.entryZ * 0.32), vd.cost);
    const effTrials = 10;
    const dsrRes = calcDSR(
      devPlatRun.stats.srAnn,
      devSeries.length - platCfg.n,
      devPlatRun.stats.skew,
      devPlatRun.stats.kurt,
      effTrials,
      Math.min(0.65, surfClean.stdAcrossTrials)
    );
    const stress = costStressTest(devSeries, platCfg.n, platCfg.entryZ, Math.min(0.30, platCfg.entryZ * 0.32), vd.cost);

    // Считаем число положительных блоков из 5 на исследовательской зоне
    const bLen = Math.floor((devSeries.length - platCfg.n) / 5);
    let posBlocks = 0;
    for (let k = 0; k < 5; k++) {
      const sl = devPlatRun.diffs.slice(platCfg.n + k * bLen, platCfg.n + (k + 1) * bLen);
      if (returnStats(sl).total > 0) posBlocks++;
    }
    const gate = evalPromotionGate({
      dsr: dsrRes.dsr,
      pbo: cpcv.pbo,
      plateau: platCfg.plateauRatio,
      oosBlocksPos: posBlocks,
      stress2022Pos: posBlocks >= 3 && stress.base.net > 0,
      hasThesis: true,
      enoughData: true
    });

    // Выбор параметров каждым из 4 методов (только по данным 0..239!)
    const pickPeak = { n: surfLeaky.peak.n, entryZ: surfLeaky.peak.entryZ, active: true };
    // Leaky WFO выбирает лучший средний IS+OOS на нечищеной поверхности без требования плато
    let bestLk = -1e9, lkN = 20, lkZ = 1.3;
    for (let r = 0; r < surfLeaky.nGrid.length; r++) {
      for (let c = 0; c < surfLeaky.zGrid.length; c++) {
        const sc = 0.55 * surfLeaky.isGrid[r][c] + 0.45 * surfLeaky.oosGrid[r][c];
        if (sc > bestLk) { bestLk = sc; lkN = surfLeaky.nGrid[r]; lkZ = surfLeaky.zGrid[c]; }
      }
    }
    const pickLeaky = { n: lkN, entryZ: lkZ, active: true };
    const pickPlat = { n: platCfg.n, entryZ: platCfg.entryZ, active: true };
    // Полный аудит допускает торговлю на Holdout в полном объёме при PASS, в половинном при BORDERLINE, и отклоняет (0) при REJECT!
    const auditMult = gate.verdict === 'PASS' ? 1.0 : (gate.verdict === 'BORDERLINE' ? 0.5 : 0);
    const pickAudit = { n: platCfg.n, entryZ: platCfg.entryZ, active: auditMult > 0, mult: auditMult };

    function evalHoldout(pick) {
      const hLen = vd.spread.length - vd.holdoutStart;
      if (!pick.active) {
        return {
          cfg: pick, equity: new Array(hLen).fill(0), diffs: new Array(hLen).fill(0),
          total: 0, srAnn: 0, maxDD: 0, trades: 0
        };
      }
      // Прогоняем на полном ряду (чтобы скользящее окно на старте holdout опиралось на честное прошлое),
      // но считаем сделки и P&L СТРОГО на неприкосновенном участке [holdoutStart .. len-1]!
      const mult = pick.mult !== undefined ? pick.mult : 1.0;
      const run = quickSpreadRun(vd.spread, pick.n, pick.entryZ, Math.min(0.30, pick.entryZ * 0.32), vd.cost);
      const hDiffs = run.diffs.slice(vd.holdoutStart).map((x) => x * mult);
      const eq = new Array(hDiffs.length);
      let acc = 0;
      for (let i = 0; i < hDiffs.length; i++) { acc += hDiffs[i]; eq[i] = acc; }
      const st = returnStats(hDiffs);
      // Приближённое число сделок на участке holdout пропорционально доле длины
      const hTrades = Math.max(0, Math.round(run.trades * (hLen / (vd.spread.length - pick.n))));
      return {
        cfg: pick, equity: eq, diffs: hDiffs,
        total: st.total, srAnn: st.srAnn, maxDD: st.maxDD, trades: hTrades
      };
    }

    return {
      surfLeaky,
      surfClean,
      cpcv,
      dsr: dsrRes,
      stress,
      gate,
      holdout: {
        naive_peak: evalHoldout(pickPeak),
        leaky_wfo: evalHoldout(pickLeaky),
        plateau_wfo: evalHoldout(pickPlat),
        full_audit: evalHoldout(pickAudit)
      }
    };
  }



  /* =========================================================================
   * РАЗДЕЛ 15 (#51): РАЗМЕР ПОЗИЦИИ И СБОРКА ПОРТФЕЛЯ («КНИГИ») СПРЕДОВ
   * Дробный Келли, vol-targeting, вместимость стакана и жадный субмодулярный отбор
   * ========================================================================= */

  // Кривая геометрического роста счёта по доле m ∈ [0 .. 2.2] от наивного сольного Келли (§4.10)
  function kellyCurve(opts) {
    const o = opts || {};
    const srEst = Math.max(0.2, +o.srEst || 1.25);   // бумажный годовой Sharpe одного слота
    const volAnn = Math.max(0.05, +o.volAnn || 0.25); // годовая волатильность при единичном плече
    const edgeHaircut = o.edgeHaircut !== undefined ? Math.max(0.15, Math.min(1.1, +o.edgeHaircut)) : 0.72;
    const tailKurt = o.tailKurt !== undefined ? Math.max(0, +o.tailKurt) : 3.0; // избыточный эксцесс хвостов
    const kClones = Math.max(1, Math.round(+o.kClones || 1));
    const rho = o.rho !== undefined ? Math.max(0, Math.min(0.98, +o.rho)) : 0;

    // Чтобы масштаб счёта оставался реалистичным, нормируем бюджет слота на 1/kClones при независимых ставках,
    // но если трейдер ставит m × (f_naive / √k) на k коррелированных клонов, корреляция раздувает дисперсию в (1 + (k-1)ρ) раз!
    const muEst = srEst * volAnn;
    const var1 = volAnn * volAnn;
    const fNaive = (muEst / var1) / Math.sqrt(kClones);
    const corrDiv = 1 + (kClones - 1) * rho;
    const fCorrAdj = (muEst / var1) / (kClones * (1 + (kClones - 1) * rho) / Math.sqrt(kClones));

    const muTrue = muEst * edgeHaircut;
    const gridM = [];
    const growthNaive = [];
    const growthTrue = [];
    const dd95 = [];

    let bestTrue = -Infinity, optMTrue = 0, cliffM = 2.25;
    for (let i = 0; i <= 44; i++) {
      const m = +(i * 0.05).toFixed(2);
      const levSlot = m * fNaive;

      // Бумажная парабола (идеальная нормальность, ρ = 0, нулевая ошибка оценки μ): пик строго в m = 1.0!
      const gPaper = kClones * muEst * levSlot - 0.5 * kClones * var1 * levSlot * levSlot;

      // Реальный геометрический темп роста счёта с учётом усушки края, корреляции ρ и толстых хвостов
      const bookMu = kClones * muTrue * levSlot;
      const bookVar = kClones * var1 * levSlot * levSlot * corrDiv;
      const tailPen = (tailKurt / 24) * bookVar * bookVar * 1.35;
      const gReal = bookMu - 0.5 * bookVar - tailPen;

      const bookVol = Math.sqrt(Math.max(0, bookVar));
      const estDD = Math.min(0.99, 1 - Math.exp(-1.55 * bookVol * (1 + 0.06 * tailKurt)));

      gridM.push(m);
      growthNaive.push(gPaper);
      growthTrue.push(gReal);
      dd95.push(estDD);

      if (gReal > bestTrue) { bestTrue = gReal; optMTrue = m; }
    }
    for (let i = 1; i < gridM.length; i++) {
      if (growthTrue[i] < 0 && cliffM > 2.2) cliffM = gridM[i];
    }
    const paperRetentionHalf = growthNaive[20] > 0 ? growthNaive[10] / growthNaive[20] : 0.75; // ровно 0.75!
    return {
      gridM,
      growthNaive,
      growthTrue,
      dd95,
      fNaive,
      fCorrAdj,
      corrFactor: corrDiv,
      optMTrue,
      bestTrueGrowth: bestTrue,
      growthAtQuarter: growthTrue[5],
      growthAtHalf: growthTrue[10],
      growthAtFull: growthTrue[20],
      paperRetentionHalf,
      cliffM
    };
  }

  // Кривая вместимости стакана (capacity): как рост лотов съедает край из-за проскальзывания (§6.5)
  function capacityCurve(opts) {
    const o = opts || {};
    const grossEdgeRub = Math.max(50, +o.grossEdgeRub || 960);     // валовый край на 1 связку (₽)
    const fixedFeeRub = Math.max(10, +o.fixedFeeRub || 180);       // биржа + клиринг + брокер + полуспред топ-уровня (₽)
    const impactCoeffRub = Math.max(20, +o.impactCoeffRub || 410); // добавка проскальзывания при объёме = depthLots (₽)
    const depthLots = Math.max(2, +o.depthLots || 24);             // видимая глубина лучших уровней стакана (связок)
    const maxQ = Math.max(20, Math.round(+o.maxQ || 100));

    const qs = [], netPerLot = [], netTotal = [], slipShare = [];
    let bestTotal = 0, optQ = 0, maxViableQ = 0, safeCapQ = 0;

    for (let q = 1; q <= maxQ; q++) {
      const impact = impactCoeffRub * Math.pow(q / depthLots, 0.80);
      const unitCost = fixedFeeRub + impact;
      const unitNet = grossEdgeRub - unitCost;
      const tot = q * unitNet;
      const share = unitCost / grossEdgeRub;

      qs.push(q);
      netPerLot.push(unitNet);
      netTotal.push(tot);
      slipShare.push(share);

      if (tot > bestTotal) { bestTotal = tot; optQ = q; }
      if (unitNet > 0) maxViableQ = q;
      if (share <= 0.55) safeCapQ = q;
    }
    if (safeCapQ === 0 && optQ > 0) safeCapQ = Math.max(1, Math.floor(optQ * 0.75));
    return {
      qs, netPerLot, netTotal, slipShare,
      optQ, bestTotalRub: bestTotal, maxViableQ, safeCapQ, depthLots
    };
  }

  // Округление до целых контрактов и остаточная экспозиция хеджа (§6.5 и гейт 4 из §7.1)
  function integerHedgeResiduals(opts) {
    const o = opts || {};
    const beta = Math.max(0.05, +o.beta || 0.37);
    const priceA = Math.max(100, +o.priceA || 32000);
    const priceB = Math.max(100, +o.priceB || 32000);
    const maxLotsA = Math.max(1, Math.min(60, Math.round(+o.maxLotsA || 16)));
    const maxResPct = o.maxResPct !== undefined ? +o.maxResPct : 0.08;

    const candidates = [];
    let bestPair = null;
    for (let nA = 1; nA <= maxLotsA; nA++) {
      const idealNotionalB = beta * nA * priceA;
      const nB = Math.max(1, Math.round(idealNotionalB / priceB));
      const actualNotionalA = nA * priceA;
      const actualNotionalB = nB * priceB;
      const residualRub = Math.abs(actualNotionalB - idealNotionalB);
      const residualPct = residualRub / actualNotionalA;
      const row = {
        lotsA: nA,
        lotsB: nB,
        ratioLots: nB / nA,
        notionalRub: actualNotionalA + actualNotionalB,
        residualRub,
        residualPct,
        passesGate: residualPct <= maxResPct
      };
      candidates.push(row);
      if (!bestPair || (row.passesGate && !bestPair.passesGate) ||
          (row.passesGate === bestPair.passesGate && row.residualPct < bestPair.residualPct - 1e-6)) {
        bestPair = row;
      }
    }
    return {
      beta,
      maxResPct,
      naive1to1: candidates[0],
      bestPair,
      candidates
    };
  }

  // Единый конвейер расчёта размера позиции из 4 ограничителей (§4.10 + §6.5)
  function sizePosition(opts) {
    const o = opts || {};
    const capitalRub = Math.max(100000, +o.capitalRub || 5000000);
    const targetVolAnn = Math.max(0.01, +o.targetVolAnn || 0.06);
    const spreadSigmaDayRub = Math.max(50, +o.spreadSigmaDayRub || 2200);
    const kellyFrac = o.kellyFrac !== undefined ? Math.max(0.05, +o.kellyFrac) : 0.35;
    const srEst = Math.max(0.1, +o.srEst || 1.7);
    const kActive = Math.max(1, Math.round(+o.kActive || 4));
    const avgRho = o.avgRho !== undefined ? Math.max(0, Math.min(0.95, +o.avgRho)) : 0.15;
    const marginPerBundleRub = Math.max(1000, +o.marginPerBundleRub || 45000);
    const maxMarginShare = o.maxMarginShare !== undefined ? Math.max(0.05, +o.maxMarginShare) : 0.20;

    const dailyVolBudgetRub = (capitalRub * targetVolAnn) / Math.sqrt(252);
    const qVol = dailyVolBudgetRub / spreadSigmaDayRub;

    const corrDiv = 1 + (kActive - 1) * avgRho;
    const fullKellyBundles = ((srEst / Math.sqrt(252)) * capitalRub) / (spreadSigmaDayRub * corrDiv);
    const qKelly = kellyFrac * fullKellyBundles;

    const qMargin = (capitalRub * maxMarginShare) / marginPerBundleRub;

    const cap = capacityCurve({
      grossEdgeRub: o.grossEdgeRub || 960,
      fixedFeeRub: o.fixedFeeRub || 180,
      impactCoeffRub: o.impactCoeffRub || 410,
      depthLots: o.depthLots || 24,
      maxQ: 120
    });
    const qCap = cap.safeCapQ;

    const limits = [
      { id: 'vol', label: 'Vol-targeting (бюджет риска)', q: qVol },
      { id: 'kelly', label: 'Дробный Келли (с корр. поправкой)', q: qKelly },
      { id: 'margin', label: 'Лимит ГО на связку', q: qMargin },
      { id: 'capacity', label: 'Вместимость стакана (capacity)', q: qCap }
    ];
    let minLim = limits[0];
    for (let i = 1; i < limits.length; i++) {
      if (limits[i].q < minLim.q) minLim = limits[i];
    }
    const qFinal = Math.max(0, Math.floor(minLim.q));

    return {
      qFinal,
      bindingId: minLim.id,
      bindingLabel: minLim.label,
      qVol,
      qKelly,
      qMargin,
      qCap,
      corrDiv,
      dailyVolBudgetRub,
      realizedDailyRiskRub: qFinal * spreadSigmaDayRub,
      marginUsedRub: qFinal * marginPerBundleRub,
      capacity: cap
    };
  }

  // 8 реалистичных кандидатов в книгу спредов MOEX из 4 экономических кластеров
  const BOOK_PAIR_SPECS = [
    { id: 0, code: 'SBER / VTBR', cluster: 'Банки и индекс', driver: 'Банковский сектор и индексный риск-он', soloScore: 0.91, comp: [0.94, 0.90, 0.92, 0.89, 0.90], margin: 38, depth: 36, beta: 0.42 },
    { id: 1, code: 'SR / VB', cluster: 'Банки и индекс', driver: 'Фьючерсы банков (клон пары #1 на FORTS)', soloScore: 0.89, comp: [0.92, 0.88, 0.90, 0.87, 0.88], margin: 34, depth: 34, beta: 0.41 },
    { id: 2, code: 'SBER / SBERP', cluster: 'Банки и индекс', driver: 'Спред обычки и префа в банковский поток', soloScore: 0.86, comp: [0.90, 0.87, 0.85, 0.84, 0.84], margin: 32, depth: 30, beta: 0.96 },
    { id: 3, code: 'MIX / RTS-рубл.', cluster: 'Банки и индекс', driver: 'Тяжёлые банковские фишки внутри индекса', soloScore: 0.84, comp: [0.88, 0.83, 0.84, 0.82, 0.83], margin: 46, depth: 28, beta: 0.63 },
    { id: 4, code: 'LKOH / ROSN', cluster: 'Нефть и экспорт', driver: 'Спред нефтяных мейджоров (демпфер и добыча)', soloScore: 0.79, comp: [0.82, 0.80, 0.78, 0.79, 0.76], margin: 42, depth: 26, beta: 0.74 },
    { id: 5, code: 'BR-ближ. / дальн.', cluster: 'Нефть и экспорт', driver: 'Календарный наклон кривой нефти Brent', soloScore: 0.75, comp: [0.78, 0.76, 0.74, 0.75, 0.72], margin: 36, depth: 22, beta: 1.00 },
    { id: 6, code: 'Si-ближ. / дальн.', cluster: 'Валюта и ставка', driver: 'Календарный базис рубль/доллар и ставка RUONIA', soloScore: 0.77, comp: [0.85, 0.78, 0.75, 0.76, 0.71], margin: 30, depth: 40, beta: 1.00 },
    { id: 7, code: 'GD / SV', cluster: 'Металлы', driver: 'Отношение золота к серебру (защитный фактор)', soloScore: 0.73, comp: [0.74, 0.75, 0.72, 0.74, 0.70], margin: 40, depth: 18, beta: 0.58 }
  ];

  const BOOK_SCENARIOS = [
    {
      id: 'clone_shock',
      name: 'Скрытая концентрация: удар по общему фактору топ-пар',
      note: 'Четыре лидера сольного рейтинга (0,84–0,91) относятся к одному банковско-индексному кластеру (ρ ≈ 0,85) и во второй половине синхронно уходят в просадку, тогда как нефть, валюта и металлы продолжают спокойно зарабатывать.'
    },
    {
      id: 'vol_storm_kelly',
      name: 'Взрыв волатильности и обрыв полного Келли',
      note: 'Во второй половине истории дневной разброс спредов утраивается на 6 недель: полный 1× Келли без учёта корреляции проваливается на хвостовых ударах, а связка vol-targeting + 0,35× Kelly сжимает объём и сберегает счёт.'
    },
    {
      id: 'thin_capacity',
      name: 'Ловушка тонкого стакана при росте объёма сделки',
      note: 'Видимая глубина стакана сжата: агрессивный и даже фиксированный сайзинг без потолка capacity двигает цену против себя и отдаёт львиную долю края в проскальзывание.'
    },
    {
      id: 'balanced_year',
      name: 'Спокойный разнородный год четырёх секторов',
      note: 'Контрольная проверка без катастроф: при одинаковом бюджете риска книги субмодулярный отбор без дублей превосходит корзину клонов и по прибыли на единицу риска (Sharpe), и по хвостовой потере CVaR 95%.'
    }
  ];

  function genBookUniverse(seed, scenario) {
    const sc = scenario || BOOK_SCENARIOS[0];
    const rand = mulberry32((seed * 131071 + sc.id.length * 8191) >>> 0);
    const nNorm = () => {
      const u1 = Math.max(1e-9, rand()), u2 = rand();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    };
    const T = 240, splitIdx = 120;

    const facLoad = [
      [0.93, 0.05, 0.04, 0.00],
      [0.91, 0.06, 0.05, 0.00],
      [0.88, 0.04, 0.03, 0.02],
      [0.85, 0.14, 0.08, 0.02],
      [0.07, 0.86, 0.06, 0.04],
      [0.05, 0.62, 0.05, 0.06],
      [0.05, 0.06, 0.90, 0.04],
      [0.02, 0.05, 0.06, 0.91]
    ];

    const pairs = BOOK_PAIR_SPECS.map((sp) => ({
      id: sp.id,
      code: sp.code,
      cluster: sp.cluster,
      driver: sp.driver,
      soloScore: sp.soloScore,
      comp: sp.comp.slice(),
      margin: sp.margin,
      depth: sc.id === 'thin_capacity' ? Math.max(4, Math.round(sp.depth * 0.20)) : sp.depth,
      beta: sp.beta,
      unitPnl: new Array(T).fill(0),
      sigma: new Array(T).fill(1.0)
    }));

    for (let t = 0; t < T; t++) {
      const isOOS = t >= splitIdx;
      const inStorm = sc.id === 'vol_storm_kelly' && t >= 145 && t <= 198;
      const inBankShock = sc.id === 'clone_shock' && t >= 140 && t <= 195;

      const stormMult = inStorm ? 3.4 : 1.0;
      const f0 = nNorm() * stormMult + (inBankShock ? -0.68 : (!isOOS ? 0.24 : (inStorm ? -0.14 : 0.18)));
      const f1 = nNorm() * (inStorm ? 2.3 : 1.0) + 0.20;
      const f2 = nNorm() * (inStorm ? 2.0 : 1.0) + 0.19;
      const f3 = nNorm() * (inStorm ? 2.1 : 1.0) + 0.18;

      for (let i = 0; i < 8; i++) {
        const ld = facLoad[i];
        const idioScale = Math.sqrt(Math.max(0.08, 1 - (ld[0] * ld[0] + ld[1] * ld[1] + ld[2] * ld[2] + ld[3] * ld[3]))) * stormMult;
        const baseEdge = (!isOOS && i < 4) ? 0.05 : 0.02;
        const shockTail = (inStorm && (t === 156 || t === 168 || t === 180 || t === 191)) ? -2.9 * (i < 4 ? 1.35 : 0.65) : 0;
        pairs[i].unitPnl[t] = baseEdge + ld[0] * f0 + ld[1] * f1 + ld[2] * f2 + ld[3] * f3 + idioScale * nNorm() + shockTail;
      }
    }

    for (let i = 0; i < 8; i++) {
      for (let t = 0; t < T; t++) {
        const a = Math.max(0, t - 20), b = Math.max(1, t);
        let s2 = 0, cnt = 0;
        for (let k = a; k < b; k++) { s2 += pairs[i].unitPnl[k] * pairs[i].unitPnl[k]; cnt++; }
        pairs[i].sigma[t] = cnt >= 5 ? Math.max(0.45, Math.sqrt(s2 / cnt)) : 1.05;
      }
      const calSt = returnStats(pairs[i].unitPnl.slice(0, splitIdx));
      pairs[i].calSharpe = calSt.srAnn;
      pairs[i].calVolDay = Math.max(0.45, calSt.std);
    }

    return { scenario: sc, seed, T, splitIdx, capital: 2000, pairs }; // капитал книги 2000 тыс. ₽ = 2,0 млн ₽
  }

  function pairCorrGraph(pairs, opts) {
    const o = opts || {};
    const t0 = o.t0 || 0;
    const t1 = o.t1 || pairs[0].unitPnl.length;
    const thr = o.threshold !== undefined ? +o.threshold : 0.60;
    const n = pairs.length;

    const means = new Array(n).fill(0);
    const sds = new Array(n).fill(0);
    const len = Math.max(2, t1 - t0);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let t = t0; t < t1; t++) s += pairs[i].unitPnl[t];
      means[i] = s / len;
      let v = 0;
      for (let t = t0; t < t1; t++) { const d = pairs[i].unitPnl[t] - means[i]; v += d * d; }
      sds[i] = Math.sqrt(v / Math.max(1, len - 1)) || 1e-9;
    }

    const corr = Array.from({ length: n }, () => new Array(n).fill(0));
    const edges = [];
    for (let i = 0; i < n; i++) {
      corr[i][i] = 1;
      for (let j = i + 1; j < n; j++) {
        let cov = 0;
        for (let t = t0; t < t1; t++) cov += (pairs[i].unitPnl[t] - means[i]) * (pairs[j].unitPnl[t] - means[j]);
        const r = Math.max(-1, Math.min(1, (cov / Math.max(1, len - 1)) / (sds[i] * sds[j])));
        corr[i][j] = r;
        corr[j][i] = r;
        if (r >= thr) edges.push({ a: i, b: j, codeA: pairs[i].code, codeB: pairs[j].code, r });
      }
    }
    edges.sort((x, y) => y.r - x.r);
    return { corr, edges, threshold: thr };
  }

  function bookMetrics(pairs, selectedIds, weights, opts) {
    const o = opts || {};
    const t0 = o.t0 || 0;
    const t1 = o.t1 || pairs[0].unitPnl.length;
    const dupThr = o.dupThreshold !== undefined ? +o.dupThreshold : 0.60;
    const len = Math.max(1, t1 - t0);

    if (!selectedIds || !selectedIds.length) {
      return {
        selectedIds: [], pnl: new Array(len).fill(0), equity: new Array(len).fill(0),
        total: 0, srAnn: 0, maxDD: 0, cvar95: 0, divRatio: 1, effBets: 0,
        riskShares: [], dupAlerts: [], avgCorr: 0, marginUsed: 0
      };
    }

    const k = selectedIds.length;
    const w = weights && weights.length === k ? weights.slice() : new Array(k).fill(1);
    const graph = o.corrMatrix ? { corr: o.corrMatrix } : pairCorrGraph(pairs, { t0, t1, threshold: dupThr });

    const pnl = new Array(len).fill(0);
    const equity = new Array(len).fill(0);
    let acc = 0;
    for (let idx = 0; idx < len; idx++) {
      const t = t0 + idx;
      let day = 0;
      for (let m = 0; m < k; m++) {
        const p = pairs[selectedIds[m]];
        day += w[m] * p.unitPnl[t];
      }
      pnl[idx] = day;
      acc += day;
      equity[idx] = acc;
    }

    const st = returnStats(pnl);
    const sorted = pnl.slice().sort((a, b) => a - b);
    const tailCount = Math.max(1, Math.ceil(len * 0.05));
    let tailSum = 0;
    for (let i = 0; i < tailCount; i++) tailSum += sorted[i];
    const cvar95 = Math.max(0, -(tailSum / tailCount));

    const posSds = new Array(k).fill(0);
    for (let m = 0; m < k; m++) {
      const p = pairs[selectedIds[m]];
      const sub = p.unitPnl.slice(t0, t1);
      posSds[m] = Math.abs(w[m]) * Math.max(1e-6, returnStats(sub).std);
    }
    const weightedSumVol = posSds.reduce((s, x) => s + x, 0);
    const covW = new Array(k).fill(0);
    let portVar = 0;
    for (let a = 0; a < k; a++) {
      let c = 0;
      for (let b = 0; b < k; b++) {
        const r = graph.corr[selectedIds[a]][selectedIds[b]];
        c += posSds[a] * posSds[b] * r;
      }
      covW[a] = c;
      portVar += c;
    }
    const portSd = Math.sqrt(Math.max(1e-9, portVar));
    const divRatio = portSd > 1e-8 ? weightedSumVol / portSd : 1;
    const riskShares = portVar > 1e-9 ? covW.map((c) => Math.max(0, c / portVar)) : new Array(k).fill(1 / k);

    const dupAlerts = [];
    let corrSum = 0, corrPairs = 0;
    for (let a = 0; a < k; a++) {
      for (let b = a + 1; b < k; b++) {
        const r = graph.corr[selectedIds[a]][selectedIds[b]];
        corrSum += r;
        corrPairs++;
        if (r >= dupThr) {
          dupAlerts.push({
            a: selectedIds[a], b: selectedIds[b],
            codeA: pairs[selectedIds[a]].code, codeB: pairs[selectedIds[b]].code, r
          });
        }
      }
    }
    const avgCorr = corrPairs > 0 ? corrSum / corrPairs : 0;
    const effBets = k / (1 + (k - 1) * Math.max(0, avgCorr));
    let marginUsed = 0;
    for (let m = 0; m < k; m++) marginUsed += Math.abs(w[m]) * pairs[selectedIds[m]].margin;

    return {
      selectedIds: selectedIds.slice(),
      weights: w,
      pnl,
      equity,
      total: st.total,
      srAnn: st.srAnn,
      maxDD: st.maxDD,
      cvar95,
      divRatio,
      effBets,
      riskShares,
      dupAlerts,
      avgCorr,
      marginUsed
    };
  }

  function greedySubmodularSelect(pairs, opts) {
    const o = opts || {};
    const t0 = o.t0 || 0;
    const t1 = o.t1 !== undefined ? o.t1 : 120;
    const maxK = Math.max(1, Math.min(pairs.length, Math.round(+o.maxK || 4)));
    const minMarginalGain = o.minMarginalGain !== undefined ? +o.minMarginalGain : 0.045;
    const n = pairs.length;
    const graph = pairCorrGraph(pairs, { t0, t1, threshold: 0.60 });

    const qualities = pairs.map((p) => {
      const st = returnStats(p.unitPnl.slice(t0, t1));
      const srBoost = Math.max(0.55, Math.min(1.25, 0.70 + 0.16 * st.srAnn));
      return p.soloScore * srBoost;
    });

    function evalSubmodularF(subset) {
      if (!subset.length) return 0;
      let sum = 0;
      for (let j = 0; j < n; j++) {
        let bestCover = 0;
        for (let m = 0; m < subset.length; m++) {
          const i = subset[m];
          const sim = i === j ? 1 : Math.max(0, graph.corr[i][j]);
          const val = qualities[i] * sim;
          if (val > bestCover) bestCover = val;
        }
        sum += bestCover;
      }
      return sum / n;
    }

    const selected = [];
    const steps = [];
    const skippedClones = [];
    let curF = 0;

    for (let step = 1; step <= maxK; step++) {
      let bestId = -1, bestGain = -1;
      const stepTable = [];
      for (let cand = 0; cand < n; cand++) {
        if (selected.indexOf(cand) !== -1) continue;
        const nextF = evalSubmodularF(selected.concat([cand]));
        const gain = nextF - curF;
        let maxR = 0, cloneOf = null;
        for (let m = 0; m < selected.length; m++) {
          const r = graph.corr[cand][selected[m]];
          if (r > maxR) { maxR = r; cloneOf = pairs[selected[m]].code; }
        }
        stepTable.push({ id: cand, code: pairs[cand].code, soloScore: pairs[cand].soloScore, gain, maxR, cloneOf });
        if (gain > bestGain) { bestGain = gain; bestId = cand; }
      }
      stepTable.sort((a, b) => b.gain - a.gain);

      if (bestId === -1 || bestGain < minMarginalGain) {
        stepTable.forEach((row) => {
          if (row.maxR >= 0.60) skippedClones.push(row);
        });
        break;
      }

      stepTable.forEach((row) => {
        if (row.id !== bestId && row.soloScore > pairs[bestId].soloScore && row.maxR >= 0.60) {
          if (!skippedClones.some((x) => x.id === row.id)) skippedClones.push(row);
        }
      });

      selected.push(bestId);
      curF += bestGain;
      const bm = bookMetrics(pairs, selected, null, { t0, t1, corrMatrix: graph.corr });
      steps.push({
        step,
        pickedId: bestId,
        pickedCode: pairs[bestId].code,
        cluster: pairs[bestId].cluster,
        soloScore: pairs[bestId].soloScore,
        marginalGain: bestGain,
        totalF: curF,
        bookSharpe: bm.srAnn,
        bookCVaR: bm.cvar95,
        effBets: bm.effBets,
        candidatesRanked: stepTable
      });
    }

    const kActual = selected.length;
    let exactBestF = 0, exactBestSet = [];
    function searchComb(start, chosen) {
      if (chosen.length === kActual) {
        const val = evalSubmodularF(chosen);
        if (val > exactBestF) { exactBestF = val; exactBestSet = chosen.slice(); }
        return;
      }
      for (let i = start; i <= n - (kActual - chosen.length); i++) {
        chosen.push(i);
        searchComb(i + 1, chosen);
        chosen.pop();
      }
    }
    if (kActual > 0) searchComb(0, []);

    const soloTopIds = pairs.slice().sort((a, b) => b.soloScore - a.soloScore).slice(0, kActual || maxK).map((p) => p.id);
    const soloTopF = evalSubmodularF(soloTopIds);

    return {
      selectedIds: selected,
      soloTopIds,
      steps,
      skippedClones,
      greedyF: curF,
      soloTopF,
      exactBestF,
      exactBestSet,
      ratioToOpt: exactBestF > 0 ? curF / exactBestF : 1,
      theoreticalBound: 1 - 1 / Math.E,
      evalSubmodularF,
      corrMatrix: graph.corr,
      edges: graph.edges
    };
  }

  // Честное сравнение 4 подходов к сборке и сайзингу книги на живом тесте [splitIdx .. T-1]
  // Все подходы работают от единого дневного бюджета риска книги (~22 тыс. ₽ СКО в день на счёте 2 млн ₽):
  //  - naive_top: Топ-4 по сольному скору + фиксированные 9 связок на каждый слот (без vol-target и капа стакана);
  //  - full_kelly_top: Топ-4 + наивный 1× сольный Келли (раздувает объём в ~3 раза без поправки на ρ и глубину стакана);
  //  - vol_only_top: Топ-4 + грамотный vol-target, 0,35× Kelly и кап стакана, но без очистки книги от клонов;
  //  - submod_book: Жадный субмодулярный отбор без дублей + vol-target + корр.-скорректированный 0,35× Kelly + кап стакана.
  function backtestBookApproaches(univ) {
    const { pairs, splitIdx, T, capital } = univ;
    const sub = greedySubmodularSelect(pairs, { t0: 0, t1: splitIdx, maxK: 4 });
    const topIds = sub.soloTopIds;
    const divIds = sub.selectedIds;

    function avgIntraCorr(ids) {
      if (ids.length <= 1) return 0;
      let s = 0, cnt = 0;
      for (let a = 0; a < ids.length; a++) {
        for (let b = a + 1; b < ids.length; b++) { s += Math.max(0, sub.corrMatrix[ids[a]][ids[b]]); cnt++; }
      }
      return cnt > 0 ? s / cnt : 0;
    }

    function simBook(ids, mode) {
      const oosLen = T - splitIdx;
      const pnl = new Array(oosLen).fill(0);
      const equity = new Array(oosLen).fill(0);
      const avgLots = new Array(ids.length).fill(0);
      const avgRho = avgIntraCorr(ids);
      const bookRiskTargetDay = 21.0; // тыс. ₽ целевого дневного СКО всей книги (≈ 16,7% годовой волатильности на 2 млн ₽)
      let acc = 0, slipPaid = 0;

      for (let idx = 0; idx < oosLen; idx++) {
        const t = splitIdx + idx;
        let daySum = 0;
        for (let m = 0; m < ids.length; m++) {
          const p = pairs[ids[m]];
          const sig = p.sigma[t];
          let q = 0;
          if (mode === 'naive_top') {
            q = 9;
          } else if (mode === 'full_kelly_top') {
            // 1.0× сольный Келли без поправки на корреляцию соседей и без капа вместимости, но с вынужденным сжатием при просадке маржи
            const srCal = Math.max(0.9, p.calSharpe);
            const eqScale = Math.max(0.25, (capital + acc) / capital);
            const rawKelly = (((srCal / Math.sqrt(252)) * 185) / Math.max(0.55, p.calVolDay)) * eqScale;
            q = Math.max(1, Math.min(42, Math.round(rawKelly)));
          } else {
            // Единый бюджет риска книги делится с учётом корреляции слотов √(k · (1 + (k-1)ρ)):
            // 4 независимых слота (ρ≈0.08) получают по ~9,5 связок в штиль, а 4 клона (ρ≈0.85) — по ~5,6 связок, чтобы не пробить риск-бюджет книги!
            const slotRiskBudget = bookRiskTargetDay / Math.sqrt(ids.length * (1 + (ids.length - 1) * avgRho));
            const qVol = slotRiskBudget / sig;
            const corrDiv = 1 + (ids.length - 1) * avgRho;
            const qKelly = 0.38 * (((Math.max(1.0, p.calSharpe) / Math.sqrt(252)) * 520) / (sig * corrDiv));
            const qMargin = (capital * 0.24) / p.margin;
            const qCap = Math.max(3, Math.floor(p.depth * 0.50));
            q = Math.max(1, Math.floor(Math.min(qVol, qKelly, qMargin, qCap)));
          }
          avgLots[m] += q / oosLen;
          // Штраф за проедание глубины стакана (market impact из §6.5)
          const ratioD = q / Math.max(4, p.depth);
          const impactPenalty = ratioD > 0.55
            ? 0.145 * q * Math.pow(ratioD - 0.35, 1.35)
            : 0.014 * q * Math.pow(ratioD, 0.75);
          slipPaid += impactPenalty;
          daySum += q * p.unitPnl[t] - impactPenalty;
        }
        pnl[idx] = daySum;
        acc += daySum;
        equity[idx] = acc;
      }
      const st = returnStats(pnl);
      const sorted = pnl.slice().sort((a, b) => a - b);
      const tailN = Math.max(1, Math.ceil(oosLen * 0.05));
      let tailS = 0;
      for (let i = 0; i < tailN; i++) tailS += sorted[i];
      const cvar95 = Math.max(0, -(tailS / tailN));
      const bm = bookMetrics(pairs, ids, avgLots, { t0: splitIdx, t1: T, corrMatrix: sub.corrMatrix });
      return {
        ids,
        codes: ids.map((id) => pairs[id].code),
        avgLots,
        pnl,
        equity,
        total: st.total,
        srAnn: st.srAnn,
        maxDD: st.maxDD,
        cvar95,
        slipPaid,
        effBets: bm.effBets,
        divRatio: bm.divRatio,
        dupAlerts: bm.dupAlerts
      };
    }

    return {
      submod: sub,
      approaches: {
        naive_top: simBook(topIds, 'naive_top'),
        full_kelly_top: simBook(topIds, 'full_kelly_top'),
        vol_only_top: simBook(topIds, 'vol_only_top'),
        submod_book: simBook(divIds, 'submod_book')
      }
    };
  }


  const api = { generate, ols, roundK, hedgeStats, explainHedge, backtestHedge, HEDGE_SCENARIOS, genHedge, dfCrit, egCrit, dfTest, cointTest, rollingCoint, explainCoint, genPair, COINT_SCENARIOS, genCoint, COINT_POOL_SPECS, genCointPool, backtestCoint, carryFair, CAL_SERIES_NAMES, CAL_SCENARIOS, genCalendar, genCalScenario, backtestCalendar, explainCalendar, genTactics, TACTIC_SCENARIOS, genTacticScenario, volRegime, backtestTactics, explainTactics, fxParity, FX_SCENARIOS, genFxSpread, genFxScenario, backtestFx, explainFx, olsMulti, basketCrit, roundBasketLots, BASKET_SCENARIOS, genBasket, genBasketScenario, backtestBasket, explainBasket, calcVM, matchContractLots, decomposeCosts, calcRoM, MOEX_SCENARIOS, genMoex, genMoexScenario, backtestMoex, explainMoex, tls, theilSen, kalmanHedge, kpssTest, hurstExp, stationarityMatrix, halfLifeDist, cusumBreak, calcERT, DIAG_SCENARIOS, genDiag, genDiagScenario, backtestDiag, explainDiag, normCdf, ouFit, ouCycleMetrics, bertramBands, volAdaptiveBands, carryOverlayBands, BAND_SCENARIOS, genBand, genBandScenario, backtestBands, explainBands, normInv, t2Inv, t3Cdf, hmmEntropy, hmmStep, regimeGate, hmmFilter, copulaParamFromTau, copulaH, copulaTailDep, copulaSample2D, fastWindowTau, mispricingIndex, REGIME_SCENARIOS, genRegime, genRegimeScenario, prepareRegimeFeatures, backtestRegimeCopula, explainRegimeCopula, returnStats, calcPSR, expectedMaxSR, calcDSR, quickSpreadRun, VALID_N_GRID, VALID_Z_GRID, paramSurface, CPCV_SPLITS_6_3, runCPCV, blockBootstrapCI, costStressTest, evalPromotionGate, VALID_SCENARIOS, genValidScenario, backtestValidApproaches, kellyCurve, capacityCurve, integerHedgeResiduals, sizePosition, BOOK_PAIR_SPECS, BOOK_SCENARIOS, genBookUniverse, pairCorrGraph, bookMetrics, greedySubmodularSelect, backtestBookApproaches, rolling, ewma, robust, explainRobust, median, MAD_SCALE, explainEwma, alphaOf, halfLife, weightShare, explainBar, decide, backtest, sweep, tune, spiky, tailTwoSided, DEFAULTS, mulberry32, round2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
