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

    for (let t = 0; t < o.n; t++) {
      if (o.pureNoise) {
        if (t > 0) {
          rwA = Math.max(20, rwA + o.rwStep * gauss());
          rwB = Math.max(20, rwB + o.rwStep * gauss());
          rwC = Math.max(20, rwC + o.rwStep * gauss());
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

  const api = { generate, ols, roundK, hedgeStats, explainHedge, backtestHedge, HEDGE_SCENARIOS, genHedge, dfCrit, egCrit, dfTest, cointTest, rollingCoint, explainCoint, genPair, COINT_SCENARIOS, genCoint, COINT_POOL_SPECS, genCointPool, backtestCoint, carryFair, CAL_SERIES_NAMES, CAL_SCENARIOS, genCalendar, genCalScenario, backtestCalendar, explainCalendar, genTactics, TACTIC_SCENARIOS, genTacticScenario, volRegime, backtestTactics, explainTactics, fxParity, FX_SCENARIOS, genFxSpread, genFxScenario, backtestFx, explainFx, olsMulti, basketCrit, roundBasketLots, BASKET_SCENARIOS, genBasket, genBasketScenario, backtestBasket, explainBasket, rolling, ewma, robust, explainRobust, median, MAD_SCALE, explainEwma, alphaOf, halfLife, weightShare, explainBar, decide, backtest, sweep, tune, spiky, tailTwoSided, DEFAULTS, mulberry32, round2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
