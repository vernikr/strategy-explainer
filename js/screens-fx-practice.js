/* Межбиржевой и валютный спред, экраны 5–8: инфраструктурные барьеры и разделённое ГО на двух биржах,
   правила и паспорт 3-ногой сделки, разбор одного дня под лупой и сводный эксперимент (#42). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, S = window.SPECS, HV = window.HV;
  const C = U.COLORS;
  const Z = (window.FXSCREENS = window.FXSCREENS || []);
  const SC = E.FX_SCENARIOS;
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', PRE = '#5aa9ff', GOLD = '#ffd166', GREY = '#8b95a7';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 1 : d) + '</span>';

  /* ---------- 5. Барьеры, тройные издержки и разделённое ГО на двух биржах ---------- */
  const s5 = { cashPct: 18, movePct: 20 };

  Z.push({
    id: 'barriers-margin',
    title: 'Барьеры, комиссии трёх ног и разделённое ГО на двух биржах',
    lead: 'Математика паритета безупречна в учебнике, но на живых деньгах у межбиржевой связки появляются три приземлённых врага: тройной стакан, залоги в разных странах и физический разрыв рынков.',
    text: () => `
      <h3>1. Три стакана вместо двух и риск недособранной ноги</h3>
      <p>В обычной паре нужно одновременно исполнить две заявки на одной бирже; в межбиржевом спреде — сразу <b>три заявки на двух разных площадках</b>. Это увеличивает комиссии и ${T('slippage', 'проскальзывание')} примерно в 1,3–1,5 раза, а если две ноги исполнились, а третья застряла в тонком стакане — вы остаётесь с незакрытым рыночным или валютным риском (${T('legging', 'риск одной ноги')}).</p>
      <h3>2. ${T('split_margin', 'Разделённое ГО на двух биржах')} — маржин-колл при нулевом убытке</h3>
      <p>Когда две ноги открыты у одного брокера на одной бирже, прибыль одной ноги автоматически подкармливает убыток второй. Но при торговле между разными биржами и странами <b>брокеры не видят счета друг друга</b>:</p>
      <ul>
        <li>Пусть спред стоит на месте (+0 п. общего результата), но базовый актив вырос в мире на <b>+20%</b>.</li>
        <li>На первой площадке (где актив куплен) у вас копится большая бумажная прибыль; на второй (где актив продан) списывается ровно такая же отрицательная ${T('var_margin', 'вариационная маржа')}.</li>
        <li>Перебросить валюту через границу за пять минут нельзя. Если на втором счёте нет щедрого кэш-буфера, брокер принудительно закроет ногу по ${T('margin_call', 'маржин-коллу')} — и идеальный хедж в ту же секунду превратится в голую ставку в одну сторону!</li>
      </ul>
      <h3>3. ${T('capital_barrier', 'Инфраструктурные и санкционные барьеры')}</h3>
      <p>Возврат к паритету держится только на реальных арбитражёрах, которые могут купить актив там, где дешевле, перевезти слиток, нефть или деньги через границу и продать там, где дороже. Как только вводятся ограничения на движение капитала, пошлины или запрет поставок (нижний график со 145-го дня), внутренний рынок запирается в собственном котле — и дисконт в 30–40 пунктов может держаться годами.</p>`,
    mount(el) {
      const fxBar = E.genFxScenario(7, SC[3]);
      el.innerHTML = `
        <div class="viz">
          <h4>Симулятор разделённого счёта: выживет ли связка при рывке актива?</h4>
          <p class="cap">Номинал каждой ноги = 10 000 $ (900 000 ₽ по курсу 90 ₽/$), базовое ГО на каждой площадке = 12% номинала. Спред при этом не изменился ни на копейку!</p>
          <div id="sl5a"></div>
          <div id="sl5b"></div>
          <table class="t" id="tab5" style="margin-top:10px"></table>
          <div id="note5" class="note" style="margin-top:10px"></div>
        </div>
        <div class="viz">
          <h4>Слом паритета при введении барьера на 145-м дне</h4>
          <p class="cap">Жёлтая полоса — момент введения ограничений на переток капитала и товара: внутренний рынок уходит в устойчивый дисконт, не возвращаясь к старому нулю.</p>
          <div class="legend">
            <span><i style="background:${PRE}"></i>внутренняя цена (п.)</span>
            <span><i style="background:${SIM}"></i>мировой паритет (п.)</span>
            <span><i style="background:${BAD}"></i>спред Внутр − Паритет (нижняя панель)</span>
          </div>
          <div id="c5a"></div>
          <div id="c5b" style="margin-top:8px"></div>
        </div>`;

      HV.slider(el.querySelector('#sl5a'), {
        label: 'Внесено денег на КАЖДУЮ биржу (% от номинала 900 000 ₽)', min: 13, max: 45, step: 1, value: s5.cashPct,
        fmt: (v) => v + '% (' + Math.round(9000 * v).toLocaleString('ru-RU') + ' ₽ на площадку)',
        hint: 'Из них 12% заблокировано под начальное ГО, остальное — свободный запас под вариационную маржу.',
        onInput: (v) => { s5.cashPct = v; draw5(); }
      });
      HV.slider(el.querySelector('#sl5b'), {
        label: 'Движение базового актива против проданной ноги', min: 0, max: 35, step: 1, value: s5.movePct,
        fmt: (v) => '+' + v + '% за неделю (спред = const)',
        onInput: (v) => { s5.movePct = v; draw5(); }
      });

      const c5a = A.mkChart(el.querySelector('#c5a'), 155, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>внутренняя: <b>' + f(fxBar.pDom[i]) + ' п.</b><br>паритет: <b>' + f(fxBar.parity[i]) + ' п.</b>'
      });
      const c5b = A.mkChart(el.querySelector('#c5b'), 140, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>спред к паритету: <b style="color:' + BAD + '">' + U.sgn(fxBar.syncSpread[i]) + ' п.</b>'
      });
      c5a.render({
        n: fxBar.pDom.length,
        spans: [{ i0: 144, i1: 319, color: '#ff6b6b14' }],
        series: [
          { data: fxBar.parity, color: SIM, width: 1.6, dash: [5, 4] },
          { data: fxBar.pDom, color: PRE, width: 1.8 }
        ]
      });
      c5b.render({
        n: fxBar.pDom.length,
        hlines: [{ y: 0, color: '#ffffff33', dash: [3, 3] }],
        spans: [{ i0: 144, i1: 319, color: '#ff6b6b18' }],
        series: [{ data: fxBar.syncSpread, color: BAD, width: 1.9 }]
      });

      function draw5() {
        const nom = 900000;
        const initMargin = Math.round(nom * 0.12);
        const dep = Math.round((nom * s5.cashPct) / 100);
        const vm = Math.round((nom * s5.movePct) / 100);
        const eqWin = dep + vm, eqLose = dep - vm;
        const freeWin = eqWin - initMargin, freeLose = eqLose - initMargin;
        const mc = freeLose < 0;

        const rub = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toLocaleString('ru-RU') + ' ₽';
        el.querySelector('#tab5').innerHTML =
          '<tr><th>Площадка</th><th>Внесено</th><th>Вариац. маржа</th><th>Остаток счёта</th><th>Свободно сверх ГО (108 000 ₽)</th></tr>' +
          '<tr><td>Биржа А (купленная нога)</td><td>' + dep.toLocaleString('ru-RU') + ' ₽</td><td class="pos">' + rub(vm) + '</td><td>' + eqWin.toLocaleString('ru-RU') + ' ₽</td><td class="pos">' + rub(freeWin) + '</td></tr>' +
          '<tr><td>Биржа Б (проданная нога)</td><td>' + dep.toLocaleString('ru-RU') + ' ₽</td><td class="neg">' + rub(-vm) + '</td><td>' + eqLose.toLocaleString('ru-RU') + ' ₽</td><td class="' + (mc ? 'neg' : 'pos') + '"><b>' + rub(freeLose) + (mc ? ' (МАРЖИН-КОЛЛ!)' : '') + '</b></td></tr>' +
          '<tr><td><b>Сумма двух счетов</b></td><td><b>' + (dep * 2).toLocaleString('ru-RU') + ' ₽</b></td><td><b>0 ₽</b></td><td><b>' + (dep * 2).toLocaleString('ru-RU') + ' ₽</b></td><td>суммарно деньги целы, но они на разных биржах!</td></tr>';

        const nEl = el.querySelector('#note5');
        if (mc) {
          nEl.className = 'note bad';
          nEl.innerHTML = '<b>Принудительное закрытие на Бирже Б!</b> Общий результат двух ног равен <b>0 ₽</b>, но на Бирже Б не хватило <b>' + Math.abs(freeLose).toLocaleString('ru-RU') + ' ₽</b> до минимального ГО. Чтобы пережить движение актива на +' + s5.movePct + '% без срочного трансграничного перевода, на каждой площадке нужно держать не менее <b>' + (12 + s5.movePct) + '% номинала</b>.';
        } else {
          nEl.className = 'note';
          nEl.innerHTML = '<b>Запаса хватает:</b> после списания вариационной маржи на Бирже Б остаётся ещё <b>' + freeLose.toLocaleString('ru-RU') + ' ₽</b> поверх ГО. Заметьте цену этой безопасности: в двух залогах заморожено сразу <b>' + (s5.cashPct * 2) + '% номинала</b>.';
        }
      }
      draw5();
    }
  });

  /* ---------- 6. Правила и сделки: 2 ноги, несинхронные закрытия и честные 3 ноги ---------- */
  const s6 = { scn: 1, mode: 2, mult: 1.35, sel: 0 };
  const MODES6 = [
    { key: 'noFx', name: '2 ноги без FX-хеджа', color: BAD, opts: { fxMode: 'noFx' } },
    { key: 'stale', name: 'Несинхр. закрытия дня', color: SIM, opts: { fxMode: 'stale' } },
    { key: 'hedged', name: 'Честные 3 ноги (синхр. + FX)', color: ME, opts: { fxMode: 'hedged' } }
  ];

  Z.push({
    id: 'trades',
    title: 'Правила и сделки: две ноги против честных трёх ног',
    lead: 'Сравним на живом графике три подхода: экономию на валютном фьючерсе (2 ноги), сигнал по несинхронным дневным закрытиям и полную трёхногую конструкцию по синхронному срезу.',
    text: () => `
      <h3>Три режима торговли</h3>
      <ol>
        <li><b style="color:${BAD}">2 ноги без FX-хеджа.</b> Сигнал считается грамотно по паритету, но в стакане открываются только внутренний и внешний товарные контракты (экономия трети комиссии). В штиль это чуть выгоднее, но на валютной волне («Валютное ралли») счёт получает глубокую просадку прямо посреди правильных сделок!</li>
        <li><b style="color:${SIM}">Несинхронные закрытия дня.</b> Все три ноги открыты с FX-хеджем, но z-score смотрит на таблицу разновременных дневных закрытий. В сценарии «Разные часы закрытия» робот раз за разом клюёт на вечерние новости-миражи и теряет половину прибыли на пустых сделках.</li>
        <li><b style="color:${ME}">Честные 3 ноги (синхронный срез + FX).</b> Сигнал берётся строго в общие часы работы всех трёх стаканов, а валютный фьючерс закрывает курсовой риск на полный номинал входа.</li>
      </ol>
      <h3>Паспорт трёхногой сделки</h3>
      <p>Нажмите на любую строку в журнале сделок внизу справа: таблица покажет результат <b>каждой из трёх ног по отдельности</b> — сколько принесла внутренняя рублёвая нога, сколько внешняя долларовая в пересчёте по курсу выхода и сколько добавил (или спас!) валютный фьючерс.</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Сценарий, режим исполнения и множитель издержек 3 ног</h4>
          <div class="btns" id="tabs" style="margin:0 0 8px"></div>
          <p id="snote" style="margin:0 0 10px;color:var(--muted)"></p>
          <div class="btns" id="modes" style="margin:0 0 10px"></div>
          <div id="mctl"></div>
          <div id="ctl"></div>
        </div>
        <div class="viz">
          <h4 id="c1t">Рабочий ряд сигнала, среднее и сделки</h4>
          <div class="legend">
            <span><i class="dot" style="background:${C.up}"></i>▲ вход лонг спреда</span>
            <span><i class="dot" style="background:${C.down}"></i>▼ вход шорт спреда</span>
            <span><i class="dot" style="background:${C.exit}"></i>✕ выход</span>
          </div>
          <div id="c1"></div>
        </div>
        <div class="viz">
          <h4>Z-score выбранного режима и курс валюты (нижняя подсказка при наведении)</h4>
          <div id="c2"></div>
        </div>
        <div class="viz">
          <h4>Сравнение кривых капитала трёх режимов</h4>
          <div class="legend">
            <span><i style="background:${BAD}"></i>2 ноги без FX</span>
            <span><i style="background:${SIM}"></i>несинхр. закрытия</span>
            <span><i style="background:${ME}"></i>честные 3 ноги</span>
          </div>
          <div id="c3"></div>
          <table class="t" id="tab" style="margin-top:10px"></table>
        </div>
        <div class="viz">
          <h4>Журнал сделок (нажмите строку, чтобы разложить сделку на 3 ноги)</h4>
          <div class="scroll" style="max-height:220px"><table class="t" id="tlist"></table></div>
          <div id="tbox" style="margin-top:12px"></div>
        </div>`;

      const tabs = el.querySelector('#tabs'), modesEl = el.querySelector('#modes');
      tabs.innerHTML = SC.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      modesEl.innerHTML = MODES6.map((m, i) => '<button class="b" data-i="' + i + '">Показать: ' + m.name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.scn = +b.dataset.i; s6.sel = 0; draw(); } });
      modesEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.mode = +b.dataset.i; s6.sel = 0; draw(); } });

      HV.slider(el.querySelector('#mctl'), {
        label: 'Множитель издержек трёх ног к двум', min: 1.0, max: 2.0, step: 0.05, value: s6.mult,
        fmt: (v) => f(v, 2) + '× (круг 3 ног = ' + f(A.state.params.cost * v, 2) + ' п.)',
        hint: 'Третья валютная нога добавляет комиссию и спред ещё одного стакана.',
        onInput: (v) => { s6.mult = v; draw(); }
      });
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost], draw);

      let fxD, runs = [];
      const c1 = A.mkChart(el.querySelector('#c1'), 195, {
        tip: (i) => {
          const r = runs[s6.mode];
          return '<b>День ' + (i + 1) + '</b> · курс ' + f(fxD.fx[i]) + ' ₽/$' +
            '<br>рабочий спред: <b>' + U.sgn(r.sigSeries[i]) + ' п.</b>' +
            (s6.mode === 1 ? '<br>истинный синхронный: ' + U.sgn(fxD.syncSpread[i]) + ' п.' : '') +
            (r.mean[i] !== null ? '<br>среднее окна: ' + f(r.mean[i]) + ' п.' : '');
        }
      });
      const c2 = A.mkChart(el.querySelector('#c2'), 155, {
        tip: (i) => {
          const r = runs[s6.mode];
          return r.z[i] === null ? null : '<b>День ' + (i + 1) + '</b> · курс ' + f(fxD.fx[i]) + ' ₽/$<br>z-score: <b>' + f(r.z[i]) + '</b>';
        }
      });
      const c3 = A.mkChart(el.querySelector('#c3'), 190, {
        tip: (i) => '<b>День ' + (i + 1) + '</b> (курс ' + f(fxD.fx[i]) + ' ₽/$)<br>' +
          MODES6.map((m, k) => '<span style="color:' + m.color + '">' + m.name + ': <b>' + U.sgn(runs[k].equity[i], 1) + '</b></span>').join('<br>')
      });

      function drawDetail(r) {
        const box = el.querySelector('#tbox');
        if (!r.trades.length) { box.innerHTML = '<div class="note">В этом режиме при текущих порогах сделок не было.</div>'; return; }
        if (s6.sel >= r.trades.length) s6.sel = 0;
        const tr = r.trades[s6.sel];
        const dirTxt = tr.dir === 1 ? 'лонг спреда (купили внутр. ₽, продали мир $ и FX)' : 'шорт спреда (продали внутр. ₽, купили мир $ и FX)';
        const spreadMove = tr.dir * (tr.exitS - tr.entryS);
        box.innerHTML =
          '<div class="note"><b>Паспорт сделки #' + (s6.sel + 1) + ':</b> ' + dirTxt + ', дни <b>' + (tr.entryIdx + 1) + '–' + (tr.exitIdx + 1) + '</b> (' + tr.bars + ' дн.), выход: <b>' + (A.REASON[tr.reason] || tr.reason) + '</b>.<br>' +
          'Синхронный спред: <b>' + U.sgn(tr.entryS) + ' → ' + U.sgn(tr.exitS) + ' п.</b> (чистое движение спреда в нашу сторону = ' + col(spreadMove, 2) + ' п.); курс за время сделки: <b>' + f(tr.fxIn) + ' → ' + f(tr.fxOut) + ' ₽/$</b>.</div>' +
          '<table class="t" style="margin-top:8px">' +
          '<tr><th>Нога</th><th>Вход → Выход</th><th>Вклад в рублёвых пунктах</th></tr>' +
          '<tr><td>1. Внутренний фьючерс (₽)</td><td>' + f(tr.domIn) + ' → ' + f(tr.domOut) + ' п.</td><td>' + col(tr.pnlDom, 2) + ' п.</td></tr>' +
          '<tr><td>2. Внешний фьючерс ($ → ₽ по ' + f(tr.fxOut) + ' ₽/$)</td><td>' + f(tr.worldIn) + ' → ' + f(tr.worldOut) + ' $ (' + U.sgn(tr.pnlWorldUsd, 2) + ' $)</td><td>' + col(tr.pnlWorldRub, 2) + ' п.</td></tr>' +
          '<tr><td>3. Валютный фьючерс FX ' + (s6.mode === 0 ? '<span style="color:' + BAD + '">(отключён!)</span>' : '(номинал ' + f(tr.worldIn) + ' $)') + '</td><td>' + f(tr.fxIn) + ' → ' + f(tr.fxOut) + ' ₽/$</td><td>' + (s6.mode === 0 ? '<span style="color:var(--muted)">0,00 п. (не хеджировали)</span>' : col(tr.pnlFxRub, 2) + ' п.') + '</td></tr>' +
          '<tr><td colspan="2"><b>Грязный итог всех открытых ног</b></td><td><b>' + col(tr.gross, 2) + ' п.</b></td></tr>' +
          '<tr><td colspan="2">Издержки круга</td><td>−' + f(tr.cost, 2) + ' п.</td></tr>' +
          '<tr><td colspan="2"><b>Чистый итог сделки на счёте</b></td><td><b>' + col(tr.net, 2) + ' п.</b></td></tr></table>';
      }

      function draw() {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s6.scn));
        modesEl.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s6.mode));
        el.querySelector('#snote').textContent = SC[s6.scn].note;

        fxD = E.genFxScenario(A.state.seed, SC[s6.scn]);
        const base = A.btParams(), n = fxD.pDom.length;
        runs = MODES6.map((m) => E.backtestFx(fxD, Object.assign({}, base, m.opts, { fxCostMult: s6.mult })));

        const cur = runs[s6.mode], mInfo = MODES6[s6.mode];
        el.querySelector('#c1t').textContent = 'Рабочий ряд сигнала, среднее и сделки — «' + mInfo.name + '»';

        c1.render({
          n,
          series: [
            { data: cur.mean, color: C.mean, width: 1.4 },
            { data: cur.sigSeries, color: mInfo.color, width: 1.8 }
          ],
          spans: A.positionSpans(cur),
          markers: A.tradeMarkers(cur, (i) => cur.sigSeries[i])
        });

        const p = A.state.params, lim = Math.max(5.5, p.stopZ + 0.5);
        c2.render({
          n,
          series: [{ data: cur.z, color: C.z }],
          hlines: A.zLines(p),
          spans: A.positionSpans(cur),
          markers: A.tradeMarkers(cur, (i) => cur.z[i]),
          yMin: -lim, yMax: lim
        });

        c3.render({
          n,
          series: MODES6.map((m, k) => ({ data: runs[k].equity, color: m.color, width: k === s6.mode ? 2.6 : 1.7, dash: k === 0 ? [5, 4] : [] })),
          hlines: [{ y: 0, color: '#ffffff44', dash: [] }]
        });

        el.querySelector('#tab').innerHTML =
          '<tr><th>Режим</th><th>Сделок</th><th>Доля плюсовых</th><th>Итог, п.</th><th>Макс. просадка</th></tr>' +
          MODES6.map((m, k) => {
            const r = runs[k].metrics, bold = k === s6.mode;
            return '<tr><td style="color:' + m.color + '">' + (bold ? '<b>' + m.name + '</b>' : m.name) + '</td><td>' + r.count + '</td><td>' + (r.winRate === null ? '—' : Math.round(r.winRate * 100) + '%') + '</td><td>' + col(r.total) + '</td><td>' + f(-r.maxDD, 1) + '</td></tr>';
          }).join('');

        const tl = el.querySelector('#tlist');
        tl.innerHTML = '<tr><th>#</th><th>Дни</th><th>Напр.</th><th>Курс вх → вых</th><th>Спред вх → вых</th><th>Причина</th><th>Чистый итог</th></tr>' +
          (cur.trades.map((tr, i) => '<tr class="click' + (i === s6.sel ? ' sel' : '') + '" data-i="' + i + '">' +
            '<td>' + (i + 1) + '</td><td>' + (tr.entryIdx + 1) + '–' + (tr.exitIdx + 1) + '</td>' +
            '<td>' + (tr.dir === 1 ? '<span class="pos">лонг</span>' : '<span class="neg">шорт</span>') + '</td>' +
            '<td>' + f(tr.fxIn, 1) + ' → ' + f(tr.fxOut, 1) + '</td>' +
            '<td>' + U.sgn(tr.entryS, 1) + ' → ' + U.sgn(tr.exitS, 1) + '</td>' +
            '<td>' + (A.REASON[tr.reason] || tr.reason) + '</td>' +
            '<td>' + col(tr.net, 2) + '</td></tr>').join('') || '<tr><td colspan="7" style="color:var(--muted)">Нет сделок</td></tr>');

        tl.querySelectorAll('tr.click').forEach((trEl) => trEl.addEventListener('click', () => {
          s6.sel = +trEl.dataset.i;
          tl.querySelectorAll('tr.click').forEach((x, k) => x.classList.toggle('sel', k === s6.sel));
          drawDetail(cur);
        }));
        drawDetail(cur);
      }
      draw();
    }
  });

  /* ---------- 7. Пошаговый разбор одного дня ---------- */
  const s7 = { scn: 2, mode: 2, day: null };

  Z.push({
    id: 'day',
    title: 'Пошаговый разбор одного дня',
    lead: 'Выберите любой торговый день (особенно дни с вечерним скачком в сценарии «Разные часы закрытия») и проверьте каждую цифру: от котировок трёх стаканов до паритета, окна N, z-score и решения робота.',
    full: true,
    mount(el) {
      el.innerHTML = `
        <div style="display:grid;grid-template-columns:560px 1fr;gap:28px;align-items:start">
          <div>
            <div class="viz">
              <h4>Сценарий и режим расчёта</h4>
              <div class="btns" id="tabs" style="margin:0 0 8px"></div>
              <p id="snote" style="margin:0 0 10px;color:var(--muted)"></p>
              <div class="btns" id="modes" style="margin:0"></div>
            </div>
            <div class="viz">
              <h4>Выбор дня: <span id="dayv"></span></h4>
              <input type="range" id="day" style="margin-top:8px">
              <div class="btns">
                <button class="b" id="bp">◀ День назад</button>
                <button class="b" id="bn">День вперёд ▶</button>
                <button class="b" id="bst">К вечернему скачку ◆</button>
                <button class="b" id="bs">К следующей сделке</button>
                <button class="b" id="play">▶ Автопроигрывание</button>
              </div>
              <div id="c1" style="margin-top:10px"></div>
              <div id="c2" style="margin-top:10px"></div>
            </div>
            <div id="ctl"></div>
          </div>
          <div>
            <div class="viz"><div class="calc-steps" id="steps"></div></div>
            <details style="margin-top:14px"><summary>Показать все N дней расчётного окна</summary>
              <div class="scroll" style="margin-top:8px"><table class="t" id="wtab"></table></div>
            </details>
          </div>
        </div>`;

      const tabs = el.querySelector('#tabs'), modesEl = el.querySelector('#modes'), slider = el.querySelector('#day');
      tabs.innerHTML = SC.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      modesEl.innerHTML = MODES6.map((m, i) => '<button class="b" data-i="' + i + '">' + m.name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s7.scn = +b.dataset.i; draw(); } });
      modesEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s7.mode = +b.dataset.i; draw(); } });

      let fxD, bt;
      const c1 = A.mkChart(el.querySelector('#c1'), 175, { onClick: (i) => setDay(i), tip: (i) => 'День ' + (i + 1) + ': спред ' + U.sgn(bt.sigSeries[i]) + ' п.' });
      const c2 = A.mkChart(el.querySelector('#c2'), 145, { onClick: (i) => setDay(i), tip: (i) => (bt.z[i] === null ? null : 'День ' + (i + 1) + ': z = ' + f(bt.z[i])) });
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn], draw);

      function setDay(i) {
        const min = A.state.params.n - 1;
        s7.day = Math.max(min, Math.min(fxD.pDom.length - 1, i));
        draw();
      }
      slider.addEventListener('input', () => setDay(+slider.value));
      el.querySelector('#bp').addEventListener('click', () => setDay(s7.day - 1));
      el.querySelector('#bn').addEventListener('click', () => setDay(s7.day + 1));
      el.querySelector('#bst').addEventListener('click', () => {
        for (let i = s7.day + 1; i < fxD.pDom.length; i++) if (fxD.isStale[i]) return setDay(i);
        for (let i = A.state.params.n - 1; i <= s7.day; i++) if (fxD.isStale[i]) return setDay(i);
      });
      el.querySelector('#bs').addEventListener('click', () => {
        for (let i = s7.day + 1; i < fxD.pDom.length; i++) if (bt.signal[i]) return setDay(i);
        for (let i = A.state.params.n - 1; i <= s7.day; i++) if (bt.signal[i]) return setDay(i);
      });
      el.querySelector('#play').addEventListener('click', (ev) => {
        if (window.__stepTimer) { clearInterval(window.__stepTimer); window.__stepTimer = null; ev.target.textContent = '▶ Автопроигрывание'; return; }
        ev.target.textContent = '❚❚ Пауза';
        window.__stepTimer = setInterval(() => {
          if (s7.day >= fxD.pDom.length - 1) { clearInterval(window.__stepTimer); window.__stepTimer = null; ev.target.textContent = '▶ Автопроигрывание'; return; }
          s7.day++; draw();
        }, 350);
      });

      function draw() {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s7.scn));
        modesEl.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s7.mode));
        el.querySelector('#snote').textContent = SC[s7.scn].note;

        const p = A.state.params, mInfo = MODES6[s7.mode];
        fxD = E.genFxScenario(A.state.seed, SC[s7.scn]);
        bt = E.backtestFx(fxD, Object.assign(A.btParams(), mInfo.opts));

        slider.min = p.n - 1; slider.max = fxD.pDom.length - 1;
        if (s7.day === null || s7.day < p.n - 1 || s7.day >= fxD.pDom.length) {
          s7.day = p.n + 18;
        }
        slider.value = s7.day;
        const t = s7.day;
        const ex = E.explainFx(fxD, p.n, t, mInfo.opts);
        el.querySelector('#dayv').textContent = 'день ' + (t + 1) + ' из ' + fxD.pDom.length + ' · курс ' + f(ex.fx) + ' ₽/$';

        const w0 = t - p.n + 1;
        c1.render({
          n: fxD.pDom.length,
          series: [{ data: bt.mean, color: C.mean, width: 1.3 }, { data: bt.sigSeries, color: mInfo.color }],
          spans: [{ i0: w0, i1: t, color: '#5aa9ff22' }],
          markers: A.tradeMarkers(bt, (i) => bt.sigSeries[i]), cursor: t
        });
        const lim = Math.max(5.5, p.stopZ + 0.5);
        c2.render({
          n: fxD.pDom.length,
          series: [{ data: bt.z, color: C.z }],
          hlines: A.zLines(p), spans: [{ i0: w0, i1: t, color: '#5aa9ff22' }],
          cursor: t, yMin: -lim, yMax: lim
        });

        const staleWarn = ex.isStale
          ? '<br><span style="color:' + BAD + '"><b>Внимание: несинхронный вечер!</b> Фиксинг внешней биржи уснул на ' + f(ex.worldObs) + ' $, а синхронная цена была ' + f(ex.world) + ' $. В таблице закрытий виден мираж ' + U.sgn(ex.obsSpread) + ' п. вместо реальных ' + U.sgn(ex.syncSpread) + ' п.</span>'
          : '';
        const usedWorld = mInfo.opts.fxMode === 'stale' ? ex.worldObs : ex.world;
        const usedPar = E.round2((usedWorld * ex.fx) / 100);
        const dec = A.decisionText(t, bt, p);

        el.querySelector('#steps').innerHTML = `
          <div class="row"><div class="n">1</div><div><b>Три котировки дня ${t + 1}</b> (${mInfo.opts.fxMode === 'stale' ? 'таблица закрытий дня' : 'синхронный срез общих часов'})<div class="v">Внутренняя = ${f(ex.dom)} п. · Внешняя = ${f(usedWorld)} $ · Курс FX = ${f(ex.fx)} ₽/$${staleWarn}</div></div></div>
          <div class="row"><div class="n">2</div><div><b>Валютный паритет и рабочий спред</b><div class="v">Паритет = ${f(usedWorld)} × ${f(ex.fx)} ÷ 100 = <b>${f(usedPar)} п.</b> → Спред = ${f(ex.dom)} − ${f(usedPar)} = <b>${U.sgn(ex.value)} п.</b></div></div></div>
          <div class="row"><div class="n">3</div><div><b>Среднее за окно N = ${p.n} дней</b> (дни ${w0 + 1}–${t + 1})<div class="v">Сумма ${p.n} значений = ${f(ex.sum)} → Среднее μ = ${f(ex.sum)} ÷ ${p.n} = <b>${f(ex.mean)} п.</b></div></div></div>
          <div class="row"><div class="n">4</div><div><b>Стандартное отклонение σ и z-score</b><div class="v">σ = √(${f(ex.sumSq)} ÷ ${p.n}) = <b>${f(ex.std)} п.</b> → z = (${f(ex.value)} − ${f(ex.mean)}) ÷ ${f(ex.std)} = <b>${U.sgn(ex.z)}</b></div></div></div>
          <div class="row"><div class="n">5</div><div><b>Решение и набор заявок</b> (${mInfo.opts.fxMode === 'noFx' ? '2 стакана без FX' : '3 стакана с FX-фьючерсом'})<div class="v">${dec.html}</div></div></div>`;

        el.querySelector('#wtab').innerHTML =
          '<tr><th>День</th><th>Внутр., п.</th><th>Мир, $</th><th>Курс, ₽/$</th><th>Спред окна</th><th>Откл. от μ</th><th>Квадрат откл.</th></tr>' +
          ex.rows.map((rw) => {
            const idx = rw.idx;
            return '<tr' + (idx === t ? ' class="sel"' : '') + '><td>' + (idx + 1) + '</td><td>' + f(fxD.pDom[idx]) + '</td><td>' + f(mInfo.opts.fxMode === 'stale' ? fxD.pWorldObs[idx] : fxD.pWorld[idx]) + '</td><td>' + f(fxD.fx[idx]) + '</td><td>' + U.sgn(rw.value) + '</td><td>' + U.sgn(rw.dev) + '</td><td>' + f(rw.sq) + '</td></tr>';
          }).join('');
      }
      draw();
    }
  });

  /* ---------- 8. Честный эксперимент на 4 сценариях и памятка ---------- */
  const s8 = { scn: 1, mult: 1.35 };

  Z.push({
    id: 'verdict',
    title: 'Честный эксперимент: 4 режима рынка × 11 серий данных',
    lead: 'Проверим все три подхода на 44 независимых годовых историях при одних и тех же порогах входа и выхода — без подгонки задним числом.',
    full: true,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Общие настройки для всех 132 прогонов (4 сценария × 11 серий × 3 режима)</h4>
          <div id="mctl8"></div>
          <div id="ctl8"></div>
          <table class="t" id="sum8" style="margin-top:12px"></table>
        </div>
        <div class="viz">
          <h4>Разбивка по каждой из 11 серий в выбранном сценарии</h4>
          <div class="btns" id="tabs8" style="margin:0 0 8px"></div>
          <p id="note8" style="margin:0 0 10px;color:var(--muted)"></p>
          <table class="t" id="seeds8"></table>
        </div>
        <div class="cards" style="margin-top:18px">
          <div class="card">
            <h4>Когда межбиржевой спред работает</h4>
            <p>Между площадками открыты арбитражные мосты, все три стакана достаточно ликвидны, котировки снимаются строго синхронно в общие часы, а валютный фьючерс хеджирует весь долларовый номинал сделки.</p>
          </div>
          <div class="card">
            <h4>Почему в штиль 2 ноги кажутся лучше</h4>
            <p>В первом сценарии («Спокойный курс») отказ от третьей ноги экономит около трети комиссии. Но как только начинается валютная волна, просадка двух ног вырастает более чем втрое и съедает месяцы спокойной работы.</p>
          </div>
          <div class="card risk">
            <h4>Чего не спасёт даже идеальный FX-хедж</h4>
            <p>Четвёртый сценарий честно показывает предел математики: при заморозке мостов, пошлинах или запрете переводов (барьер со 145-го дня) спред перестаёт возвращаться к старому паритету у всех трёх режимов сразу.</p>
          </div>
          <div class="card">
            <h4>Короткий чек-лист перед запуском</h4>
            <p>1) Перевести валюту и вес к общему знаменателю. 2) Брать только синхронный срез. 3) Хеджировать курс на весь номинал входа. 4) Держать двойной запас кэша сверх ГО на каждой бирже отдельно.</p>
          </div>
        </div>`;

      const tabs = el.querySelector('#tabs8');
      tabs.innerHTML = SC.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s8.scn = +b.dataset.i; draw8(); } });

      HV.slider(el.querySelector('#mctl8'), {
        label: 'Множитель издержек 3 ног к 2 ногам', min: 1.0, max: 2.0, step: 0.05, value: s8.mult,
        fmt: (v) => f(v, 2) + '×',
        onInput: (v) => { s8.mult = v; draw8(); }
      });
      A.controls(el.querySelector('#ctl8'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost], draw8);

      function draw8() {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s8.scn));
        el.querySelector('#note8').textContent = SC[s8.scn].note;
        const base = A.btParams();

        const all = SC.map((sc) => {
          const bySeed = SEEDS.map((sd) => {
            const d = E.genFxScenario(sd, sc);
            return MODES6.map((m) => E.backtestFx(d, Object.assign({}, base, m.opts, { fxCostMult: s8.mult })).metrics);
          });
          const agg = MODES6.map((_, k) => {
            let tot = 0, posCnt = 0, worstDD = 0;
            bySeed.forEach((row) => {
              tot += row[k].total;
              if (row[k].total > 0) posCnt++;
              if (row[k].maxDD > worstDD) worstDD = row[k].maxDD;
            });
            return { tot, posCnt, worstDD };
          });
          return { sc, bySeed, agg };
        });

        el.querySelector('#sum8').innerHTML =
          '<tr><th>Сценарий (сумма 11 серий)</th><th style="color:' + BAD + '">2 ноги без FX (итог / худш. DD)</th><th style="color:' + SIM + '">Несинхр. закрытия (итог / худш. DD)</th><th style="color:' + ME + '">Честные 3 ноги (итог / плюс. / худш. DD)</th></tr>' +
          all.map((row, idx) => {
            const a = row.agg;
            return '<tr' + (idx === s8.scn ? ' class="sel"' : '') + '><td><b>' + row.sc.name + '</b></td>' +
              '<td>' + col(a[0].tot, 0) + ' п. <span style="color:var(--muted)">(DD −' + f(a[0].worstDD, 0) + ')</span></td>' +
              '<td>' + col(a[1].tot, 0) + ' п. <span style="color:var(--muted)">(DD −' + f(a[1].worstDD, 0) + ')</span></td>' +
              '<td><b>' + col(a[2].tot, 0) + ' п.</b> · ' + a[2].posCnt + '/11 в плюсе <span style="color:var(--muted)">(DD −' + f(a[2].worstDD, 0) + ')</span></td></tr>';
          }).join('');

        const cur = all[s8.scn];
        el.querySelector('#seeds8').innerHTML =
          '<tr><th>Серия (seed)</th><th style="color:' + BAD + '">2 ноги без FX (итог / просадка)</th><th style="color:' + SIM + '">Несинхр. закрытия</th><th style="color:' + ME + '">Честные 3 ноги (итог / сделок / просадка)</th></tr>' +
          SEEDS.map((sd, idx) => {
            const r = cur.bySeed[idx];
            return '<tr><td>Серия #' + (idx + 1) + ' (seed ' + sd + ')</td>' +
              '<td>' + col(r[0].total, 1) + ' <span style="color:var(--muted)">/ −' + f(r[0].maxDD, 1) + '</span></td>' +
              '<td>' + col(r[1].total, 1) + ' <span style="color:var(--muted)">/ −' + f(r[1].maxDD, 1) + '</span></td>' +
              '<td><b>' + col(r[2].total, 1) + '</b> <span style="color:var(--muted)">(' + r[2].count + ' сд., DD −' + f(r[2].maxDD, 1) + ')</span></td></tr>';
          }).join('');
      }
      draw8();
    }
  });
})();
