/* EWMA, экраны 1–4: проблема окна, вес дня, формулы, скорость забывания. */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine;
  const C = U.COLORS;
  const Z = (window.EWSCREENS = window.EWSCREENS || []);
  const WIN = '#f5a65b', EW = '#5aa9ff';
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 1 : d) + '</span>';

  window.SPECS.nE = { key: 'n', label: 'Эквивалентная длина N, дней', min: 3, max: 120, step: 1, d: 0, hint: 'Задаёт скорость забывания: α = 2 ÷ (N + 1). Чем меньше N, тем быстрее забываем.' };

  const prereq = '<div class="note">Если слова «спред», «среднее», «σ» и «z-score» вам не знакомы, сначала прочитайте <a href="#zscore/1" style="color:var(--accent)">разбор простого z-score</a>: здесь он считается известным.</div>';

  /* ---------- 1. Проблема окна ---------- */
  const SPIKE_AT = 100;
  const spikeState = { size: 40 };

  Z.push({
    id: 'problem',
    title: 'Проблема простого окна',
    lead: 'EWMA придумали не ради красоты формулы, а чтобы убрать один конкретный недостаток простого скользящего окна. Сначала увидим этот недостаток своими глазами.',
    text: () => `
      <h3>Как устроено простое окно</h3>
      <p>В простом z-score среднее и разброс считаются по последним N дням, и каждый из этих дней вносит одинаковый вклад: ${T('weight', 'вес')} каждого равен 1. День, который оказался на одно место старше окна, вылетает: его вес мгновенно становится нулём.</p>
      <h3>Что происходит с выбросом</h3>
      <p>Допустим, в один день спред на мгновение резко подскочил (${T('spike', 'выброс')}) и тут же вернулся. Пока этот день внутри окна, он раздувает σ — «обычный разброс». А ровно через N дней день вылетает из окна, и σ <b>резко падает</b>, хотя сегодня на рынке ничего не изменилось.</p>
      <p>σ — это делитель в z-score. Когда он резко меняется, одно и то же отклонение от среднего вдруг выглядит «более необычным», хотя цена не изменилась. Сильнее всего это заметно, если спред в этот день уже далеко от среднего: тогда z может перескочить порог входа не из-за цены, а из-за того, что из расчёта выпал старый день.</p>
      <h3>Идея ${T('ewma', 'EWMA')}</h3>
      <p>Не вычёркивать день одним махом, а позволить ему <b>постепенно терять значимость</b>: чем он старше, тем меньше его вес. Тогда ни один день не вылетает резко, и числа меняются плавно. Подробнее — на следующих экранах.</p>
      <div class="note warn"><b>Честная оговорка.</b> У плавности есть цена: EWMA сильнее реагирует на свежие дни (доля сегодняшнего дня у неё 2 ÷ (N + 1), у простого окна — 1 ÷ N). Поэтому в момент самого выброса σ у EWMA растёт заметнее. Это не лучше и не хуже, это другой компромисс.</div>
      ${prereq}`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><h4>Спред с одним выбросом (день ${SPIKE_AT + 1})</h4><p class="cap">Выброс добавлен вручную к учебным данным. Меняйте его размер и длину окна.</p>
          <div class="legend"><span><i style="background:${C.spread}"></i>спред</span></div><div id="c1"></div>
          <div id="ctl"></div>
          <div class="ctl" style="margin-top:6px"><label><span>Размер выброса, пунктов</span><b id="spv"></b></label><input type="range" id="spk" min="0" max="80" step="5"><div class="hint">0 — выброса нет.</div></div></div>
        <div class="viz"><h4>Разброс σ: простое окно против EWMA</h4><p class="cap">Розоватая зона — выброс внутри окна простого варианта.</p>
          <div class="legend"><span><i style="background:${WIN}"></i>σ простого окна</span><span><i style="background:${EW}"></i>σ EWMA</span></div><div id="c2"></div></div>
        <div class="viz"><h4>Z-score: что видит стратегия</h4>
          <div class="legend"><span><i style="background:${WIN}"></i>z простого окна</span><span><i style="background:${EW}"></i>z EWMA</span></div><div id="c3"></div><div class="note" id="read"></div></div>`;
      const sp = el.querySelector('#spk');
      const mk = (id, h, tip) => A.mkChart(el.querySelector(id), h, { tip });
      let sdW, sdE, zW, zE, series;
      const c1 = mk('#c1', 170, (i) => '<b>День ' + (i + 1) + '</b><br>Спред: ' + U.fmt(series[i]));
      const c2 = mk('#c2', 190, (i) => sdW[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>σ окна: ' + U.fmt(sdW[i]) + '<br>σ EWMA: ' + U.fmt(sdE[i]));
      const c3 = mk('#c3', 190, (i) => zW[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>z окна: ' + U.fmt(zW[i]) + '<br>z EWMA: ' + U.fmt(zE[i]));
      function draw() {
        const p = A.state.params, n = p.n;
        series = A.data().spread.slice();
        series[SPIKE_AT] += spikeState.size;
        const w = E.rolling(series, n), e = E.ewma(series, n);
        sdW = w.std; sdE = e.std; zW = w.z; zE = e.z;
        const len = series.length, exit = SPIKE_AT + n;
        el.querySelector('#spv').textContent = U.fmt(spikeState.size, 0);
        sp.value = spikeState.size;
        c1.render({ n: len, series: [{ data: series, color: C.spread }], markers: [{ i: SPIKE_AT, y: series[SPIKE_AT], kind: 'ring', color: '#ff6b6b', size: 8 }] });
        const span = [{ i0: SPIKE_AT, i1: exit - 1, color: '#ff6b6b18' }];
        c2.render({ n: len, series: [{ data: sdW, color: WIN, width: 2 }, { data: sdE, color: EW, width: 2 }], spans: span, yMin: 0 });
        c3.render({ n: len, series: [{ data: zW, color: WIN }, { data: zE, color: EW }], spans: span, hlines: [{ y: 0, color: '#ffffff44', dash: [] }], yMin: -4.5, yMax: 4.5 });
        const t = exit;
        if (spikeState.size === 0 || t >= len) { el.querySelector('#read').textContent = 'Задайте размер выброса больше нуля, чтобы увидеть эффект.'; return; }
        const dW = sdW[t - 1] - sdW[t], dE = sdE[t - 1] - sdE[t];
        const dz = Math.abs(zW[t] - zW[t - 1]), dzE = Math.abs(zE[t] - zE[t - 1]), ds = series[t] - series[t - 1];
        el.querySelector('#read').innerHTML = '<b>День ' + (t + 1) + ': выброс вылетает из окна.</b> σ простого окна упала с ' + U.fmt(sdW[t - 1]) + ' до ' + U.fmt(sdW[t]) + ' (на ' + U.fmt(dW) + '), а σ EWMA за этот день изменилась с ' + U.fmt(sdE[t - 1]) + ' до ' + U.fmt(sdE[t]) + ' (на ' + U.fmt(dE) + '). Сам спред за этот день сдвинулся на ' + U.sgn(ds, 2) + ' пункта, z простого окна изменился на ' + U.fmt(dz) + ', z EWMA — на ' + U.fmt(dzE) + ' (здесь спред рядом со средним, поэтому изменения невелики). <b>Для наглядности</b>, будь отклонение спреда от среднего 10 пунктов: z простого окна был бы ' + U.fmt(10 / sdW[t - 1]) + ' накануне и ' + U.fmt(10 / sdW[t]) + ' в день выхода; у EWMA — ' + U.fmt(10 / sdE[t - 1]) + ' и ' + U.fmt(10 / sdE[t]) + '.';
      }
      sp.addEventListener('input', () => { spikeState.size = parseFloat(sp.value); draw(); });
      A.controls(el.querySelector('#ctl'), [window.SPECS.nE], draw);
      draw();
    }
  });

  /* ---------- 2. Вес дня ---------- */
  Z.push({
    id: 'weights',
    title: 'Вес дня: как работает «забывание»',
    lead: 'Весь EWMA держится на одной идее: каждому дню в прошлом присваивается вес, и чем старше день, тем меньше его вес.',
    text: () => `
      <h3>Что такое вес</h3>
      <p>${T('weight', 'Вес')} — число, которое говорит, насколько сильно день влияет на среднее. Вес 1 — день учитывается полностью, вес 0,5 — вполовину, вес около нуля — почти не влияет.</p>
      <ul>
        <li><b>Простое окно:</b> у каждого из последних N дней вес 1, у всех более старых — 0. Резкая ступенька.</li>
        <li><b>EWMA:</b> вес плавно убывает вглубь прошлого. Ступеньки нет.</li>
      </ul>
      <h3>Как именно убывает вес</h3>
      <p>Выбирается число ${T('alpha', 'α («альфа»)')} от 0 до 1. Сегодняшний день весит 1, а каждый следующий день в прошлом весит в (1 − α) раз меньше предыдущего:</p>
      <span class="formula">вес дня, бывшего k дней назад = (1 − α)<sup>k</sup><small>k = 0 — сегодня, k = 1 — вчера и так далее</small></span>
      <p>Пример при α = 0,1: сегодня 1, вчера 0,9, позавчера 0,81, ещё день назад 0,729… Каждый день вес умножается на 0,9. Он никогда не станет ровно нулём, но очень быстро становится ничтожным. Слово «экспоненциальное» в названии как раз об этом: вес падает в одно и то же число раз за каждый шаг.</p>
      <h3>Период полураспада</h3>
      <p>Удобный способ почувствовать скорость забывания — ${T('halflife', 'период полураспада')}: через сколько дней вес уменьшается вдвое. Он считается как ln 0,5 ÷ ln(1 − α) (ln — натуральный логарифм, есть на любом инженерном калькуляторе).</p>
      <div class="note"><b>Важно.</b> Вес не обнуляется никогда, поэтому в расчёте участвует вся известная история, но на дни старше нескольких периодов полураспада приходится совсем мало веса.</div>
      <p>Двигайте N справа: чем оно больше, тем медленнее вес падает.</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><h4>Веса дней: сколько каждый день «значит»</h4><p class="cap">По горизонтали — сколько дней назад (0 — сегодня). Нажмите на график или наведите курсор.</p>
          <div class="legend"><span><i style="background:${WIN}"></i>простое окно</span><span><i style="background:${EW}"></i>EWMA</span></div><div id="c"></div><div id="ctl"></div>
          <div class="kpis" id="kp"></div></div>
        <div class="viz"><h4>Вес по числу дней назад</h4><table class="t" id="tab"></table></div>`;
      let n, K, wSma, wE;
      const chart = A.mkChart(el.querySelector('#c'), 260, {
        xfmt: (k) => String(k),
        tip: (k) => '<b>' + k + ' дн. назад</b><br>Простое окно: ' + U.fmt(wSma[k], 0) + '<br>EWMA: ' + U.fmt(wE[k], 3)
      });
      function draw() {
        n = A.state.params.n;
        K = Math.min(250, 2 * n + 10);
        const q = 1 - E.alphaOf(n);
        wSma = Array.from({ length: K + 1 }, (_, k) => (k < n ? 1 : 0));
        wE = Array.from({ length: K + 1 }, (_, k) => Math.pow(q, k));
        chart.render({ n: K + 1, series: [{ data: wSma, color: WIN, width: 2 }, { data: wE, color: EW, width: 2.4 }], yMin: 0, yMax: 1.05, hlines: [{ y: 0.5, color: '#ffffff30', label: 'вес 0,5' }] });
        const a = E.alphaOf(n), h = E.halfLife(n);
        const kp = [[U.fmt(a, 3), 'α (скорость забывания)', '= 2 ÷ (N + 1)'], [U.fmt(q, 3), '1 − α', 'во столько раз каждый день весит меньше предыдущего'], [U.fmt(h, 1) + ' дн.', 'период полураспада', 'через столько дней вес вдвое меньше'],
          [U.fmt(E.weightShare(n, n) * 100, 0) + '%', 'веса в последних N днях', 'остальное приходится на более старые дни'], [U.fmt(a * 100, 1) + '%', 'доля сегодняшнего дня', 'у простого окна: ' + U.fmt(100 / n, 1) + '%'], [U.fmt(Math.pow(q, n), 3), 'вес дня N дней назад', 'у простого окна: 0 (уже вылетел)']];
        el.querySelector('#kp').innerHTML = kp.map((x) => '<div class="kpi"><div class="v">' + x[0] + '</div><div class="l">' + x[1] + '</div><div class="e">' + x[2] + '</div></div>').join('');
        const rows = [0, 1, 2, 5, 10, Math.round(n / 2), n, 2 * n].filter((v, i, arr) => arr.indexOf(v) === i).sort((x, y) => x - y);
        el.querySelector('#tab').innerHTML = '<tr><th>Дней назад</th><th>Вес в простом окне</th><th>Вес в EWMA</th></tr>' + rows.map((k) => '<tr><td>' + k + (k === n ? ' (= N)' : '') + '</td><td>' + (k < n ? '1' : '0') + '</td><td>' + U.fmt(Math.pow(q, k), 4) + '</td></tr>').join('');
      }
      A.controls(el.querySelector('#ctl'), [window.SPECS.nE], draw);
      draw();
    }
  });

  /* ---------- 3. Формулы ---------- */
  const calc = { x: [58, 61, 66, 70], n: 5 };

  Z.push({
    id: 'formulas',
    title: 'Взвешенное среднее и разброс: формулы',
    lead: 'Вся математика EWMA — это формулы простого z-score, в которые добавили веса. Разберём каждую и пересчитаем на маленьком примере вручную.',
    wide: true,
    text: () => `
      <h3>Шаг 1. Веса</h3>
      <span class="formula">w<sub>k</sub> = (1 − α)<sup>k</sup><small>k — сколько дней назад был день, α = 2 ÷ (N + 1)</small></span>
      <h3>Шаг 2. Сумма весов</h3>
      <span class="formula">W = w<sub>0</sub> + w<sub>1</sub> + w<sub>2</sub> + … <small>складываем веса всех известных дней</small></span>
      <h3>Шаг 3. ${T('weighted_mean', 'Взвешенное среднее')}</h3>
      <span class="formula">среднее = (w<sub>0</sub>·x<sub>0</sub> + w<sub>1</sub>·x<sub>1</sub> + …) ÷ W<small>x<sub>k</sub> — спред k дней назад. Делим на W, чтобы веса «в сумме давали единицу»</small></span>
      <h3>Шаг 4. Взвешенная дисперсия и σ</h3>
      <span class="formula">дисперсия = (w<sub>0</sub>·(x<sub>0</sub> − среднее)² + w<sub>1</sub>·(x<sub>1</sub> − среднее)² + …) ÷ W<br>σ = √дисперсия</span>
      <h3>Шаг 5. Z-score</h3>
      <span class="formula">z = (x<sub>0</sub> − среднее) ÷ σ<small>x<sub>0</sub> — сегодняшний спред</small></span>
      <div class="note"><b>Связь с простым окном.</b> Если положить вес 1 для последних N дней и 0 для остальных, из этих формул получатся в точности формулы простого окна. EWMA — то же самое, но с плавными весами.</div>
      <h3>Как считает программа</h3>
      <p>Перебирать всю историю каждый день долго. Есть эквивалентная ${T('recursion', 'рекуррентная формула')}: новая сумма = сегодняшнее значение + (1 − α) × вчерашняя сумма (то же для W и для сумм с квадратами). Мы сверили её с прямой формулой автоматическим тестом: числа совпадают.</p>
      <p>Справа — тот же расчёт на четырёх числах. Меняйте спреды и скорость забывания.</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><h4>Ручной пример: четыре дня</h4><p class="cap">Слева направо от самого старого дня к сегодняшнему. Здесь известна только эта «история».</p>
          <div class="calc-grid" style="grid-template-columns:repeat(4,1fr)">${calc.x.map((v, i) => '<div><label>' + (i === 3 ? 'Сегодня' : (3 - i) + ' дн. назад') + '</label><input type="number" data-i="' + i + '" value="' + v + '" step="1"></div>').join('')}</div>
          <div id="ctl"></div><div id="calc"></div></div>
        <div class="viz"><h4>То же на реальных учебных данных</h4><p class="cap">Среднее EWMA и коридор ±1σ, ±2σ.</p>
          <div class="legend"><span><i style="background:${C.spread}"></i>спред</span><span><i style="background:${C.mean}"></i>среднее EWMA</span><span><i style="background:#5aa9ff"></i>± σ</span><span><i style="background:#f5a65b"></i>± 2σ</span></div><div id="ch"></div></div>`;
      const chart = A.mkChart(el.querySelector('#ch'), 250, { tip: (i) => { const e = E.ewma(A.data().spread, A.state.params.n); return e.mean[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>Спред: ' + U.fmt(A.data().spread[i]) + '<br>Среднее: ' + U.fmt(e.mean[i]) + ' · σ: ' + U.fmt(e.std[i]) + '<br>z: ' + U.fmt(e.z[i]); } });
      function draw() {
        const n = Math.max(2, A.state.params.n);
        const x = calc.x, t = x.length - 1;
        const ex = E.explainEwma(x, n, t, x.length, true);
        const plainMean = x.reduce((a, b) => a + b, 0) / x.length;
        const plainSd = Math.sqrt(x.reduce((a, b) => a + (b - plainMean) * (b - plainMean), 0) / x.length);
        const f = (v, d) => U.fmt(v, d === undefined ? 3 : d);
        el.querySelector('#calc').innerHTML =
          '<p style="margin:12px 0 4px">α = 2 ÷ (' + n + ' + 1) = <b>' + f(ex.alpha) + '</b>; множитель убывания 1 − α = <b>' + f(1 - ex.alpha) + '</b></p>' +
          '<table class="t"><tr><th>Дней назад k</th><th>Спред x</th><th>Вес w</th><th>w · x</th><th>x − среднее</th><th>w · (x − среднее)²</th></tr>' +
          ex.rows.map((r) => '<tr' + (r.k === 0 ? ' class="sel"' : '') + '><td>' + r.k + '</td><td>' + f(r.value, 1) + '</td><td>' + f(r.w) + '</td><td>' + f(r.wx) + '</td><td>' + U.sgn(r.dev, 3) + '</td><td>' + f(r.wsq) + '</td></tr>').join('') +
          '<tr><td><b>Σ</b></td><td></td><td><b>' + f(ex.W) + '</b></td><td><b>' + f(ex.Wx) + '</b></td><td></td><td><b>' + f(ex.Wsq) + '</b></td></tr></table>' +
          '<div class="calc-steps" style="margin-top:8px">' +
          step(1, 'Среднее', 'Σ(w·x) ÷ W = ' + f(ex.Wx) + ' ÷ ' + f(ex.W) + ' = ' + f(ex.mean)) +
          step(2, 'Дисперсия и σ', f(ex.Wsq) + ' ÷ ' + f(ex.W) + ' = ' + f(ex.variance) + ';  √' + f(ex.variance) + ' = ' + f(ex.std)) +
          step(3, 'Z-score сегодняшнего дня', '(' + f(x[t], 1) + ' − ' + f(ex.mean) + ') ÷ ' + f(ex.std) + ' = ' + f(ex.z)) + '</div>' +
          '<div class="note">Для сравнения, простое среднее этих четырёх дней — ' + f(plainMean) + ', σ — ' + f(plainSd) + ', z — ' + f((x[t] - plainMean) / plainSd) + '. EWMA «ближе» к недавним дням, поэтому её среднее смещено в сторону свежих значений.</div>';
        const d = A.data().spread, e = E.ewma(d, A.state.params.n);
        const band = (k) => e.mean.map((m, i) => (m === null ? null : m + k * e.std[i]));
        chart.render({ n: d.length, series: [{ data: band(2), color: WIN, width: 1, dash: [4, 4] }, { data: band(-2), color: WIN, width: 1, dash: [4, 4] }, { data: band(1), color: EW, width: 1, dash: [4, 4] }, { data: band(-1), color: EW, width: 1, dash: [4, 4] }, { data: e.mean, color: C.mean, width: 2 }, { data: d, color: C.spread }] });
      }
      function step(k, title, val) { return '<div class="row"><div class="n">' + k + '</div><div><b>' + title + '</b><div class="v" style="display:block;width:fit-content">' + val + '</div></div></div>'; }
      el.querySelectorAll('input[data-i]').forEach((inp) => inp.addEventListener('input', () => { const v = parseFloat(inp.value); calc.x[+inp.dataset.i] = Number.isFinite(v) ? v : 0; draw(); }));
      A.controls(el.querySelector('#ctl'), [window.SPECS.nE], draw);
      draw();
    }
  });

  /* ---------- 4. Скорость забывания ---------- */
  Z.push({
    id: 'speed',
    title: 'Скорость забывания: α, N и полураспад',
    lead: 'У EWMA один главный параметр. Его можно задать тремя эквивалентными способами; разберёмся, как они связаны и что даёт каждое значение.',
    text: () => `
      <h3>Три способа сказать одно и то же</h3>
      <ul>
        <li>${T('alpha', 'α')}: «насколько быстро забываем»; чем больше, тем быстрее. Каждый день в прошлом весит в (1 − α) раз меньше предыдущего.</li>
        <li>${T('halflife', 'Период полураспада')}: через сколько дней вес вдвое меньше. Наглядно.</li>
        <li>${T('equiv_n', 'Эквивалентная длина окна N')}: «сколько дней примерно помнит стратегия». С ней удобнее всего сравнивать EWMA с простым окном.</li>
      </ul>
      <span class="formula">α = 2 ÷ (N + 1)<small>N = 30 → α = 2 ÷ 31 ≈ 0,065</small></span>
      <h3>Почему именно 2 ÷ (N + 1)</h3>
      <p>Если считать «возраст» данных (сегодня 0 дней, вчера 1 и так далее), то в простом окне из N дней средний возраст равен (N − 1) ÷ 2. При α = 2 ÷ (N + 1) у EWMA средний возраст данных, учтённых с их весами, получается ровно таким же. Поэтому «центр тяжести» обоих усреднений совпадает, и при одном и том же N сравнение честное.</p>
      <h3>Что даёт малое и большое N</h3>
      <ul>
        <li><b>Малое N</b> (быстрое забывание): среднее «прилипает» к спреду, ведь у сегодняшнего дня большая доля веса. Спред не успевает далеко уйти от среднего, и z остаётся небольшим. На наших учебных данных при N = 8 значение |z| ни разу не превысило 1,74, так что порог входа 2σ вообще не срабатывал.</li>
        <li><b>Большое N</b> (медленное забывание): среднее плавное, z может достигать больших значений (при N = 80 на тех же данных до 3,3), но среднее медленно замечает смену уровня.</li>
      </ul>
      <div class="note"><b>Универсального «правильного» N нет.</b> В этом учебнике по умолчанию N = 30, как у простого окна, — чтобы сравнивать честно. На экране «Когда помогает и когда вредит» видно, что лучшее N зависит от данных.</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><h4>Среднее при разной скорости забывания</h4><p class="cap">Три линии EWMA: быстрая (N = 8), выбранная вами и медленная (N = 80).</p>
          <div class="legend"><span><i style="background:${C.spread}"></i>спред</span><span><i style="background:#ffd166"></i>N = 8</span><span><i style="background:${EW}"></i>выбранное N</span><span><i style="background:${C.mean}"></i>N = 80</span></div><div id="c"></div><div id="ctl"></div></div>
        <div class="viz"><h4>Одно и то же разными словами</h4><table class="t" id="tab"></table></div>`;
      const chart = A.mkChart(el.querySelector('#c'), 260, {});
      function draw() {
        const d = A.data().spread, n = A.state.params.n;
        chart.render({ n: d.length, series: [{ data: d, color: C.spread, width: 1.2 }, { data: E.ewma(d, 8).mean, color: '#ffd166', width: 1.6 }, { data: E.ewma(d, 80).mean, color: C.mean, width: 2 }, { data: E.ewma(d, n).mean, color: EW, width: 2.6 }] });
        const ns = [5, 10, 20, 30, 60, 120];
        if (ns.indexOf(n) < 0) ns.push(n);
        ns.sort((a, b) => a - b);
        el.querySelector('#tab').innerHTML = '<tr><th>N</th><th>α</th><th>Полураспад, дней</th><th>Доля сегодняшнего дня</th><th>Доля веса в последних N днях</th><th>Средний возраст данных, дней (на длинной истории)</th></tr>' +
          ns.map((v) => '<tr' + (v === n ? ' class="sel"' : '') + '><td>' + v + '</td><td>' + U.fmt(E.alphaOf(v), 3) + '</td><td>' + U.fmt(E.halfLife(v), 1) + '</td><td>' + U.fmt(E.alphaOf(v) * 100, 1) + '%</td><td>' + U.fmt(E.weightShare(v, v) * 100, 0) + '%</td><td>' + U.fmt((v - 1) / 2, 1) + '</td></tr>').join('');
      }
      A.controls(el.querySelector('#ctl'), [window.SPECS.nE], draw);
      draw();
    }
  });
})();
