/* Продвинутая оценка β(t) и диагностика связи, экраны 5–8: ручной расчёт фильтра Калмана на 6 днях,
   правила и сделки с живым бейджем здоровья, пошаговый инспектор дня и честный эксперимент 4×11 (#58, #47). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, HV = window.HV;
  const Z = (window.DGSCREENS = window.DGSCREENS || []);
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', PRE = '#5aa9ff', GOLD = '#ffd166', PURP = '#c9b6ff';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 2 : d) + '</span>';

  const MODES = [
    { id: 'ols_plain', name: 'Скользящий OLS', color: BAD },
    { id: 'robust_tls', name: 'Робастный TLS + Theil–Sen', color: PRE },
    { id: 'kalman_only', name: 'Фильтр Калмана (без стража)', color: SIM },
    { id: 'kalman_health', name: 'Калман + Здоровье (KPSS/CUSUM)', color: ME }
  ];

  const badgeHtml = (st) => st === 'broken'
    ? '<span class="pill stop">Связь разорвана</span>'
    : st === 'warn'
      ? '<span class="pill time">Связь ослабла</span>'
      : '<span class="pill ok">Связь здорова</span>';

  /* ---------- 5. Ручной расчёт фильтра Калмана на 6 днях ---------- */
  const s5 = { qBeta: 0.002, obsVar: 4.0, addSpike: false, huberOn: true };

  Z.push({
    id: 'kalman-manual',
    title: 'Как посчитать фильтр Калмана вручную: 6 дней на ладони',
    lead: 'Никакой «чёрной магии»: проследим за оценкой наклона β день за днём на маленькой таблице из шести шагов (для наглядности свободный член α = 0, то есть A ≈ β · B).',
    text: () => `
      <h3>Четыре арифметических действия каждого вечера</h3>
      <p>Пусть вчера после торгов у нас была оценка наклона <code>β_вчера</code> и мера нашей неуверенности в ней <code>P_вчера</code>. Вечером пришла новая пара цен <code>(B, A)</code>:</p>
      <ol>
        <li><b>Неуверенность чуть подросла за сутки:</b> <code>P_прогноз = P_вчера + q_β</code>.</li>
        <li><b>Считаем ошибку прогноза (инновацию):</b> <code>e = A − β_вчера · B</code>.</li>
        <li><b>Считаем долю доверия (усиление Калмана):</b><br><code>K = (P_прогноз · B) ÷ (B² · P_прогноз + R)</code>, где <code>R</code> — обычный шум стакана.</li>
        <li><b>Обновляем наклон и сжимаем неуверенность:</b><br><code>β_нов = β_вчера + K · e</code>, &nbsp; <code>P_нов = (1 − K · B) · P_прогноз</code>.</li>
      </ol>
      <p>Включите справа сбойный принт на 4-м дне и посмотрите, как ${T('huber_clip', 'обрезка Хьюбера')} не даёт шальной свече сбить прицел!</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Ручной стенд: истинный наклон плавно растёт с 1,20 до 1,45</h4>
          <div class="btns" style="margin:0 0 10px">
            <button class="b" id="sp5">⚡ Вбросить сбойный принт +35 п. на 4-м дне</button>
            <button class="b on" id="hb5">🛡 Обрезка Хьюбера включена</button>
          </div>
          <div id="sl5a"></div>
          <div id="sl5b"></div>
          <table class="t" id="tab5" style="margin-top:10px"></table>
        </div>`;

      const spBtn = el.querySelector('#sp5'), hbBtn = el.querySelector('#hb5');
      spBtn.addEventListener('click', () => { s5.addSpike = !s5.addSpike; spBtn.classList.toggle('on', s5.addSpike); draw5(); });
      hbBtn.addEventListener('click', () => { s5.huberOn = !s5.huberOn; hbBtn.classList.toggle('on', s5.huberOn); draw5(); });

      HV.slider(el.querySelector('#sl5a'), {
        label: 'Ожидаемая изменчивость наклона за день (q_β)', min: 0.0002, max: 0.0100, step: 0.0004, value: s5.qBeta,
        fmt: (v) => f(v, 4),
        onInput: (v) => { s5.qBeta = v; draw5(); }
      });
      HV.slider(el.querySelector('#sl5b'), {
        label: 'Дисперсия обычного шума цены (R)', min: 1.0, max: 16.0, step: 1.0, value: s5.obsVar,
        fmt: (v) => f(v, 1) + ' п²',
        onInput: (v) => { s5.obsVar = v; draw5(); }
      });

      function draw5() {
        const B = [100, 102, 98, 105, 103, 108];
        const trueB = [1.20, 1.25, 1.30, 1.35, 1.40, 1.45];
        const noise = [0.8, -1.1, 0.9, -0.6, 1.0, -0.7];
        let beta = 1.15, P = 0.01;
        const rows = [];

        for (let i = 0; i < 6; i++) {
          const bVal = B[i];
          const aVal = trueB[i] * bVal + noise[i] + (i === 3 && s5.addSpike ? 35 : 0);
          const pPred = P + s5.qBeta;
          const yhat = beta * bVal;
          const err = aVal - yhat;
          const S = bVal * bVal * pPred + s5.obsVar;
          const sSqrt = Math.sqrt(S);
          const effErr = s5.huberOn && Math.abs(err) > 2.2 * sSqrt ? Math.sign(err) * 2.2 * sSqrt : err;
          const K = (pPred * bVal) / S;
          const betaNext = beta + K * effErr;
          P = Math.max(1e-8, (1 - K * bVal) * pPred);
          rows.push({ day: i + 1, bVal, aVal, trueK: trueB[i], betaPrev: beta, yhat, err, effErr, K, betaNext, clipped: Math.abs(effErr) < Math.abs(err) - 1e-6 });
          beta = betaNext;
        }

        el.querySelector('#tab5').innerHTML =
          '<tr><th>День</th><th>B / A</th><th>Прогноз ŷ</th><th>Ошибка e (после защиты)</th><th>Вес K·100</th><th>β до → β после (истина)</th></tr>' +
          rows.map((r) => '<tr' + (r.day === 4 && s5.addSpike ? ' class="sel"' : '') + '>' +
            '<td>#' + r.day + '</td>' +
            '<td>' + r.bVal + ' / <b>' + f(r.aVal, 1) + '</b></td>' +
            '<td>' + f(r.yhat, 1) + '</td>' +
            '<td>' + U.sgn(r.err, 1) + (r.clipped ? ' → <b style="color:' + ME + '">' + U.sgn(r.effErr, 1) + '</b>' : '') + '</td>' +
            '<td>' + f(r.K * 100, 3) + '</td>' +
            '<td>' + f(r.betaPrev, 3) + ' → <b style="color:' + ME + '">' + f(r.betaNext, 3) + '</b> <span style="color:#98a3b6">(' + f(r.trueK, 2) + ')</span></td></tr>'
          ).join('');
      }
      draw5();
    }
  });

  /* ---------- 6. Правила, сделки и живой бейдж здоровья связи ---------- */
  const s6 = { scen: 0, seed: 7, mode: 'kalman_health', n: 40, entryZ: 2.0, exitZ: 0.4 };

  Z.push({
    id: 'diag-trades',
    title: 'Правила и сделки: четыре способа вести β(t) и следить за здоровьем пары',
    lead: 'Сравним на одних и тех же котировках скользящий OLS, робастную связку TLS + Theil–Sen, голый фильтр Калмана и фильтр Калмана с постоянным контролем здоровья пары (ADF + KPSS + Хёрст + CUSUM).',
    full: true,
    mount(el) {
      const seeds = [1, 7, 13, 21, 42];
      el.innerHTML = `
        <div class="viz">
          <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div class="btns" id="sc6"></div>
            <div class="btns" id="sd6"></div>
          </div>
          <p id="note6" style="margin:0 0 10px;color:#98a3b6"></p>
          <div class="btns" id="md6" style="margin:0 0 12px"></div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
            <div id="sl6n"></div><div id="sl6in"></div><div id="sl6out"></div>
          </div>
        </div>
        <div id="kpi6" style="margin-top:12px"></div>
        <div class="viz" style="margin-top:12px">
          <h4>Оценка коэффициента хеджирования β(t) и фоновый статус здоровья связи</h4>
          <div class="legend">
            <span><i style="background:${GOLD}"></i>истинный β(t)</span>
            <span><i style="background:${BAD}"></i>скользящий OLS</span>
            <span><i style="background:${PRE}"></i>робастный TLS + Theil–Sen</span>
            <span><i style="background:${ME}"></i>фильтр Калмана</span>
          </div>
          <div id="c6beta"></div>
        </div>
        <div class="viz" style="margin-top:12px">
          <h4>Кривые счёта четырёх методов (на одних и тех же сделках с замороженным на входе k)</h4>
          <div class="legend">
            ${MODES.map((m) => '<span><i style="background:' + m.color + '"></i>' + m.name + '</span>').join('')}
          </div>
          <div id="c6eq"></div>
        </div>
        <div class="viz" style="margin-top:12px">
          <h4>Журнал сделок выбранного метода</h4>
          <div style="max-height:280px;overflow:auto"><table class="t" id="tab6"></table></div>
        </div>`;

      const scEl = el.querySelector('#sc6'), sdEl = el.querySelector('#sd6'), mdEl = el.querySelector('#md6');
      scEl.innerHTML = E.DIAG_SCENARIOS.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      sdEl.innerHTML = seeds.map((sd) => '<button class="b" data-s="' + sd + '">история #' + sd + '</button>').join('');
      mdEl.innerHTML = MODES.map((m) => '<button class="b" data-m="' + m.id + '">' + m.name + '</button>').join('');

      scEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.scen = +b.dataset.i; draw6(); } });
      sdEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.seed = +b.dataset.s; draw6(); } });
      mdEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.mode = b.dataset.m; draw6(); } });

      HV.slider(el.querySelector('#sl6n'), { label: 'Окно нормировки / регрессии N', min: 25, max: 65, step: 5, value: s6.n, fmt: (v) => v + ' дн.', onInput: (v) => { s6.n = v; draw6(); } });
      HV.slider(el.querySelector('#sl6in'), { label: 'Вход |z| ≥', min: 1.5, max: 3.0, step: 0.25, value: s6.entryZ, fmt: (v) => f(v, 2) + 'σ', onInput: (v) => { s6.entryZ = v; draw6(); } });
      HV.slider(el.querySelector('#sl6out'), { label: 'Выход |z| ≤', min: 0.0, max: 1.0, step: 0.2, value: s6.exitZ, fmt: (v) => f(v, 2) + 'σ', onInput: (v) => { s6.exitZ = v; draw6(); } });

      let curDg = null, curBts = null;
      const cBeta = A.mkChart(el.querySelector('#c6beta'), 195, {
        tip: (i) => curDg ? '<b>День ' + (i + 1) + '</b><br>истинный β: <b>' + f(curDg.trueBeta[i]) + '</b>' +
          (curBts.ols_plain.kEst[i] !== null ? '<br>OLS: <b>' + f(curBts.ols_plain.kEst[i]) + '</b> · TLS/TS: <b>' + f(curBts.robust_tls.kEst[i]) + '</b>' : '') +
          (curBts.kalman_health.kEst[i] !== null ? '<br>Калман: <b style="color:' + ME + '">' + f(curBts.kalman_health.kEst[i]) + '</b> · статус: ' + curBts.kalman_health.health[i] : '') : ''
      });
      const cEq = A.mkChart(el.querySelector('#c6eq'), 190, {
        tip: (i) => curBts ? '<b>День ' + (i + 1) + '</b><br>' + MODES.map((m) => '<span style="color:' + m.color + '">' + m.name + ': <b>' + U.sgn(curBts[m.id].equity[i]) + '</b></span>').join('<br>') : ''
      });

      function draw6() {
        scEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s6.scen));
        sdEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.s === s6.seed));
        mdEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === s6.mode));

        const spec = E.DIAG_SCENARIOS[s6.scen];
        el.querySelector('#note6').textContent = spec.note;
        curDg = E.genDiagScenario(s6.seed, spec);
        const baseP = { n: s6.n, entryZ: s6.entryZ, exitZ: s6.exitZ, stopZ: 3.6, maxHold: 28, cost: 0.40 };
        curBts = {};
        MODES.forEach((m) => { curBts[m.id] = E.backtestDiag(curDg, Object.assign({}, baseP, { diagMode: m.id })); });

        const bt = curBts[s6.mode];
        const m = bt.metrics;
        const brokenDays = curBts.kalman_health.health.filter((h) => h === 'broken').length;

        el.querySelector('#kpi6').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v">' + m.count + '</div><div class="l">сделок</div><div class="e">' + MODES.find((x) => x.id === s6.mode).name + '</div></div>' +
            '<div class="kpi"><div class="v">' + col(m.total, 1) + ' п.</div><div class="l">чистый итог</div><div class="e">после издержек</div></div>' +
            '<div class="kpi"><div class="v">' + f(-m.maxDD, 1) + ' п.</div><div class="l">макс. просадка</div><div class="e">глубина худшей ямы</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + (brokenDays > 20 ? GOLD : ME) + '">' + brokenDays + ' дн.</div><div class="l">красный бейдж связи</div><div class="e">дней под блокировкой входов</div></div>' +
            '<div class="kpi"><div class="v">' + bt.breakExits + '</div><div class="l">досрочных выходов</div><div class="e">по сигналу распада связи</div></div>' +
          '</div>';

        const spans = [];
        curBts.kalman_health.health.forEach((h, i) => {
          if (h === 'broken') spans.push({ i0: i - 0.5, i1: i + 0.5, color: '#ff6b6b20' });
          else if (h === 'warn') spans.push({ i0: i - 0.5, i1: i + 0.5, color: '#ffd16612' });
        });

        cBeta.render({
          n: curDg.a.length, spans,
          series: [
            { data: curDg.trueBeta, color: GOLD, width: 1.8, dash: [5, 4] },
            { data: curBts.ols_plain.kEst, color: BAD, width: 1.3 },
            { data: curBts.robust_tls.kEst, color: PRE, width: 1.35 },
            { data: curBts.kalman_health.kEst, color: ME, width: 2.1 }
          ]
        });

        cEq.render({
          n: curDg.a.length,
          hlines: [{ y: 0, color: '#ffffff24', dash: [3, 3] }],
          series: MODES.map((mo) => ({ data: curBts[mo.id].equity, color: mo.color, width: mo.id === s6.mode ? 2.4 : 1.35 }))
        });

        el.querySelector('#tab6').innerHTML =
          '<tr><th>#</th><th>Дни</th><th>Напр.</th><th>Замороженный k</th><th>z входа → выхода</th><th>Валовая</th><th>Чистый итог</th><th>Причина выхода</th></tr>' +
          (bt.trades.length ? bt.trades.map((tr, idx) =>
            '<tr><td>' + (idx + 1) + '</td><td>' + (tr.entryIdx + 1) + ' → ' + (tr.exitIdx + 1) + ' (' + tr.bars + ' дн.)</td>' +
            '<td>' + (tr.dir > 0 ? 'покупка спреда' : 'продажа спреда') + '</td>' +
            '<td>' + f(tr.kIn) + '</td><td>' + U.sgn(tr.entryZ) + 'σ → ' + U.sgn(tr.exitZ) + 'σ</td>' +
            '<td>' + col(tr.gross) + '</td><td><b>' + col(tr.net) + '</b></td>' +
            '<td><span class="pill ' + (tr.reason === 'stop' || tr.reason === 'break' ? 'stop' : tr.reason === 'target' || tr.reason === 'exit' ? 'ok' : 'time') + '">' + (A.REASON[tr.reason] || tr.reason) + '</span></td></tr>'
          ).join('') : '<tr><td colspan="8" style="color:#98a3b6">Сделок не открывалось (пара заблокирована индикатором здоровья или не пробила порог).</td></tr>');
      }
      draw6();
    }
  });

  /* ---------- 7. Пошаговый инспектор одного дня ---------- */
  const s7 = { scen: 2, day: 152, n: 40 };

  Z.push({
    id: 'diag-day',
    title: 'Один день под лупой: шаг Калмана и паспорт здоровья пары',
    lead: 'Откройте любой день истории и сравните бок о бок все четыре оценки наклона (OLS, TLS, Theil–Sen, Калман), шаг обновления фильтра и полный медицинский осмотр связи (ADF, KPSS, Хёрст, ERT и CUSUM).',
    full: true,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div class="btns" id="sc7"></div>
            <div class="btns" id="jmp7">
              <button class="b" data-j="prev">◀ Пред. день</button>
              <button class="b" data-j="next">След. день ▶</button>
              <button class="b" data-j="glitch">⚡ Сбойный принт</button>
              <button class="b" data-j="brk">⚠ Момент распада</button>
            </div>
          </div>
          <div id="sl7"></div>
        </div>
        <div class="cols" style="margin-top:14px">
          <div id="left7" class="viz"></div>
          <div id="right7" class="viz"></div>
        </div>`;

      const scEl = el.querySelector('#sc7');
      scEl.innerHTML = E.DIAG_SCENARIOS.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      scEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s7.scen = +b.dataset.i; draw7(); } });

      let dg = E.genDiagScenario(7, E.DIAG_SCENARIOS[s7.scen]);
      const slCtl = HV.slider(el.querySelector('#sl7'), {
        label: 'Проверяемый день t', min: 45, max: 315, step: 1, value: s7.day,
        fmt: (v) => 'День #' + (v + 1),
        onInput: (v) => { s7.day = v; render7(); }
      });

      el.querySelector('#jmp7').addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        const j = b.dataset.j;
        if (j === 'prev') s7.day = Math.max(45, s7.day - 1);
        else if (j === 'next') s7.day = Math.min(315, s7.day + 1);
        else if (j === 'glitch') {
          s7.scen = 1;
          dg = E.genDiagScenario(7, E.DIAG_SCENARIOS[1]);
          for (let k = 45; k < 315; k++) if (dg.isGlitch[k]) { s7.day = k; if (k > 80) break; }
          scEl.querySelectorAll('button').forEach((btn, i) => btn.classList.toggle('on', i === 1));
        } else if (j === 'brk') {
          s7.scen = 2;
          dg = E.genDiagScenario(7, E.DIAG_SCENARIOS[2]);
          s7.day = 152;
          scEl.querySelectorAll('button').forEach((btn, i) => btn.classList.toggle('on', i === 2));
        }
        slCtl.set(s7.day);
        render7();
      });

      function draw7() {
        scEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s7.scen));
        dg = E.genDiagScenario(7, E.DIAG_SCENARIOS[s7.scen]);
        render7();
      }

      function render7() {
        const ex = E.explainDiag(dg, s7.n, s7.day, { diagMode: 'kalman_health' });
        const sm = ex.stMat;

        el.querySelector('#left7').innerHTML =
          '<h4>Шаг Калмана и сверка 4 методов наклона в день #' + (s7.day + 1) + '</h4>' +
          (ex.isGlitch ? '<div class="note warn" style="margin-bottom:10px">⚡ <b>Внимание:</b> в этот день в ленте проскочил сбойный принт! Посмотрите, как обрезка Хьюбера и медиана Тейла — Сена удержали наклон.</div>' : '') +
          '<table class="t">' +
            '<tr><th>Показатель</th><th>Значение</th><th>Пояснение</th></tr>' +
            '<tr><td>Наблюдаемые цены B_t / A_t</td><td><b>' + f(ex.b) + '</b> / <b>' + f(ex.a) + '</b></td><td>входные котировки дня</td></tr>' +
            '<tr><td>Прогноз Калмана до цены</td><td>α = ' + f(ex.priorAlpha) + ', <b>β = ' + f(ex.priorBeta, 3) + '</b></td><td>ŷ = ' + f(ex.yhat) + '</td></tr>' +
            '<tr><td>Ошибка прогноза (инновация e_t)</td><td><b>' + U.sgn(ex.innov) + ' п.</b> (σ_e = ' + f(ex.stdInnov) + ')</td><td>отклонение от ожидания фильтра</td></tr>' +
            '<tr><td>Обновлённый Калман после поправки</td><td>α = ' + f(ex.postAlpha) + ', <b style="color:' + ME + '">β = ' + f(ex.postBeta, 3) + '</b></td><td>усиление K_β = ' + f(ex.gainB * 1000, 3) + '·10⁻³</td></tr>' +
            '<tr><td>Сравнение оценок k на окне ' + s7.n + ' дн.</td><td colspan="2">Истина: <b>' + f(ex.trueBeta, 3) + '</b> · OLS: <span style="color:' + BAD + '">' + f(ex.olsK, 3) + '</span> · TLS: <span style="color:' + PRE + '">' + f(ex.tlsK, 3) + '</span> · Theil–Sen: <span style="color:' + ME + '">' + f(ex.tsK, 3) + '</span></td></tr>' +
          '</table>';

        el.querySelector('#right7').innerHTML =
          '<h4>Паспорт здоровья пары на вечер дня #' + (s7.day + 1) + '</h4>' +
          '<div style="margin:6px 0 12px;display:flex;align-items:center;gap:10px">' + badgeHtml(ex.health) + '<span style="color:#98a3b6">Итоговый z-score сигнала: <b>' + U.sgn(ex.z) + 'σ</b></span></div>' +
          '<table class="t">' +
            '<tr><th>Датчик диагностики</th><th>Текущее число</th><th>Вердикт датчика</th></tr>' +
            '<tr><td>Тест Дики — Фуллера (ADF τ)</td><td>' + f(sm.adfTau) + ' (порог ' + f(sm.adfCrit) + ')</td><td>' + (sm.adfPass ? '<span class="pos">✓ есть возврат</span>' : '<span class="neg">✗ слабый возврат</span>') + '</td></tr>' +
            '<tr><td>Зеркальный тест KPSS</td><td>' + f(sm.kpssStat, 3) + ' (порог 0,463)</td><td>' + (sm.kpssPass ? '<span class="pos">✓ уровень стабилен</span>' : '<span class="neg">✗ дрейф уровня!</span>') + '</td></tr>' +
            '<tr><td>Показатель Хёрста H</td><td><b>' + f(sm.hurst, 2) + '</b></td><td>' + (sm.hurst < 0.46 ? '<span class="pos">✓ возвратный ряд (&lt; 0,5)</span>' : '<span class="neg">✗ память тренда / RW</span>') + '</td></tr>' +
            '<tr><td>Счётчик разрыва CUSUM</td><td><b>' + f(ex.cusumScore) + '</b> (пороги 4,0 / 6,5)</td><td>' + (ex.cusumScore >= 6.5 ? '<span class="neg">✗ пробой разрыва!</span>' : ex.cusumScore >= 4.0 ? '<span style="color:' + GOLD + '">⚠ накоплен увод</span>' : '<span class="pos">✓ в норме</span>') + '</td></tr>' +
            '<tr><td>Время возврата ERT и разброс σ</td><td><b>' + f(ex.ertInfo.ert, 1) + ' дн.</b> · σ = ' + f(ex.ertInfo.sigma) + ' п.</td><td>' + (ex.ertInfo.valid ? '<span class="pos">✓ торгуемый размах</span>' : '<span class="neg">✗ микрошум</span>') + '</td></tr>' +
          '</table>';
      }
      draw7();
    }
  });

  /* ---------- 8. Честный эксперимент 4 сценария × 11 историй ---------- */
  const SEEDS8 = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  const s8 = { scen: 0 };

  Z.push({
    id: 'diag-verdict',
    title: 'Честный эксперимент: 4 сценария × 11 историй и памятка выбора',
    lead: 'Ни один статистический инструмент не бывает «волшебной таблеткой» во всех режимах сразу. Проверим все четыре метода на 44 независимых прогонах с едиными порогами и посмотрим, где выигрывает каждый кирпичик.',
    full: true,
    mount(el) {
      const summary = E.DIAG_SCENARIOS.map((sc) => {
        const byMode = {};
        MODES.forEach((m) => { byMode[m.id] = { tot: 0, trades: 0, ddSum: 0, brk: 0, seeds: [] }; });
        SEEDS8.forEach((sd) => {
          const dg = E.genDiagScenario(sd, sc);
          MODES.forEach((m) => {
            const bt = E.backtestDiag(dg, { diagMode: m.id });
            byMode[m.id].tot += bt.metrics.total;
            byMode[m.id].trades += bt.metrics.count;
            byMode[m.id].ddSum += bt.metrics.maxDD;
            byMode[m.id].brk += bt.breakExits;
            byMode[m.id].seeds.push(bt.metrics.total);
          });
        });
        return { sc, byMode };
      });

      el.innerHTML = `
        <div class="viz">
          <h4>Суммарный чистый итог за 11 историй (после всех издержек, с честным замороженным k внутри сделки)</h4>
          <table class="t" id="tab8sum"></table>
        </div>
        <div class="viz" style="margin-top:14px">
          <h4>По каждой из 11 историй отдельно</h4>
          <div class="btns" id="b8" style="margin:0 0 10px"></div>
          <table class="t" id="tab8det"></table>
        </div>
        <h3 style="margin:24px 0 12px">Шесть практических правил оценивания и диагностики</h3>
        <div class="cards">
          <div class="card"><h4>1. Плывёт β(t) — берите Калмана</h4><p>Когда чувствительность ног медленно меняется во времени, любое фиксированное окно N отстаёт, а пошаговый фильтр Калмана ведёт β(t) без рывков.</p></div>
          <div class="card"><h4>2. Грязная лента — TLS + Theil–Sen / Хьюбер</h4><p>При постоянном β и шумных принтах в обеих ногах симметричный TLS и медианный наклон Тейла — Сена дают самый чистый и несмещённый коэффициент.</p></div>
          <div class="card"><h4>3. Один ADF слеп к сдвигам</h4><p>Всегда ставьте рядом зеркальный тест KPSS и показатель Хёрста H &lt; 0,5: расхождение ADF и KPSS сразу выдаёт скрытую ступеньку уровня.</p></div>
          <div class="card"><h4>4. Смотрите на весь купол t½</h4><p>Не верьте одному «среднему полураспаду 7 дней» — проверяйте 75-й перцентиль и долю застрявших окон, чтобы знать худший срок заморозки ГО.</p></div>
          <div class="card"><h4>5. Держите бейдж здоровья на виду</h4><p>Детектор CUSUM ловит одностороннее расползание пары задолго до дальнего стоп-лосса и выключает торговлю на сломавшейся связке.</p></div>
          <div class="card"><h4>6. ERT работает только с σ ≥ σ_min</h4><p>Поиск самого быстрого возврата ERT без нижнего ограничения на волатильность спреда неизбежно вырождается в неторгуемый микрошум.</p></div>
        </div>`;

      el.querySelector('#tab8sum').innerHTML =
        '<tr><th>Рыночный режим</th>' + MODES.map((m) => '<th>' + m.name + '</th>').join('') + '</tr>' +
        summary.map((row) =>
          '<tr><td><b>' + row.sc.name + '</b><br><span style="color:#98a3b6;font-size:13px">' + row.sc.note + '</span></td>' +
          MODES.map((m) => {
            const st = row.byMode[m.id];
            return '<td><b>' + col(st.tot, 0) + ' п.</b><br><span style="color:#98a3b6;font-size:13px">' + st.trades + ' сд. · ср. DD −' + f(st.ddSum / SEEDS8.length, 1) + '</span></td>';
          }).join('') + '</tr>'
        ).join('');

      const bEl = el.querySelector('#b8');
      bEl.innerHTML = E.DIAG_SCENARIOS.map((sc, i) => '<button class="b" data-i="' + i + '">' + sc.name + '</button>').join('');
      bEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s8.scen = +b.dataset.i; drawDet8(); } });

      function drawDet8() {
        bEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s8.scen));
        const row = summary[s8.scen];
        el.querySelector('#tab8det').innerHTML =
          '<tr><th>Метод</th>' + SEEDS8.map((sd) => '<th>#' + sd + '</th>').join('') + '<th>Сумма 11 ист.</th></tr>' +
          MODES.map((m) => {
            const st = row.byMode[m.id];
            return '<tr><td><b style="color:' + m.color + '">' + m.name + '</b></td>' +
              st.seeds.map((v) => '<td>' + col(v, 0) + '</td>').join('') +
              '<td><b>' + col(st.tot, 0) + ' п.</b></td></tr>';
          }).join('');
      }
      drawDet8();
    }
  });
})();
