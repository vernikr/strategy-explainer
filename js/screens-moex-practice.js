/* Микроструктура срочного рынка MOEX, экраны 5–8: четырёхслойные издержки, RoM и стрессовое ГО,
   правила и сделки с полной бухгалтерией клиринга, пошаговый инспектор дня и честный эксперимент 4×11 (#55, #46). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, HV = window.HV;
  const Z = (window.MXSCREENS = window.MXSCREENS || []);
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', PRE = '#5aa9ff', GOLD = '#ffd166', PURP = '#c9b6ff';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 2 : d) + '</span>';

  const MODES = [
    { id: 'naive_last', name: 'По ласту 23:49', color: BAD },
    { id: 'raw_sp', name: 'Сырой SP (без очистки)', color: SIM },
    { id: 'clean_leg', name: 'Очищ. + леггирование', color: PRE },
    { id: 'moex_pro', name: 'MOEX Pro (стакан спреда + резерв ГО)', color: ME }
  ];

  /* ---------- 5. RoM, скидка за календарный спред и двойной удар стрессового ГО ---------- */
  const s5 = { grossPts: 3.4, calmDisc: 0.72, stressDisc: 0.15, cashRatio: 1.5 };

  Z.push({
    id: 'rom-stress',
    title: 'Доходность на ГО (RoM) и двойной удар стрессового ГО',
    lead: 'На срочном рынке вы не оплачиваете полную стоимость контрактов, а замораживаете гарантийное обеспечение (ГО). Скидка за календарный спред делает RoM высоким — но в день рыночного шторма она же превращается в ловушку принудительного закрытия.',
    text: () => `
      <h3>Как считать ${T('rom_metric', 'доходность на ГО (RoM)')}</h3>
      <p>Два разнонаправленных фьючерса на один актив страхуют друг друга, поэтому клиринговый центр НКЦ даёт на пару заметную <b>маржевую скидку</b> <code>D_cal</code> (в спокойные дни она может срезать суммарное ГО пары на 60–75%):</p>
      <span class="formula">Нетто-ГО = 2 · ГО_ноги · (1 − D_cal), &nbsp;&nbsp; RoM = Чистая прибыль ÷ Нетто-ГО</span>
      <h3>Почему во время паники случается ${T('stress_margin', 'двойной удар по ГО')}</h3>
      <p>Новички набирают календарные спреды «на все свободные деньги», глядя на маленькое спокойное ГО. Но при резком рыночном шоке срабатывают <b>сразу два рычага</b> против вашего счёта:</p>
      <ul>
        <li>базовая ставка ГО каждой ноги расширяется в <b>1,5–2,0 раза</b> вслед за планками цены;</li>
        <li>одновременно сжимается сама скидка за спред <code>D_cal</code> (скажем, с 72% до 15%), потому что ближняя и дальняя серии в панику начинают ходить вразнобой!</li>
      </ul>
      <div class="note bad"><b>Главное правило выживания:</b> размер позиции ограничивают не по сегодняшнему льготному ГО, а по <b>стрессовому ГО без скидки</b> плюс запас на вариационную маржу!</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Калькулятор RoM и проверки на маржин-колл при сжатии скидки</h4>
          <p class="cap">Базовое ГО одной ноги = 14 п. (1 400 ₽ при шаге 100 ₽/п.). В шторм базовое ГО вырастает в 1,7 раза.</p>
          <div id="sl5a"></div>
          <div id="sl5b"></div>
          <div id="sl5c"></div>
          <div id="k5" style="margin-top:10px"></div>
          <table class="t" id="tab5" style="margin-top:10px"></table>
          <div id="ver5" class="note" style="margin-top:10px"></div>
        </div>`;

      HV.slider(el.querySelector('#sl5a'), {
        label: 'Ожидаемая валовая прибыль одной сделки (до издержек)', min: 1.0, max: 6.0, step: 0.2, value: s5.grossPts,
        fmt: (v) => '+' + f(v, 1) + ' п.',
        onInput: (v) => { s5.grossPts = v; draw5(); }
      });
      HV.slider(el.querySelector('#sl5b'), {
        label: 'Скидка НКЦ за календарный спред в спокойный рынок (D_cal)', min: 0.20, max: 0.80, step: 0.04, value: s5.calmDisc,
        fmt: (v) => Math.round(v * 100) + '% скидки',
        onInput: (v) => { s5.calmDisc = v; draw5(); }
      });
      HV.slider(el.querySelector('#sl5c'), {
        label: 'Капитал на счёте на 1 пару (в долях от спокойного Нетто-ГО)', min: 1.1, max: 6.5, step: 0.2, value: s5.cashRatio,
        fmt: (v) => f(v, 1) + ' × спокойного ГО',
        onInput: (v) => { s5.cashRatio = v; draw5(); }
      });

      function draw5() {
        const feeCalm = E.decomposeCosts({ nativeBook: true, stressed: false }).total;
        const feeStress = E.decomposeCosts({ nativeBook: true, stressed: true }).total;
        const netCalm = s5.grossPts - feeCalm;
        const netStress = s5.grossPts - feeStress;
        const romC = E.calcRoM(netCalm, 14, s5.calmDisc, 1.7, s5.stressDisc);
        const romS = E.calcRoM(netStress, 14, s5.calmDisc, 1.7, s5.stressDisc);
        const cashPts = romC.calmGo * s5.cashRatio;
        const survive = cashPts >= romC.stressGo;

        el.querySelector('#k5').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + ME + '">' + f(romC.calmGo, 1) + ' п.</div><div class="l">Нетто-ГО в штиль</div><div class="e">после скидки ' + Math.round(s5.calmDisc * 100) + '%</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + BAD + '">' + f(romC.stressGo, 1) + ' п.</div><div class="l">Нетто-ГО в шторм</div><div class="e">рост в ' + f(romC.stressGo / romC.calmGo, 1) + ' раза!</div></div>' +
            '<div class="kpi"><div class="v">' + col(romC.romCalmPct, 1) + '%</div><div class="l">RoM на спокойное ГО</div><div class="e">на бумаге в тихий день</div></div>' +
            '<div class="kpi"><div class="v">' + col(romS.romStressPct, 1) + '%</div><div class="l">RoM на стрессовое ГО</div><div class="e">честная доходность с резервом</div></div>' +
          '</div>';

        el.querySelector('#tab5').innerHTML =
          '<tr><th>Режим рынка</th><th>Издержки круга</th><th>Чистый итог сделки</th><th>Требуемое ГО</th><th>Ваш кэш на пару</th></tr>' +
          '<tr><td>Спокойный рынок (штиль)</td><td>−' + f(feeCalm) + ' п.</td><td>' + col(netCalm) + ' п.</td><td>' + f(romC.calmGo) + ' п.</td><td>' + f(cashPts) + ' п.</td></tr>' +
          '<tr><td>Стресс-режим (скачок ГО + ужатие скидки до 15%)</td><td class="neg">−' + f(feeStress) + ' п.</td><td>' + col(netStress) + ' п.</td><td class="neg"><b>' + f(romC.stressGo) + ' п.</b></td><td>' + (survive ? '<span class="pos">' + f(cashPts) + ' п. (хватает)</span>' : '<span class="neg"><b>' + f(cashPts) + ' п. (МАРЖИН-КОЛЛ!)</b></span>') + '</td></tr>';

        const vEl = el.querySelector('#ver5');
        if (!survive) {
          vEl.className = 'note bad';
          vEl.innerHTML = '<b>Маржин-колл неизбежен!</b> На 1 пару выделено ' + f(cashPts, 1) + ' п. кэша, а в вечер стресса НКЦ потребует <b>' + f(romC.stressGo, 1) + ' п.</b> Брокер принудительно закроет вашу пару по худшим ценам раздвинутого стакана, даже если сам спред никуда не сломался!';
        } else {
          vEl.className = 'note';
          vEl.innerHTML = '<b>Позиция защищена от скачка ГО:</b> запас кэша (' + f(cashPts, 1) + ' п.) перекрывает стрессовое требование (' + f(romC.stressGo, 1) + ' п.). Реалистичная отдача на капитал с учётом буфера — <b>' + U.sgn((netCalm / cashPts) * 100, 1) + '%</b> за сделку.';
        }
      }
      draw5();
    }
  });

  /* ---------- 6. Правила, сделки и полная бухгалтерия клиринга ---------- */
  const s6 = { scen: 0, seed: 7, mode: 'moex_pro', n: 30, entryZ: 2.0, exitZ: 0.4, capitalPts: 16 };

  Z.push({
    id: 'moex-trades',
    title: 'Правила, сделки и полная бухгалтерия клиринга',
    lead: 'Посмотрите на одну и ту же рыночную историю глазами четырёх трейдеров: кто ловит фальшивые вечерние принты, кто попадается в ловушку SwapRate и дивидендов, кого выбивает скачок ГО — и как работает чистый расчёт.',
    full: true,
    mount(el) {
      const seeds = [1, 7, 13, 21, 42];
      el.innerHTML = `
        <div class="viz">
          <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div class="btns" id="sc6"></div>
            <div class="btns" id="sd6"></div>
          </div>
          <p id="desc6" style="margin:0 0 10px;color:#98a3b6"></p>
          <div class="btns" id="md6" style="margin:0 0 12px"></div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px" id="sl6">
            <div id="sl6n"></div><div id="sl6in"></div><div id="sl6out"></div><div id="sl6cap"></div>
          </div>
        </div>
        <div id="kpi6" style="margin-top:12px"></div>
        <div class="viz" style="margin-top:12px">
          <h4>Сырой спред клиринга SP, справедливый перенос и сделки выбранного режима</h4>
          <div class="legend">
            <span><i style="background:${SIM}"></i>сырой спред SP (Кварт − Вечный)</span>
            <span><i style="background:${GOLD}"></i>справедливый перенос (ставка − дивиденд)</span>
            <span><i style="background:${ME}"></i>очищенный спред</span>
          </div>
          <div id="c6top"></div>
        </div>
        <div class="viz" style="margin-top:12px">
          <h4>Кривые счёта всех четырёх режимов (на одних и тех же котировках)</h4>
          <div class="legend">
            ${MODES.map((m) => '<span><i style="background:' + m.color + '"></i>' + m.name + '</span>').join('')}
          </div>
          <div id="c6eq"></div>
        </div>
        <div class="viz" style="margin-top:12px">
          <h4>Журнал сделок: разложение на ценовую VM, дивидендную ступеньку, SwapRate и 4 слоя издержек</h4>
          <div style="max-height:290px;overflow:auto"><table class="t" id="tab6"></table></div>
        </div>`;

      const scEl = el.querySelector('#sc6'), sdEl = el.querySelector('#sd6'), mdEl = el.querySelector('#md6');
      scEl.innerHTML = E.MOEX_SCENARIOS.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      sdEl.innerHTML = seeds.map((sd) => '<button class="b" data-s="' + sd + '">история #' + sd + '</button>').join('');
      mdEl.innerHTML = MODES.map((m) => '<button class="b" data-m="' + m.id + '">' + m.name + '</button>').join('');

      scEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.scen = +b.dataset.i; draw6(); } });
      sdEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.seed = +b.dataset.s; draw6(); } });
      mdEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.mode = b.dataset.m; draw6(); } });

      HV.slider(el.querySelector('#sl6n'), { label: 'Окно N', min: 15, max: 60, step: 5, value: s6.n, fmt: (v) => v + ' дн.', onInput: (v) => { s6.n = v; draw6(); } });
      HV.slider(el.querySelector('#sl6in'), { label: 'Вход |z| ≥', min: 1.5, max: 3.0, step: 0.25, value: s6.entryZ, fmt: (v) => f(v, 2) + 'σ', onInput: (v) => { s6.entryZ = v; draw6(); } });
      HV.slider(el.querySelector('#sl6out'), { label: 'Выход |z| ≤', min: 0.0, max: 1.0, step: 0.2, value: s6.exitZ, fmt: (v) => f(v, 2) + 'σ', onInput: (v) => { s6.exitZ = v; draw6(); } });
      HV.slider(el.querySelector('#sl6cap'), { label: 'Кэш на пару (без резерва Pro)', min: 10, max: 45, step: 2, value: s6.capitalPts, fmt: (v) => v + ' п.', onInput: (v) => { s6.capitalPts = v; draw6(); } });

      let curMx = null, curBts = null;
      const cTop = A.mkChart(el.querySelector('#c6top'), 200, {
        tip: (i) => curMx ? '<b>День ' + (i + 1) + '</b><br>сырой SP: <b>' + f(curMx.spRaw[i]) + '</b> · перенос: <b>' + f(curMx.fairBasis[i]) + '</b><br>очищенный: <b style="color:' + ME + '">' + f(curMx.cleanSpread[i]) + '</b>' + (curMx.inStress[i] ? '<br><b style="color:' + BAD + '">стресс-ГО: ' + f(curMx.reqGo[i]) + ' п.</b>' : '') : ''
      });
      const cEq = A.mkChart(el.querySelector('#c6eq'), 190, {
        tip: (i) => curBts ? '<b>День ' + (i + 1) + '</b><br>' + MODES.map((m) => '<span style="color:' + m.color + '">' + m.name + ': <b>' + U.sgn(curBts[m.id].equity[i]) + '</b></span>').join('<br>') : ''
      });

      function draw6() {
        scEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s6.scen));
        sdEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.s === s6.seed));
        mdEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === s6.mode));

        const spec = E.MOEX_SCENARIOS[s6.scen];
        el.querySelector('#desc6').textContent = spec.note;
        curMx = E.genMoexScenario(s6.seed, spec);
        const baseP = { n: s6.n, entryZ: s6.entryZ, exitZ: s6.exitZ, stopZ: 3.6, maxHold: 30, cost: 0.5, capitalPts: s6.capitalPts };
        curBts = {};
        MODES.forEach((m) => { curBts[m.id] = E.backtestMoex(curMx, Object.assign({}, baseP, { moexMode: m.id })); });

        const bt = curBts[s6.mode];
        const m = bt.metrics;
        el.querySelector('#kpi6').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v">' + m.count + '</div><div class="l">сделок</div><div class="e">режим: ' + MODES.find((x) => x.id === s6.mode).name + '</div></div>' +
            '<div class="kpi"><div class="v">' + col(m.total, 1) + ' п.</div><div class="l">чистый итог</div><div class="e">после SwapRate и всех сборов</div></div>' +
            '<div class="kpi"><div class="v">' + f(-m.maxDD, 1) + ' п.</div><div class="l">макс. просадка</div><div class="e">по вечернему клирингу</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + (bt.marginCalls > 0 ? BAD : ME) + '">' + bt.marginCalls + '</div><div class="l">маржин-коллов</div><div class="e">при скачке стрессового ГО</div></div>' +
            '<div class="kpi"><div class="v">' + col(bt.rom.romStressPct, 1) + '%</div><div class="l">RoM на стресс-ГО</div><div class="e">отдача на полный резерв</div></div>' +
          '</div>';

        const spans = [];
        curMx.inStress.forEach((st, i) => { if (st) spans.push({ i0: i - 0.5, i1: i + 0.5, color: '#ff6b6b14' }); });
        bt.trades.forEach((tr) => spans.push({ i0: tr.entryIdx, i1: tr.exitIdx, color: tr.net >= 0 ? '#7ee0b522' : '#ff6b6b28' }));
        const markers = [];
        bt.trades.forEach((tr) => {
          markers.push({ i: tr.entryIdx, y: curMx.cleanSpread[tr.entryIdx], color: PRE, r: 3.5 });
          markers.push({ i: tr.exitIdx, y: curMx.cleanSpread[tr.exitIdx], color: tr.reason === 'margin' ? BAD : GOLD, r: 3.8 });
        });

        cTop.render({
          n: curMx.spRaw.length, spans, markers,
          hlines: [{ y: 0, color: '#ffffff24', dash: [3, 3] }],
          series: [
            { data: curMx.spRaw, color: SIM, width: 1.35 },
            { data: curMx.fairBasis, color: GOLD, width: 1.4, dash: [5, 4] },
            { data: curMx.cleanSpread, color: ME, width: 1.85 }
          ]
        });

        cEq.render({
          n: curMx.spRaw.length,
          hlines: [{ y: 0, color: '#ffffff24', dash: [3, 3] }],
          series: MODES.map((mo) => ({ data: curBts[mo.id].equity, color: mo.color, width: mo.id === s6.mode ? 2.4 : 1.35 }))
        });

        el.querySelector('#tab6').innerHTML =
          '<tr><th>#</th><th>Дни</th><th>Напр.</th><th>Ценовая VM</th><th>Див. попр.</th><th>SwapRate</th><th>Издержки</th><th>Чистый итог</th><th>Причина выхода</th></tr>' +
          (bt.trades.length ? bt.trades.map((tr, idx) =>
            '<tr><td>' + (idx + 1) + '</td><td>' + (tr.entryIdx + 1) + ' → ' + (tr.exitIdx + 1) + ' (' + tr.bars + ' дн.)</td>' +
            '<td>' + (tr.dir > 0 ? 'лонг спреда' : 'шорт спреда') + '</td>' +
            '<td>' + col(tr.priceVm) + '</td><td>' + col(tr.divComp) + '</td><td>' + col(tr.swapFlow) + '</td>' +
            '<td class="neg">−' + f(tr.cost) + '</td><td><b>' + col(tr.net) + '</b></td>' +
            '<td><span class="pill ' + (tr.reason === 'margin' || tr.reason === 'stop' ? 'stop' : tr.reason === 'exit' ? 'ok' : 'time') + '">' + A.REASON[tr.reason] + '</span></td></tr>'
          ).join('') : '<tr><td colspan="9" style="color:#98a3b6">При таких порогах сделок не открылось.</td></tr>');
      }
      draw6();
    }
  });

  /* ---------- 7. Пошаговый разбор одного торгового дня на MOEX ---------- */
  const s7 = { scen: 1, day: 70, n: 20, mode: 'moex_pro' };

  Z.push({
    id: 'moex-day',
    title: 'Один вечерний клиринг под лупой: все числа по шагам',
    lead: 'Выберите любой день из 320 и проверьте своими глазами: как расходятся последняя сделка 23:49 и расчётная цена SP, сколько суток переноса списывается сегодня, откуда берётся очищенный спред и честно ли посчитан z-score.',
    full: true,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div class="btns" id="sc7"></div>
            <div class="btns" id="jmp7">
              <button class="b" data-j="prev">◀ Пред. день</button>
              <button class="b" data-j="next">След. день ▶</button>
              <button class="b" data-j="mon">Понедельник (×3 суток)</button>
              <button class="b" data-j="event">⚡ Отсечка / Стресс</button>
            </div>
          </div>
          <div id="sl7"></div>
        </div>
        <div class="cols" style="margin-top:14px">
          <div id="left7" class="viz"></div>
          <div id="right7" class="viz"></div>
        </div>`;

      const scEl = el.querySelector('#sc7');
      scEl.innerHTML = E.MOEX_SCENARIOS.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      scEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s7.scen = +b.dataset.i; draw7(); } });

      let mx = E.genMoexScenario(7, E.MOEX_SCENARIOS[s7.scen]);
      let slCtl = HV.slider(el.querySelector('#sl7'), {
        label: 'Проверяемый вечерний клиринг (день t)', min: 25, max: 315, step: 1, value: s7.day,
        fmt: (v) => 'День ' + (v + 1),
        onInput: (v) => { s7.day = v; renderDay(); }
      });

      el.querySelector('#jmp7').addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        const j = b.dataset.j;
        if (j === 'prev') s7.day = Math.max(25, s7.day - 1);
        else if (j === 'next') s7.day = Math.min(315, s7.day + 1);
        else if (j === 'mon') {
          for (let k = s7.day + 1; k < 315; k++) if (mx.isWeekend[k]) { s7.day = k; break; }
        } else if (j === 'event') {
          let found = -1;
          for (let k = 25; k < 315; k++) if (mx.isDivDay[k] || mx.inStress[k] || Math.abs(mx.lastRaw[k] - mx.spRaw[k]) > 1.2) { found = k; if (k > s7.day) break; }
          if (found >= 25) s7.day = found;
        }
        slCtl.set(s7.day);
        renderDay();
      });

      function draw7() {
        scEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s7.scen));
        mx = E.genMoexScenario(7, E.MOEX_SCENARIOS[s7.scen]);
        renderDay();
      }

      function renderDay() {
        const ex = E.explainMoex(mx, s7.n, s7.day, { moexMode: s7.mode });
        const costInfo = E.decomposeCosts({ nativeBook: true, stressed: ex.inStress, volumeLots: 1 });
        const flags = [];
        if (ex.isWeekend) flags.push('<span class="pill time">Понедельник: ' + ex.carryDays + ' календарных дня сразу</span>');
        if (ex.isDivDay) flags.push('<span class="pill ok">Дивидендная отсечка базового актива!</span>');
        if (ex.inStress) flags.push('<span class="pill stop">Стресс-режим ГО: ' + f(ex.reqGo) + ' п.</span>');
        if (!flags.length) flags.push('<span class="pill">Штатный будний клиринг (1 сутки переноса)</span>');

        el.querySelector('#left7').innerHTML =
          '<h4>Шаги 1–2. Бухгалтерия клиринга дня #' + (s7.day + 1) + '</h4>' +
          '<div style="margin:6px 0 12px;display:flex;gap:8px;flex-wrap:wrap">' + flags.join('') + '</div>' +
          '<table class="t">' +
            '<tr><th>Величина</th><th>Значение</th><th>Пояснение</th></tr>' +
            '<tr><td>Квартальный SP / Вечный SP</td><td><b>' + f(ex.spQuart) + '</b> / <b>' + f(ex.spPerp) + '</b></td><td>расчётные цены 23:50</td></tr>' +
            '<tr><td>Сырой спред по клирингу SP</td><td><b>' + U.sgn(ex.spRaw) + ' п.</b></td><td>SP_кварт − SP_вечный</td></tr>' +
            '<tr><td>Последняя сделка 23:49 (ласт)</td><td style="color:' + (Math.abs(ex.lastRaw - ex.spRaw) > 0.8 ? BAD : '#cdd7e8') + '">' + U.sgn(ex.lastRaw) + ' п.</td><td>отклонение от SP: ' + U.sgn(ex.lastRaw - ex.spRaw) + ' п.</td></tr>' +
            '<tr><td>Справедливый перенос (базис)</td><td style="color:' + GOLD + '">' + U.sgn(ex.fairBasis) + ' п.</td><td>ставка до экспирации минус ожид. дивиденд</td></tr>' +
            '<tr><td><b>Очищенный спред (сигнал)</b></td><td><b style="color:' + ME + '">' + U.sgn(ex.cleanSpread) + ' п.</b></td><td>SP_сырой − Справедливый перенос</td></tr>' +
            '<tr><td>SwapRate вечного за этот клиринг</td><td>' + col(-ex.swapPaid) + ' п.</td><td>на 1 лонг вечного (' + ex.carryDays + ' календ. дн.)</td></tr>' +
            '<tr><td>Круговые издержки и ГО сейчас</td><td>−' + f(costInfo.total) + ' п. · ГО ' + f(ex.reqGo) + ' п.</td><td>' + (costInfo.usedNative ? 'нативный стакан спреда' : 'имплиц. ликвидность сжата (стресс)') + '</td></tr>' +
          '</table>';

        const rows = ex.rows.slice(-8);
        el.querySelector('#right7').innerHTML =
          '<h4>Шаг 3. Окно из ' + s7.n + ' прошлых клирингов (показаны крайние 8 из ' + s7.n + ')</h4>' +
          '<p class="cap">В расчёт входят только дни <b>#' + (ex.rows[0].idx + 1) + ' … #' + (s7.day + 1) + '</b> — ни одного числа из завтрашнего дня!</p>' +
          '<table class="t">' +
            '<tr><th>День</th><th>Очищ. спред x</th><th>Откл. x − μ</th><th>Квадрат (x − μ)²</th></tr>' +
            rows.map((rw) => '<tr' + (rw.idx === s7.day ? ' class="sel"' : '') + '><td>#' + (rw.idx + 1) + '</td><td>' + U.sgn(rw.value) + '</td><td>' + U.sgn(rw.dev) + '</td><td>' + f(rw.sq, 3) + '</td></tr>').join('') +
          '</table>' +
          '<div class="note" style="margin-top:10px">' +
            'Среднее окна <b>μ = ' + U.sgn(ex.mean) + ' п.</b> · Разброс <b>σ = ' + f(ex.std) + ' п.</b><br>' +
            '<b>z = (' + U.sgn(ex.value) + ' − ' + U.sgn(ex.mean) + ') ÷ ' + f(ex.std) + ' = <span style="color:' + (Math.abs(ex.z) >= 2 ? GOLD : ME) + '">' + U.sgn(ex.z) + 'σ</span></b>' +
          '</div>';
      }
      draw7();
    }
  });

  /* ---------- 8. Честный эксперимент 4 сценария × 11 историй и предторговый чек-лист ---------- */
  const SEEDS8 = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  const s8 = { scen: 0 };

  Z.push({
    id: 'moex-verdict',
    title: 'Честный эксперимент: четыре ловушки MOEX × 11 историй',
    lead: 'Прогоним все четыре подхода с одинаковыми порогами (N = 30, вход 2,0σ, выход 0,4σ) по 11 независимым историям в каждом из четырёх реальных режимов срочного рынка Московской биржи.',
    full: true,
    mount(el) {
      const summary = E.MOEX_SCENARIOS.map((sc) => {
        const byMode = {};
        MODES.forEach((m) => { byMode[m.id] = { tot: 0, trades: 0, mc: 0, ddSum: 0, seeds: [] }; });
        SEEDS8.forEach((sd) => {
          const mx = E.genMoexScenario(sd, sc);
          MODES.forEach((m) => {
            const bt = E.backtestMoex(mx, { n: 30, entryZ: 2.0, exitZ: 0.4, stopZ: 3.6, maxHold: 30, cost: 0.5, capitalPts: 16, moexMode: m.id });
            byMode[m.id].tot += bt.metrics.total;
            byMode[m.id].trades += bt.metrics.count;
            byMode[m.id].mc += bt.marginCalls;
            byMode[m.id].ddSum += bt.metrics.maxDD;
            byMode[m.id].seeds.push(bt.metrics.total);
          });
        });
        return { sc, byMode };
      });

      el.innerHTML = `
        <div class="viz">
          <h4>Суммарный чистый итог за 11 историй (в пунктах, после всех 4 слоёв издержек и SwapRate)</h4>
          <table class="t" id="tab8sum"></table>
        </div>
        <div class="viz" style="margin-top:14px">
          <h4>Разрез по отдельным историям выбранного сценария</h4>
          <div class="btns" id="b8" style="margin:0 0 10px"></div>
          <table class="t" id="tab8det"></table>
        </div>
        <h3 style="margin:24px 0 12px">Шесть проверок перед запуском любой спред-стратегии на MOEX FORTS</h3>
        <div class="cards">
          <div class="card"><h4>1. Сверить W ÷ R и лотность</h4><p>Переведите шаг цены и мультипликатор обеих ног в рубли: связки вроде MIX / MMI или акционных фьючерсов разного лота нельзя брать 1 : 1 без пересчёта.</p></div>
          <div class="card"><h4>2. Считать только по клирингу SP</h4><p>Выбросьте из бэктеста одиночные сделки 23:49 на тонком вечернем стакане — вариационная маржа живёт по расчётным ценам SP.</p></div>
          <div class="card"><h4>3. Учесть SwapRate и выходные</h4><p>В парах с USDRUBF, CNYRUBF и IMOEXF заложите ежедневное списание финансирования и тройной шаг переноса через выходные и праздники.</p></div>
          <div class="card"><h4>4. Вычесть календарь дивидендов</h4><p>Ступенька в квартальном фьючерсе перед отсечкой — это плановый дивиденд, а не «дешёвая раздача». Без дивидендного календаря сигнал продаёт дно.</p></div>
          <div class="card"><h4>5. Нативный стакан + стресс-тариф</h4><p>Собирайте календарные спреды через биржевой стакан спреда, но в риск-модель закладывайте расширенные стрессовые издержки, когда имплицированная ликвидность исчезает.</p></div>
          <div class="card"><h4>6. Лимит позиции — от стрессового ГО</h4><p>Никогда не загружайте счёт под спокойное льготное ГО со скидкой 70%: держите резерв на одновременный рост базового ГО и сжатие скидки за спред.</p></div>
        </div>`;

      el.querySelector('#tab8sum').innerHTML =
        '<tr><th>Сценарий на срочном рынке MOEX</th>' + MODES.map((m) => '<th>' + m.name + '</th>').join('') + '</tr>' +
        summary.map((row) =>
          '<tr><td><b>' + row.sc.name + '</b><br><span style="color:#98a3b6;font-size:13px">' + row.sc.note + '</span></td>' +
          MODES.map((m) => {
            const st = row.byMode[m.id];
            const mcNote = st.mc > 0 ? ' <span class="pill stop" style="font-size:12px">MC: ' + st.mc + '</span>' : '';
            return '<td><b>' + col(st.tot, 0) + ' п.</b>' + mcNote + '<br><span style="color:#98a3b6;font-size:13px">' + st.trades + ' сд. · ср. DD −' + f(st.ddSum / SEEDS8.length, 1) + '</span></td>';
          }).join('') + '</tr>'
        ).join('');

      const bEl = el.querySelector('#b8');
      bEl.innerHTML = E.MOEX_SCENARIOS.map((sc, i) => '<button class="b" data-i="' + i + '">' + sc.name + '</button>').join('');
      bEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s8.scen = +b.dataset.i; drawDet8(); } });

      function drawDet8() {
        bEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s8.scen));
        const row = summary[s8.scen];
        el.querySelector('#tab8det').innerHTML =
          '<tr><th>Режим расчёта и исполнения</th>' + SEEDS8.map((sd) => '<th>#' + sd + '</th>').join('') + '<th>Сумма 11 ист.</th></tr>' +
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
