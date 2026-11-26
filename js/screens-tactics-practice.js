/* Приёмы и модификации, экраны 6–9: сделки «лесенкой», фильтр режима волатильности,
   пошаговый разбор дня с конструктором приёмов, сводный эксперимент на 4 сценариях (#36). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, S = window.SPECS, HV = window.HV;
  const C = U.COLORS;
  const Z = (window.TSCREENS = window.TSCREENS || []);
  const SC = E.TACTIC_SCENARIOS;
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', PRE = '#5aa9ff', GOLD = '#ffd166', GREY = '#8b95a7', VIO = '#c9b6ff';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 1 : d) + '</span>';

  function scaleSpans(bt) {
    const out = [];
    let cur = 0, i0 = 0;
    const colorOf = (p) => {
      if (p > 0.75) return '#35d07f30';
      if (p > 0.1) return '#35d07f16';
      if (p < -0.75) return '#ff6b6b30';
      if (p < -0.1) return '#ff6b6b16';
      return null;
    };
    for (let i = 0; i <= bt.pos.length; i++) {
      const v = i < bt.pos.length ? bt.pos[i] : 0;
      if (v !== cur) {
        const c = colorOf(cur);
        if (c && i - 1 > i0) out.push({ i0, i1: i - 1, color: c });
        cur = v; i0 = i;
      }
    }
    return out;
  }

  function tacticMarkers(bt, yOf) {
    const mk = [];
    bt.trades.forEach((tr) => {
      (tr.events || []).forEach((ev) => {
        if (ev.type === 'open') mk.push({ i: ev.t, y: yOf(ev.t), kind: tr.dir === 1 ? 'up' : 'down', color: tr.dir === 1 ? C.up : C.down });
        else if (ev.type === 'add') mk.push({ i: ev.t, y: yOf(ev.t), kind: 'dot', color: tr.dir === 1 ? C.up : C.down, size: 5 });
        else if (ev.type === 'partial') mk.push({ i: ev.t, y: yOf(ev.t), kind: 'ring', color: GOLD, size: 5 });
        else if (ev.type === 'close') mk.push({ i: ev.t, y: yOf(ev.t), kind: 'cross', color: ev.reason === 'stop' ? C.down : C.exit });
      });
    });
    return mk;
  }

  /* ---------- 6. Сделки «лесенкой»: полупозиция, добор и комиссии ---------- */
  const s6 = { scn: 3, entryZ1: 1.65, addZ: 0.85, partial: true, sel: 0 };

  Z.push({
    id: 'scale-trades',
    title: 'Сделки «лесенкой»: полупозиция, добор и комиссии',
    lead: 'Проверим набор позиции двумя равными частями на живом потоке цен: где половинчатый вход собирает умеренные волны, как выглядит добор на глубоких заходах и сколько съедают лишние заявки.',
    text: () => `
      <h3>Как читать график сделок «лесенкой»</h3>
      <ul>
        <li><b>Бледная заливка</b> — в работе только первый ${T('tranche', 'транш')} (половина объёма, 0,5).</li>
        <li><b>Яркая заливка и точка ●</b> — спред растянулся до второго порога, и мы добрали вторую половину (полный объём 1,0).</li>
        <li><b>Жёлтое колечко ○</b> — промежуточная фиксация прибыли: когда полная позиция начала возвращаться, первую половину закрываем пораньше, а остаток держим до основной цели.</li>
      </ul>
      <h3>Почему лесенка чувствительна к издержкам</h3>
      <p>Разбивая вход и выход на две части, вы отправляете в биржевой стакан <b>до четырёх заявок вместо двух</b>. В нашей модели каждая половинная операция несёт небольшую надбавку на спред стакана (суммарно до 1,2× от издержек одиночной сделки). Подвиньте ползунок «Издержки на сделку» к 2–3 пунктам — и вы увидите, как мелкие полусделки первыми уходят в минус.</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Сценарий и пороги двух траншей</h4>
          <div class="btns" id="tabs" style="margin:0 0 8px">
            <button class="b" data-s="3">Ступенчатые заходы (1,8σ и 2,8σ)</button>
            <button class="b" data-s="0">Спокойная резинка</button>
          </div>
          <div class="btns" id="pexit" style="margin:0 0 10px">
            <button class="b" data-p="1">Частичный выход включён</button>
            <button class="b" data-p="0">Обе части выходят вместе у цели</button>
          </div>
          <div id="sctl"></div>
          <div id="ctl"></div>
        </div>
        <div class="viz">
          <h4>Z-score и работа траншей (▲/▼ старт 0,5 · ● добор до 1,0 · ○ частичный выход · ✕ выход)</h4>
          <div id="c1"></div>
        </div>
        <div class="viz">
          <h4>Сравнение накопленного результата: один вход против лесенки 0,5 + 0,5</h4>
          <div class="legend">
            <span><i style="background:${SIM}"></i>один вход (сразу 1,0 на пороге входа)</span>
            <span><i style="background:${ME}"></i>лесенка (0,5 + 0,5)</span>
          </div>
          <div id="c2"></div>
          <table class="t" id="tab" style="margin-top:10px"></table>
        </div>
        <div class="viz">
          <h4>Журнал сделок лесенки (нажмите строку, чтобы увидеть историю траншей)</h4>
          <div class="scroll" style="max-height:200px"><table class="t" id="tlist"></table></div>
          <div class="note" id="tdet" style="margin-top:10px"></div>
        </div>`;

      const tabs = el.querySelector('#tabs'), pex = el.querySelector('#pexit');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.scn = +b.dataset.s; s6.sel = 0; draw(); } });
      pex.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.partial = b.dataset.p === '1'; draw(); } });

      const sctl = el.querySelector('#sctl');
      sctl.className = 'controls';
      HV.slider(sctl, { label: 'Первый транш (0,5 объёма)', min: 1.2, max: 2.2, step: 0.05, value: s6.entryZ1, fmt: (v) => f(v, 2) + ' σ', onInput: (v) => { s6.entryZ1 = v; draw(); } });
      HV.slider(sctl, { label: 'Добор второго транша (+Δσ дальше)', min: 0.4, max: 1.4, step: 0.05, value: s6.addZ, fmt: (v) => '+' + f(v, 2) + ' σ', onInput: (v) => { s6.addZ = v; draw(); } });
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost], draw);

      let d, rBase, rScale;
      const c1 = A.mkChart(el.querySelector('#c1'), 195, {
        tip: (i) => (rScale.z[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>z = <b>' + f(rScale.z[i]) + '</b><br>текущий объём: <b>' + f(rScale.pos[i], 1) + '</b>')
      });
      const c2 = A.mkChart(el.querySelector('#c2'), 175, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>один вход: ' + f(rBase.equity[i]) + '<br>лесенка: ' + f(rScale.equity[i])
      });

      function showDetail() {
        const det = el.querySelector('#tdet');
        if (!rScale.trades.length) { det.textContent = 'При текущих настройках сделок нет.'; return; }
        if (s6.sel >= rScale.trades.length) s6.sel = 0;
        const tr = rScale.trades[s6.sel];
        const names = { open: 'Вход 1-го транша (0,5)', add: 'Добор 2-го транша (+0,5)', partial: 'Частичный выход (−0,5)', close: 'Закрытие остатка' };
        det.innerHTML = '<b>Сделка #' + (s6.sel + 1) + ' (' + (tr.dir === 1 ? 'лонг' : 'шорт') + '):</b> ' +
          tr.events.map((e) => names[e.type] + ' в день <b>' + (e.t + 1) + '</b> (z = ' + f(e.z, 2) + ', спред = ' + f(e.s, 2) + ')').join(' → ') +
          '. Грязный итог: ' + col(tr.gross, 2) + ' п., комиссии: −' + f(tr.cost, 2) + ' п., чистый итог: <b>' + col(tr.net, 2) + ' п.</b>';
      }

      function draw() {
        tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.s === s6.scn));
        pex.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b.dataset.p === '1') === s6.partial));
        d = E.genTacticScenario(A.state.seed, SC[s6.scn]);
        const base = A.btParams(), n = d.spread.length;
        rBase = E.backtestTactics(d, base);
        rScale = E.backtestTactics(d, Object.assign({}, base, { scaleIn: true, entryZ1: s6.entryZ1, addZ: s6.addZ, partialExit: s6.partial }));

        const p = A.state.params, lim = Math.max(5, p.stopZ + 0.5);
        const sp = rScale.params;
        const hl = [
          { y: sp.e1, color: '#5aa9ff88', label: '1-й транш +' + f(sp.e1, 2) },
          { y: -sp.e1, color: '#5aa9ff88', label: '1-й транш −' + f(sp.e1, 2) },
          { y: sp.e2, color: '#c9b6ff99', label: '2-й транш +' + f(sp.e2, 2) },
          { y: -sp.e2, color: '#c9b6ff99', label: '2-й транш −' + f(sp.e2, 2) }
        ];
        if (p.stopOn) {
          hl.push({ y: p.stopZ, color: '#ff6b6b66', label: 'стоп +' + f(p.stopZ, 1) });
          hl.push({ y: -p.stopZ, color: '#ff6b6b66' });
        }
        c1.render({ n, series: [{ data: rScale.z, color: C.z }], hlines: hl, spans: scaleSpans(rScale), markers: tacticMarkers(rScale, (i) => rScale.z[i]), yMin: -lim, yMax: lim });
        c2.render({ n, series: [{ data: rBase.equity, color: SIM, width: 2 }, { data: rScale.equity, color: ME, width: 2.5 }], hlines: [{ y: 0, color: '#ffffff44', dash: [] }] });

        const twoCnt = rScale.trades.filter((x) => x.tranches > 1).length;
        el.querySelector('#tab').innerHTML =
          '<tr><th>Вариант</th><th>Сделок</th><th>Из них с добором 2-го транша</th><th>Итог, п.</th><th>Макс. просадка</th></tr>' +
          '<tr><td style="color:' + SIM + '"><b>Один вход (на ' + f(p.entryZ, 2) + 'σ)</b></td><td>' + rBase.metrics.count + '</td><td>—</td><td>' + col(rBase.metrics.total) + '</td><td>' + f(-rBase.metrics.maxDD, 1) + '</td></tr>' +
          '<tr><td style="color:' + ME + '"><b>Лесенка (' + f(sp.e1, 2) + 'σ + ' + f(sp.e2, 2) + 'σ)</b></td><td>' + rScale.metrics.count + '</td><td>' + twoCnt + '</td><td>' + col(rScale.metrics.total) + '</td><td>' + f(-rScale.metrics.maxDD, 1) + '</td></tr>';

        const tl = el.querySelector('#tlist');
        tl.innerHTML = '<tr><th>#</th><th>Дни</th><th>Напр.</th><th>Траншей</th><th>Част. выход</th><th>Чистый итог</th></tr>' +
          (rScale.trades.map((tr, i) => '<tr class="click' + (i === s6.sel ? ' sel' : '') + '" data-i="' + i + '"><td>' + (i + 1) + '</td><td>' + (tr.entryIdx + 1) + '–' + (tr.exitIdx + 1) + '</td><td>' + (tr.dir === 1 ? '<span class="pos">лонг</span>' : '<span class="neg">шорт</span>') + '</td><td>' + tr.tranches + '</td><td>' + (tr.partialExits ? 'да' : 'нет') + '</td><td>' + col(tr.net, 2) + '</td></tr>').join('') || '<tr><td colspan="6">Нет сделок</td></tr>');
        tl.querySelectorAll('tr.click').forEach((trEl) => trEl.addEventListener('click', () => {
          s6.sel = +trEl.dataset.i;
          tl.querySelectorAll('tr.click').forEach((x, k) => x.classList.toggle('sel', k === s6.sel));
          showDetail();
        }));
        showDetail();
      }
      draw();
    }
  });

  /* ---------- 7. Фильтр режима волатильности ---------- */
  const s7 = { scn: 2, volLong: 100, ratioMax: 1.35 };

  Z.push({
    id: 'reg-idea',
    title: 'Фильтр режима волатильности: когда рынку лучше сказать «пас»',
    lead: 'Возврат к среднему любит тихую погоду. Когда на рынке начинается буря и дневные скачки спреда вырастают в разы, старые границы ±2σ рвутся как бумажные — в такие недели выгоднее переждать на берегу.',
    text: () => `
      <h3>Как измерить «шторм» одной простой дробью</h3>
      <p>Не нужны сложные нейросети, чтобы заметить смену ${T('vol_regime', 'режима волатильности')}. Достаточно сравнить <b>свежий размах дневных шагов спреда</b> (скажем, за последние 15 дней) с <b>привычной спокойной нормой</b> за длинное окно L (например, 100 дней):</p>
      <div class="formula">Отношение разбросов R<sub>t</sub> = σ<sub>короткая</sub>(Δспред) ÷ σ<sub>длинная</sub>(Δспред)</div>
      <ul>
        <li>Когда на рынке обычная погода, <b>R<sub>t</sub> крутится около 0,8–1,2</b> — горит <span class="pill go">зелёный свет</span>, торгуем штатно.</li>
        <li>Когда начинается буря, свежие дневные шаги взлетают, и <b>R<sub>t</sub> пробивает порог</b> (например, 1,35) — включается <span class="pill stop">пауза на новые входы</span> (серые колечки ○ на графике).</li>
      </ul>
      <h3>Два золотых правила ${T('vol_ratio', 'фильтра режима')}</h3>
      <ol>
        <li><b>Выходы никогда не блокируются!</b> Если шторм застал вас в уже открытой позиции, цель и ${T('stop', 'стоп-лосс')} обязаны сработать мгновенно.</li>
        <li><b>Слишком строгий порог прячет лучшие сделки.</b> Если зажать порог R<sub>max</sub> до 1,05, фильтр начнёт бояться любого живого движения и пропустит половину прибыли на спокойном рынке. Проверьте это ползунком справа!</li>
      </ol>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Сценарий и настройки фильтра режима</h4>
          <div class="btns" id="tabs" style="margin:0 0 8px">
            <button class="b" data-s="2">Шторм и пробои режима</button>
            <button class="b" data-s="0">Спокойная резинка</button>
          </div>
          <div id="vctl" class="controls"></div>
          <div id="ctl"></div>
        </div>
        <div class="viz">
          <h4>Z-score и сделки с фильтром режима (○ — входы, остановленные фильтром)</h4>
          <div id="c1"></div>
        </div>
        <div class="viz">
          <h4>Отношение разбросов R = σ<sub>короткая</sub> ÷ σ<sub>длинная</sub> (зелёные зоны — торговля разрешена)</h4>
          <div id="c2"></div>
        </div>
        <div class="viz">
          <h4>Сравнение накопленного результата: без фильтра и с фильтром режима σ</h4>
          <div class="legend">
            <span><i style="background:${SIM}"></i>без фильтра режима</span>
            <span><i style="background:${ME}"></i>с фильтром режима σ</span>
          </div>
          <div id="c3"></div>
          <table class="t" id="tab" style="margin-top:10px"></table>
        </div>`;

      const tabs = el.querySelector('#tabs');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s7.scn = +b.dataset.s; draw(); } });

      const vctl = el.querySelector('#vctl');
      HV.slider(vctl, { label: 'Порог шторма R_max', min: 1.05, max: 2.0, step: 0.05, value: s7.ratioMax, fmt: (v) => f(v, 2), hint: 'Выше этого отношения новые сделки ставятся на паузу.', onInput: (v) => { s7.ratioMax = v; draw(); } });
      HV.slider(vctl, { label: 'Длинное базовое окно L', min: 50, max: 150, step: 10, value: s7.volLong, fmt: (v) => f(v, 0) + ' дн.', hint: 'С каким спокойным периодом сравниваем свежую тряску.', onInput: (v) => { s7.volLong = v; draw(); } });
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost], draw);

      let d, rNo, rFlt;
      const c1 = A.mkChart(el.querySelector('#c1'), 190, {
        tip: (i) => (rFlt.z[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>z = <b>' + f(rFlt.z[i]) + '</b>' + (rFlt.blocked[i] ? '<br><span style="color:#ffd166">вход остановлен фильтром шторма</span>' : ''))
      });
      const c2 = A.mkChart(el.querySelector('#c2'), 160, {
        tip: (i) => (rFlt.regime.ratio[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>R = <b>' + f(rFlt.regime.ratio[i], 2) + '</b> (порог ' + f(s7.ratioMax, 2) + ')')
      });
      const c3 = A.mkChart(el.querySelector('#c3'), 175, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>без фильтра: ' + f(rNo.equity[i]) + '<br>с фильтром σ: ' + f(rFlt.equity[i])
      });

      function okSpans(okArr) {
        const out = [];
        let s = null;
        okArr.forEach((v, i) => {
          if (v && s === null) s = i;
          if (!v && s !== null) { out.push({ i0: s, i1: i - 1, color: '#35d07f16' }); s = null; }
        });
        if (s !== null) out.push({ i0: s, i1: okArr.length - 1, color: '#35d07f16' });
        return out;
      }

      function draw() {
        tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.s === s7.scn));
        d = E.genTacticScenario(A.state.seed, SC[s7.scn]);
        const base = A.btParams(), n = d.spread.length;
        rNo = E.backtestTactics(d, base);
        rFlt = E.backtestTactics(d, Object.assign({}, base, { volFilter: true, volLong: s7.volLong, volRatioMax: s7.ratioMax }));

        const p = A.state.params, lim = Math.max(5.5, p.stopZ + 0.5);
        const mk = tacticMarkers(rFlt, (i) => rFlt.z[i]);
        rFlt.blocked.forEach((b, i) => { if (b && rFlt.z[i] !== null) mk.push({ i, y: rFlt.z[i], kind: 'ring', color: GREY, size: 5 }); });
        c1.render({ n, series: [{ data: rFlt.z, color: C.z }], hlines: A.zLines(p), spans: scaleSpans(rFlt), markers: mk, yMin: -lim, yMax: lim });
        c2.render({
          n,
          series: [{ data: rFlt.regime.ratio, color: VIO, width: 2 }],
          hlines: [{ y: s7.ratioMax, color: GOLD, label: 'порог R = ' + f(s7.ratioMax, 2), dash: [6, 4] }, { y: 1, color: '#ffffff33', dash: [] }],
          spans: okSpans(rFlt.regime.ok)
        });
        c3.render({ n, series: [{ data: rNo.equity, color: SIM, width: 2 }, { data: rFlt.equity, color: ME, width: 2.5 }], hlines: [{ y: 0, color: '#ffffff44', dash: [] }] });

        const nBlk = rFlt.blocked.filter(Boolean).length;
        el.querySelector('#tab').innerHTML =
          '<tr><th>Режим</th><th>Сделок</th><th>Отклонено входов в шторм</th><th>Итог, п.</th><th>Макс. просадка</th></tr>' +
          '<tr><td style="color:' + SIM + '"><b>Без фильтра режима</b></td><td>' + rNo.metrics.count + '</td><td>0</td><td>' + col(rNo.metrics.total) + '</td><td>' + f(-rNo.metrics.maxDD, 1) + '</td></tr>' +
          '<tr><td style="color:' + ME + '"><b>С фильтром R ≤ ' + f(s7.ratioMax, 2) + '</b></td><td>' + rFlt.metrics.count + '</td><td>' + nBlk + '</td><td>' + col(rFlt.metrics.total) + '</td><td>' + f(-rFlt.metrics.maxDD, 1) + '</td></tr>';
      }
      draw();
    }
  });

  /* ---------- 8. Пошаговый разбор дня и конструктор приёмов ---------- */
  const s8 = { scn: 2, useLog: false, rev: true, scale: false, vol: true, day: null };

  Z.push({
    id: 'day',
    title: 'Пошаговый разбор дня и конструктор приёмов',
    lead: 'Включайте любую комбинацию четырёх приёмов и разбирайте любой день по косточкам: как считается рабочий ряд, что показывает фильтр шторма, взведён ли автомат разворота и какой транш открыт.',
    full: true,
    mount(el) {
      el.innerHTML = `
        <div style="display:grid;grid-template-columns:560px 1fr;gap:28px;align-items:start">
          <div>
            <div class="viz">
              <h4>Сценарий и включённые приёмы</h4>
              <div class="btns" id="tabs" style="margin:0 0 8px"></div>
              <p id="snote" style="margin:0 0 10px;color:#98a3b6"></p>
              <div class="btns" id="flags" style="margin:0">
                <button class="b" data-f="useLog">Лог-спред + равный объём</button>
                <button class="b" data-f="rev">Вход на развороте</button>
                <button class="b" data-f="scale">Лесенка 0,5 + 0,5</button>
                <button class="b" data-f="vol">Фильтр шторма σ</button>
              </div>
            </div>
            <div class="viz">
              <h4>Выбор дня: <span id="dayv"></span></h4>
              <input type="range" id="day" style="margin-top:8px">
              <div class="btns">
                <button class="b" id="bp">◀ День назад</button>
                <button class="b" id="bn">День вперёд ▶</button>
                <button class="b" id="bs">К следующему действию</button>
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

      const tabs = el.querySelector('#tabs'), flagsEl = el.querySelector('#flags'), slider = el.querySelector('#day');
      tabs.innerHTML = SC.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s8.scn = +b.dataset.i; draw(); } });
      flagsEl.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (b) { const k = b.dataset.f; s8[k] = !s8[k]; draw(); }
      });

      let d, bt;
      const c1 = A.mkChart(el.querySelector('#c1'), 170, { onClick: (i) => setDay(i), tip: (i) => 'День ' + (i + 1) + ': ' + f(bt.sigSeries[i], s8.useLog ? 4 : 2) });
      const c2 = A.mkChart(el.querySelector('#c2'), 150, { onClick: (i) => setDay(i), tip: (i) => (bt.z[i] === null ? null : 'День ' + (i + 1) + ': z = ' + f(bt.z[i])) });
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost], draw);

      function setDay(i) {
        const min = A.state.params.n - 1;
        s8.day = Math.max(min, Math.min(d.spread.length - 1, i));
        draw();
      }
      slider.addEventListener('input', () => setDay(+slider.value));
      el.querySelector('#bp').addEventListener('click', () => setDay(s8.day - 1));
      el.querySelector('#bn').addEventListener('click', () => setDay(s8.day + 1));
      el.querySelector('#bs').addEventListener('click', () => {
        for (let i = s8.day + 1; i < d.spread.length; i++) if (bt.signal[i] || bt.blocked[i]) return setDay(i);
        for (let i = A.state.params.n - 1; i <= s8.day; i++) if (bt.signal[i] || bt.blocked[i]) return setDay(i);
      });
      el.querySelector('#play').addEventListener('click', (ev) => {
        if (window.__stepTimer) { clearInterval(window.__stepTimer); window.__stepTimer = null; ev.target.textContent = '▶ Автопроигрывание'; return; }
        ev.target.textContent = '❚❚ Пауза';
        window.__stepTimer = setInterval(() => {
          if (s8.day >= d.spread.length - 1) { clearInterval(window.__stepTimer); window.__stepTimer = null; ev.target.textContent = '▶ Автопроигрывание'; return; }
          s8.day++; draw();
        }, 350);
      });

      const row = (k, title, text, val) => '<div class="row"><div class="n">' + k + '</div><div><b>' + title + '</b><div style="color:#98a3b6;font-size:14px">' + text + '</div>' + (val ? '<div class="v">' + val + '</div>' : '') + '</div></div>';

      function draw() {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s8.scn));
        flagsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', !!s8[b.dataset.f]));
        el.querySelector('#snote').textContent = SC[s8.scn].note;

        const p = A.state.params;
        d = E.genTacticScenario(A.state.seed, SC[s8.scn]);
        const cfg = Object.assign(A.btParams(), {
          logMode: s8.useLog ? 'notional' : false,
          reversal: s8.rev, reboundZ: 0.45,
          scaleIn: s8.scale, partialExit: true,
          volFilter: s8.vol, volLong: 100, volRatioMax: 1.35
        });
        bt = E.backtestTactics(d, cfg);

        slider.min = p.n - 1; slider.max = d.spread.length - 1;
        if (s8.day === null || s8.day < p.n - 1 || s8.day >= d.spread.length) s8.day = Math.max(p.n - 1, 92);
        slider.value = s8.day;
        const t = s8.day, w0 = t - p.n + 1, dgt = s8.useLog ? 4 : 2;
        const ex = E.explainTactics(d, p.n, t, cfg);
        el.querySelector('#dayv').textContent = 'день ' + (t + 1) + ' из ' + d.spread.length;

        const mk1 = tacticMarkers(bt, (i) => bt.sigSeries[i]);
        c1.render({ n: d.spread.length, series: [{ data: bt.mean, color: C.mean, width: 1.3 }, { data: bt.sigSeries, color: ME }], spans: [{ i0: w0, i1: t, color: '#5aa9ff22' }], markers: mk1, cursor: t });
        const lim = Math.max(5.5, p.stopZ + 0.5);
        const mk2 = tacticMarkers(bt, (i) => bt.z[i]);
        bt.blocked.forEach((b, i) => { if (b && bt.z[i] !== null) mk2.push({ i, y: bt.z[i], kind: 'ring', color: GREY, size: 5 }); });
        c2.render({ n: d.spread.length, series: [{ data: bt.z, color: C.z }], hlines: A.zLines(p), spans: scaleSpans(bt), markers: mk2, cursor: t, yMin: -lim, yMax: lim });

        const prevPos = t > 0 ? bt.pos[t - 1] : 0;
        const prevArm = t > 0 && bt.armedState[t - 1] ? bt.armedState[t - 1] : { dir: 0, peakZ: null };
        const sig = bt.signal[t], blk = bt.blocked[t], curArm = bt.armedState[t];

        let decCls = '', decHtml = '';
        if (blk) {
          decCls = 'close';
          decHtml = '<p>Сигнал ' + (blk.type === 'add' ? 'добора 2-го транша' : 'входа') + ' сформировался, но <b>ОСТАНОВЛЕН ФИЛЬТРОМ ШТОРМА</b>: R = ' + f(ex.volRatio, 2) + ' &gt; 1,35.</p>';
        } else if (sig) {
          if (sig.type === 'open') { decCls = 'open'; decHtml = '<p><b>Решение: открыть ' + (sig.dir === 1 ? 'лонг' : 'шорт') + ' спреда</b> (объём ' + f(sig.sz, 1) + ').</p>'; }
          else if (sig.type === 'add') { decCls = 'open'; decHtml = '<p><b>Решение: добрать 2-й транш (+0,5)</b> на глубоком отклонении (±' + f(bt.params.e2, 2) + 'σ). Полный объём теперь 1,0.</p>'; }
          else if (sig.type === 'partial') { decCls = 'close'; decHtml = '<p><b>Решение: частичный выход (−0,5)</b> на промежуточной цели ±' + f(bt.params.ex1, 2) + 'σ. Вторая половина остаётся в рынке.</p>'; }
          else { decCls = 'close'; decHtml = '<p><b>Решение: полностью закрыть позицию</b> (' + (A.REASON[sig.reason] || sig.reason) + ').</p>'; }
        } else if (bt.pos[t] !== 0) {
          decHtml = '<p>Позиция открыта (объём <b>' + f(bt.pos[t], 1) + '</b>). Условия выхода или добора сегодня не выполнены — <b>держим</b>.</p>';
        } else if (s8.rev && curArm && curArm.dir !== 0) {
          decHtml = '<p>Автомат разворота <b>взведён</b> (' + (curArm.dir === 1 ? 'ждём лонг' : 'ждём шорт') + '): текущий пик = <b>' + f(curArm.peakZ, 2) + 'σ</b>, ждём отскок на 0,45σ к нулю.</p>';
        } else {
          decHtml = '<p>Сигнала нет — <b>остаёмся вне рынка</b>.</p>';
        }

        el.querySelector('#steps').innerHTML =
          row(1, 'Цены A и B и выбранная шкала спреда',
            'A = ' + f(ex.a) + ', B = ' + f(ex.b) + '. ' + (s8.useLog ? 'Включён логарифм: считаем ln(A) − ln(B).' : 'Обычная разность в пунктах: A − B.'),
            s8.useLog ? 'ln(' + f(ex.a) + ') − ln(' + f(ex.b) + ') = ' + f(ex.logSp, 4) : f(ex.a) + ' − ' + f(ex.b) + ' = ' + f(ex.raw, 2) + ' п.') +
          row(2, 'Среднее, разброс σ по окну N = ' + p.n + ' и z-score',
            'Дни ' + (w0 + 1) + '–' + (t + 1) + ': среднее = ' + f(ex.mean, dgt) + ', σ = ' + f(ex.std, dgt) + '.',
            'z = (' + f(ex.value, dgt) + ' − ' + f(ex.mean, dgt) + ') ÷ ' + f(ex.std, dgt) + ' = <b>' + f(ex.z, 2) + ' σ</b>') +
          row(3, 'Фильтр режима волатильности (' + (s8.vol ? 'включён' : 'выключен') + ')',
            'Короткий шаг (' + ex.nShort + ' дн.) = ' + f(ex.volShort, dgt) + ', длинная база (' + ex.nLong + ' дн.) = ' + f(ex.volLong, dgt) + '.',
            'R = ' + f(ex.volRatio, 2) + ' (порог 1,35) → ' + (!s8.vol ? 'фильтр отключён' : ex.volOk ? '<span class="pos">спокойно (вход разрешён)</span>' : '<span class="neg">ШТОРМ (новые входы на паузе)</span>')) +
          row(4, 'Состояние позиции и автоматов до решения',
            'Вчерашний объём: ' + f(prevPos, 1) + '. Порог 1-го входа: ±' + f(bt.params.e1, 2) + 'σ' + (s8.scale ? ', 2-й транш: ±' + f(bt.params.e2, 2) + 'σ' : '') + (s8.rev ? ', прошлый пик автомата: ' + (prevArm.peakZ === null ? 'нет' : f(prevArm.peakZ, 2) + 'σ') : '') + '.', '') +
          '<div class="row"><div class="n">5</div><div><b>Решение дня ' + (t + 1) + '</b><div class="decision ' + decCls + '">' + decHtml + '</div></div></div>';

        el.querySelector('#wtab').innerHTML =
          '<tr><th>День</th><th>A</th><th>B</th><th>Рабочий спред</th><th>Отклонение</th><th>Квадрат</th></tr>' +
          ex.rows.map((r) => '<tr' + (r.idx === t ? ' class="sel"' : '') + '><td>' + (r.idx + 1) + '</td><td>' + f(d.a[r.idx]) + '</td><td>' + f(d.b[r.idx]) + '</td><td>' + f(r.value, dgt) + '</td><td>' + U.sgn(r.dev, dgt) + '</td><td>' + f(r.sq, dgt) + '</td></tr>').join('');
      }
      draw();
    }
  });

  /* ---------- 9. Сводный эксперимент и ловушка «лишних ручек» ---------- */
  const s9 = { scn: 0, knobs: 25 };
  const MODES9 = [
    { name: 'Базовый z-score', color: SIM, cfg: {} },
    { name: 'Лог-спред (равный объём)', color: PRE, cfg: { logMode: 'notional' } },
    { name: 'Вход на развороте', color: GOLD, cfg: { reversal: true, reboundZ: 0.45 } },
    { name: 'Лесенка 0,5 + 0,5', color: ME, cfg: { scaleIn: true, entryZ1: 1.65, addZ: 0.85, partialExit: true } },
    { name: 'Фильтр шторма σ', color: VIO, cfg: { volFilter: true, volLong: 100, volRatioMax: 1.35 } }
  ];

  Z.push({
    id: 'verdict',
    title: 'Когда какой приём помогает — и ловушка «лишних ручек»',
    lead: 'Проверим все четыре модификации против базового z-score на 11 наборах данных в четырёх рыночных режимах — и разберёмся, почему нельзя бездумно сваливать все улучшения в одну кучу.',
    full: true,
    mount(el) {
      el.innerHTML = `
        <h3 style="margin:0 0 10px">1. Честный эксперимент: 4 сценария × 11 наборов данных × 5 вариантов</h3>
        <p style="max-width:960px">Переключайте сценарии: ни один приём не побеждает везде! Каждый лечит ровно свою болезнь — и берёт небольшую плату там, где этой болезни нет.</p>
        <div class="btns" id="tabs"></div>
        <p id="snote" style="margin:0 0 10px;color:#98a3b6"></p>
        <div id="ctl"></div>
        <div class="viz" style="margin-top:14px">
          <div class="scroll" style="max-height:420px"><table class="t" id="tab"></table></div>
          <div class="note" id="sum"></div>
        </div>

        <h3 style="margin:30px 0 10px">2. «Проклятие лишних ручек»: почему опасно навешивать все фильтры сразу</h3>
        <div class="cols"><div class="text">
          <p>У базового z-score всего три главные настройки: длина окна N, порог входа и порог выхода. Когда мы добавляем подтверждение разворота (+1 ручка Δz), лесенку (+2 ручки траншей) и фильтр шторма (+2 ручки окна L и порога R), число ${T('degrees_freedom', 'степеней свободы («ручек»)')} вырастает с 3 до 8!</p>
          <p>Даже если по каждой ручке проверить скромные 4 значения, компьютер переберёт <b>4<sup>8</sup> = 65 536</b> вариантов стратегии. На <i>абсолютно случайном шуме</i> с нулевым математическим ожиданием лучший из тысячи случайных вариантов почти наверняка покажет на прошлой истории красивый плюс — просто по теории вероятностей (см. ${T('overfit', 'переобучение')}).</p>
          <div class="note warn"><b>Практическое правило инженера стратегий.</b> Добавляйте новую деталь только тогда, когда понимаете <i>физическую причину</i> проблемы (цены выросли в разы → нужен логарифм; на новостях рвутся стопы → нужен фильтр шторма), и проверяйте результат на отложенном куске будущего (${T('in_sample', 'вне выборки подбора')}).</div>
        </div><div>
          <div class="viz">
            <h4>Тренажёр самообмана: сколько вариантов проверили на чистом шуме (истинное ожидание = 0 п.)</h4>
            <div id="kctl"></div>
            <table class="t" id="ktab" style="margin-top:10px"></table>
            <div class="note bad" id="kread"></div>
          </div>
        </div></div>

        <h3 style="margin:30px 0 14px">3. Памятка по четырём приёмам</h3>
        <div class="cards" id="cards"></div>

        <div class="viz" style="margin-top:22px">
          <h4>Чек-лист: пять вопросов перед усложнением базовой стратегии</h4>
          <ol style="margin:8px 0 0;padding-left:22px;max-width:980px">
            <li><b>Строго ли положительны цены и меняются ли они в разы?</b> Если да — переходите к ${T('log_spread', 'логарифму')} с обязательным ${T('notional_neutral', 'выравниванием денежного объёма')} ног; для спредов, уходящих ниже нуля, оставайтесь в пунктах.</li>
            <li><b>От чего страдает базовая стратегия — от редких безоткатных пробоев?</b> Тогда поможет ${T('reversal_entry', 'вход на развороте')} или ${T('vol_ratio', 'фильтр шторма')}, но будьте готовы упустить часть прибыли на спокойных быстрых возвратах.</li>
            <li><b>Делите ли вы фиксированный лимит риска при лесенке?</b> ${T('scaling_in', 'Вход частями')} безопасен только тогда, когда сумма всех траншей не превышает вашего обычного максимального объёма и защищена общим стопом.</li>
            <li><b>Хватает ли запаса прибыли на дополнительные заявки?</b> Дробление входа и выхода увеличивает комиссионные и потери на спреде стакана.</li>
            <li><b>Устояло ли улучшение на новых данных без подкрутки порогов?</b> Если приём приносит пользу только при одном «волшебном» значении настройки (скажем, Δz = 0,43, а при 0,40 и 0,50 всё рушится) — перед вами случайная подгонка под прошлое.</li>
          </ol>
        </div>`;

      const tabs = el.querySelector('#tabs');
      tabs.innerHTML = SC.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s9.scn = +b.dataset.i; drawTable(); } });
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost], drawTable);

      function drawTable() {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s9.scn));
        const sc = SC[s9.scn], base = A.btParams();
        el.querySelector('#snote').textContent = sc.note;

        const tot = [0, 0, 0, 0, 0], dd = [0, 0, 0, 0, 0], cn = [0, 0, 0, 0, 0];
        const rows = SEEDS.map((sd) => {
          const d = E.genTacticScenario(sd, sc);
          const ms = MODES9.map((m) => {
            const cfg = Object.assign({}, base, m.cfg);
            if (m.cfg.scaleIn) cfg.entryZ1 = Math.max(0.75, base.entryZ - 0.35);
            return E.backtestTactics(d, cfg).metrics;
          });
          ms.forEach((m, k) => { tot[k] += m.total; dd[k] += m.maxDD; cn[k] += m.count; });
          return '<tr><td>Набор ' + sd + '</td>' + ms.map((m) => '<td>' + col(m.total, 0) + '</td><td>' + f(-m.maxDD, 0) + '</td>').join('') + '</tr>';
        });

        el.querySelector('#tab').innerHTML =
          '<tr><th rowspan="2"></th>' + MODES9.map((m) => '<th colspan="2" style="text-align:center;color:' + m.color + '">' + m.name + '</th>').join('') + '</tr>' +
          '<tr>' + MODES9.map(() => '<th>итог</th><th>просадка</th>').join('') + '</tr>' +
          rows.join('') +
          '<tr><td><b>Сумма (' + SEEDS.length + ' наб.)</b></td>' + MODES9.map((_, k) => '<td><b>' + col(tot[k], 0) + '</b></td><td><b>' + f(-dd[k], 0) + '</b></td>').join('') + '</tr>';

        let bestIdx = 0;
        tot.forEach((v, k) => { if (v > tot[bestIdx]) bestIdx = k; });
        el.querySelector('#sum').innerHTML =
          'Сценарий «<b>' + sc.name + '</b>»: лидер по суммарному итогу — <b style="color:' + MODES9[bestIdx].color + '">' + MODES9[bestIdx].name + '</b> (' + col(tot[bestIdx], 0) + ' п., сумма просадок ' + f(-dd[bestIdx], 0) + ' п.). Сделок по вариантам: ' +
          MODES9.map((m, k) => m.name + ' — <b>' + cn[k] + '</b>').join(', ') + '.';
      }

      HV.slider(el.querySelector('#kctl'), {
        label: 'Сколько комбинаций настроек перебрали на истории (M)', min: 1, max: 1000, step: 25, value: s9.knobs,
        fmt: (v) => f(Math.max(1, v), 0) + ' вар.',
        hint: 'Каждая случайная стратегия на истории имеет среднее 0 п. и разброс итога σ = 45 п.',
        onInput: (v) => { s9.knobs = Math.max(1, v); drawKnobs(); }
      });

      function drawKnobs() {
        const M = s9.knobs, sig = 45;
        // Ожидаемый максимум из M независимых гауссовских величин ≈ σ · √(2·ln M)
        const fakeBest = M <= 1 ? 0 : sig * Math.sqrt(2 * Math.log(M)) * 0.88;
        el.querySelector('#ktab').innerHTML =
          '<tr><th>Участок времени</th><th>«Лучшая» из ' + M + ' случайных комбинаций</th><th>Почему так вышло</th></tr>' +
          '<tr><td>Прошлая история (подбор)</td><td class="pos"><b>+' + f(fakeBest, 0) + ' п.</b></td><td>выбрали самый удачливый билет из ' + M + '</td></tr>' +
          '<tr><td>Будущее (реальная торговля)</td><td><b>0 п. (минус комиссии!)</b></td><td>прошлая удача на шуме не переносится в завтрашний день</td></tr>';
        el.querySelector('#kread').innerHTML = M === 1
          ? 'При проверке одной осмысленной гипотезы самообмана от перебора нет.'
          : 'Перебрав <b>' + M + ' комбинаций</b> на абсолютно бесполезном шуме, вы почти гарантированно увидите на бэктесте «прибыльную систему» около <b>+' + f(fakeBest, 0) + ' п.</b> — хотя в реальности её ожидание равно нулю!';
      }

      const cards = [
        ['Логарифм вместо разности', 'Незаменим на длинных горизонтах, где цены меняются в разы: переводит спред в проценты. Требует строго положительных цен и выравнивания денежного объёма ног.'],
        ['Вход на «развороте»', 'Ждёт отскока Δz от достигнутого экстремума: спасает от безоткатных «падающих ножей» в шторм, но отдаёт начало каждого движения и пропускает однодневные уколы.'],
        ['Вход и выход частями', 'Делит плановый объём на 2 транша: ловит умеренные качания первой половиной и улучшает среднюю цену на глубоких заходах, но платит больше комиссий и требует жёсткого стопа.'],
        ['Фильтр режима волатильности', 'Ставит новые входы на паузу при взлёте отношения разбросов σ_короткая ÷ σ_длинная: резко сокращает просадку в бурю, никогда не блокируя выходы из открытых позиций.']
      ];
      el.querySelector('#cards').innerHTML = cards.map((c) => '<div class="card"><h4>' + c[0] + '</h4><p>' + c[1] + '</p></div>').join('');

      drawTable();
      drawKnobs();
    }
  });
})();
