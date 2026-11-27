/* Честная валидация и защита от переобучения, экраны 1–4: Walk-Forward с purging/embargo
   и двойным OOS, поверхность параметров (плато vs пик, WFC), CPCV/PBO на 6 блоках и PSR/DSR (#66, #50). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, HV = window.HV;
  const Z = (window.VLSCREENS = []);
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', PRE = '#5aa9ff', GOLD = '#ffd166', PURP = '#c9b6ff';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const pct = (v, d) => U.fmt(v * 100, d === undefined ? 0 : d) + '%';
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 2 : d) + '</span>';

  /* ---------- 0. Метрики эффективности без самообмана: Sharpe, Sortino, Calmar и хвосты (§5.8) ---------- */
  const s0 = { rfRate: 16.0, tailCrash: 4.6 };

  Z.push({
    id: 'metrics-primer',
    title: 'Чем мерить стратегию: Sharpe (×√252 и ставка ЦБ), Sortino, Calmar и хвосты',
    lead: 'Прежде чем проверять стратегии на переобучение, договоримся о линейке: почему голых пунктов прибыли недостаточно, откуда в годовом Шарпе берётся √252, зачем на MOEX вычитать ключевую ставку и что прячут скошенность с эксцессом.',
    text: () => `
      <h3>${T('sharpe_ratio', 'Коэффициент Шарпа')} простыми словами</h3>
      <p>Две стратегии заработали за год по <code>+24%</code>, но первая шла ровно, а вторая трижды роняла счёт на треть. Чтобы сравнить <i>цену нервов</i>, делят среднюю дневную доходность <b>сверх безрисковой ставки</b> на дневной разброс <code>σ_дн</code> и переводят в годовой масштаб:</p>
      <span class="formula">Sharpe_год = ((R̄_дн − r_безр ÷ 252) ÷ σ_дн) × √252<small>Почему × √252 ≈ 15,87, а не × 252? За 252 торговых дня средний доход копится в 252 раза, а разброс независимых шагов — в √252 раз (252 ÷ √252 = √252).</small></span>
      <ul>
        <li><b>Поправка на ставку ЦБ (<code>r_безр</code>):</b> заработать <code>+14%</code> на счёте, когда фонд денежного рынка или ОФЗ под ГО дают <code>16–19%</code> без риска, — значит сработать в <i>отрицательный</i> честный Sharpe!</li>
        <li><b>${T('sortino_calmar', 'Sortino и Calmar')} (§5.8):</b> обычный Шарп одинаково штрафует и за обвал вниз, и за резкий всплеск прибыли вверх. <b>Sortino</b> оставляет в знаменателе только минусовые дни, а <b>Calmar</b> делит годовой избыточный доход на максимальную просадку <code>MaxDD</code>.</li>
        <li><b>${T('skew_kurt', 'Скошенность и избыточный эксцесс κ')}:</b> у возвратных стратегий часты мелкие плюсы и редкие обрывы (<i>отрицательная скошенность</i> и <i>толстые хвосты</i> <code>κ &gt; 0</code>) — на коротком отрезке их «сырой Шарп» обманчиво высок до первого срыва!</li>
      </ul>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Две стратегии за 252 дня: одинаковый валовый доход, но разная форма хвостов</h4>
          <div id="sl0a"></div>
          <div id="sl0b"></div>
          <div id="kpi0" style="margin:10px 0"></div>
          <div class="legend">
            <span><i style="background:${ME}"></i>Стратегия Б: ровный спред со стопом</span>
            <span><i style="background:${BAD}"></i>Стратегия А: «зёрнышки перед обрывом» (хвостовой срыв)</span>
            <span><i style="background:${GOLD}"></i>безрисковая планка (вклад / LQDT)</span>
          </div>
          <div id="c0"></div>
          <table class="t" id="tab0" style="margin-top:10px"></table>
        </div>`;

      HV.slider(el.querySelector('#sl0a'), {
        label: 'Безрисковая рублёвая ставка r_безр (ключевая / денежный рынок)', min: 0, max: 22, step: 1, value: s0.rfRate,
        fmt: (v) => v + '% годовых',
        onInput: (v) => { s0.rfRate = v; draw0(); }
      });
      HV.slider(el.querySelector('#sl0b'), {
        label: 'Глубина редкого хвостового срыва у Стратегии А (2 дня из 252)', min: 1.5, max: 7.5, step: 0.5, value: s0.tailCrash,
        fmt: (v) => '−' + f(v, 1) + '% за удар',
        onInput: (v) => { s0.tailCrash = v; draw0(); }
      });

      let eqA = [], eqB = [], eqRf = [];
      const c0 = A.mkChart(el.querySelector('#c0'), 185, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>' +
          '<span style="color:' + ME + '">Ровная Б: <b>+' + f(eqB[i], 1) + '%</b></span><br>' +
          '<span style="color:' + BAD + '">Хвостовая А: <b>' + U.sgn(eqA[i], 1) + '%</b></span><br>' +
          '<span style="color:' + GOLD + '">Безрисковая: +' + f(eqRf[i], 1) + '%</span>'
      });

      function draw0() {
        const rng = E.mulberry32(31);
        const retA = [], retB = [];
        const targetSum = 24.0; // обе целятся около +24% за год
        const baseGainA = (targetSum + 2 * s0.tailCrash) / 250;
        let aAcc = 0, bAcc = 0, rAcc = 0;
        eqA = []; eqB = []; eqRf = [];
        for (let i = 0; i < 252; i++) {
          const n1 = (rng() + rng() - 1) * 0.42;
          const rB = (targetSum / 252) + n1;
          const rA = (i === 88 || i === 196) ? -s0.tailCrash : baseGainA + (rng() - 0.5) * 0.14;
          retB.push(rB);
          retA.push(rA);
          aAcc += rA; bAcc += rB; rAcc += s0.rfRate / 252;
          eqA.push(aAcc); eqB.push(bAcc); eqRf.push(rAcc);
        }
        const mA = E.riskAdjustedMetrics(retA, s0.rfRate);
        const mB = E.riskAdjustedMetrics(retB, s0.rfRate);

        el.querySelector('#kpi0').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v">' + f(mB.srRaw) + ' → <span style="color:' + (mB.srExcess > 0.5 ? ME : BAD) + '">' + U.sgn(mB.srExcess) + '</span></div><div class="l">Sharpe Б (сырой → сверх ЦБ)</div><div class="e">после вычета ' + s0.rfRate + '% год.</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + BAD + '">' + U.sgn(mA.skew, 1) + ' / +' + f(Math.max(0, mA.exKurt), 1) + '</div><div class="l">скошенность / эксцесс κ у А</div><div class="e">ловушка редких обрывов!</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + ME + '">' + f(mB.calmar, 1) + ' vs ' + f(mA.calmar, 1) + '</div><div class="l">Calmar (Б против А)</div><div class="e">учёт глубины ямы MaxDD</div></div>' +
          '</div>';

        c0.render({
          n: 252,
          series: [
            { data: eqRf, color: GOLD, width: 1.4, dash: [4, 4] },
            { data: eqA, color: BAD, width: 1.9 },
            { data: eqB, color: ME, width: 2.3 }
          ]
        });

        el.querySelector('#tab0').innerHTML =
          '<tr><th>Показатель за 252 дня</th><th>Стратегия Б (ровная)</th><th>Стратегия А (с хвостовым срывом)</th></tr>' +
          '<tr><td>Годовой доход (валовый / сверх ставки ЦБ)</td><td>+' + f(mB.annRet, 1) + '% / ' + col(mB.annExRet, 1) + '%</td><td>+' + f(mA.annRet, 1) + '% / ' + col(mA.annExRet, 1) + '%</td></tr>' +
          '<tr><td>Честный годовой Sharpe (сверх r_безр)</td><td class="pos"><b>' + U.sgn(mB.srExcess) + '</b></td><td>' + U.sgn(mA.srExcess) + '</td></tr>' +
          '<tr><td>Sortino (штраф только за минусы)</td><td class="pos"><b>' + U.sgn(mB.sortino) + '</b></td><td class="neg">' + U.sgn(mA.sortino) + '</td></tr>' +
          '<tr><td>Макс. просадка MaxDD / коэффициент Calmar</td><td>−' + f(mB.maxDD, 1) + '% / <b>' + f(mB.calmar) + '</b></td><td class="neg">−' + f(mA.maxDD, 1) + '% / <b>' + f(mA.calmar) + '</b></td></tr>' +
          '<tr><td>Скошенность / избыточный эксцесс κ</td><td>' + U.sgn(mB.skew) + ' / ' + U.sgn(mB.exKurt) + '</td><td class="neg"><b>' + U.sgn(mA.skew) + ' / +' + f(Math.max(0, mA.exKurt), 1) + '</b></td></tr>';
      }
      draw0();
    }
  });

  /* ---------- 1. Walk-Forward, purging/embargo и неприкосновенный holdout ---------- */
  const s1 = { peBars: 0 };

  Z.push({
    id: 'wfo-purge',
    title: 'Walk-Forward, очистка стыков (purging/embargo) и священный holdout',
    lead: 'Подогнать параметры под прошлый график легко — трудно не обмануть самого себя. Честная проверка требует шага вперёд во времени, санитарного зазора на стыках окон и неприкосновенного запаса истории.',
    text: () => `
      <h3>Три рубежа обороны от утечки будущего</h3>
      <p>Когда стратегию настраивают и оценивают на одном и том же куске истории, возникает ${T('overfit_peak', 'переобучение')}: алгоритм запоминает случайные зигзаги прошлого, как школьник, зазубривший ответы к прошлогоднему варианту ЕГЭ.</p>
      <ol>
        <li><b>${T('wfo_opt', 'Walk-Forward («шаг вперёд»)')}:</b> калибруем параметры на прошлом окне, а проверяем строго на следующем, ещё не виденном отрезке.</li>
        <li><b>${T('purging_embargo', 'Purging и Embargo (очистка и карантин стыка)')}:</b> спрэдовые наблюдения не независимы! Если сделка или 60-дневное скользящее окно перешагнули границу между обучением и тестом, будущая цена тихо просачивается в отбор. <i>Purging</i> вырезает перекрывающийся хвост перед границей, а <i>Embargo</i> делает защитный отступ после неё.</li>
        <li><b>${T('double_oos', 'Двойной OOS (неприкосновенный holdout)')}:</b> финальный кусок истории (дни 361–500) запирается в «сейф» с первой минуты исследования и проверяется ровно один раз в самом конце.</li>
      </ol>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Анатомия разреза истории (500 дней) и эффект очистки стыка</h4>
          <div id="sl1"></div>
          <div id="bar1" style="margin:12px 0"></div>
          <div id="kpi1" style="margin-bottom:10px"></div>
          <div class="legend">
            <span><i style="background:${BAD}"></i>наивный сплит без чистки (0 дн.) на Holdout</span>
            <span><i style="background:${ME}"></i>выбор с вашим purging/embargo на Holdout</span>
          </div>
          <div id="c1"></div>
        </div>`;

      HV.slider(el.querySelector('#sl1'), {
        label: 'Ширина санитарной зоны Purging + Embargo вокруг стыка (день #220)', min: 0, max: 35, step: 5, value: s1.peBars,
        fmt: (v) => v === 0 ? '0 дн. (стык протекает!)' : 'по ' + v + ' дн. до и после стыка',
        onInput: (v) => { s1.peBars = v; draw1(); }
      });

      const vd = E.genValidScenario(7, E.VALID_SCENARIOS[2]); // leak_overlap
      const devSeries = vd.spread.slice(0, vd.holdoutStart);
      let eqZero = null, eqUser = null;

      const c1 = A.mkChart(el.querySelector('#c1'), 190, {
        tip: (i) => eqZero ? '<b>День holdout #' + (i + 1) + ' (день ' + (361 + i) + ')</b><br>' +
          '<span style="color:' + BAD + '">Без чистки: <b>' + U.sgn(eqZero[i]) + ' п.</b></span><br>' +
          '<span style="color:' + ME + '">С вашим зазором: <b>' + U.sgn(eqUser[i]) + ' п.</b></span>' : ''
      });

      function pickBestSplit(surf) {
        let best = -1e9, pN = 30, pZ = 1.65;
        for (let r = 0; r < surf.nGrid.length; r++) {
          for (let c = 0; c < surf.zGrid.length; c++) {
            const sc = 0.55 * surf.isGrid[r][c] + 0.45 * surf.oosGrid[r][c];
            if (sc > best) { best = sc; pN = surf.nGrid[r]; pZ = surf.zGrid[c]; }
          }
        }
        return { n: pN, entryZ: pZ };
      }

      function holdoutEq(cfg) {
        const run = E.quickSpreadRun(vd.spread, cfg.n, cfg.entryZ, Math.min(0.30, cfg.entryZ * 0.32), vd.cost);
        const hd = run.diffs.slice(vd.holdoutStart);
        const out = [];
        let s = 0;
        for (let i = 0; i < hd.length; i++) { s += hd[i]; out.push(s); }
        return out;
      }

      const surf0 = E.paramSurface(devSeries, { splitIdx: 220, purgeBars: 0, embargoBars: 0, cost: vd.cost, spikeMirage: vd.spikeMirage });
      const cfg0 = pickBestSplit(surf0);
      eqZero = holdoutEq(cfg0);

      function draw1() {
        const p = s1.peBars;
        const isW = ((220 - p) / 500) * 100;
        const puW = ((2 * p) / 500) * 100;
        const valW = ((140 - p) / 500) * 100;
        const hoW = (140 / 500) * 100;

        el.querySelector('#bar1').innerHTML =
          '<div style="display:flex;height:30px;border-radius:8px;overflow:hidden;border:1px solid #2a3242;font-size:12px;font-weight:600;color:#0e1218">' +
            '<div style="width:' + isW.toFixed(1) + '%;background:' + PRE + ';display:flex;align-items:center;justify-content:center">Обучение IS</div>' +
            (p > 0 ? '<div style="width:' + puW.toFixed(1) + '%;background:' + BAD + ';color:#fff;display:flex;align-items:center;justify-content:center">Purge+Emb</div>' : '') +
            '<div style="width:' + valW.toFixed(1) + '%;background:' + GOLD + ';display:flex;align-items:center;justify-content:center">Проверка WFO</div>' +
            '<div style="width:' + hoW.toFixed(1) + '%;background:' + ME + ';display:flex;align-items:center;justify-content:center">Священный Holdout</div>' +
          '</div>';

        const surfU = E.paramSurface(devSeries, { splitIdx: 220, purgeBars: p, embargoBars: p, cost: vd.cost, spikeMirage: vd.spikeMirage });
        const cfgU = pickBestSplit(surfU);
        eqUser = holdoutEq(cfgU);
        const totU = eqUser[eqUser.length - 1];

        el.querySelector('#kpi1').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v">N=' + cfgU.n + ', z=' + f(cfgU.entryZ) + 'σ</div><div class="l">выбранная настройка</div><div class="e">' + (cfgU.entryZ < 1.05 ? 'попалась на утечку стыка!' : 'здоровая настройка') + '</div></div>' +
            '<div class="kpi"><div class="v">' + col(totU, 1) + ' п.</div><div class="l">итог на святом Holdout</div><div class="e">дни 361–500 (не трогали!)</div></div>' +
            '<div class="kpi"><div class="v">' + f(surfU.wfc) + '</div><div class="l">корреляция карт WFC</div><div class="e">после очистки стыка</div></div>' +
          '</div>';

        c1.render({
          n: eqZero.length,
          hlines: [{ y: 0, color: '#ffffff24', dash: [3, 3] }],
          series: [
            { data: eqZero, color: BAD, width: 1.6, dash: [4, 4] },
            { data: eqUser, color: ME, width: 2.3 }
          ]
        });
      }
      draw1();
    }
  });

  /* ---------- 2. Поверхность параметров: плато против пика и WFC ---------- */
  const s2 = { scenIdx: 0, selR: 2, selC: 3 };

  Z.push({
    id: 'plateau-wfc',
    title: 'Поверхность параметров: широкое плато против одинокого пика',
    lead: 'Никогда не выбирайте самую яркую точку на карте истории в отрыве от соседей. Одинокая игла — почти всегда случайный шум, а широкое столообразное плато — признак настоящей закономерности.',
    text: () => `
      <h3>География надёжности: ${T('param_plateau', 'плато')} и метрика ${T('wfc_corr', 'WFC')}</h3>
      <p>Отложим по строкам длину окна <code>N</code>, по столбцам — порог входа <code>z_вход</code>, и раскрасим каждую из <code>36</code> клеток по годовому коэффициенту Шарпа:</p>
      <ul>
        <li><b style="color:${BAD}">Одинокий пик:</b> в одной клетке блестит <code>Sharpe = 3,2</code>, но стоит сдвинуть окно на 10 дней или порог на <code>0,3σ</code> — и результат обрывается ниже <code>50%</code> от вершины. На живом рынке такая игла рассыплется мгновенно.</li>
        <li><b style="color:${ME}">Широкое плато (правило ≥ 70%):</b> все соседние клетки сохраняют не менее <code>70%</code> результата центра. Даже если рынок слегка изменит темп, стратегия останется на твёрдой земле.</li>
        <li><b>WFC (Walk-Forward Correlation):</b> корреляция между левой картой (обучение IS) и правой картой (проверка OOS) по всем 36 клеткам. При <code>WFC &gt; +0,50</code> рельеф реально воспроизводится в будущем; при <code>WFC ≈ 0</code> карта обучения — лотерейный билет!</li>
      </ul>`,
    mount(el) {
      const scList = [E.VALID_SCENARIOS[0], E.VALID_SCENARIOS[3], E.VALID_SCENARIOS[1]];
      el.innerHTML = `
        <div class="viz">
          <h4>Двумерные карты Sharpe (6 × 6 = 36 настроек): кликните любую клетку!</h4>
          <div class="btns" id="b2" style="margin:0 0 10px"></div>
          <div id="kpi2" style="margin-bottom:10px"></div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:10px">
            <div style="min-width:0">
              <p class="cap" style="margin:0 0 6px"><b>Обучение (IS):</b> ★ — пик IS, ◉ — плато</p>
              <table class="t" id="hmIs" style="width:100%;table-layout:fixed;text-align:center;font-size:12.5px"></table>
            </div>
            <div style="min-width:0">
              <p class="cap" style="margin:0 0 6px"><b>Вне выборки (OOS):</b> новый участок</p>
              <table class="t" id="hmOos" style="width:100%;table-layout:fixed;text-align:center;font-size:12.5px"></table>
            </div>
          </div>
          <div id="cell2" class="note" style="margin-top:10px"></div>
        </div>`;

      const bEl = el.querySelector('#b2');
      bEl.innerHTML = scList.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name.split('(')[0].trim() + '</button>').join('');
      bEl.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (b) { s2.scenIdx = +b.dataset.i; draw2(true); }
      });

      function bgForSR(sr) {
        if (sr >= 1.8) return 'rgba(126, 224, 181, 0.34)';
        if (sr >= 0.8) return 'rgba(126, 224, 181, 0.16)';
        if (sr >= 0.0) return 'rgba(255, 209, 102, 0.12)';
        return 'rgba(255, 107, 107, 0.22)';
      }

      let curSurf = null;
      function renderGrid(grid, isLeft) {
        let html = '<tr><th style="padding:4px 2px">N\\z</th>' + curSurf.zGrid.map((z) => '<th style="padding:4px 2px">' + f(z, 2) + '</th>').join('') + '</tr>';
        for (let r = 0; r < curSurf.nGrid.length; r++) {
          html += '<tr><th style="padding:4px 2px">' + curSurf.nGrid[r] + '</th>';
          for (let c = 0; c < curSurf.zGrid.length; c++) {
            const val = grid[r][c];
            const isPk = r === curSurf.peak.r && c === curSurf.peak.c;
            const isPl = r === curSurf.plateau.r && c === curSurf.plateau.c;
            const isSel = r === s2.selR && c === s2.selC;
            const mark = isPk && isPl ? '★◉ ' : (isPk ? '★ ' : (isPl ? '◉ ' : ''));
            html += '<td data-r="' + r + '" data-c="' + c + '" style="padding:5px 2px;cursor:pointer;background:' + bgForSR(val) +
              (isSel ? ';outline:2px solid ' + GOLD + ';font-weight:700' : '') + '">' +
              (isLeft ? mark : '') + f(val, 1) + '</td>';
          }
          html += '</tr>';
        }
        return html;
      }

      el.addEventListener('click', (ev) => {
        const td = ev.target.closest('td[data-r]');
        if (td) { s2.selR = +td.dataset.r; s2.selC = +td.dataset.c; draw2(false); }
      });

      function draw2(resetSel) {
        bEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s2.scenIdx));
        const vd = E.genValidScenario(7, scList[s2.scenIdx]);
        curSurf = E.paramSurface(vd.spread.slice(0, vd.holdoutStart), {
          splitIdx: 220, purgeBars: 20, embargoBars: 20, cost: vd.cost, spikeMirage: vd.spikeMirage
        });
        if (resetSel) { s2.selR = curSurf.plateau.r; s2.selC = curSurf.plateau.c; }

        el.querySelector('#kpi2').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + (curSurf.wfc >= 0.45 ? ME : BAD) + '">' + U.sgn(curSurf.wfc) + '</div><div class="l">корреляция карт WFC</div><div class="e">' + (curSurf.wfc >= 0.45 ? 'рельеф устойчив!' : 'карта не переносится!') + '</div></div>' +
            '<div class="kpi"><div class="v">★ ' + f(curSurf.peak.isSR, 1) + ' → ' + f(curSurf.peak.oosSR, 1) + '</div><div class="l">пик IS → результат OOS</div><div class="e">плато соседей ' + pct(curSurf.peak.plateauRatio, 0) + '</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + ME + '">◉ ' + f(curSurf.plateau.isSR, 1) + ' → ' + f(curSurf.plateau.oosSR, 1) + '</div><div class="l">центр плато → OOS</div><div class="e">плато соседей ' + pct(curSurf.plateau.plateauRatio, 0) + '</div></div>' +
          '</div>';

        el.querySelector('#hmIs').innerHTML = renderGrid(curSurf.isGrid, true);
        el.querySelector('#hmOos').innerHTML = renderGrid(curSurf.oosGrid, false);

        const r = s2.selR, c = s2.selC;
        const pRat = curSurf.plateauGrid[r][c];
        el.querySelector('#cell2').innerHTML =
          '<b>Выбрана клетка (N = ' + curSurf.nGrid[r] + ' дн., z = ' + f(curSurf.zGrid[c]) + 'σ):</b> ' +
          'Sharpe на обучении = <b>' + f(curSurf.isGrid[r][c]) + '</b>, вне выборки OOS = <b>' + f(curSurf.oosGrid[r][c]) + '</b> · ' +
          'удержание соседями = <b style="color:' + (pRat >= 0.70 ? ME : BAD) + '">' + pct(pRat, 0) + '</b> ' +
          (pRat >= 0.70 ? '(широкое плато ≥ 70% ✓)' : '(хрупкий склон / игла < 70%!)');
      }
      draw2(true);
    }
  });

  /* ---------- 3. CPCV на 6 блоках (20 разбиений) и PBO ---------- */
  const s3 = { scenIdx: 1 };

  Z.push({
    id: 'cpcv-pbo',
    title: 'Комбинаторная кросс-валидация (CPCV) и вероятность самообмана PBO',
    lead: 'Одной дорожке Walk-Forward могло просто повезти с удачным полугодием. CPCV разрезает историю на 6 блоков и проверяет все 20 сочетаний «обучение против теста», вычисляя точную долю провалов чемпиона.',
    text: () => `
      <h3>Как устроены ${T('cpcv_method', 'CPCV')} и ${T('pbo_metric', 'PBO')} без высшей математики</h3>
      <p>Разделим историю исследования на <b>6 равных блоков</b> <code>[1, 2, 3, 4, 5, 6]</code>. Сколько существует способов выбрать 3 блока для обучения, а оставшиеся 3 отдать под честный экзамен (с <i>purging</i> и <i>embargo</i> на всех разрезах)?</p>
      <p>По школьной формуле сочетаний: <code>C(6, 3) = (6 × 5 × 4) ÷ (3 × 2 × 1) = 20</code> независимых экзаменов!</p>
      <ul>
        <li>В каждом из 20 экзаменов находим «отличника обучения» среди 16 настроек и смотрим, какое место <code>ω</code> (от <code>0%</code> до <code>100%</code>) он занял на тестовых блоках.</li>
        <li>Если <code>ω ≤ 50%</code>, значит «лучший на обучении» на деле выступил <b>хуже медианы</b> (середнячка)!</li>
        <li>Доля таких конфузов из 20 попыток и есть <b>PBO (Probability of Backtest Overfitting)</b>. Для допуска в работу нужно <code>PBO ≤ 0,50</code> (а у хороших пар <code>PBO ≤ 0,25</code>).</li>
      </ul>`,
    mount(el) {
      const scList = [E.VALID_SCENARIOS[3], E.VALID_SCENARIOS[1], E.VALID_SCENARIOS[0]];
      el.innerHTML = `
        <div class="viz">
          <h4>Все 20 комбинаторных экзаменов C(6, 3) вживую</h4>
          <div class="btns" id="b3" style="margin:0 0 10px"></div>
          <div id="kpi3" style="margin-bottom:10px"></div>
          <div style="max-height:310px;overflow:auto"><table class="t" id="tab3"></table></div>
        </div>`;

      const bEl = el.querySelector('#b3');
      bEl.innerHTML = [
        '<button class="b" data-i="0">Устойчивая пара (низкий PBO)</button>',
        '<button class="b" data-i="1">Случайное блуждание (высокий PBO!)</button>',
        '<button class="b" data-i="2">Пара с ложным пиком</button>'
      ].join('');
      bEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s3.scenIdx = +b.dataset.i; draw3(); } });

      function draw3() {
        bEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s3.scenIdx));
        const vd = E.genValidScenario(7, scList[s3.scenIdx]);
        const cp = E.runCPCV(vd.spread.slice(0, vd.holdoutStart), {
          cost: vd.cost, purgeBars: 10, embargoBars: 10, spikeMirage: vd.spikeMirage
        });

        const avgOmega = cp.splits.reduce((s, x) => s + x.omega, 0) / cp.splits.length;
        el.querySelector('#kpi3').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + (cp.pbo <= 0.50 ? ME : BAD) + '">' + f(cp.pbo) + ' (' + cp.overfitCount + '/20)</div><div class="l">вероятность переобучения PBO</div><div class="e">' + (cp.pbo <= 0.50 ? 'норма ≤ 0,50 пройдена ✓' : 'тревога > 0,50: отбор ловит шум!') + '</div></div>' +
            '<div class="kpi"><div class="v">' + pct(avgOmega, 0) + '</div><div class="l">средний ранг чемпиона на тесте</div><div class="e">100% — лучший и вне выборки</div></div>' +
            '<div class="kpi"><div class="v">20 путей</div><div class="l">сочетаний C(6, 3)</div><div class="e">по ' + cp.configsCount + ' кандидатов в каждом</div></div>' +
          '</div>';

        el.querySelector('#tab3').innerHTML =
          '<tr><th>#</th><th>Блоки обучения</th><th>Блоки теста</th><th>Чемпион IS</th><th>Sharpe IS → Тест</th><th>Ранг на тесте ω</th><th>Итог сплита</th></tr>' +
          cp.splits.map((sp) =>
            '<tr><td>' + sp.id + '</td>' +
            '<td>[' + sp.trainBlocks.join(', ') + ']</td>' +
            '<td>[' + sp.testBlocks.join(', ') + ']</td>' +
            '<td>N=' + sp.winnerCfg.n + ', z=' + f(sp.winnerCfg.entryZ) + '</td>' +
            '<td>' + f(sp.winnerIsSR, 1) + ' → <b>' + f(sp.winnerOosSR, 1) + '</b></td>' +
            '<td><b>' + pct(sp.omega, 0) + '</b></td>' +
            '<td>' + (sp.belowMedian ? '<span class="pill stop">Хуже медианы (провал)</span>' : '<span class="pill ok">Выше медианы ✓</span>') + '</td></tr>'
          ).join('');
      }
      draw3();
    }
  });

  /* ---------- 4. Множественное тестирование: PSR, сдутый Шарп DSR и журнал N ---------- */
  const s4 = { sr: 1.75, trials: 25, lenT: 360, exKurt: 1.5 };

  Z.push({
    id: 'psr-dsr',
    title: 'Плата за число попыток: PSR, «сдутый Шарп» DSR и журнал экспериментов',
    lead: 'Если тысяча человек подбросит монетку десять раз подряд, у кого-то обязательно выпадет десять орлов. DSR переводит красивый исторический Sharpe в честную вероятность успеха с поправкой на то, сколько вариантов вы перебрали.',
    text: () => `
      <h3>От сырого Sharpe к ${T('psr_metric', 'PSR')} и ${T('dsr_metric', 'DSR')}</h3>
      <p>Голый коэффициент Шарпа молчит о двух главных подвохах: насколько коротка история с тяжёлыми хвостами и сколько сотен кнопок вы перекрутили до того, как нашли «красивый график».</p>
      <ul>
        <li><b>PSR (Probabilistic Sharpe Ratio):</b> проверяет одну стратегию — какова вероятность, что истинный Sharpe больше нуля с учётом длины ряда <code>T</code>, скошенности и толщины хвостов (избыточного эксцесса <code>κ = γ₄ − 3</code>, где у гауссова колокола <code>κ = 0</code>).</li>
        <li><b>Ожидаемый рекорд шума <code>SR₀(N)</code>:</b> чем больше независимых попыток <code>N</code> записано в <b>журнале экспериментов</b>, тем выше планка <code>SR₀(N)</code>, которую случайно пробьёт чистый шум.</li>
        <li><b>DSR (Deflated Sharpe Ratio — «сдутый Шарп»):</b> вероятность того, что ваш результат выше случайного рекорда <code>SR₀(N)</code>. В промоушн-гейте требуется <code>DSR ≥ 0,95</code>!</li>
      </ul>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Калькулятор «сдувания» Шарпа с ростом журнала попыток N</h4>
          <div id="sl4sr"></div>
          <div id="sl4n"></div>
          <div id="sl4t"></div>
          <div id="sl4k"></div>
          <div id="kpi4" style="margin:10px 0"></div>
          <div class="legend">
            <span><i style="background:${ME}"></i>вероятность подлинности DSR(N)</span>
            <span><i style="background:${GOLD}"></i>порог промоушн-гейта 0,95 (95%)</span>
            <span><i style="background:${BAD}"></i>красная черта 0,50 (шум вероятнее сигнала)</span>
          </div>
          <div id="c4"></div>
        </div>`;

      HV.slider(el.querySelector('#sl4sr'), {
        label: 'Наблюдаемый годовой Sharpe лучшей настройки', min: 0.70, max: 3.00, step: 0.05, value: s4.sr,
        fmt: (v) => f(v),
        onInput: (v) => { s4.sr = v; draw4(); }
      });
      HV.slider(el.querySelector('#sl4n'), {
        label: 'Число попыток N в журнале экспериментов', min: 1, max: 300, step: 1, value: s4.trials,
        fmt: (v) => v + ' попыт.',
        onInput: (v) => { s4.trials = v; draw4(); }
      });
      HV.slider(el.querySelector('#sl4t'), {
        label: 'Длина проверочной истории T (в торговых днях)', min: 120, max: 750, step: 15, value: s4.lenT,
        fmt: (v) => v + ' дн. (~' + f(v / 252, 1) + ' г.)',
        onInput: (v) => { s4.lenT = v; draw4(); }
      });
      HV.slider(el.querySelector('#sl4k'), {
        label: 'Толщина хвостов доходности (избыточный эксцесс; 0 = гауссов штиль)', min: 0.0, max: 7.0, step: 0.5, value: s4.exKurt,
        fmt: (v) => (v === 0 ? '0 (нормальный колокол, γ₄ = 3)' : '+' + f(v, 1) + ' (γ₄ = ' + f(3 + v, 1) + ')'),
        onInput: (v) => { s4.exKurt = v; draw4(); }
      });

      let nAxis = [], dsrCurve = [];
      const c4 = A.mkChart(el.querySelector('#c4'), 190, {
        tip: (i) => nAxis[i] !== undefined ? '<b>Попыток N = ' + nAxis[i] + '</b><br>Сдутый Шарп DSR: <b>' + f(dsrCurve[i], 3) + ' (' + pct(dsrCurve[i], 1) + ')</b>' : ''
      });

      function draw4() {
        const fullKurt = 3 + s4.exKurt;
        const psr1 = E.calcPSR(s4.sr, s4.lenT, -0.25, fullKurt, 0);
        const curDsr = E.calcDSR(s4.sr, s4.lenT, -0.25, fullKurt, s4.trials, 0.55);

        nAxis = []; dsrCurve = [];
        for (let k = 1; k <= 60; k++) {
          const nVal = k === 1 ? 1 : k * 5;
          nAxis.push(nVal);
          dsrCurve.push(E.calcDSR(s4.sr, s4.lenT, -0.25, fullKurt, nVal, 0.55).dsr);
        }

        const curIdx = Math.min(59, s4.trials <= 1 ? 0 : Math.max(1, Math.round(s4.trials / 5) - 1));
        const dCol = curDsr.dsr >= 0.95 ? ME : (curDsr.dsr >= 0.90 ? GOLD : BAD);

        el.querySelector('#kpi4').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v">' + pct(psr1.psr, 1) + '</div><div class="l">одиночный PSR (при N = 1)</div><div class="e">без платы за перебор</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + SIM + '">' + f(curDsr.sr0Ann) + '</div><div class="l">планка рекорда шума SR₀(N)</div><div class="e">при N = ' + s4.trials + ' попытках</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + dCol + '">' + f(curDsr.dsr, 3) + '</div><div class="l">сдутый Шарп DSR</div><div class="e">' + (curDsr.dsr >= 0.95 ? 'PASS ≥ 0,95 ✓' : (curDsr.dsr >= 0.90 ? 'BORDERLINE (0,90–0,95)' : 'REJECT < 0,90!')) + '</div></div>' +
          '</div>';

        c4.render({
          n: dsrCurve.length,
          hlines: [
            { y: 0.95, color: GOLD + '99', dash: [4, 4] },
            { y: 0.50, color: BAD + '88', dash: [3, 3] }
          ],
          markers: [{ i: curIdx, y: dsrCurve[curIdx], color: dCol, r: 5 }],
          series: [{ data: dsrCurve, color: ME, width: 2.2 }]
        });
      }
      draw4();
    }
  });
})();
