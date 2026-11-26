/* Корзины из 3+ инструментов, экраны 5–8: ловушка переобучения весов на шуме,
   правила и сделки (пара vs фиксированная vs OLS vs фильтр Маккиннона), разбор дня и эксперимент (#45, #38). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, S = window.SPECS, HV = window.HV;
  const C = U.COLORS;
  const Z = (window.BSCREENS = window.BSCREENS || []);
  const SC = E.BASKET_SCENARIOS;
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', PRE = '#5aa9ff', GOLD = '#ffd166', PURP = '#c9b6ff';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 1 : d) + '</span>';

  /* ---------- 5. Ловушка переобучения весов на случайных блужданиях ---------- */
  const s5 = { mTotal: 7, split: 140, seedIdx: 0 };

  Z.push({
    id: 'spurious-overfit',
    title: 'Ловушка переобучения: «идеальная резинка» из чистого шума',
    lead: 'Главная опасность больших корзин кроется в самой алгебре: имея 6–10 несвязанных случайных блужданий, регрессия почти всегда склеит из них заманчиво ровную кривую на прошлом участке — которая рассыплется в первый же день живых торгов.',
    text: () => `
      <h3>Почему десять бумаг опаснее двух</h3>
      <p>В разделе о коинтеграции мы видели, что два независимых случайных блуждания редко притворяются «резинкой» (примерно в 5% случаев). Но когда вы даёте компьютеру <code>M = 7..10</code> бумаг, у ${T('mult_ols', 'множественной регрессии')} появляется целый пульт свободных ручек <code>w₁, w₂, …, w<sub>M−1</sub></code>:</p>
      <ul>
        <li>Один случайный горб бумаги <code>A</code> регрессия гасит противоположным случайным горбом бумаги <code>D</code>, второй — ямкой бумаги <code>G</code>, а общий наклон прячет в разности трендов <code>B</code> и <code>F</code>.</li>
        <li>На обучающем куске истории (слева от жёлтой черты на графике) получается аккуратная ${T('spurious_basket', '«нарисованная» корзина')} с узким разбросом!</li>
        <li>Но никакой реальной связи между компаниями не было — и справа от черты (на новых днях) «резинка» мгновенно улетает в космос.</li>
      </ul>
      <h3>${T('mackinnon_crit', 'Поправка Маккиннона')} и правило здравого смысла</h3>
      <p>Нельзя проверять корзину из 5–8 ног старым парным порогом <code>−3,34</code>! С каждой новой ногой критическая граница сдвигается всё дальше влево: <b>−3,34</b> (2 ноги) → <b>−3,74</b> (3 ноги) → <b>−4,10</b> (4 ноги) → <b>−4,71</b> (6 ног) → <b>−5,79</b> (10 ног). А главное правило ещё проще: <b>сначала экономический смысл связки, и только потом регрессия на минимальном числе ног (3–4 контракта)</b>.</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Соберите «резинку» из абсолютно несвязанных случайных блужданий</h4>
          <p class="cap">Все ряды ниже сгенерированы независимо друг от друга — истинной связи между ними НЕТ (ноль!). Двигайте число бумаг M от 2 до 10 и следите, что происходит слева (обучение) и справа (будущее).</p>
          <div class="btns" id="b5" style="margin:0 0 10px"></div>
          <div id="sl5a"></div>
          <div id="sl5b"></div>
          <div id="k5" style="margin-top:10px"></div>
        </div>
        <div class="viz">
          <h4>Слева от черты — подгонка весов на истории, справа — живая проверка в будущем</h4>
          <div class="legend">
            <span><i style="background:${ME}"></i>участок подбора весов (in-sample)</span>
            <span><i style="background:${BAD}"></i>те же самые веса на новых данных (out-of-sample)</span>
          </div>
          <div id="c5"></div>
          <div id="note5" class="note" style="margin-top:10px"></div>
        </div>`;

      const bEl = el.querySelector('#b5');
      const DEMO_SEEDS = [7, 11, 21, 42];
      bEl.innerHTML = DEMO_SEEDS.map((sd, i) => '<button class="b" data-i="' + i + '">Случайный набор #' + (i + 1) + '</button>').join('');
      bEl.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (b) { s5.seedIdx = +b.dataset.i; draw5(); }
      });

      HV.slider(el.querySelector('#sl5a'), {
        label: 'Всего случайных бумаг M в корзине', min: 2, max: 10, step: 1, value: s5.mTotal,
        fmt: (v) => v + ' бумаг (подгоняется ' + (v - 1) + ' веса)',
        onInput: (v) => { s5.mTotal = v; draw5(); }
      });
      HV.slider(el.querySelector('#sl5b'), {
        label: 'Длина обучающего окна (граница «прошлое / будущее»)', min: 60, max: 190, step: 10, value: s5.split,
        fmt: (v) => 'дни 1–' + v + ' (проверка на днях ' + (v + 1) + '–320)',
        onInput: (v) => { s5.split = v; draw5(); }
      });

      const c5 = A.mkChart(el.querySelector('#c5'), 225, {
        tip: (i) => '<b>День ' + (i + 1) + ' (' + (i < s5.split ? 'обучение' : 'новые данные!') + ')</b><br>значение корзины: <b>' + U.sgn(full5[i]) + ' п.</b>'
      });
      let full5 = [];

      function draw5() {
        bEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s5.seedIdx));
        const bk = E.genBasket({ seed: DEMO_SEEDS[s5.seedIdx], pureNoise: true, rwStep: 1.9, extraWalks: 7 });
        const pool = [bk.b, bk.c].concat(bk.extras).slice(0, s5.mTotal - 1);
        const sp = s5.split, n = bk.a.length;

        const yTrain = bk.a.slice(0, sp);
        const xTrain = pool.map((arr) => arr.slice(0, sp));
        const fit = E.olsMulti(yTrain, xTrain);

        full5 = new Array(n);
        const inS = new Array(n).fill(null), outS = new Array(n).fill(null);
        let sqIn = 0, sqOut = 0;
        for (let t = 0; t < n; t++) {
          let hat = fit.c;
          for (let j = 0; j < pool.length; j++) hat += fit.weights[j] * pool[j][t];
          const val = E.round2(bk.a[t] - hat);
          full5[t] = val;
          if (t < sp) { inS[t] = val; sqIn += val * val; }
          if (t >= sp - 1) { outS[t] = val; if (t >= sp) sqOut += val * val; }
        }
        const sdIn = Math.sqrt(sqIn / sp);
        const sdOut = Math.sqrt(sqOut / (n - sp));
        const df = E.dfTest(fit.resid);
        const tau = df ? df.tau : 0;
        const critM = E.basketCrit(s5.mTotal, sp);
        const fooledNaive = tau <= -3.34 && tau > critM;

        el.querySelector('#k5').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + ME + '">' + f(sdIn, 2) + ' п.</div><div class="l">разброс σ на обучении</div><div class="e">кажется узким и послушным</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + BAD + '">' + f(sdOut, 2) + ' п. (×' + f(sdOut / Math.max(0.1, sdIn), 1) + ')</div><div class="l">разброс σ в будущем</div><div class="e">истинное лицо блуждания</div></div>' +
            '<div class="kpi"><div class="v">' + f(tau, 2) + '</div><div class="l">τ на обучении</div><div class="e">парный порог был −3,34</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + GOLD + '">' + f(critM, 2) + '</div><div class="l">порог Маккиннона (' + s5.mTotal + ' ног)</div><div class="e">' + (tau <= critM ? 'случайный пробой 5%' : 'подделка отклонена!') + '</div></div>' +
          '</div>';

        c5.render({
          n,
          spans: [{ i0: sp - 0.5, i1: n - 1, color: '#ff6b6b12' }],
          hlines: [
            { y: 0, color: '#ffffff33', dash: [3, 3] },
            { y: 2 * sdIn, color: '#7ee0b555', dash: [4, 4], label: '+2σ обуч.' },
            { y: -2 * sdIn, color: '#7ee0b555', dash: [4, 4] }
          ],
          series: [
            { data: inS, color: ME, width: 2.0 },
            { data: outS, color: BAD, width: 2.0 }
          ]
        });

        const nEl = el.querySelector('#note5');
        if (fooledNaive) {
          nEl.className = 'note bad';
          nEl.innerHTML = '<b>Классический самообман поймали за руку!</b> На обучении τ = <b>' + f(tau) + '</b> пробила наивный парный порог −3,34, хотя перед нами чистый шум. Правильный порог Маккиннона для ' + s5.mTotal + ' ног равен <b>' + f(critM) + '</b> — он распознаёт подделку и запрещает торговлю!';
        } else if (tau <= critM) {
          nEl.className = 'note warn';
          nEl.innerHTML = 'Даже строгий 5%-порог (' + f(critM) + ') изредка пропускает удачное совпадение шума — а справа от черты разброс всё равно раздувается в <b>' + f(sdOut / Math.max(0.1, sdIn), 1) + ' раза</b>. Поэтому экономическая логика корзины обязательна до любых тестов!';
        } else {
          nEl.className = 'note';
          nEl.innerHTML = 'Вне обучающего участка разброс вырос с <b>' + f(sdIn) + '</b> до <b>' + f(sdOut) + ' п.</b>, а тест Маккиннона (τ = ' + f(tau) + ' правее ' + f(critM) + ') честно предупредил, что стационарной связи здесь нет.';
        }
      }
      draw5();
    }
  });

  /* ---------- 6. Правила и сделки: пара vs фиксированная vs регрессия 3 ног ---------- */
  const s6 = { scn: 0, mode: 2, regN: 75, mult: 1.35, sel: 0 };
  const MODES6 = [
    { key: 'pair', name: 'Пара A − k·B (2 ноги)', color: BAD, opts: { basketMode: 'pair' } },
    { key: 'fixed', name: 'Фикс. корзина 0,5·B + 0,5·C', color: PRE, opts: { basketMode: 'fixed' } },
    { key: 'ols', name: 'Скользящая регрессия 3 ног', color: ME, opts: { basketMode: 'ols' } },
    { key: 'ols_coint', name: 'Регрессия 3 ног + Маккиннон', color: GOLD, opts: { basketMode: 'ols_coint' } }
  ];

  Z.push({
    id: 'trades',
    title: 'Правила и сделки: пара против фиксированной и адаптивной корзины',
    lead: 'Проверим все четыре способа сборки позиции на живых сделках: когда побеждает готовая экономическая формула, когда спасает скользящая регрессия трёх ног и когда выручает фильтр Маккиннона.',
    text: () => `
      <h3>Четыре конкурирующих подхода</h3>
      <ol>
        <li><b style="color:${BAD}">Пара A − k·B (2 ноги).</b> Экономит на третьей ноге, но гасит только один рыночный фактор и целиком принимает на себя обвал бумаги <code>B</code>.</li>
        <li><b style="color:${PRE}">Фиксированная корзина 0,5·B + 0,5·C.</b> Веса заданы раз и навсегда из экономики или индекса. Лучший выбор, когда пропорция известна заранее (сценарий 2): никакой ошибки оценки по короткому окну!</li>
        <li><b style="color:${ME}">Скользящая регрессия 3 ног.</b> По последним <code>regN</code> дням пересчитывает пару весов <code>(w₁, w₂)</code>, а на время открытой сделки замораживает их (чтобы не тратиться на ежедневную перебалансировку). Блестяще справляется с двумя факторами и уводит вес от заболевшей бумаги <code>B</code>!</li>
        <li><b style="color:${GOLD}">Регрессия 3 ног + фильтр Маккиннона.</b> То же самое, но вход открывается лишь тогда, когда остатки окна пробивают ужесточённый порог стационарности для трёх ног (<code>τ ≤ −3,80</code>). Бережёт счёт на ложных корзинах, но пропускает часть спокойных сделок из-за жёсткости теста.</li>
      </ol>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Сценарий, режим корзины, окно регрессии весов и издержки</h4>
          <div class="btns" id="tabs" style="margin:0 0 8px"></div>
          <p id="snote" style="margin:0 0 10px;color:#98a3b6"></p>
          <div class="btns" id="modes" style="margin:0 0 10px"></div>
          <div id="rctl"></div>
          <div id="mctl"></div>
          <div id="ctl"></div>
        </div>
        <div class="viz">
          <h4 id="c1t">Рабочий спред корзины, среднее и сделки</h4>
          <div class="legend">
            <span><i class="dot" style="background:${C.up}"></i>▲ вход лонг корзины</span>
            <span><i class="dot" style="background:${C.down}"></i>▼ вход шорт корзины</span>
            <span><i class="dot" style="background:${C.exit}"></i>✕ выход</span>
          </div>
          <div id="c1"></div>
        </div>
        <div class="viz">
          <h4>Веса партнёров w₁(B) и w₂(C) во времени (красный фон — вход закрыт фильтром Маккиннона)</h4>
          <div class="legend">
            <span><i style="background:${PRE}"></i>вес w₁ (бумага B)</span>
            <span><i style="background:${PURP}"></i>вес w₂ (бумага C)</span>
          </div>
          <div id="c2"></div>
        </div>
        <div class="viz">
          <h4>Сравнение накопленного результата четырёх режимов</h4>
          <div class="legend">
            <span><i style="background:${BAD}"></i>пара A − kB</span>
            <span><i style="background:${PRE}"></i>фикс. 0,5/0,5</span>
            <span><i style="background:${ME}"></i>скользящая регрессия 3 ног</span>
            <span><i style="background:${GOLD}"></i>регрессия + Маккиннон</span>
          </div>
          <div id="c3"></div>
          <table class="t" id="tab" style="margin-top:10px"></table>
        </div>
        <div class="viz">
          <h4>Журнал сделок выбранного режима (нажмите строку, чтобы увидеть раскладку по 3 ногам и целые лоты)</h4>
          <div class="scroll" style="max-height:220px"><table class="t" id="tlist"></table></div>
          <div id="tbox" style="margin-top:12px"></div>
        </div>`;

      const tabs = el.querySelector('#tabs'), modesEl = el.querySelector('#modes');
      tabs.innerHTML = SC.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      modesEl.innerHTML = MODES6.map((m, i) => '<button class="b" data-i="' + i + '">' + m.name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.scn = +b.dataset.i; s6.sel = 0; draw(); } });
      modesEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.mode = +b.dataset.i; s6.sel = 0; draw(); } });

      HV.slider(el.querySelector('#rctl'), {
        label: 'Окно регрессии для оценки весов (regN)', min: 45, max: 120, step: 5, value: s6.regN,
        fmt: (v) => v + ' дн. (порог 3 ног: ' + f(E.basketCrit(3, v)) + ')',
        onInput: (v) => { s6.regN = v; draw(); }
      });
      HV.slider(el.querySelector('#mctl'), {
        label: 'Множитель издержек 3 ног к паре', min: 1.0, max: 2.0, step: 0.05, value: s6.mult,
        fmt: (v) => f(v, 2) + '×',
        onInput: (v) => { s6.mult = v; draw(); }
      });
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost], draw);

      let bk, runs = [];
      const c1 = A.mkChart(el.querySelector('#c1'), 190, {
        tip: (i) => {
          const r = runs[s6.mode];
          return r.sigSeries[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>спред корзины: <b>' + U.sgn(r.sigSeries[i]) + '</b>' +
            (r.mean[i] !== null ? '<br>среднее окна: ' + f(r.mean[i]) + ' · z = <b>' + f(r.z[i]) + '</b>' : '');
        }
      });
      const c2 = A.mkChart(el.querySelector('#c2'), 150, {
        tip: (i) => {
          const r = runs[s6.mode];
          return r.w1[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>w₁(B) = <b>' + f(r.w1[i]) + '</b> · w₂(C) = <b>' + f(r.w2[i]) + '</b>' +
            (r.tau[i] !== null ? '<br>τ = ' + f(r.tau[i]) + ' (порог ' + f(r.crit3) + ')' : '');
        }
      });
      const c3 = A.mkChart(el.querySelector('#c3'), 190, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>' + MODES6.map((m, k) => '<span style="color:' + m.color + '">' + m.name + ': <b>' + U.sgn(runs[k].equity[i], 1) + '</b></span>').join('<br>')
      });

      function blockSpans(r) {
        const sp = [];
        let s = null;
        for (let i = 0; i < r.pass.length; i++) {
          if (!r.pass[i] && s === null) s = i;
          if ((r.pass[i] || i === r.pass.length - 1) && s !== null) {
            sp.push({ i0: s, i1: r.pass[i] ? i - 1 : i, color: '#ff6b6b18' });
            s = null;
          }
        }
        return sp;
      }

      function drawDetail(r) {
        const box = el.querySelector('#tbox');
        if (!r.trades.length) { box.innerHTML = '<div class="note">В этом режиме сделок не открывалось (например, фильтр Маккиннона отсеял нестационарные окна).</div>'; return; }
        if (s6.sel >= r.trades.length) s6.sel = 0;
        const tr = r.trades[s6.sel];
        const lots = E.roundBasketLots([Math.abs(tr.w1), Math.abs(tr.w2)], 6);
        const dirTxt = tr.dir === 1 ? 'лонг корзины (+A, −w₁B, −w₂C)' : 'шорт корзины (−A, +w₁B, +w₂C)';
        box.innerHTML =
          '<div class="note"><b>Паспорт сделки #' + (s6.sel + 1) + ':</b> ' + dirTxt + ', дни <b>' + (tr.entryIdx + 1) + '–' + (tr.exitIdx + 1) + '</b> (' + tr.bars + ' дн.), выход: <b>' + (A.REASON[tr.reason] || tr.reason) + '</b>.<br>' +
          'Замороженные на входе веса: <b>w₁ = ' + f(tr.w1, 3) + '</b>, <b>w₂ = ' + f(tr.w2, 3) + '</b> (в целых лотах до 6 шт. A: пакет <b>' + lots.qA + ' A : ' + lots.qs[0] + ' B : ' + lots.qs[1] + ' C</b>).</div>' +
          '<table class="t" style="margin-top:8px">' +
          '<tr><th>Нога корзины</th><th>Вес в пакете</th><th>Цена входа → выхода</th><th>Вклад в результат</th></tr>' +
          '<tr><td>Нога A (ведущая)</td><td>' + (tr.dir > 0 ? '+1,000' : '−1,000') + '</td><td>' + f(tr.aIn) + ' → ' + f(tr.aOut) + '</td><td>' + col(tr.pnlA, 2) + ' п.</td></tr>' +
          '<tr><td>Нога B (партнёр 1)</td><td>' + U.sgn(-tr.dir * tr.w1, 3) + '</td><td>' + f(tr.bIn) + ' → ' + f(tr.bOut) + '</td><td>' + col(tr.pnlB, 2) + ' п.</td></tr>' +
          '<tr><td>Нога C (партнёр 2)</td><td>' + U.sgn(-tr.dir * tr.w2, 3) + '</td><td>' + f(tr.cIn) + ' → ' + f(tr.cOut) + '</td><td>' + col(tr.pnlC, 2) + ' п.</td></tr>' +
          '<tr><td colspan="3"><b>Грязный итог корзины</b></td><td><b>' + col(tr.gross, 2) + ' п.</b></td></tr>' +
          '<tr><td colspan="3">Издержки круга</td><td>−' + f(tr.cost, 2) + ' п.</td></tr>' +
          '<tr><td colspan="3"><b>Чистый итог на счёте</b></td><td><b>' + col(tr.net, 2) + ' п.</b></td></tr></table>';
      }

      function draw() {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s6.scn));
        modesEl.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s6.mode));
        el.querySelector('#snote').textContent = SC[s6.scn].note;

        bk = E.genBasketScenario(A.state.seed, SC[s6.scn]);
        const base = A.btParams(), n = bk.a.length;
        runs = MODES6.map((m) => E.backtestBasket(bk, Object.assign({}, base, m.opts, { regN: s6.regN, legFeeMult: s6.mult })));

        const cur = runs[s6.mode], mInfo = MODES6[s6.mode];
        el.querySelector('#c1t').textContent = 'Рабочий спред корзины, среднее и сделки — «' + mInfo.name + '»';

        c1.render({
          n,
          series: [
            { data: cur.mean, color: C.mean, width: 1.4 },
            { data: cur.sigSeries, color: mInfo.color, width: 1.8 }
          ],
          spans: A.positionSpans(cur),
          markers: A.tradeMarkers(cur, (i) => cur.sigSeries[i])
        });

        c2.render({
          n,
          hlines: [{ y: 0, color: '#ffffff28', dash: [3, 3] }],
          spans: s6.mode === 3 ? blockSpans(cur) : [],
          series: [
            { data: cur.w1, color: PRE, width: 1.8 },
            { data: cur.w2, color: PURP, width: 1.8 }
          ]
        });

        c3.render({
          n,
          hlines: [{ y: 0, color: '#ffffff44', dash: [] }],
          series: MODES6.map((m, k) => ({ data: runs[k].equity, color: m.color, width: k === s6.mode ? 2.6 : 1.7, dash: k === 0 ? [5, 4] : [] }))
        });

        el.querySelector('#tab').innerHTML =
          '<tr><th>Режим</th><th>Сделок</th><th>Доля плюсовых</th><th>Итог, п.</th><th>Макс. просадка</th></tr>' +
          MODES6.map((m, k) => {
            const r = runs[k].metrics, bold = k === s6.mode;
            return '<tr><td style="color:' + m.color + '">' + (bold ? '<b>' + m.name + '</b>' : m.name) + '</td><td>' + r.count + '</td><td>' + (r.winRate === null ? '—' : Math.round(r.winRate * 100) + '%') + '</td><td>' + col(r.total) + '</td><td>' + f(-r.maxDD, 1) + '</td></tr>';
          }).join('');

        const tl = el.querySelector('#tlist');
        tl.innerHTML = '<tr><th>#</th><th>Дни</th><th>Напр.</th><th>Веса (w₁; w₂)</th><th>Причина выхода</th><th>Чистый итог</th></tr>' +
          (cur.trades.map((tr, i) => '<tr class="click' + (i === s6.sel ? ' sel' : '') + '" data-i="' + i + '">' +
            '<td>' + (i + 1) + '</td><td>' + (tr.entryIdx + 1) + '–' + (tr.exitIdx + 1) + '</td>' +
            '<td>' + (tr.dir === 1 ? '<span class="pos">лонг</span>' : '<span class="neg">шорт</span>') + '</td>' +
            '<td>' + f(tr.w1, 2) + '; ' + f(tr.w2, 2) + '</td>' +
            '<td>' + (A.REASON[tr.reason] || tr.reason) + '</td>' +
            '<td>' + col(tr.net, 2) + '</td></tr>').join('') || '<tr><td colspan="6" style="color:#8b95a7">Нет сделок</td></tr>');

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
  const s7 = { scn: 0, mode: 2, regN: 75, day: null };

  Z.push({
    id: 'day',
    title: 'Пошаговый разбор одного дня',
    lead: 'Выберите любой день и проследите всю цепочку расчёта корзины без единого скрытого шага: от трёх котировок и матрицы сумм до весов w₁, w₂, поправки Маккиннона, окна N и торгового решения.',
    full: true,
    mount(el) {
      el.innerHTML = `
        <div style="display:grid;grid-template-columns:560px 1fr;gap:28px;align-items:start">
          <div>
            <div class="viz">
              <h4>Сценарий и режим корзины</h4>
              <div class="btns" id="tabs" style="margin:0 0 8px"></div>
              <p id="snote" style="margin:0 0 10px;color:#98a3b6"></p>
              <div class="btns" id="modes" style="margin:0"></div>
            </div>
            <div class="viz">
              <h4>Выбор дня: <span id="dayv"></span></h4>
              <input type="range" id="day" style="margin-top:8px">
              <div class="btns">
                <button class="b" id="bp">◀ День назад</button>
                <button class="b" id="bn">День вперёд ▶</button>
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
            <details style="margin-top:14px"><summary>Показать все N дней расчётного окна z-score</summary>
              <div class="scroll" style="margin-top:8px"><table class="t" id="wtab"></table></div>
            </details>
          </div>
        </div>`;

      const tabs = el.querySelector('#tabs'), modesEl = el.querySelector('#modes'), slider = el.querySelector('#day');
      tabs.innerHTML = SC.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      modesEl.innerHTML = MODES6.map((m, i) => '<button class="b" data-i="' + i + '">' + m.name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s7.scn = +b.dataset.i; draw(); } });
      modesEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s7.mode = +b.dataset.i; draw(); } });

      let bk, bt;
      const c1 = A.mkChart(el.querySelector('#c1'), 175, { onClick: (i) => setDay(i), tip: (i) => (bt.sigSeries[i] === null ? null : 'День ' + (i + 1) + ': спред ' + U.sgn(bt.sigSeries[i])) });
      const c2 = A.mkChart(el.querySelector('#c2'), 145, { onClick: (i) => setDay(i), tip: (i) => (bt.z[i] === null ? null : 'День ' + (i + 1) + ': z = ' + f(bt.z[i])) });
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn], draw);

      function minDay() { return Math.max(s7.regN - 1, A.state.params.n - 1); }
      function setDay(i) {
        s7.day = Math.max(minDay(), Math.min(bk.a.length - 1, i));
        draw();
      }
      slider.addEventListener('input', () => setDay(+slider.value));
      el.querySelector('#bp').addEventListener('click', () => setDay(s7.day - 1));
      el.querySelector('#bn').addEventListener('click', () => setDay(s7.day + 1));
      el.querySelector('#bs').addEventListener('click', () => {
        for (let i = s7.day + 1; i < bk.a.length; i++) if (bt.signal[i]) return setDay(i);
        for (let i = minDay(); i <= s7.day; i++) if (bt.signal[i]) return setDay(i);
      });
      el.querySelector('#play').addEventListener('click', (ev) => {
        if (window.__stepTimer) { clearInterval(window.__stepTimer); window.__stepTimer = null; ev.target.textContent = '▶ Автопроигрывание'; return; }
        ev.target.textContent = '❚❚ Пауза';
        window.__stepTimer = setInterval(() => {
          if (s7.day >= bk.a.length - 1) { clearInterval(window.__stepTimer); window.__stepTimer = null; ev.target.textContent = '▶ Автопроигрывание'; return; }
          s7.day++; draw();
        }, 350);
      });

      function draw() {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s7.scn));
        modesEl.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s7.mode));
        el.querySelector('#snote').textContent = SC[s7.scn].note;

        const p = A.state.params, mInfo = MODES6[s7.mode];
        bk = E.genBasketScenario(A.state.seed, SC[s7.scn]);
        bt = E.backtestBasket(bk, Object.assign(A.btParams(), mInfo.opts, { regN: s7.regN }));

        const lo = minDay();
        slider.min = lo; slider.max = bk.a.length - 1;
        if (s7.day === null || s7.day < lo || s7.day >= bk.a.length) s7.day = lo + 25;
        slider.value = s7.day;
        const t = s7.day;
        const ex = E.explainBasket(bk, s7.regN, p.n, t, mInfo.opts);
        const lots = E.roundBasketLots([Math.abs(ex.w1), Math.abs(ex.w2)], 6);
        el.querySelector('#dayv').textContent = 'день ' + (t + 1) + ' из ' + bk.a.length + ' · w₁ = ' + f(ex.w1) + ', w₂ = ' + f(ex.w2);

        const w0 = t - p.n + 1, r0 = t - s7.regN + 1;
        c1.render({
          n: bk.a.length,
          series: [{ data: bt.mean, color: C.mean, width: 1.3 }, { data: bt.sigSeries, color: mInfo.color }],
          spans: [{ i0: r0, i1: t, color: '#c9b6ff14' }, { i0: w0, i1: t, color: '#5aa9ff24' }],
          markers: A.tradeMarkers(bt, (i) => bt.sigSeries[i]), cursor: t
        });
        const lim = Math.max(5.5, p.stopZ + 0.5);
        c2.render({
          n: bk.a.length,
          series: [{ data: bt.z, color: C.z }],
          hlines: A.zLines(p), spans: [{ i0: w0, i1: t, color: '#5aa9ff24' }],
          cursor: t, yMin: -lim, yMax: lim
        });

        let wHtml;
        if (mInfo.opts.basketMode === 'fixed') {
          wHtml = 'Режим фиксированной корзины: веса заданы экономикой без переоценки — <b>w₁ = ' + f(ex.w1) + '</b>, <b>w₂ = ' + f(ex.w2) + '</b>.';
        } else if (mInfo.opts.basketMode === 'pair') {
          wHtml = 'Обычная пара по окну ' + (r0 + 1) + '–' + (t + 1) + ': Σb² = ' + f(ex.sBB, 1) + ', Σ(ba) = ' + f(ex.sBA, 1) + ' → <b>k = w₁ = ' + f(ex.w1, 3) + '</b>, <b>w₂ = 0</b>.';
        } else {
          wHtml = 'Окно регрессии ' + s7.regN + ' дн. (' + (r0 + 1) + '–' + (t + 1) + '): Σb² = ' + f(ex.sBB, 1) + ', Σc² = ' + f(ex.sCC, 1) + ', Σ(bc) = ' + f(ex.sBC, 1) + ', Σ(ba) = ' + f(ex.sBA, 1) + ', Σ(ca) = ' + f(ex.sCA, 1) + '<br>' +
            'Решение системы 2×2: <b>w₁ = ' + f(ex.w1, 3) + '</b>, <b>w₂ = ' + f(ex.w2, 3) + '</b> (целые лоты: <b>' + lots.qA + ' A : ' + lots.qs[0] + ' B : ' + lots.qs[1] + ' C</b>).';
        }

        const cointHtml = ex.tau === null
          ? 'Тест стационарности не требуется в режиме жёстко заданных весов.'
          : 'τ-статистика остатков = <b>' + f(ex.tau, 2) + '</b> против порога Маккиннона <b>' + f(ex.crit, 2) + '</b> → ' +
            (ex.pass ? '<span class="pos"><b>связь подтверждена</b></span>' : '<span class="neg"><b>слабая связь (в режиме с фильтром новые входы закрыты)</b></span>');

        const dec = A.decisionText(t, bt, p);
        const blocked = mInfo.opts.basketMode === 'ols_coint' && !ex.pass && Math.abs(ex.z) >= p.entryZ && bt.pos[t] === 0;

        el.querySelector('#steps').innerHTML = `
          <div class="row"><div class="n">1</div><div><b>Цены трёх инструментов в день ${t + 1}</b><div class="v">A = <b>${f(ex.a)}</b> · B = <b>${f(ex.b)}</b> · C = <b>${f(ex.c)}</b></div></div></div>
          <div class="row"><div class="n">2</div><div><b>Веса корзины на сегодня</b><div class="v">${wHtml}</div></div></div>
          <div class="row"><div class="n">3</div><div><b>Проверка стационарности (поправка Маккиннона)</b><div class="v">${cointHtml}</div></div></div>
          <div class="row"><div class="n">4</div><div><b>Спред корзины и z-score по окну N = ${p.n} дней</b> (дни ${w0 + 1}–${t + 1})<div class="v">Сегодня: ${f(ex.a)} − ${f(ex.w1, 2)}·${f(ex.b)} − ${f(ex.w2, 2)}·${f(ex.c)} = <b>${U.sgn(ex.value)}</b> · μ = ${f(ex.mean)} · σ = ${f(ex.std)} → <b>z = ${U.sgn(ex.z)}</b></div></div></div>
          <div class="row"><div class="n">5</div><div><b>Решение</b><div class="v">${blocked ? '<span class="neg"><b>Пробой порога z есть, но фильтр Маккиннона блокирует вход</b> (τ правее ' + f(ex.crit) + ').</span>' : dec.html}</div></div></div>`;

        el.querySelector('#wtab').innerHTML =
          '<tr><th>День</th><th>A</th><th>B</th><th>C</th><th>Корзина A − w₁B − w₂C</th><th>Откл. от μ</th><th>Квадрат откл.</th></tr>' +
          ex.rows.map((rw) => '<tr' + (rw.idx === t ? ' class="sel"' : '') + '><td>' + (rw.idx + 1) + '</td><td>' + f(rw.a) + '</td><td>' + f(rw.b) + '</td><td>' + f(rw.c) + '</td><td>' + U.sgn(rw.value) + '</td><td>' + U.sgn(rw.dev) + '</td><td>' + f(rw.sq) + '</td></tr>').join('');
      }
      draw();
    }
  });

  /* ---------- 8. Сводный эксперимент на 4 сценариях и памятка ---------- */
  const s8 = { scn: 0, regN: 75, mult: 1.35 };

  Z.push({
    id: 'verdict',
    title: 'Честный эксперимент: когда корзина бьёт пару, а когда — наоборот',
    lead: 'Сопоставим все четыре подхода на 44 независимых годовых историях (176 полных прогонов при одинаковых правилах входа и выхода) и соберём практическую памятку.',
    full: true,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Общие настройки для всех 176 прогонов (4 сценария × 11 серий × 4 режима)</h4>
          <div id="rctl8"></div>
          <div id="mctl8"></div>
          <div id="ctl8"></div>
          <table class="t" id="sum8" style="margin-top:12px"></table>
        </div>
        <div class="viz">
          <h4>Результаты по каждой из 11 серий в выбранном сценарии</h4>
          <div class="btns" id="tabs8" style="margin:0 0 8px"></div>
          <p id="note8" style="margin:0 0 10px;color:#98a3b6"></p>
          <table class="t" id="seeds8"></table>
        </div>
        <div class="cards" style="margin-top:18px">
          <div class="card">
            <h4>Когда 3+ ноги дают решающий перевес</h4>
            <p>Когда в ценах действуют сразу два общих рыночных фактора (сценарий 1) или когда одна из бумаг способна выкинуть индивидуальный фокус (сценарий 3): адаптивная корзина выигрывает у простой пары в разы и режет просадку.</p>
          </div>
          <div class="card">
            <h4>Когда лучше не пересчитывать веса регрессией</h4>
            <p>Если пропорция известна из физики или структуры индекса (сценарий 2: переработка сырья, состав индекса), готовые фиксированные веса обходят скользящую регрессию — они не тратят точность на подгонку под шум короткого окна.</p>
          </div>
          <div class="card risk">
            <h4>Главный враг — «нарисованные» корзины из шума</h4>
            <p>В четвёртом сценарии слепая регрессия открывает больше сотни убыточных сделок на пустом месте. Поправка Маккиннона для числа ног сокращает число ложных входов почти в десять раз и бережёт капитал.</p>
          </div>
          <div class="card">
            <h4>Золотая середина практика: 3–4 ликвидные ноги</h4>
            <p>Переход от 2 к 3–4 экономически связанным ликвидным контрактам даёт львиную долю пользы диверсификации, ещё не убивая сделку комиссиями, тонкими стаканами и переобучением.</p>
          </div>
        </div>`;

      const tabs = el.querySelector('#tabs8');
      tabs.innerHTML = SC.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s8.scn = +b.dataset.i; draw8(); } });

      HV.slider(el.querySelector('#rctl8'), {
        label: 'Окно регрессии весов (regN)', min: 45, max: 120, step: 5, value: s8.regN,
        fmt: (v) => v + ' дн.',
        onInput: (v) => { s8.regN = v; draw8(); }
      });
      HV.slider(el.querySelector('#mctl8'), {
        label: 'Множитель издержек 3 ног к паре', min: 1.0, max: 2.0, step: 0.05, value: s8.mult,
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
            const d = E.genBasketScenario(sd, sc);
            return MODES6.map((m) => E.backtestBasket(d, Object.assign({}, base, m.opts, { regN: s8.regN, legFeeMult: s8.mult })).metrics);
          });
          const agg = MODES6.map((_, k) => {
            let tot = 0, cnt = 0, worstDD = 0;
            bySeed.forEach((row) => {
              tot += row[k].total;
              cnt += row[k].count;
              if (row[k].maxDD > worstDD) worstDD = row[k].maxDD;
            });
            return { tot, cnt, worstDD };
          });
          return { sc, bySeed, agg };
        });

        el.querySelector('#sum8').innerHTML =
          '<tr><th>Сценарий (11 серий)</th><th style="color:' + BAD + '">Пара A − k·B</th><th style="color:' + PRE + '">Фикс. 0,5/0,5</th><th style="color:' + ME + '">Скольз. OLS 3 ног</th><th style="color:' + GOLD + '">OLS + Маккиннон</th></tr>' +
          all.map((row, idx) => {
            const a = row.agg;
            return '<tr' + (idx === s8.scn ? ' class="sel"' : '') + '><td><b>' + row.sc.name + '</b></td>' +
              a.map((x) => '<td>' + col(x.tot, 0) + ' п. <span style="color:#8b95a7">(' + x.cnt + ' сд., DD −' + f(x.worstDD, 0) + ')</span></td>').join('') + '</tr>';
          }).join('');

        const cur = all[s8.scn];
        el.querySelector('#seeds8').innerHTML =
          '<tr><th>Серия (seed)</th><th style="color:' + BAD + '">Пара A − k·B</th><th style="color:' + PRE + '">Фикс. 0,5/0,5</th><th style="color:' + ME + '">Скольз. OLS 3 ног</th><th style="color:' + GOLD + '">OLS + Маккиннон</th></tr>' +
          SEEDS.map((sd, idx) => {
            const r = cur.bySeed[idx];
            return '<tr><td>Серия #' + (idx + 1) + ' (seed ' + sd + ')</td>' +
              r.map((x) => '<td>' + col(x.total, 1) + ' <span style="color:#8b95a7">(' + x.count + ' сд., DD −' + f(x.maxDD, 1) + ')</span></td>').join('') + '</tr>';
          }).join('');
      }
      draw8();
    }
  });
})();
