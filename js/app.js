/* Общее состояние и помощники для экранов (ползунки, показатели, графики). */
(function () {
  'use strict';
  const E = window.Engine, U = window.UI;

  const state = {
    seed: 21,
    regime: false,
    params: { n: 30, entryZ: 2, exitZ: 0.5, stopZ: 3.5, stopOn: true, maxHold: 0, cost: 0.5, delayOn: false },
    trade: 0,
    bar: null
  };

  let dataKey = '', dataCache = null;
  function data() {
    const k = state.seed + '|' + state.regime;
    if (k !== dataKey) { dataCache = E.generate({ seed: state.seed, breakAt: state.regime ? 200 : null }); dataKey = k; }
    return dataCache;
  }

  function btParams(over) {
    const p = Object.assign({}, state.params, over || {});
    return { n: p.n, entryZ: p.entryZ, exitZ: p.exitZ, stopZ: p.stopOn ? p.stopZ : null, maxHold: p.maxHold, cost: p.cost, delay: p.delayOn ? 1 : 0 };
  }
  const backtest = (over, series) => E.backtest(series || data().spread, btParams(over));

  const T = (key, text) => {
    const g = window.GLOSSARY[key];
    if (!g) return text || key;
    return '<span class="term" data-t="' + key + '">' + (text || g[0].toLowerCase()) + '</span>';
  };

  // Связи между параметрами: выход ближе к среднему, чем вход; стоп дальше входа.
  function normalize() {
    const p = state.params;
    if (p.exitZ > p.entryZ - 0.25) p.exitZ = Math.max(0, Math.round((p.entryZ - 0.25) * 4) / 4);
    if (p.stopZ < p.entryZ + 0.5) p.stopZ = Math.round((p.entryZ + 0.5) * 4) / 4;
  }

  /* Набор ползунков. specs: {key,label,type:'range'|'check',min,max,step,d,hint,text}. */
  function controls(root, specs, onChange) {
    const html = specs.map((s) => {
      if (s.type === 'check') {
        return '<div class="ctl"><label><span><input type="checkbox" data-k="' + s.key + '"> ' + s.label + '</span></label><div class="hint">' + (s.hint || '') + '</div></div>';
      }
      return '<div class="ctl"><label><span>' + s.label + '</span><b data-v="' + s.key + '"></b></label>' +
        '<input type="range" data-k="' + s.key + '" min="' + s.min + '" max="' + s.max + '" step="' + s.step + '">' +
        '<div class="hint">' + (s.hint || '') + '</div></div>';
    }).join('');
    root.innerHTML = '<div class="controls">' + html + '</div>';
    function sync() {
      specs.forEach((s) => {
        const el = root.querySelector('[data-k="' + s.key + '"]');
        if (s.type === 'check') { el.checked = !!state.params[s.key]; return; }
        const v = state.params[s.key];
        el.min = typeof s.min === 'function' ? s.min() : s.min;
        el.value = v;
        root.querySelector('[data-v="' + s.key + '"]').textContent = s.text ? s.text(v) : U.fmt(v, s.d || 0);
      });
    }
    root.addEventListener('input', (e) => {
      const el = e.target;
      const k = el.dataset.k;
      if (!k) return;
      state.params[k] = el.type === 'checkbox' ? el.checked : parseFloat(el.value);
      normalize();
      sync();
      onChange();
    });
    sync();
    return { sync };
  }

  function kpis(bt, opts) {
    const m = bt.metrics;
    const money = (x) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, 1) + '</span>';
    const items = [
      [String(m.count), 'сделок', ''],
      [m.winRate === null ? '—' : Math.round(m.winRate * 100) + '%', 'прибыльных', ''],
      [money(m.total), 'итог, пунктов', 'после издержек'],
      [U.fmt(-m.maxDD, 1), 'макс. просадка', 'самая глубокая «яма»'],
      [m.avg === null ? '—' : money(m.avg), 'средняя сделка', ''],
      [m.profitFactor === null ? '—' : U.fmt(m.profitFactor, 2), 'профит-фактор', 'прибыли ÷ убытки']
    ];
    return '<div class="kpis">' + items.map((i) => '<div class="kpi"><div class="v">' + i[0] + '</div><div class="l">' + i[1] + '</div>' + (i[2] && opts && opts.explain ? '<div class="e">' + i[2] + '</div>' : '') + '</div>').join('') + '</div>';
  }

  const REASON = { entry: 'вход', target: 'цель (возврат к среднему)', stop: 'стоп-лосс', time: 'время вышло', end: 'конец данных' };
  const posName = (p) => (p === 1 ? 'лонг спреда (купили A, продали B)' : p === -1 ? 'шорт спреда (продали A, купили B)' : 'вне рынка');

  function barTip(i, bt) {
    const d = data();
    const z = bt.z[i];
    return '<b>День ' + (i + 1) + '</b><br>Спред: ' + U.fmt(d.spread[i]) +
      (bt.mean[i] !== null ? '<br>Среднее: ' + U.fmt(bt.mean[i]) + ' · σ: ' + U.fmt(bt.std[i]) + '<br>z-score: <b>' + U.fmt(z) + '</b>' : '<br><span style="color:#98a3b6">окно ещё не набралось</span>');
  }

  function tradeMarkers(bt, yOf, withExit) {
    const mk = [];
    bt.trades.forEach((t) => {
      mk.push({ i: t.entryIdx, y: yOf(t.entryIdx), kind: t.dir === 1 ? 'up' : 'down', color: t.dir === 1 ? U.COLORS.up : U.COLORS.down });
      if (withExit !== false) mk.push({ i: t.exitIdx, y: yOf(t.exitIdx), kind: 'cross', color: t.reason === 'stop' ? U.COLORS.down : U.COLORS.exit });
    });
    return mk;
  }

  function positionSpans(bt) {
    const spans = [];
    bt.trades.forEach((t) => spans.push({ i0: t.entryIdx, i1: t.exitIdx, color: t.dir === 1 ? '#35d07f18' : '#ff6b6b18' }));
    return spans;
  }

  function mkChart(root, height, opts) {
    root.innerHTML = '<div class="chartbox"><canvas></canvas></div>';
    return new U.Chart(root.querySelector('canvas'), Object.assign({ height }, opts || {}));
  }

  window.App = { state, data, backtest, btParams, T, controls, kpis, barTip, tradeMarkers, positionSpans, mkChart, REASON, posName, normalize };
})();
