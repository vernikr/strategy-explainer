/* Динамический хедж, экраны 1–4: зачем нужен коэффициент, регрессия простыми словами,
   ручной расчёт k, как k меняется во времени. */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, S = window.SPECS, HV = window.HV;
  const C = U.COLORS;
  const Z = (window.HSCREENS = window.HSCREENS || []);
  const SC = E.HEDGE_SCENARIOS;
  const ME = '#7ee0b5', BEST = '#c9b6ff', BAD = '#ff6b6b', GREY = '#8b95a7';
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  // число без лишних нулей: 1,4 вместо 1,400; до трёх знаков
  const nz = (v) => { if (v === null || v === undefined || Number.isNaN(v)) return '—'; for (let d = 0; d <= 3; d++) if (Math.abs(v * Math.pow(10, d) - Math.round(v * Math.pow(10, d))) < 1e-9) return U.fmt(v, d); return U.fmt(v, 3); };
  const gen = (i, seed) => E.genHedge(seed === undefined ? A.state.seed : seed, SC[i]);
  const prereq = '<div class="note">Если слова «спред», «среднее», «σ» и «z-score» вам не знакомы, сначала прочитайте <a href="#zscore/1" style="color:var(--accent)">разбор простого z-score</a>: здесь он считается известным.</div>';

  /* ---------- 1. Зачем нужен коэффициент хеджирования ---------- */
  const s1 = { scn: 1, k: 1, shock: 10 };

  Z.push({
    id: 'why',
    title: 'Зачем нужен коэффициент хеджирования',
    lead: 'Простой спред A − B предполагает, что на каждый контракт A нужен ровно один контракт B. Если инструменты двигаются в разной степени, спред получает «чужой» тренд, и стратегия начинает ошибаться. Увидим это своими глазами.',
    text: () => `
      <h3>Что такое хеджирование</h3>
      <p>${T('hedge', 'Хеджирование')} (от английского hedge — «живая изгородь», «ограда») — это сделка, которую совершают не ради заработка, а чтобы погасить риск другой сделки. В спреде одна нога страхует другую. Наш риск — общее движение рынка: если фьючерсы дорожают или дешевеют все вместе, мы не хотим ни выигрывать, ни проигрывать на этом. Мы хотим зарабатывать только на изменении <i>разницы</i> между A и B. Такую позицию называют ${T('market_neutral', 'нейтральной к рынку')}.</p>
      <h3>Откуда берётся проблема</h3>
      <p>В простом спреде A − B на один контракт A приходится один контракт B: ${T('hedge_ratio', 'коэффициент хеджирования')} равен 1. Это верно, только если инструменты двигаются «в унисон»: на сколько пунктов вырос B, на столько же вырос A. На деле один инструмент часто «размашистее» другого. Допустим, при общем движении рынка B меняется на 10 пунктов, а A на 16. Тогда A размашистее B в 1,6 раза. Это число называют ${T('beta', 'β («бета»)')}.</p>
      <h3>Пример с числами</h3>
      <p>Купили 1 контракт A и продали 1 контракт B. Рынок вырос: A +16, B +10. По A мы заработали 16, по B потеряли 10, итого <b>+6</b>, хотя мы ничего не предсказывали. Рынок упадёт на 10, и будет −6. Этот «подарок» или «штраф» от рынка спрятан в спреде.</p>
      <p>Теперь продадим не 1, а 1,6 контракта B. По A +16, по B −16, итого <b>0</b>. Рынок больше не влияет. Число 1,6 и есть правильный коэффициент хеджирования.</p>
      <h3>Что это делает с z-score</h3>
      <p>Спред A − B теперь содержит добавку: (β − 1) × движение рынка. Рынок бродит вверх и вниз, и спред бродит вместе с ним вместо того, чтобы колебаться вокруг одного уровня. Стратегия z-score ждёт возврата к среднему и видит «необычное» отклонение там, где просто пошёл рынок. Она входит против движения, которое не собирается разворачиваться. Посмотрите на график справа: спред при k = 1 уезжает.</p>
      <h3>Выход: спред A − k·B</h3>
      <p>Спред строят как <b>A − k·B</b>, подбирая k так, чтобы общее движение рынка гасилось. Подвигайте k справа: при k = 1 спред уезжает, а при k около 1,6 колеблется возле одного уровня, как мы и хотим. Слово «динамический» значит, что k не выбирают раз и навсегда, а пересчитывают по свежим данным. Как подобрать k, объясняют следующие экраны.</p>
      <div class="note warn"><b>Честная оговорка.</b> Если инструменты и так двигаются 1 к 1 (второй сценарий справа), всё это лишнее: k = 1 уже верен, а подбор k добавляет шум в расчёты. Хедж нужен там, где β заметно отличается от 1. Сравнение на экране 8.</div>
      ${prereq}`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><div class="btns" id="tabs" style="margin:0 0 10px"></div><p id="snote" style="margin:0 0 10px;color:var(--muted)"></p>
          <h4>Цены A и B</h4><div class="legend"><span><i style="background:${C.a}"></i>инструмент A</span><span><i style="background:${C.b}"></i>инструмент B</span></div><div id="c1"></div></div>
        <div class="viz"><h4>Спред A − k·B: подберите k</h4><p class="cap">Серая линия — простой спред A − B (k = 1). Зелёная — спред с выбранным k.</p>
          <div class="legend"><span><i style="background:${GREY}"></i>A − B</span><span><i style="background:${ME}"></i>A − k·B</span></div><div id="c2"></div><div id="ctl"></div><div class="note" id="read"></div></div>
        <div class="viz"><h4>Что делает рынок с позицией «купить A, продать k·B»</h4><p class="cap">Рынок сдвинулся, и мы ничего не предсказывали. Сколько позиция заработала или потеряла сама по себе?</p>
          <div id="ctl2"></div><table class="t" id="shock"></table><div class="note" id="read2"></div></div>`;
      const tabs = el.querySelector('#tabs');
      const scn = [0, 1];
      tabs.innerHTML = scn.map((i) => '<button class="b" data-i="' + i + '">' + SC[i].name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s1.scn = +b.dataset.i; draw(); } });
      let d;
      const c1 = A.mkChart(el.querySelector('#c1'), 170, { tip: (i) => '<b>День ' + (i + 1) + '</b><br>A: ' + f(d.a[i]) + '<br>B: ' + f(d.b[i]) });
      const c2 = A.mkChart(el.querySelector('#c2'), 200, { tip: (i) => '<b>День ' + (i + 1) + '</b><br>A − B: ' + f(d.a[i] - d.b[i]) + '<br>A − ' + nz(s1.k) + '·B: ' + f(d.a[i] - s1.k * d.b[i]) });
      const sk = HV.slider(el.querySelector('#ctl'), { label: 'Коэффициент k', min: 0, max: 2.5, step: 0.05, value: s1.k, fmt: (v) => f(v), hint: 'Сколько контрактов B приходится на один контракт A.', onInput: (v) => { s1.k = v; draw(); } });
      const sm = HV.slider(el.querySelector('#ctl2'), { label: 'Рынок сдвинулся на (пунктов B)', min: -30, max: 30, step: 1, value: s1.shock, fmt: (v) => (v > 0 ? '+' : '') + f(v, 0), hint: 'B изменился на столько пунктов; A — в β раз сильнее.', onInput: (v) => { s1.shock = v; draw(); } });
      const range = (x) => Math.max.apply(null, x) - Math.min.apply(null, x);
      function draw() {
        tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.i === s1.scn));
        el.querySelector('#snote').textContent = SC[s1.scn].note;
        d = gen(s1.scn);
        const beta = SC[s1.scn].opts.beta, k = s1.k;
        c1.render({ n: d.a.length, series: [{ data: d.a, color: C.a }, { data: d.b, color: C.b }] });
        const plain = d.a.map((v, i) => v - d.b[i]), mine = d.a.map((v, i) => v - k * d.b[i]);
        c2.render({ n: d.a.length, series: [{ data: plain, color: GREY, width: 1.4 }, { data: mine, color: ME, width: 2 }] });
        const best = E.ols(d.b, d.a).k;
        el.querySelector('#read').innerHTML = 'Размах спреда за весь период (наибольшее минус наименьшее): при k = 1 — <b>' + f(range(plain), 1) + '</b> пунктов, при k = ' + f(k) + ' — <b>' + f(range(mine), 1) + '</b>. Чем он меньше, тем ближе спред к «резинке» вокруг одного уровня. Для сравнения: регрессия по всему периоду (экраны 2–3) даёт k = <b>' + f(best) + '</b>; в этих данных настоящее β = ' + f(beta) + '.';
        const dA = beta * s1.shock, dB = s1.shock;
        el.querySelector('#shock').innerHTML = '<tr><th>Позиция</th><th>результат по A (купили)</th><th>результат по B (продали)</th><th>итог от движения рынка</th></tr>' +
          '<tr><td>1 контракт A против 1 контракта B (k = 1)</td><td>' + U.sgn(dA, 1) + '</td><td>' + U.sgn(-dB, 1) + '</td><td><b class="' + (dA - dB >= -1e-9 ? 'pos' : 'neg') + '">' + U.sgn(dA - dB, 1) + '</b></td></tr>' +
          '<tr><td>1 контракт A против ' + f(k) + ' контракта B (ваше k)</td><td>' + U.sgn(dA, 1) + '</td><td>' + U.sgn(-k * dB, 1) + '</td><td><b class="' + (Math.abs(dA - k * dB) < 1e-9 ? '' : dA - k * dB > 0 ? 'pos' : 'neg') + '">' + U.sgn(dA - k * dB, 1) + '</b></td></tr>';
        el.querySelector('#read2').innerHTML = Math.abs(dA - k * dB) < 0.05 ? 'При k = ' + f(k) + ' рынок почти не влияет на позицию: нейтральность достигнута.' : 'При k = ' + f(k) + ' остаётся «перекос» ' + U.sgn(dA - k * dB, 1) + ' пунктов от движения рынка: в этом сценарии β = ' + f(beta) + ', нейтральным было бы k = ' + f(beta) + '.';
        sk.set(k); sm.set(s1.shock);
      }
      draw();
    }
  });

  /* ---------- 2. Линейная регрессия простыми словами ---------- */
  const s2 = { day: 170, n: 25, k: 1, shift: 0, showBest: false };

  Z.push({
    id: 'regression',
    title: 'Линейная регрессия простыми словами',
    lead: 'Регрессия — это способ провести через облако точек «самую подходящую» прямую. Наклон этой прямой и есть искомый коэффициент k. Поймём идею, попробуем найти прямую руками и сравним с лучшей.',
    text: () => `
      <h3>Облако точек</h3>
      <p>Возьмём последние N дней. Каждый день — одна точка: по горизонтали цена B, по вертикали цена A в тот же день. Такой график называют ${T('scatter', 'диаграммой рассеяния')}. Если A двигается вместе с B, точки выстраиваются вдоль наклонной полосы: чем дороже B, тем дороже A.</p>
      <h3>Прямая через облако (${T('regression', 'линейная регрессия')})</h3>
      <p>Через облако можно провести прямую, которая описывает «типичную» связь: <b>A ≈ c + k·B</b>. Это школьное уравнение прямой в других буквах.</p>
      <ul>
        <li>${T('slope', 'Наклон k')}: на сколько пунктов вверх идёт прямая, когда B растёт на 1. Если k = 1,6, то при росте B на 10 пунктов A в среднем растёт на 16. <b>Это и есть коэффициент хеджирования</b>: столько контрактов B нужно на один контракт A, чтобы движение рынка гасилось.</li>
        <li>${T('intercept', 'Сдвиг c')}: на каком уровне прямая «висит», насколько её нужно поднять или опустить. Для хеджа он сам по себе не нужен, но входит в расчёт.</li>
      </ul>
      <h3>Остаток</h3>
      <p>Точки не лежат ровно на прямой: цены шумят. Вертикальное расстояние от точки до прямой называют ${T('residual', 'остатком')}: это на сколько фактическая цена A отличается от цены, которую «предсказывает» прямая при данной цене B. Красные отрезки на графике — остатки.</p>
      <p><b>Остаток — это и есть наш спред</b> (за вычетом постоянного уровня c): A − k·B − c. Он показывает, насколько A сегодня дороже или дешевле, чем должно быть при текущем B. Именно его мы будем мерить z-score.</p>
      <h3>Какая прямая «лучшая»</h3>
      <p>Прямых можно провести бесконечно много. ${T('least_squares', 'Метод наименьших квадратов')} выбирает ту, у которой наименьшая <b>сумма квадратов остатков</b>. Квадраты нужны по двум причинам: плюсы и минусы не должны гасить друг друга, а крупный промах должен «стоить» дороже мелких (промах в 3 пункта даёт 9, а не 3).</p>
      <p>Справа вы можете сами повернуть прямую и сдвинуть её вверх или вниз. Следите за суммой квадратов: пока вы не нашли лучшую прямую, она больше. У лучшей прямой есть важное свойство: <b>она всегда проходит через «центр облака»</b> (средняя цена B, средняя цена A), поэтому оптимальный сдвиг равен нулю.</p>
      <div class="note warn"><b>Окно.</b> Регрессию считают по скользящему окну из N последних дней, так же как среднее в z-score. Подвигайте день и длину окна: прямая немного меняется, значит, меняется и k. Об этом экран 4.</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><h4>Облако точек: цена B (по горизонтали) и цена A (по вертикали)</h4><p class="cap">Жёлтая точка — последний день окна. Красные отрезки — остатки вашей прямой.</p>
          <div class="legend"><span><i class="dot" style="background:${C.a}"></i>день окна</span><span><i style="background:${ME}"></i>ваша прямая</span><span><i style="background:${BEST}"></i>лучшая прямая (по методу наименьших квадратов)</span></div>
          <div id="sc"></div><div id="ctl"></div>
          <div class="btns"><button class="b" id="bBest">Подставить лучшую прямую</button><label style="display:flex;gap:8px;align-items:center;font-size:14px;color:var(--muted);margin-left:8px"><input type="checkbox" id="chk"> показать лучшую прямую на графике</label></div>
          <div class="note" id="read"></div></div>
        <div class="viz"><h4>Выбор окна</h4><div id="ctl2"></div></div>`;
      el.querySelector('#sc').innerHTML = '<div class="chartbox"><canvas></canvas></div>';
      const chart = new HV.Scatter(el.querySelector('#sc canvas'), { height: 340, tip: (p) => '<b>День ' + (p.idx + 1) + '</b><br>B: ' + f(p.x) + '<br>A: ' + f(p.y) });
      const d = gen(1);
      let fit;
      const sKs = HV.slider(el.querySelector('#ctl'), { label: 'Наклон k вашей прямой', min: 0, max: 3, step: 0.01, value: s2.k, fmt: (v) => f(v), hint: 'Поверните прямую.', onInput: (v) => { s2.k = v; draw(); } });
      const sSh = HV.slider(el.querySelector('#ctl'), { label: 'Сдвиг вверх или вниз, пунктов', min: -40, max: 40, step: 0.5, value: s2.shift, fmt: (v) => (v > 0 ? '+' : '') + f(v, 1), hint: '0 — прямая проходит через центр облака.', onInput: (v) => { s2.shift = v; draw(); } });
      const sD = HV.slider(el.querySelector('#ctl2'), { label: 'Последний день окна', min: 30, max: d.a.length, step: 1, value: s2.day, fmt: (v) => 'день ' + f(v, 0), onInput: (v) => { s2.day = v; draw(); } });
      const sN = HV.slider(el.querySelector('#ctl2'), { label: 'Длина окна N, дней', min: 10, max: 60, step: 1, value: s2.n, fmt: (v) => f(v, 0), hint: 'Сколько последних дней берём в облако.', onInput: (v) => { s2.n = v; draw(); } });
      el.querySelector('#chk').addEventListener('change', (ev) => { s2.showBest = ev.target.checked; draw(); });
      el.querySelector('#bBest').addEventListener('click', () => { s2.k = Math.round(fit.k * 100) / 100; s2.shift = 0; draw(); });
      function draw() {
        const t = s2.day - 1, n = s2.n, lo = t - n + 1;
        const wa = d.a.slice(lo, t + 1), wb = d.b.slice(lo, t + 1);
        fit = E.ols(wb, wa);
        const cu = fit.my + s2.shift - s2.k * fit.mx;
        let sse = 0;
        wa.forEach((y, i) => { const r = y - cu - s2.k * wb[i]; sse += r * r; });
        const lines = [{ k: s2.k, alpha: cu, color: ME, width: 2.4 }];
        if (s2.showBest) lines.push({ k: fit.k, alpha: fit.alpha, color: BEST, dash: [6, 5], width: 2 });
        chart.render({ points: wa.map((y, i) => ({ x: wb[i], y, idx: lo + i, hot: i === n - 1 })), lines, residualsOf: { k: s2.k, alpha: cu, color: '#ff6b6b88' }, xLabel: 'цена B', yLabel: 'цена A' });
        sKs.set(s2.k); sSh.set(s2.shift); sD.set(s2.day); sN.set(s2.n);
        el.querySelector('#chk').checked = s2.showBest;
        const worse = (sse / fit.rss - 1) * 100;
        el.querySelector('#read').innerHTML = 'Ваша прямая: k = <b>' + f(s2.k) + '</b>, сдвиг c = <b>' + f(cu, 1) + '</b>. Сумма квадратов остатков: <b>' + f(sse, 1) + '</b>.' +
          (s2.showBest ? ' У лучшей прямой: k = <b>' + f(fit.k) + '</b>, c = <b>' + f(fit.alpha, 1) + '</b>, сумма квадратов <b>' + f(fit.rss, 1) + '</b>. ' : ' Включите «показать лучшую прямую», чтобы сравнить. ') +
          (worse < 0.3 ? '<br><b class="pos">Вы нашли лучшую прямую (с точностью до округления).</b>' : '<br>Ваша прямая хуже лучшей по сумме квадратов на <b>' + f(worse, 0) + '%</b>.');
      }
      draw();
    }
  });

  /* ---------- 3. Как посчитать k вручную ---------- */
  const PRESETS = [
    { name: 'Типичный случай', x: [101, 102, 103, 104, 105], y: [214, 216, 217, 218, 220], note: 'A примерно в 1,4 раза размашистее B, точки лежат плотно вдоль прямой.' },
    { name: 'Связь тесная, но k = 1,8', x: [101, 102, 103, 104, 105], y: [203, 204, 207, 208, 210], note: 'Тесная связь (корреляция около 1), но A размашистее B почти вдвое: корреляция и k — разные вещи.' },
    { name: 'Связи почти нет', x: [101, 102, 103, 104, 105], y: [218, 214, 217, 213, 218], note: 'A прыгает независимо от B: наклон около нуля, корреляция около нуля. Хеджировать нечем.' }
  ];
  const s3 = { preset: 0, x: PRESETS[0].x.slice(), y: PRESETS[0].y.slice() };

  Z.push({
    id: 'manual',
    title: 'Как посчитать k вручную',
    lead: 'Формулу k можно проверить на бумаге: она состоит из сложений, вычитаний и одного деления. Пройдём все шаги на пяти днях. Числа можно менять: таблица пересчитывается.',
    text: () => `
      <h3>Шаг за шагом</h3>
      <ol>
        <li><b>Средние.</b> Найти среднюю цену B (обозначим x̄, читается «икс с чертой») и среднюю цену A (ȳ). Здесь x — цена B, y — цена A.</li>
        <li><b>Отклонения от средних.</b> Для каждого дня: x − x̄ и y − ȳ. Выше среднего — плюс, ниже — минус.</li>
        <li><b>Два столбца для сумм.</b> (x − x̄)² — квадрат отклонения B и (x − x̄)(y − ȳ) — произведение отклонений B и A.</li>
        <li><b>Суммы</b> этих двух столбцов (знак ${T('sum_sign', 'Σ')} означает «сложить всё»).</li>
        <li><b>Коэффициент k</b> — частное этих сумм.</li>
      </ol>
      <span class="formula">k = Cov(x, y) ÷ Var(x) = Σ(x − x̄)(y − ȳ) ÷ Σ(x − x̄)²<small>Строгая ${T('covariance', 'ковариация')} — это среднее произведений отклонений (с делением на N), а дисперсия — средний квадрат разброса x (тоже с делением на N). В отношении одинаковый делитель 1/N сокращается, поэтому остаются чистые суммы!</small></span>
      <span class="formula">c = ȳ − k · x̄<small>Сдвиг. Из него следует, что прямая проходит через точку (x̄, ȳ).</small></span>
      <h3>Откуда формула и почему она такая</h3>
      <p>Это ровно то, что даёт метод наименьших квадратов из прошлого экрана: нужно найти k и c, при которых сумма квадратов остатков наименьшая. Школьная математика (производная) приводит именно к этим двум формулам; выводить её здесь не нужно, но проверить результат легко: сумма остатков всегда равна нулю.</p>
      <p>Смысл числителя и знаменателя. Числитель измеряет, как A и B двигаются <i>вместе</i>; знаменатель — как сильно двигается сам B. Их отношение отвечает на вопрос «на сколько двигается A на каждый пункт движения B», то есть и есть k. Если B почти не двигался (знаменатель около нуля), k получается нестабильным: делить не на что. Об этом риске — на экране 8.</p>
      <h3>Остатки и z-score</h3>
      <p>После этого считаем остатки: остаток = y − c − k·x. Это тот самый спред A − k·B за вычетом c. Среднее остатков равно нулю, а σ остатков = √(среднее значение квадратов остатков). Значит, z-score последнего дня = последний остаток ÷ σ остатков. Всё остальное в стратегии (пороги, стоп) работает как в простом z-score.</p>
      <h3>Корреляция и k — это разные вещи</h3>
      <p>${T('correlation', 'Корреляция r')} показывает, насколько плотно точки лежат вдоль прямой (от −1 до +1). Но не наклон: A и B могут быть связаны очень тесно, а k при этом 1,8. Нажимайте на примеры справа. И наоборот: прямая всегда существует, даже когда связи почти нет, но k тогда ненадёжен. ${T('r2', 'R²')} = r² — доля колебаний A, объяснённая движением B.</p>
      <div class="note warn"><b>Проверьте сами.</b> Измените любое число справа и посмотрите, как сдвинулись k, остатки и z. Сумма остатков при любых числах остаётся нулевой: это не случайность, а свойство метода.</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><h4>Пять дней: введите свои числа</h4><div class="btns" id="pre" style="margin:0 0 10px"></div><p id="pnote" style="margin:0 0 10px;color:var(--muted)"></p>
          <table class="t" id="tab"></table></div>
        <div class="viz calc-steps" id="steps"></div>
        <div class="viz"><h4>Облако и прямая</h4><div id="sc"></div></div>`;
      const pre = el.querySelector('#pre');
      pre.innerHTML = PRESETS.map((p, i) => '<button class="b" data-i="' + i + '">' + p.name + '</button>').join('');
      pre.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; s3.preset = +b.dataset.i; s3.x = PRESETS[s3.preset].x.slice(); s3.y = PRESETS[s3.preset].y.slice(); build(); draw(); });
      el.querySelector('#sc').innerHTML = '<div class="chartbox"><canvas></canvas></div>';
      const chart = new HV.Scatter(el.querySelector('#sc canvas'), { height: 280, tip: (p) => '<b>День ' + (p.idx + 1) + '</b><br>B: ' + nz(p.x) + '<br>A: ' + nz(p.y) });
      function build() {
        const head = '<tr><th>День</th><th>B (x)</th><th>A (y)</th><th>x − x̄</th><th>y − ȳ</th><th>(x − x̄)²</th><th>(x − x̄)(y − ȳ)</th><th>остаток</th></tr>';
        let rows = '';
        for (let i = 0; i < 5; i++) rows += '<tr><td>' + (i + 1) + '</td><td><input type="number" step="any" data-c="x" data-i="' + i + '" value="' + s3.x[i] + '"></td><td><input type="number" step="any" data-c="y" data-i="' + i + '" value="' + s3.y[i] + '"></td>' +
          ['dx', 'dy', 'dxx', 'dxy', 'res'].map((c) => '<td id="r' + c + i + '"></td>').join('') + '</tr>';
        rows += '<tr><td><b>Сумма Σ</b></td><td id="sx"></td><td id="sy"></td><td id="sdx"></td><td id="sdy"></td><td id="sdxx"></td><td id="sdxy"></td><td id="sres"></td></tr>';
        el.querySelector('#tab').innerHTML = head + rows;
        el.querySelectorAll('#tab input').forEach((inp) => inp.addEventListener('input', () => { s3[inp.dataset.c][+inp.dataset.i] = parseFloat(inp.value); draw(); }));
      }
      const row = (k, title, text, val) => '<div class="row"><div class="n">' + k + '</div><div><b>' + title + '</b><div style="color:var(--muted);font-size:14px">' + text + '</div>' + (val ? '<div class="v">' + val + '</div>' : '') + '</div></div>';
      function draw() {
        el.querySelector('#pnote').textContent = PRESETS[s3.preset].note;
        el.querySelectorAll('#pre button').forEach((b) => b.classList.toggle('on', +b.dataset.i === s3.preset));
        const ok = s3.x.every((v) => Number.isFinite(v)) && s3.y.every((v) => Number.isFinite(v));
        const q = (id, v) => { el.querySelector('#' + id).textContent = v; };
        if (!ok) { el.querySelector('#steps').innerHTML = '<p style="color:var(--muted)">Заполните все десять чисел.</p>'; return; }
        const fit = E.ols(s3.x, s3.y);
        if (fit.k === null) { el.querySelector('#steps').innerHTML = '<div class="note warn">Все значения B одинаковы: B не двигался, и понять, как A зависит от B, невозможно. Коэффициент не определён. Измените хотя бы одно значение B.</div>'; return; }
        let sdx = 0, sdy = 0, sdxx = 0, sdxy = 0, sres = 0, sres2 = 0;
        s3.x.forEach((x, i) => {
          const y = s3.y[i], dx = x - fit.mx, dy = y - fit.my, res = y - fit.alpha - fit.k * x;
          q('rdx' + i, f(dx, 2)); q('rdy' + i, f(dy, 2)); q('rdxx' + i, f(dx * dx, 2)); q('rdxy' + i, f(dx * dy, 2)); q('rres' + i, f(res, 2));
          sdx += dx; sdy += dy; sdxx += dx * dx; sdxy += dx * dy; sres += res; sres2 += res * res;
        });
        q('sx', f(s3.x.reduce((a, b) => a + b, 0), 2)); q('sy', f(s3.y.reduce((a, b) => a + b, 0), 2));
        q('sdx', f(Math.abs(sdx) < 1e-9 ? 0 : sdx, 2)); q('sdy', f(Math.abs(sdy) < 1e-9 ? 0 : sdy, 2)); q('sdxx', f(sdxx, 2)); q('sdxy', f(sdxy, 2)); q('sres', f(Math.abs(sres) < 1e-9 ? 0 : sres, 2));
        const sd = Math.sqrt(sres2 / 5), lastRes = s3.y[4] - fit.alpha - fit.k * s3.x[4];
        el.querySelector('#steps').innerHTML =
          row(1, 'Средние', 'Сложить все B и поделить на 5; то же для A.', 'x̄ = ' + nz(fit.mx) + ',  ȳ = ' + nz(fit.my)) +
          row(2, 'Суммы двух столбцов', 'Σ(x − x̄)² — разброс самого B; Σ(x − x̄)(y − ȳ) — совместное движение.', 'Σ(x − x̄)² = ' + nz(fit.sxx) + ',  Σ(x − x̄)(y − ȳ) = ' + nz(fit.sxy)) +
          row(3, 'Коэффициент k', 'Разделить второе на первое.', 'k = ' + nz(fit.sxy) + ' ÷ ' + nz(fit.sxx) + ' = ' + nz(fit.k)) +
          row(4, 'Сдвиг c', 'Прямая проходит через центр облака.', 'c = ' + nz(fit.my) + ' − ' + nz(fit.k) + ' × ' + nz(fit.mx) + ' = ' + nz(fit.alpha)) +
          row(5, 'Остатки и их разброс', 'Остаток = y − c − k·x (столбец справа). Их сумма равна нулю. σ остатков = √(среднее квадратов остатков).', 'σ = √(' + nz(sres2) + ' ÷ 5) = ' + nz(sd)) +
          row(6, 'Z-score последнего дня', 'Последний остаток ÷ σ остатков.', sd > 1e-9 ? 'z = ' + nz(lastRes) + ' ÷ ' + nz(sd) + ' = ' + nz(lastRes / sd) : 'σ = 0: все точки лежат ровно на прямой, делить не на что') +
          row(7, 'Насколько надёжен k', 'Корреляция r (плотность точек вдоль прямой), R² = r² и стандартная ошибка k (насколько k может «шататься» из-за шума).', 'r = ' + (fit.r === null ? '—' : nz(Math.round(fit.r * 1000) / 1000)) + ',  R² = ' + (fit.r2 === null ? '—' : nz(Math.round(fit.r2 * 1000) / 1000)) + ',  ошибка k = ' + (fit.se === null ? '—' : nz(Math.round(fit.se * 1000) / 1000)));
        chart.render({ points: s3.x.map((x, i) => ({ x, y: s3.y[i], idx: i, hot: i === 4 })), lines: [{ k: fit.k, alpha: fit.alpha, color: ME, width: 2.4 }], residualsOf: { k: fit.k, alpha: fit.alpha, color: '#ff6b6b88' }, xLabel: 'цена B', yLabel: 'цена A' });
      }
      build(); draw();
    }
  });

  /* ---------- 4. Как k меняется во времени ---------- */
  const s4 = { scn: 1, cache: {} };

  Z.push({
    id: 'timevar',
    title: 'Как k меняется во времени',
    lead: 'Связь между инструментами не вечна: k, посчитанный сегодня, завтра будет другим. Посмотрим, как k ведёт себя на разных данных и что даёт выбор длины окна.',
    text: () => `
      <h3>Почему k «динамический»</h3>
      <p>Во-первых, настоящая связь между инструментами может меняться: у одного компании растёт доля в индексе, меняются ставки, структура рынка. Во-вторых, даже если связь постоянна, мы оцениваем k по ограниченному числу точек, а точки шумят, поэтому каждый день получается чуть-чуть другое число. Поэтому k пересчитывают каждый день по скользящему окну из N последних дней (в расчёт входит сегодня и не входит будущее).</p>
      <h3>График справа</h3>
      <p>Пунктир — настоящее β. <b>На реальном рынке его никто не знает</b>: в наших учебных данных оно задано заранее, поэтому мы можем сравнить с ним оценку. Зелёная линия — оценка k по окну. Вокруг неё тонкие зелёные линии: k ± 2 ${T('stderr', 'стандартные ошибки')}. Это «коридор неопределённости»: настоящее значение с большой вероятностью лежит внутри.</p>
      <h3>Выбор окна: компромисс</h3>
      <ul>
        <li><b>Короткое окно</b> быстро замечает изменение связи, но k «шатается» от дня к дню: точек мало, и шум сильно влияет. Коридор широкий.</li>
        <li><b>Длинное окно</b> даёт спокойный k, но запаздывает: если связь изменилась, оценка догоняет с опозданием.</li>
      </ul>
      <p>Таблица под графиками считает оба эффекта по 11 наборам данных: <b>средняя ошибка</b> (насколько оценка отличается от настоящего β) и <b>«шатание»</b> (на сколько в среднем k меняется за один день). Для постоянного β длинное окно лучше по обоим пунктам. Для меняющегося β ошибка складывается из шума и запаздывания, и «лучшее» окно уже зависит от скорости перемен.</p>
      <div class="note warn"><b>Что это значит для стратегии.</b> Когда k прыгает, спред A − k·B — не один непрерывный ряд, а «склейка» кусков с разными k. Поэтому внутри сделки k замораживают: купили столько контрактов B, сколько говорил k в момент входа, и держим их, пока не закроем сделку (экран 6). Подгонять контракты каждый день пришлось бы платить ${T('rebalance', 'ребалансировкой')}.</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><div class="btns" id="tabs" style="margin:0 0 10px"></div><p id="snote" style="margin:0 0 10px;color:var(--muted)"></p>
          <h4>Оценка k по окну</h4><div class="legend"><span><i style="background:${GREY}"></i>настоящее β (в реальности неизвестно)</span><span><i style="background:${ME}"></i>оценка k</span><span><i style="background:#7ee0b566"></i>k ± 2 стандартные ошибки</span></div><div id="c1"></div><div id="ctl"></div></div>
        <div class="viz"><h4>Спред A − k·B с сегодняшним k</h4><p class="cap">Это не один непрерывный ряд: при каждом новом k «вся история» в расчёте пересчитывается.</p><div id="c2"></div></div>
        <div class="viz"><h4>Какое окно лучше: цифры по 11 наборам данных (дни 120–320)</h4><table class="t" id="tab"></table><div class="note" id="read"></div></div>`;
      const tabs = el.querySelector('#tabs');
      const sc = [0, 1, 2];
      tabs.innerHTML = sc.map((i) => '<button class="b" data-i="' + i + '">' + SC[i].name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s4.scn = +b.dataset.i; draw(); } });
      let d, h;
      const c1 = A.mkChart(el.querySelector('#c1'), 230, { tip: (i) => (h.k[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>настоящее β: ' + f(d.beta[i]) + '<br>оценка k: ' + f(h.k[i]) + '<br>стандартная ошибка: ' + f(h.se[i], 3)) });
      const c2 = A.mkChart(el.querySelector('#c2'), 170, { tip: (i) => (h.spread[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>k сегодня: ' + f(h.kUsed[i]) + '<br>спред A − k·B: ' + f(h.spread[i])) });
      const WINS = [10, 20, 30, 60, 120];
      function stats(si, n) {
        const key = si + '|' + n;
        if (s4.cache[key]) return s4.cache[key];
        let err = 0, jump = 0, cnt = 0, jc = 0;
        SEEDS.forEach((sd) => {
          const g = gen(si, sd), hh = E.hedgeStats(g.a, g.b, n);
          for (let t = 120; t < g.a.length; t++) { err += Math.abs(hh.k[t] - g.beta[t]); cnt++; jump += Math.abs(hh.k[t] - hh.k[t - 1]); jc++; }
        });
        return (s4.cache[key] = { err: err / cnt, jump: jump / jc });
      }
      function draw() {
        tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.i === s4.scn));
        el.querySelector('#snote').textContent = SC[s4.scn].note;
        d = gen(s4.scn);
        const n = A.state.params.n;
        h = E.hedgeStats(d.a, d.b, n);
        const lo = h.k.map((v, i) => (v === null || h.se[i] === null ? null : v - 2 * h.se[i])), hi = h.k.map((v, i) => (v === null || h.se[i] === null ? null : v + 2 * h.se[i]));
        c1.render({ n: d.a.length, series: [{ data: d.beta, color: GREY, width: 1.6, dash: [6, 5] }, { data: lo, color: '#7ee0b566', width: 1 }, { data: hi, color: '#7ee0b566', width: 1 }, { data: h.k, color: ME, width: 2 }], yMin: 0, yMax: 3 });
        c2.render({ n: d.a.length, series: [{ data: h.spread, color: C.spread, width: 1.4 }] });
        const list = WINS.indexOf(n) >= 0 ? WINS : WINS.concat([n]).sort((a, b) => a - b);
        el.querySelector('#tab').innerHTML = '<tr><th>Длина окна N</th><th>средняя ошибка k (|k − β|)</th><th>«шатание» k за день</th></tr>' +
          list.map((w) => { const s = stats(s4.scn, w); return '<tr' + (w === n ? ' class="sel"' : '') + '><td>' + w + (w === n ? ' (выбрано)' : '') + '</td><td>' + f(s.err, 3) + '</td><td>' + f(s.jump, 3) + '</td></tr>'; }).join('');
        const cur = stats(s4.scn, n);
        const bestN = list.slice().sort((p, q) => stats(s4.scn, p).err - stats(s4.scn, q).err)[0];
        el.querySelector('#read').innerHTML = 'При N = <b>' + n + '</b> оценка k в среднем ошибается на <b>' + f(cur.err, 3) + '</b>, а за день меняется на <b>' + f(cur.jump, 3) + '</b>. Из показанных окон меньше всего ошибка при N = <b>' + bestN + '</b>. ' +
          (s4.scn === 0 ? 'Здесь настоящее β равно 1 и неизменно: всё, что мы видим, — шум оценки. Он и есть цена за «динамичность». Сравните со вторым сценарием: цифры те же, потому что ошибка оценки зависит от шума и длины окна, а не от того, чему равно β.' : s4.scn === 1 ? 'Настоящее β постоянно: чем длиннее окно, тем спокойнее и точнее оценка. Цифры те же, что в первом сценарии: оценка k «не знает», чему равно β, и ошибается одинаково.' : 'Настоящее β растёт: слишком длинное окно запаздывает, слишком короткое шумит, поэтому у ошибки есть минимум где-то посередине.');
      }
      A.controls(el.querySelector('#ctl'), [S.n], draw);
      draw();
    }
  });
})();
