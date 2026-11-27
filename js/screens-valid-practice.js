/* Честная валидация и защита от переобучения, экраны 5–8: стресс-проверка (2× cost,
   break-even, блочный бутстрап) и промоушн-гейт PASS, симулятор на священном Holdout,
   пошаговый паспорт аудита и эксперимент 4×11 (#67, #50). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, HV = window.HV;
  const Z = (window.VLSCREENS = window.VLSCREENS || []);
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', PRE = '#5aa9ff', GOLD = '#ffd166', PURP = '#c9b6ff';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const pct = (v, d) => U.fmt(v * 100, d === undefined ? 0 : d) + '%';
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 2 : d) + '</span>';

  const APPROACHES = [
    { id: 'naive_peak', name: 'Погоня за пиком IS', color: BAD },
    { id: 'leaky_wfo', name: 'Сплит без чистки стыка', color: SIM },
    { id: 'plateau_wfo', name: 'Плато ≥ 70% + Purging/Embargo', color: PRE },
    { id: 'full_audit', name: 'Полный аудит + гейт PASS', color: ME }
  ];

  const verdictBadge = (v) => {
    if (v === 'PASS') return '<span class="pill ok">✅ PASS</span>';
    if (v === 'BORDERLINE') return '<span class="pill time">⚠️ BORDERLINE</span>';
    return '<span class="pill stop">⛔ REJECT</span>';
  };

  /* ---------- 5. Стресс-проверка и промоушн-гейт PASS / BORDERLINE / REJECT ---------- */
  const s5 = { dsr: 0.98, pbo: 0.18, plateau: 0.78, blocks: 4, s2022: true, thesis: true, dataOk: true };

  Z.push({
    id: 'stress-gate',
    title: 'Стресс-проверка (2× cost, бутстрап) и формула гейта PASS',
    lead: 'Прежде чем пустить пару в рабочий портфель, мы проверяем её запас прочности к удвоенным издержкам, строим доверительный интервал блочным бутстрапом и пропускаем сквозь шесть условий промоушн-гейта.',
    text: () => `
      <h3>Стресс-испытания и ${T('promo_gate', 'шесть замков промоушн-гейта')}</h3>
      <ul>
        <li><b>${T('breakeven_cost', 'Break-even издержки')} и тест <code>2× cost</code>:</b> если стратегия уходит в минус при удвоении комиссий и проскальзывания, её запас прочности бумажный.</li>
        <li><b>${T('block_bootstrap', 'Блочный бутстрап')}:</b> мы нарезаем историю кусками по 12 дней и собираем сотни новых траекторий, получая честный <code>90%-й доверительный интервал</code> Sharpe с уважением к автокорреляции.</li>
        <li><b>Формула допуска:</b> <code>PASS</code> ставится только при выполнении <b>всех шести</b> условий разом. Отсутствие экономического тезиса или нехватка данных — критичный провал без допуска (сразу <code>REJECT</code>), а лёгкий недобор числовых порогов даёт жёлтую метку <code>BORDERLINE</code> с точным списком замечаний.</li>
      </ul>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Досье пары × стратегии: проверьте все 6 условий промоушн-гейта</h4>
          <div class="btns" id="pr5" style="margin:0 0 10px">
            <button class="b" data-p="pass">Эталон P17 (PASS)</button>
            <button class="b" data-p="bord">На грани допуска (BORDERLINE)</button>
            <button class="b" data-p="nothesis">Без тезиса (критичный REJECT)</button>
            <button class="b" data-p="noise">Переобученный шум (REJECT)</button>
          </div>
          <div id="sl5dsr"></div>
          <div id="sl5pbo"></div>
          <div id="sl5pl"></div>
          <div id="sl5bl"></div>
          <div class="btns" id="tg5" style="margin:8px 0 12px">
            <button class="b" data-t="s2022">Стресс-блок 2022 &gt; 0</button>
            <button class="b" data-t="thesis">Написан тезис (критично!)</button>
            <button class="b" data-t="dataOk">Данных достаточно (критично!)</button>
          </div>
          <div id="head5" class="note" style="margin-bottom:10px"></div>
          <table class="t" id="tab5"></table>
          <div id="stress5" style="margin-top:12px"></div>
        </div>`;

      const slDsr = HV.slider(el.querySelector('#sl5dsr'), {
        label: '1. Сдутый Шарп DSR (норма ≥ 0,95; допуск до 0,90)', min: 0.30, max: 1.00, step: 0.01, value: s5.dsr,
        fmt: (v) => f(v), onInput: (v) => { s5.dsr = v; draw5(); }
      });
      const slPbo = HV.slider(el.querySelector('#sl5pbo'), {
        label: '2. Вероятность переобучения PBO (норма ≤ 0,50; допуск до 0,55)', min: 0.05, max: 0.90, step: 0.01, value: s5.pbo,
        fmt: (v) => f(v), onInput: (v) => { s5.pbo = v; draw5(); }
      });
      const slPl = HV.slider(el.querySelector('#sl5pl'), {
        label: '3. Удержание плато соседями (норма ≥ 70%; допуск до 62%)', min: 0.25, max: 0.98, step: 0.01, value: s5.plateau,
        fmt: (v) => pct(v, 0), onInput: (v) => { s5.plateau = v; draw5(); }
      });
      const slBl = HV.slider(el.querySelector('#sl5bl'), {
        label: '4. Положительных режим-блоков OOS из 5 (норма ≥ 4; допуск 3)', min: 0, max: 5, step: 1, value: s5.blocks,
        fmt: (v) => v + ' из 5', onInput: (v) => { s5.blocks = v; draw5(); }
      });

      el.querySelector('#pr5').addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        const p = b.dataset.p;
        if (p === 'pass') Object.assign(s5, { dsr: 0.98, pbo: 0.18, plateau: 0.78, blocks: 4, s2022: true, thesis: true, dataOk: true });
        else if (p === 'bord') Object.assign(s5, { dsr: 0.92, pbo: 0.52, plateau: 0.65, blocks: 3, s2022: true, thesis: true, dataOk: true });
        else if (p === 'nothesis') Object.assign(s5, { dsr: 0.99, pbo: 0.15, plateau: 0.84, blocks: 5, s2022: true, thesis: false, dataOk: true });
        else Object.assign(s5, { dsr: 0.42, pbo: 0.68, plateau: 0.44, blocks: 2, s2022: false, thesis: true, dataOk: true });
        slDsr.set(s5.dsr); slPbo.set(s5.pbo); slPl.set(s5.plateau); slBl.set(s5.blocks);
        draw5();
      });

      el.querySelector('#tg5').addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        const k = b.dataset.t;
        s5[k] = !s5[k];
        draw5();
      });

      // Стресс-проверка и бутстрап на эталонной паре для наглядности нижнего блока
      const vdRob = E.genValidScenario(7, E.VALID_SCENARIOS[3]);
      const stCost = E.costStressTest(vdRob.spread.slice(0, 360), 40, 1.95, 0.30, 0.45);
      const runRob = E.quickSpreadRun(vdRob.spread.slice(0, 360), 40, 1.95, 0.30, 0.45);
      const boot = E.blockBootstrapCI(runRob.diffs.slice(40), { blockLen: 12, reps: 180, seed: 7 });

      function draw5() {
        el.querySelectorAll('#tg5 button').forEach((b) => b.classList.toggle('on', !!s5[b.dataset.t]));
        const gt = E.evalPromotionGate({
          dsr: s5.dsr, pbo: s5.pbo, plateau: s5.plateau,
          oosBlocksPos: s5.blocks, stress2022Pos: s5.s2022,
          hasThesis: s5.thesis, enoughData: s5.dataOk
        });

        el.querySelector('#head5').innerHTML = verdictBadge(gt.verdict) + ' &nbsp;<b>' + gt.headline + '</b>';
        el.querySelector('#tab5').innerHTML =
          '<tr><th>Условие гейта</th><th>Тип</th><th>Диагноз</th><th>Статус</th></tr>' +
          gt.checks.map((c) =>
            '<tr><td>' + c.name + '</td>' +
            '<td>' + (c.critical ? '<b>Критичное</b>' : 'С допуском') + '</td>' +
            '<td>' + c.detail + '</td>' +
            '<td>' + (c.status === 'pass' ? '<span class="pill ok">✓ Ок</span>' : (c.status === 'borderline' ? '<span class="pill time">Допуск</span>' : '<span class="pill stop">Провал</span>')) + '</td></tr>'
          ).join('');

        el.querySelector('#stress5').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + ME + '">' + col(stCost.stress2x.net, 0) + ' п.</div><div class="l">тест 2× cost (0,90 п.)</div><div class="e">базовый 1×: ' + U.sgn(stCost.base.net, 0) + ' п.</div></div>' +
            '<div class="kpi"><div class="v">' + f(stCost.breakEvenCost) + ' п.</div><div class="l">break-even издержки</div><div class="e">запас ×' + f(stCost.breakEvenCost / 0.45, 1) + ' к базе</div></div>' +
            '<div class="kpi"><div class="v">[' + f(boot.lo90, 1) + ' .. ' + f(boot.hi90, 1) + ']</div><div class="l">90% ДИ Sharpe (бутстрап)</div><div class="e">медиана ' + f(boot.medianSR, 1) + ' · блок 12 дн.</div></div>' +
          '</div>';
      }
      draw5();
    }
  });

  /* ---------- 6. Четыре подхода к отбору параметров на священном Holdout ---------- */
  const s6 = { scen: 0, seed: 7 };

  Z.push({
    id: 'valid-trades',
    title: 'Экзамен на священном Holdout: четыре подхода к отбору лицом к лицу',
    lead: 'Все четыре алгоритма искали настройки строго на первых 360 днях, ни разу не заглянув в финальные 140 дней Holdout. Посмотрите, кто зарабатывает на живом будущем, а кто вовремя отказывается от пустышки.',
    full: true,
    mount(el) {
      const seeds = [1, 7, 13, 21, 42];
      el.innerHTML = `
        <div class="viz">
          <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div class="btns" id="sc6"></div>
            <div class="btns" id="sd6"></div>
          </div>
          <p id="note6" style="margin:0;color:#98a3b6"></p>
        </div>
        <div id="kpi6" style="margin-top:12px"></div>
        <div class="viz" style="margin-top:12px">
          <h4>Кривые чистого счёта на неприкосновенном Holdout (дни 361–500)</h4>
          <div class="legend">
            ${APPROACHES.map((a) => '<span><i style="background:' + a.color + '"></i>' + a.name + '</span>').join('')}
          </div>
          <div id="c6"></div>
        </div>
        <div class="viz" style="margin-top:12px">
          <h4>Сводная таблица выбранных настроек и их судьбы на Holdout</h4>
          <table class="t" id="tab6"></table>
        </div>`;

      const scEl = el.querySelector('#sc6'), sdEl = el.querySelector('#sd6');
      scEl.innerHTML = E.VALID_SCENARIOS.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name.split('(')[0].trim() + '</button>').join('');
      sdEl.innerHTML = seeds.map((sd) => '<button class="b" data-s="' + sd + '">история #' + sd + '</button>').join('');
      scEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.scen = +b.dataset.i; draw6(); } });
      sdEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.seed = +b.dataset.s; draw6(); } });

      let curRes = null;
      const c6 = A.mkChart(el.querySelector('#c6'), 205, {
        tip: (i) => curRes ? '<b>Holdout день #' + (i + 1) + ' (день ' + (361 + i) + ')</b><br>' +
          APPROACHES.map((a) => '<span style="color:' + a.color + '">' + a.name + ': <b>' + U.sgn(curRes.holdout[a.id].equity[i]) + ' п.</b></span>').join('<br>') : ''
      });

      function draw6() {
        scEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s6.scen));
        sdEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.s === s6.seed));

        const spec = E.VALID_SCENARIOS[s6.scen];
        el.querySelector('#note6').textContent = spec.note;
        const vd = E.genValidScenario(s6.seed, spec);
        curRes = E.backtestValidApproaches(vd);

        el.querySelector('#kpi6').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v">' + verdictBadge(curRes.gate.verdict) + '</div><div class="l">вердикт полного аудита</div><div class="e">' + curRes.gate.headline + '</div></div>' +
            '<div class="kpi"><div class="v">' + f(curRes.dsr.dsr) + ' / ' + f(curRes.cpcv.pbo) + '</div><div class="l">DSR / PBO исследования</div><div class="e">до открытия Holdout</div></div>' +
            '<div class="kpi"><div class="v">' + pct(curRes.surfClean.plateau.plateauRatio, 0) + ' · WFC ' + U.sgn(curRes.surfClean.wfc) + '</div><div class="l">плато соседей и WFC</div><div class="e">по чистой сетке 6×6</div></div>' +
          '</div>';

        c6.render({
          n: curRes.holdout.naive_peak.equity.length,
          hlines: [{ y: 0, color: '#ffffff24', dash: [3, 3] }],
          series: APPROACHES.map((a) => ({ data: curRes.holdout[a.id].equity, color: a.color, width: a.id === 'full_audit' ? 2.5 : 1.65 }))
        });

        el.querySelector('#tab6').innerHTML =
          '<tr><th>Подход к отбору (на днях 1–360)</th><th>Выбранная настройка</th><th>Сделок Holdout</th><th>Sharpe Holdout</th><th>Просадка Holdout</th><th>Чистый итог Holdout</th></tr>' +
          APPROACHES.map((a) => {
            const h = curRes.holdout[a.id];
            const cfgStr = !h.cfg.active ? '<span class="pill stop">Торговля отклонена (0 лотов)</span>'
              : 'N = ' + h.cfg.n + ', z = ' + f(h.cfg.entryZ) + 'σ' + (h.cfg.mult && h.cfg.mult < 1 ? ' (лот 50%)' : '');
            return '<tr><td><b style="color:' + a.color + '">' + a.name + '</b></td>' +
              '<td>' + cfgStr + '</td>' +
              '<td>' + h.trades + '</td>' +
              '<td>' + U.sgn(h.srAnn, 1) + '</td>' +
              '<td>' + f(-h.maxDD, 1) + ' п.</td>' +
              '<td><b>' + col(h.total, 1) + ' п.</b></td></tr>';
          }).join('');
      }
      draw6();
    }
  });

  /* ---------- 7. Полный паспорт одного аудита под лупой ---------- */
  const s7 = { scen: 3, seed: 7 };

  Z.push({
    id: 'valid-audit',
    title: 'Один аудит под лупой: все числа от карты параметров до DSR',
    lead: 'Проследите родословную каждого числа в карточке валидации: почему одна пара получает зелёный допуск PASS, а другая отсеивается ещё до выхода на реальные деньги.',
    full: true,
    mount(el) {
      const seeds = [1, 7, 13, 21, 42];
      el.innerHTML = `
        <div class="viz">
          <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between">
            <div class="btns" id="sc7"></div>
            <div class="btns" id="sd7"></div>
          </div>
        </div>
        <div class="cols" style="margin-top:14px">
          <div id="left7" class="viz"></div>
          <div id="right7" class="viz"></div>
        </div>`;

      const scEl = el.querySelector('#sc7'), sdEl = el.querySelector('#sd7');
      scEl.innerHTML = E.VALID_SCENARIOS.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name.split('(')[0].trim() + '</button>').join('');
      sdEl.innerHTML = seeds.map((sd) => '<button class="b" data-s="' + sd + '">история #' + sd + '</button>').join('');
      scEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s7.scen = +b.dataset.i; draw7(); } });
      sdEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s7.seed = +b.dataset.s; draw7(); } });

      function draw7() {
        scEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s7.scen));
        sdEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.s === s7.seed));

        const vd = E.genValidScenario(s7.seed, E.VALID_SCENARIOS[s7.scen]);
        const r = E.backtestValidApproaches(vd);
        const pl = r.surfClean.plateau, pk = r.surfLeaky.peak;
        const devRun = E.quickSpreadRun(vd.spread.slice(0, vd.holdoutStart), pl.n, pl.entryZ, Math.min(0.30, pl.entryZ * 0.32), vd.cost);
        const boot = E.blockBootstrapCI(devRun.diffs.slice(pl.n), { blockLen: 12, reps: 150, seed: s7.seed });

        el.querySelector('#left7').innerHTML =
          '<h4>Шаг 1. Поверхность 6×6, CPCV (20 путей) и стресс издержек</h4>' +
          '<table class="t">' +
            '<tr><th>Проверка (дни 1–360)</th><th>Значение</th><th>Пояснение</th></tr>' +
            '<tr><td>Пик без чистки vs Центр плато</td><td>пик: N=' + pk.n + ', z=' + f(pk.entryZ) + '<br><b>плато: N=' + pl.n + ', z=' + f(pl.entryZ) + '</b></td><td>удержание соседей <b>' + pct(pl.plateauRatio, 0) + '</b></td></tr>' +
            '<tr><td>Корреляция карт WFC</td><td><b>' + U.sgn(r.surfClean.wfc) + '</b></td><td>связь IS и OOS вдоль всей сетки</td></tr>' +
            '<tr><td>CPCV (6 блоков → 20 разбиений)</td><td><b>PBO = ' + f(r.cpcv.pbo) + '</b> (' + r.cpcv.overfitCount + '/20)</td><td>доля провалов ниже медианы</td></tr>' +
            '<tr><td>Стресс издержек (1× → 2× cost)</td><td>' + U.sgn(r.stress.base.net, 0) + ' п. → <b>' + col(r.stress.stress2x.net, 0) + ' п.</b></td><td>break-even = <b>' + f(r.stress.breakEvenCost) + ' п.</b></td></tr>' +
          '</table>';

        el.querySelector('#right7').innerHTML =
          '<h4>Шаг 2. Поправка на перебор (DSR), бутстрап и вердикт гейта</h4>' +
          '<div style="margin:6px 0 12px">' + verdictBadge(r.gate.verdict) + ' &nbsp;<b>' + r.gate.headline + '</b></div>' +
          '<table class="t">' +
            '<tr><th>Величина</th><th>Значение</th><th>Комментарий</th></tr>' +
            '<tr><td>Годовой Sharpe центра плато</td><td><b>' + f(devRun.stats.srAnn) + '</b></td><td>асимметрия ' + U.sgn(devRun.stats.skew) + ', эксцесс ' + f(devRun.stats.kurt, 1) + '</td></tr>' +
            '<tr><td>Планка рекорда шума SR₀(N_эфф)</td><td><b>' + f(r.dsr.sr0Ann) + '</b></td><td>сдутый Шарп <b>DSR = ' + f(r.dsr.dsr, 3) + '</b></td></tr>' +
            '<tr><td>Блочный бутстрап (блок 12 дн.)</td><td><b>[' + f(boot.lo90, 1) + ' .. ' + f(boot.hi90, 1) + ']</b></td><td>90% ДИ Sharpe (P&gt;0: ' + pct(boot.probPos, 0) + ')</td></tr>' +
            '<tr><td><b>Контроль на святом Holdout</b></td><td>пик: ' + col(r.holdout.naive_peak.total, 1) + ' п. · <b>аудит: ' + col(r.holdout.full_audit.total, 1) + ' п.</b></td><td>дни 361–500</td></tr>' +
          '</table>';
      }
      draw7();
    }
  });

  /* ---------- 8. Честный эксперимент 4 сценария × 11 историй на Holdout ---------- */
  const SEEDS8 = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  const s8 = { scen: 0 };

  Z.push({
    id: 'valid-verdict',
    title: 'Честный эксперимент: 4 сценария × 11 историй на святом Holdout',
    lead: 'Итоговый экзамен дисциплины на 44 независимых историях: считаем деньги строго на неприкосновенном участке Holdout, которого не касался ни один алгоритм настройки.',
    full: true,
    mount(el) {
      const summary = E.VALID_SCENARIOS.map((sc) => {
        const byApp = {};
        APPROACHES.forEach((a) => { byApp[a.id] = { tot: 0, trades: 0, ddSum: 0, seeds: [] }; });
        let passCnt = 0, bordCnt = 0, rejCnt = 0;
        SEEDS8.forEach((sd) => {
          const vd = E.genValidScenario(sd, sc);
          const r = E.backtestValidApproaches(vd);
          if (r.gate.verdict === 'PASS') passCnt++;
          else if (r.gate.verdict === 'BORDERLINE') bordCnt++;
          else rejCnt++;
          APPROACHES.forEach((a) => {
            const h = r.holdout[a.id];
            byApp[a.id].tot += h.total;
            byApp[a.id].trades += h.trades;
            byApp[a.id].ddSum += h.maxDD;
            byApp[a.id].seeds.push(h.total);
          });
        });
        return { sc, byApp, passCnt, bordCnt, rejCnt };
      });

      el.innerHTML = `
        <div class="viz">
          <h4>Суммарный чистый итог на неприкосновенном Holdout за 11 историй</h4>
          <table class="t" id="tab8sum"></table>
        </div>
        <div class="viz" style="margin-top:14px">
          <h4>По каждой из 11 историй выбранного сценария (только Holdout!)</h4>
          <div class="btns" id="b8" style="margin:0 0 10px"></div>
          <table class="t" id="tab8det"></table>
        </div>
        <h3 style="margin:24px 0 12px">Шесть правил исследовательской дисциплины</h3>
        <div class="cards">
          <div class="card"><h4>1. Лучшая точка — почти всегда шум</h4><p>В первом сценарии погоня за ослепительным пиком на обучении приносит −317 п. на святом Holdout, тогда как выбор центра широкого плато зарабатывает +299 п.</p></div>
          <div class="card"><h4>2. Стыки окон обязаны быть чистыми</h4><p>Без purging и embargo длинные окна протаскивают будущую волну через границу разреза (−72 п. на Holdout). Санитарный зазор полностью убирает ловушку (+299 п.).</p></div>
          <div class="card"><h4>3. Лучшая сделка на пустышке — 0 лотов</h4><p>На чистом случайном блуждании охотник за пиком теряет −889 п., а полный аудит в 11 случаях из 11 ставит REJECT по PBO и DSR, сберегая 100% капитала (0 п. потерь!).</p></div>
          <div class="card"><h4>4. Без журнала попыток нет DSR</h4><p>Честный «сдутый Шарп» возможен только тогда, когда система автоматически считает каждую запущенную вариацию N, а не помнит лишь победителя.</p></div>
          <div class="card"><h4>5. Стресс 2× cost отсекает бумагу</h4><p>Проверка точки безубыточности и удвоенных издержек заранее показывает, переживёт ли стратегия реальный спред и проскальзывание тонкого стакана.</p></div>
          <div class="card"><h4>6. Вердикт всегда объясняет причину</h4><p>Формула PASS / BORDERLINE / REJECT никогда не прячется за немым светофором: каждый отказ указывает точное слабое звено — PBO, DSR, узкое плато или отсутствие тезиса.</p></div>
        </div>`;

      el.querySelector('#tab8sum').innerHTML =
        '<tr><th>Сценарий проверки</th>' + APPROACHES.map((a) => '<th>' + a.name + '</th>').join('') + '<th>Вердикты гейта</th></tr>' +
        summary.map((row) =>
          '<tr><td><b>' + row.sc.name + '</b><br><span style="color:#98a3b6;font-size:13px">' + row.sc.note + '</span></td>' +
          APPROACHES.map((a) => {
            const st = row.byApp[a.id];
            return '<td><b>' + col(st.tot, 0) + ' п.</b><br><span style="color:#98a3b6;font-size:13px">' + st.trades + ' сд. · ср. DD −' + f(st.ddSum / SEEDS8.length, 1) + '</span></td>';
          }).join('') +
          '<td><span class="pos">PASS ' + row.passCnt + '</span> · <span style="color:' + GOLD + '">BORD ' + row.bordCnt + '</span> · <span class="neg">REJ ' + row.rejCnt + '</span></td></tr>'
        ).join('');

      const bEl = el.querySelector('#b8');
      bEl.innerHTML = E.VALID_SCENARIOS.map((sc, i) => '<button class="b" data-i="' + i + '">' + sc.name.split('(')[0].trim() + '</button>').join('');
      bEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s8.scen = +b.dataset.i; drawDet8(); } });

      function drawDet8() {
        bEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s8.scen));
        const row = summary[s8.scen];
        el.querySelector('#tab8det').innerHTML =
          '<tr><th>Подход</th>' + SEEDS8.map((sd) => '<th>#' + sd + '</th>').join('') + '<th>Сумма Holdout</th></tr>' +
          APPROACHES.map((a) => {
            const st = row.byApp[a.id];
            return '<tr><td><b style="color:' + a.color + '">' + a.name + '</b></td>' +
              st.seeds.map((v) => '<td>' + col(v, 0) + '</td>').join('') +
              '<td><b>' + col(st.tot, 0) + ' п.</b></td></tr>';
          }).join('');
      }
      drawDet8();
    }
  });
})();
