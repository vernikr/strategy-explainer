/* Коинтеграция, экраны 1–4: случайное блуждание и «резинка», смысл устойчивой связи,
   идея теста Энгла — Грейнджера / Дики — Фуллера и порог −3,34, ручной расчёт на 6 днях (#27). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, HV = window.HV;
  const C = U.COLORS;
  const Z = (window.CSCREENS = window.CSCREENS || []);
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', GREY = '#8b95a7', VIO = '#c9b6ff';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const nz = (v) => {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    for (let d = 0; d <= 3; d++) if (Math.abs(v * Math.pow(10, d) - Math.round(v * Math.pow(10, d))) < 1e-9) return U.fmt(v, d);
    return U.fmt(v, 3);
  };
  const prereq = '<div class="note">Здесь предполагается, что вы уже знакомы с <a href="#zscore/1" style="color:var(--accent)">простым z-score</a> и с <a href="#hedge/2" style="color:var(--accent)">линейной регрессией из раздела «Динамический хедж»</a>.</div>';

  /* ---------- 1. Случайное блуждание и «резинка» ---------- */
  const s1 = { rev: 0, seedIdx: 0 };
  const FAN_SEEDS = [1, 2, 3, 5, 7, 11, 21];

  function makeSeries(seed, rev, n) {
    const r = E.mulberry32(seed * 13 + 5);
    let spare = null;
    const g = () => {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0; while (u === 0) u = r();
      const v = r(), m = Math.sqrt(-2 * Math.log(u));
      spare = m * Math.sin(2 * Math.PI * v);
      return m * Math.cos(2 * Math.PI * v);
    };
    const out = [];
    let x = 0;
    for (let t = 0; t < n; t++) {
      x = x - rev * x + 2.5 * g();
      out.push(E.round2(x));
    }
    return out;
  }

  Z.push({
    id: 'walk',
    title: 'Случайное блуждание и «резинка»',
    lead: 'Любая стратегия возврата к среднему верит в одно допущение: отклонившись, спред тянется обратно. Но многие ряды цен вообще не имеют «дома» — они блуждают случайно. Увидим разницу своими глазами.',
    text: () => `
      <h3>Два разных мира</h3>
      <p>Представьте игру с монеткой: орёл — шаг +1, решка — шаг −1. Если вы уже ушли на +20 шагов от старта, монетка об этом «не помнит»: шансы следующего шага по-прежнему 50 на 50. Такой ряд называют ${T('random_walk', 'случайным блужданием')}. У него нет постоянного уровня, к которому он обязан вернуться, а размах ухода со временем растёт.</p>
      <p>Противоположность ему — грузик на резинке: чем дальше он отошёл от нуля, тем сильнее резинка тянет его назад. Такой ряд называют ${T('stationary', 'стационарным')} (от латинского stationarius — «неподвижный, стоящий на месте»): сам ряд колеблется каждый день, но его центр и привычный коридор колебаний остаются на месте.</p>
      <h3>Вся разница — в одном числе</h3>
      <span class="formula">сегодня = вчера − s × вчера + случайный толчок<small>s — сила «резинки» (доля отклонения, которая гасится за один день)</small></span>
      <details class="quiz"><summary>Проверьте интуицию: что произойдёт со стаей путей справа при s = 0?</summary><p>При <code>s = 0</code> возвратная тяга полностью выключена: сколько бы ряд ни ушёл от нуля, назад его ничто не возвращает, и веер траекторий расползается всё шире пропорционально <code>√t</code>!</p></details>
      <ul>
        <li>При <b>s = 0</b> тяги назад нет: вчерашнее положение целиком переходит в сегодня. В статистике это называют ${T('unit_root', 'единичным корнем')} (множитель при вчерашнем значении равен 1). Прошлые толчки не затухают никогда.</li>
        <li>При <b>s = 0,20</b> резинка каждый день убирает пятую часть отклонения: веер историй собирается в аккуратный горизонтальный коридор вокруг нуля.</li>
      </ul>
      <h3>Почему z-score обманывается на блуждании</h3>
      <p>Посмотрите на нижний график справа при <b>s = 0</b>. Казалось бы, никакой резинки нет — откуда взяться сигналам? Но ${T('window', 'скользящее среднее')} просто ползёт вслед за уходящим рядом с опозданием. Ряд всегда то чуть обгоняет своё среднее за 30 дней, то отстаёт от него, и ${T('zscore', 'z-score')} исправно пересекает ±2, открывая сделки там, где возврата к среднему не существует в принципе.</p>
      <div class="note warn"><b>Вывод.</b> Сам z-score не умеет проверять, есть ли у спреда «резинка»: он слепо делит отклонение на разброс любого ряда. Прежде чем торговать пару, нужно проверить стационарность спреда отдельно.</div>
      ${prereq}`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Веер из 7 случайных историй по одним и тем же правилам</h4>
          <p class="cap">Яркая линия — выбранная история, тусклые — ещё шесть историй с другими случайными толчками. Подвигайте силу «резинки».</p>
          <div class="btns" style="margin:0 0 8px">
            <button class="b" id="b0">s = 0 (случайное блуждание)</button>
            <button class="b" id="b1">s = 0,05 (слабая резинка)</button>
            <button class="b" id="b2">s = 0,20 (упругая резинка)</button>
          </div>
          <div id="ctl"></div>
          <div id="c1"></div>
          <div class="note" id="fanread"></div>
        </div>
        <div class="viz">
          <h4>Что делает обычный z-score (N = 30) на выбранной истории</h4>
          <div class="btns" id="seeds" style="margin:0 0 8px"></div>
          <div class="legend"><span><i style="background:${ME}"></i>ряд</span><span><i style="background:${VIO}"></i>скользящее среднее (30 дней)</span><span><i class="dot" style="background:${C.up}"></i>▲ вход лонг</span><span><i class="dot" style="background:${C.down}"></i>▼ вход шорт</span></div>
          <div id="c2"></div>
          <div class="note" id="btread"></div>
        </div>`;
      const seedsEl = el.querySelector('#seeds');
      seedsEl.innerHTML = FAN_SEEDS.map((s, i) => '<button class="b" data-i="' + i + '">история ' + (i + 1) + '</button>').join('');
      seedsEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s1.seedIdx = +b.dataset.i; draw(); } });
      const sl = HV.slider(el.querySelector('#ctl'), {
        label: 'Сила «резинки» (s)', min: 0, max: 0.35, step: 0.05, value: s1.rev,
        fmt: (v) => (v === 0 ? '0 (резинки нет)' : f(v, 2) + ' (' + f(v * 100, 0) + '% в день)'),
        hint: '0 — чистое случайное блуждание; больше нуля — стационарный ряд с возвратом к нулю.',
        onInput: (v) => { s1.rev = v; draw(); }
      });
      el.querySelector('#b0').addEventListener('click', () => { s1.rev = 0; sl.set(0); draw(); });
      el.querySelector('#b1').addEventListener('click', () => { s1.rev = 0.05; sl.set(0.05); draw(); });
      el.querySelector('#b2').addEventListener('click', () => { s1.rev = 0.20; sl.set(0.20); draw(); });

      let fan = [], cur = [], bt = null;
      const c1 = A.mkChart(el.querySelector('#c1'), 210, { tip: (i) => '<b>День ' + (i + 1) + '</b><br>выбранная история: ' + f(cur[i]) });
      const c2 = A.mkChart(el.querySelector('#c2'), 195, { tip: (i) => '<b>День ' + (i + 1) + '</b><br>значение: ' + f(cur[i]) + (bt.mean[i] === null ? '' : '<br>среднее окна: ' + f(bt.mean[i]) + '<br>z-score: ' + f(bt.z[i])) });
      const range = (arr) => Math.max.apply(null, arr) - Math.min.apply(null, arr);

      function draw() {
        seedsEl.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s1.seedIdx));
        el.querySelector('#b0').classList.toggle('on', Math.abs(s1.rev) < 1e-9);
        el.querySelector('#b1').classList.toggle('on', Math.abs(s1.rev - 0.05) < 1e-9);
        el.querySelector('#b2').classList.toggle('on', Math.abs(s1.rev - 0.20) < 1e-9);
        fan = FAN_SEEDS.map((sd) => makeSeries(sd, s1.rev, 320));
        cur = fan[s1.seedIdx];
        const series = fan.map((arr, idx) => ({ data: arr, color: idx === s1.seedIdx ? ME : '#8b95a744', width: idx === s1.seedIdx ? 2.2 : 1.1 }));
        c1.render({ n: 320, series, hlines: [{ y: 0, color: '#ffffff33', dash: [4, 4] }] });
        const spread80 = Math.max.apply(null, fan.map((a) => Math.abs(a[79]))), spread320 = Math.max.apply(null, fan.map((a) => Math.abs(a[319])));
        el.querySelector('#fanread').innerHTML = s1.rev === 0
          ? 'При <b>s = 0</b> веер расползается: к 80-му дню крайняя из 7 историй ушла от нуля на <b>' + f(spread80, 1) + '</b> п., а к 320-му дню — на <b>' + f(spread320, 1) + '</b> п. Никакого общего коридора нет.'
          : 'При <b>s = ' + f(s1.rev, 2) + '</b> резинка держит веер около нуля: на 80-м дне крайняя история в <b>' + f(spread80, 1) + '</b> п. от нуля, на 320-м — в <b>' + f(spread320, 1) + '</b> п. Коридор перестал расширяться со временем.';

        bt = E.backtest(cur, A.btParams());
        c2.render({ n: 320, series: [{ data: bt.mean, color: VIO, width: 1.5 }, { data: cur, color: ME, width: 1.8 }], spans: A.positionSpans(bt), markers: A.tradeMarkers(bt, (i) => cur[i]) });
        const m = bt.metrics;
        const col = '<span class="' + (m.total >= 0 ? 'pos' : 'neg') + '">' + U.sgn(m.total, 1) + '</span>';
        el.querySelector('#btread').innerHTML = 'Размах выбранной истории: первые 80 дней — <b>' + f(range(cur.slice(0, 80)), 1) + '</b> п., все 320 дней — <b>' + f(range(cur), 1) + '</b> п. Стратегия z-score открыла <b>' + m.count + '</b> сделок, итог ' + col + ' п., макс. просадка <b>' + f(-m.maxDD, 1) + '</b> п.' +
          (s1.rev === 0 ? ' Даже если на отдельной случайной истории итог случайно вышел в плюс, в этих данных нет возврата к среднему — только слепая игра против блуждания.' : '');
      }
      draw();
    }
  });

  /* ---------- 2. Что значит устойчивая связь ---------- */
  const s2 = { tab: 0, seedIdx: 2 };
  const S2_SEEDS = [1, 3, 7, 11, 21];
  const S2_CASES = [
    { name: 'С поводком (коинтеграция)', opts: { beta: 1.6, reversion: 0.20, noise: 2.2 }, explain: 'Обе цены блуждают, но отклонение между A и 1,6·B привязано «поводком»: каждый разъезд стягивается обратно к нулю.' },
    { name: 'Шагают в ногу, поводка нет', opts: { beta: 1.6, reversion: 0, noise: 3.2 }, explain: 'Каждый день A и B чаще идут в одну сторону (высокая корреляция шагов и высокий R² цен!), но расхождение между ними никто назад не тянет — это случайное блуждание.' },
    { name: 'Два чужих блуждания', opts: { beta: 1.3, independent: true }, explain: 'Инструменты вообще никак не связаны друг с другом. Переключайте наборы данных: на некоторых R² цен случайно оказывается высоким — классическая ложная связь.' }
  ];

  Z.push({
    id: 'meaning',
    title: 'Что значит устойчивая связь',
    lead: 'Отдельные цены на бирже почти никогда не стоят у одного уровня — они блуждают. Чудо коинтеграции в том, что из двух блуждающих цен может сложиться стационарный спред.',
    text: () => `
      <h3>Хозяин и собака на поводке</h3>
      <p>В 1994 году экономист Майкл Мюррей предложил образ, ставший классическим: нетрезвый хозяин и его собака гуляют по парку. Путь хозяина (цена B) — ${T('random_walk', 'случайное блуждание')}: предсказать, у какой скамейки он окажется через час, нельзя. Путь собаки (цена A) по отдельности тоже блуждание.</p>
      <p>Но между ними натянут поводок! Как только пёс отбегает слишком далеко, поводок натягивается и возвращает их друг к другу. Каждая цена сама по себе нестационарна, зато расстояние между ними (спред <b>A − k·B</b>) ведёт себя как ${T('stationary', 'стационарный ряд')}. Это свойство двух рядов и называется ${T('cointegration', 'коинтеграцией')} («совместной связанностью»).</p>
      <h3>Откуда берётся «поводок» на рынке</h3>
      <p>В жизни поводок создаёт экономика, а не формула: две марки одной нефти (Brent и Urals), обыкновенная и привилегированная акции одной компании, сырьё и продукт его переработки, фьючерс и базовый актив. Если один ушёл слишком далеко от другого, участникам рынка становится выгодно покупать отставший и продавать убежавший.</p>
      <h3>Главная ловушка: корреляция — это ещё не поводок!</h3>
      <p>Новички часто отбирают пары по высокой ${T('correlation', 'корреляции')} или высокому ${T('r2', 'R²')}. Справа три вкладки показывают, почему это опасно:</p>
      <ul>
        <li><b>Высокий R² цен</b> легко возникает случайно у двух совершенно чужих блужданий, если оба случайно полгода шли вверх (${T('spurious', 'ложная связь')}, третья вкладка).</li>
        <li><b>Высокая корреляция дневных шагов</b> (вторая вкладка) означает лишь «сегодня шагнули в одну сторону». Но если мелкие ошибки между шагами никто не стягивает назад, разница <b>A − k·B</b> уплывает так же безостановочно, как монетка без памяти!</li>
        <li>Только при <b>коинтеграции</b> (первая вкладка) остаток регрессии зажат в устойчивом коридоре вокруг нуля.</li>
      </ul>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <div class="btns" id="tabs" style="margin:0 0 8px"></div>
          <div class="btns" id="seeds" style="margin:0 0 8px"></div>
          <p id="explain" style="margin:0 0 10px;color:var(--muted)"></p>
          <h4>Цены A и B (обе нестационарны — уходят куда угодно)</h4>
          <div class="legend"><span><i style="background:${C.a}"></i>инструмент A</span><span><i style="background:${C.b}"></i>инструмент B</span></div>
          <div id="c1"></div>
        </div>
        <div class="viz">
          <h4>Остаток регрессии e = A − c − k·B («длина поводка» вокруг нуля)</h4>
          <div id="c2"></div>
          <table class="t" id="tab" style="margin-top:12px"></table>
          <div class="note" id="verdict"></div>
        </div>`;
      const tabs = el.querySelector('#tabs'), seeds = el.querySelector('#seeds');
      tabs.innerHTML = S2_CASES.map((c, i) => '<button class="b" data-i="' + i + '">' + c.name + '</button>').join('');
      seeds.innerHTML = S2_SEEDS.map((s, i) => '<button class="b" data-i="' + i + '">набор ' + s + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s2.tab = +b.dataset.i; draw(); } });
      seeds.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s2.seedIdx = +b.dataset.i; draw(); } });

      let d, ct;
      const c1 = A.mkChart(el.querySelector('#c1'), 175, { tip: (i) => '<b>День ' + (i + 1) + '</b><br>A: ' + f(d.a[i]) + '<br>B: ' + f(d.b[i]) });
      const c2 = A.mkChart(el.querySelector('#c2'), 185, { tip: (i) => '<b>День ' + (i + 1) + '</b><br>остаток e: ' + f(ct.res[i]) });

      function draw() {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s2.tab));
        seeds.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s2.seedIdx));
        const cs = S2_CASES[s2.tab];
        el.querySelector('#explain').textContent = cs.explain;
        d = E.genPair(Object.assign({ seed: S2_SEEDS[s2.seedIdx] }, cs.opts));
        ct = E.cointTest(d.a, d.b);
        c1.render({ n: d.a.length, series: [{ data: d.a, color: C.a }, { data: d.b, color: C.b }] });
        c2.render({ n: d.a.length, series: [{ data: ct.res, color: ct.passed ? ME : SIM, width: 1.8 }], hlines: [{ y: 0, color: '#ffffff44', dash: [4, 4] }] });
        const rng = Math.max.apply(null, ct.res) - Math.min.apply(null, ct.res);
        el.querySelector('#tab').innerHTML =
          '<tr><th>Показатель</th><th>Значение</th><th>Что он на самом деле проверяет</th></tr>' +
          '<tr><td>R² цен (A и B)</td><td><b>' + f(ct.r2, 2) + '</b></td><td>Лежали ли точки вдоль одной прямой на этом куске истории (легко обманывается общим трендом)</td></tr>' +
          '<tr><td>Корреляция дневных шагов</td><td><b>' + f(ct.retR, 2) + '</b></td><td>Часто ли A и B шагают в одну сторону за один день (не проверяет возврат расхождения!)</td></tr>' +
          '<tr><td>Размах остатка за 320 дней</td><td><b>' + f(rng, 1) + ' п.</b></td><td>Насколько далеко «отбегала собака» на этой истории</td></tr>' +
          '<tr><td>τ-статистика (порог ' + f(ct.crit5, 2) + ')</td><td><b class="' + (ct.passed ? 'pos' : 'neg') + '">' + f(ct.tau, 2) + '</b></td><td>Есть ли статистически доказуемая «резинка» у остатка (должна быть левее ' + f(ct.crit5, 2) + ')</td></tr>';
        el.querySelector('#verdict').innerHTML = ct.passed
          ? '<span class="pill go">Коинтеграция подтверждена</span> τ = <b>' + f(ct.tau, 2) + '</b> левее порога ' + f(ct.crit5, 2) + '; оценка полувозврата T½ = <b>' + f(ct.halfLife, 1) + '</b> дн.' + (s2.tab !== 0 ? ' Обратите внимание: здесь в данных поводка не было, но этот конкретный случайный набор попал в редкие ~5% ложных срабатываний теста!' : '')
          : '<span class="pill stop">Коинтеграция не подтверждена</span> τ = <b>' + f(ct.tau, 2) + '</b> правее порога ' + f(ct.crit5, 2) + '. ' + (ct.r2 > 0.65 ? 'Заметьте: R² цен равен <b>' + f(ct.r2, 2) + '</b> — на глаз связь кажется крепкой, но тест видит, что остаток не притягивается к нулю!' : 'Остаток ведёт себя как случайное блуждание — торговать возврат к среднему опасно.');
      }
      draw();
    }
  });

  /* ---------- 3. Идея теста на стационарность и порог −3,34 ---------- */
  const s3 = { scn: 0, simLen: 120, cache: {} };
  const S3_CASES = [
    { name: 'С поводком (быстрый возврат)', opts: { beta: 1.6, reversion: 0.22, noise: 2.2 } },
    { name: 'Без поводка (блуждание)', opts: { beta: 1.6, reversion: 0, noise: 3.0 } },
    { name: 'Вялая резинка', opts: { beta: 1.6, reversion: 0.045, noise: 2.2 } }
  ];

  function nullDist(Tlen) {
    if (s3.cache[Tlen]) return s3.cache[Tlen];
    const taus = [];
    for (let i = 1; i <= 200; i++) {
      const p = E.genPair({ seed: i * 97 + 13, n: Tlen, independent: true, beta: 1.3 });
      const ct = E.cointTest(p.a, p.b);
      if (ct.tau !== null) taus.push(ct.tau);
    }
    taus.sort((a, b) => a - b);
    return (s3.cache[Tlen] = taus);
  }

  Z.push({
    id: 'idea',
    title: 'Идея теста на стационарность и порог −3,34',
    lead: 'Как превратить образ «резинки» в точную формулу? Весь знаменитый метод Энгла — Грейнджера состоит из двух обычных линейных регрессий — без единого интеграла.',
    text: () => `
      <h3>Два шага ${T('engle_granger', 'метода Энгла — Грейнджера')}</h3>
      <p><b>Шаг 1.</b> Проводим уже знакомую прямую <b>A ≈ c + k·B</b> и выписываем ${T('residual', 'остатки')}: <b>e<sub>t</sub> = A<sub>t</sub> − c − k·B<sub>t</sub></b>. Если пара коинтегрирована, эти остатки должны вести себя как грузик на резинке вокруг нуля.</p>
      <p><b>Шаг 2 (${T('dickey_fuller', 'тест Дики — Фуллера')}).</b> Для каждого дня сопоставим две величины: <b>где мы были вчера</b> (e<sub>t−1</sub>) и <b>куда шагнули сегодня</b> (Δe<sub>t</sub> = e<sub>t</sub> − e<sub>t−1</sub>, значок Δ читается «дельта» и означает просто «изменение за шаг»). В профессиональной литературе вы встретите аббревиатуру <b>ADF</b> (<i>Augmented Dickey–Fuller</i> — «расширенный» тест): буква <b>A</b> означает, что в правую часть регрессии добавляют ещё пару вчерашних шагов Δe<sub>t−1</sub>, чтобы очистить оценку от краткосрочной инерции (автокорреляции) стакана.</p>
      <ul>
        <li>Если резинка есть: вчера были высоко (+10) → сегодня шаг вниз (−2); вчера низко (−10) → сегодня шаг вверх (+2). На графике справа точки выстраиваются с <b>отрицательным наклоном b &lt; 0</b>.</li>
        <li>Если это блуждание: сегодняшний шаг не зависит от вчерашнего уровня → прямая почти горизонтальна (<b>b ≈ 0</b>).</li>
      </ul>
      <h3>Статистика τ («тау») и почему порог −3,34, а не −2</h3>
      <span class="formula">τ = b ÷ стандартная ошибка(b)<small>во сколько раз наклон возврата сильнее случайной погрешности</small></span>
      <p>В обычной статистике правило «двух ошибок» (τ ≤ −2) уже считается убедительным. Но если проверять им случайные пары, вы пропустите в торговлю гору мусора! Причины две:</p>
      <ol>
        <li>Даже чистое блуждание на конечном куске времени хоть пару раз разворачивается вокруг собственного среднего этого куска — поэтому его наклон b в среднем уже смещён в минус (около −1,5 ошибки).</li>
        <li>На первом шаге регрессия <i>специально подобрала k</i> так, чтобы максимально сжать остатки и сделать их как можно больше похожими на стационарные!</li>
      </ol>
      <p>Из-за этого двойного «подыгрывания» ${T('crit_value', 'критическое значение')} для уровня 5% сдвигается к <b>−3,34</b> (а на коротком окне к −3,40…−3,47): только левее этой отметки остаются редкие 5% случайных совпадений. Нижний блок справа проверяет это прямо на 200 пустых парах.</p>
      <h3>Бонус из того же наклона: ${T('reversion_half', 'период полувозврата T½')}</h3>
      <p>Если за день гасится доля |b| отклонения, от него остаётся множитель (1 + b). Через сколько дней останется ровно половина (0,5)? Решаем школьное уравнение (1 + b)<sup>T½</sup> = 0,5 логарифмом: <b>T½ = ln(0,5) ÷ ln(1 + b)</b>. При b = −0,20 получаем T½ ≈ 3,1 дня — быстрая рабочая «резинка».</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Шаг 2 вживую: сегодняшний шаг Δe против вчерашнего остатка e<sub>t−1</sub></h4>
          <div class="btns" id="tabs" style="margin:0 0 8px"></div>
          <p class="cap">По горизонтали — где остаток был вчера; по вертикали — насколько он изменился сегодня. Наклон вниз = тяга к нулю.</p>
          <div id="sc"></div>
          <div class="kpis" id="kpis"></div>
        </div>
        <div class="viz">
          <h4>Откуда берётся порог −3,34: живой опыт на 200 заведомо несвязанных парах</h4>
          <p class="cap">Генерируем 200 пар случайных блужданий без малейшей связи и считаем τ для каждой. Красные столбики — те самые ~5% пар, случайно пробивших порог.</p>
          <div id="ctl"></div>
          <div id="hist" style="margin-top:8px"></div>
          <div class="note" id="hread"></div>
        </div>`;
      el.querySelector('#sc').innerHTML = '<div class="chartbox"><canvas></canvas></div>';
      const scat = new HV.Scatter(el.querySelector('#sc canvas'), {
        height: 260,
        tip: (p) => '<b>Переход ко дню ' + p.day + '</b><br>вчера e<sub>t−1</sub>: ' + f(p.x) + '<br>шаг Δe<sub>t</sub>: ' + U.sgn(p.y, 2)
      });
      const tabs = el.querySelector('#tabs');
      tabs.innerHTML = S3_CASES.map((c, i) => '<button class="b" data-i="' + i + '">' + c.name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s3.scn = +b.dataset.i; drawTop(); } });

      function drawTop() {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s3.scn));
        const d = E.genPair(Object.assign({ seed: A.state.seed, n: 180 }, S3_CASES[s3.scn].opts));
        const ct = E.cointTest(d.a, d.b);
        const pts = [];
        for (let i = 1; i < ct.res.length; i++) pts.push({ x: ct.res[i - 1], y: ct.res[i] - ct.res[i - 1], day: i + 1 });
        scat.render({
          points: pts, pointColor: '#5aa9ffaa',
          lines: [{ k: 0, alpha: 0, color: '#ffffff33', width: 1, dash: [4, 4] }, { k: ct.b, alpha: ct.a, color: ct.passed ? ME : SIM, width: 2.4 }],
          xLabel: 'вчерашний остаток e(t−1)', yLabel: 'шаг сегодня Δe(t)'
        });
        const items = [
          [f(ct.b, 3), 'наклон возврата b', 'шаг на 1 пункт отклонения'],
          [f(ct.se, 3), 'ошибка наклона se(b)', 'случайный разброс оценки'],
          ['<span class="' + (ct.passed ? 'pos' : 'neg') + '">' + f(ct.tau, 2) + '</span>', 'τ = b ÷ se(b)', 'порог 5%: ' + f(ct.crit5, 2)],
          [ct.halfLife === null ? '∞ (нет)' : f(ct.halfLife, 1) + ' дн.', 'полувозврат T½', 'уменьшение вдвое'],
          [f(ct.r2, 2), 'R² цен (шаг 1)', 'для сравнения'],
          [ct.passed ? '<span class="pos">да</span>' : '<span class="neg">нет</span>', 'тест пройден?', 'на уровне 5%']
        ];
        el.querySelector('#kpis').innerHTML = items.map((x) => '<div class="kpi"><div class="v">' + x[0] + '</div><div class="l">' + x[1] + '</div><div class="e">' + x[2] + '</div></div>').join('');
      }

      HV.slider(el.querySelector('#ctl'), {
        label: 'Длина истории T для проверки 200 пустых пар', min: 40, max: 280, step: 40, value: s3.simLen,
        fmt: (v) => f(v, 0) + ' дн.',
        hint: 'Чем короче окно T, тем легче случайной паре притвориться связанной — поэтому порог сдвигается ещё левее.',
        onInput: (v) => { s3.simLen = v; drawHist(); }
      });

      function drawHist() {
        const taus = nullDist(s3.simLen);
        const crit = E.egCrit(s3.simLen, 5);
        const lo = -5.0, hi = 0.5, bins = 22, step = (hi - lo) / bins;
        const counts = new Array(bins).fill(0);
        taus.forEach((v) => { const k = Math.max(0, Math.min(bins - 1, Math.floor((v - lo) / step))); counts[k]++; });
        const mx = Math.max.apply(null, counts) || 1;
        const bars = counts.map((c, i) => {
          const mid = lo + (i + 0.5) * step;
          const isLeft = mid <= crit;
          const h = Math.round((c / mx) * 110);
          return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:132px" title="τ около ' + f(mid, 2) + ': ' + c + ' пар из 200">' +
            '<div style="font-size:10px;color:var(--muted);margin-bottom:2px">' + (c || '') + '</div>' +
            '<div style="width:82%;height:' + Math.max(c ? 3 : 0, h) + 'px;background:' + (isLeft ? BAD : 'var(--line-strong)') + ';border-radius:3px 3px 0 0"></div>' +
            '<div style="font-size:10px;color:var(--muted);margin-top:4px">' + (i % 4 === 0 ? f(lo + i * step, 1) : '') + '</div></div>';
        }).join('');
        el.querySelector('#hist').innerHTML = '<div style="display:flex;align-items:flex-end;border-bottom:1px solid var(--line);padding:4px 4px 0">' + bars + '</div>';
        const meanTau = taus.reduce((a, b) => a + b, 0) / taus.length;
        const naiveFake = taus.filter((v) => v <= -2).length;
        const egFake = taus.filter((v) => v <= crit).length;
        el.querySelector('#hread').innerHTML = 'При T = <b>' + s3.simLen + '</b> дн. средний τ у абсолютно несвязанных пар равен <b>' + f(meanTau, 2) + '</b> (далеко не ноль!). Наивный порог «−2 ошибки» принял бы за коинтеграцию <b>' + naiveFake + ' из 200</b> пустышек (' + f(naiveFake / 2, 0) + '%). Строгий порог Энгла — Грейнджера <b>' + f(crit, 2) + '</b> пропустил лишь <b>' + egFake + ' из 200</b> (' + f(egFake / 2, 1) + '% — те самые ~5% ' + T('false_positive', 'ложных срабатываний') + ').';
      }

      drawTop();
      drawHist();
    }
  });

  /* ---------- 4. Как проверить пару вручную ---------- */
  const PRESETS = [
    { name: 'Круглые числа (разбор)', b: [104, 101, 103, 103, 102, 105], a: [260, 253, 254, 255, 254, 260] },
    { name: 'Блуждание без возврата', b: [100, 102, 101, 103, 104, 102], a: [200, 205, 206, 212, 217, 216] },
    { name: 'Жёсткая пружина', b: [101, 104, 102, 105, 103, 103], a: [255, 258, 257, 259, 256, 256] }
  ];
  const s4 = { b: PRESETS[0].b.slice(), a: PRESETS[0].a.slice() };

  Z.push({
    id: 'manual',
    title: 'Как проверить пару вручную',
    lead: 'Проверим весь метод Энгла — Грейнджера на шести днях с калькулятором. В первом примере числа подобраны так, чтобы каждое промежуточное действие давало точный ответ без бесконечных дробей.',
    wide: true,
    text: () => `
      <h3>Шесть формул — и никакой магии</h3>
      <p>Пусть даны цены B и A за N = 6 дней. Проверка идёт в два этапа.</p>
      <h3>Этап 1. Находим поводок (регрессия A на B)</h3>
      <span class="formula">k = Σ(B − B̄)(A − Ā) ÷ Σ(B − B̄)², &nbsp; c = Ā − k · B̄<small>в примере по умолчанию: B̄ = 103, Ā = 256, k = 20 ÷ 10 = 2, c = 256 − 2·103 = 50</small></span>
      <p>Вычитаем прямую из фактических цен A и получаем ${T('residual', 'остатки')}: <b>e<sub>t</sub> = A<sub>t</sub> − (c + k·B<sub>t</sub>)</b>. Для примера по умолчанию это ряд <b>[2, 1, −2, −1, 0, 0]</b>. Его сумма всегда равна нулю.</p>
      <h3>Этап 2. Проверяем остатки на возврат к нулю</h3>
      <p>Из 6 остатков получается M = 5 переходов со вчера на сегодня (дни со 2-го по 6-й). Обозначим вчерашний остаток через <b>x = e<sub>t−1</sub></b>, а сегодняшний шаг через <b>y = e<sub>t</sub> − e<sub>t−1</sub></b> и проведём прямую <b>y ≈ a + b·x</b> той же самой формулой наименьших квадратов:</p>
      <span class="formula">b = Σ(x − x̄)(y − ȳ) ÷ Σ(x − x̄)², &nbsp; a = ȳ − b · x̄<small>в примере: x = [2, 1, −2, −1, 0], x̄ = 0; y = [−1, −3, +1, +1, 0], ȳ = −0,4; b = −8 ÷ 10 = −0,8</small></span>
      <p>Считаем ошибки предсказания шага (y − a − b·x), возводим в квадрат и складываем в сумму <b>RSS</b> (в примере 4,8). Отсюда ${T('stderr', 'стандартная ошибка')} наклона b и ${T('tau_stat', 'τ-статистика')}:</p>
      <span class="formula">se(b) = √( RSS ÷ (M − 2) ÷ Σ(x − x̄)² ), &nbsp; τ = b ÷ se(b)<small>в примере: se(b) = √(4,8 ÷ 3 ÷ 10) = √0,16 = 0,4; &nbsp; τ = −0,8 ÷ 0,4 = −2,0</small></span>
      <div class="note warn"><b>Поучительный момент!</b> В примере резинка очень сильная — каждый шаг убирает 80% отклонения (b = −0,8, полувозврат T½ ≈ 0,43 дня). Но τ = −2,0 всё равно <i>не пробивает</i> порог Энгла — Грейнджера для 6 точек (−4,02)! Почему? Пяти переходов слишком мало, чтобы отличить настоящую пружину от случайности: в знаменателе стоит всего M − 2 = 3 степени свободы. Формулу удобно проверять на 6 днях, а на рынке для теста берут окно в 80–150 дней.</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Цены B и A за 6 дней (можно менять любое число)</h4>
          <div class="btns" id="pr" style="margin:0 0 10px"></div>
          <table class="t" id="inpt"></table>
        </div>
        <div class="viz">
          <h4>Пять переходов остатка: вчерашний уровень x и шаг y = Δe</h4>
          <table class="t" id="trant"></table>
        </div>
        <div class="viz calc-steps" id="steps"></div>
        <div class="viz">
          <h4>График шага Δe против вчерашнего остатка e<sub>t−1</sub></h4>
          <div id="sc"></div>
        </div>`;
      const pr = el.querySelector('#pr');
      pr.innerHTML = PRESETS.map((p, i) => '<button class="b" data-i="' + i + '">' + p.name + '</button>').join('');
      pr.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        const p = PRESETS[+b.dataset.i];
        s4.b = p.b.slice(); s4.a = p.a.slice();
        buildInputs(); draw();
      });
      el.querySelector('#sc').innerHTML = '<div class="chartbox"><canvas></canvas></div>';
      const scat = new HV.Scatter(el.querySelector('#sc canvas'), { height: 220, tip: (p) => '<b>Переход ' + p.idx + ' → ' + (p.idx + 1) + '</b><br>вчера x: ' + nz(p.x) + '<br>шаг y: ' + nz(p.y) });

      function buildInputs() {
        el.querySelector('#inpt').innerHTML =
          '<tr><th>День t</th>' + s4.b.map((_, i) => '<th>' + (i + 1) + '</th>').join('') + '<th>Среднее</th></tr>' +
          '<tr><td>Цена B</td>' + s4.b.map((v, i) => '<td><input type="number" step="1" data-r="b" data-i="' + i + '" value="' + v + '" style="width:72px;text-align:right"></td>').join('') + '<td id="mb"></td></tr>' +
          '<tr><td>Цена A</td>' + s4.a.map((v, i) => '<td><input type="number" step="1" data-r="a" data-i="' + i + '" value="' + v + '" style="width:72px;text-align:right"></td>').join('') + '<td id="ma"></td></tr>' +
          '<tr><td>Остаток e<sub>t</sub></td>' + s4.b.map((_, i) => '<td id="re' + i + '"></td>').join('') + '<td id="me"></td></tr>';
        el.querySelector('#inpt').querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => {
          const v = parseFloat(inp.value);
          s4[inp.dataset.r][+inp.dataset.i] = v;
          draw();
        }));
      }

      const row = (k, title, text, val) => '<div class="row"><div class="n">' + k + '</div><div><b>' + title + '</b><div style="color:var(--muted);font-size:14px">' + text + '</div>' + (val ? '<div class="v">' + val + '</div>' : '') + '</div></div>';

      function draw() {
        if (s4.b.some(Number.isNaN) || s4.a.some(Number.isNaN)) {
          el.querySelector('#steps').innerHTML = '<div class="note warn">Заполните все 12 ячеек числами.</div>';
          return;
        }
        const ex = E.explainCoint(s4.a, s4.b, 6, 0, 5);
        if (!ex || ex.coint.k === null) {
          el.querySelector('#steps').innerHTML = '<div class="note warn">Все значения B одинаковы: прямую A ≈ c + k·B провести нельзя. Измените хотя бы одну цену B.</div>';
          return;
        }
        const ct = ex.coint;
        el.querySelector('#mb').textContent = nz(E.ols(s4.b, s4.a).mx);
        el.querySelector('#ma').textContent = nz(E.ols(s4.b, s4.a).my);
        ct.res.forEach((v, i) => { el.querySelector('#re' + i).textContent = nz(Math.abs(v) < 1e-9 ? 0 : v); });
        el.querySelector('#me').textContent = '0';

        el.querySelector('#trant').innerHTML =
          '<tr><th>Переход</th><th>вчера x = e<sub>t−1</sub></th><th>сегодня e<sub>t</sub></th><th>шаг y = Δe<sub>t</sub></th><th>(x − x̄)²</th><th>(x − x̄)(y − ȳ)</th><th>ошибка²</th></tr>' +
          ex.steps.map((r, j) => '<tr><td>' + (j + 1) + ' → ' + (j + 2) + '</td><td>' + nz(r.prev) + '</td><td>' + nz(r.cur) + '</td><td>' + U.sgn(r.step, 2) + '</td><td>' + nz(r.dxx) + '</td><td>' + nz(r.dxy) + '</td><td>' + (r.err === null ? '—' : nz(r.err * r.err)) + '</td></tr>').join('') +
          '<tr><td><b>Сумма / среднее</b></td><td><b>x̄ = ' + nz(ct.mx) + '</b></td><td></td><td><b>ȳ = ' + nz(ct.my) + '</b></td><td><b>Σ = ' + nz(ct.sxx) + '</b></td><td><b>Σ = ' + nz(ct.sxy) + '</b></td><td><b>RSS = ' + (ct.rss === null ? '—' : nz(ct.rss)) + '</b></td></tr>';

        if (ct.b === null) {
          el.querySelector('#steps').innerHTML = '<div class="note warn">Все остатки одинаковы (равны нулю): точки легли на прямую без отклонений, проверять возврат не на чем.</div>';
          scat.render({ points: ex.steps.map((r, j) => ({ x: r.prev, y: r.step, idx: j + 1 })), lines: [] });
          return;
        }
        const hlTxt = ct.halfLife === null ? 'b ≥ 0: ряд не сжимается к нулю, полувозврата нет' : (ct.halfLife === 0 ? 'b ≤ −1: отклонение переворачивается быстрее чем за 1 день' : 'T½ = ln(0,5) ÷ ln(1 + (' + nz(ct.b) + ')) = ' + f(ct.halfLife, 2) + ' дн.');
        const tauTxt = ct.tau === null ? 'ошибка se(b) = 0: все шаги легли ровно на прямую' : 'τ = ' + nz(ct.b) + ' ÷ ' + nz(ct.se) + ' = ' + nz(ct.tau) + ' (порог 5% для 6 точек: ' + f(ct.crit5, 2) + ' → ' + (ct.passed ? 'пройден' : 'не пройден') + ')';
        el.querySelector('#steps').innerHTML =
          row(1, 'Прямая первого шага', 'Наклон k и сдвиг c по 6 дням.', 'k = ' + nz(ct.k) + ',  c = ' + nz(ct.alpha) + '  (R² = ' + nz(ct.r2) + ')') +
          row(2, 'Наклон возврата b', 'Делим сумму произведений на сумму квадратов вчерашних отклонений.', 'b = ' + nz(ct.sxy) + ' ÷ ' + nz(ct.sxx) + ' = ' + nz(ct.b) + ',  a = ' + nz(ct.a)) +
          row(3, 'Стандартная ошибка se(b)', 'M = 5 переходов → делим RSS на (5 − 2) = 3 и на Σ(x − x̄)².', ct.se === null ? '—' : 'se(b) = √(' + nz(ct.rss) + ' ÷ 3 ÷ ' + nz(ct.sxx) + ') = ' + nz(ct.se)) +
          row(4, 'Статистика τ и вердикт', 'Во сколько раз наклон b больше своей ошибки.', tauTxt) +
          row(5, 'Период полувозврата T½', 'Через сколько дней отклонение уменьшается вдвое.', hlTxt);

        scat.render({
          points: ex.steps.map((r, j) => ({ x: r.prev, y: r.step, idx: j + 1, hot: j === 4 })),
          lines: [{ k: 0, alpha: 0, color: '#ffffff33', width: 1, dash: [4, 4] }, { k: ct.b, alpha: ct.a, color: ct.b < 0 ? ME : BAD, width: 2.2 }],
          residualsOf: { k: ct.b, alpha: ct.a, color: '#ff6b6b88' },
          xLabel: 'вчера x = e(t−1)', yLabel: 'шаг y = Δe(t)'
        });
      }

      buildInputs();
      draw();
    }
  });
})();
