/* Продвинутая оценка β(t) и диагностика связи, экраны 1–4: фильтр Калмана против скользящего окна,
   ортогональная (TLS) и робастная (Theil–Sen) регрессия, матрица ADF + KPSS + Хёрст + гистограмма t½,
   детектор разрыва CUSUM и оптимизация ERT с защитой σ_min (#57, #47). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, HV = window.HV;
  const Z = (window.DGSCREENS = window.DGSCREENS || []);
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', PRE = '#5aa9ff', GOLD = '#ffd166', PURP = '#c9b6ff';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 2 : d) + '</span>';

  /* ---------- 1. Фильтр Калмана для β(t) против жёсткого скользящего окна ---------- */
  const s1 = { olsWin: 45, qExp: -5.4 };

  Z.push({
    id: 'kalman-intro',
    title: 'Фильтр Калмана для β(t): плавная адаптация без жёсткого окна',
    lead: 'В скользящем окне OLS мы всегда зажаты между двумя крайностями: короткое окно трясётся от каждого чиха, а длинное безнадёжно отстаёт от рынка. Фильтр Калмана снимает эту дилемму пошаговым циклом «прогноз → поправка».',
    text: () => `
      <h3>Как работает ${T('kalman_filter', 'фильтр Калмана')} без высшей математики</h3>
      <p>Представьте капитана корабля: он не вычисляет координаты по среднему за последние 40 дней и не верит слепо одному показанию радара. Каждый вечер алгоритм делает ровно <b>два простых шага</b>:</p>
      <ul>
        <li><b>1. Шаг прогноза (до новой цены):</b> ожидаем, что сегодняшний наклон <code>β</code> близок ко вчерашнему <code>β_{t|t−1}</code>, а наша неуверенность чуть-чуть подросла на величину шага изменчивости <code>q_β</code>.</li>
        <li><b>2. Шаг обновления (после новой цены):</b> сравниваем фактическую цену <code>A_t</code> с прогнозом <code>α + β·B_t</code> и подкручиваем оценку на долю свежей ошибки — эту долю задаёт ${T('kalman_gain', 'коэффициент усиления Калмана')} <code>K_t</code>.</li>
      </ul>
      <span class="formula">β_новая = β_прогноз + K_t · (A_t − α_прогноз − β_прогноз · B_t)</span>
      <p>Никакой произвольной границы «ровно 40 дней назад» больше нет: старые наблюдения угасают мягко, а вылет позапрошломесячной свечи из окна не вызывает ложного скачка коэффициента хеджирования.</p>`,
    mount(el) {
      const dg = E.genDiagScenario(7, E.DIAG_SCENARIOS[0]);
      el.innerHTML = `
        <div class="viz">
          <h4>Истинный наклон β(t) уплывает с 0,60 до 1,90: кто точнее держит след?</h4>
          <div id="sl1a"></div>
          <div id="sl1b"></div>
          <div class="legend" style="margin-top:8px">
            <span><i style="background:${GOLD}"></i>истинный β(t) пары</span>
            <span><i style="background:${BAD}"></i>скользящий OLS (окно N)</span>
            <span><i style="background:${ME}"></i>фильтр Калмана β(t)</span>
          </div>
          <div id="c1"></div>
          <div id="k1" style="margin-top:10px"></div>
        </div>`;

      HV.slider(el.querySelector('#sl1a'), {
        label: 'Длина жёсткого окна скользящего OLS (N)', min: 15, max: 90, step: 5, value: s1.olsWin,
        fmt: (v) => v + ' дн.',
        onInput: (v) => { s1.olsWin = v; draw1(); }
      });
      HV.slider(el.querySelector('#sl1b'), {
        label: 'Гибкость фильтра Калмана (дисперсия шага q_β)', min: -6.5, max: -4.2, step: 0.2, value: s1.qExp,
        fmt: (v) => '10^(' + f(v, 1) + ')',
        onInput: (v) => { s1.qExp = v; draw1(); }
      });

      let olsArr = [], kalArr = [];
      const c1 = A.mkChart(el.querySelector('#c1'), 220, {
        tip: (i) => '<b>День ' + (i + 1) + '</b>' +
          '<br>истинный β: <b style="color:' + GOLD + '">' + f(dg.trueBeta[i]) + '</b>' +
          (olsArr[i] !== null ? '<br>скользящий OLS: <b style="color:' + BAD + '">' + f(olsArr[i]) + '</b>' : '') +
          '<br>Калман β: <b style="color:' + ME + '">' + f(kalArr[i]) + '</b>'
      });

      function draw1() {
        const n = dg.a.length, w = s1.olsWin;
        olsArr = new Array(n).fill(null);
        for (let t = w - 1; t < n; t++) {
          olsArr[t] = E.ols(dg.b.slice(t - w + 1, t + 1), dg.a.slice(t - w + 1, t + 1)).k;
        }
        const kf = E.kalmanHedge(dg.b, dg.a, { qAlpha: 0.0001, qBeta: Math.pow(10, s1.qExp), obsVar: 3.2 });
        kalArr = kf.priorBeta;

        let errOls = 0, errKal = 0, cnt = 0;
        for (let t = w; t < n; t++) {
          errOls += Math.pow(olsArr[t] - dg.trueBeta[t], 2);
          errKal += Math.pow(kalArr[t] - dg.trueBeta[t], 2);
          cnt++;
        }
        const rmseOls = Math.sqrt(errOls / cnt), rmseKal = Math.sqrt(errKal / cnt);

        c1.render({
          n,
          series: [
            { data: dg.trueBeta, color: GOLD, width: 2.0, dash: [5, 4] },
            { data: olsArr, color: BAD, width: 1.5 },
            { data: kalArr, color: ME, width: 2.2 }
          ]
        });

        el.querySelector('#k1').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + BAD + '">' + f(rmseOls, 3) + '</div><div class="l">ошибка OLS (RMSE)</div><div class="e">запаздывание + шум окна ' + w + ' дн.</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + ME + '">' + f(rmseKal, 3) + '</div><div class="l">ошибка Калмана (RMSE)</div><div class="e">' + (rmseKal < rmseOls ? 'точнее на ' + Math.round((1 - rmseKal / rmseOls) * 100) + '%!' : 'слишком зажата/распущена q_β') + '</div></div>' +
          '</div>';
      }
      draw1();
    }
  });

  /* ---------- 2. Ортогональная (TLS) и робастная (Theil–Sen) регрессия ---------- */
  const s2 = { xNoise: 4.5, glitchAmp: 38, swapAxes: false };

  Z.push({
    id: 'tls-robust',
    title: 'Шум в обеих ногах и сбойные принты: TLS и наклон Тейла — Сена',
    lead: 'Обычная линейная регрессия (OLS) наивно верит, что вторая нога B измерена с абсолютной точностью, а ещё возводит каждый выброс в квадрат. Из-за этого у неё сразу две ахиллесовы пяты.',
    text: () => `
      <h3>Ловушка №1: несимметричность обычного OLS и решение ${T('tls_reg', 'TLS')}</h3>
      <p>Если оба инструмента <code>A</code> и <code>B</code> шумят внутри стакана, обычный OLS занижает наклон <code>k</code> к нулю. Поменяйте ноги местами (<code>B</code> через <code>A</code> вместо <code>A</code> через <code>B</code>) — и получите <b>две разные прямые</b>: произведение их наклонов равно <code>R² &lt; 1</code> вместо единицы!</p>
      <p><b>Ортогональная регрессия (TLS)</b> опускает на прямую <i>перпендикуляры</i>, относясь к шуму обеих ног совершенно равноправно: при перестановке <code>A ↔ B</code> наклон остаётся строго тем же самым (<code>k₁ · k₂ = 1</code>).</p>
      <h3>Ловушка №2: сбойная сделка и ${T('theil_sen', 'медианный наклон Тейла — Сена')}</h3>
      <p>Один шальной принт на краю облака точек тянет квадратичную ошибку OLS на себя, словно гиря. Метод <b>Тейла — Сена</b> проводит прямые через <i>все пары точек</i> и берёт <b>медиану их наклонов</b>, а в фильтре Калмана ту же защиту даёт ${T('huber_clip', 'обрезка Хьюбера')}.</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Облако из 28 дней (истинный наклон k = 1,40): подвигайте шум ноги B и выброс</h4>
          <div class="btns" style="margin:0 0 8px">
            <button class="b" id="sw2">Поменять оси A ↔ B местами</button>
          </div>
          <div id="sl2a"></div>
          <div id="sl2b"></div>
          <div class="legend" style="margin-top:8px">
            <span><i style="background:${BAD}"></i>обычный OLS</span>
            <span><i style="background:${PRE}"></i>симметричный TLS</span>
            <span><i style="background:${ME}"></i>робастный Theil–Sen</span>
          </div>
          <div style="position:relative;margin-top:6px"><canvas id="sc2" style="width:100%;display:block"></canvas></div>
          <table class="t" id="tab2" style="margin-top:10px"></table>
        </div>`;

      const swBtn = el.querySelector('#sw2');
      swBtn.addEventListener('click', () => { s2.swapAxes = !s2.swapAxes; swBtn.classList.toggle('on', s2.swapAxes); draw2(); });
      HV.slider(el.querySelector('#sl2a'), {
        label: 'Собственный шум второй ноги B', min: 0.2, max: 8.0, step: 0.4, value: s2.xNoise,
        fmt: (v) => f(v, 1) + ' п.',
        onInput: (v) => { s2.xNoise = v; draw2(); }
      });
      HV.slider(el.querySelector('#sl2b'), {
        label: 'Одиночный сбойный принт на краю облака (жёлтая точка)', min: 0, max: 70, step: 5, value: s2.glitchAmp,
        fmt: (v) => '+' + v + ' п.',
        onInput: (v) => { s2.glitchAmp = v; draw2(); }
      });

      const scat = new HV.Scatter(el.querySelector('#sc2'), {
        height: 250,
        tip: (p, i) => '<b>День #' + (i + 1) + (p.hot ? ' (сбойный принт!)' : '') + '</b><br>горизонталь: ' + f(p.x, 1) + ' · вертикаль: ' + f(p.y, 1)
      });

      function draw2() {
        const rng = E.mulberry32(19);
        const rawB = [], rawA = [];
        for (let i = 0; i < 28; i++) {
          const factor = 85 + i * 1.2;
          const nb = (rng() + rng() - 1) * s2.xNoise * 1.6;
          const na = (rng() + rng() - 1) * 3.2;
          rawB.push(factor + nb);
          rawA.push(10 + 1.40 * factor + na);
        }
        rawA[26] += s2.glitchAmp;

        const x = s2.swapAxes ? rawA : rawB;
        const y = s2.swapAxes ? rawB : rawA;
        const trueSlope = s2.swapAxes ? 1 / 1.40 : 1.40;

        const fOls = E.ols(x, y), fOlsRev = E.ols(y, x);
        const fTls = E.tls(x, y), fTlsRev = E.tls(y, x);
        const fTs = E.theilSen(x, y), fTsRev = E.theilSen(y, x);

        scat.render({
          points: x.map((xv, i) => ({ x: xv, y: y[i], hot: i === 26 && s2.glitchAmp > 0 })),
          xLabel: s2.swapAxes ? 'Цена A (поменяли оси!)' : 'Цена B',
          yLabel: s2.swapAxes ? 'Цена B' : 'Цена A',
          lines: [
            { k: fOls.k, alpha: fOls.alpha, color: BAD, width: 2 },
            { k: fTls.k, alpha: fTls.alpha, color: PRE, width: 2, dash: [6, 4] },
            { k: fTs.k, alpha: fTs.alpha, color: ME, width: 2.3 }
          ]
        });

        el.querySelector('#tab2').innerHTML =
          '<tr><th>Метод оценки</th><th>Наклон k сейчас (истинный ' + f(trueSlope, 3) + ')</th><th>Отклонение от истины</th><th>Произведение k(A|B)·k(B|A)</th></tr>' +
          '<tr><td><b style="color:' + BAD + '">Обычный OLS</b></td><td>' + f(fOls.k, 3) + '</td><td class="neg">' + U.sgn(fOls.k - trueSlope, 3) + '</td><td>' + f(fOls.k * fOlsRev.k, 3) + ' (≠ 1, занижен!)</td></tr>' +
          '<tr><td><b style="color:' + PRE + '">Ортогональный TLS</b></td><td>' + f(fTls.k, 3) + '</td><td>' + U.sgn(fTls.k - trueSlope, 3) + '</td><td class="pos"><b>' + f(fTls.k * fTlsRev.k, 3) + ' (строго 1!)</b></td></tr>' +
          '<tr><td><b style="color:' + ME + '">Робастный Theil–Sen</b></td><td><b>' + f(fTs.k, 3) + '</b></td><td class="pos"><b>' + U.sgn(fTs.k - trueSlope, 3) + '</b></td><td>' + f(fTs.k * fTsRev.k, 3) + '</td></tr>';
      }
      draw2();
    }
  });

  /* ---------- 3. Двойной замок ADF + KPSS, показатель Хёрста и гистограмма полураспада t½ ---------- */
  const CASES3 = [
    { name: 'Здоровая «резинка» (OU)', kind: 'ou' },
    { name: 'Короткий / сонный ряд (мало мощности)', kind: 'slow' },
    { name: 'Скрытая ступенька уровня (сдвиг)', kind: 'step' },
    { name: 'Случайное блуждание / тренд', kind: 'rw' }
  ];
  const s3 = { idx: 0 };

  Z.push({
    id: 'adf-kpss-hurst',
    title: 'Двойной замок ADF + KPSS, показатель Хёрста и распределение t½',
    lead: 'Доверять одному тесту Дики — Фуллера опасно: на ступеньке или коротком отрезке он легко ошибается. Надёжная диагностика сверяет сразу три независимых прибора и смотрит на полураспад как на распределение, а не одну цифру.',
    text: () => `
      <h3>Почему ${T('adf_kpss_matrix', 'ADF и KPSS работают в паре')}</h3>
      <p>Два теста смотрят на ряд с противоположных берегов:</p>
      <ul>
        <li><b>ADF</b> по умолчанию считает ряд <i>случайным блужданием</i> и ищет улики в пользу возврата (нужно <code>τ ≤ −2,88</code>).</li>
        <li><b>${T('kpss_test', 'Зеркальный тест KPSS')}</b> по умолчанию считает ряд <i>стационарным</i> и ищет улики развала или дрейфа (нужно <code>KPSS ≤ 0,463</code>).</li>
      </ul>
      <p>Третий независимый взгляд — ${T('hurst_exp', 'показатель Хёрста')} <code>H</code>: при <code>H &lt; 0,5</code> ряд тянется назад к среднему, при <code>H ≈ 0,5</code> блуждает наугад, а при <code>H &gt; 0,5</code> разгоняется по тренду.</p>
      <h3>${T('halflife_dist', 'Полураспад t½ — это гистограмма, а не точка')}</h3>
      <p>Средний полураспад «8 дней» может скрывать, что полгода пара сходилась за 4 дня, а другие полгода зависала на 45 дней! Поэтому скринер обязан показывать разброс полупериодов по разным кускам истории.</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Испытайте четыре разных ряда на матрице ADF + KPSS</h4>
          <div class="btns" id="b3" style="margin:0 0 10px"></div>
          <div id="c3"></div>
          <div id="k3" style="margin-top:10px"></div>
          <table class="t" id="mat3" style="margin-top:10px"></table>
        </div>
        <div class="viz">
          <h4>Гистограмма периода полураспада t½ по скользящим отрезкам истории</h4>
          <div id="hist3"></div>
        </div>`;

      const bEl = el.querySelector('#b3');
      bEl.innerHTML = CASES3.map((c, i) => '<button class="b" data-i="' + i + '">' + c.name + '</button>').join('');
      bEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s3.idx = +b.dataset.i; draw3(); } });

      let curSer = [];
      const c3 = A.mkChart(el.querySelector('#c3'), 170, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>значение ряда: <b>' + f(curSer[i]) + '</b>'
      });

      function makeSeries3(kind) {
        const dg = E.genDiag({ seed: 13, n: kind === 'slow' ? 55 : 220, ouRho: kind === 'ou' ? 0.55 : kind === 'slow' ? 0.90 : 0.55, ouSd: 1.6, xNoise: 0.02 });
        const base = dg.a.map((v, i) => v - 12 - dg.trueBeta[i] * dg.b[i]);
        if (kind === 'ou' || kind === 'slow') return base;
        if (kind === 'step') return base.map((v, i) => v + (i >= 110 ? 7.5 : 0));
        const out = [];
        let acc = 0;
        for (let i = 0; i < base.length; i++) { acc += base[i] * 0.45; out.push(acc); }
        return out;
      }

      function draw3() {
        bEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s3.idx));
        curSer = makeSeries3(CASES3[s3.idx].kind);
        const sm = E.stationarityMatrix(curSer);
        const hl = E.halfLifeDist(curSer, Math.min(40, Math.floor(curSer.length * 0.6)), 8);

        c3.render({
          n: curSer.length,
          hlines: [{ y: 0, color: '#ffffff26', dash: [3, 3] }],
          series: [{ data: curSer, color: sm.verdict === 'confirmed' ? ME : sm.verdict === 'random_walk' ? BAD : GOLD, width: 1.8 }]
        });

        el.querySelector('#k3').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + (sm.adfPass ? ME : BAD) + '">' + f(sm.adfTau) + '</div><div class="l">ADF τ (порог ' + f(sm.adfCrit) + ')</div><div class="e">' + (sm.adfPass ? 'отверг блуждание' : 'не отверг блуждание') + '</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + (sm.kpssPass ? ME : BAD) + '">' + f(sm.kpssStat, 3) + '</div><div class="l">KPSS (порог 0,463)</div><div class="e">' + (sm.kpssPass ? 'уровень стабилен' : 'уровень уплыл!') + '</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + (sm.hurst < 0.46 ? ME : BAD) + '">' + f(sm.hurst, 2) + '</div><div class="l">Показатель Хёрста H</div><div class="e">' + (sm.hurst < 0.46 ? 'возвратный (< 0,5)' : 'блуждание / тренд') + '</div></div>' +
          '</div>';

        const cell = (vKey, title, desc) => '<td style="' + (sm.verdict === vKey ? 'background:#1e293b;outline:2px solid ' + (vKey === 'confirmed' ? ME : vKey === 'random_walk' ? BAD : GOLD) : 'opacity:0.65') + '"><b>' + title + '</b><br><span style="font-size:13px;color:#98a3b6">' + desc + '</span></td>';
        el.querySelector('#mat3').innerHTML =
          '<tr><th>Матрица решений</th><th>KPSS ≤ 0,463 (уровень ровный)</th><th>KPSS &gt; 0,463 (уровень уплывает)</th></tr>' +
          '<tr><td><b>ADF τ ≤ порога</b><br><span style="font-size:13px;color:#98a3b6">есть возврат</span></td>' +
            cell('confirmed', '✓ Подтверждённая стационарность', 'Оба теста за нас — зелёный свет для торговли') +
            cell('structural_break', '⚠ Скрытый сдвиг / ступенька', 'Локально дёргается назад, но средний уровень сполз!') + '</tr>' +
          '<tr><td><b>ADF τ &gt; порога</b><br><span style="font-size:13px;color:#98a3b6">нет сил отвергнуть RW</span></td>' +
            cell('low_power', '◔ Мало данных / медленный возврат', 'KPSS спокоен, но выборка слишком коротка для ADF') +
            cell('random_walk', '✗ Чистое блуждание / тренд', 'Оба теста против — торговать возврат запрещено!') + '</tr>';

        const bins = [
          { lbl: '1–5 дн.', lo: 0, hi: 5 },
          { lbl: '5–12 дн.', lo: 5, hi: 12 },
          { lbl: '12–25 дн.', lo: 12, hi: 25 },
          { lbl: '25–59 дн.', lo: 25, hi: 59.5 },
          { lbl: '≥ 60 / нет возврата', lo: 59.5, hi: 999 }
        ];
        const counts = bins.map((b) => hl.values.filter((v) => v >= b.lo && v < b.hi).length);
        const mxCnt = Math.max(1, ...counts);
        el.querySelector('#hist3').innerHTML =
          '<p class="cap">Медиана t½: <b>' + f(hl.median, 1) + ' дн.</b> · Межквартильный размах (25%–75%): <b>' + f(hl.p25, 1) + ' … ' + f(hl.p75, 1) + ' дн.</b> · Отрезков без возврата: <b>' + Math.round(hl.brokenShare * 100) + '%</b></p>' +
          bins.map((b, idx) => {
            const pct = Math.round((counts[idx] / mxCnt) * 100);
            const barCol = idx <= 1 ? ME : idx <= 3 ? GOLD : BAD;
            return '<div style="display:grid;grid-template-columns:150px 1fr 56px;gap:10px;align-items:center;margin:5px 0">' +
              '<span style="font-size:14px">' + b.lbl + '</span>' +
              '<div style="background:#10151f;border-radius:5px;height:14px;overflow:hidden"><div style="width:' + pct + '%;height:100%;background:' + barCol + '"></div></div>' +
              '<span style="font-size:14px;text-align:right">' + counts[idx] + ' ок.</span></div>';
          }).join('');
      }
      draw3();
    }
  });

  /* ---------- 4. Детектор CUSUM, бейдж здоровья связи и оптимизация ERT с защитой σ_min ---------- */
  const s4 = { breakDrift: 0.65, noiseMix: 1.0 };

  Z.push({
    id: 'cusum-ert',
    title: 'Детектор разрыва CUSUM, бейдж здоровья и время возврата ERT',
    lead: 'Даже образцовая пара однажды ломается из-за корпоративных новостей, санкций или смены тарифов. Как заметить обрыв раньше стоп-лосса и как выбирать самый быстрый спред, не скатываясь в неторгуемый микрошум?',
    text: () => `
      <h3>${T('cusum_break', 'Детектор CUSUM')} и ${T('health_badge', 'бейдж «здоровья связи»')}</h3>
      <p>Одиночная ошибка в <code>+1,5σ</code> никого не пугает — это обычный рабочий шум. Но если фильтр Калмана ошибается <i>в одну и ту же сторону восемь вечеров подряд</i>, накопленная сумма <code>CUSUM</code> стремительно пробивает тревожный порог!</p>
      <p>Вместе с <code>KPSS</code> и Хёрстом он образует наглядный светофор пары: <span class="pill ok">связь здорова</span> → <span class="pill time">ослабла</span> → <span class="pill stop">разорвана</span> (новые входы запрещены, открытая позиция закрывается не дожидаясь дальнего стопа).</p>
      <h3>${T('ert_metric', 'Эмпирическое время возврата (ERT)')} и ловушка микрошума</h3>
      <p><b>ERT</b> считает прямо по графику: сколько в среднем баров проходит между пересечениями спредом своей медианы. Минимизируя <code>ERT</code>, обязательно ставят нижний барьер на разброс <code>σ ≥ σ_min</code>: иначе оптимизатор выберет вырожденную комбинацию с крошечной амплитудой, где комиссии вдесятеро больше самого движения!</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>На 135-м дне связь рвётся: как быстро сработает счётчик CUSUM?</h4>
          <div id="sl4a"></div>
          <div class="legend" style="margin-top:6px">
            <span><i style="background:${ME}"></i>накопленный счётчик CUSUM</span>
            <span><i style="background:${GOLD}"></i>порог внимания (4,0)</span>
            <span><i style="background:${BAD}"></i>порог разрыва связи (6,5)</span>
          </div>
          <div id="c4"></div>
          <p id="msg4" class="cap" style="margin-top:8px"></p>
        </div>
        <div class="viz">
          <h4>Оптимизация ERT: почему без фильтра σ ≥ σ_min побеждает бесполезный микрошум</h4>
          <div id="sl4b"></div>
          <table class="t" id="tab4" style="margin-top:8px"></table>
        </div>`;

      HV.slider(el.querySelector('#sl4a'), {
        label: 'Сила тихого расползания пары после 135-го дня', min: 0.15, max: 1.10, step: 0.05, value: s4.breakDrift,
        fmt: (v) => '+' + f(v, 2) + ' п./день',
        onInput: (v) => { s4.breakDrift = v; draw4(); }
      });
      HV.slider(el.querySelector('#sl4b'), {
        label: 'Порог минимального торгового разброса σ_min (во сколько раз шире комиссии)', min: 0.4, max: 2.2, step: 0.2, value: s4.noiseMix,
        fmt: (v) => f(v, 1) + ' п.',
        onInput: (v) => { s4.noiseMix = v; drawErt4(); }
      });

      let csArr = [];
      const c4 = A.mkChart(el.querySelector('#c4'), 180, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>счётчик CUSUM: <b style="color:' + (csArr[i] >= 6.5 ? BAD : csArr[i] >= 4 ? GOLD : ME) + '">' + f(csArr[i]) + '</b>'
      });

      function draw4() {
        const dg = E.genDiag({ seed: 7, n: 260, beta0: 1.2, beta1: 1.2, ouRho: 0.58, ouSd: 1.8, breakAt: 135, breakDrift: s4.breakDrift });
        const bt = E.backtestDiag(dg, { diagMode: 'kalman_health' });
        csArr = bt.cusum.score;
        let alarmDay = -1;
        for (let t = 135; t < dg.a.length; t++) if (csArr[t] >= 6.5) { alarmDay = t; break; }

        c4.render({
          n: csArr.length,
          spans: [{ i0: 135, i1: 259, color: '#ff6b6b18' }],
          hlines: [
            { y: 4.0, color: GOLD, dash: [4, 4] },
            { y: 6.5, color: BAD, dash: [5, 3] }
          ],
          series: [{ data: csArr, color: ME, width: 2.0 }]
        });
        el.querySelector('#msg4').innerHTML = alarmDay > 0
          ? 'Поломка началась на <b>136-м дне</b>, и уже на <b>' + (alarmDay + 1) + '-м дне</b> (через <b>' + (alarmDay - 135) + ' дн.</b>) CUSUM пробил красную линию 6,5 и заблокировал новые убыточные входы.'
          : 'При слабом дрейфе счётчик поднимается плавно и держит жёлтый режим повышенного внимания.';
      }

      const dgErt = E.genDiag({ seed: 11, n: 200, beta0: 1.25, beta1: 1.25, ouRho: 0.55, ouSd: 1.9, xNoise: 0.1 });
      const baseClean = dgErt.a.map((v, i) => v - 12 - 1.25 * dgErt.b[i]);
      const microNoise = baseClean.map((v, i) => (i % 2 === 0 ? 0.18 : -0.18) + v * 0.05);
      const slowDrift = dgErt.a.map((v, i) => v - 12 - 0.90 * dgErt.b[i]);

      function drawErt4() {
        const cands = [
          { name: 'Вырожденный микрошум (дёргается каждый тик)', ser: microNoise },
          { name: 'Правильно сбалансированный спред (k = 1,25)', ser: baseClean },
          { name: 'Недохеджированный спред (k = 0,90)', ser: slowDrift }
        ];
        const rows = cands.map((c) => Object.assign({ name: c.name }, E.calcERT(c.ser, { sigmaMin: s4.noiseMix })));
        let bestIdx = -1, bestErt = Infinity;
        rows.forEach((r, idx) => { if (r.valid && r.ert < bestErt) { bestErt = r.ert; bestIdx = idx; } });

        el.querySelector('#tab4').innerHTML =
          '<tr><th>Вариант построения спреда</th><th>ERT (баров до медианы)</th><th>Разброс σ</th><th>Проходит фильтр σ ≥ ' + f(s4.noiseMix, 1) + ' п.?</th></tr>' +
          rows.map((r, idx) => '<tr' + (idx === bestIdx ? ' class="sel"' : '') + '>' +
            '<td>' + (idx === bestIdx ? '<b>★ ' + r.name + '</b>' : r.name) + '</td>' +
            '<td><b>' + f(r.ert, 1) + ' дн.</b> (' + r.crossings + ' пересеч.)</td>' +
            '<td>' + f(r.sigma) + ' п.</td>' +
            '<td>' + (r.valid ? '<span class="pill ok">Да — торгуемо</span>' : '<span class="pill stop">Отсев: съедят комиссии!</span>') + '</td></tr>'
          ).join('');
      }
      draw4();
      drawErt4();
    }
  });
})();
