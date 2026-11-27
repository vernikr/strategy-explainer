/* Модельные и адаптивные пороги, экраны 1–4: гистерезис против пилы на комиссиях,
   модель Орнштейна — Уленбека и оптимальные границы Бертрама (Bertram 2010),
   волю-адаптивные полосы (EWMA/GARCH) и надстройка переноса Carry-overlay (#60, #48). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, HV = window.HV;
  const Z = (window.BDSCREENS = window.BDSCREENS || []);
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', PRE = '#5aa9ff', GOLD = '#ffd166', PURP = '#c9b6ff';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 2 : d) + '</span>';

  /* ---------- 1. Гистерезис против «пилы» у среднего ---------- */
  const s1 = { entryZ: 1.2, gapZ: 0.10, cost: 1.40 };

  Z.push({
    id: 'hysteresis-saw',
    title: 'Гистерезис порогов: почему нельзя входить и выходить рядом',
    lead: 'В классической формуле возврата к среднему важен не только сам уровень входа, но и прослойка между входом и выходом. Стоит сжать этот зазор — и стратегия превращается в станок по перекачке вашего счёта в комиссии биржи и брокера.',
    text: () => `
      <h3>Как работает ${T('hysteresis_gap', 'гистерезис (зазор порогов)')}</h3>
      <p>В быту гистерезис знаком каждому по комнатному обогревателю: если задать включение ровно на <code>20,0 °C</code> и выключение на <code>20,0 °C</code>, реле будет щёлкать каждую секунду и сгорит. Поэтому обогреватель включается на <code>19,5 °C</code>, а выключается только на <code>20,5 °C</code>.</p>
      <p>Точно так же устроен арбитраж спреда:</p>
      <ul>
        <li><b>Без зазора (<code>z_вход ≈ z_выход</code>):</b> мелкая рябь вокруг линии порога открывает и закрывает позицию десятки раз подряд. Валовая прибыль крошечная, а круговую комиссию <code>c</code> вы платите по полной в каждой сделке!</li>
        <li><b>С разумным гистерезисом:</b> мы открываем позицию далеко от равновесия (например, на <code>1,6σ</code>), а закрываем лишь после ощутимого пути назад (скажем, у <code>0,3σ</code>), чтобы ожидаемый ход в пунктах многократно перекрывал трение стакана.</li>
      </ul>
      <div class="note warn"><b>Важное правило:</b> универсального «магического числа 2σ» в природе не существует! Для дешёвой быстрой пары 2σ слишком широко, а для дорогой вязкой пары — опасно узко.</div>`,
    mount(el) {
      const bd = E.genBand({ seed: 7, n: 260, phi: 0.86, sdCalm: 1.35, sdStorm: 1.35, cost: 1.4 });
      const st = E.rolling(bd.clean, 40);

      el.innerHTML = `
        <div class="viz">
          <h4>Раздвиньте зазор гистерезиса и посмотрите, куда исчезает «комиссионная пила»</h4>
          <div id="sl1a"></div>
          <div id="sl1b"></div>
          <div id="sl1c"></div>
          <div id="k1" style="margin-top:10px"></div>
          <div class="legend" style="margin-top:10px">
            <span><i style="background:${PRE}"></i>валовая прибыль (до комиссий)</span>
            <span><i style="background:${ME}"></i>чистый счёт (после всех комиссий)</span>
          </div>
          <div id="c1"></div>
        </div>`;

      HV.slider(el.querySelector('#sl1a'), {
        label: 'Порог входа z_вход', min: 0.7, max: 2.5, step: 0.1, value: s1.entryZ,
        fmt: (v) => f(v, 2) + 'σ',
        onInput: (v) => { s1.entryZ = v; draw1(); }
      });
      HV.slider(el.querySelector('#sl1b'), {
        label: 'Ширина зазора гистерезиса Δz = z_вход − z_выход', min: 0.05, max: 2.0, step: 0.05, value: s1.gapZ,
        fmt: (v) => f(v, 2) + 'σ (выход на ' + f(Math.max(0, s1.entryZ - v), 2) + 'σ)',
        onInput: (v) => { s1.gapZ = v; draw1(); }
      });
      HV.slider(el.querySelector('#sl1c'), {
        label: 'Круговые издержки одной сделки c', min: 0.2, max: 2.6, step: 0.2, value: s1.cost,
        fmt: (v) => f(v, 2) + ' п.',
        onInput: (v) => { s1.cost = v; draw1(); }
      });

      let eqGross = [], eqNet = [];
      const c1 = A.mkChart(el.querySelector('#c1'), 195, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>до комиссий: <b style="color:' + PRE + '">' + U.sgn(eqGross[i]) + ' п.</b><br>чистый счёт: <b style="color:' + ME + '">' + U.sgn(eqNet[i]) + ' п.</b>'
      });

      function draw1() {
        const outZ = Math.max(0, s1.entryZ - s1.gapZ);
        const btGross = E.backtest(bd.clean, { n: 40, entryZ: s1.entryZ, exitZ: outZ, stopZ: 3.8, maxHold: 30, cost: 0 });
        const btNet = E.backtest(bd.clean, { n: 40, entryZ: s1.entryZ, exitZ: outZ, stopZ: 3.8, maxHold: 30, cost: s1.cost });
        eqGross = btGross.equity;
        eqNet = btNet.equity;
        const feesPaid = btGross.metrics.total - btNet.metrics.total;

        el.querySelector('#k1').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v">' + btNet.metrics.count + '</div><div class="l">сделок</div><div class="e">выход на ' + f(outZ) + 'σ</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + PRE + '">' + U.sgn(btGross.metrics.total, 1) + ' п.</div><div class="l">валовый сбор</div><div class="e">на бумаге без трения</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + BAD + '">−' + f(feesPaid, 1) + ' п.</div><div class="l">отдано комиссий</div><div class="e">' + btNet.metrics.count + ' × ' + f(s1.cost, 1) + ' п.</div></div>' +
            '<div class="kpi"><div class="v">' + col(btNet.metrics.total, 1) + ' п.</div><div class="l">чистый остаток</div><div class="e">' + (btNet.metrics.total < 0 ? 'пила съела счёт!' : 'гистерезис окупает вход') + '</div></div>' +
          '</div>';

        c1.render({
          n: bd.clean.length,
          hlines: [{ y: 0, color: '#ffffff24', dash: [3, 3] }],
          series: [
            { data: eqGross, color: PRE, width: 1.5, dash: [5, 4] },
            { data: eqNet, color: btNet.metrics.total >= 0 ? ME : BAD, width: 2.1 }
          ]
        });
      }
      draw1();
    }
  });

  /* ---------- 2. Модель Орнштейна — Уленбека и оптимальные границы Бертрама ---------- */
  const s2 = { halfLife: 4.0, sigmaEq: 2.0, cost: 0.90, exitZ: 0.20 };

  Z.push({
    id: 'bertram-ou',
    title: 'Модель Орнштейна — Уленбека и оптимальные границы Бертрама',
    lead: 'Вместо гадания «взять 1,5σ или 2,2σ?» зададим честный математический вопрос: при каком пороге входа ожидаемая чистая прибыль в день будет максимальной?',
    text: () => `
      <h3>Физика «пружины с шумом»: ${T('ou_process', 'процесс OU')}</h3>
      <p>Модель Орнштейна — Уленбека описывает спред двумя числами: равновесным разбросом <code>σ</code> и ${T('ou_theta', 'силой притяжения θ')} (чем больше <code>θ</code>, тем короче полураспад <code>t½ = 0,693 ÷ θ</code>):</p>
      <span class="formula">ΔS_t = θ · (μ − S_{t−1}) · Δt + σ_ш · ε_t<small>пример: при t½ = 4 дн. (θ ≈ 0,173) и отклонении S − μ = +4,0 п. пружина за один день тянет спред к центру в среднем на −0,173 × 4,0 ≈ −0,69 п.</small></span>
      <h3>${T('opt_stopping', 'Оптимальная остановка')} и ${T('bertram_bands', 'границы Бертрама')}</h3>
      <p>В 2010 году У. Бертрам вывел точные формулы времени ожидания для процесса OU. Посмотрите, какие две силы борются друг с другом при выборе порога входа <code>a</code>:</p>
      <ul>
        <li><b>Слишком близкий порог:</b> цикл быстрый, но ход цены едва покрывает круговые издержки <code>c</code> — чистая скорость заработка уходит в минус.</li>
        <li><b>Слишком далёкий порог (3σ+):</b> прибыль на одну сделку большая, но время ожидания такого редкого выброса растёт лавинообразно (как <code>e^(a²/2)</code>) — деньги месяцами простаивают без дела!</li>
      </ul>
      <div class="note"><b>Честная оговорка учебника:</b> полосы Бертрама <i>«оптимальны по модели OU, а не вообще»</i>. Если реальный спред имеет тяжёлые новостные хвосты или меняет режим, модельный оптимум служит умной отправной точкой, а не догмой.</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Колокол Бертрама: как рост комиссии сдвигает оптимальный порог входа вправо</h4>
          <div id="sl2a"></div>
          <div id="sl2b"></div>
          <div id="sl2c"></div>
          <div id="k2" style="margin-top:10px"></div>
          <p class="cap" style="margin:10px 0 4px">По горизонтали — рассматриваемый порог входа от 0,50σ до 3,10σ; по вертикали — ожидаемая чистая прибыль за 100 дней:</p>
          <div id="c2"></div>
        </div>`;

      HV.slider(el.querySelector('#sl2a'), {
        label: 'Круговые издержки сделки c (комиссии + проскальзывание)', min: 0.15, max: 3.00, step: 0.15, value: s2.cost,
        fmt: (v) => f(v, 2) + ' п.',
        onInput: (v) => { s2.cost = v; draw2(); }
      });
      HV.slider(el.querySelector('#sl2b'), {
        label: 'Период полураспада пары t½', min: 1.5, max: 14.0, step: 0.5, value: s2.halfLife,
        fmt: (v) => f(v, 1) + ' дн. (θ = ' + f(Math.LN2 / v, 2) + ')',
        onInput: (v) => { s2.halfLife = v; draw2(); }
      });
      HV.slider(el.querySelector('#sl2c'), {
        label: 'Стационарный разброс спреда σ', min: 1.0, max: 3.6, step: 0.2, value: s2.sigmaEq,
        fmt: (v) => f(v, 1) + ' п.',
        onInput: (v) => { s2.sigmaEq = v; draw2(); }
      });

      let gridA = [], curveRate = [];
      const c2 = A.mkChart(el.querySelector('#c2'), 210, {
        tip: (i) => '<b>Порог входа a = ' + f(gridA[i]) + 'σ</b><br>ожид. чистый темп: <b>' + U.sgn(curveRate[i], 1) + ' п. / 100 дн.</b>'
      });

      function draw2() {
        const theta = Math.LN2 / s2.halfLife;
        const opt = E.bertramBands(theta, s2.sigmaEq, s2.cost);
        gridA = []; curveRate = [];
        let peakIdx = 0, bestVal = -Infinity;
        for (let a = 0.50; a <= 3.101; a += 0.05) {
          const met = E.ouCycleMetrics(a, opt.exitZ, theta, s2.sigmaEq, s2.cost);
          const r = Math.max(-25, met.rate100d);
          gridA.push(a);
          curveRate.push(r);
          if (Math.abs(a - opt.entryZ) < 0.026) peakIdx = gridA.length - 1;
          if (r > bestVal) bestVal = r;
        }

        el.querySelector('#k2').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + GOLD + '">' + f(opt.entryZ) + 'σ → ' + f(opt.exitZ) + 'σ</div><div class="l">оптимум Бертрама</div><div class="e">гистерезис ' + f(opt.hystZ) + 'σ</div></div>' +
            '<div class="kpi"><div class="v">' + f(opt.holdDays, 1) + ' дн.</div><div class="l">ожид. время в сделке</div><div class="e">+ ожидание входа ' + f(opt.waitDays, 1) + ' дн.</div></div>' +
            '<div class="kpi"><div class="v">' + col(opt.netPerTrade) + ' п.</div><div class="l">чистыми со сделки</div><div class="e">после вычета c = ' + f(s2.cost) + ' п.</div></div>' +
            '<div class="kpi"><div class="v">' + col(opt.rate100d, 1) + ' п.</div><div class="l">темп на 100 дней</div><div class="e">на вершине колокола</div></div>' +
          '</div>';

        c2.render({
          n: curveRate.length,
          hlines: [{ y: 0, color: '#ff6b6b55', dash: [4, 4] }],
          markers: [{ i: peakIdx, y: curveRate[peakIdx], color: GOLD, r: 5.5 }],
          series: [{ data: curveRate, color: ME, width: 2.3 }]
        });
      }
      draw2();
    }
  });

  /* ---------- 3. Волю-адаптивные полосы вместо грубого стоп-крана ---------- */
  const s3 = { gamma: 0.85, baseEntry: 1.75 };

  Z.push({
    id: 'vol-adaptive',
    title: 'Волю-адаптивные полосы: плавное дыхание вместо стоп-крана',
    lead: 'На живом рынке волатильность ходит кластерами: за тихим летом приходит нервная осень. Фиксированный порог 2σ летом спит без сделок, а осенью влетает в позицию на первой же волне шторма.',
    text: () => `
      <h3>${T('garch_cluster', 'Кластеры волатильности')} и ${T('vol_adaptive', 'волю-адаптивные пороги')}</h3>
      <p>В разделе «Приёмы» мы смотрели на жёсткий выключатель (фильтр режима): поднялась буря — стратегия нажала стоп-кран и совсем ушла с рынка. Но у грубого выключателя есть минус: он полностью упускает самые сочные откаты во время высокой волатильности.</p>
      <p><b>Волю-адаптивные полосы (Стратегия C)</b> действуют тоньше — они масштабируют порог входа по отношению быстрой прогнозной волатильности (EWMA / GARCH) к спокойной долгосрочной норме:</p>
      <span class="formula">z_вход(t) = z_база × (σ_быстрая(t) ÷ σ_длинная(t))^γ</span>
      <ul>
        <li><b>В тихий плёс (отношение &lt; 1):</b> полосы аккуратно сжимаются (например, до <code>1,25σ</code>), не давая капиталу простаивать в сонные месяцы.</li>
        <li><b>В начале шторма (отношение &gt; 1):</b> полосы мгновенно раздвигаются до <code>2,6–3,2σ</code>, пропуская опасную первую волну и заходя только на действительно экстремальном растяжении резинки!</li>
      </ul>`,
    mount(el) {
      const bd = E.genBandScenario(7, E.BAND_SCENARIOS[2]);
      const st = E.rolling(bd.clean, 45);

      el.innerHTML = `
        <div class="viz">
          <h4>Настройте эластичность дыхания полос γ на переходе «штиль → шторм → штиль»</h4>
          <div id="sl3a"></div>
          <div id="sl3b"></div>
          <div id="k3" style="margin-top:10px"></div>
          <div class="legend" style="margin-top:10px">
            <span><i style="background:${PRE}"></i>текущий z-score спреда</span>
            <span><i style="background:${GOLD}"></i>верхняя и нижняя волю-адаптивные полосы</span>
            <span><i style="background:#ffffff55"></i>неподвижный шаблон ±2,0σ</span>
          </div>
          <div id="c3"></div>
        </div>`;

      HV.slider(el.querySelector('#sl3a'), {
        label: 'Чувствительность полос к всплеску волатильности (γ)', min: 0.0, max: 1.3, step: 0.1, value: s3.gamma,
        fmt: (v) => v === 0 ? '0 (неподвижные полосы)' : f(v, 2),
        onInput: (v) => { s3.gamma = v; draw3(); }
      });
      HV.slider(el.querySelector('#sl3b'), {
        label: 'Базовый порог входа в нормальную погоду z_база', min: 1.3, max: 2.3, step: 0.05, value: s3.baseEntry,
        fmt: (v) => f(v, 2) + 'σ',
        onInput: (v) => { s3.baseEntry = v; draw3(); }
      });

      let vaUp = [], vaDn = [];
      const c3 = A.mkChart(el.querySelector('#c3'), 210, {
        tip: (i) => '<b>День ' + (i + 1) + (bd.inStorm[i] ? ' (ШТОРМ)' : ' (штиль)') + '</b>' +
          (st.z[i] !== null ? '<br>z-score: <b>' + U.sgn(st.z[i]) + 'σ</b>' : '') +
          '<br>адаптивный порог: <b style="color:' + GOLD + '">±' + f(vaUp[i]) + 'σ</b>'
      });

      function draw3() {
        const va = E.volAdaptiveBands(bd.clean, { baseEntry: s3.baseEntry, baseExit: 0.30, gamma: s3.gamma });
        vaUp = va.entryBand;
        vaDn = va.entryBand.map((v) => -v);

        const btFix = E.backtestBands(bd, { bandMode: 'fixed_2s' });
        // Custom backtest with chosen gamma/baseEntry
        let cur = 0, entry = null, real = 0, cnt = 0, stops = 0;
        for (let t = 0; t < bd.clean.length; t++) {
          const z = st.z[t];
          if (z === null) continue;
          const bc = bd.opts.cost * (bd.inStorm[t] ? 2.4 : 1.0);
          if (cur === 0) {
            if (z >= vaUp[t]) { cur = -1; entry = { idx: t, v: bd.clean[t] }; real -= 0.5 * bc; }
            else if (z <= -vaUp[t]) { cur = 1; entry = { idx: t, v: bd.clean[t] }; real -= 0.5 * bc; }
          } else {
            const hitOut = (cur === -1 && z <= va.exitBand[t]) || (cur === 1 && z >= -va.exitBand[t]);
            const hitSt = Math.abs(z) >= Math.max(3.6, vaUp[t] + 1.3);
            if (hitOut || hitSt || t - entry.idx >= 30) {
              if (hitSt) stops++;
              real += cur * (bd.clean[t] - entry.v) - 0.5 * bc;
              cnt++; cur = 0; entry = null;
            }
          }
        }
        const fixStops = btFix.trades.filter((x) => x.reason === 'stop').length;

        el.querySelector('#k3').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v">' + col(btFix.metrics.total, 1) + ' п.</div><div class="l">шаблон ±2,0σ</div><div class="e">' + btFix.metrics.count + ' сд. · стопов: ' + fixStops + '</div></div>' +
            '<div class="kpi"><div class="v">' + col(real, 1) + ' п.</div><div class="l">волю-адаптивные полосы</div><div class="e">' + cnt + ' сд. · стопов: ' + stops + '</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + GOLD + '">' + f(Math.min(...vaUp.slice(45))) + 'σ … ' + f(Math.max(...vaUp.slice(45))) + 'σ</div><div class="l">диапазон дыхания</div><div class="e">от штиля до пика бури</div></div>' +
          '</div>';

        c3.render({
          n: bd.clean.length,
          spans: [{ i0: 100, i1: 220, color: '#ff6b6b16' }],
          hlines: [
            { y: 2.0, color: '#ffffff40', dash: [4, 4] },
            { y: -2.0, color: '#ffffff40', dash: [4, 4] },
            { y: 0, color: '#ffffff18', dash: [2, 3] }
          ],
          series: [
            { data: st.z, color: PRE, width: 1.45 },
            { data: vaUp, color: GOLD, width: 2.0 },
            { data: vaDn, color: GOLD, width: 2.0 }
          ]
        });
      }
      draw3();
    }
  });

  /* ---------- 4. Надстройка переноса Carry-overlay и диагностика «Mispricing против дрейфа» ---------- */
  const s4 = { dailyCarry: 0.32, holdDays: 6.0, baseEntry: 1.50 };

  Z.push({
    id: 'carry-overlay',
    title: 'Надстройка Carry-overlay и бейдж «Недооценка против дрейфа»',
    lead: 'На срочном рынке MOEX большинство пар имеют встроенное течение — процентный перенос (контанго, бэквордацию, SwapRate). Плыть по течению и грести против водопада по одним и тем же симметричным правилам — грубейшая ошибка.',
    text: () => `
      <h3>Откуда берётся ${T('carry_overlay', 'чистый перенос (Carry overlay)')} — три разные механики</h3>
      <p>Не путайте три разных источника переноса, у каждого из которых своя физика на счёте:</p>
      <ul>
        <li><b>1. Базис «Фьючерс − Спот»:</b> к экспирации надбавка контанго действительно тает к нулю. Но чистый перенос равен не всей разнице цен, а только её остатку после вычета цены фондирования второй ноги.</li>
        <li><b>2. Календарный спред двух срочных серий (<code>Дальний − Ближний</code>):</b> зазор между их экспирациями <code>ΔT</code> постоянен — при плоской ставке серии не сходятся в одну точку, а если сам спред стоит на месте, вариационная маржа равна <b>нулю</b>. Попутное «скатывание по кривой» (<i>roll-down</i>) возникает тогда, когда ближний участок срочной кривой заметно круче дальнего.</li>
        <li><b>3. Связка с вечным фьючерсом (<code>Квартальный − Вечный</code>):</b> таяние контанго квартальной ноги обязано сравниваться с ежедневным потоком <code>SwapRate</code> вечной ноги (см. <a href="#moex/3" style="color:#7ee0b5">раздел MOEX</a>) — чистый <code>carry</code> равен лишь разнице между ними!</li>
      </ul>
      <p>Пусть после всех вычетов у пары есть честный чистый перенос <code>+0,32 п./день</code> в пользу продавца спреда: тогда короткая сделка плывёт по попутному течению (<code>+carry</code> за день ожидания), а длинная гребёт против него (<code>−carry</code>).</p>
      <h3>${T('asym_bands', 'Асимметричные пороги')} и ярлык ${T('mispricing_vs_drift', '«Недооценка против дрейфа»')}</h3>
      <p>Надстройка <b>Carry-overlay</b> наклоняет ворота входа: по попутному ветру порог смягчается, а против ветра — отодвигается всё дальше. Если же встречный дрейф за время полураспада съедает основную часть ожидаемого отскока, загорается красный предохранитель <b>«Дрейф, а не mispricing»</b> — вход против переноса полностью закрывается!</p>`,
    mount(el) {
      const bd = E.genBandScenario(7, E.BAND_SCENARIOS[3]);
      el.innerHTML = `
        <div class="viz">
          <h4>Калькулятор асимметричных ворот: попутный перенос против встречного течения</h4>
          <div id="sl4a"></div>
          <div id="sl4b"></div>
          <div id="sl4c"></div>
          <div id="k4" style="margin-top:10px"></div>
          <div id="ver4" class="note" style="margin-top:10px"></div>
        </div>
        <div class="viz">
          <h4>Почему наивная стратегия путает перенос с «дешевизной» (сценарий сильного контанго)</h4>
          <div class="legend">
            <span><i style="background:${BAD}"></i>сырой спред на графике (сползает по переносу)</span>
            <span><i style="background:${ME}"></i>истинное отклонение от справедливого переноса (mispricing)</span>
          </div>
          <div id="c4"></div>
        </div>`;

      HV.slider(el.querySelector('#sl4a'), {
        label: 'Суточный перенос в пользу шорта спреда (dailyCarry)', min: -0.45, max: 0.45, step: 0.03, value: s4.dailyCarry,
        fmt: (v) => U.sgn(v, 2) + ' п./день (' + (v > 0.01 ? 'попутный для шорта' : v < -0.01 ? 'попутный для лонга' : 'нейтрально') + ')',
        onInput: (v) => { s4.dailyCarry = v; draw4(); }
      });
      HV.slider(el.querySelector('#sl4b'), {
        label: 'Ожидаемое время удержания сделки H', min: 2, max: 16, step: 1, value: s4.holdDays,
        fmt: (v) => v + ' дн.',
        onInput: (v) => { s4.holdDays = v; draw4(); }
      });
      HV.slider(el.querySelector('#sl4c'), {
        label: 'Базовый симметричный порог Бертрама (при σ = 1,8 п.)', min: 1.0, max: 2.4, step: 0.1, value: s4.baseEntry,
        fmt: (v) => f(v, 2) + 'σ',
        onInput: (v) => { s4.baseEntry = v; draw4(); }
      });

      const c4 = A.mkChart(el.querySelector('#c4'), 180, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>сырой спред: <b style="color:' + BAD + '">' + U.sgn(bd.raw[i]) + ' п.</b><br>чистый mispricing: <b style="color:' + ME + '">' + U.sgn(bd.clean[i]) + ' п.</b>'
      });
      c4.render({
        n: bd.raw.length, x0: 0, x1: 160,
        hlines: [{ y: 0, color: '#ffffff28', dash: [3, 3] }],
        series: [
          { data: bd.raw, color: BAD, width: 1.6 },
          { data: bd.clean, color: ME, width: 2.0 }
        ]
      });

      function draw4() {
        const ov = E.carryOverlayBands(s4.baseEntry, 0.25, s4.dailyCarry, 1.8, s4.holdDays);
        const carryPts = s4.dailyCarry * s4.holdDays;

        el.querySelector('#k4').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v">' + col(carryPts) + ' п.</div><div class="l">набежит переноса за ' + s4.holdDays + ' дн.</div><div class="e">' + U.sgn(ov.carryInSigma) + 'σ к короткой сделке</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + (ov.blockShort ? BAD : ME) + '">' + (ov.blockShort ? 'ЗАКРЫТО' : '+' + f(ov.shortEntry) + 'σ') + '</div><div class="l">порог входа в ШОРТ</div><div class="e">' + (s4.dailyCarry > 0.01 ? 'смягчён по попутному ветру' : s4.dailyCarry < -0.01 ? 'ужесточён против ветра' : 'симметричен') + '</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + (ov.blockLong ? BAD : ME) + '">' + (ov.blockLong ? 'ЗАКРЫТО' : '−' + f(ov.longEntry) + 'σ') + '</div><div class="l">порог входа в ЛОНГ</div><div class="e">' + (s4.dailyCarry < -0.01 ? 'смягчён по попутному ветру' : s4.dailyCarry > 0.01 ? 'ужесточён против ветра' : 'симметричен') + '</div></div>' +
          '</div>';

        const vEl = el.querySelector('#ver4');
        if (ov.blockLong || ov.blockShort) {
          vEl.className = 'note bad';
          vEl.innerHTML = '<b>Экономический бейдж: «Дрейф, а не mispricing!»</b> За ' + s4.holdDays + ' дней удержания встречный перенос съедает <b>' + f(Math.abs(carryPts)) + ' п. (' + f(Math.abs(ov.carryInSigma)) + 'σ)</b> — торговать против такого течения запрещено, работает только сбор попутного переноса.';
        } else if (Math.abs(s4.dailyCarry) > 0.02) {
          vEl.className = 'note warn';
          vEl.innerHTML = '<b>Умеренная асимметрия переноса:</b> обе стороны открыты, но против ветра планка поднята намного выше, чтобы запас хода гарантированно окупил плату за удержание.';
        } else {
          vEl.className = 'note';
          vEl.innerHTML = 'Перенос близок к нулю: ворота входа симметричны (±' + f(s4.baseEntry) + 'σ).';
        }
      }
      draw4();
    }
  });
})();
