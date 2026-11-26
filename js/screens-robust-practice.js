/* Робастный z-score, экраны 5–8: сравнение с простым окном, правила и сделки, пошаговый разбор, когда помогает и когда вредит. */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, S = window.SPECS;
  const C = U.COLORS;
  const Z = window.RBSCREENS;
  const SIM = '#f5a65b', RB = '#7ee0b5', EW = '#5aa9ff';
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 1 : d) + '</span>';
  const pct = (x) => U.fmt(x * 100, 1) + '%';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const params = (mode) => Object.assign(A.btParams(), { mode });
  const run = (series, mode) => E.backtest(series, params(mode));
  const chip = (v, o) => '<span style="display:inline-block;padding:3px 7px;margin:2px;border-radius:6px;background:#232a3b;font-size:13px;font-variant-numeric:tabular-nums;' +
    (o && o.mid ? 'background:#7ee0b522;outline:1px solid ' + RB + ';' : '') + '">' + f(v, Number.isInteger(v) ? 0 : 1) + '</span>';
  const midIdx = (len) => (len % 2 ? [len >> 1] : [len / 2 - 1, len / 2]);

  const SCEN = [
    { name: 'Обычные данные', gen: (s) => E.generate({ seed: s }).spread, note: 'Спред всё время колеблется возле одного уровня, никаких сюрпризов.' },
    { name: 'Смена уровня', gen: (s) => E.generate({ seed: s, breakAt: 200 }).spread, note: 'С 200-го дня связь меняется: спред начинает устойчиво уходить вверх и не возвращается. Это самый неприятный для стратегии сценарий.' },
    { name: 'Редкие выбросы', gen: (s) => E.spiky(E.generate({ seed: s }).spread, s), note: 'Примерно в 3% дней случается одиночный всплеск спреда на 25–40 пунктов в случайную сторону, после чего всё возвращается.' }
  ];

  // «Дёрганость» σ: средняя доля, на которую σ меняется за один день.
  function agg(gen, n, thr) {
    const o = { w: { n: 0, sig: 0, mx: 0, jump: 0, jc: 0 }, r: { n: 0, sig: 0, mx: 0, jump: 0, jc: 0 } };
    SEEDS.forEach((s) => {
      const x = gen(s);
      [['w', E.rolling(x, n)], ['r', E.robust(x, n)]].forEach(([k, st]) => {
        const a = o[k];
        st.z.forEach((z) => { if (z === null) return; a.n++; if (Math.abs(z) >= thr) a.sig++; a.mx = Math.max(a.mx, Math.abs(z)); });
        for (let i = 1; i < x.length; i++) if (st.std[i] !== null && st.std[i - 1] !== null && st.std[i - 1] > 1e-9) { a.jump += Math.abs(st.std[i] / st.std[i - 1] - 1); a.jc++; }
      });
    });
    return o;
  }

  /* ---------- 5. Сравнение ---------- */
  const cmp = { cur: 0 };

  Z.push({
    id: 'compare',
    title: 'Сравнение с простым окном',
    lead: 'Формула z и правила сделок у обеих стратегий одинаковые. Отличаются два числа внутри формулы: центр и разброс. Посмотрим, к чему это приводит на разных данных.',
    text: () => `
      <h3>Что одинаково</h3>
      <p>Спред, формула z = (спред − центр) ÷ разброс, пороги входа и выхода, стоп, издержки. Меняется только то, как считаются центр (среднее → ${T('median', 'медиана')}) и разброс (σ → 1,4826 × ${T('mad', 'MAD')}).</p>
      <h3>Что видно на графиках</h3>
      <ul>
        <li><b>Центр.</b> Среднее вздрагивает от каждого выброса, а медиана почти не замечает его.</li>
        <li><b>Разброс.</b> Выброс раздувает σ на все N дней, пока он в окне. Робастная σ остаётся на месте. Но на обычных данных она, наоборот, меняется от дня к дню сильнее: MAD опирается всего на одно серединное число из окна, а σ усредняет все дни сразу и потому от дня к дню меняется плавнее (зато её легко сломать выбросом).</li>
        <li><b>Z-score.</b> В день выброса и в следующие дни робастный z заметно больше по модулю. Простое окно в это время «оглохло».</li>
      </ul>
      <div class="note warn"><b>Практический вывод: пороги нельзя переносить как есть.</b> Порог «2σ» в простом окне и «2σ» в робастном варианте — события разной редкости: таблица справа показывает, как часто каждое срабатывает. Сравнивать стратегии при одинаковых порогах — всё равно что сравнивать градусы Цельсия и Фаренгейта, не заметив, что шкалы разные.</div>
      <p>Переключайте сценарий и двигайте N и порог: цифры пересчитываются по всем 11 наборам учебных данных.</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><div class="btns" id="tabs" style="margin:0 0 10px"></div><p id="snote" style="margin:0 0 10px;color:#98a3b6"></p>
          <h4>Центр: среднее и медиана</h4><div class="legend"><span><i style="background:${C.spread}"></i>спред</span><span><i style="background:${SIM}"></i>среднее окна</span><span><i style="background:${RB}"></i>медиана</span></div><div id="c1"></div></div>
        <div class="viz"><h4>Разброс: σ и робастная σ</h4><div class="legend"><span><i style="background:${SIM}"></i>σ окна</span><span><i style="background:${RB}"></i>робастная σ</span></div><div id="c2"></div></div>
        <div class="viz"><h4>Z-score: сравнение</h4><div class="legend"><span><i style="background:${SIM}"></i>z окна</span><span><i style="background:${RB}"></i>z робастный</span></div><div id="c3"></div><div id="ctl"></div></div>
        <div class="viz"><h4>Цифры по 11 наборам учебных данных</h4><table class="t" id="tab"></table><div class="note" id="read"></div></div>`;
      const tabs = el.querySelector('#tabs');
      tabs.innerHTML = SCEN.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { cmp.cur = +b.dataset.i; draw(); } });
      let d, w, r;
      const tip = (fn) => (i) => (w.z[i] === null ? null : fn(i));
      const c1 = A.mkChart(el.querySelector('#c1'), 200, { tip: tip((i) => '<b>День ' + (i + 1) + '</b><br>Спред: ' + f(d[i]) + '<br>Среднее: ' + f(w.mean[i]) + '<br>Медиана: ' + f(r.mean[i])) });
      const c2 = A.mkChart(el.querySelector('#c2'), 170, { tip: tip((i) => '<b>День ' + (i + 1) + '</b><br>σ окна: ' + f(w.std[i]) + '<br>Робастная σ: ' + f(r.std[i])) });
      const c3 = A.mkChart(el.querySelector('#c3'), 200, { tip: tip((i) => '<b>День ' + (i + 1) + '</b><br>z окна: ' + f(w.z[i]) + '<br>z робастный: ' + (r.z[i] === null ? '—' : f(r.z[i]))) });
      function draw() {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === cmp.cur));
        const sc = SCEN[cmp.cur], p = A.state.params, n = p.n, thr = p.entryZ;
        el.querySelector('#snote').textContent = sc.note;
        d = sc.gen(A.state.seed); w = E.rolling(d, n); r = E.robust(d, n);
        c1.render({ n: d.length, series: [{ data: d, color: C.spread, width: 1.1 }, { data: w.mean, color: SIM, width: 2 }, { data: r.mean, color: RB, width: 2 }] });
        c2.render({ n: d.length, series: [{ data: w.std, color: SIM, width: 2 }, { data: r.std, color: RB, width: 2 }], yMin: 0 });
        c3.render({ n: d.length, series: [{ data: w.z, color: SIM, width: 1.4 }, { data: r.z, color: RB, width: 1.4 }], hlines: [{ y: thr, color: '#ffffff55', label: '±' + f(thr) }, { y: -thr, color: '#ffffff55' }, { y: 0, color: '#ffffff33', dash: [] }], yMin: -6, yMax: 6 });
        const g = agg(sc.gen, n, thr), a = g.w, b = g.r;
        el.querySelector('#tab').innerHTML = '<tr><th></th><th>Простое окно</th><th>Робастный</th></tr>' +
          '<tr><td>Доля дней с |z| ≥ ' + f(thr) + '</td><td>' + pct(a.sig / a.n) + '</td><td>' + pct(b.sig / b.n) + '</td></tr>' +
          '<tr><td>Наибольший |z|</td><td>' + f(a.mx) + '</td><td>' + f(b.mx) + '</td></tr>' +
          '<tr><td>«Дёрганость» σ: на сколько в среднем меняется σ за день</td><td>' + pct(a.jump / a.jc) + '</td><td>' + pct(b.jump / b.jc) + '</td></tr>';
        el.querySelector('#read').innerHTML = 'Сценарий «<b>' + sc.name + '</b>», N = ' + n + ', порог ' + f(thr) + 'σ. Простое окно даёт сигнал в <b>' + pct(a.sig / a.n) + '</b> дней, робастный вариант — в <b>' + pct(b.sig / b.n) + '</b>. Наибольший |z|: ' + f(a.mx, 1) + ' против ' + f(b.mx, 1) + '. σ за день меняется в среднем на ' + pct(a.jump / a.jc) + ' у простого окна и на ' + pct(b.jump / b.jc) + ' у робастного: ' + (b.jump > a.jump ? 'робастная σ «дёрганее», это цена за устойчивость к выбросам.' : 'робастная σ здесь не дёрганее.');
      }
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ], draw);
      draw();
    }
  });

  /* ---------- 6. Правила и сделки ---------- */
  Z.push({
    id: 'trades',
    title: 'Правила и сделки на робастном z',
    lead: 'Правила торговли те же, что у простого z-score. Различие одно: решение принимается по z, посчитанному через медиану и MAD.',
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
      <p>Меняются моменты, когда z пересекает пороги. Справа обе стратегии работают с <b>одними и теми же настройками</b> на одних и тех же данных.</p>
      <h3>Особенность: сделки на выбросах</h3>
      <p>В день выброса робастный z огромный, и правила скажут «входить». Что будет дальше, зависит от природы выброса:</p>
      <ul>
        <li>если спред действительно подскочил и вернулся (как в наших учебных данных), сделка может оказаться удачной;</li>
        <li>если это ошибочная цена, по которой сделку реально не совершить, вход по ней — просто потеря: комиссия плюс сделка по неверной цене.</li>
      </ul>
      <div class="note bad"><b>Риски остаются теми же.</b> Робастность не защищает от разрыва связи, издержек и подгонки под прошлое, см. <a href="#zscore/9" style="color:#7ee0b5">экран «Риски и ловушки»</a>. А если больше половины значений в окне совпадают, MAD = 0, z не определён, и в такой день решения нет.</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><h4>Робастный z-score и сделки</h4>
          <div class="legend"><span><i class="dot" style="background:${C.up}"></i>▲ лонг спреда</span><span><i class="dot" style="background:${C.down}"></i>▼ шорт спреда</span><span><i class="dot" style="background:${C.exit}"></i>✕ выход</span></div>
          <div id="c1"></div><div id="ctl"></div></div>
        <div class="viz"><h4>Накопленный результат, пунктов</h4><div class="legend"><span><i style="background:${SIM}"></i>простое окно</span><span><i style="background:${RB}"></i>робастный</span></div><div id="c2"></div></div>
        <div class="viz"><h4>Итоги при одинаковых настройках</h4><table class="t" id="tab"></table></div>`;
      let d, b;
      const c1 = A.mkChart(el.querySelector('#c1'), 250, { tip: (i) => b.z[i] === null ? null : A.barTip(i, b) });
      const c2 = A.mkChart(el.querySelector('#c2'), 190, {});
      function draw() {
        d = A.data().spread;
        b = run(d, 'robust');
        const sm = run(d, 'sma'), p = A.state.params;
        const lim = Math.max(6, p.stopZ + 0.5);
        c1.render({ n: d.length, series: [{ data: b.z, color: C.z }], hlines: A.zLines(p), spans: A.positionSpans(b), markers: A.tradeMarkers(b, (i) => b.z[i]), yMin: -lim, yMax: lim });
        c2.render({ n: d.length, series: [{ data: sm.equity, color: SIM, width: 2 }, { data: b.equity, color: RB, width: 2.4 }], hlines: [{ y: 0, color: '#ffffff44', dash: [] }] });
        const m = (x) => x.metrics, row = (name, fn) => '<tr><td>' + name + '</td><td>' + fn(m(sm)) + '</td><td>' + fn(m(b)) + '</td></tr>';
        el.querySelector('#tab').innerHTML = '<tr><th></th><th>Простое окно</th><th>Робастный</th></tr>' +
          row('Сделок', (x) => x.count) + row('Прибыльных', (x) => (x.winRate === null ? '—' : Math.round(x.winRate * 100) + '%')) +
          row('Итог, пунктов', (x) => col(x.total)) + row('Макс. просадка', (x) => U.fmt(-x.maxDD, 1)) +
          row('Средняя сделка', (x) => (x.avg === null ? '—' : col(x.avg))) + row('Профит-фактор', (x) => (x.profitFactor === null ? '—' : U.fmt(x.profitFactor)));
      }
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost, S.delayOn], draw);
      draw();
    }
  });

  /* ---------- 7. Пошаговый разбор ---------- */
  Z.push({
    id: 'walk',
    title: 'Пошаговый разбор: один день изнутри',
    lead: 'Выберите день и пройдите весь расчёт: сортировка окна, медиана, расстояния, MAD, σ, z и решение. Все числа видны в таблице.',
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
            <div class="viz"><h4>Спред, медиана и пороги</h4><div id="c1"></div></div>
            <div class="viz"><h4>Робастный z-score</h4><div id="c2"></div></div>
            <div class="viz"><h4>Числа окна</h4><p class="cap">Сверху вниз: значения окна по возрастанию, их расстояния до медианы по возрастанию, затем таблица по дням. Серединные числа выделены.</p>
              <div class="scroll" style="max-height:480px"><div id="s1"></div><div id="s2" style="margin-top:6px"></div><table class="t" id="win" style="margin-top:10px"></table></div></div>
          </div>
        </div>`;
      if (window.__stepTimer) clearInterval(window.__stepTimer);
      const d = A.data().spread, n = d.length;
      const day = el.querySelector('#day');
      day.min = 1; day.max = n; day.step = 1;
      const bt = () => run(d, 'robust');
      const firstSignal = () => { const i = bt().signal.findIndex((s) => s); return i < 0 ? A.state.params.n - 1 : i; };
      let t = A.state.bar !== null && A.state.bar >= A.state.params.n - 1 ? A.state.bar : firstSignal();
      const c1 = A.mkChart(el.querySelector('#c1'), 230, { tip: (i) => A.barTip(i, bt()), onClick: (i) => { t = i; draw(); } });
      const c2 = A.mkChart(el.querySelector('#c2'), 180, { tip: (i) => A.barTip(i, bt()), onClick: (i) => { t = i; draw(); } });
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost, S.delayOn], draw);
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
        const p = A.state.params, b = bt(), g = (v, k) => U.fmt(v, k === undefined ? 3 : k);
        if (t < p.n - 1) t = p.n - 1;
        A.state.bar = t;
        day.value = t + 1;
        el.querySelector('#dayv').textContent = 'день ' + (t + 1) + ' из ' + n;
        const ex = E.explainRobust(d, p.n, t), mid = midIdx(p.n);
        const dec = A.decisionText(t, b, b.params);
        const parity = p.n % 2 ? 'N = ' + p.n + ' нечётное: берём серединное число (номер ' + (mid[0] + 1) + ' по порядку).' : 'N = ' + p.n + ' чётное: берём среднее двух серединных (номера ' + (mid[0] + 1) + ' и ' + (mid[1] + 1) + ').';
        el.querySelector('#steps').innerHTML =
          row(1, 'Берём окно', 'Последние N = ' + p.n + ' значений спреда: дни с ' + (t - p.n + 2) + ' по ' + (t + 1) + '.') +
          row(2, 'Сортируем и находим медиану M', parity + ' Ряд по возрастанию — справа.', 'M = ' + g(ex.median)) +
          row(3, 'Расстояния до медианы', 'Для каждого дня: |спред − M| (столбец d в таблице справа).') +
          row(4, 'MAD', 'Сортируем расстояния и берём серединное так же, как в шаге 2.', 'MAD = ' + g(ex.mad)) +
          row(5, 'Робастная σ', 'Умножаем MAD на поправочный множитель 1,4826.', 'σр = 1,4826 × ' + g(ex.mad) + ' = ' + g(ex.std)) +
          row(6, 'Z-score', 'Сегодняшний спред минус медиана, делённый на σр.', ex.z === null ? 'MAD = 0: делить не на что, z не определён' : 'z = (' + g(ex.value, 2) + ' − ' + g(ex.median) + ') ÷ ' + g(ex.std) + ' = ' + g(ex.z)) +
          '<div class="row"><div class="n">7</div><div><b>Решение</b><div class="decision ' + dec.cls + '">' + dec.html + '</div></div></div>';
        const band = (k) => b.mean.map((m, i) => (m === null ? null : m + k * b.std[i]));
        c1.render({ n, series: [{ data: band(p.entryZ), color: SIM, width: 1, dash: [4, 4] }, { data: band(-p.entryZ), color: SIM, width: 1, dash: [4, 4] }, { data: b.mean, color: C.mean, width: 1.6 }, { data: d, color: C.spread }], spans: [{ i0: t - p.n + 1, i1: t, color: '#c9b6ff1c' }], cursor: t, markers: A.tradeMarkers(b, (i) => d[i]) });
        const lim = Math.max(6, p.stopZ + 0.5);
        c2.render({ n, series: [{ data: b.z, color: C.z }], hlines: A.zLines(p), cursor: t, markers: A.tradeMarkers(b, (i) => b.z[i]), yMin: -lim, yMax: lim });
        el.querySelector('#s1').innerHTML = ex.sorted.map((v, i) => chip(v, { mid: mid.indexOf(i) >= 0 })).join('');
        el.querySelector('#s2').innerHTML = ex.absSorted.map((v, i) => chip(v, { mid: mid.indexOf(i) >= 0 })).join('');
        el.querySelector('#win').innerHTML = '<tr><th>День</th><th>Спред x</th><th>x − M</th><th>d = |x − M|</th></tr>' +
          ex.rows.map((r) => '<tr' + (r.idx === t ? ' class="sel"' : '') + '><td>' + (r.idx + 1) + '</td><td>' + g(r.value, 2) + '</td><td>' + U.sgn(r.dev, 2) + '</td><td>' + g(r.abs, 2) + '</td></tr>').join('');
      }
      draw();
    }
  });

  /* ---------- 8. Когда помогает и когда вредит ---------- */
  const MODES = [['sma', 'Простое окно', SIM], ['ewma', 'EWMA', EW], ['robust', 'Робастный', RB]];
  const verdict = { cur: 0 };

  Z.push({
    id: 'verdict',
    title: 'Когда помогает и когда вредит',
    lead: 'Какая из трёх стратегий лучше? Честный ответ зависит от данных. Вместо слов — эксперимент: три сценария, 11 наборов данных в каждом, три стратегии, ваши настройки.',
    full: true,
    mount(el) {
      el.innerHTML = `
        <div class="note warn"><b>Как читать.</b> Сценарии придуманы на синтетических данных и показывают механику, а не доказывают превосходство. Итог зависит от настроек: подвигайте порог входа и N. Помните: у трёх стратегий разные шкалы z, поэтому одинаковый порог — не одинаковые условия.</div>
        <div class="viz" style="margin-top:16px"><div class="btns" id="tabs" style="margin:0 0 12px"></div><p id="snote" style="margin:0 0 10px;color:#98a3b6"></p><div id="ctl"></div><div id="sum" class="note" style="margin-top:10px"></div><div class="scroll" style="max-height:none;margin-top:12px"><table class="t" id="tab"></table></div></div>
        <h3 style="margin:30px 0 14px">Итоги простыми словами</h3>
        <div class="cards" id="cards"></div>`;
      const tabs = el.querySelector('#tabs');
      tabs.innerHTML = SCEN.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { verdict.cur = +b.dataset.i; draw(); } });
      function draw() {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === verdict.cur));
        const sc = SCEN[verdict.cur];
        el.querySelector('#snote').textContent = sc.note;
        const tot = { sma: 0, ewma: 0, robust: 0 }, dd = { sma: 0, ewma: 0, robust: 0 }, cn = { sma: 0, ewma: 0, robust: 0 }, wins = { ewma: 0, robust: 0 };
        const rows = SEEDS.map((s) => {
          const x = sc.gen(s), m = {};
          MODES.forEach(([k]) => { m[k] = run(x, k).metrics; tot[k] += m[k].total; dd[k] += m[k].maxDD; cn[k] += m[k].count; });
          if (m.ewma.total > m.sma.total) wins.ewma++;
          if (m.robust.total > m.sma.total) wins.robust++;
          return '<tr><td>Набор ' + s + '</td>' + MODES.map(([k]) => '<td>' + m[k].count + '</td><td>' + col(m[k].total) + '</td><td>' + U.fmt(-m[k].maxDD, 1) + '</td>').join('') + '</tr>';
        });
        el.querySelector('#tab').innerHTML = '<tr><th rowspan="2"></th>' + MODES.map(([, name]) => '<th colspan="3" style="text-align:center">' + name + '</th>').join('') + '</tr><tr>' + MODES.map(() => '<th>сделок</th><th>итог</th><th>макс. просадка</th>').join('') + '</tr>' + rows.join('') +
          '<tr><td><b>Сумма</b></td>' + MODES.map(([k]) => '<td><b>' + cn[k] + '</b></td><td><b>' + col(tot[k]) + '</b></td><td><b>' + U.fmt(-dd[k], 1) + '</b></td>').join('') + '</tr>';
        const rank = MODES.slice().sort((a, b) => tot[b[0]] - tot[a[0]]);
        el.querySelector('#sum').innerHTML = 'Сценарий «<b>' + sc.name + '</b>»: по сумме итогов впереди <b>' + rank[0][1] + '</b> (' + col(tot[rank[0][0]], 0) + '), затем ' + rank[1][1] + ' (' + col(tot[rank[1][0]], 0) + '), затем ' + rank[2][1] + ' (' + col(tot[rank[2][0]], 0) + '). Относительно простого окна лучше в <b>' + wins.robust + ' из ' + SEEDS.length + '</b> наборов робастный вариант и в <b>' + wins.ewma + ' из ' + SEEDS.length + '</b> EWMA. Сделок: ' + cn.sma + ' / ' + cn.ewma + ' / ' + cn.robust + ' (простое / EWMA / робастный). Суммы максимальных просадок: ' + U.fmt(dd.sma, 0) + ' / ' + U.fmt(dd.ewma, 0) + ' / ' + U.fmt(dd.robust, 0) + '.';
      }
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost], draw);
      const cards = [
        ['Что робастность реально даёт', 'Центр и разброс не искажаются одиночным выбросом, и следующие N дней стратегия не «глохнет». Это свойство расчёта. Гарантией прибыли оно не является: сравните итоги в таблице.'],
        ['Что она стоит', 'На обычных данных σ «дёрганее», а z на выбросах огромный, поэтому сделок обычно больше. Больше сделок — больше издержек, и просадка может быть глубже. Смотрите колонки «сделок» и «макс. просадка», а не только итог.'],
        ['Главный вопрос — что такое ваш выброс', 'Если всплеск — реальное, исполнимое движение цены, которое потом возвращается (как в наших учебных данных), на нём можно заработать. Если это ошибка в данных или цена, по которой сделку не совершить, реакция на него — потеря. Робастный вариант реагирует на выбросы сильнее, поэтому природа выбросов для него критична.'],
        ['Что не меняется', 'Всё, о чём говорилось в разборе простого z-score: связь может порваться (сценарий «Смена уровня» трудный для всех), издержки съедают малую прибыль, подбор параметров по прошлому оптимистичен, а данные здесь синтетические.']
      ];
      el.querySelector('#cards').innerHTML = cards.map((c) => '<div class="card"><h4>' + c[0] + '</h4><p>' + c[1] + '</p></div>').join('');
      draw();
    }
  });
})();
