/* EWMA, экраны 5–8: сравнение с окном, правила и сделки, пошаговый разбор, когда помогает и когда вредит. */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, S = window.SPECS;
  const C = U.COLORS;
  const Z = window.EWSCREENS;
  const WIN = '#f5a65b', EW = '#5aa9ff';
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 1 : d) + '</span>';
  const pct = (x) => U.fmt(x * 100, 1) + '%';
  const params = (mode) => Object.assign(A.btParams(), { mode });
  const run = (series, mode) => E.backtest(series, params(mode));

  /* ---------- 5. Сравнение ---------- */
  Z.push({
    id: 'compare',
    title: 'Сравнение с простым окном',
    lead: 'Формулы z-score и правила сделок у обеих стратегий одинаковые. Отличается только способ, которым считаются среднее и σ. Посмотрим, к чему это приводит на практике.',
    text: () => `
      <h3>Что одинаково</h3>
      <p>Спред, формула z = (спред − среднее) ÷ σ, пороги входа и выхода, стоп, издержки — всё то же самое. Меняются только два числа: среднее и σ.</p>
      <h3>Что видно на графиках</h3>
      <ul>
        <li><b>Среднее EWMA</b> быстрее разворачивается вслед за спредом: свежие дни в нём весят больше.</li>
        <li><b>σ EWMA</b> меняется плавно, без резких «обрывов» при выпадении дня из окна.</li>
        <li><b>Z-score EWMA</b> при том же N в среднем получается меньше по модулю. Цифры по 11 наборам данных — в таблице справа.</li>
      </ul>
      <div class="note warn"><b>Практический вывод: пороги нельзя переносить как есть.</b> Порог «2σ» в простом окне и «2σ» в EWMA — это разные по редкости события: у EWMA он срабатывает заметно реже. Сравнивать две стратегии при одинаковых порогах — всё равно что сравнивать температуру в градусах Цельсия и Фаренгейта, не заметив, что шкалы разные.</div>
      <p>Вероятная причина: у EWMA свежие дни весят больше, поэтому среднее в среднем ближе к текущему спреду, и отклонение от него выглядит скромнее. В таблице справа это можно проверить: сравните «среднее расстояние от спреда до среднего».</p>
      <p>Двигайте N и порог: цифры пересчитаются по всем 11 наборам учебных данных.</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><h4>Среднее: простое окно и EWMA</h4><div class="legend"><span><i style="background:${C.spread}"></i>спред</span><span><i style="background:${WIN}"></i>среднее окна</span><span><i style="background:${EW}"></i>среднее EWMA</span></div><div id="c1"></div></div>
        <div class="viz"><h4>Z-score: сравнение</h4><div class="legend"><span><i style="background:${WIN}"></i>z окна</span><span><i style="background:${EW}"></i>z EWMA</span></div><div id="c2"></div>
          <div id="ctl"></div></div>
        <div class="viz"><h4>Цифры по 11 наборам учебных данных</h4><table class="t" id="tab"></table><div class="note" id="read"></div></div>`;
      let w, e, d;
      const c1 = A.mkChart(el.querySelector('#c1'), 220, { tip: (i) => w.mean[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>Спред: ' + U.fmt(d[i]) + '<br>Среднее окна: ' + U.fmt(w.mean[i]) + '<br>Среднее EWMA: ' + U.fmt(e.mean[i]) });
      const c2 = A.mkChart(el.querySelector('#c2'), 220, { tip: (i) => w.z[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>z окна: ' + U.fmt(w.z[i]) + '<br>z EWMA: ' + U.fmt(e.z[i]) });
      function draw() {
        const p = A.state.params, n = p.n, thr = p.entryZ;
        d = A.data().spread; w = E.rolling(d, n); e = E.ewma(d, n);
        c1.render({ n: d.length, series: [{ data: d, color: C.spread, width: 1.2 }, { data: w.mean, color: WIN, width: 2 }, { data: e.mean, color: EW, width: 2 }] });
        const hl = [{ y: thr, color: '#ffffff55', label: '±' + U.fmt(thr) }, { y: -thr, color: '#ffffff55' }, { y: 0, color: '#ffffff33', dash: [] }];
        c2.render({ n: d.length, series: [{ data: w.z, color: WIN, width: 1.5 }, { data: e.z, color: EW, width: 1.5 }], hlines: hl, yMin: -4.5, yMax: 4.5 });
        const agg = { w: { n: 0, sig: 0, mx: 0, dist: 0 }, e: { n: 0, sig: 0, mx: 0, dist: 0 } };
        SEEDS.forEach((s) => {
          const x = E.generate({ seed: s }).spread;
          [['w', E.rolling(x, n)], ['e', E.ewma(x, n)]].forEach(([k, r]) => r.z.forEach((z, i) => {
            if (z === null) return;
            const a = agg[k]; a.n++; if (Math.abs(z) >= thr) a.sig++; a.mx = Math.max(a.mx, Math.abs(z)); a.dist += Math.abs(x[i] - r.mean[i]);
          }));
        });
        el.querySelector('#tab').innerHTML = '<tr><th></th><th>Простое окно</th><th>EWMA</th></tr>' +
          '<tr><td>Доля дней с |z| ≥ ' + U.fmt(thr) + '</td><td>' + pct(agg.w.sig / agg.w.n) + '</td><td>' + pct(agg.e.sig / agg.e.n) + '</td></tr>' +
          '<tr><td>Наибольший |z|</td><td>' + U.fmt(agg.w.mx) + '</td><td>' + U.fmt(agg.e.mx) + '</td></tr>' +
          '<tr><td>Среднее расстояние от спреда до среднего, пунктов</td><td>' + U.fmt(agg.w.dist / agg.w.n) + '</td><td>' + U.fmt(agg.e.dist / agg.e.n) + '</td></tr>';
        const rw = agg.w.sig / agg.w.n, re = agg.e.sig / agg.e.n;
        el.querySelector('#read').innerHTML = rw > 0 && re > 0 ? 'При N = ' + n + ' и пороге ' + U.fmt(thr) + 'σ простое окно даёт сигнал в <b>' + pct(rw) + '</b> дней, EWMA — в <b>' + pct(re) + '</b> (в ' + U.fmt(rw / re, 1) + ' раза ' + (rw > re ? 'реже' : 'чаще') + '). Чтобы сигналы были сопоставимы по частоте, порог EWMA пришлось бы подбирать отдельно.' : 'При таких настройках у одной из стратегий сигналов нет вообще: ' + (re === 0 ? 'EWMA' : 'простое окно') + '. Понизьте порог или увеличьте N.';
      }
      A.controls(el.querySelector('#ctl'), [S.nE, S.entryZ], draw);
      draw();
    }
  });

  /* ---------- 6. Правила и сделки ---------- */
  Z.push({
    id: 'trades',
    title: 'Правила и сделки на EWMA',
    lead: 'Правила торговли те же, что у простого z-score. Различие одно: решение принимается по z-score, посчитанному с экспоненциальными весами.',
    text: () => `
      <h3>Те же пять правил</h3>
      <ol>
        <li>z ≥ +порог входа → ${T('short_spread', 'шорт спреда')} (продать A, купить B);</li>
        <li>z ≤ −порог входа → ${T('long_spread', 'лонг спреда')} (купить A, продать B);</li>
        <li>z вернулся к порогу выхода → закрыть с прибылью;</li>
        <li>z ушёл за стоп → закрыть с убытком;</li>
        <li>одна позиция за раз.</li>
      </ol>
      <p>Подробности каждого правила — на <a href="#zscore/5" style="color:#7ee0b5">экране «Правила» простого z-score</a>. Результат сделки считается так же: направление × (спред на выходе − спред на входе) − издержки.</p>
      <h3>Что меняется</h3>
      <p>Меняются моменты, когда z пересекает пороги: среднее и σ у EWMA другие, поэтому и сигналы появляются в другие дни. Справа обе стратегии работают с <b>одними и теми же настройками</b> на одних и тех же данных.</p>
      <div class="note warn"><b>Помните про разные шкалы.</b> Как показал прошлый экран, одинаковые пороги дают разную частоту сигналов. Если у EWMA мало сделок, это не «плохая» или «хорошая» стратегия, а повод посмотреть на порог.</div>
      <div class="note bad"><b>Риски остаются теми же.</b> EWMA не защищает от разрыва связи, издержек и подгонки под прошлое, см. <a href="#zscore/9" style="color:#7ee0b5">экран «Риски и ловушки»</a>.</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><h4>Z-score EWMA и сделки</h4>
          <div class="legend"><span><i class="dot" style="background:${C.up}"></i>▲ лонг спреда</span><span><i class="dot" style="background:${C.down}"></i>▼ шорт спреда</span><span><i class="dot" style="background:${C.exit}"></i>✕ выход</span></div>
          <div id="c1"></div><div id="ctl"></div></div>
        <div class="viz"><h4>Накопленный результат, пунктов</h4><div class="legend"><span><i style="background:${WIN}"></i>простое окно</span><span><i style="background:${EW}"></i>EWMA</span></div><div id="c2"></div></div>
        <div class="viz"><h4>Итоги при одинаковых настройках</h4><table class="t" id="tab"></table></div>`;
      let d, b;
      const c1 = A.mkChart(el.querySelector('#c1'), 250, { tip: (i) => b.z[i] === null ? null : A.barTip(i, b) });
      const c2 = A.mkChart(el.querySelector('#c2'), 190, {});
      function draw() {
        d = A.data().spread;
        b = run(d, 'ewma');
        const sm = run(d, 'sma'), p = A.state.params;
        const lim = Math.max(4.5, p.stopZ + 0.5);
        c1.render({ n: d.length, series: [{ data: b.z, color: C.z }], hlines: A.zLines(p), spans: A.positionSpans(b), markers: A.tradeMarkers(b, (i) => b.z[i]), yMin: -lim, yMax: lim });
        c2.render({ n: d.length, series: [{ data: sm.equity, color: WIN, width: 2 }, { data: b.equity, color: EW, width: 2.4 }], hlines: [{ y: 0, color: '#ffffff44', dash: [] }] });
        const m = (x) => x.metrics, row = (name, f) => '<tr><td>' + name + '</td><td>' + f(m(sm)) + '</td><td>' + f(m(b)) + '</td></tr>';
        el.querySelector('#tab').innerHTML = '<tr><th></th><th>Простое окно</th><th>EWMA</th></tr>' +
          row('Сделок', (x) => x.count) + row('Прибыльных', (x) => (x.winRate === null ? '—' : Math.round(x.winRate * 100) + '%')) +
          row('Итог, пунктов', (x) => col(x.total)) + row('Макс. просадка', (x) => U.fmt(-x.maxDD, 1)) +
          row('Средняя сделка', (x) => (x.avg === null ? '—' : col(x.avg))) + row('Профит-фактор', (x) => (x.profitFactor === null ? '—' : U.fmt(x.profitFactor)));
      }
      A.controls(el.querySelector('#ctl'), [S.nE, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost, S.delayOn], draw);
      draw();
    }
  });

  /* ---------- 7. Пошаговый разбор ---------- */
  Z.push({
    id: 'walk',
    title: 'Пошаговый разбор: один день изнутри',
    lead: 'Те же шесть шагов, что в простом z-score, но теперь у каждого дня в окне есть вес. Выберите день и проследите расчёт до решения.',
    full: true,
    mount(el) {
      el.innerHTML = `
        <div style="display:grid;grid-template-columns:560px 1fr;gap:28px;align-items:start">
          <div>
            <div class="viz"><h4>Выбор дня: <span id="dayv"></span></h4><input type="range" id="day" style="margin-top:8px">
              <div class="btns"><button class="b" id="bp">◀ День назад</button><button class="b" id="bn">День вперёд ▶</button><button class="b" id="bs">К следующему сигналу</button><button class="b primary" id="play">▶ Автопроигрывание</button></div></div>
            <div class="viz calc-steps" id="steps"></div>
            <div class="viz"><h4>Настройки</h4><div id="ctl"></div></div>
          </div>
          <div>
            <div class="viz"><h4>Спред, среднее EWMA и пороги</h4><div id="c1"></div></div>
            <div class="viz"><h4>Z-score</h4><div id="c2"></div></div>
            <div class="viz"><h4>Веса и числа расчёта</h4><p class="cap">Дни от сегодняшнего к более старым. Нижняя строка собирает все ещё более старые дни.</p><div class="scroll" style="max-height:420px"><table class="t" id="win"></table></div></div>
          </div>
        </div>`;
      if (window.__stepTimer) clearInterval(window.__stepTimer);
      const d = A.data().spread, n = d.length;
      const day = el.querySelector('#day');
      day.min = 1; day.max = n; day.step = 1;
      const bt = () => run(d, 'ewma');
      const firstSignal = () => { const i = bt().signal.findIndex((s) => s); return i < 0 ? A.state.params.n - 1 : i; };
      let t = A.state.bar !== null && A.state.bar >= A.state.params.n - 1 ? A.state.bar : firstSignal();
      const c1 = A.mkChart(el.querySelector('#c1'), 230, { tip: (i) => A.barTip(i, bt()), onClick: (i) => { t = i; draw(); } });
      const c2 = A.mkChart(el.querySelector('#c2'), 180, { tip: (i) => A.barTip(i, bt()), onClick: (i) => { t = i; draw(); } });
      A.controls(el.querySelector('#ctl'), [S.nE, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost, S.delayOn], draw);
      day.addEventListener('input', () => { t = parseInt(day.value, 10) - 1; draw(); });
      el.querySelector('#bp').addEventListener('click', () => { t = Math.max(0, t - 1); draw(); });
      el.querySelector('#bn').addEventListener('click', () => { t = Math.min(n - 1, t + 1); draw(); });
      el.querySelector('#bs').addEventListener('click', () => { const b = bt(); let i = t + 1; while (i < n && !b.signal[i]) i++; t = i < n ? i : firstSignal(); draw(); });
      el.querySelector('#play').addEventListener('click', (ev) => {
        if (window.__stepTimer) { clearInterval(window.__stepTimer); window.__stepTimer = null; ev.target.textContent = '▶ Автопроигрывание'; return; }
        ev.target.textContent = '❚❚ Пауза';
        window.__stepTimer = setInterval(() => { if (t >= n - 1) { clearInterval(window.__stepTimer); window.__stepTimer = null; ev.target.textContent = '▶ Автопроигрывание'; return; } t++; draw(); }, 350);
      });
      const row = (k, title, text, val) => '<div class="row"><div class="n">' + k + '</div><div><b>' + title + '</b><div style="color:#98a3b6;font-size:14px">' + text + '</div>' + (val ? '<div class="v">' + val + '</div>' : '') + '</div></div>';
      function draw() {
        const p = A.state.params, b = bt(), f = (v, k) => U.fmt(v, k === undefined ? 3 : k);
        if (t < p.n - 1) t = p.n - 1;
        A.state.bar = t;
        day.value = t + 1;
        el.querySelector('#dayv').textContent = 'день ' + (t + 1) + ' из ' + n;
        const ex = E.explainEwma(d, p.n, t, 12);
        const dec = A.decisionText(t, b, b.params);
        const q = 1 - ex.alpha;
        el.querySelector('#steps').innerHTML =
          row(1, 'Скорость забывания', 'N = ' + p.n + ', поэтому α = 2 ÷ (' + p.n + ' + 1), а каждый день в прошлом весит в (1 − α) раз меньше предыдущего.', 'α = ' + f(ex.alpha, 4) + ';  1 − α = ' + f(q, 4)) +
          row(2, 'Веса', 'Сегодня вес 1, вчера ' + f(q) + ', позавчера ' + f(q * q) + ' и так далее (столбец «Вес» справа). Доля веса дней старше показанных — ' + pct(ex.earlierShare) + '.', 'W = Σ весов = ' + f(ex.W)) +
          row(3, 'Взвешенное среднее', 'Умножаем каждый спред на его вес, складываем и делим на W.', 'Σ(w·x) = ' + f(ex.Wx) + ';  ' + f(ex.Wx) + ' ÷ ' + f(ex.W) + ' = ' + f(ex.mean)) +
          row(4, 'Взвешенная дисперсия и σ', 'Для каждого дня: вес × (спред − среднее)², складываем, делим на W, берём корень.', 'Σ = ' + f(ex.Wsq) + ';  ' + f(ex.Wsq) + ' ÷ ' + f(ex.W) + ' = ' + f(ex.variance) + ';  √ = ' + f(ex.std)) +
          row(5, 'Z-score', 'Сегодняшний спред минус среднее, делённый на σ.', 'z = (' + f(ex.value, 2) + ' − ' + f(ex.mean) + ') ÷ ' + f(ex.std) + ' = ' + f(ex.z)) +
          '<div class="row"><div class="n">6</div><div><b>Решение</b><div class="decision ' + dec.cls + '">' + dec.html + '</div></div></div>';
        const band = (k) => b.mean.map((m, i) => (m === null ? null : m + k * b.std[i]));
        c1.render({ n, series: [{ data: band(p.entryZ), color: WIN, width: 1, dash: [4, 4] }, { data: band(-p.entryZ), color: WIN, width: 1, dash: [4, 4] }, { data: b.mean, color: C.mean, width: 1.6 }, { data: d, color: C.spread }], cursor: t, markers: A.tradeMarkers(b, (i) => d[i]) });
        const lim = Math.max(4.5, p.stopZ + 0.5);
        c2.render({ n, series: [{ data: b.z, color: C.z }], hlines: A.zLines(p), cursor: t, markers: A.tradeMarkers(b, (i) => b.z[i]), yMin: -lim, yMax: lim });
        el.querySelector('#win').innerHTML = '<tr><th>Дней назад</th><th>День</th><th>Спред x</th><th>Вес w</th><th>Доля веса</th><th>w · x</th><th>x − среднее</th><th>w · (x − ср.)²</th></tr>' +
          ex.rows.slice().reverse().map((r) => '<tr' + (r.k === 0 ? ' class="sel"' : '') + '><td>' + r.k + '</td><td>' + (r.idx + 1) + '</td><td>' + f(r.value, 2) + '</td><td>' + f(r.w) + '</td><td>' + pct(r.share) + '</td><td>' + f(r.wx) + '</td><td>' + U.sgn(r.dev, 2) + '</td><td>' + f(r.wsq, 2) + '</td></tr>').join('') +
          (ex.earlier.count ? '<tr><td colspan="2">ещё ' + ex.earlier.count + ' более старых дн.</td><td></td><td>' + f(ex.earlier.w) + '</td><td>' + pct(ex.earlierShare) + '</td><td>' + f(ex.earlier.wx) + '</td><td></td><td>' + f(ex.earlier.wsq, 2) + '</td></tr>' : '') +
          '<tr><td colspan="2"><b>Σ</b></td><td></td><td><b>' + f(ex.W) + '</b></td><td><b>100%</b></td><td><b>' + f(ex.Wx) + '</b></td><td></td><td><b>' + f(ex.Wsq, 2) + '</b></td></tr>';
      }
      draw();
    }
  });

  /* ---------- 8. Когда помогает и когда вредит ---------- */
  const SCEN = [
    { name: 'Обычные данные', gen: (s) => E.generate({ seed: s }).spread, note: 'Спред всё время колеблется возле одного уровня, никаких сюрпризов.' },
    { name: 'Смена уровня', gen: (s) => E.generate({ seed: s, breakAt: 200 }).spread, note: 'С 200-го дня связь меняется: спред начинает устойчиво уходить вверх и не возвращается. Это самый неприятный для стратегии сценарий.' },
    { name: 'Редкие выбросы', gen: (s) => E.spiky(E.generate({ seed: s }).spread, s), note: 'Примерно в 3% дней случается одиночный всплеск спреда на 25–40 пунктов в случайную сторону.' }
  ];

  Z.push({
    id: 'verdict',
    title: 'Когда помогает и когда вредит',
    lead: 'Какая из двух стратегий лучше? Честный ответ зависит от данных. Вместо слов — эксперимент: три сценария, 11 наборов данных в каждом, ваши настройки.',
    full: true,
    mount(el) {
      el.innerHTML = `
        <div class="note warn"><b>Как читать.</b> Сценарии придуманы мной на синтетических данных и показывают механику, а не доказывают превосходство. Итог зависит от настроек: подвигайте порог входа и N и посмотрите, как меняется картина.</div>
        <div class="viz" style="margin-top:16px"><div class="btns" id="tabs" style="margin:0 0 12px"></div><p id="snote" style="margin:0 0 10px;color:#98a3b6"></p><div id="ctl"></div><div id="sum" class="note" style="margin-top:10px"></div><div class="scroll" style="max-height:none;margin-top:12px"><table class="t" id="tab"></table></div></div>
        <h3 style="margin:30px 0 14px">Итоги простыми словами</h3>
        <div class="cards" id="cards"></div>`;
      let cur = 0;
      const tabs = el.querySelector('#tabs');
      tabs.innerHTML = SCEN.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { cur = +b.dataset.i; draw(); } });
      function draw() {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === cur));
        el.querySelector('#snote').textContent = SCEN[cur].note;
        const sc = SCEN[cur];
        let wins = 0, tw = 0, te = 0, dw = 0, de = 0, nw = 0, ne = 0;
        const rows = SEEDS.map((s) => {
          const x = sc.gen(s), a = run(x, 'sma').metrics, b = run(x, 'ewma').metrics;
          if (b.total > a.total) wins++;
          tw += a.total; te += b.total; dw += a.maxDD; de += b.maxDD; nw += a.count; ne += b.count;
          return '<tr><td>Набор ' + s + '</td><td>' + a.count + '</td><td>' + col(a.total) + '</td><td>' + U.fmt(-a.maxDD, 1) + '</td><td>' + b.count + '</td><td>' + col(b.total) + '</td><td>' + U.fmt(-b.maxDD, 1) + '</td></tr>';
        });
        el.querySelector('#tab').innerHTML = '<tr><th rowspan="2"></th><th colspan="3" style="text-align:center">Простое окно</th><th colspan="3" style="text-align:center">EWMA</th></tr><tr><th>сделок</th><th>итог</th><th>макс. просадка</th><th>сделок</th><th>итог</th><th>макс. просадка</th></tr>' + rows.join('') +
          '<tr><td><b>Сумма</b></td><td><b>' + nw + '</b></td><td><b>' + col(tw) + '</b></td><td><b>' + U.fmt(-dw, 1) + '</b></td><td><b>' + ne + '</b></td><td><b>' + col(te) + '</b></td><td><b>' + U.fmt(-de, 1) + '</b></td></tr>';
        const better = te > tw ? 'EWMA' : te < tw ? 'простое окно' : 'обе одинаково';
        el.querySelector('#sum').innerHTML = 'Сценарий «<b>' + sc.name + '</b>»: по сумме итогов впереди <b>' + better + '</b> (' + col(tw, 0) + ' у окна против ' + col(te, 0) + ' у EWMA). EWMA лучше окна в <b>' + wins + ' из ' + SEEDS.length + '</b> наборов. Сумма максимальных просадок: ' + U.fmt(dw, 0) + ' у окна против ' + U.fmt(de, 0) + ' у EWMA. Сделок: ' + nw + ' против ' + ne + '.';
      }
      A.controls(el.querySelector('#ctl'), [S.nE, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost], draw);
      const cards = [
        ['Где EWMA может помочь', 'После смены уровня её среднее быстрее догоняет новый уровень, и стратегия реже «шортит рост» против устойчивого движения. Также σ не обрывается скачком, когда выброс покидает окно.'],
        ['Где EWMA может навредить', 'Свежие дни влияют сильнее, поэтому в момент выброса σ у неё раздувается заметнее, а z в обычные дни получается меньше: при тех же порогах сигналов меньше, и часть возможностей пропадает.'],
        ['Что не меняется', 'Всё, о чём говорилось в разборе простого z-score: связь может порваться, издержки съедают малую прибыль, подбор параметров по прошлому оптимистичен, а данные здесь синтетические.'],
        ['Как не обмануться', 'Сравнивайте стратегии при подобранных отдельно порогах и на данных, которых не было при подборе. Одинаковые пороги — не одинаковые условия, потому что у стратегий разные шкалы z.']
      ];
      el.querySelector('#cards').innerHTML = cards.map((c) => '<div class="card"><h4>' + c[0] + '</h4><p>' + c[1] + '</p></div>').join('');
      draw();
    }
  });
})();
