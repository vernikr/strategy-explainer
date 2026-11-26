/* Модельные и адаптивные пороги, экраны 5–8: пошаговый конструктор полос пары,
   симулятор сделок четырёх схем порогов, инспектор дня и честный эксперимент 4×11 (#61, #48). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, HV = window.HV;
  const Z = (window.BDSCREENS = window.BDSCREENS || []);
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', PRE = '#5aa9ff', GOLD = '#ffd166', PURP = '#c9b6ff';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 2 : d) + '</span>';

  const MODES = [
    { id: 'no_hyst', name: 'Узкий зазор без гистерезиса', color: BAD },
    { id: 'fixed_2s', name: 'Шаблон ±2,0σ / 0,4σ', color: SIM },
    { id: 'vol_adapt', name: 'Волю-адаптивные полосы', color: PRE },
    { id: 'ou_carry_pro', name: 'Бертрам (OU) + Carry-overlay', color: ME }
  ];

  const labelPill = (lb) => {
    if (lb === 'drift_against_long') return '<span class="pill stop">Дрейф против лонга — покупка закрыта!</span>';
    if (lb === 'drift_against_short') return '<span class="pill stop">Дрейф против шорта — продажа закрыта!</span>';
    if (lb === 'short_favored') return '<span class="pill ok">Попутный перенос для шорта</span>';
    if (lb === 'long_favored') return '<span class="pill ok">Попутный перенос для лонга</span>';
    return '<span class="pill">Нейтральный перенос (симметрия)</span>';
  };

  /* ---------- 5. Пошаговый ручной конструктор полос для конкретной пары ---------- */
  const PRESETS5 = [
    { name: 'Ликвидный валютный календарь', phi: 0.78, sigma: 1.8, cost: 0.30, volRatio: 1.0, carry: 0.04 },
    { name: 'Широкий акционный спред в шторм', phi: 0.87, sigma: 1.6, cost: 1.75, volRatio: 1.55, carry: 0.0 },
    { name: 'Контанго при высокой ставке', phi: 0.85, sigma: 1.7, cost: 0.65, volRatio: 1.0, carry: 0.35 }
  ];
  const s5 = { idx: 0 };

  Z.push({
    id: 'bands-manual',
    title: 'Как собрать умные пороги вручную: четыре шага расчёта',
    lead: 'Проследим весь конвейер без скрытых формул: от автокорреляции вчерашнего и сегодняшнего дня до готовых левых и правых ворот входа в стакане.',
    text: () => `
      <h3>Четыре прозрачных ступени</h3>
      <ol>
        <li><b>Оцениваем пружину OU:</b> по наклону регрессии <code>X_t ≈ φ · X_{t−1}</code> находим силу притяжения <code>θ = −ln(φ)</code> и полураспад <code>t½ = 0,693 ÷ θ</code>.</li>
        <li><b>Сверяем кандидатов по Бертраму:</b> для каждого пробного порога делим чистый выигрыш <code>(a − m)·σ − c</code> на полное модельное время цикла (удержание + ожидание нового сигнала).</li>
        <li><b>Поправляем на погоду:</b> умножаем базовую ширину на волатильностный множитель <code>(σ_быстрая ÷ σ_длинная)^γ</code>.</li>
        <li><b>Накладываем перенос:</b> сдвигаем ворота в сторону попутного <code>carry</code> и проверяем, не пора ли закрыть встречное направление.</li>
      </ol>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Выберите профиль реальной пары и проверьте таблицу кандидатов</h4>
          <div class="btns" id="b5" style="margin:0 0 10px"></div>
          <div id="step5" style="margin-bottom:10px"></div>
          <table class="t" id="tab5"></table>
          <div id="out5" class="note" style="margin-top:10px"></div>
        </div>`;

      const bEl = el.querySelector('#b5');
      bEl.innerHTML = PRESETS5.map((p, i) => '<button class="b" data-i="' + i + '">' + p.name + '</button>').join('');
      bEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s5.idx = +b.dataset.i; draw5(); } });

      function draw5() {
        bEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s5.idx));
        const pr = PRESETS5[s5.idx];
        const theta = -Math.log(pr.phi), hl = Math.LN2 / theta;
        const opt = E.bertramBands(theta, pr.sigma, pr.cost);
        const cands = [0.80, 1.20, 1.70, 2.30];
        if (!cands.some((c) => Math.abs(c - opt.entryZ) < 0.08)) cands.push(opt.entryZ);
        cands.sort((a, b) => a - b);

        el.querySelector('#step5').innerHTML =
          '<p class="cap">Шаг 1. <b>φ = ' + f(pr.phi) + '</b> → <b>θ = ' + f(theta, 3) + '</b> → полураспад <b>t½ = ' + f(hl, 1) + ' дн.</b> · Разброс <b>σ = ' + f(pr.sigma, 1) + ' п.</b> · Издержки <b>c = ' + f(pr.cost) + ' п.</b></p>';

        el.querySelector('#tab5').innerHTML =
          '<tr><th>Пробный вход a (выход ' + f(opt.exitZ) + 'σ)</th><th>Чистыми со сделки</th><th>Удержание + ожидание</th><th>Темп на 100 дн.</th></tr>' +
          cands.map((a) => {
            const met = E.ouCycleMetrics(a, opt.exitZ, theta, pr.sigma, pr.cost);
            const isOpt = Math.abs(a - opt.entryZ) < 0.06;
            return '<tr' + (isOpt ? ' class="sel"' : '') + '>' +
              '<td>' + (isOpt ? '<b>★ ' + f(a) + 'σ (оптимум OU)</b>' : f(a) + 'σ') + '</td>' +
              '<td>' + col(met.netPerTrade) + ' п.</td>' +
              '<td>' + f(met.holdDays, 1) + ' + ' + f(met.waitDays, 1) + ' = <b>' + f(met.cycleDays, 1) + ' дн.</b></td>' +
              '<td><b>' + col(met.rate100d, 1) + ' п.</b></td></tr>';
          }).join('');

        const vMult = Math.pow(pr.volRatio, 0.85);
        const adjBase = opt.entryZ * vMult;
        const ov = E.carryOverlayBands(adjBase, opt.exitZ, pr.carry, pr.sigma, opt.holdDays);
        el.querySelector('#out5').innerHTML =
          '<b>Шаги 3–4 (итоговые ворота в терминале):</b> множитель погоды <code>×' + f(vMult) + '</code> и перенос <code>' + U.sgn(pr.carry) + ' п./дн.</code> дают:<br>' +
          '• Короткий вход: <b>' + (ov.blockShort ? 'ЗАБЛОКИРОВАН' : '+' + f(ov.shortEntry) + 'σ') + '</b> &nbsp;·&nbsp; ' +
          'Длинный вход: <b>' + (ov.blockLong ? 'ЗАБЛОКИРОВАН (дрейф!)' : '−' + f(ov.longEntry) + 'σ') + '</b> &nbsp;·&nbsp; ' +
          'Выход у среднего: <b>±' + f(ov.exitZ) + 'σ</b>.';
      }
      draw5();
    }
  });

  /* ---------- 6. Правила и сделки четырёх схем порогов ---------- */
  const s6 = { scen: 0, seed: 7, mode: 'ou_carry_pro', n: 45 };

  Z.push({
    id: 'bands-trades',
    title: 'Правила и сделки: четыре схемы порогов лицом к лицу',
    lead: 'Переключайте рыночные истории и сравнивайте живые полосы, сделки и кривые счёта: где пилит узкий зазор, где спит шаблон 2σ, как дышат волю-адаптивные полосы и как работает связка Бертрам + Carry.',
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
          <h4>Z-score сигнала и живые ворота входа/выхода выбранного режима</h4>
          <div class="legend">
            <span><i style="background:${PRE}"></i>z-score сигнала</span>
            <span><i style="background:${GOLD}"></i>верхний и нижний пороги входа</span>
            <span><i style="background:${ME}"></i>коридор выхода</span>
          </div>
          <div id="c6z"></div>
        </div>
        <div class="viz" style="margin-top:12px">
          <h4>Кривые чистого счёта всех четырёх схем порогов</h4>
          <div class="legend">
            ${MODES.map((m) => '<span><i style="background:' + m.color + '"></i>' + m.name + '</span>').join('')}
          </div>
          <div id="c6eq"></div>
        </div>
        <div class="viz" style="margin-top:12px">
          <h4>Журнал сделок: ценовой возврат + собранный/уплаченный перенос − издержки</h4>
          <div style="max-height:280px;overflow:auto"><table class="t" id="tab6"></table></div>
        </div>`;

      const scEl = el.querySelector('#sc6'), sdEl = el.querySelector('#sd6'), mdEl = el.querySelector('#md6');
      scEl.innerHTML = E.BAND_SCENARIOS.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      sdEl.innerHTML = seeds.map((sd) => '<button class="b" data-s="' + sd + '">история #' + sd + '</button>').join('');
      mdEl.innerHTML = MODES.map((m) => '<button class="b" data-m="' + m.id + '">' + m.name + '</button>').join('');

      scEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.scen = +b.dataset.i; draw6(); } });
      sdEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.seed = +b.dataset.s; draw6(); } });
      mdEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.mode = b.dataset.m; draw6(); } });

      HV.slider(el.querySelector('#sl6n'), {
        label: 'Окно расчёта среднего и разброса N', min: 25, max: 70, step: 5, value: s6.n,
        fmt: (v) => v + ' дн.',
        onInput: (v) => { s6.n = v; draw6(); }
      });

      let curBd = null, curBts = null;
      const cZ = A.mkChart(el.querySelector('#c6z'), 195, {
        tip: (i) => {
          if (!curBts) return '';
          const bt = curBts[s6.mode];
          return '<b>День ' + (i + 1) + '</b>' +
            (bt.z[i] !== null ? '<br>z-score: <b>' + U.sgn(bt.z[i]) + 'σ</b><br>вход шорт / лонг: <b style="color:' + GOLD + '">+' + f(bt.upBand[i]) + 'σ / ' + U.sgn(bt.dnBand[i]) + 'σ</b>' : '');
        }
      });
      const cEq = A.mkChart(el.querySelector('#c6eq'), 190, {
        tip: (i) => curBts ? '<b>День ' + (i + 1) + '</b><br>' + MODES.map((m) => '<span style="color:' + m.color + '">' + m.name + ': <b>' + U.sgn(curBts[m.id].equity[i]) + '</b></span>').join('<br>') : ''
      });

      function draw6() {
        scEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s6.scen));
        sdEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.s === s6.seed));
        mdEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === s6.mode));

        const spec = E.BAND_SCENARIOS[s6.scen];
        el.querySelector('#note6').textContent = spec.note;
        curBd = E.genBandScenario(s6.seed, spec);
        curBts = {};
        MODES.forEach((m) => { curBts[m.id] = E.backtestBands(curBd, { n: s6.n, bandMode: m.id }); });

        const bt = curBts[s6.mode];
        const m = bt.metrics;
        const totFees = bt.trades.reduce((s, x) => s + x.cost, 0);
        const totCarry = bt.trades.reduce((s, x) => s + x.carryPnl, 0);

        el.querySelector('#kpi6').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v">' + m.count + '</div><div class="l">сделок</div><div class="e">' + MODES.find((x) => x.id === s6.mode).name + '</div></div>' +
            '<div class="kpi"><div class="v">' + col(m.total, 1) + ' п.</div><div class="l">чистый итог</div><div class="e">после трения и переноса</div></div>' +
            '<div class="kpi"><div class="v">' + col(totCarry, 1) + ' п.</div><div class="l">вклад переноса (Carry)</div><div class="e">накоплено за время в позиции</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + BAD + '">−' + f(totFees, 1) + ' п.</div><div class="l">сумма издержек</div><div class="e">отдано на входе и выходе</div></div>' +
            '<div class="kpi"><div class="v">' + f(-m.maxDD, 1) + ' п.</div><div class="l">макс. просадка</div><div class="e">глубина ямы счёта</div></div>' +
          '</div>';

        const spans = [];
        curBd.inStorm.forEach((st, i) => { if (st) spans.push({ i0: i - 0.5, i1: i + 0.5, color: '#ff6b6b14' }); });
        bt.trades.forEach((tr) => spans.push({ i0: tr.entryIdx, i1: tr.exitIdx, color: tr.net >= 0 ? '#7ee0b520' : '#ff6b6b24' }));

        cZ.render({
          n: curBd.clean.length, spans,
          hlines: [{ y: 0, color: '#ffffff20', dash: [2, 3] }],
          series: [
            { data: bt.z, color: PRE, width: 1.45 },
            { data: bt.upBand, color: GOLD, width: 1.9 },
            { data: bt.dnBand, color: GOLD, width: 1.9 },
            { data: bt.exBand, color: ME, width: 1.2, dash: [4, 4] }
          ]
        });

        cEq.render({
          n: curBd.clean.length,
          hlines: [{ y: 0, color: '#ffffff24', dash: [3, 3] }],
          series: MODES.map((mo) => ({ data: curBts[mo.id].equity, color: mo.color, width: mo.id === s6.mode ? 2.4 : 1.35 }))
        });

        el.querySelector('#tab6').innerHTML =
          '<tr><th>#</th><th>Дни</th><th>Напр.</th><th>z входа → выхода</th><th>Ценовой ход</th><th>Перенос Carry</th><th>Издержки</th><th>Чистый итог</th><th>Выход</th></tr>' +
          (bt.trades.length ? bt.trades.map((tr, idx) =>
            '<tr><td>' + (idx + 1) + '</td><td>' + (tr.entryIdx + 1) + ' → ' + (tr.exitIdx + 1) + ' (' + tr.bars + ' дн.)</td>' +
            '<td>' + (tr.dir > 0 ? 'лонг' : 'шорт') + '</td>' +
            '<td>' + U.sgn(tr.entryZ) + 'σ → ' + U.sgn(tr.exitZ) + 'σ</td>' +
            '<td>' + col(tr.pricePnl) + '</td><td>' + col(tr.carryPnl) + '</td>' +
            '<td class="neg">−' + f(tr.cost) + '</td><td><b>' + col(tr.net) + '</b></td>' +
            '<td><span class="pill ' + (tr.reason === 'stop' ? 'stop' : tr.reason === 'target' ? 'ok' : 'time') + '">' + (A.REASON[tr.reason] || tr.reason) + '</span></td></tr>'
          ).join('') : '<tr><td colspan="9" style="color:#98a3b6">При данных порогах сделок не было.</td></tr>');
      }
      draw6();
    }
  });

  /* ---------- 7. Пошаговый инспектор одного дня ---------- */
  const s7 = { scen: 3, day: 140, n: 45 };

  Z.push({
    id: 'bands-day',
    title: 'Один день под лупой: как из прошлого окна рождаются ворота дня',
    lead: 'Выберите любой день истории и проверьте, как без единого заглядывания в будущее оцениваются полураспад пары, модельные границы Бертрама, множитель волатильности и сдвиг переноса.',
    full: true,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div class="btns" id="sc7"></div>
            <div class="btns" id="jmp7">
              <button class="b" data-j="prev">◀ Пред. день</button>
              <button class="b" data-j="next">След. день ▶</button>
              <button class="b" data-j="storm">⚡ Внутрь шторма</button>
              <button class="b" data-j="carry">🌊 Режим переноса</button>
            </div>
          </div>
          <div id="sl7"></div>
        </div>
        <div class="cols" style="margin-top:14px">
          <div id="left7" class="viz"></div>
          <div id="right7" class="viz"></div>
        </div>`;

      const scEl = el.querySelector('#sc7');
      scEl.innerHTML = E.BAND_SCENARIOS.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      scEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s7.scen = +b.dataset.i; draw7(); } });

      let bd = E.genBandScenario(7, E.BAND_SCENARIOS[s7.scen]);
      const slCtl = HV.slider(el.querySelector('#sl7'), {
        label: 'Проверяемый день t', min: 50, max: 315, step: 1, value: s7.day,
        fmt: (v) => 'День #' + (v + 1),
        onInput: (v) => { s7.day = v; render7(); }
      });

      el.querySelector('#jmp7').addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        const j = b.dataset.j;
        if (j === 'prev') s7.day = Math.max(50, s7.day - 1);
        else if (j === 'next') s7.day = Math.min(315, s7.day + 1);
        else if (j === 'storm') { s7.scen = 2; s7.day = 155; }
        else if (j === 'carry') { s7.scen = 3; s7.day = 140; }
        slCtl.set(s7.day);
        draw7();
      });

      function draw7() {
        scEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s7.scen));
        bd = E.genBandScenario(7, E.BAND_SCENARIOS[s7.scen]);
        render7();
      }

      function render7() {
        const ex = E.explainBands(bd, s7.n, s7.day);
        el.querySelector('#left7').innerHTML =
          '<h4>Физика OU и расчёт Бертрама на вечер дня #' + (s7.day + 1) + '</h4>' +
          '<table class="t">' +
            '<tr><th>Величина (только по прошлым дням)</th><th>Значение</th><th>Пояснение</th></tr>' +
            '<tr><td>Оценка авторегрессии φ и силы θ</td><td>φ = ' + f(ex.ou.phi) + ' · <b>θ = ' + f(ex.ou.theta, 3) + '</b></td><td>полураспад t½ = <b>' + f(ex.ou.halfLife, 1) + ' дн.</b></td></tr>' +
            '<tr><td>Текущий разброс окна σ</td><td><b>' + f(ex.stdClean) + ' п.</b></td><td>среднее окна μ = ' + U.sgn(ex.meanClean) + ' п.</td></tr>' +
            '<tr><td>Круговые издержки сейчас</td><td><b>' + f(ex.effCost) + ' п.</b></td><td>' + (ex.inStorm ? 'шторм: трение ×2,4!' : 'спокойный стакан') + '</td></tr>' +
            '<tr><td><b>Модельный оптимум Бертрама</b></td><td><b style="color:' + GOLD + '">±' + f(ex.bertram.entryZ) + 'σ → ±' + f(ex.bertram.exitZ) + 'σ</b></td><td>гистерезис ' + f(ex.bertram.hystZ) + 'σ</td></tr>' +
            '<tr><td>Ожидаемый цикл сделки OU</td><td>' + f(ex.bertram.holdDays, 1) + ' дн. в сделке + ' + f(ex.bertram.waitDays, 1) + ' дн. ожидания</td><td>модельный темп ' + U.sgn(ex.bertram.rate100d, 1) + ' п./100 дн.</td></tr>' +
          '</table>';

        el.querySelector('#right7').innerHTML =
          '<h4>Волю-адаптация, Carry-overlay и сигнал дня #' + (s7.day + 1) + '</h4>' +
          '<div style="margin:6px 0 12px">' + labelPill(ex.overlay.label) + '</div>' +
          '<table class="t">' +
            '<tr><th>Надстройка / сигнал</th><th>Значение</th><th>Сравнение</th></tr>' +
            '<tr><td>Множитель волатильности (GARCH/EWMA)</td><td><b>×' + f(ex.volMult) + '</b></td><td>волю-адаптивный вход ±' + f(ex.volEntry) + 'σ</td></tr>' +
            '<tr><td>Суточный перенос пары</td><td><b>' + U.sgn(ex.dailyCarry) + ' п./дн.</b></td><td>на горизонте сделки: ' + U.sgn(ex.overlay.carryInSigma) + 'σ</td></tr>' +
            '<tr><td><b>Итоговые ворота Бертрам + Carry</b></td><td>Шорт: <b>' + (ex.overlay.blockShort ? 'ЗАКРЫТ' : '+' + f(ex.overlay.shortEntry) + 'σ') + '</b><br>Лонг: <b>' + (ex.overlay.blockLong ? 'ЗАКРЫТ' : '−' + f(ex.overlay.longEntry) + 'σ') + '</b></td><td>выход у ±' + f(ex.overlay.exitZ) + 'σ</td></tr>' +
            '<tr><td>Сырой z против очищенного z</td><td>сырой: <span style="color:' + BAD + '">' + U.sgn(ex.zRaw) + 'σ</span> · чистый: <b style="color:' + ME + '">' + U.sgn(ex.zClean) + 'σ</b></td><td>защита от ловушки дрейфа</td></tr>' +
          '</table>';
      }
      draw7();
    }
  });

  /* ---------- 8. Честный эксперимент 4 сценария × 11 историй ---------- */
  const SEEDS8 = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  const s8 = { scen: 0 };

  Z.push({
    id: 'bands-verdict',
    title: 'Честный эксперимент: 4 режима × 11 историй и памятка по полосам',
    lead: 'Проверим все четыре схемы порогов на 44 независимых историях без подгонки под будущее и подведём честный итог: когда оправдана каждая ступень сложности.',
    full: true,
    mount(el) {
      const summary = E.BAND_SCENARIOS.map((sc) => {
        const byMode = {};
        MODES.forEach((m) => { byMode[m.id] = { tot: 0, trades: 0, ddSum: 0, seeds: [] }; });
        SEEDS8.forEach((sd) => {
          const bd = E.genBandScenario(sd, sc);
          MODES.forEach((m) => {
            const bt = E.backtestBands(bd, { bandMode: m.id });
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
          <h4>Суммарный чистый итог за 11 историй (в пунктах, после всех издержек и переноса)</h4>
          <table class="t" id="tab8sum"></table>
        </div>
        <div class="viz" style="margin-top:14px">
          <h4>По каждой из 11 историй выбранного сценария</h4>
          <div class="btns" id="b8" style="margin:0 0 10px"></div>
          <table class="t" id="tab8det"></table>
        </div>
        <h3 style="margin:24px 0 12px">Шесть выводов о порогах входа и выхода</h3>
        <div class="cards">
          <div class="card"><h4>1. Гистерезис — броня от комиссий</h4><p>Узкий зазор между входом и выходом при высоком трении стакана мгновенно уводит стратегию в глубокий минус (−362 п.) при сотнях суетливых сделок.</p></div>
          <div class="card"><h4>2. «2σ для всего» теряет деньги</h4><p>На быстрой дешёвой паре шаблон 2σ оставляет на столе больше половины прибыли (+411 против +954 п.), потому что ждёт редких выбросов там, где можно собирать частые упругие возвраты.</p></div>
          <div class="card"><h4>3. Комиссия диктует ширину полос</h4><p>В формулах Бертрама круговая стоимость сделки c прямо входит в числитель: вырос спред стакана — вход автоматически обязан отодвинуться дальше от нуля.</p></div>
          <div class="card"><h4>4. «Оптимально по модели ≠ вообще»</h4><p>Границы Бертрама верны ровно настолько, насколько ряд похож на гладкую пружину OU. При резких кластерах волатильности их нужно дополнять адаптивным дыханием полос.</p></div>
          <div class="card"><h4>5. Дыхание мягче стоп-крана</h4><p>Волю-адаптивные пороги не выключают торговлю целиком, а поджимают полосы в сонный рынок и раздвигают в шторм (+453 против +388 п. у шаблона 2σ).</p></div>
          <div class="card"><h4>6. Не гребите против переноса</h4><p>При сильном контанго или SwapRate вход против систематического дрейфа разоряет симметричные стратегии (−648 п.), тогда как Carry-overlay превращает перенос в союзника (+675 п.).</p></div>
        </div>`;

      el.querySelector('#tab8sum').innerHTML =
        '<tr><th>Рыночный режим</th>' + MODES.map((m) => '<th>' + m.name + '</th>').join('') + '</tr>' +
        summary.map((row) =>
          '<tr><td><b>' + row.sc.name + '</b><br><span style="color:#98a3b6;font-size:13px">' + row.sc.note + '</span></td>' +
          MODES.map((m) => {
            const st = row.byMode[m.id];
            return '<td><b>' + col(st.tot, 0) + ' п.</b><br><span style="color:#98a3b6;font-size:13px">' + st.trades + ' сд. · ср. DD −' + f(st.ddSum / SEEDS8.length, 1) + '</span></td>';
          }).join('') + '</tr>'
        ).join('');

      const bEl = el.querySelector('#b8');
      bEl.innerHTML = E.BAND_SCENARIOS.map((sc, i) => '<button class="b" data-i="' + i + '">' + sc.name + '</button>').join('');
      bEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s8.scen = +b.dataset.i; drawDet8(); } });

      function drawDet8() {
        bEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s8.scen));
        const row = summary[s8.scen];
        el.querySelector('#tab8det').innerHTML =
          '<tr><th>Схема порогов</th>' + SEEDS8.map((sd) => '<th>#' + sd + '</th>').join('') + '<th>Сумма 11 ист.</th></tr>' +
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
