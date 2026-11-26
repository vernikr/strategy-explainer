/* Робастный z-score, экраны 1–4: проблема выбросов, медиана, MAD и множитель 1,4826, формулы. */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, S = window.SPECS;
  const C = U.COLORS;
  const Z = (window.RBSCREENS = window.RBSCREENS || []);
  const SIM = '#f5a65b', RB = '#7ee0b5';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const fi = (v) => f(v, Number.isInteger(v) ? 0 : 2);
  const chip = (v, o) => '<span style="display:inline-block;padding:4px 9px;margin:2px;border-radius:6px;background:#232a3b;font-variant-numeric:tabular-nums;' +
    (o && o.mid ? 'background:#7ee0b522;outline:1px solid ' + RB + ';' : '') + (o && o.bad ? 'color:#ff6b6b;' : '') + '">' + fi(v) + '</span>';
  const midIdx = (len) => (len % 2 ? [len >> 1] : [len / 2 - 1, len / 2]);

  const prereq = '<div class="note">Если слова «спред», «среднее», «σ» и «z-score» вам не знакомы, сначала прочитайте <a href="#zscore/1" style="color:#7ee0b5">разбор простого z-score</a>: здесь он считается известным.</div>';

  /* ---------- 1. Проблема: выбросы обманывают среднее и σ ---------- */
  const SPIKE_AT = 140;
  const spikeState = { size: 40 };

  Z.push({
    id: 'problem',
    title: 'Проблема: выбросы обманывают среднее и σ',
    lead: 'Простой z-score измеряет «насколько сегодня необычно» линейкой, которую сам же портит необычные дни. Сначала увидим это своими глазами, потом разберёмся, чем заменить линейку.',
    text: () => `
      <h3>Что такое выброс</h3>
      <p>${T('spike', 'Выброс')} — единичное резкое значение, которое сильно выбивается из остальных. Причины бывают разные: на рынке случился редкий всплеск, прошла крупная сделка, брокер прислал неверную цену. Спред на мгновение подскочил и сразу вернулся.</p>
      <h3>Как выброс портит «линейку»</h3>
      <p>Z-score — это отношение: (спред − ${T('mean', 'среднее')}) ÷ ${T('std', 'σ')}. И среднее, и σ считаются по всем дням окна, а значит, выброс участвует в расчёте наравне с обычными днями.</p>
      <ul>
        <li><b>Среднее сдвигается</b> в сторону выброса. Центр «обычного уровня» уезжает, хотя обычные дни никуда не ушли.</li>
        <li><b>σ раздувается</b>. Квадрат большого отклонения в расчёте σ перевешивает десятки маленьких. Пока выброс в окне (N дней), σ завышена, и любое нормальное отклонение выглядит скромнее, чем есть.</li>
      </ul>
      <h3>Парадокс: выброс «глушит» сам себя</h3>
      <p>В день выброса простой z-score не показывает ничего выдающегося: выброс раздул σ, и деление на неё гасит результат. У простого окна из N дней z одного дня вообще не может превысить √(N − 1) (при N = 30 это 5,4), как бы далеко ни улетел спред. А следующие N дней стратегия «оглохшая»: завышенная σ скрывает настоящие сигналы.</p>
      <h3>Идея робастного варианта</h3>
      <p>${T('robust', 'Робастность')} — устойчивость к выбросам. Вместо среднего берут ${T('median', 'медиану')}, вместо σ — ${T('mad', 'MAD')}, умноженную на поправочный множитель. Эти две величины почти не замечают единичного выброса. Подробности — на следующих экранах.</p>
      <div class="note warn"><b>Честная оговорка.</b> «Не замечает выбросов» — это не «всегда лучше». Робастная линейка стабильна, но у неё есть цена: она «дёрганее» на обычных данных, а в день выброса z получается огромным и стратегия на него реагирует. Хорошо это или плохо, зависит от природы выброса. Сравнение — на экранах 5 и 8.</div>
      ${prereq}`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><h4>Спред с одним выбросом (день ${SPIKE_AT + 1})</h4><p class="cap">Выброс добавлен вручную к учебным данным. Меняйте его размер и длину окна.</p>
          <div class="legend"><span><i style="background:${C.spread}"></i>спред</span></div><div id="c1"></div>
          <div id="ctl"></div>
          <div class="ctl" style="margin-top:6px"><label><span>Размер выброса, пунктов</span><b id="spv"></b></label><input type="range" id="spk" min="0" max="80" step="5"><div class="hint">0 — выброса нет.</div></div></div>
        <div class="viz"><h4>Центр: среднее и медиана</h4><p class="cap">Розоватая зона — выброс внутри окна.</p>
          <div class="legend"><span><i style="background:${SIM}"></i>среднее окна</span><span><i style="background:${RB}"></i>медиана окна</span></div><div id="c2"></div></div>
        <div class="viz"><h4>Разброс: σ против робастной σ</h4>
          <div class="legend"><span><i style="background:${SIM}"></i>σ окна</span><span><i style="background:${RB}"></i>робастная σ (1,4826 × MAD)</span></div><div id="c3"></div></div>
        <div class="viz"><h4>Z-score: что видит стратегия</h4>
          <div class="legend"><span><i style="background:${SIM}"></i>z простого окна</span><span><i style="background:${RB}"></i>z робастный</span></div><div id="c4"></div><div class="note" id="read"></div></div>`;
      const sp = el.querySelector('#spk');
      const mk = (id, h, tip) => A.mkChart(el.querySelector(id), h, { tip });
      let series, w, r;
      const c1 = mk('#c1', 150, (i) => '<b>День ' + (i + 1) + '</b><br>Спред: ' + f(series[i]));
      const c2 = mk('#c2', 170, (i) => w.mean[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>Среднее окна: ' + f(w.mean[i]) + '<br>Медиана: ' + f(r.mean[i]));
      const c3 = mk('#c3', 170, (i) => w.std[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>σ окна: ' + f(w.std[i]) + '<br>Робастная σ: ' + f(r.std[i]));
      const c4 = mk('#c4', 190, (i) => w.z[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>z окна: ' + f(w.z[i]) + '<br>z робастный: ' + f(r.z[i]));
      function draw() {
        const n = A.state.params.n;
        const clean = A.data().spread;
        series = clean.slice();
        series[SPIKE_AT] += spikeState.size;
        w = E.rolling(series, n); r = E.robust(series, n);
        const wc = E.rolling(clean, n), len = series.length, last = Math.min(len - 1, SPIKE_AT + n - 1);
        el.querySelector('#spv').textContent = f(spikeState.size, 0);
        sp.value = spikeState.size;
        const span = [{ i0: SPIKE_AT, i1: last, color: '#ff6b6b18' }];
        c1.render({ n: len, series: [{ data: series, color: C.spread }], markers: [{ i: SPIKE_AT, y: series[SPIKE_AT], kind: 'ring', color: '#ff6b6b', size: 8 }] });
        c2.render({ n: len, series: [{ data: w.mean, color: SIM, width: 2 }, { data: r.mean, color: RB, width: 2 }], spans: span });
        c3.render({ n: len, series: [{ data: w.std, color: SIM, width: 2 }, { data: r.std, color: RB, width: 2 }], spans: span, yMin: 0 });
        c4.render({ n: len, series: [{ data: w.z, color: SIM }, { data: r.z, color: RB }], spans: span, hlines: [{ y: 0, color: '#ffffff44', dash: [] }], yMin: -6, yMax: 6 });
        const read = el.querySelector('#read');
        const t0 = SPIKE_AT, mid = Math.min(len - 1, SPIKE_AT + Math.floor(n / 2));
        if (spikeState.size === 0) { read.textContent = 'Задайте размер выброса больше нуля, чтобы увидеть эффект.'; return; }
        if (w.mean[t0 - 1] === null || r.std[t0] === null) { read.textContent = 'При такой длине окна к дню выброса окно ещё не набралось. Уменьшите N.'; return; }
        read.innerHTML =
          '<b>День ' + (t0 + 1) + ': приходит выброс.</b> Среднее окна прыгнуло с ' + f(w.mean[t0 - 1]) + ' до ' + f(w.mean[t0]) + ' (на ' + f(Math.abs(w.mean[t0] - w.mean[t0 - 1])) + '), медиана — с ' + f(r.mean[t0 - 1]) + ' до ' + f(r.mean[t0]) + ' (на ' + f(Math.abs(r.mean[t0] - r.mean[t0 - 1])) + '). σ окна выросла с ' + f(w.std[t0 - 1]) + ' до ' + f(w.std[t0]) + ', робастная σ — с ' + f(r.std[t0 - 1]) + ' до ' + f(r.std[t0]) + '.' +
          '<br><b>Через ' + (mid - t0) + ' дн. выброс всё ещё в окне:</b> σ окна равна ' + f(w.std[mid]) + ', робастная — ' + f(r.std[mid]) + '. Без выброса было бы ' + f(wc.std[mid]) + ' и ' + f(E.robust(clean, n).std[mid]) + ' соответственно.' +
          '<br><b>Оговорка про сам день выброса:</b> простой z = ' + f(w.z[t0]) + ' (потолок для N = ' + n + ' — √' + (n - 1) + ' = ' + f(Math.sqrt(n - 1)) + '), робастный z = ' + f(r.z[t0]) + '. Простое окно успокоило само себя; робастное — нет, и стратегия на таком z откроет сделку.';
      }
      sp.addEventListener('input', () => { spikeState.size = parseFloat(sp.value); draw(); });
      A.controls(el.querySelector('#ctl'), [S.n], draw);
      draw();
    }
  });

  /* ---------- 2. Медиана ---------- */
  const med = { x: [58, 61, 63, 66, 69, 72, 75], k: 0, big: 150, spiky: false };

  Z.push({
    id: 'median',
    title: 'Медиана: «середина» вместо среднего',
    lead: 'Медиана отвечает на тот же вопрос, что и среднее: «где центр обычных значений?». Но находит его другим способом, и поэтому одинокий выброс её почти не двигает.',
    text: () => `
      <h3>Как найти медиану</h3>
      <ol>
        <li>Выстроить числа по возрастанию (отсортировать).</li>
        <li>Взять то, что стоит ровно посередине.</li>
      </ol>
      <p>Пример: 58, 61, 66, 70, 100 уже по возрастанию, посередине стоит 66 — это ${T('median', 'медиана')}. Среднее же равно (58 + 61 + 66 + 70 + 100) ÷ 5 = 71,0: оно выше медианы на 5 пунктов, хотя четыре числа из пяти лежат в диапазоне 58–70, а выше среднего оказалось только одно.</p>
      <h3>Если чисел чётное количество</h3>
      <p>«Посередине» оказываются сразу два числа. Тогда медианой считают их среднее: у 10, 20, 30, 40 середина — 20 и 30, медиана 25.</p>
      <h3>Почему выброс почти не мешает</h3>
      <p>Медиана смотрит только на <b>порядок</b> чисел, а не на их величину. Если самое большое число станет в сто раз больше, оно всё равно останется самым большим, и серединное число не изменится. Среднее же учитывает величину каждого числа, поэтому тянется за выбросом.</p>
      <h3>Предел устойчивости</h3>
      <p>Один выброс медиану почти не двигает: самое большее, она сместится на соседнее число. А чтобы утащить её к выбросам, нужно испортить <b>больше половины</b> чисел. В этом смысле у медианы ${T('breakdown', 'предел устойчивости')} почти 50%, а у среднего — 0%: хватает одного. Попробуйте на примере справа: ползунок превращает в выбросы всё больше чисел.</p>
      <div class="note warn"><b>Цена.</b> Медиана «слепа» к величине: она не замечает и обычных небольших колебаний так же чутко, как среднее. На чистых данных она «шумит» чуть сильнее. Если спред в окне не просто колеблется, а уходит на новый уровень, медиана тоже уезжает (медленнее среднего).</div>
      <p>Внизу справа — реальный спред со скользящей медианой и скользящим средним.</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><h4>Ручной пример: среднее против медианы</h4><p class="cap">Меняйте числа. Ползунок заменяет первые k чисел выбросом (${med.big}).</p>
          <div class="calc-grid" id="nums"></div>
          <div class="btns"><button class="b" id="add">+ число</button><button class="b" id="del">− число</button></div>
          <div class="ctl" style="margin-top:8px"><label><span>Сколько чисел заменить выбросами, k</span><b id="kv"></b></label><input type="range" id="kk" min="0" step="1"></div>
          <p style="margin:10px 0 2px;color:#98a3b6;font-size:14px">По возрастанию (серединное выделено, выбросы красные):</p><div id="sorted"></div>
          <div class="kpis" id="kp"></div><div class="note" id="read"></div></div>
        <div class="viz"><h4>Реальный спред: скользящее среднее и скользящая медиана</h4>
          <div class="legend"><span><i style="background:${C.spread}"></i>спред</span><span><i style="background:${SIM}"></i>среднее окна</span><span><i style="background:${RB}"></i>медиана окна</span></div><div id="c"></div><div id="ctl"></div>
          <div class="ctl"><label><span><input type="checkbox" id="spy"> Добавить редкие выбросы в данные</span></label><div class="hint">Примерно в 3% дней — одиночный всплеск на 25–40 пунктов.</div></div></div>`;
      const nums = el.querySelector('#nums'), kk = el.querySelector('#kk');
      function build() {
        nums.style.gridTemplateColumns = 'repeat(auto-fit,minmax(74px,1fr))';
        nums.innerHTML = med.x.map((v, i) => '<div><label>Число ' + (i + 1) + '</label><input type="number" data-i="' + i + '" value="' + v + '" step="1"></div>').join('');
        kk.max = med.x.length;
      }
      let d, w, r;
      const chart = A.mkChart(el.querySelector('#c'), 240, { tip: (i) => w.mean[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>Спред: ' + f(d[i]) + '<br>Среднее: ' + f(w.mean[i]) + '<br>Медиана: ' + f(r.mean[i]) });
      function calc() {
        const len = med.x.length;
        med.k = Math.min(med.k, len);
        kk.value = med.k;
        el.querySelector('#kv').textContent = med.k + ' из ' + len;
        const shown = med.x.map((v, i) => (i < med.k ? med.big : v));
        const order = shown.map((v, i) => ({ v, bad: i < med.k })).sort((a, b) => a.v - b.v);
        const mid = midIdx(len);
        el.querySelector('#sorted').innerHTML = order.map((o, p) => chip(o.v, { mid: mid.indexOf(p) >= 0, bad: o.bad })).join('');
        const mean = shown.reduce((s, v) => s + v, 0) / len, md = E.median(shown);
        const mean0 = med.x.reduce((s, v) => s + v, 0) / len, md0 = E.median(med.x);
        const kp = [[f(mean), 'среднее', 'сумма ÷ количество'], [f(md), 'медиана', len % 2 ? 'серединное число' : 'среднее двух серединных'], [U.sgn(mean - mean0, 2), 'сдвиг среднего', 'относительно k = 0'], [U.sgn(md - md0, 2), 'сдвиг медианы', 'относительно k = 0']];
        el.querySelector('#kp').innerHTML = kp.map((x) => '<div class="kpi"><div class="v">' + x[0] + '</div><div class="l">' + x[1] + '</div><div class="e">' + x[2] + '</div></div>').join('');
        const broken = med.k > (len - 1) / 2;
        el.querySelector('#read').innerHTML = med.k === 0 ? 'Выбросов нет: среднее и медиана близки. Подвигайте ползунок.' :
          broken ? '<b>Выбросов ' + med.k + ' из ' + len + ': это больше половины.</b> Теперь серединное число — само выброс, и медиана тоже сломалась (сдвиг ' + U.sgn(md - md0, 1) + '). Это предел её устойчивости.' :
            '<b>Выбросов ' + med.k + ' из ' + len + ': меньше половины.</b> Среднее сдвинулось на ' + U.sgn(mean - mean0, 1) + ', а медиана — на ' + U.sgn(md - md0, 1) + ': она осталась среди обычных чисел.';
      }
      function draw() {
        const n = A.state.params.n;
        d = med.spiky ? E.spiky(A.data().spread, A.state.seed) : A.data().spread;
        w = E.rolling(d, n); r = E.robust(d, n);
        chart.render({ n: d.length, series: [{ data: d, color: C.spread, width: 1.1 }, { data: w.mean, color: SIM, width: 2 }, { data: r.mean, color: RB, width: 2 }] });
      }
      nums.addEventListener('input', (e) => { const i = e.target.dataset.i; if (i === undefined) return; const v = parseFloat(e.target.value); med.x[+i] = Number.isFinite(v) ? v : 0; calc(); });
      kk.addEventListener('input', () => { med.k = parseInt(kk.value, 10); calc(); });
      el.querySelector('#add').addEventListener('click', () => { if (med.x.length < 9) { med.x.push(med.x[med.x.length - 1] + 3); build(); calc(); } });
      el.querySelector('#del').addEventListener('click', () => { if (med.x.length > 3) { med.x.pop(); build(); calc(); } });
      const spy = el.querySelector('#spy');
      spy.checked = med.spiky;
      spy.addEventListener('change', () => { med.spiky = spy.checked; draw(); });
      A.controls(el.querySelector('#ctl'), [S.n], draw);
      build(); calc(); draw();
    }
  });

  /* ---------- 3. MAD и множитель 1,4826 ---------- */
  const mad = { x: [10, 12, 11, 13, 9, 14, 60] };
  const exper = { size: 4, seed: 5, bad: 0 };
  const SIZES = [20, 50, 100, 500, 2000, 20000];

  function sample(size, seed, badPct) {
    const rnd = E.mulberry32(seed);
    let spare = null;
    const g = () => {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0; while (u === 0) u = rnd();
      const v = rnd(), q = Math.sqrt(-2 * Math.log(u));
      spare = q * Math.sin(2 * Math.PI * v);
      return q * Math.cos(2 * Math.PI * v);
    };
    const xs = Array.from({ length: size }, g);
    const m = Math.round(size * badPct / 100);
    for (let i = 0; i < m; i++) xs[i] = i % 2 ? 10 : -10;
    return xs;
  }

  Z.push({
    id: 'mad',
    title: 'MAD и множитель 1,4826: замена для σ',
    lead: 'σ измеряет разброс и портится выбросами. Нужна мера разброса, построенная на медиане. Она называется MAD. Разберём, как её считать и откуда берётся странное число 1,4826.',
    text: () => `
      <h3>Что такое разброс</h3>
      <p>Разброс отвечает на вопрос «насколько обычные значения отходят от центра». Для σ центром служит среднее, для MAD — медиана.</p>
      <h3>Как посчитать MAD</h3>
      <ol>
        <li>Найти ${T('median', 'медиану')} чисел.</li>
        <li>Для каждого числа найти расстояние до медианы без знака, то есть ${T('abs_value', 'модуль')} разности: |число − медиана|.</li>
        <li>Взять <b>медиану этих расстояний</b>. Это и есть ${T('mad', 'MAD')} («медианное абсолютное отклонение»).</li>
      </ol>
      <p>Название читается справа налево по шагам: медиана (3) абсолютных (2) отклонений (1) от медианы.</p>
      <h3>Почему выброс не мешает</h3>
      <p>Выброс даёт одно очень большое расстояние. Но среди расстояний его ждёт та же участь, что и среди чисел: он просто окажется последним в очереди, а серединное расстояние не изменится.</p>
      <h3>Зачем множитель 1,4826</h3>
      <p>MAD и σ измеряют одно и то же в разных единицах: у колоколообразных данных (${T('normal', 'нормальное распределение')}) MAD составляет примерно 0,6745 от σ. Но в z-score мы делим на σ и сравниваем с порогами вроде «2σ». Чтобы пороги значили то же самое, MAD приводят к «шкале σ» умножением:</p>
      <span class="formula">σ<sub>робастная</sub> = 1,4826 × MAD<small>1 ÷ 0,6745 ≈ 1,4826 — ${T('mad_scale', 'поправочный множитель')}</small></span>
      <div class="note warn"><b>Это договорённость, а не закон.</b> Множитель точен для идеального колокола. У реальных спредов «хвосты» тяжелее (${T('fat_tails', 'толстые хвосты')}), поэтому порог «2σ» у робастной и обычной σ не будет значить в точности одно и то же. Опыт справа это показывает.</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><h4>Ручной пример: считаем MAD</h4><p class="cap">Семь чисел, последнее — выброс. Меняйте любые.</p>
          <div class="calc-grid" style="grid-template-columns:repeat(7,1fr)">${mad.x.map((v, i) => '<div><label>Число ' + (i + 1) + '</label><input type="number" data-i="' + i + '" value="' + v + '" step="1"></div>').join('')}</div>
          <div id="calc"></div></div>
        <div class="viz"><h4>Проверим множитель опытом</h4><p class="cap">Компьютер генерирует случайные числа в форме колокола (σ = 1) и сравнивает MAD с σ.</p>
          <div class="ctl"><label><span>Размер выборки</span><b id="szv"></b></label><input type="range" id="sz" min="0" max="${SIZES.length - 1}" step="1"><div class="hint">Чем больше чисел, тем ближе результат к «теории».</div></div>
          <div class="ctl"><label><span>Доля выбросов в выборке, %</span><b id="bdv"></b></label><input type="range" id="bd" min="0" max="30" step="1"><div class="hint">Выбросы — числа, удалённые от центра на 10 σ.</div></div>
          <div class="btns"><button class="b" id="again">Сгенерировать заново</button></div>
          <table class="t" id="tab"></table><div class="note" id="read"></div></div>`;
      const calcEl = el.querySelector('#calc');
      function drawCalc() {
        const x = mad.x, ex = E.explainRobust(x, x.length, x.length - 1);
        const len = x.length, mid = midIdx(len);
        const mean = x.reduce((s, v) => s + v, 0) / len, sd = Math.sqrt(x.reduce((s, v) => s + (v - mean) * (v - mean), 0) / len);
        const row = (k, title, text, val) => '<div class="row"><div class="n">' + k + '</div><div><b>' + title + '</b><div style="color:#98a3b6;font-size:14px">' + text + '</div>' + (val ? '<div class="v" style="display:block;width:fit-content">' + val + '</div>' : '') + '</div></div>';
        calcEl.innerHTML = '<p style="margin:12px 0 4px;color:#98a3b6;font-size:14px">Числа по возрастанию:</p>' + ex.sorted.map((v, p) => chip(v, { mid: mid.indexOf(p) >= 0 })).join('') +
          '<table class="t" style="margin-top:10px"><tr><th>Число x</th><th>x − медиана</th><th>Расстояние |x − медиана|</th></tr>' +
          ex.rows.map((r) => '<tr><td>' + fi(r.value) + '</td><td>' + U.sgn(r.dev, 2) + '</td><td>' + f(r.abs) + '</td></tr>').join('') + '</table>' +
          '<p style="margin:10px 0 4px;color:#98a3b6;font-size:14px">Расстояния по возрастанию:</p>' + ex.absSorted.map((v, p) => chip(v, { mid: mid.indexOf(p) >= 0 })).join('') +
          '<div class="calc-steps" style="margin-top:10px">' +
          row(1, 'Медиана чисел', len % 2 ? 'Нечётное количество: берём серединное.' : 'Чётное количество: среднее двух серединных.', f(ex.median)) +
          row(2, 'MAD', 'Медиана расстояний (нижний ряд выше).', f(ex.mad)) +
          row(3, 'Робастная σ', 'Умножаем MAD на 1,4826.', '1,4826 × ' + f(ex.mad) + ' = ' + f(ex.std, 3)) + '</div>' +
          '<div class="note">Для сравнения, обычное среднее этих чисел — ' + f(mean) + ', обычная σ — ' + f(sd) + '. ' + (sd > 2 * ex.std ? 'Обычная σ получилась больше робастной более чем вдвое: её раздул выброс.' : 'Здесь выбросов нет, и две оценки близки.') + '</div>';
      }
      calcEl.parentNode.querySelectorAll('input[data-i]').forEach((inp) => inp.addEventListener('input', () => { const v = parseFloat(inp.value); mad.x[+inp.dataset.i] = Number.isFinite(v) ? v : 0; drawCalc(); }));
      const sz = el.querySelector('#sz'), bd = el.querySelector('#bd');
      function drawExp() {
        sz.value = exper.size; bd.value = exper.bad;
        const size = SIZES[exper.size];
        el.querySelector('#szv').textContent = size.toLocaleString('ru-RU');
        el.querySelector('#bdv').textContent = exper.bad + '%';
        const xs = sample(size, exper.seed, exper.bad);
        const mean = xs.reduce((s, v) => s + v, 0) / size, sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / size);
        const m = E.median(xs), md = E.median(xs.map((v) => Math.abs(v - m)));
        el.querySelector('#tab').innerHTML = '<tr><th>Что измерили</th><th>Значение</th></tr>' +
          '<tr><td>σ (обычная)</td><td>' + f(sd, 3) + '</td></tr><tr><td>MAD</td><td>' + f(md, 3) + '</td></tr>' +
          '<tr><td>MAD ÷ σ</td><td>' + f(md / sd, 3) + '</td></tr><tr><td>1,4826 × MAD (робастная σ)</td><td>' + f(E.MAD_SCALE * md, 3) + '</td></tr>';
        el.querySelector('#read').innerHTML = exper.bad === 0 ?
          'Истинная σ этих чисел равна 1. Обычная σ получилась ' + f(sd, 3) + ', а 1,4826 × MAD — ' + f(E.MAD_SCALE * md, 3) + '. Отношение MAD ÷ σ — ' + f(md / sd, 3) + ' при теоретическом 0,6745. ' + (size <= 500 ? 'Выборка небольшая, поэтому числа заметно «гуляют»: сгенерируйте заново или увеличьте размер.' : 'На большой выборке числа почти совпадают с теорией.') :
          '<b>С выбросами (' + exper.bad + '%):</b> обычная σ выросла до ' + f(sd, 2) + ' (истинная — 1), а 1,4826 × MAD равна ' + f(E.MAD_SCALE * md, 2) + '. ' + (exper.bad >= 30 ? 'Выбросов уже слишком много, робастная σ тоже уплывает.' : 'Робастная оценка почти не поддалась, обычная — раздулась в разы.');
      }
      sz.addEventListener('input', () => { exper.size = parseInt(sz.value, 10); drawExp(); });
      bd.addEventListener('input', () => { exper.bad = parseInt(bd.value, 10); drawExp(); });
      el.querySelector('#again').addEventListener('click', () => { exper.seed++; drawExp(); });
      drawCalc(); drawExp();
    }
  });

  /* ---------- 4. Формулы и ручной пример ---------- */
  const hand = { x: [1, 2, 3, 4, 100] };

  Z.push({
    id: 'formulas',
    title: 'Формулы и ручной пример',
    lead: 'Собираем всё вместе: шесть шагов от окна цен до z-score. Расчёт на пяти числах можно повторить на бумаге, а справа он же — на реальном спреде.',
    wide: true,
    text: () => `
      <h3>Шаг 1. Окно</h3>
      <p>Берём последние N значений спреда, как и в простом z-score. Сегодняшний день входит в окно, будущих данных нет.</p>
      <h3>Шаг 2. ${T('median', 'Медиана')} окна</h3>
      <span class="formula">M = середина окна по возрастанию<small>нечётное N — серединное число; чётное N — среднее двух серединных</small></span>
      <h3>Шаг 3. Расстояния до медианы</h3>
      <span class="formula">d<sub>i</sub> = |x<sub>i</sub> − M|<small>x<sub>i</sub> — спред в i-й день окна</small></span>
      <h3>Шаг 4. ${T('mad', 'MAD')}</h3>
      <span class="formula">MAD = медиана из всех d<sub>i</sub></span>
      <h3>Шаг 5. Робастная σ</h3>
      <span class="formula">σ<sub>р</sub> = 1,4826 × MAD</span>
      <h3>Шаг 6. Z-score</h3>
      <span class="formula">z = (x<sub>сегодня</sub> − M) ÷ σ<sub>р</sub><small>всё остальное в стратегии (пороги, стоп, издержки) не меняется</small></span>
      <div class="note"><b>Что заменилось.</b> Было: среднее и σ. Стало: медиана и 1,4826 × MAD. Формула z и правила сделок — те же.</div>
      <div class="note warn"><b>Особый случай.</b> Если больше половины чисел в окне одинаковы, MAD = 0 и делить не на что: z не определён, и в этот день решения нет. На живых данных такое бывает у малоподвижных инструментов.</div>
      <p>Справа — расчёт на пяти числах: 1, 2, 3, 4 и выброс 100. Меняйте числа и сверяйте с шагами.</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><h4>Ручной пример: пять дней</h4><p class="cap">Слева направо от самого старого дня к сегодняшнему.</p>
          <div class="calc-grid" style="grid-template-columns:repeat(5,1fr)">${hand.x.map((v, i) => '<div><label>' + (i === 4 ? 'Сегодня' : (4 - i) + ' дн. назад') + '</label><input type="number" data-i="' + i + '" value="' + v + '" step="1"></div>').join('')}</div>
          <div id="calc"></div></div>
        <div class="viz"><h4>То же на реальных учебных данных</h4><p class="cap">Медиана и коридор ±1 σ<sub>р</sub>, ±2 σ<sub>р</sub>.</p>
          <div class="legend"><span><i style="background:${C.spread}"></i>спред</span><span><i style="background:${C.mean}"></i>медиана</span><span><i style="background:#5aa9ff"></i>± σ<sub>р</sub></span><span><i style="background:#f5a65b"></i>± 2σ<sub>р</sub></span></div><div id="ch"></div><div id="ctl"></div></div>`;
      const chart = A.mkChart(el.querySelector('#ch'), 250, { tip: (i) => { const r = E.robust(A.data().spread, A.state.params.n); return r.mean[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>Спред: ' + f(A.data().spread[i]) + '<br>Медиана: ' + f(r.mean[i]) + ' · σр: ' + f(r.std[i]) + '<br>z: ' + f(r.z[i]); } });
      function step(k, title, text, val) { return '<div class="row"><div class="n">' + k + '</div><div><b>' + title + '</b><div style="color:#98a3b6;font-size:14px">' + text + '</div><div class="v" style="display:block;width:fit-content">' + val + '</div></div></div>'; }
      function draw() {
        const x = hand.x, len = x.length, t = len - 1, ex = E.explainRobust(x, len, t), mid = midIdx(len);
        const mean = x.reduce((s, v) => s + v, 0) / len, sd = Math.sqrt(x.reduce((s, v) => s + (v - mean) * (v - mean), 0) / len);
        el.querySelector('#calc').innerHTML =
          '<p style="margin:12px 0 4px;color:#98a3b6;font-size:14px">Числа по возрастанию:</p>' + ex.sorted.map((v, p) => chip(v, { mid: mid.indexOf(p) >= 0 })).join('') +
          '<table class="t" style="margin-top:10px"><tr><th>День</th><th>Спред x</th><th>x − M</th><th>d = |x − M|</th></tr>' +
          ex.rows.map((r, i) => '<tr' + (i === t ? ' class="sel"' : '') + '><td>' + (i === t ? 'сегодня' : (t - i) + ' дн. назад') + '</td><td>' + fi(r.value) + '</td><td>' + U.sgn(r.dev, 2) + '</td><td>' + f(r.abs) + '</td></tr>').join('') + '</table>' +
          '<p style="margin:10px 0 4px;color:#98a3b6;font-size:14px">Расстояния d по возрастанию:</p>' + ex.absSorted.map((v, p) => chip(v, { mid: mid.indexOf(p) >= 0 })).join('') +
          '<div class="calc-steps" style="margin-top:10px">' +
          step(1, 'Медиана M', 'Серединное в верхнем ряду.', 'M = ' + f(ex.median)) +
          step(2, 'MAD', 'Серединное в нижнем ряду.', 'MAD = ' + f(ex.mad)) +
          step(3, 'Робастная σ', '1,4826 × MAD.', 'σр = 1,4826 × ' + f(ex.mad) + ' = ' + f(ex.std, 3)) +
          step(4, 'Z-score сегодняшнего дня', '(сегодня − M) ÷ σр.', ex.z === null ? 'MAD = 0: делить не на что, z не определён, решения нет' : 'z = (' + fi(x[t]) + ' − ' + f(ex.median) + ') ÷ ' + f(ex.std, 3) + ' = ' + f(ex.z)) + '</div>' +
          '<div class="note">Для сравнения, обычный z-score тех же чисел: среднее ' + f(mean) + ', σ ' + f(sd) + ', z = ' + (sd > 1e-9 ? f((x[t] - mean) / sd) : '—') + '. ' + (ex.z !== null && sd > 1e-9 && Math.abs(ex.z) > 3 * Math.abs((x[t] - mean) / sd) ? 'Обычная формула не заметила выброса: он сам раздул σ и спрятался. Робастная заметила сразу.' : 'Здесь два способа дают сопоставимые оценки.') + '</div>';
        const d = A.data().spread, r = E.robust(d, A.state.params.n);
        const band = (k) => r.mean.map((m, i) => (m === null ? null : m + k * r.std[i]));
        chart.render({ n: d.length, series: [{ data: band(2), color: SIM, width: 1, dash: [4, 4] }, { data: band(-2), color: SIM, width: 1, dash: [4, 4] }, { data: band(1), color: '#5aa9ff', width: 1, dash: [4, 4] }, { data: band(-1), color: '#5aa9ff', width: 1, dash: [4, 4] }, { data: r.mean, color: C.mean, width: 2 }, { data: d, color: C.spread }] });
      }
      el.querySelectorAll('input[data-i]').forEach((inp) => inp.addEventListener('input', () => { const v = parseFloat(inp.value); hand.x[+inp.dataset.i] = Number.isFinite(v) ? v : 0; draw(); }));
      A.controls(el.querySelector('#ctl'), [S.n], draw);
      draw();
    }
  });
})();
