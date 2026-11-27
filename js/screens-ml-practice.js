/* Осторожные ML-надстройки без «чёрного ящика», экраны 5–8:
   конформное предсказание и downweighting скора, 4 подхода лицом к лицу на OOS,
   паспорт одного сигнала под лупой и честный эксперимент 4×11 с картой v1/v2/v3 (#73, #52). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, HV = window.HV;
  const Z = window.MLSCREENS;
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', PRE = '#5aa9ff', GOLD = '#ffd166', PURP = '#c9b6ff';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const pct = (v, d) => U.fmt(v * 100, d === undefined ? 0 : d) + '%';
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 1 : d) + '</span>';

  /* ---------- 5. Конформный интервал и штраф за неопределённость (§7.6) ---------- */
  const s5 = { errScaleB: 0.22, alpha: 0.10 };

  Z.push({
    id: 'conformal-downweight',
    title: 'Конформный интервал и штраф за неопределённость (downweighting)',
    lead: 'Голое число «скор 0,85» способно обмануть, если вокруг него гигантский туман ошибок. Две пары с почти одинаковым баллом, но разной шириной интервала — это совершенно разные решения.',
    text: () => `
      <h3>Скор + диапазон + объяснение вместо магической цифры (§7.6)</h3>
      <p>Как измерить честную погрешность модели, не предполагая, что рынок живёт по колоколу Гаусса? Для этого служит ${T('conformal_ci', 'конформное предсказание')} (Вовк и соавт.):</p>
      <ol>
        <li>Берём отложенную калибровочную выборку и считаем фактические промахи модели <code>|y_i − ŷ_i|</code>.</li>
        <li>Откладываем соответствующий квантиль промахов <code>q̂</code> (например, для гарантии <code>90%</code>) влево и вправо от нового прогноза — получаем интервал с <b>честной конечной гарантией покрытия</b>.</li>
        <li>Дальше вступает ${T('score_downweight', 'правило downweighting')}: чем шире интервал неопределённости, тем сильнее снижается эффективный балл пары. Уверенные <code>0,83 [0,79–0,87]</code> обязаны стоять выше шатких <code>0,85 [0,56–1,00]</code>!</li>
      </ol>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Пара А (точечный скор 0,83) против Пары Б (точечный скор 0,85): кто победит после учёта сомнений?</h4>
          <div id="sl5"></div>
          <div id="kpi5" style="margin:10px 0"></div>
          <div id="bars5"></div>
        </div>`;

      const sl = el.querySelector('#sl5');
      HV.slider(sl, {
        label: 'Калибровочный разброс ошибок модели на Паре Б', min: 0.03, max: 0.34, step: 0.03, value: s5.errScaleB,
        fmt: (v) => '±' + f(v) + (v > 0.12 ? ' (высокая неизвестность!)' : ' (уверенная модель)'),
        onInput: (v) => { s5.errScaleB = v; draw5(); }
      });
      HV.slider(sl, {
        label: 'Требуемый уровень гарантии покрытия интервала (1 − α)', min: 0.80, max: 0.95, step: 0.05, value: +(1 - s5.alpha).toFixed(2),
        fmt: (v) => pct(v, 0) + ' гарантии покрытия',
        onInput: (v) => { s5.alpha = +(1 - v).toFixed(2); draw5(); }
      });

      const baseErrs = [0.4, 0.7, 0.5, 0.9, 0.6, 1.0, 0.8, 0.55, 0.85, 0.95, 0.75, 0.65];

      function draw5() {
        const truthA = baseErrs.map((e, i) => 0.83 + (i % 2 ? 1 : -1) * 0.045 * e);
        const predA = baseErrs.map(() => 0.83);
        const truthB = baseErrs.map((e, i) => 0.85 + (i % 2 ? 1 : -1) * s5.errScaleB * e);
        const predB = baseErrs.map(() => 0.85);

        const cA = E.conformalInterval(truthA, predA, 0.83, { alpha: s5.alpha });
        const cB = E.conformalInterval(truthB, predB, 0.85, { alpha: s5.alpha });
        const aWins = cA.effectiveScore >= cB.effectiveScore;

        el.querySelector('#kpi5').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + ME + '">' + f(cA.effectiveScore, 3) + '</div><div class="l">Пара А после downweight</div><div class="e">0,83 · [' + f(cA.lo) + ' – ' + f(cA.hi) + ']</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + (aWins ? SIM : ME) + '">' + f(cB.effectiveScore, 3) + '</div><div class="l">Пара Б после downweight</div><div class="e">0,85 · [' + f(cB.lo) + ' – ' + f(cB.hi) + ']</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + (aWins ? ME : PRE) + '">' + (aWins ? 'ЛИДЕР: ПАРА А' : 'ЛИДЕР: ПАРА Б') + '</div><div class="l">итоговое место в шорт-листе</div><div class="e">' + (aWins ? 'уверенность перевесила +0,02!' : 'интервал Б стал достаточно узким') + '</div></div>' +
          '</div>';

        const items = [
          { name: 'Пара А (стабильная металлургия): точечно 0,83', c: cA, col: ME },
          { name: 'Пара Б (шумная короткая выборка): точечно 0,85', c: cB, col: SIM }
        ];
        el.querySelector('#bars5').innerHTML = '<div class="note">' + items.map((it) => {
          const loP = it.c.lo * 100, wP = (it.c.hi - it.c.lo) * 100, ptP = it.c.point * 100, efP = it.c.effectiveScore * 100;
          return '<div style="margin:10px 0">' +
            '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><b>' + it.name + '</b><span>интервал [' + f(it.c.lo) + ' – ' + f(it.c.hi) + '] → эфф. скор <b>' + f(it.c.effectiveScore, 3) + '</b></span></div>' +
            '<div style="position:relative;height:20px;background:#161d29;border-radius:6px;border:1px solid #263044">' +
              '<div style="position:absolute;left:' + loP.toFixed(1) + '%;width:' + Math.max(1, wP).toFixed(1) + '%;top:3px;bottom:3px;background:' + it.col + '44;border:1px solid ' + it.col + ';border-radius:4px"></div>' +
              '<div title="Точечный скор" style="position:absolute;left:' + ptP.toFixed(1) + '%;top:0;bottom:0;width:3px;background:#fff"></div>' +
              '<div title="Эффективный скор с downweighting" style="position:absolute;left:' + efP.toFixed(1) + '%;top:2px;bottom:2px;width:4px;background:' + GOLD + ';border-radius:2px"></div>' +
            '</div>' +
          '</div>';
        }).join('') + '<div style="font-size:12px;color:#8b96ab">Белая риска — сырой точечный скор, цветная полоса — конформный интервал покрытия, золотая риска — скор после штрафа за неопределённость.</div></div>';
      }
      draw5();
    }
  });

  /* ---------- 6. Четыре подхода лицом к лицу на вневыборочном полугодии ---------- */
  const s6 = { scenIdx: 0, seed: 7 };

  Z.push({
    id: 'ml-approaches',
    title: 'Четыре подхода лицом к лицу: база, чёрный ящик, RL и Meta + Survival',
    lead: 'Столкнём на одних и тех же вневыборочных данных прозрачный Z-score, прямой «чёрный ящик» на 16 лагах, бесконтрольный RL и аккуратную двуслойную надстройку.',
    text: () => `
      <h3>Кто выживает за пределами обучающего окна?</h3>
      <ul>
        <li><b>Базовый Z-score без оверлея:</b> честен и прост, но безропотно заходит в шторм, дорогой стакан и за 4 дня до экспирации.</li>
        <li><b>Прямой «чёрный ящик» (16 лагов с нуля):</b> сам выдумывает знак позиции без понятия равновесия — переобучается на микрошуме прошлого окна.</li>
        <li><b>Наивный RL без safeguard'ов:</b> обучен без трения и потолка плеча — сгорает на обороте и догоне убытков.</li>
        <li><b>Двуслойный Meta-labeling + Survival <code>P(T ≤ H)</code>:</b> берёт направление строго у базового Z-score, но фильтрует бури и предэкспирационный цейтнот.</li>
      </ul>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Вневыборочный экзамен (дни 181–360, обучение строго на днях 1–180 с пурджингом)</h4>
          <div class="btns" id="b6" style="margin:0 0 8px"></div>
          <div class="btns" id="sd6" style="margin:0 0 8px"></div>
          <div class="legend">
            <span><i style="background:${SIM}"></i>Базовый Z-score</span>
            <span><i style="background:${BAD}"></i>«Чёрный ящик» (16 лагов)</span>
            <span><i style="background:${PURP}"></i>Наивный RL без замков</span>
            <span><i style="background:${ME}"></i>Двуслойный Meta + Survival</span>
          </div>
          <div id="c6"></div>
          <div style="margin-top:10px;overflow:auto"><table class="t" id="tab6"></table></div>
        </div>`;

      const bEl = el.querySelector('#b6');
      const shortNames = ['Бури и дорогой стакан', 'Ловушка экспирации', 'Чистый шум (мираж)', 'Здоровая пара'];
      bEl.innerHTML = E.ML_SCENARIOS.map((_, i) => '<button class="b" data-i="' + i + '">' + shortNames[i] + '</button>').join('');
      bEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.scenIdx = +b.dataset.i; draw6(); } });

      const sdEl = el.querySelector('#sd6');
      [1, 3, 7, 11, 21].forEach((sd) => {
        sdEl.innerHTML += '<button class="b" data-sd="' + sd + '">История #' + sd + '</button>';
      });
      sdEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.seed = +b.dataset.sd; draw6(); } });

      let curR = null;
      const c6 = A.mkChart(el.querySelector('#c6'), 195, {
        tip: (i) => curR ? '<b>День OOS #' + (i + 1) + '</b><br>' +
          '<span style="color:' + SIM + '">Базовый Z-score: <b>' + U.sgn(curR.approaches.base_z.equity[i], 1) + ' п.</b></span><br>' +
          '<span style="color:' + BAD + '">Чёрный ящик: <b>' + U.sgn(curR.approaches.blackbox_ml.equity[i], 1) + ' п.</b></span><br>' +
          '<span style="color:' + PURP + '">Наивный RL: <b>' + U.sgn(curR.approaches.naive_rl.equity[i], 1) + ' п.</b></span><br>' +
          '<span style="color:' + ME + '">Meta + Survival: <b>' + U.sgn(curR.approaches.meta_survival.equity[i], 1) + ' п.</b></span>' : ''
      });

      function draw6() {
        bEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s6.scenIdx));
        sdEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.sd === s6.seed));
        const md = E.genMlScenario(s6.seed, E.ML_SCENARIOS[s6.scenIdx]);
        curR = E.backtestMlApproaches(md);
        const ap = curR.approaches;

        c6.render({
          n: ap.meta_survival.equity.length,
          hlines: [{ y: 0, color: '#ffffff24', dash: [3, 3] }],
          series: [
            { data: ap.base_z.equity, color: SIM, width: 1.9 },
            { data: ap.blackbox_ml.equity, color: BAD, width: 1.6, dash: [4, 4] },
            { data: ap.naive_rl.equity, color: PURP, width: 1.5, dash: [2, 3] },
            { data: ap.meta_survival.equity, color: ME, width: 2.6 }
          ]
        });

        const rows = [
          ['Базовый Z-score (без оверлея)', ap.base_z, SIM, '—'],
          ['Прямой «чёрный ящик» (16 лагов)', ap.blackbox_ml, BAD, 'нет базовой идеи'],
          ['Наивный RL без предохранителей', ap.naive_rl, PURP, 'гипероборот'],
          ['Двуслойный Meta + Survival оверлей', ap.meta_survival, ME, 'отсеяно ловушек: ' + ap.meta_survival.skipped]
        ];
        el.querySelector('#tab6').innerHTML =
          '<tr><th>Подход</th><th>Итог OOS</th><th>Sharpe</th><th>MaxDD</th><th>Сделок</th><th>Диагностика</th></tr>' +
          rows.map((r) => '<tr>' +
            '<td style="color:' + r[2] + ';font-weight:600">' + r[0] + '</td>' +
            '<td>' + col(r[1].total, 1) + ' п.</td>' +
            '<td>' + f(r[1].srAnn) + '</td>' +
            '<td>' + f(r[1].maxDD, 1) + ' п.</td>' +
            '<td>' + r[1].trades + '</td>' +
            '<td>' + r[3] + '</td>' +
          '</tr>').join('');
      }
      draw6();
    }
  });

  /* ---------- 7. Один сигнал под лупой: паспорт двуслойного фильтра ---------- */
  const s7 = { sigIdx: 0 };

  Z.push({
    id: 'ml-signal-audit',
    title: 'Один сигнал под лупой: как оверлей отличает рабочий вход от западни',
    lead: 'Проследим внутри конкретных торговых дней вне выборки, какие именно числа видел базовый Z-score, почему мета-фильтр одобрил один сигнал и заблокировал другой.',
    text: () => `
      <h3>Полная прослеживаемость решения (provenance, §8.7)</h3>
      <p>Даже когда поверх стратегии работает ML-оверлей, у трейдера на экране не должно быть «нейросеть сказала нет». Каждое решение раскладывается на понятную цепочку:</p>
      <ol>
        <li><b>Базовый сигнал:</b> спред отклонился на <code>z</code> стандартных отклонений — экономическая идея предлагает сделку на возврат.</li>
        <li><b>Вектор погоды без заглядывания вперёд:</b> короткая буря <code>σ_5/σ_35</code>, локальный уклон, текущие издержки стакана и остаток сессий до экспирации.</li>
        <li><b>Два шлюза подряд:</b> мета-вероятность <code>p_meta</code> задаёт множитель <code>0× / 0,5× / 1,0×</code>, а кривая выживаемости проверяет <code>P(T_conv ≤ дней до ролла) ≥ 52%</code>.</li>
      </ol>`,
    mount(el) {
      const md = E.genMlScenario(7, E.ML_SCENARIOS[0]);
      const res = E.backtestMlApproaches(md);
      const log = res.approaches.meta_survival.log.slice(0, 8);

      el.innerHTML = `
        <div class="viz">
          <h4>Выберите реальный сигнал из вневыборочного журнала (дни 181–360)</h4>
          <div class="btns" id="b7" style="margin:0 0 10px"></div>
          <div id="card7"></div>
        </div>`;

      const bEl = el.querySelector('#b7');
      bEl.innerHTML = log.map((item, i) =>
        '<button class="b" data-i="' + i + '">День #' + item.t + ' (' + (item.action === 'skip' ? 'пропуск' : 'вход') + ')</button>'
      ).join('');
      bEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s7.sigIdx = +b.dataset.i; draw7(); } });

      function draw7() {
        if (s7.sigIdx >= log.length) s7.sigIdx = 0;
        bEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s7.sigIdx));
        const it = log[s7.sigIdx];
        const ft = E.mlBarFeatures(md, it.t, it.z);
        const mp = E.predictMetaProb(res.metaModel, ft.x);
        const tbReal = E.tripleBarrierLabel(md.spread, it.t, it.z > 0 ? -1 : 1, {
          sigmaBar: res.sdArr[it.t], ptMult: 1.15, slMult: 1.50, maxHold: 16, cost: md.costSeries[it.t]
        });

        const verdictTxt = it.action === 'skip' ? 'СИГНАЛ ОТКЛОНЁН (0×)' : (it.action === 'half' ? 'ОСТОРОЖНЫЙ ВХОД (0,5×)' : 'ПОЛНЫЙ ВХОД (1,0×)');
        const verdictCol = it.action === 'skip' ? BAD : (it.action === 'half' ? GOLD : ME);

        el.querySelector('#card7').innerHTML =
          '<div class="kpis" style="margin-bottom:10px">' +
            '<div class="kpi"><div class="v">z = ' + U.sgn(it.z) + 'σ</div><div class="l">Слой 1: базовый сигнал</div><div class="e">' + (it.z > 0 ? 'шорт спреда к среднему' : 'лонг спреда к среднему') + '</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + verdictCol + '">' + pct(mp.prob, 1) + '</div><div class="l">Слой 2: мета-вероятность</div><div class="e">' + verdictTxt + '</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + (it.pExp >= 0.52 ? ME : BAD) + '">' + pct(it.pExp, 0) + '</div><div class="l">шанс P(T ≤ ' + (it.daysToExp - 1) + ' дн.)</div><div class="e">до экспирации ' + it.daysToExp + ' сессий</div></div>' +
          '</div>' +
          '<table class="t">' +
            '<tr><th>Признак обстановки на день #' + it.t + '</th><th>Значение</th><th>Вклад в логит оверлея</th></tr>' +
            '<tr><td>Всплеск волатильности (σ_5 / σ_35 − 1)</td><td>' + f(ft.x[0]) + '</td><td>' + U.sgn(mp.contrib[0]) + '</td></tr>' +
            '<tr><td>Локальный снос против возврата</td><td>' + f(ft.x[1]) + '</td><td>' + U.sgn(mp.contrib[1]) + '</td></tr>' +
            '<tr><td>Текущие круговые издержки стакана</td><td>' + f(ft.cost) + ' п.</td><td>' + U.sgn(mp.contrib[2]) + '</td></tr>' +
            '<tr><td>Напряжённость горизонта до экспирации</td><td>' + f(ft.x[3]) + '</td><td>' + U.sgn(mp.contrib[3]) + '</td></tr>' +
          '</table>' +
          '<div class="note" style="margin-top:10px"><b>Проверка постфактум по тройному барьеру:</b> если бы мы вошли полным лотом в этот день, сделка завершилась бы через <b>' + tbReal.holdBars + ' дн.</b> со статусом <b>' + tbReal.outcome.toUpperCase() + '</b> и чистым результатом ' + col(tbReal.netPnl, 2) + ' п.</div>';
      }
      draw7();
    }
  });

  /* ---------- 8. Честный эксперимент 4×11 и карта зрелости v1 / v2 / v3 / research-only ---------- */
  Z.push({
    id: 'ml-verdict',
    title: 'Честный эксперимент 4 × 11 и архитектура уровней v1 / v2 / v3',
    lead: 'Подведём итог 44 вневыборочных прогонов и соберём в единую картину всю библиотеку из 16 разделов учебника: что входит в базовое ядро, а что живёт только под конвоем предохранителей.',
    text: () => `
      <h3>Архитектура трезвости: чем сложнее модель, тем позже и строже допуск (§4.11)</h3>
      <ul>
        <li><b>Ядро v1 (прозрачный фундамент):</b> Z-score с гистерезисом, календарный ролл и перенос (carry), микроструктура и 4 слоя издержек MOEX, волатильностный таргетинг, дробный Келли и капы вместимости.</li>
        <li><b>Уровень v2 (режим и аккуратные оверлеи):</b> полосы Орнштейна — Уленбека, фильтр режимов Гамильтона (HMM), ${T('meta_labeling', 'meta-labeling')} на ${T('triple_barrier', 'тройном барьере')} и кривые выживаемости ${T('survival_conv', 'P(T_conv ≤ H)')}.</li>
        <li><b>Уровень v3 (тонкие структуры с конформным контролем):</b> копулы хвостов, непараметрические оценки и квантильная/конформная калибровка с ${T('score_downweight', 'downweighting')}.</li>
        <li><b>Песочница Research-only:</b> ${T('rl_safeguards', 'RL под пятью замками')} и несъёмным предупреждающим бейджем — никогда вместо базового понимания экономики пары.</li>
      </ul>`,
    mount(el) {
      const seeds = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
      const rows = E.ML_SCENARIOS.map((sc) => {
        let bz = 0, bb = 0, rl = 0, ms = 0, ddBz = 0, ddMs = 0;
        seeds.forEach((sd) => {
          const r = E.backtestMlApproaches(E.genMlScenario(sd, sc)).approaches;
          bz += r.base_z.total;
          bb += r.blackbox_ml.total;
          rl += r.naive_rl.total;
          ms += r.meta_survival.total;
          ddBz += r.base_z.maxDD / seeds.length;
          ddMs += r.meta_survival.maxDD / seeds.length;
        });
        return { name: sc.name, bz, bb, rl, ms, ddBz, ddMs };
      });

      el.innerHTML = `
        <div class="viz">
          <h4>Сводная таблица 44 вневыборочных прогонов (4 сценария × 11 историй, п. спрэда)</h4>
          <div style="overflow:auto"><table class="t" id="tab8"></table></div>
          <h4 style="margin:14px 0 6px">Карта эшелонов всего скринера (разделы 1–16)</h4>
          <table class="t">
            <tr><th>Эшелон</th><th>Инструменты учебника</th><th>Главный предохранитель</th></tr>
            <tr><td style="color:${ME};font-weight:700">v1 · Базовое ядро</td><td>Z-score, робастные медианы/EWMA, коинтеграция, календари и carry, издержки MOEX, Book и дробный Келли</td><td>Гейты ликвидности, целых лотов и 2× cost</td></tr>
            <tr><td style="color:${PRE};font-weight:700">v2 · Режимы и оверлеи</td><td>Полосы OU/Бертрама, фильтр HMM, Meta-labeling и кривая выживаемости P(T ≤ H)</td><td>WFO с purging/embargo, плато ≥ 70%, DSR ≥ 0,95</td></tr>
            <tr><td style="color:${GOLD};font-weight:700">v3 · Продвинутый слой</td><td>Копулы Клейтона/Гамбеля/t, Mispricing Index, конформные интервалы скора</td><td>Минимум истории MinBTL и штраф downweighting</td></tr>
            <tr><td style="color:${SIM};font-weight:700">Research-only</td><td>Агенты обучения с подкреплением (RL)</td><td>5 замков + Kill-Switch + запрет на прод-ядро</td></tr>
          </table>
        </div>`;

      el.querySelector('#tab8').innerHTML =
        '<tr><th>Сценарий (сумма по 11 историям)</th><th>База Z-score</th><th>Чёрный ящик</th><th>Наивный RL</th><th>Meta + Survival</th><th>Ср. MaxDD (База → Оверлей)</th></tr>' +
        rows.map((r) => '<tr>' +
          '<td><b>' + r.name + '</b></td>' +
          '<td>' + col(r.bz, 0) + '</td>' +
          '<td>' + col(r.bb, 0) + '</td>' +
          '<td>' + col(r.rl, 0) + '</td>' +
          '<td style="background:rgba(126,224,181,0.12);font-weight:700">' + col(r.ms, 0) + '</td>' +
          '<td>' + f(r.ddBz, 1) + ' → <b style="color:' + ME + '">' + f(r.ddMs, 1) + '</b></td>' +
        '</tr>').join('');
    }
  });
})();
