/* Размер позиции и сборка портфеля («книги») спредов, экраны 1–4:
   vol-targeting и дробный Келли, вместимость стакана и целые лоты,
   ловушка скрытой концентрации (граф дублей) и жадный субмодулярный отбор (#69, #51). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, HV = window.HV;
  const Z = (window.BKSCREENS = []);
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', PRE = '#5aa9ff', GOLD = '#ffd166', PURP = '#c9b6ff';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const pct = (v, d) => U.fmt(v * 100, d === undefined ? 0 : d) + '%';
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 1 : d) + '</span>';

  /* ---------- 1. Vol-targeting и парабола дробного Келли ---------- */
  const s1 = { haircut: 0.70, kurt: 3.0, clones: 1, storm: 1.0 };

  Z.push({
    id: 'vol-kelly',
    title: 'Волатильностный таргетинг и парабола дробного Келли',
    lead: 'Мало знать, когда войти в спред — нужно решить, сколько поставить. Слишком робкая ставка не окупит усилий, а полный «оптимальный» Келли при малейшей ошибке оценки сбрасывает счёт с обрыва.',
    text: () => `
      <h3>Два правила выживания капитала</h3>
      <p>Даже у стратегии с честным положительным ожиданием кривая счёта рушится от неверного размера позиции. В арсенале риск-менеджмента (§4.10) работают две главные ступени:</p>
      <ol>
        <li><b>${T('vol_targeting', 'Волатильностный таргетинг (vol-targeting)')}:</b> мы задаём фиксированный <i>рублевый бюджет дневного риска</i> на слот (например, <code>15 000 ₽</code> дневного СКО). Если рынок спокоен и спред ходит по <code>1 500 ₽</code> в день — держим <code>10</code> связок. Начался шторм и разброс утроился до <code>4 500 ₽</code> — формула сама сжимает позицию до <code>3</code> связок!</li>
        <li><b>${T('fractional_kelly', 'Дробный критерий Келли (0,25–0,5× Kelly)')}:</b> на бумаге формула Келли <code>f* = μ / σ²</code> максимизирует долгосрочный рост. Но замечательный школьный факт параболы <code>m − m²/2</code> гласит: взяв <b>половинку Келли (<code>0,5×</code>)</b>, вы сохраняете <b>ровно 75%</b> максимального темпа роста при <b>вчетверо меньшей дисперсии</b>!</li>
      </ol>
      <p>А если реальный край оказался на 30% скромнее бэктеста, хвосты толще нормальных или в портфеле лежат коррелированные клоны — полный <code>1,0× Келли</code> перелетает через вершину и падает за ${T('overbetting_cliff', 'обрыв овербеттинга')}, где сложный процент работает уже против счёта.</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Парабола геометрического роста счёта (от 0× до 2,2× наивного Келли)</h4>
          <div id="sl1"></div>
          <div id="kpi1" style="margin:10px 0"></div>
          <div class="legend">
            <span><i style="background:${PRE}"></i>бумажная парабола Келли (идеальный мир)</span>
            <span><i style="background:${ME}"></i>реальный темп роста (с усушкой края, хвостами и клонами)</span>
          </div>
          <div id="c1"></div>
          <div id="volNote1" class="note" style="margin-top:10px"></div>
        </div>`;

      const sl = el.querySelector('#sl1');
      HV.slider(sl, {
        label: 'Доля реального края от бэктеста (ошибка оценки μ)', min: 0.45, max: 1.00, step: 0.05, value: s1.haircut,
        fmt: (v) => pct(v, 0) + (v < 0.75 ? ' (типичная усушка вживую)' : ' (почти как в тесте)'),
        onInput: (v) => { s1.haircut = v; draw1(); }
      });
      HV.slider(sl, {
        label: 'Толщина хвостов спреда (избыточный эксцесс)', min: 0, max: 6, step: 0.5, value: s1.kurt,
        fmt: (v) => v === 0 ? '0 (гауссов штиль)' : '+' + f(v, 1) + ' (толстые хвосты)',
        onInput: (v) => { s1.kurt = v; draw1(); }
      });
      HV.slider(sl, {
        label: 'Число коррелированных клонов в книге (при ρ = 0,82)', min: 1, max: 5, step: 1, value: s1.clones,
        fmt: (v) => v === 1 ? '1 одиночная пара' : v + ' клона подряд (скрытый перебор!)',
        onInput: (v) => { s1.clones = v; draw1(); }
      });
      HV.slider(sl, {
        label: 'Текущая погода рынка для Vol-targeting', min: 1.0, max: 3.5, step: 0.5, value: s1.storm,
        fmt: (v) => v === 1 ? '1,0× (спокойный рынок)' : f(v, 1) + '× (волатильность взлетела!)',
        onInput: (v) => { s1.storm = v; draw1(); }
      });

      let curK = null;
      const c1 = A.mkChart(el.querySelector('#c1'), 205, {
        tip: (i) => curK ? '<b>Множитель ставки: ' + f(curK.gridM[i]) + '× сольного Келли</b><br>' +
          '<span style="color:' + PRE + '">На бумаге: <b>' + pct(curK.growthNaive[i], 1) + ' годовых</b></span><br>' +
          '<span style="color:' + ME + '">В реальности: <b>' + U.sgn(curK.growthTrue[i] * 100, 1) + '% годовых</b></span><br>' +
          'Ожидаемая 95%-просадка: <b>' + pct(curK.dd95[i], 0) + '</b>' : ''
      });

      function draw1() {
        curK = E.kellyCurve({
          srEst: 1.25, volAnn: 0.25, edgeHaircut: s1.haircut, tailKurt: s1.kurt,
          kClones: s1.clones, rho: s1.clones > 1 ? 0.82 : 0
        });
        const g35 = curK.growthTrue[7]; // m = 0.35
        const g100 = curK.growthAtFull; // m = 1.00

        el.querySelector('#kpi1').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + ME + '">' + f(curK.optMTrue) + '× Kelly</div><div class="l">истинный оптимум доли</div><div class="e">рост ' + U.sgn(curK.bestTrueGrowth * 100, 1) + '% / год</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + (g35 >= 0 ? ME : BAD) + '">' + U.sgn(g35 * 100, 1) + '%</div><div class="l">при осторожных 0,35× Kelly</div><div class="e">бумажное удержание 0,5× = 75%</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + (g100 >= 0 ? SIM : BAD) + '">' + U.sgn(g100 * 100, 1) + '%</div><div class="l">при наивном 1,0× Kelly</div><div class="e">' + (g100 < 0 ? 'за обрывом овербеттинга!' : 'опасно близко к обрыву') + '</div></div>' +
          '</div>';

        const clippedTrue = curK.growthTrue.map((x) => Math.max(-0.95, x));
        c1.render({
          n: curK.gridM.length,
          hlines: [{ y: 0, color: BAD + '88', dash: [4, 4] }],
          vlines: [
            { x: 7, color: ME + 'aa', dash: [3, 3] },   // 0.35x
            { x: 20, color: BAD + 'aa', dash: [3, 3] }  // 1.00x
          ],
          series: [
            { data: curK.growthNaive, color: PRE, width: 1.7, dash: [4, 4] },
            { data: clippedTrue, color: ME, width: 2.4 }
          ]
        });

        const szCalm = E.sizePosition({ capitalRub: 3000000, targetVolAnn: 0.08, spreadSigmaDayRub: 1500, depthLots: 40 });
        const szNow = E.sizePosition({ capitalRub: 3000000, targetVolAnn: 0.08, spreadSigmaDayRub: 1500 * s1.storm, depthLots: 40 });
        el.querySelector('#volNote1').innerHTML =
          '<b>Как срабатывает Vol-targeting на счёте 3 млн ₽ (дневной риск-бюджет ' + Math.round(szNow.dailyVolBudgetRub).toLocaleString('ru-RU') + ' ₽):</b> ' +
          'в штиль (1,0×) формула берёт <b>' + szCalm.qFinal + ' связок</b>, а при текущей погоде (' + f(s1.storm, 1) + '×) автоматически держит <b>' + szNow.qFinal + ' связок</b> — ' +
          'фактический дневной риск остаётся под контролем (<b>' + Math.round(szNow.realizedDailyRiskRub).toLocaleString('ru-RU') + ' ₽</b> вместо взрыва в ' + f(s1.storm, 1) + ' раза).';
      }
      draw1();
    }
  });

  /* ---------- 2. Вместимость стакана (capacity) и целые контракты ---------- */
  const s2 = { depth: 22, edge: 960, beta: 0.37 };

  Z.push({
    id: 'capacity-lots',
    title: 'Вместимость стакана (capacity), лимит ГО и целые лоты',
    lead: 'На графике бэктеста можно удвоить объём одной клавишей, а на живом рынке крупная заявка выедает стакан против самой себя — да и купить «0,37 фьючерса» на бирже нельзя.',
    text: () => `
      <h3>Две физические границы реального стакана (§6.5 и §7.1)</h3>
      <ul>
        <li><b>${T('order_capacity', 'Вместимость сделки (capacity)')}:</b> пока вы берёте 3–5 связок при глубине лучших цен 22 лота, проскальзывание почти незаметно. Но когда заявка вырастает до десятков связок, вы сами пробиваете уровни стакана: чистая прибыль в рублях проходит купол оптимума, а за <b>потолком вместимости</b> уходит в минус!</li>
        <li><b>Целочисленные лоты и ${T('residual_hedge', 'остаточная экспозиция округления')}:</b> статистическая регрессия легко выдаёт коэффициент хеджа <code>β = 0,37</code>. Если взять наивно <code>1 : 1</code> контракт, <b>63%</b> позиции останется нехеджированной направленной ставкой! Нужно подобрать такую пару целых чисел <code>(n_A : n_B)</code> внутри вместимости стакана, чтобы остаточный перекос не превышал порога гейта (≤ 8%).</li>
      </ul>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Купол чистой рублёвой прибыли от объёма сделки и подбор целых лотов</h4>
          <div id="sl2"></div>
          <div id="kpi2" style="margin:10px 0"></div>
          <div id="c2"></div>
          <h4 style="margin:12px 0 6px">Подбор целых контрактов под статистический β (гейт ≤ 8% остатка)</h4>
          <div style="max-height:175px;overflow:auto"><table class="t" id="tab2"></table></div>
        </div>`;

      const sl = el.querySelector('#sl2');
      HV.slider(sl, {
        label: 'Видимая глубина лучших уровней стакана', min: 6, max: 45, step: 2, value: s2.depth,
        fmt: (v) => v + ' связок в стакане',
        onInput: (v) => { s2.depth = v; draw2(); }
      });
      HV.slider(sl, {
        label: 'Валовый край до издержек на 1 связку', min: 600, max: 1400, step: 50, value: s2.edge,
        fmt: (v) => v + ' ₽ / связку',
        onInput: (v) => { s2.edge = v; draw2(); }
      });
      HV.slider(sl, {
        label: 'Статистический хедж-коэффициент β', min: 0.21, max: 0.85, step: 0.02, value: s2.beta,
        fmt: (v) => 'β = ' + f(v),
        onInput: (v) => { s2.beta = v; draw2(); }
      });

      let curCap = null;
      const c2 = A.mkChart(el.querySelector('#c2'), 165, {
        tip: (i) => curCap ? '<b>Объём сделки: ' + curCap.qs[i] + ' связок</b><br>' +
          'Чистая прибыль со всей сделки: <b>' + Math.round(curCap.netTotal[i]).toLocaleString('ru-RU') + ' ₽</b><br>' +
          'Чистыми на 1 связку: <b>' + Math.round(curCap.netPerLot[i]) + ' ₽</b> (издержки съели ' + pct(curCap.slipShare[i], 0) + ')' : ''
      });

      function draw2() {
        curCap = E.capacityCurve({ grossEdgeRub: s2.edge, fixedFeeRub: 180, impactCoeffRub: 410, depthLots: s2.depth, maxQ: 80 });
        const ih = E.integerHedgeResiduals({ beta: s2.beta, priceA: 32000, priceB: 32000, maxLotsA: Math.min(18, Math.max(4, curCap.safeCapQ)) });

        el.querySelector('#kpi2').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + ME + '">' + curCap.safeCapQ + ' связок</div><div class="l">безопасный кап capacity</div><div class="e">издержки ≤ 55% валового края</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + GOLD + '">' + curCap.optQ + ' связок</div><div class="l">пик рублёвой прибыли</div><div class="e">+' + Math.round(curCap.bestTotalRub).toLocaleString('ru-RU') + ' ₽ на сделку</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + (ih.bestPair.passesGate ? ME : BAD) + '">' + ih.bestPair.lotsA + ' : ' + ih.bestPair.lotsB + '</div><div class="l">лучшие целые лоты (A : B)</div><div class="e">остаток ' + pct(ih.bestPair.residualPct, 1) + ' (' + (ih.bestPair.passesGate ? 'гейт пройден ✓' : 'узкий стакан!') + ')</div></div>' +
          '</div>';

        c2.render({
          n: curCap.qs.length,
          hlines: [{ y: 0, color: BAD + '88', dash: [4, 4] }],
          vlines: [
            { x: Math.max(0, curCap.safeCapQ - 1), color: ME + 'aa', dash: [3, 3] },
            { x: Math.max(0, curCap.optQ - 1), color: GOLD + 'aa', dash: [3, 3] }
          ],
          series: [{ data: curCap.netTotal, color: ME, width: 2.3 }]
        });

        const showRows = [ih.naive1to1];
        ih.candidates.slice(1).forEach((r) => {
          if (r.lotsA === ih.bestPair.lotsA || r.lotsA === 3 || r.lotsA === 5 || r.lotsA === 8 || r.lotsA === 11) {
            if (!showRows.some((x) => x.lotsA === r.lotsA)) showRows.push(r);
          }
        });
        el.querySelector('#tab2').innerHTML =
          '<tr><th>Лоты A : B</th><th>Факт. отношение</th><th>Остаточный перекос</th><th>Статус гейта (§7.1)</th></tr>' +
          showRows.map((r) => {
            const isBest = r.lotsA === ih.bestPair.lotsA;
            return '<tr' + (isBest ? ' style="background:rgba(126,224,181,0.12);font-weight:600"' : '') + '>' +
              '<td>' + r.lotsA + ' : ' + r.lotsB + (isBest ? ' ★' : '') + '</td>' +
              '<td>' + f(r.ratioLots) + ' (цель ' + f(s2.beta) + ')</td>' +
              '<td>' + Math.round(r.residualRub).toLocaleString('ru-RU') + ' ₽ (' + pct(r.residualPct, 1) + ')</td>' +
              '<td style="color:' + (r.passesGate ? ME : BAD) + '">' + (r.passesGate ? 'PASS (≤ 8%)' : 'REJECT (перекос!)') + '</td>' +
            '</tr>';
          }).join('');
      }
      draw2();
    }
  });

  /* ---------- 3. Ловушка скрытой концентрации и граф корреляций P&L ---------- */
  const s3 = { basketMode: 0, corrThr: 0.60 };

  Z.push({
    id: 'clone-trap',
    title: 'Ловушка скрытой концентрации: «много пар — а ставка одна»',
    lead: 'Отсортировать витрину по сольному скору и набрать топ-4 кажется естественным шагом. Но если все четыре лидера живут одним рыночным потоком, вы просто учетверили одну и ту же ставку.',
    text: () => `
      <h3>Диверсификация считается по сути, а не по ярлыкам (§1.4.3)</h3>
      <p>Посмотрите на восемь реальных пар-кандидатов MOEX: первые четыре строчки сольного рейтинга (<code>0,84–0,91</code>) занимают <code>SBER/VTBR</code>, фьючерсный дубль <code>SR/VB</code>, <code>SBER/SBERP</code> и тяжёлый банковский индекс <code>MIX/RTS</code>.</p>
      <p>У них разные тикеры, но стоит построить <b>граф корреляции дневных P&L</b>, как все четыре слипаются в один красный узел (${T('hidden_concentration', 'скрытая концентрация')}, <code>ρ ≈ 0,85</code>):</p>
      <ul>
        <li>Формально в портфеле <code>4</code> позиции, но <b>эффективное число независимых ставок</b> <code>N_эфф = k / (1 + (k−1)ρ)</code> равно всего <b>1,1–1,2</b>!</li>
        <li>${T('diversification_ratio', 'Коэффициент диверсификации')} застревает около <code>1,05×</code>, а ${T('cvar_metric', 'хвостовой убыток CVaR 95%')} бьёт по счёту синхронным залпом.</li>
        <li>Замена трёх банковских дублей на нефть (<code>LKOH/ROSN</code>), валютный календарь (<code>Si</code>) и металлы (<code>GD/SV</code>) убирает все красные рёбра и поднимает <code>N_эфф</code> почти до <b>3,7</b>!</li>
      </ul>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Граф связей дневных P&L восьми кандидатов и диагностика корзины</h4>
          <div class="btns" id="b3" style="margin:0 0 8px">
            <button class="b" data-m="0">Наивный Топ-4 по сольному скору (клоны!)</button>
            <button class="b" data-m="1">Разнородная корзина из 4 секторов</button>
          </div>
          <div id="sl3"></div>
          <div id="kpi3" style="margin:10px 0"></div>
          <div id="svg3" style="display:flex;justify-content:center;background:#10151e;border:1px solid #222a38;border-radius:10px;padding:8px"></div>
          <div id="alert3" class="note" style="margin-top:10px"></div>
        </div>`;

      const bEl = el.querySelector('#b3');
      bEl.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (b) { s3.basketMode = +b.dataset.m; draw3(); }
      });
      HV.slider(el.querySelector('#sl3'), {
        label: 'Порог подсветки дублирующего ребра корреляции P&L', min: 0.45, max: 0.85, step: 0.05, value: s3.corrThr,
        fmt: (v) => 'ρ ≥ ' + f(v),
        onInput: (v) => { s3.corrThr = v; draw3(); }
      });

      const univ = E.genBookUniverse(7, E.BOOK_SCENARIOS[0]);
      const sub = E.greedySubmodularSelect(univ.pairs, { t0: 0, t1: univ.splitIdx, maxK: 4 });
      const clColors = { 'Банки и индекс': BAD, 'Нефть и экспорт': SIM, 'Валюта и ставка': PRE, 'Металлы': PURP };

      function draw3() {
        bEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s3.basketMode));
        const chosen = s3.basketMode === 0 ? sub.soloTopIds : sub.selectedIds;
        const graph = E.pairCorrGraph(univ.pairs, { t0: 0, t1: univ.splitIdx, threshold: s3.corrThr });
        const bm = E.bookMetrics(univ.pairs, chosen, null, { t0: univ.splitIdx, t1: univ.T, dupThreshold: s3.corrThr, corrMatrix: graph.corr });

        el.querySelector('#kpi3').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + (bm.effBets >= 2.8 ? ME : BAD) + '">' + f(bm.effBets, 2) + ' из 4</div><div class="l">независимых ставок N_эфф</div><div class="e">средняя ρ внутри книги = ' + f(bm.avgCorr) + '</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + (bm.divRatio >= 1.45 ? ME : SIM) + '">' + f(bm.divRatio, 2) + '×</div><div class="l">коэфф. диверсификации DR</div><div class="e">выигрыш от развязки пар</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + (bm.dupAlerts.length === 0 ? ME : BAD) + '">−' + f(bm.cvar95, 1) + ' тыс. ₽</div><div class="l">хвостовой риск CVaR 95%</div><div class="e">дублей в книге: ' + bm.dupAlerts.length + '</div></div>' +
          '</div>';

        const W = 520, H = 250, cx = W / 2, cy = H / 2, rx = 175, ry = 92;
        const pos = univ.pairs.map((_, i) => {
          const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 8;
          return { x: cx + rx * Math.cos(ang), y: cy + ry * Math.sin(ang) };
        });

        let edgesSvg = '';
        graph.edges.forEach((e) => {
          const bothIn = chosen.indexOf(e.a) !== -1 && chosen.indexOf(e.b) !== -1;
          const pA = pos[e.a], pB = pos[e.b];
          edgesSvg += '<line x1="' + pA.x.toFixed(1) + '" y1="' + pA.y.toFixed(1) + '" x2="' + pB.x.toFixed(1) + '" y2="' + pB.y.toFixed(1) + '" ' +
            'stroke="' + (bothIn ? BAD : '#6b7892') + '" stroke-opacity="' + (bothIn ? '0.92' : '0.35') + '" stroke-width="' + (bothIn ? (2.2 + 2.5 * e.r).toFixed(1) : '1.4') + '"/>';
        });

        let nodesSvg = '';
        univ.pairs.forEach((p, i) => {
          const isSel = chosen.indexOf(i) !== -1;
          const colNode = clColors[p.cluster] || PRE;
          const pt = pos[i];
          nodesSvg += '<g>' +
            (isSel ? '<circle cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="21" fill="none" stroke="' + GOLD + '" stroke-width="2.6"/>' : '') +
            '<circle cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="15" fill="' + colNode + '" fill-opacity="' + (isSel ? '0.95' : '0.35') + '"/>' +
            '<text x="' + pt.x.toFixed(1) + '" y="' + (pt.y + 4).toFixed(1) + '" text-anchor="middle" fill="#0d1117" font-size="10.5" font-weight="700">' + f(p.soloScore, 2) + '</text>' +
            '<text x="' + pt.x.toFixed(1) + '" y="' + (pt.y + (pt.y < cy ? -23 : 31)).toFixed(1) + '" text-anchor="middle" fill="' + (isSel ? '#eef3fb' : '#8b96ab') + '" font-size="11.5" font-weight="' + (isSel ? '700' : '500') + '">' + p.code + '</text>' +
          '</g>';
        });

        el.querySelector('#svg3').innerHTML =
          '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:540px;height:auto">' + edgesSvg + nodesSvg + '</svg>';

        el.querySelector('#alert3').innerHTML = bm.dupAlerts.length
          ? '<b style="color:' + BAD + '">Алерт скрытой концентрации:</b> обнаружено <b>' + bm.dupAlerts.length + '</b> дублирующих связей внутри выбранной книги (например, <b>' + bm.dupAlerts[0].codeA + ' ↔ ' + bm.dupAlerts[0].codeB + '</b> с ρ = <b>' + f(bm.dupAlerts[0].r) + '</b>). Золотые кольца стоят вокруг пар вашей корзины.'
          : '<b style="color:' + ME + '">Чистая диверсификация:</b> ни одна пара внутри золотых колец не пересекает порог дублирования ρ ≥ ' + f(s3.corrThr) + ' — все четыре места в книге работают от независимых экономических драйверов.';
      }
      draw3();
    }
  });

  /* ---------- 4. Жадный субмодулярный отбор и гарантия (1 − 1/e) ---------- */
  const s4 = { stepIdx: 0 };

  Z.push({
    id: 'submodular-greedy',
    title: 'Жадный субмодулярный отбор корзины и гарантия 1 − 1/e',
    lead: 'Вместо вопроса «какая пара лучшая сама по себе?» правильный скринер на каждом шаге спрашивает: «какая пара сильнее всего улучшит уже собранную книгу?»',
    text: () => `
      <h3>Убывающая отдача и теорема о жадной сборке (§7.3)</h3>
      <p>Когда вы кладёте в пустую корзину сильную банковскую пару <code>SBER/VTBR</code> (сольный скор <code>0,91</code>), она приносит огромную пользу. Но если следом попытаться положить её фьючерсный клон <code>SR/VB</code> (скор <code>0,89</code>), ${T('marginal_contribution', 'маржинальный вклад')} окажется крошечным — эта рыночная поляна уже прикрыта!</p>
      <p>Свойство «польза от добавления похожего падает по мере наполнения корзины» в математике называется <b>субмодулярностью</b>. На нём работает ${T('submodular_greedy', 'жадный субмодулярный выбор')}:</p>
      <ul>
        <li>Начинаем с пустой книги и по одному берём кандидата с <b>максимальным приростом <code>ΔF</code></b>, пересчитывая полезность оставшихся после каждого шага.</li>
        <li>Если все оставшиеся пары лишь копируют уже взятые, срабатывает ${T('redundancy_short', 'закорочка на избыточность')} — алгоритм останавливается и называет, кого именно дублирует отклонённый кандидат.</li>
        <li>По классической теореме Немхаузера — Уолси простая жадная сборка гарантированно даёт <b>не менее <code>1 − 1/e ≈ 63,2%</code></b> от идеального глобального оптимума (а на практике — часто <b>98–100%</b> без взрывного перебора корзин!).</li>
      </ul>`,
    mount(el) {
      const univ = E.genBookUniverse(7, E.BOOK_SCENARIOS[0]);
      const sub = E.greedySubmodularSelect(univ.pairs, { t0: 0, t1: univ.splitIdx, maxK: 4 });

      el.innerHTML = `
        <div class="viz">
          <h4>Пошаговая сборка книги из 8 кандидатов: переключайте шаги 1 → 4</h4>
          <div class="btns" id="b4" style="margin:0 0 10px"></div>
          <div id="kpi4" style="margin-bottom:10px"></div>
          <div id="bars4" style="margin-bottom:10px"></div>
          <div style="max-height:220px;overflow:auto"><table class="t" id="tab4"></table></div>
        </div>`;

      const bEl = el.querySelector('#b4');
      bEl.innerHTML = sub.steps.map((st, i) => '<button class="b" data-i="' + i + '">Шаг ' + st.step + ': +' + st.pickedCode + '</button>').join('');
      bEl.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (b) { s4.stepIdx = +b.dataset.i; draw4(); }
      });

      function draw4() {
        if (s4.stepIdx >= sub.steps.length) s4.stepIdx = 0;
        bEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s4.stepIdx));
        const st = sub.steps[s4.stepIdx];

        el.querySelector('#kpi4').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + ME + '">+' + f(st.marginalGain, 3) + '</div><div class="l">маржинальный вклад ΔF</div><div class="e">выбрана ' + st.pickedCode + ' (' + st.cluster + ')</div></div>' +
            '<div class="kpi"><div class="v">' + pct(sub.ratioToOpt, 1) + '</div><div class="l">доля жадной книги от оптимума</div><div class="e">гарантия 1 − 1/e ≥ 63,2% ✓</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + GOLD + '">' + f(st.effBets, 2) + ' ставок</div><div class="l">независимых драйверов на шаге ' + st.step + '</div><div class="e">Sharpe корзины = ' + f(st.bookSharpe) + '</div></div>' +
          '</div>';

        const maxBar = Math.max(0.01, sub.exactBestF);
        const rowsBar = [
          { lbl: 'Наивный Топ-4 по сольному скору (4 клона)', val: sub.soloTopF, c: BAD },
          { lbl: 'Теоретический пол гарантии (1 − 1/e) × Opt', val: sub.exactBestF * sub.theoreticalBound, c: SIM },
          { lbl: 'Жадный субмодулярный отбор (4 шага)', val: sub.greedyF, c: ME },
          { lbl: 'Точный полный перебор C(8, 4) = 70 корзин', val: sub.exactBestF, c: PRE }
        ];
        el.querySelector('#bars4').innerHTML = rowsBar.map((r) => {
          const w = Math.min(100, (r.val / maxBar) * 100);
          return '<div style="margin:5px 0;font-size:12.5px">' +
            '<div style="display:flex;justify-content:space-between;margin-bottom:2px"><span>' + r.lbl + '</span><b>' + f(r.val, 3) + '</b></div>' +
            '<div style="height:9px;background:#1a2230;border-radius:5px;overflow:hidden"><div style="width:' + w.toFixed(1) + '%;height:100%;background:' + r.c + '"></div></div>' +
          '</div>';
        }).join('');

        el.querySelector('#tab4').innerHTML =
          '<tr><th>Кандидат на шаге ' + st.step + '</th><th>Сольный скор</th><th>Марж. вклад ΔF</th><th>Диагноз избыточности</th></tr>' +
          st.candidatesRanked.map((c, idx) => {
            const win = idx === 0;
            const isDup = c.maxR >= 0.60;
            return '<tr' + (win ? ' style="background:rgba(126,224,181,0.13);font-weight:600"' : '') + '>' +
              '<td>' + (win ? '✓ ' : '') + c.code + '</td>' +
              '<td>' + f(c.soloScore) + '</td>' +
              '<td style="color:' + (win ? ME : (isDup ? BAD : '#d5deef')) + '">+' + f(c.gain, 3) + '</td>' +
              '<td>' + (win ? '<span style="color:' + ME + '">лидер прироста корзины!</span>'
                : (isDup ? '<span style="color:' + BAD + '">закорочка: дублирует ' + c.cloneOf + ' (ρ=' + f(c.maxR) + ')</span>' : 'ждет следующего шага')) + '</td>' +
            '</tr>';
          }).join('');
      }
      draw4();
    }
  });
})();
