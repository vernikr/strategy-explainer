/* Режимы HMM и копулы, экраны 5–8: ручной шаг Байеса и условной копулы,
   симулятор 4 схем, пошаговый инспектор дня и честный эксперимент 4×11 (#64, #49). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, E = window.Engine, HV = window.HV;
  const Z = (window.RGSCREENS = window.RGSCREENS || []);
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', PRE = '#5aa9ff', GOLD = '#ffd166', PURP = '#c9b6ff';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const pct = (v, d) => U.fmt(v * 100, d === undefined ? 0 : d) + '%';
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 2 : d) + '</span>';

  const MODES = [
    { id: 'naive_z', name: 'Обычный Z-score (±1,75σ)', color: SIM },
    { id: 'hmm_gate', name: 'Марковский HMM-гейт', color: PRE },
    { id: 'copula_only', name: 'Чистая копула MI (без HMM)', color: PURP },
    { id: 'hmm_copula', name: 'Связка HMM-гейт + копула MI', color: ME }
  ];

  const gatePill = (gt) => {
    if (!gt) return '';
    if (gt.state === 'blocked_break') return '<span class="pill stop">' + gt.label + '</span>';
    if (gt.state === 'paused_uncertain') return '<span class="pill time">' + gt.label + '</span>';
    if (gt.state === 'storm_cautious') return '<span class="pill time">' + gt.label + '</span>';
    return '<span class="pill ok">' + gt.label + '</span>';
  };

  /* ---------- 5. Ручной шаг Байеса в HMM и условная вероятность копулы ---------- */
  const CASES5 = [
    {
      name: '1. Дружный возврат к среднему',
      note: 'Вчера спред был растянут на +2,2 п., а сегодня послушно вернулся на −0,65 п. В ранговой плоскости обе ноги шагнули умеренно (u = 0,28, v = 0,52).',
      prev: [0.70, 0.20, 0.10], dx: -0.65, devPrev: 2.2, drift: -0.10, dirR: 0.18, sig: 1.0,
      u: 0.28, v: 0.52, tau: 0.58
    },
    {
      name: '2. Резкий удар в пустом стакане (туман → буря)',
      note: 'Неожиданный скачок ΔS = +3,6 п. при нулевой однонаправленности: правдоподобие спокойного режима падает почти в ноль, классификатор уходит в зону сомнений и бури.',
      prev: [0.68, 0.22, 0.10], dx: 3.6, devPrev: -0.4, drift: 0.15, dirR: 0.22, sig: 1.0,
      u: 0.91, v: 0.35, tau: 0.58
    },
    {
      name: '3. Тихий снос + совместный обвал рынка (0,04; 0,05)',
      note: 'Спред уже ушёл на +5,2 п. и снова шагает вверх (+0,68 п., однонаправленность 0,82) — HMM включает тревогу распада! А в совместном обвале (u = 4%, v = 5%) копула Клейтона видит норму (h₁ ≈ 43%), тогда как Гауссова бьёт ложную тревогу (h₁ = 15%).',
      prev: [0.44, 0.24, 0.32], dx: 0.68, devPrev: 5.2, drift: 0.62, dirR: 0.82, sig: 1.0,
      u: 0.04, v: 0.05, tau: 0.58
    }
  ];
  const s5 = { idx: 0 };

  Z.push({
    id: 'regime-manual',
    title: 'Ручной расчёт на ладони: шаг Байеса в HMM и формула копулы',
    lead: 'Разберём три живых вечера без единого «чёрного ящика»: как вчерашние вероятности превращаются в сегодняшние по правилу Байеса и как копула Клейтона отличает совместную панику от истинного перекоса.',
    text: () => `
      <h3>Три арифметических действия фильтра Гамильтона</h3>
      <ol>
        <li><b>Прогноз до новостей:</b> умножаем вчерашний вектор вероятностей на матрицу переходов <code>π_прогн = π_{t−1} · P</code>.</li>
        <li><b>Правдоподобие шага:</b> проверяем по формуле колокола Гаусса, насколько наблюдаемый шаг <code>ΔS_t</code> правдоподобен для возврата, для бури и для одностороннего сноса.</li>
        <li><b>Формула Байеса:</b> перемножаем прогноз и правдоподобие в каждой строке и делим на их сумму, чтобы снова получить <code>100%</code>.</li>
      </ol>
      <p>Ниже сравните, как на одном и том же экстремальном дне ведут себя условные вероятности <code>h₁ = P(U ≤ u | V = v)</code> у Гауссовой копулы и у хвостовой копулы Клейтона.</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Выберите рыночную ситуацию вечера</h4>
          <div class="btns" id="b5" style="margin:0 0 8px"></div>
          <p id="note5" style="margin:0 0 10px;color:#98a3b6"></p>
          <h4>Часть А. Обновление трёх режимов по фильтру Гамильтона</h4>
          <table class="t" id="tab5hmm"></table>
          <h4 style="margin-top:14px">Часть Б. Сравнение условной вероятности h₁ = ∂C(u, v)/∂v</h4>
          <table class="t" id="tab5cop"></table>
          <div id="out5" class="note" style="margin-top:10px"></div>
        </div>`;

      const bEl = el.querySelector('#b5');
      bEl.innerHTML = CASES5.map((c, i) => '<button class="b" data-i="' + i + '">' + c.name + '</button>').join('');
      bEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s5.idx = +b.dataset.i; draw5(); } });

      function draw5() {
        bEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s5.idx));
        const cs = CASES5[s5.idx];
        el.querySelector('#note5').textContent = cs.note;

        const stp = E.hmmStep(cs.prev, cs.dx, cs.devPrev, cs.drift, cs.dirR, cs.sig);
        const gt = E.regimeGate(stp.post);
        const names = [
          '<b style="color:' + ME + '">1. Спокойный возврат</b>',
          '<b style="color:' + SIM + '">2. Волатильный шторм</b>',
          '<b style="color:' + BAD + '">3. Распад / дрейф</b>'
        ];
        const rawProd = stp.pred.map((p, k) => p * stp.lik[k]);

        el.querySelector('#tab5hmm').innerHTML =
          '<tr><th>Режим</th><th>Вчера π_{t−1}</th><th>Прогноз π_{t|t−1}</th><th>Правдоподобие L_k</th><th>Произведение</th><th>Сегодня π_t</th></tr>' +
          [0, 1, 2].map((k) =>
            '<tr><td>' + names[k] + '</td>' +
            '<td>' + pct(cs.prev[k], 0) + '</td>' +
            '<td>' + pct(stp.pred[k], 1) + '</td>' +
            '<td>' + f(stp.lik[k], 4) + '</td>' +
            '<td>' + f(rawProd[k], 4) + '</td>' +
            '<td><b>' + pct(stp.post[k], 1) + '</b></td></tr>'
          ).join('');

        const pGauss = E.copulaParamFromTau('gaussian', cs.tau);
        const pClay = E.copulaParamFromTau('clayton', cs.tau);
        const hG = E.copulaH(cs.u, cs.v, 'gaussian', pGauss);
        const hC = E.copulaH(cs.u, cs.v, 'clayton', pClay);

        el.querySelector('#tab5cop').innerHTML =
          '<tr><th>Семейство копулы (τ = ' + f(cs.tau) + ')</th><th>Параметр</th><th>Ранги дня (u; v)</th><th>Условная h₁ = P(U ≤ u | V = v)</th><th>Трактовка перекоса (h₁ − 50%)</th></tr>' +
          '<tr><td>Гауссова (без хвостов)</td><td>ρ = ' + f(pGauss) + '</td><td>(' + pct(cs.u, 0) + '; ' + pct(cs.v, 0) + ')</td><td><b>' + pct(hG, 1) + '</b></td><td>' + col((hG - 0.5) * 100, 1) + ' п.п.</td></tr>' +
          '<tr><td><b style="color:' + ME + '">Клейтона (нижний хвост)</b></td><td>θ = ' + f(pClay) + '</td><td>(' + pct(cs.u, 0) + '; ' + pct(cs.v, 0) + ')</td><td><b>' + pct(hC, 1) + '</b></td><td>' + col((hC - 0.5) * 100, 1) + ' п.п.</td></tr>';

        el.querySelector('#out5').innerHTML =
          '<b>Итог вечера:</b> энтропия сомнений <code>' + pct(gt.entropy, 0) + '</code> · вердикт гейта: ' + gatePill(gt) +
          ' (множитель объёма <b>' + pct(gt.sizeMult, 0) + '</b>, расширение полос <b>×' + f(gt.bandMult) + '</b>).';
      }
      draw5();
    }
  });

  /* ---------- 6. Правила и сделки четырёх схем ---------- */
  const s6 = { scen: 0, seed: 7, mode: 'hmm_copula', n: 45 };

  Z.push({
    id: 'regime-trades',
    title: 'Правила и сделки: четыре схемы лицом к лицу',
    lead: 'Сравните обычный Z-score, марковский HMM-гейт, чистую копулу без защиты режимов и их связку на четырёх контрастных историях — включая тихий распад, хвостовые обвалы и ловушку короткого окна.',
    full: true,
    mount(el) {
      const seeds = [1, 7, 13, 21, 42];
      el.innerHTML = `
        <div class="viz">
          <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div class="btns" id="sc6"></div>
            <div class="btns" id="sd6"></div>
          </div>
          <p id="note6" style="margin:0 0 10px;color:#98a3b6"></p>
          <div class="btns" id="md6" style="margin:0 0 10px"></div>
          <div id="sl6n"></div>
        </div>
        <div id="kpi6" style="margin-top:12px"></div>
        <div class="viz" style="margin-top:12px">
          <h4>Рабочий сигнал выбранной схемы (Z-score или MI) и живые пороги входа</h4>
          <div class="legend">
            <span><i style="background:${PRE}"></i>сигнал выбранного режима</span>
            <span><i style="background:${GOLD}"></i>эффективные пороги входа (±1,75 × множитель режима)</span>
          </div>
          <div id="c6sig"></div>
        </div>
        <div class="viz" style="margin-top:12px">
          <h4>Вероятности режимов HMM и энтропия сомнений H(t)</h4>
          <div class="legend">
            <span><i style="background:${ME}"></i>P(возврат)</span>
            <span><i style="background:${SIM}"></i>P(шторм)</span>
            <span><i style="background:${BAD}"></i>P(распад)</span>
            <span><i style="background:${PURP}"></i>энтропия сомнений H(t)</span>
          </div>
          <div id="c6hmm"></div>
        </div>
        <div class="viz" style="margin-top:12px">
          <h4>Кривые чистого счёта всех четырёх схем</h4>
          <div class="legend">
            ${MODES.map((m) => '<span><i style="background:' + m.color + '"></i>' + m.name + '</span>').join('')}
          </div>
          <div id="c6eq"></div>
        </div>
        <div class="viz" style="margin-top:12px">
          <h4>Журнал сделок выбранной схемы (с долей рабочего лота)</h4>
          <div style="max-height:280px;overflow:auto"><table class="t" id="tab6"></table></div>
        </div>`;

      const scEl = el.querySelector('#sc6'), sdEl = el.querySelector('#sd6'), mdEl = el.querySelector('#md6');
      scEl.innerHTML = E.REGIME_SCENARIOS.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      sdEl.innerHTML = seeds.map((sd) => '<button class="b" data-s="' + sd + '">история #' + sd + '</button>').join('');
      mdEl.innerHTML = MODES.map((m) => '<button class="b" data-m="' + m.id + '">' + m.name + '</button>').join('');

      scEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.scen = +b.dataset.i; draw6(); } });
      sdEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.seed = +b.dataset.s; draw6(); } });
      mdEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.mode = b.dataset.m; draw6(); } });

      HV.slider(el.querySelector('#sl6n'), {
        label: 'Окно расчёта базового среднего и якоря N', min: 30, max: 70, step: 5, value: s6.n,
        fmt: (v) => v + ' дн.',
        onInput: (v) => { s6.n = v; draw6(); }
      });

      let curRg = null, curBts = null, curFeat = null;
      const cSig = A.mkChart(el.querySelector('#c6sig'), 180, {
        tip: (i) => {
          if (!curBts) return '';
          const bt = curBts[s6.mode];
          return '<b>День ' + (i + 1) + '</b>' +
            (bt.signalArr[i] !== null ? '<br>Сигнал: <b>' + U.sgn(bt.signalArr[i]) + '</b><br>Позиция: <b>' + U.sgn(bt.pos[i]) + ' лота</b>' : '');
        }
      });
      const cHmm = A.mkChart(el.querySelector('#c6hmm'), 160, {
        tip: (i) => curFeat ? '<b>День ' + (i + 1) + '</b><br>' +
          'Возврат: <b>' + pct(curFeat.hmm.pRev[i], 0) + '</b> · Шторм: <b>' + pct(curFeat.hmm.pStorm[i], 0) + '</b> · Распад: <b>' + pct(curFeat.hmm.pBreak[i], 0) + '</b><br>' +
          'Энтропия сомнений: <b>' + pct(curFeat.hmm.entropy[i], 0) + '</b>' : ''
      });
      const cEq = A.mkChart(el.querySelector('#c6eq'), 185, {
        tip: (i) => curBts ? '<b>День ' + (i + 1) + '</b><br>' + MODES.map((m) => '<span style="color:' + m.color + '">' + m.name + ': <b>' + U.sgn(curBts[m.id].equity[i]) + '</b></span>').join('<br>') : ''
      });

      function draw6() {
        scEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s6.scen));
        sdEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.s === s6.seed));
        mdEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === s6.mode));

        const spec = E.REGIME_SCENARIOS[s6.scen];
        el.querySelector('#note6').textContent = spec.note;
        curRg = E.genRegimeScenario(s6.seed, spec);
        curFeat = E.prepareRegimeFeatures(curRg, s6.n);
        curBts = {};
        MODES.forEach((m) => { curBts[m.id] = E.backtestRegimeCopula(curRg, { n: s6.n, mode: m.id, precomputed: curFeat }); });

        const bt = curBts[s6.mode];
        const m = bt.metrics;
        const totFees = bt.trades.reduce((s, x) => s + x.cost, 0);
        const avgSize = bt.trades.length ? bt.trades.reduce((s, x) => s + x.size, 0) / bt.trades.length : 0;

        el.querySelector('#kpi6').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v">' + m.count + '</div><div class="l">сделок</div><div class="e">' + MODES.find((x) => x.id === s6.mode).name + '</div></div>' +
            '<div class="kpi"><div class="v">' + col(m.total, 1) + ' п.</div><div class="l">чистый итог</div><div class="e">после издержек</div></div>' +
            '<div class="kpi"><div class="v">' + pct(avgSize, 0) + '</div><div class="l">средний рабочий лот</div><div class="e">с учётом HMM-гейта</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + BAD + '">−' + f(totFees, 1) + ' п.</div><div class="l">сумма издержек</div><div class="e">включая дорогие бури</div></div>' +
            '<div class="kpi"><div class="v">' + f(-m.maxDD, 1) + ' п.</div><div class="l">макс. просадка</div><div class="e">глубина ямы счёта</div></div>' +
          '</div>';

        const useHmm = s6.mode === 'hmm_gate' || s6.mode === 'hmm_copula';
        const upThr = curRg.spread.map((_, i) => i < s6.n ? null : 1.75 * (useHmm ? curFeat.hmm.gates[i].bandMult : 1));
        const dnThr = upThr.map((v) => v === null ? null : -v);
        const sigClipped = bt.signalArr.map((v) => v === null ? null : Math.max(-3.8, Math.min(3.8, v)));

        const spans = [];
        curRg.trueState.forEach((st, i) => {
          if (st === 1) spans.push({ i0: i - 0.5, i1: i + 0.5, color: '#f5a65b16' });
          else if (st === 2) spans.push({ i0: i - 0.5, i1: i + 0.5, color: '#ff6b6b18' });
        });
        bt.trades.forEach((tr) => spans.push({ i0: tr.entryIdx, i1: tr.exitIdx, color: tr.net >= 0 ? '#7ee0b522' : '#ff6b6b26' }));

        cSig.render({
          n: curRg.spread.length, spans,
          hlines: [{ y: 0, color: '#ffffff20', dash: [2, 3] }],
          series: [
            { data: sigClipped, color: PRE, width: 1.55 },
            { data: upThr, color: GOLD, width: 1.7 },
            { data: dnThr, color: GOLD, width: 1.7 }
          ]
        });

        cHmm.render({
          n: curRg.spread.length,
          hlines: [{ y: 0.5, color: '#ffffff20', dash: [3, 3] }],
          series: [
            { data: curFeat.hmm.pRev, color: ME, width: 1.8 },
            { data: curFeat.hmm.pStorm, color: SIM, width: 1.5 },
            { data: curFeat.hmm.pBreak, color: BAD, width: 1.8 },
            { data: curFeat.hmm.entropy, color: PURP, width: 1.25, dash: [4, 4] }
          ]
        });

        cEq.render({
          n: curRg.spread.length,
          hlines: [{ y: 0, color: '#ffffff24', dash: [3, 3] }],
          series: MODES.map((mo) => ({ data: curBts[mo.id].equity, color: mo.color, width: mo.id === s6.mode ? 2.4 : 1.35 }))
        });

        el.querySelector('#tab6').innerHTML =
          '<tr><th>#</th><th>Дни</th><th>Напр. и лот</th><th>Сигнал вх. → вых.</th><th>Валовый ход</th><th>Издержки</th><th>Чистый итог</th><th>Причина / режим</th></tr>' +
          (bt.trades.length ? bt.trades.map((tr, idx) =>
            '<tr><td>' + (idx + 1) + '</td><td>' + (tr.entryIdx + 1) + ' → ' + (tr.exitIdx + 1) + ' (' + tr.bars + ' дн.)</td>' +
            '<td>' + (tr.dir > 0 ? 'лонг' : 'шорт') + ' · <b>' + pct(tr.size, 0) + '</b></td>' +
            '<td>' + U.sgn(tr.entrySig) + ' → ' + U.sgn(tr.exitSig) + '</td>' +
            '<td>' + col(tr.gross) + '</td><td class="neg">−' + f(tr.cost) + '</td><td><b>' + col(tr.net) + '</b></td>' +
            '<td><span class="pill ' + (tr.reason === 'stop' ? 'stop' : tr.reason === 'target' ? 'ok' : 'time') + '">' + (A.REASON[tr.reason] || tr.reason) + '</span> <span style="color:#98a3b6;font-size:12px">' + tr.regimeNote + '</span></td></tr>'
          ).join('') : '<tr><td colspan="8" style="color:#98a3b6">Сделок не было.</td></tr>');
      }
      draw6();
    }
  });

  /* ---------- 7. Пошаговый инспектор одного дня ---------- */
  const s7 = { scen: 0, day: 162, n: 45 };

  Z.push({
    id: 'regime-day',
    title: 'Один день под лупой: паспорт режима HMM и копулы',
    lead: 'Выберите любой вечер истории и проверьте оба датчика строго по прошлому окну: вероятности режимов с энтропией сомнений и ранговую диагностику копулы.',
    full: true,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div class="btns" id="sc7"></div>
            <div class="btns" id="jmp7">
              <button class="b" data-j="prev">◀ Пред. день</button>
              <button class="b" data-j="next">След. день ▶</button>
              <button class="b" data-j="break">💔 Тихий распад</button>
              <button class="b" data-j="storm">⚡ Внутрь бури</button>
              <button class="b" data-j="tail">📉 Хвост Клейтона</button>
            </div>
          </div>
          <div id="sl7"></div>
        </div>
        <div class="cols" style="margin-top:14px">
          <div id="left7" class="viz"></div>
          <div id="right7" class="viz"></div>
        </div>`;

      const scEl = el.querySelector('#sc7');
      scEl.innerHTML = E.REGIME_SCENARIOS.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      scEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s7.scen = +b.dataset.i; draw7(); } });

      let rg = E.genRegimeScenario(7, E.REGIME_SCENARIOS[s7.scen]);
      const slCtl = HV.slider(el.querySelector('#sl7'), {
        label: 'Проверяемый вечер t', min: 50, max: 315, step: 1, value: s7.day,
        fmt: (v) => 'День #' + (v + 1),
        onInput: (v) => { s7.day = v; render7(); }
      });

      el.querySelector('#jmp7').addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        const j = b.dataset.j;
        if (j === 'prev') s7.day = Math.max(50, s7.day - 1);
        else if (j === 'next') s7.day = Math.min(315, s7.day + 1);
        else if (j === 'break') { s7.scen = 0; s7.day = 165; }
        else if (j === 'storm') { s7.scen = 1; s7.day = 98; }
        else if (j === 'tail') { s7.scen = 2; s7.day = 140; }
        slCtl.set(s7.day);
        draw7();
      });

      function draw7() {
        scEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s7.scen));
        rg = E.genRegimeScenario(7, E.REGIME_SCENARIOS[s7.scen]);
        render7();
      }

      function render7() {
        const ex = E.explainRegimeCopula(rg, s7.n, s7.day);
        el.querySelector('#left7').innerHTML =
          '<h4>Паспорт скрытого режима HMM на вечер дня #' + (s7.day + 1) + '</h4>' +
          '<div style="margin:6px 0 12px">' + gatePill(ex.gate) + '</div>' +
          '<table class="t">' +
            '<tr><th>Показатель (только прошлое окно)</th><th>Значение</th><th>Смысл</th></tr>' +
            '<tr><td>Вероятности трёх состояний</td><td><span style="color:' + ME + '"><b>' + pct(ex.probs[0], 0) + '</b></span> / <span style="color:' + SIM + '"><b>' + pct(ex.probs[1], 0) + '</b></span> / <span style="color:' + BAD + '"><b>' + pct(ex.probs[2], 0) + '</b></span></td><td>возврат / шторм / распад</td></tr>' +
            '<tr><td>Энтропия сомнений H и уверенность</td><td>H = <b>' + pct(ex.entropy, 0) + '</b> · увер. <b>' + pct(ex.confidence, 0) + '</b></td><td>при H ≥ 84% включается пауза</td></tr>' +
            '<tr><td>Разрешённая доля лота</td><td><b>' + pct(ex.gate.sizeMult, 0) + '</b></td><td>множитель полос ×' + f(ex.gate.bandMult) + '</td></tr>' +
            '<tr><td>Аварийный выход открытой позиции</td><td><b>' + (ex.gate.forceExit ? 'ДА (принудительный стоп!)' : 'Нет') + '</b></td><td>срабатывает при P(распад) ≥ 58%</td></tr>' +
          '</table>';

        el.querySelector('#right7').innerHTML =
          '<h4>Паспорт копулы и сигнала MI на вечер дня #' + (s7.day + 1) + '</h4>' +
          '<table class="t">' +
            '<tr><th>Величина</th><th>Значение</th><th>Пояснение</th></tr>' +
            '<tr><td>Семейство и ранговая связь τ</td><td><b>' + ex.family + '</b> · τ = <b>' + f(ex.tau) + '</b></td><td>параметр = ' + f(ex.param) + '</td></tr>' +
            '<tr><td>Хвостовая зависимость (λ_L / λ_U)</td><td><span style="color:' + BAD + '">λ_L = ' + pct(ex.tails.lower, 0) + '</span> · <span style="color:' + ME + '">λ_U = ' + pct(ex.tails.upper, 0) + '</span></td><td>сцепка в обвалах и ралли</td></tr>' +
            '<tr><td>Ранги шагов ног (u; v)</td><td>u = <b>' + pct(ex.u, 0) + '</b> · v = <b>' + pct(ex.v, 0) + '</b></td><td>условные h₁ = ' + pct(ex.h12, 0) + ', h₂ = ' + pct(ex.h21, 0) + '</td></tr>' +
            '<tr><td>Ранговый квантиль уровня спреда</td><td><b>' + pct(ex.rankSpread, 0) + '</b></td><td>не слепнет от прошлых шпилей</td></tr>' +
            '<tr><td><b>Итоговый MI против линейного Z</b></td><td>MI = <b style="color:' + ME + '">' + U.sgn(ex.mi) + '</b> · Z = <span style="color:' + SIM + '">' + U.sgn(ex.z) + 'σ</span></td><td>линейное σ окна = ' + f(ex.std) + ' п.</td></tr>' +
          '</table>';
      }
      draw7();
    }
  });

  /* ---------- 8. Честный эксперимент 4 сценария × 11 историй ---------- */
  const SEEDS8 = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  const s8 = { scen: 0 };

  Z.push({
    id: 'regime-verdict',
    title: 'Честный эксперимент: 4 сценария × 11 историй и памятка границ',
    lead: 'Проверим все четыре схемы на 44 независимых историях — включая сценарий, где простая режимная модель заслуженно обыгрывает слишком тонкую копулу на короткой выборке.',
    full: true,
    mount(el) {
      const summary = E.REGIME_SCENARIOS.map((sc) => {
        const byMode = {};
        MODES.forEach((m) => { byMode[m.id] = { tot: 0, trades: 0, ddSum: 0, seeds: [] }; });
        SEEDS8.forEach((sd) => {
          const rg = E.genRegimeScenario(sd, sc);
          const feat = E.prepareRegimeFeatures(rg, 45);
          MODES.forEach((m) => {
            const bt = E.backtestRegimeCopula(rg, { mode: m.id, precomputed: feat });
            byMode[m.id].tot += bt.metrics.total;
            byMode[m.id].trades += bt.metrics.count;
            byMode[m.id].ddSum += bt.metrics.maxDD;
            byMode[m.id].seeds.push(bt.metrics.total);
          });
        });
        return { sc, byMode };
      });

      el.innerHTML = `
        <div class="viz">
          <h4>Суммарный чистый итог за 11 историй (в пунктах, после всех издержек)</h4>
          <table class="t" id="tab8sum"></table>
        </div>
        <div class="viz" style="margin-top:14px">
          <h4>Детализация по каждой из 11 историй выбранного сценария</h4>
          <div class="btns" id="b8" style="margin:0 0 10px"></div>
          <table class="t" id="tab8det"></table>
        </div>
        <h3 style="margin:24px 0 12px">Шесть выводов о режимах HMM и копулах</h3>
        <div class="cards">
          <div class="card"><h4>1. Распад бывает тихим</h4><p>Когда пара уходит в односторонний снос без роста шума, линейный Z-score теряет −703 п., а чистая копула — −645 п. Фильтр Гамильтона распознаёт снос и сохраняет +114 п.</p></div>
          <div class="card"><h4>2. Сомнение — тоже сигнал</h4><p>В переходных серых зонах и дорогих бурях учёт энтропии сомнений H(t) урезает лот или ставит паузу, превращая убыток −113 п. в устойчивый плюс +56 п.</p></div>
          <div class="card"><h4>3. Хвосты живут отдельно от корреляции</h4><p>В кризис активы падают дуплетом плотнее, чем обещает колокол Гаусса (копула Клейтона), а одиночные шпили надолго портят линейное стандартное отклонение σ.</p></div>
          <div class="card"><h4>4. Сила связки на тяжёлых хвостах</h4><p>На паре с хвостовыми обвалами и поздней сменой режима только союз «HMM-гейт + копула MI» выходит в уверенный плюс (+64 п.), тогда как поодиночке оба подхода буксуют.</p></div>
          <div class="card"><h4>5. Тонкая модель боится малой выборки</h4><p>Четвёртый сценарий честно показывает цену сложности: на коротком шумном окне W = 12 копула переторговывает шум (−200 п.), и более простой HMM-гейт побеждает (+30 против +17 п.).</p></div>
          <div class="card"><h4>6. Иерархия зрелости v2 → v3</h4><p>Марковский режимный гейт — обязательный защитный контур зрелой системы (v2), а копулы и непараметрическое ранжирование — точечный инструмент v3 для длинных выборок с явной асимметрией хвостов.</p></div>
        </div>`;

      el.querySelector('#tab8sum').innerHTML =
        '<tr><th>Рыночный сценарий</th>' + MODES.map((m) => '<th>' + m.name + '</th>').join('') + '</tr>' +
        summary.map((row) =>
          '<tr><td><b>' + row.sc.name + '</b><br><span style="color:#98a3b6;font-size:13px">' + row.sc.note + '</span></td>' +
          MODES.map((m) => {
            const st = row.byMode[m.id];
            return '<td><b>' + col(st.tot, 0) + ' п.</b><br><span style="color:#98a3b6;font-size:13px">' + st.trades + ' сд. · ср. DD −' + f(st.ddSum / SEEDS8.length, 1) + '</span></td>';
          }).join('') + '</tr>'
        ).join('');

      const bEl = el.querySelector('#b8');
      bEl.innerHTML = E.REGIME_SCENARIOS.map((sc, i) => '<button class="b" data-i="' + i + '">' + sc.name + '</button>').join('');
      bEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s8.scen = +b.dataset.i; drawDet8(); } });

      function drawDet8() {
        bEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s8.scen));
        const row = summary[s8.scen];
        el.querySelector('#tab8det').innerHTML =
          '<tr><th>Схема</th>' + SEEDS8.map((sd) => '<th>#' + sd + '</th>').join('') + '<th>Сумма 11 ист.</th></tr>' +
          MODES.map((m) => {
            const st = row.byMode[m.id];
            return '<tr><td><b style="color:' + m.color + '">' + m.name + '</b></td>' +
              st.seeds.map((v) => '<td>' + col(v, 0) + '</td>').join('') +
              '<td><b>' + col(st.tot, 0) + ' п.</b></td></tr>';
          }).join('');
      }
      drawDet8();
    }
  });
})();
