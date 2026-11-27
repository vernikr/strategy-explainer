/* Осторожные ML-надстройки без «чёрного ящика», экраны 1–4:
   коробка тройного барьера без правого подглядывания, двуслойный meta-labeling,
   кривая выживаемости схождения P(T_conv ≤ H) и 5 предохранителей research-only RL (#72, #52). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, HV = window.HV;
  const Z = (window.MLSCREENS = []);
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', PRE = '#5aa9ff', GOLD = '#ffd166', PURP = '#c9b6ff';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const pct = (v, d) => U.fmt(v * 100, d === undefined ? 0 : d) + '%';

  /* ---------- 1. Тройной барьер (triple-barrier) без заглядывания вперёд ---------- */
  const s1 = { pt: 1.35, sl: 1.50, hold: 16, splitCut: 48 };

  Z.push({
    id: 'triple-barrier',
    title: 'Тройной барьер (triple-barrier): честная разметка без подглядывания',
    lead: 'Прежде чем учить любой фильтр отличать удачные сделки от провальных, нужно честно разметить прошлые входы — не гадая по фиксированному дню и не заглядывая за границу выборки.',
    text: () => `
      <h3>Почему нельзя размечать сделки «просто через 10 дней» (§5.3)</h3>
      <p>Если смотреть только на цену ровно через 10 сессий, можно назвать «успешной» сделку, которая на 4-й день пробила бы ваш стоп-лосс и вынесла маржу! Поэтому в финансовом машинном обучении используют ${T('triple_barrier', 'метод тройного барьера')}:</p>
      <ul>
        <li><b>Верхняя крышка (тейк-профит):</b> спред вернулся к цели и принёс прибыль после издержек → метка <code>+1</code> (успех).</li>
        <li><b>Нижнее дно (стоп-лосс):</b> расхождение сорвалось дальше против нас → метка <code>−1</code> (провал).</li>
        <li><b>Вертикальная стенка времени <code>H</code>:</b> за <code>H</code> сессий ни тейк, ни стоп не задеты → метка <code>0</code> (застрявший капитал).</li>
      </ul>
      <p>И главное санитарное правило: если коробка сделки упирается в границу раздела «обучение / тест», её правый хвост обязан отсекаться (${T('right_censoring', 'правостороннее цензурирование')} / <i>purging</i>), чтобы будущий тест не просочился в обучение.</p>`,
    mount(el) {
      const md = E.genMlScenario(7, E.ML_SCENARIOS[3]);
      const seg = md.spread.slice(25, 85); // 60 наглядных баров со входом на баре #12
      const entryBar = 12;

      el.innerHTML = `
        <div class="viz">
          <h4>Коробка трёх барьеров вокруг входа на баре #12 (покупка спреда со дна)</h4>
          <div id="sl1"></div>
          <div id="kpi1" style="margin:10px 0"></div>
          <div class="legend">
            <span><i style="background:${PRE}"></i>траектория спреда</span>
            <span><i style="background:${ME}"></i>верхний тейк</span>
            <span><i style="background:${BAD}"></i>нижний стоп</span>
            <span><i style="background:${GOLD}"></i>стенка времени H / граница обучения</span>
          </div>
          <div id="c1"></div>
        </div>`;

      const sl = el.querySelector('#sl1');
      HV.slider(sl, {
        label: 'Верхний барьер прибыли (в единицах σ)', min: 0.75, max: 2.20, step: 0.15, value: s1.pt,
        fmt: (v) => '+' + f(v) + ' σ',
        onInput: (v) => { s1.pt = v; draw1(); }
      });
      HV.slider(sl, {
        label: 'Нижний барьер стоп-лосса (в единицах σ)', min: 0.75, max: 2.25, step: 0.15, value: s1.sl,
        fmt: (v) => '−' + f(v) + ' σ',
        onInput: (v) => { s1.sl = v; draw1(); }
      });
      HV.slider(sl, {
        label: 'Вертикальный барьер времени H', min: 5, max: 26, step: 1, value: s1.hold,
        fmt: (v) => v + ' сессий',
        onInput: (v) => { s1.hold = v; draw1(); }
      });
      HV.slider(sl, {
        label: 'Граница обучающего окна (проверка защиты стыка)', min: 16, max: 55, step: 1, value: s1.splitCut,
        fmt: (v) => 'бар #' + v + (v < entryBar + s1.hold ? ' (режет коробку!)' : ' (правее коробки)'),
        onInput: (v) => { s1.splitCut = v; draw1(); }
      });

      const c1 = A.mkChart(el.querySelector('#c1'), 195, {
        tip: (i) => '<b>Бар #' + i + '</b> · уровень спреда: <b>' + f(seg[i]) + ' п.</b>'
      });

      function draw1() {
        const tb = E.tripleBarrierLabel(seg, entryBar, 1, {
          sigmaBar: 1.05, ptMult: s1.pt, slMult: s1.sl, maxHold: s1.hold, cost: 0.28, maxKnownIdx: s1.splitCut
        });
        const outMap = {
          take: ['КАСАНИЕ ТЕЙКА (+1)', ME, 'мета-метка y = 1 (хороший вход)'],
          stop: ['КАСАНИЕ СТОПА (−1)', BAD, 'мета-метка y = 0 (токсичный вход)'],
          timeout: ['ТАЙМАУТ ВРЕМЕНИ (0)', GOLD, 'мета-метка y = 0 (деньги застряли)'],
          purged_right: ['ОБРЕЗАНО СТЫКОМ (PURGED)', PURP, 'изъято из обучения без подглядывания!']
        };
        const info = outMap[tb.outcome];

        el.querySelector('#kpi1').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + info[1] + '">' + info[0] + '</div><div class="l">первое касание стенки</div><div class="e">' + info[2] + '</div></div>' +
            '<div class="kpi"><div class="v">бар #' + tb.exitIdx + ' (' + tb.holdBars + ' дн.)</div><div class="l">точка завершения эпизода</div><div class="e">вход на баре #' + entryBar + '</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + (tb.netPnl >= 0 ? ME : BAD) + '">' + U.sgn(tb.netPnl) + ' п.</div><div class="l">нетто-исход с издержками</div><div class="e">после трения 0,28 п.</div></div>' +
          '</div>';

        const ptLine = seg.map((_, i) => (i >= entryBar && i <= tb.exitIdx) ? tb.upperPrice : null);
        const slLine = seg.map((_, i) => (i >= entryBar && i <= tb.exitIdx) ? tb.lowerPrice : null);

        c1.render({
          n: seg.length,
          hlines: [{ y: 0, color: '#ffffff20', dash: [3, 3] }],
          vlines: [
            { x: entryBar, color: PRE + '99', dash: [2, 2] },
            { x: Math.min(seg.length - 1, entryBar + s1.hold), color: GOLD + 'aa', dash: [4, 3] },
            { x: s1.splitCut, color: PURP + 'cc', dash: [2, 3] }
          ],
          markers: [
            { x: entryBar, y: seg[entryBar], color: PRE, r: 4.5 },
            { x: tb.exitIdx, y: seg[tb.exitIdx], color: info[1], r: 5.5 }
          ],
          series: [
            { data: seg, color: PRE, width: 2.1 },
            { data: ptLine, color: ME, width: 2.0, dash: [4, 3] },
            { data: slLine, color: BAD, width: 2.0, dash: [4, 3] }
          ]
        });
      }
      draw1();
    }
  });

  /* ---------- 2. Двуслойная мета-маркировка (meta-labeling) ---------- */
  const s2 = { volEx: 0.20, driftEx: 0.15, costEx: 0.20, expEx: 0.10 };

  Z.push({
    id: 'meta-labeling',
    title: 'Мета-маркировка (meta-labeling): база даёт смысл, оверлей — фильтр',
    lead: 'Главная ошибка с ИИ в финансах — попросить нейросеть с нуля выдумать, куда пойдёт цена завтра. Осторожный инженерный путь устроен ровно наоборот.',
    text: () => `
      <h3>Почему ${T('ml_overlay', 'двуслойный оверлей')} безопаснее ${T('blackbox_trap', '«чёрного ящика»')} (§4.8)</h3>
      <p>В схеме ${T('meta_labeling', 'meta-labeling')} (Лопес де Прадо) роли строго разделены между человеком и алгоритмом:</p>
      <ol>
        <li><b>Слой 1 — понятная экономическая модель (Z-score, OU, календарный перенос):</b> отвечает за <i>направление</i> сделки. Никакой ML не имеет права купить разваливающийся спред «потому что так сошлись 16 прошлых свечек».</li>
        <li><b>Слой 2 — обученный мета-фильтр:</b> включается <i>только тогда, когда Слой 1 уже подал сигнал</i>, и по простым признакам погоды (всплеск бури, локальный снос, ширина стакана, сжатие времени до ролла) выдаёт ${T('prob_calibration', 'калиброванную вероятность')} успеха <code>p_meta</code>:
          <ul>
            <li><code>p_meta &lt; 47%</code> → <b>ПРОПУСТИТЬ (0×)</b> — переждать ловушку в кэше;</li>
            <li><code>47–62%</code> → <b>ПОЛОВИННЫЙ ОБЪЁМ (0,5×)</b> — осторожный вход;</li>
            <li><code>≥ 62%</code> → <b>ПОЛНЫЙ РАБОЧИЙ ОБЪЁМ (1,0×)</b>.</li>
          </ul>
        </li>
      </ol>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Пульт второго слоя: подайте обстановку в момент базового сигнала Z-score</h4>
          <div id="sl2"></div>
          <div id="kpi2" style="margin:10px 0"></div>
          <div id="bars2" style="margin-top:8px"></div>
        </div>`;

      const sl = el.querySelector('#sl2');
      HV.slider(sl, {
        label: '1. Всплеск короткой волатильности (σ_5 / σ_35 − 1)', min: 0, max: 1.5, step: 0.1, value: s2.volEx,
        fmt: (v) => v < 0.25 ? '+' + f(v, 1) + ' (спокойно)' : '+' + f(v, 1) + ' (буря!)',
        onInput: (v) => { s2.volEx = v; draw2(); }
      });
      HV.slider(sl, {
        label: '2. Локальный безоткатный снос против возврата', min: 0, max: 1.5, step: 0.1, value: s2.driftEx,
        fmt: (v) => v < 0.25 ? f(v, 1) + ' (упругий возврат)' : f(v, 1) + ' (похоже на слом!)',
        onInput: (v) => { s2.driftEx = v; draw2(); }
      });
      HV.slider(sl, {
        label: '3. Дороговизна стакана и проскальзывания сегодня', min: 0, max: 1.5, step: 0.1, value: s2.costEx,
        fmt: (v) => v < 0.25 ? f(v, 1) + ' (узкий спред)' : f(v, 1) + ' (дорогой стакан!)',
        onInput: (v) => { s2.costEx = v; draw2(); }
      });
      HV.slider(sl, {
        label: '4. Дефицит времени до экспирации / дивидендной отсечки', min: 0, max: 1.5, step: 0.1, value: s2.expEx,
        fmt: (v) => v < 0.20 ? f(v, 1) + ' (запас большой)' : f(v, 1) + ' (цейтнот!)',
        onInput: (v) => { s2.expEx = v; draw2(); }
      });

      const model = { bias: 1.15, weights: [-1.05, -1.15, -1.20, -1.10] };
      const names = ['Всплеск волатильности', 'Безоткатный снос', 'Дорогой стакан', 'Цейтнот экспирации'];

      function draw2() {
        const res = E.predictMetaProb(model, [s2.volEx, s2.driftEx, s2.costEx, s2.expEx]);
        const actLabel = res.action === 'full' ? 'ПОЛНЫЙ ВХОД (1,0×)' : (res.action === 'half' ? 'УМЕНЬШИТЬ (0,5×)' : 'ПРОПУСТИТЬ СИГНАЛ (0×)');
        const actColor = res.action === 'full' ? ME : (res.action === 'half' ? GOLD : BAD);

        el.querySelector('#kpi2').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + PRE + '">ШОРТ СПРЕДА</div><div class="l">Слой 1: базовый Z = +1,8σ</div><div class="e">направление не меняется!</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + actColor + '">' + pct(res.prob, 1) + '</div><div class="l">Слой 2: вероятность успеха p_meta</div><div class="e">логит = ' + U.sgn(res.logit) + '</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + actColor + '">' + actLabel + '</div><div class="l">решение мета-оверлея</div><div class="e">множитель лота = ' + f(res.sizeMult, 1) + '×</div></div>' +
          '</div>';

        el.querySelector('#bars2').innerHTML =
          '<div class="note"><b>Прозрачный вклад факторов в решение мета-фильтра (базовый запас +1,15):</b>' +
          res.contrib.map((c, k) => {
            const wPct = Math.min(100, Math.abs(c) * 48);
            return '<div style="margin-top:6px;font-size:12.5px">' +
              '<div style="display:flex;justify-content:space-between"><span>' + names[k] + '</span><b style="color:' + (c < -0.25 ? BAD : '#c8d2e6') + '">' + U.sgn(c) + '</b></div>' +
              '<div style="height:8px;background:#1a2230;border-radius:4px;overflow:hidden"><div style="width:' + wPct.toFixed(1) + '%;height:100%;background:' + (c < -0.25 ? BAD : SIM) + '"></div></div>' +
            '</div>';
          }).join('') + '</div>';
      }
      draw2();
    }
  });

  /* ---------- 3. Кривая выживаемости схождения P(T_conv ≤ H) ---------- */
  const s3 = { expDays: 14, hazard: 1.0 };

  Z.push({
    id: 'survival-curve',
    title: 'Анализ выживаемости: успеет ли спред сойтись за H дней P(T_conv ≤ H)?',
    lead: 'Для фьючерсного трейдера вопрос «сойдётся ли спред когда-нибудь?» бесполезен, если ближний контракт истекает через неделю. Нужна честная кривая вероятности по горизонтам 5, 10, 20 и 40 сессий.',
    text: () => `
      <h3>${T('survival_conv', 'Сюрвивальная вероятность P(T_conv ≤ H)')} вместо гадания «да / нет» (§4.8)</h3>
      <p>В медицине и инженерии надёжности давно решают похожую задачу: <i>какая доля объектов дождётся события к дню H, если часть наблюдений обрывается раньше срока?</i></p>
      <p>${T('kaplan_meier', 'Оценка Каплана — Мейера')} перемножает по шагам долю ещё открытых сделок с учётом ${T('right_censoring', 'цензурированных эпизодов')} и выдаёт готовую шкалу для среднесрочного трейдера:</p>
      <span class="formula">S(H) = Π_{t ≤ H} (1 − d_t ÷ n_t),   P(T_conv ≤ H) = 1 − S(H)<small>пример: если к сессии H = 10 в пути осталось S(10) = 0,32 сделок, шанс успеть закрыться до экспирации равен 1 − 0,32 = 68% (здесь H — горизонт в сессиях, не путать с показателем Хёрста H ∈ (0, 1)!)</small></span>
      <ul>
        <li>Видно сразу четыре контрольных горизонта: <b>5, 10, 20 и 30+ сессий</b>.</li>
        <li><b>Поправка на текущую скорость возврата:</b> в упругом спокойном рынке ежедневный шанс закрыть расхождение выше средней исторической нормы, а в вязком новостном застое — вдвое ниже (это задаёт множитель скорости схождения на ползунке справа).</li>
        <li>Прямая стыковка с гейтом экспирации (§7.1): если до истечения ближней ноги осталось <code>7</code> сессий, а <code>P(T_conv ≤ 7) = 34%</code> (ниже порога <code>52%</code>) — вход блокируется, даже если Z-score красив!</li>
      </ul>`,
    mount(el) {
      const baseEpisodes = [
        { holdBars: 3, converged: true }, { holdBars: 4, converged: true }, { holdBars: 5, converged: true },
        { holdBars: 6, converged: true }, { holdBars: 7, converged: true }, { holdBars: 8, converged: false },
        { holdBars: 9, converged: true }, { holdBars: 10, converged: true }, { holdBars: 11, converged: true },
        { holdBars: 13, converged: true }, { holdBars: 14, converged: false }, { holdBars: 15, converged: true },
        { holdBars: 17, converged: true }, { holdBars: 19, converged: true }, { holdBars: 22, converged: true },
        { holdBars: 24, converged: false }, { holdBars: 26, converged: true }, { holdBars: 30, converged: false }
      ];

      el.innerHTML = `
        <div class="viz">
          <h4>Кривая накопленной вероятности схождения P(T_conv ≤ H) от 1 до 35 сессий</h4>
          <div id="sl3"></div>
          <div id="kpi3" style="margin:10px 0"></div>
          <div id="c3"></div>
          <div id="tab3" style="margin-top:10px"></div>
        </div>`;

      const sl = el.querySelector('#sl3');
      HV.slider(sl, {
        label: 'Осталось сессий до экспирации ближней ноги', min: 3, max: 32, step: 1, value: s3.expDays,
        fmt: (v) => v + ' сессий до ролла / истечения',
        onInput: (v) => { s3.expDays = v; draw3(); }
      });
      HV.slider(sl, {
        label: 'Текущая упругость возврата рынка (множитель скорости схождения)', min: 0.45, max: 1.75, step: 0.1, value: s3.hazard,
        fmt: (v) => f(v, 2) + '× (' + (v < 0.8 ? 'вязкий тягучий рынок' : (v > 1.2 ? 'бодрый упругий спред' : 'обычный темп')) + ')',
        onInput: (v) => { s3.hazard = v; draw3(); }
      });

      let curKm = null;
      const c3 = A.mkChart(el.querySelector('#c3'), 180, {
        tip: (i) => curKm ? '<b>Горизонт H = ' + curKm.horizons[i] + ' сессий</b><br>' +
          'Шанс успеть сойтись P(T ≤ ' + curKm.horizons[i] + '): <b>' + pct(curKm.convProb[i], 1) + '</b><br>' +
          'Ещё в пути S(H): ' + pct(curKm.survProb[i], 1) : ''
      });

      function draw3() {
        curKm = E.kaplanMeierSurvival(baseEpisodes, { maxH: 35, hazardMult: s3.hazard, daysToExpiry: s3.expDays, minProbGate: 0.52 });

        el.querySelector('#kpi3').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + (curKm.passesExpiryGate ? ME : BAD) + '">' + pct(curKm.probBeforeExpiry, 0) + '</div><div class="l">шанс успеть за ' + s3.expDays + ' дн.</div><div class="e">' + (curKm.passesExpiryGate ? 'PASS (≥ 52%, запас есть ✓)' : 'BLOCKED (< 52%, не успеем!)') + '</div></div>' +
            '<div class="kpi"><div class="v">' + (curKm.medianBars ? curKm.medianBars + ' сессий' : '> 35 сессий') + '</div><div class="l">медианный срок схождения</div><div class="e">рубеж P(T ≤ H) = 50%</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + PRE + '">' + pct(curKm.p5, 0) + ' / ' + pct(curKm.p10, 0) + ' / ' + pct(curKm.p20, 0) + '</div><div class="l">за 5 / 10 / 20 сессий</div><div class="e">за 35 сессий: ' + pct(curKm.convProb[34], 0) + '</div></div>' +
          '</div>';

        c3.render({
          n: curKm.horizons.length,
          hlines: [{ y: 0.52, color: GOLD + '99', dash: [4, 4] }],
          vlines: [{ x: Math.max(0, s3.expDays - 1), color: (curKm.passesExpiryGate ? ME : BAD) + 'cc', dash: [3, 3] }],
          series: [{ data: curKm.convProb, color: curKm.passesExpiryGate ? ME : BAD, width: 2.5 }]
        });

        el.querySelector('#tab3').innerHTML =
          '<div class="note"><b>Как читать график:</b> жёлтый пунктир (<code>52%</code>) — минимальный порог уверенности, вертикальная черта — ваша экспирация (<b>' + s3.expDays + ' дн.</b>). ' +
          (curKm.passesExpiryGate
            ? 'Кривая успевает подняться выше порога до даты истечения — горизонт позволяет спокойно отработать возврат.'
            : 'До экспирации кривая остаётся под жёлтой планкой: открывать среднесрочную сделку сейчас — значит почти наверняка застрять в принудительном ролле!') +
          '</div>';
      }
      draw3();
    }
  });

  /* ---------- 4. Пять предохранителей вокруг research-only RL ---------- */
  const s4 = { bench: true, wfo: true, costs: true, limits: true, kill: true };

  Z.push({
    id: 'rl-safeguards',
    title: 'Обучение с подкреплением (RL): почему только research-only и 5 замков',
    lead: 'Агент RL, отпущенный учиться на рыночном графике без ошейника, мгновенно изобретает «машину богатства» из микросделок на нулевой комиссии и удвоения убытков.',
    text: () => `
      <h3>Пять обязательных предохранителей вокруг RL (§4.9)</h3>
      <p>В архитектуре скринера позиция жёсткая: <b>RL никогда не ставится основным торгующим движком</b> — даже в <code>v3</code> он живёт строго в песочнице исследований с несъёмным бейджем предупреждения и пятью замками (${T('rl_safeguards', 'safeguards')}):</p>
      <ol>
        <li><b>Победа над базовой стратегией (A–G):</b> мало «заработать на бумаге» — агент обязан устойчиво обыграть прозрачный Z-score/OU вне выборки.</li>
        <li><b>Чистый Walk-Forward:</b> никаких заглядываний вперёд и пересекающихся эпох обучения.</li>
        <li><b>Все 4 слоя издержек внутри награды:</b> иначе агент крутит сотни сделок в день, собирая несуществующий полуспред.</li>
        <li><b>Внешний потолок позиции и плеча:</b> стоит снаружи нейросети, запрещая догоняться мартингейлом.</li>
        <li><b>${T('kill_switch_rl', 'Аварийный рубильник (Kill-Switch)')}:</b> мгновенное отключение при выходе просадки или оборота за допуск.</li>
      </ol>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <div style="margin-bottom:8px;padding:6px 10px;border-radius:7px;background:rgba(245,166,91,0.16);border:1px solid ${SIM};color:${GOLD};font-size:12px;font-weight:700;text-align:center">
            ⚠ ЭКСПЕРИМЕНТАЛЬНАЯ МОДЕЛЬ (RESEARCH-ONLY) — НЕДОСТАТОЧНО ДОКАЗАТЕЛЬСТВ ДЛЯ ПРОДА
          </div>
          <h4>Попробуйте отключить любой из 5 предохранителей и проверьте допуск в песочницу</h4>
          <div id="toggles4" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px;margin:8px 0 10px"></div>
          <div id="kpi4" style="margin-bottom:10px"></div>
          <div id="c4"></div>
        </div>`;

      const md = E.genMlScenario(7, E.ML_SCENARIOS[0]);
      const baseRes = E.backtestMlApproaches(md);
      const eqBase = baseRes.approaches.meta_survival.equity;
      const eqWild = baseRes.approaches.naive_rl.equity;

      const keys = [
        ['bench', '1. Обыгрывает базовую модель'],
        ['wfo', '2. Чистый Walk-Forward'],
        ['costs', '3. 4 слоя реальных издержек'],
        ['limits', '4. Внешний потолок плеча'],
        ['kill', '5. Аварийный Kill-Switch']
      ];

      el.querySelector('#toggles4').addEventListener('click', (ev) => {
        const box = ev.target.closest('[data-k]');
        if (!box) return;
        const k = box.dataset.k;
        s4[k] = !s4[k];
        draw4();
      });

      let curSim = null;
      const c4 = A.mkChart(el.querySelector('#c4'), 175, {
        tip: (i) => curSim ? '<b>День OOS #' + (i + 1) + '</b><br>' +
          '<span style="color:' + ME + '">Эталон Meta+Survival: <b>' + U.sgn(eqBase[i]) + ' п.</b></span><br>' +
          '<span style="color:' + (curSim.ok ? PRE : BAD) + '">Траектория RL-агента: <b>' + U.sgn(curSim.eq[i]) + ' п.</b></span>' : ''
      });

      function draw4() {
        const sg = E.evalRlSafeguards({
          beatsBenchmark: s4.bench, walkForwardClean: s4.wfo,
          realisticCosts: s4.costs, leverageCapped: s4.limits, killSwitchArmed: s4.kill
        });

        el.querySelector('#toggles4').innerHTML = keys.map((pair) => {
          const on = s4[pair[0]];
          return '<div data-k="' + pair[0] + '" style="cursor:pointer;padding:7px 9px;border-radius:8px;border:1px solid ' + (on ? ME : BAD) + ';background:' + (on ? 'rgba(126,224,181,0.11)' : 'rgba(255,107,107,0.14)') + ';font-size:12.5px;font-weight:600">' +
            (on ? '☑ ' : '☐ ') + pair[1] +
          '</div>';
        }).join('');

        // Наглядная траектория агента при текущей конфигурации предохранителей
        const eqRl = eqWild.map((v, idx) => {
          let val = v;
          if (s4.costs && s4.limits && s4.wfo) {
            val = eqBase[idx] * (s4.bench ? 1.03 : 0.72) - idx * 0.01;
          } else {
            const mult = (s4.limits ? 0.55 : 1.15) * (s4.costs ? 0.65 : 1.15) * (s4.wfo ? 0.85 : 1.20);
            val = v * mult;
          }
          if (s4.kill && val < -8.0) val = -8.0; // сработал аварийный рубильник Kill-Switch!
          return val;
        });
        curSim = { eq: eqRl, ok: sg.allowedInSandbox };

        el.querySelector('#kpi4').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + (sg.allowedInSandbox ? ME : BAD) + '">' + (sg.allowedInSandbox ? 'SANDBOX OK (5/5)' : 'ЗАБЛОКИРОВАНО (' + sg.passedCount + '/5)') + '</div><div class="l">статус исследовательской песочницы</div><div class="e">в прод-ядро: НИКОГДА (§4.9)</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + (eqRl[eqRl.length - 1] >= 0 ? ME : BAD) + '">' + U.sgn(eqRl[eqRl.length - 1], 1) + ' п.</div><div class="l">итог RL на живом участке</div><div class="e">' + (s4.kill && eqRl[eqRl.length - 1] === -8 ? 'спас Kill-Switch на −8,0 п.!' : 'против +' + f(eqBase[eqBase.length - 1], 1) + ' п. эталона') + '</div></div>' +
          '</div>';

        c4.render({
          n: eqBase.length,
          hlines: [
            { y: 0, color: '#ffffff22', dash: [3, 3] },
            ...(s4.kill ? [{ y: -8.0, color: GOLD + '88', dash: [4, 4] }] : [])
          ],
          series: [
            { data: eqBase, color: ME, width: 2.1 },
            { data: eqRl, color: sg.allowedInSandbox ? PRE : BAD, width: 2.2, dash: sg.allowedInSandbox ? null : [4, 3] }
          ]
        });
      }
      draw4();
    }
  });
})();
