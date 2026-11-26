/* Приёмы и модификации, экраны 1–5: логарифмический спред (идея и сделки),
   вход на развороте (автомат отскока и сделки), вход и выход частями — идея и ручной расчёт (#36). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, S = window.SPECS, HV = window.HV;
  const C = U.COLORS;
  const Z = (window.TSCREENS = window.TSCREENS || []);
  const SC = E.TACTIC_SCENARIOS;
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', PRE = '#5aa9ff', GOLD = '#ffd166', GREY = '#8b95a7';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 1 : d) + '</span>';

  /* ---------- 1. Логарифм вместо разности: от пунктов к процентам ---------- */
  const s1 = { bBase: 100, premPct: 30, wigPct: 3, mult: 3, mktShock: 10 };

  Z.push({
    id: 'log-idea',
    title: 'Логарифм вместо разности: от пунктов к процентам',
    lead: 'Когда цены инструментов за год меняются в два-три раза, старая разница A − B в пунктах начинает врать. Посмотрим, как натуральный логарифм переводит спред на язык процентов — и почему без пересчёта числа контрактов здесь легко ошибиться.',
    text: () => `
      <h3>В чём беда обычной разности A − B</h3>
      <p>Представьте два связанных товара: марка A обычно на <b>30%</b> дороже марки B. Весной B стоит 100, значит A стоит 130, и привычный спред A − B равен <b>+30 пунктам</b>.</p>
      <p>К осени весь сырьевой рынок подорожал втрое: B теперь стоит 300, а A (всё те же честные +30%!) стоит 390. Экономическое соотношение между ними <i>не изменилось ни на грамм</i>, но разность A − B выросла с +30 до <b>+90 пунктов</b>! Простой z-score решит, что спред улетел вверх, и начнёт раз за разом продавать его себе в убыток.</p>
      <h3>Что такое ${T('nat_log', 'натуральный логарифм ln')} на школьном языке</h3>
      <p>Логарифм превращает <b>деление в вычитание</b>. Для любых двух положительных цен выполняется точное школьное тождество:</p>
      <div class="formula">ln(A) − ln(B) = ln(A ÷ B)</div>
      <p>Заметьте главное чудо этой формулы: 130 ÷ 100 = <b>1,30</b> и 390 ÷ 300 = <b>1,30</b>! Во сколько бы раз ни вырос общий уровень цен, ${T('log_spread', 'логарифмический спред')} остаётся равен <b>ln(1,30) ≈ 0,2624</b>. А для небольших отклонений (скажем, 1–5%) шаг логарифма почти в точности равен обычному проценту: <b>ln(1,03) ≈ 0,0296 ≈ +3%</b>.</p>
      <h3>Главная тонкость: логарифм нельзя торговать «1 лот к 1 лоту»!</h3>
      <p>Разность <code>ln(A) − ln(B)</code> измеряет разницу <i>процентных</i> доходностей A и B. Чтобы один процент движения A уравновешивал один процент движения B на вашем реальном счёте, ноги должны быть равны <b>в деньгах</b> (${T('notional_neutral', 'выравнивание денежного объёма')}), а не в штуках контрактов:</p>
      <div class="formula">Стоимость ноги A = N<sub>A</sub> × A &nbsp;≈&nbsp; Стоимость ноги B = N<sub>B</sub> × B</div>
      <p>Если A стоит 130, а B стоит 100, то на каждые 100 000 ₽ в ноге B нужно держать те же 100 000 ₽ в ноге A (то есть примерно 10 контрактов A против 13 контрактов B).</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Калькулятор масштаба: весна против осени</h4>
          <div id="ctl1"></div>
          <table class="t" id="tab1" style="margin-top:10px"></table>
          <div class="note" id="note1" style="margin-top:10px"></div>
        </div>
        <div class="viz">
          <h4>Почему нужно выравнивать денежный объём (проверка рыночным скачком)</h4>
          <p class="cap">Обе цены синхронно выросли на <b id="shv"></b>% без изменения отношения A ÷ B. Посмотрите, что будет на счёте при бюджете 100 000 ₽ на каждую ногу:</p>
          <div id="ctl2"></div>
          <table class="t" id="tab2" style="margin-top:10px"></table>
        </div>`;

      const c1 = el.querySelector('#ctl1');
      HV.slider(c1, { label: 'Обычная премия A к B', min: 0, max: 60, step: 5, value: s1.premPct, fmt: (v) => '+' + f(v, 0) + '%', onInput: (v) => { s1.premPct = v; draw(); } });
      HV.slider(c1, { label: 'Дневное колебание вокруг нормы', min: 1, max: 8, step: 1, value: s1.wigPct, fmt: (v) => '±' + f(v, 0) + '%', onInput: (v) => { s1.wigPct = v; draw(); } });
      HV.slider(c1, { label: 'Во сколько раз вырос весь рынок к осени', min: 1, max: 5, step: 0.5, value: s1.mult, fmt: (v) => '×' + f(v, 1), onInput: (v) => { s1.mult = v; draw(); } });

      const c2 = el.querySelector('#ctl2');
      HV.slider(c2, { label: 'Общий скачок рынка (и A, и B изменились одинаково в %)', min: -20, max: 20, step: 2, value: s1.mktShock, fmt: (v) => U.sgn(v, 0) + '%', onInput: (v) => { s1.mktShock = v; draw(); } });

      function draw() {
        const b1 = s1.bBase, ratio = 1 + s1.premPct / 100;
        const a1 = b1 * ratio;
        const b2 = b1 * s1.mult, a2 = a1 * s1.mult;
        const wig1 = a1 * (s1.wigPct / 100), wig2 = a2 * (s1.wigPct / 100);
        const lnNorm = Math.log(ratio);
        const lnWig = Math.log(1 + s1.wigPct / 100);

        el.querySelector('#tab1').innerHTML =
          '<tr><th>Показатель</th><th>Весна (рынок ×1)</th><th>Осень (рынок ×' + f(s1.mult, 1) + ')</th><th>Сбился ли прицел?</th></tr>' +
          '<tr><td>Цены A и B</td><td>A = ' + f(a1, 1) + ', B = ' + f(b1, 1) + '</td><td>A = ' + f(a2, 1) + ', B = ' + f(b2, 1) + '</td><td>отношение A ÷ B = <b>' + f(ratio, 2) + '</b></td></tr>' +
          '<tr><td><b>Разность A − B, п.</b></td><td>' + f(a1 - b1, 1) + ' ± ' + f(wig1, 1) + '</td><td class="' + (s1.mult > 1 && s1.premPct > 0 ? 'neg' : '') + '"><b>' + f(a2 - b2, 1) + ' ± ' + f(wig2, 1) + '</b></td><td>' + (s1.mult === 1 ? 'нет' : '<span class="neg">уровень и σ выросли в ' + f(s1.mult, 1) + ' раза!</span>') + '</td></tr>' +
          '<tr><td style="color:' + ME + '"><b>ln(A) − ln(B)</b></td><td>' + f(lnNorm, 4) + ' ± ' + f(lnWig, 4) + '</td><td class="pos"><b>' + f(Math.log(a2) - Math.log(b2), 4) + ' ± ' + f(lnWig, 4) + '</b></td><td><span class="pos">не изменился вообще</span></td></tr>';

        el.querySelector('#note1').innerHTML = s1.premPct === 0 && s1.mult > 1
          ? 'Даже при нулевой премии (A ≈ B), где средний уровень A − B остаётся около 0, разброс колебаний в пунктах вырастает в <b>' + f(s1.mult, 1) + ' раза</b> (с ±' + f(wig1, 1) + ' до ±' + f(wig2, 1) + ' п.), тогда как в логарифмах разброс неизменен (±' + f(lnWig * 100, 2) + '%).'
          : 'При премии +' + s1.premPct + '% и росте рынка в <b>' + f(s1.mult, 1) + ' раза</b> обычный спред A − B уплывает с <b>' + f(a1 - b1, 1) + '</b> на <b>' + f(a2 - b2, 1) + ' п.</b>, хотя A по-прежнему ровно на ' + s1.premPct + '% дороже B.';

        el.querySelector('#shv').textContent = U.sgn(s1.mktShock, 0);
        const sh = s1.mktShock / 100;
        const cap = 100000;
        // Ошибка: поровну в штуках (на общую сумму 200 000 ₽)
        const eqQty = (2 * cap) / (a1 + b1);
        const pnlEqA = eqQty * (a1 * sh), pnlEqB = -eqQty * (b1 * sh);
        const pnlEq = pnlEqA + pnlEqB;
        // Правильно: по 100 000 ₽ в каждую ногу
        const qA = cap / a1, qB = cap / b1;
        const pnlNotA = qA * (a1 * sh), pnlNotB = -qB * (b1 * sh);
        const pnlNot = pnlNotA + pnlNotB;

        el.querySelector('#tab2').innerHTML =
          '<tr><th>Способ сборки позиции (лонг спреда)</th><th>Куплено A</th><th>Продано B</th><th>Нога A</th><th>Нога B</th><th>Итог от общего движения рынка</th></tr>' +
          '<tr><td>Ошибка: поровну в штуках</td><td>' + f(eqQty, 1) + ' шт. (' + U.fmt(eqQty * a1, 0) + ' ₽)</td><td>' + f(eqQty, 1) + ' шт. (' + U.fmt(eqQty * b1, 0) + ' ₽)</td><td>' + U.sgn(pnlEqA, 0) + ' ₽</td><td>' + U.sgn(pnlEqB, 0) + ' ₽</td><td>' + (Math.abs(pnlEq) < 1 ? '0 ₽' : '<span class="' + (pnlEq >= 0 ? 'pos' : 'neg') + '"><b>' + U.sgn(pnlEq, 0) + ' ₽ (утечка рынка!)</b></span>') + '</td></tr>' +
          '<tr><td style="color:' + ME + '"><b>Поровну в деньгах (по 100 000 ₽)</b></td><td>' + f(qA, 1) + ' шт. (100 000 ₽)</td><td>' + f(qB, 1) + ' шт. (100 000 ₽)</td><td>' + U.sgn(pnlNotA, 0) + ' ₽</td><td>' + U.sgn(pnlNotB, 0) + ' ₽</td><td><b class="pos">' + U.sgn(pnlNot, 0) + ' ₽ (полная защита)</b></td></tr>';
      }
      draw();
    }
  });

  /* ---------- 2. Сделки на лог-спреде при смене масштаба цен ---------- */
  const s2 = { scn: 1 };

  Z.push({
    id: 'log-trades',
    title: 'Сделки на лог-спреде при смене масштаба цен',
    lead: 'Сравним на живом графике три подхода, когда рынок сначала вырастает вчетверо, а затем откатывается назад, при этом A всё время держится около +42% к B.',
    text: () => `
      <h3>Три линии в честном сравнении</h3>
      <ol>
        <li><b style="color:${SIM}">Простой спред A − B.</b> Видит, как разница в пунктах ползёт с +23 до +100, принимает рост масштаба за «перекупленность», открывает шорт за шортом и закрывается по стопам.</li>
        <li><b style="color:${PRE}">Сигнал ln(A) − ln(B), но равное число контрактов.</b> Точки входа и выхода уже правильные! Но внутри каждой сделки дорогая нога A весит на 42% больше в деньгах, чем нога B — поэтому счёт лишний раз качает вместе с рынком.</li>
        <li><b style="color:${ME}">Лог-спред + равный денежный объём ног.</b> И сигнал считается в процентах (<code>ln A − ln B</code>), и объём каждой ноги на входе фиксируется равным (по 100 условных единиц капитала). Общий рост и падение рынка больше не мешают.</li>
      </ol>
      <h3>Когда логарифм НЕ подходит</h3>
      <ul>
        <li><b>Цены или спред могут быть нулевыми или отрицательными.</b> Например, календарный спред или разница процентных ставок легко уходят в минус — логарифм отрицательного числа не существует!</li>
        <li><b>Дробное число контрактов.</b> Чтобы идеально выровнять 100 000 ₽ при ценах 142 и 100, нужно отношение лотов около 7 к 10 — как и в разделе «Динамический хедж», на 1 контракте остаётся погрешность округления.</li>
      </ul>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Сценарий данных и параметры</h4>
          <div class="btns" id="tabs" style="margin:0 0 8px">
            <button class="b" data-s="1">Смена масштаба цен в 4 раза</button>
            <button class="b" data-s="0">Спокойная резинка (без смены масштаба)</button>
          </div>
          <div id="ctl"></div>
        </div>
        <div class="viz">
          <h4>Цены A и B (вверху) и почему A − B плывёт, когда ln(A) − ln(B) ровный</h4>
          <div class="legend">
            <span><i style="background:${C.a}"></i>цена A</span>
            <span><i style="background:${C.b}"></i>цена B</span>
            <span><i style="background:${SIM}"></i>разность A − B, п.</span>
          </div>
          <div id="c1"></div>
          <div class="legend" style="margin-top:10px">
            <span><i style="background:${ME}"></i>лог-спред ln(A) − ln(B), переведённый в % (×100)</span>
          </div>
          <div id="c2"></div>
        </div>
        <div class="viz">
          <h4>Накопленный результат трёх подходов</h4>
          <div class="legend">
            <span><i style="background:${SIM}"></i>простой A − B</span>
            <span><i style="background:${PRE}"></i>лог-сигнал, равные лоты</span>
            <span><i style="background:${ME}"></i>лог-спред + равный денежный объём</span>
          </div>
          <div id="c3"></div>
          <table class="t" id="tab" style="margin-top:10px"></table>
        </div>`;

      const tabs = el.querySelector('#tabs');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s2.scn = +b.dataset.s; draw(); } });
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost], draw);

      let d, rPlain, rEq, rNot;
      const c1 = A.mkChart(el.querySelector('#c1'), 170, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>A: ' + f(d.a[i]) + ' · B: ' + f(d.b[i]) + '<br>разность A − B: <b>' + f(d.spread[i]) + ' п.</b>'
      });
      const c2 = A.mkChart(el.querySelector('#c2'), 150, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>ln(A) − ln(B): <b>' + f(d.logSpread[i], 4) + '</b> (' + f(d.logSpread[i] * 100, 2) + '%)'
      });
      const c3 = A.mkChart(el.querySelector('#c3'), 175, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>A − B: ' + f(rPlain.equity[i]) + '<br>лог (равные лоты): ' + f(rEq.equity[i]) + '<br>лог (равный объём): ' + f(rNot.equity[i])
      });

      function draw() {
        tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.s === s2.scn));
        d = E.genTacticScenario(A.state.seed, SC[s2.scn]);
        const base = A.btParams(), n = d.a.length;
        rPlain = E.backtestTactics(d, Object.assign({}, base, { logMode: false }));
        rEq = E.backtestTactics(d, Object.assign({}, base, { logMode: 'equalLots' }));
        rNot = E.backtestTactics(d, Object.assign({}, base, { logMode: 'notional' }));

        c1.render({ n, series: [{ data: d.a, color: C.a, width: 1.6 }, { data: d.b, color: C.b, width: 1.6 }, { data: d.spread, color: SIM, width: 2 }] });
        const lnPct = d.logSpread.map((v) => v * 100);
        const lnMeanPct = rNot.mean.map((v) => (v === null ? null : v * 100));
        c2.render({ n, series: [{ data: lnMeanPct, color: C.mean, width: 1.4 }, { data: lnPct, color: ME, width: 1.9 }], markers: A.tradeMarkers(rNot, (i) => lnPct[i]) });
        c3.render({
          n,
          series: [
            { data: rPlain.equity, color: SIM, width: 2 },
            { data: rEq.equity, color: PRE, width: 1.9, dash: [6, 4] },
            { data: rNot.equity, color: ME, width: 2.5 }
          ],
          hlines: [{ y: 0, color: '#ffffff44', dash: [] }]
        });

        const row = (nm, c, m) => '<tr><td style="color:' + c + '"><b>' + nm + '</b></td><td>' + m.count + '</td><td>' + (m.winRate === null ? '—' : Math.round(m.winRate * 100) + '%') + '</td><td>' + col(m.total) + '</td><td>' + f(-m.maxDD, 1) + '</td></tr>';
        el.querySelector('#tab').innerHTML =
          '<tr><th>Вариант</th><th>Сделок</th><th>Прибыльных</th><th>Итог, п.</th><th>Макс. просадка</th></tr>' +
          row('Простой спред A − B', SIM, rPlain.metrics) +
          row('ln(A) − ln(B), равное число лотов', PRE, rEq.metrics) +
          row('ln(A) − ln(B) + равный денежный объём', ME, rNot.metrics);
      }
      draw();
    }
  });

  /* ---------- 3. Вход на «развороте»: как не ловить падающий нож ---------- */
  const REV_PRESETS = [
    { name: 'Плавный разворот (удачный вход)', zs: [-1.1, -2.1, -2.6, -2.9, -2.3, -1.2, -0.3] },
    { name: '«Падающий нож» (уход за стоп без потерь!)', zs: [-1.2, -2.1, -2.8, -3.3, -3.8, -4.1, -3.9] },
    { name: 'Мгновенный укол (сделка упущена)', zs: [-1.0, -2.3, -0.2, 0.1, -0.3, 0.2, 0.0] }
  ];
  const s3 = { preset: 0, zs: REV_PRESETS[0].zs.slice(), entryZ: 2.0, reboundZ: 0.45, exitZ: 0.5, stopZ: 3.5 };

  Z.push({
    id: 'rev-idea',
    title: 'Вход на «развороте»: как не ловить падающий нож',
    lead: 'Обычный z-score входит в ту же секунду, когда спред пересёк ±2σ — даже если он летит дальше без тормозов. Правило разворота ждёт первого подтверждения, что «резинка» действительно натянулась и пошла назад.',
    text: () => `
      <h3>В чём опасность мгновенного входа</h3>
      <p>Представьте, что у одной из компаний вышла тяжёлая новость, и спред за четыре дня падает: −1,2σ → −2,1σ → −3,0σ → −3,8σ. Стандартное правило продаёт или покупает уже на <b>−2,1σ</b> — то есть ловит ${T('falling_knife', '«падающий нож»')} голой рукой и почти сразу закрывается по ${T('stop', 'стоп-лоссу')} на −3,5σ.</p>
      <h3>Как работает ${T('reversal_entry', 'вход на развороте')} (три простых шага)</h3>
      <ol>
        <li><b>Взведение внимания.</b> Как только z пересёк порог <b>±z<sub>вх</sub></b> (например, −2,0σ), сделку <i>ещё не открываем</i>. Мы запоминаем самый дальний достигнутый пик <b>z<sub>пик</sub></b>.</li>
        <li><b>Проверка отскока Δz.</b> Каждый следующий день смотрим: если спред ушёл ещё дальше — просто обновляем пик. А если он развернулся к нулю хотя бы на <b>Δz</b> (скажем, на 0,45σ: с пика −2,90σ поднялся до −2,30σ) — <b>открываем сделку!</b></li>
        <li><b>Два защитных сброса.</b> Если спред без малейшего отскока пролетел за стоп (−3,5σ), мы снимаем наблюдение <b>без единого рубля убытка</b>! А если за один день он прыгнул с −2,3σ сразу к −0,2σ (уже у цели), входить поздно — тоже сбрасываем ожидание.</li>
      </ol>
      <div class="note warn"><b>Честная плата за осторожность.</b> На каждой состоявшейся сделке вы отдаёте первые <b>Δz</b> движения ради подтверждения, а резкие однодневные «уколы» пропускаете целиком. Проверьте все три случая на тренажёре справа!</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Тренажёр автомата разворота на 7 днях</h4>
          <div class="btns" id="pr" style="margin:0 0 10px"></div>
          <div id="rctl"></div>
          <div id="zsliders" class="controls" style="margin-top:10px"></div>
          <div id="c" style="margin-top:10px"></div>
          <table class="t" id="tab" style="margin-top:10px"></table>
          <div class="note" id="verdict" style="margin-top:10px"></div>
        </div>`;

      const pr = el.querySelector('#pr');
      pr.innerHTML = REV_PRESETS.map((p, i) => '<button class="b" data-i="' + i + '">' + p.name + '</button>').join('');
      pr.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        s3.preset = +b.dataset.i;
        s3.zs = REV_PRESETS[s3.preset].zs.slice();
        buildSliders();
        draw();
      });

      HV.slider(el.querySelector('#rctl'), {
        label: 'Требуемый отскок от пика Δz', min: 0.2, max: 1.0, step: 0.05, value: s3.reboundZ,
        fmt: (v) => f(v, 2) + ' σ',
        hint: 'На сколько сигм z должен развернуться от самого глубокого пика к нулю, чтобы мы поверили в разворот.',
        onInput: (v) => { s3.reboundZ = v; draw(); }
      });

      const zsBox = el.querySelector('#zsliders');
      function buildSliders() {
        zsBox.innerHTML = '';
        s3.zs.forEach((val, idx) => {
          HV.slider(zsBox, {
            label: 'День ' + (idx + 1) + ': z', min: -4.5, max: 1.0, step: 0.1, value: val,
            fmt: (v) => f(v, 1) + ' σ',
            onInput: (v) => { s3.zs[idx] = v; s3.preset = -1; draw(); }
          });
        });
      }
      buildSliders();

      const chart = A.mkChart(el.querySelector('#c'), 185, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>z = ' + f(s3.zs[i], 2) + ' σ'
      });

      function draw() {
        pr.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s3.preset));
        let armDir = 0, peak = null, pos = 0, enterIdx = null, exitIdx = null, statusRows = [];
        let stdEnter = null, stdStop = false;

        s3.zs.forEach((z, i) => {
          if (stdEnter === null && z <= -s3.entryZ) stdEnter = i;
          else if (stdEnter !== null && z <= -s3.stopZ) stdStop = true;

          let stTxt = 'спокойно (ждём пробоя −2,0σ)';
          if (pos === 1) {
            if (z <= -s3.stopZ) { pos = 0; exitIdx = i; stTxt = '<span class="neg"><b>выход по стопу (−3,5σ)</b></span>'; }
            else if (z >= -s3.exitZ) { pos = 0; exitIdx = i; stTxt = '<span class="pos"><b>выход по цели (≥ −0,5σ)</b></span>'; }
            else stTxt = '<span class="pos">держим лонг спреда</span>';
          } else if (exitIdx !== null) {
            stTxt = 'сделка завершена';
          } else if (Math.abs(z) >= s3.stopZ) {
            armDir = 0; peak = null;
            stTxt = '<span style="color:' + GOLD + '"><b>улетел за стоп без входа — нож пропущен!</b></span>';
          } else if (armDir === 0) {
            if (z <= -s3.entryZ) {
              armDir = 1; peak = z;
              stTxt = '<span style="color:' + PRE + '">внимание взведено, пик = ' + f(peak, 2) + 'σ</span>';
            }
          } else {
            if (z < peak) {
              peak = z;
              stTxt = '<span style="color:' + PRE + '">новый пик = ' + f(peak, 2) + 'σ (ждём разворота)</span>';
            } else if (z >= -s3.exitZ) {
              armDir = 0; peak = null;
              stTxt = '<span style="color:' + GREY + '">уже вернулся к цели без отката в рабочей зоне — пропуск</span>';
            } else if (z - peak >= s3.reboundZ && z <= -(s3.exitZ + 0.2)) {
              pos = 1; enterIdx = i;
              stTxt = '<span class="pos"><b>ВХОД ЛОНГ!</b> Отскок ' + f(z - peak, 2) + 'σ ≥ ' + f(s3.reboundZ, 2) + 'σ</span>';
              armDir = 0; peak = null;
            } else {
              stTxt = '<span style="color:' + PRE + '">отскок ' + f(z - peak, 2) + 'σ (нужно ' + f(s3.reboundZ, 2) + 'σ)</span>';
            }
          }
          statusRows.push({ day: i + 1, z, stTxt });
        });

        const mk = [];
        if (enterIdx !== null) mk.push({ i: enterIdx, y: s3.zs[enterIdx], kind: 'up', color: C.up });
        if (exitIdx !== null) mk.push({ i: exitIdx, y: s3.zs[exitIdx], kind: 'cross', color: C.exit });
        chart.render({
          n: s3.zs.length,
          series: [{ data: s3.zs, color: ME, width: 2.4 }],
          hlines: [
            { y: -s3.entryZ, color: PRE, label: 'взведение −2,0σ', dash: [5, 4] },
            { y: -s3.exitZ, color: GOLD, label: 'цель −0,5σ', dash: [4, 4] },
            { y: -s3.stopZ, color: BAD, label: 'стоп −3,5σ', dash: [4, 4] }
          ],
          markers: mk, yMin: -4.5, yMax: 0.6
        });

        el.querySelector('#tab').innerHTML =
          '<tr><th>День</th><th>z-score</th><th>Что делает автомат «Вход на развороте»</th></tr>' +
          statusRows.map((r) => '<tr><td>День ' + r.day + '</td><td><b>' + f(r.z, 2) + ' σ</b></td><td>' + r.stTxt + '</td></tr>').join('');

        const vEl = el.querySelector('#verdict');
        if (enterIdx !== null) {
          vEl.innerHTML = '<b>Сравнение с обычным входом:</b> обычный z-score вошёл бы раньше (день ' + (stdEnter + 1) + ' на ' + f(s3.zs[stdEnter], 2) + 'σ), а вход на развороте дождался дня ' + (enterIdx + 1) + ' (' + f(s3.zs[enterIdx], 2) + 'σ), убедившись, что обвал остановился.';
        } else if (stdStop) {
          vEl.innerHTML = '<b>Главный выигрыш:</b> обычный z-score открыл бы сделку в день ' + (stdEnter + 1) + ' и получил полный стоп-лосс на −3,5σ, тогда как вход на развороте не потерял ни пункта!';
        } else {
          vEl.innerHTML = '<b>Цена осторожности:</b> обычный z-score успел бы забрать быстрый отскок со дня ' + ((stdEnter !== null ? stdEnter : 1) + 1) + ', а автомат разворота остался в стороне.';
        }
      }
      draw();
    }
  });

  /* ---------- 4. Сделки со входом на развороте ---------- */
  const s4 = { scn: 2, reboundZ: 0.45 };

  Z.push({
    id: 'rev-trades',
    title: 'Сделки со входом на развороте: защита в шторм и её цена',
    lead: 'Посмотрим на полной истории из 320 дней, как шаг подтверждения Δz спасает от серии стопов во время рыночного шторма — и сколько прибыли он недобирает на тихом рынке.',
    text: () => `
      <h3>Как ведёт себя настройка Δz</h3>
      <ul>
        <li><b>Маленький отскок (Δz = 0,15–0,25σ).</b> Почти любой случайный однодневный вздох внутри падения принимается за «разворот» — защита от падающего ножа слабая.</li>
        <li><b>Средний отскок (Δz = 0,40–0,55σ).</b> Отсекает безоткатные пробои режима: в сценарии «Шторм» число стоп-лоссов и убыток падают в разы.</li>
        <li><b>Слишком большой отскок (Δz = 0,90–1,20σ).</b> Пока ждём такого большого возврата, спред уже почти доходит до цели выхода! Сделок остаётся мало, а прибыль каждой крошечная.</li>
      </ul>
      <p>Переключайте справа кнопки «Шторм и пробои режима» и «Спокойная резинка» и двигайте ползунок Δz — вы наглядно увидите этот компромисс.</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Сценарий и шаг подтверждения отскока Δz</h4>
          <div class="btns" id="tabs" style="margin:0 0 8px">
            <button class="b" data-s="2">Шторм и пробои режима</button>
            <button class="b" data-s="0">Спокойная резинка</button>
          </div>
          <div id="rctl"></div>
          <div id="ctl"></div>
        </div>
        <div class="viz">
          <h4>Z-score и сделки входа на развороте (красные полосы — зоны шторма)</h4>
          <div id="c1"></div>
        </div>
        <div class="viz">
          <h4>Сравнение накопленного результата: мгновенный вход против входа на развороте</h4>
          <div class="legend">
            <span><i style="background:${SIM}"></i>обычный вход на пробое</span>
            <span><i style="background:${ME}"></i>вход после отскока Δz</span>
          </div>
          <div id="c2"></div>
          <table class="t" id="tab" style="margin-top:10px"></table>
        </div>`;

      const tabs = el.querySelector('#tabs');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s4.scn = +b.dataset.s; draw(); } });
      HV.slider(el.querySelector('#rctl'), {
        label: 'Шаг подтверждения отскока Δz', min: 0.15, max: 1.15, step: 0.05, value: s4.reboundZ,
        fmt: (v) => f(v, 2) + ' σ',
        onInput: (v) => { s4.reboundZ = v; draw(); }
      });
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost], draw);

      let d, rBase, rRev;
      const c1 = A.mkChart(el.querySelector('#c1'), 195, {
        tip: (i) => (rRev.z[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>z = <b>' + f(rRev.z[i]) + '</b>' + (rRev.armedState[i] && rRev.armedState[i].dir !== 0 ? '<br><span style="color:#5aa9ff">ждём отскок от пика ' + f(rRev.armedState[i].peakZ) + 'σ</span>' : ''))
      });
      const c2 = A.mkChart(el.querySelector('#c2'), 175, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>обычный вход: ' + f(rBase.equity[i]) + '<br>на развороте: ' + f(rRev.equity[i])
      });

      function stormSpans(arr) {
        const out = [];
        let st = null;
        arr.forEach((v, i) => {
          if (v && st === null) st = i;
          if (!v && st !== null) { out.push({ i0: st, i1: i - 1, color: '#ff6b6b18' }); st = null; }
        });
        if (st !== null) out.push({ i0: st, i1: arr.length - 1, color: '#ff6b6b18' });
        return out;
      }

      function draw() {
        tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.s === s4.scn));
        d = E.genTacticScenario(A.state.seed, SC[s4.scn]);
        const base = A.btParams(), n = d.spread.length;
        rBase = E.backtestTactics(d, base);
        rRev = E.backtestTactics(d, Object.assign({}, base, { reversal: true, reboundZ: s4.reboundZ }));

        const p = A.state.params, lim = Math.max(5.5, p.stopZ + 0.5);
        c1.render({
          n,
          series: [{ data: rRev.z, color: C.z }],
          hlines: A.zLines(p),
          spans: stormSpans(d.isStorm).concat(A.positionSpans(rRev)),
          markers: A.tradeMarkers(rRev, (i) => rRev.z[i]),
          yMin: -lim, yMax: lim
        });
        c2.render({
          n,
          series: [
            { data: rBase.equity, color: SIM, width: 2 },
            { data: rRev.equity, color: ME, width: 2.5 }
          ],
          hlines: [{ y: 0, color: '#ffffff44', dash: [] }]
        });

        const stopsOf = (r) => r.trades.filter((x) => x.reason === 'stop').length;
        const row = (nm, c, r) => '<tr><td style="color:' + c + '"><b>' + nm + '</b></td><td>' + r.metrics.count + '</td><td>' + stopsOf(r) + '</td><td>' + col(r.metrics.total) + '</td><td>' + f(-r.metrics.maxDD, 1) + '</td></tr>';
        el.querySelector('#tab').innerHTML =
          '<tr><th>Подход</th><th>Сделок</th><th>Из них выходов по стопу</th><th>Итог, п.</th><th>Макс. просадка</th></tr>' +
          row('Обычный вход сразу на пробое', SIM, rBase) +
          row('Вход на развороте (Δz = ' + f(s4.reboundZ, 2) + 'σ)', ME, rRev);
      }
      draw();
    }
  });

  /* ---------- 5. Вход и выход частями («лесенка»): идея и ручной расчёт ---------- */
  const s5 = { e1: 1.7, e2: 2.6, stop: 3.5, peakCase: 0 };
  const SCALE_CASES = [
    { name: 'Лёгкий заход (до −1,85σ и возврат к 0)', peak: 1.85, rev: true },
    { name: 'Глубокий заход (до −2,90σ и возврат к 0)', peak: 2.90, rev: true },
    { name: 'Слом связи (уход на стоп −3,50σ)', peak: 3.50, rev: false }
  ];

  Z.push({
    id: 'scale-idea',
    title: 'Вход и выход частями («лесенка»): средняя цена и риск',
    lead: 'Никто заранее не знает, развернётся ли спред сразу у −1,8σ или сначала дотянется до −2,8σ. Разделение одного и того же объёма на два транша сглаживает ошибку точки входа — если не путать его с опасным мартингейлом!',
    text: () => `
      <h3>Честная «лесенка» внутри заранее заданного риска</h3>
      <p>Пусть наш максимальный допустимый объём на сделку — <b>2 контракта</b> (или 100% плановой позиции):</p>
      <ul>
        <li><b>Обычный вход «всё сразу»:</b> ставит оба контракта на одном пороге <b>2,0σ</b>. Если спред дошёл только до 1,85σ и вернулся — мы заработали 0. Если провалился до 2,8σ — оба контракта куплены рано, по худшей цене 2,0σ.</li>
        <li><b>${T('scaling_in', 'Лесенка из двух траншей')}:</b> первый ${T('tranche', 'транш')} (1 контракт, половина объёма) открывается чуть раньше — на <b>1,7σ</b>, а второй транш (второй контракт) добирается только при глубоком заходе на <b>2,6σ</b>. Средняя точка входа полной позиции получается <b>(1,7 + 2,6) ÷ 2 = 2,15σ</b> — выгоднее, чем 2,0σ!</li>
      </ul>
      <div class="note bad"><b>Критически важное отличие от ${T('averaging_down', 'мартингейла')}!</b> В правильной лесенке вы <i>делите пополам</i> заранее рассчитанный безопасный объём и держите жёсткий общий ${T('stop', 'стоп-лосс')} (например, 3,5σ). Бесконтрольное усреднение делает обратное: набирает всё новые контракты <i>сверх</i> лимита риска (1 + 2 + 4 + 8 лотов) и убирает стоп — один настоящий разрыв связи обнуляет такой счёт.</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Ручной расчёт на 3 жизненных сценариях (1σ спреда = 10 п. для круглого счёта)</h4>
          <div class="btns" id="cases" style="margin:0 0 10px"></div>
          <div id="sctl"></div>
          <table class="t" id="tab" style="margin-top:10px"></table>
          <div class="note" id="note" style="margin-top:10px"></div>
        </div>`;

      const casesEl = el.querySelector('#cases');
      casesEl.innerHTML = SCALE_CASES.map((c, i) => '<button class="b" data-i="' + i + '">' + c.name + '</button>').join('');
      casesEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s5.peakCase = +b.dataset.i; draw(); } });

      const ctl = el.querySelector('#sctl');
      HV.slider(ctl, { label: 'Первый транш (1 контракт)', min: 1.2, max: 2.0, step: 0.1, value: s5.e1, fmt: (v) => f(v, 1) + ' σ', onInput: (v) => { s5.e1 = v; if (s5.e2 <= v + 0.3) s5.e2 = +(v + 0.4).toFixed(1); draw(); } });
      HV.slider(ctl, { label: 'Второй транш (ещё 1 контракт)', min: 2.1, max: 3.2, step: 0.1, value: s5.e2, fmt: (v) => f(v, 1) + ' σ', onInput: (v) => { s5.e2 = v; draw(); } });

      function draw() {
        casesEl.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s5.peakCase));
        const cs = SCALE_CASES[s5.peakCase], sigPts = 10, stop = 3.5;

        // 1. Всё сразу (2 контр. на 2,0σ, стоп 3,5σ)
        let qAll = 0, pnlAll = 0, descAll = 'не дошёл до 2,0σ (входа нет)';
        if (cs.peak >= 2.0) {
          qAll = 2;
          pnlAll = cs.rev ? 2 * (2.0 * sigPts) : -2 * ((stop - 2.0) * sigPts);
          descAll = '2 контр. по −20 п. → ' + (cs.rev ? 'выход на 0' : 'стоп на −35 п.');
        }

        // 2. Лесенка (1 контр. на e1 + 1 контр. на e2, макс 2 контр., стоп 3,5σ)
        let qSc = 0, pnlSc = 0, parts = [];
        if (cs.peak >= s5.e1) {
          qSc += 1;
          pnlSc += cs.rev ? s5.e1 * sigPts : -((stop - s5.e1) * sigPts);
          parts.push('1 контр. по −' + f(s5.e1 * 10, 0) + ' п.');
        }
        if (cs.peak >= s5.e2) {
          qSc += 1;
          pnlSc += cs.rev ? s5.e2 * sigPts : -((stop - s5.e2) * sigPts);
          parts.push('+ 1 контр. по −' + f(s5.e2 * 10, 0) + ' п.');
        }
        const descSc = qSc === 0 ? 'входа нет' : parts.join(' ') + ' → ' + (cs.rev ? 'выход на 0' : 'стоп на −35 п.');

        // 3. Опасный мартингейл (2 контр. на 1,7σ + 4 контр. на 2,6σ + 8 контр. на 3,4σ без стопа, уход на 5,0σ при сломе)
        let qMart = 0, pnlMart = 0;
        if (cs.peak >= 1.7) { qMart += 2; pnlMart += cs.rev ? 2 * 17 : -2 * (50 - 17); }
        if (cs.peak >= 2.6) { qMart += 4; pnlMart += cs.rev ? 4 * 26 : -4 * (50 - 26); }
        if (!cs.rev) { qMart += 8; pnlMart += -8 * (50 - 34); }

        el.querySelector('#tab').innerHTML =
          '<tr><th>Способ управления объёмом</th><th>Макс. контрактов в сделке</th><th>Как набиралась позиция</th><th>Результат (до комиссий)</th></tr>' +
          '<tr><td>Сразу 2 контракта на −2,0σ</td><td>' + qAll + ' из 2</td><td>' + descAll + '</td><td>' + col(pnlAll, 1) + ' п.</td></tr>' +
          '<tr><td style="color:' + ME + '"><b>Честная лесенка (1 + 1 контр.)</b></td><td><b>' + qSc + ' из 2</b></td><td>' + descSc + '</td><td><b>' + col(pnlSc, 1) + ' п.</b></td></tr>' +
          '<tr><td style="color:' + BAD + '">Мартингейл без стопа (2 + 4 + 8 контр.)</td><td class="neg">' + qMart + ' (раздуто в 7 раз!)</td><td>удвоение против убытка; при сломе спред уходит к −50 п.</td><td>' + col(pnlMart, 1) + ' п.</td></tr>';

        const nEl = el.querySelector('#note');
        if (s5.peakCase === 0) {
          nEl.className = 'note';
          nEl.innerHTML = '<b>Лёгкий заход:</b> жёсткий вход на 2,0σ остался ни с чем (0 п.), а первый транш лесенки спокойно забрал половинный объём (' + col(pnlSc, 1) + ' п.).';
        } else if (s5.peakCase === 1) {
          nEl.className = 'note';
          nEl.innerHTML = '<b>Глубокий заход с возвратом:</b> оба подхода вошли на полные 2 контракта, но у лесенки лучше средняя точка входа (−' + f(((s5.e1 + s5.e2) / 2) * 10, 1) + ' п. против −20 п.), поэтому она заработала ' + col(pnlSc, 1) + ' п. против ' + col(pnlAll, 1) + ' п.';
        } else {
          nEl.className = 'note bad';
          nEl.innerHTML = '<b>Слом связи:</b> честная лесенка потеряла даже чуть меньше обычного входа (' + col(pnlSc, 1) + ' п. против ' + col(pnlAll, 1) + ' п.), потому что второй контракт был куплен ближе к стопу! А мартингейл без стопа получил катастрофу в <b>' + col(pnlMart, 0) + ' п.</b> — одну такую потерю не отбить десятком мелких плюсов.';
        }
      }
      draw();
    }
  });
})();
