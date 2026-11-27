/* Корзины из 3+ инструментов, экраны 1–4: экономика корзин (индекс, крэк-спред, защита от шока одной бумаги),
   множественная регрессия и идея Йохансена, ручной расчёт 2×2 с целыми лотами и исполнение в стакане (#44, #38). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, HV = window.HV;
  const Z = (window.BSCREENS = window.BSCREENS || []);
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', PRE = '#5aa9ff', GOLD = '#ffd166', PURP = '#c9b6ff';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 2 : d) + '</span>';

  /* ---------- 1. Зачем больше двух ног ---------- */
  const s1 = { shock: -30, mLegs: 3 };

  Z.push({
    id: 'why-basket',
    title: 'Зачем выходить за пределы пары: три жизненных сюжета',
    lead: 'Классическая пара сравнивает один актив с одним партнёром. Но в реальной экономике связь часто связывает сразу тройку или десяток инструментов — а опора на единственного партнёра делает стратегию заложником чужих новостей.',
    text: () => `
      <h3>Три случая, где двух ног недостаточно</h3>
      <ol>
        <li><b>${T('index_arb', 'Индекс против набора бумаг')}.</b> Фьючерс на фондовый индекс отражает сразу десяток крупнейших компаний. Одна отдельно взятая акция может отстать от индекса навсегда, а взвешенная корзина из топ-бумаг воспроизводит индекс почти один в один.</li>
        <li><b>Технологическая цепочка переработки сырья.</b> Нефтеперерабатывающий завод покупает сырую нефть и получает сразу <i>два</i> главных продукта — бензин и дизель. Летом водители раскупают бензин, зимой котельные жгут дизель и мазут: поодиночке пары «нефть − бензин» и «нефть − дизель» уплывают, а трёхногий ${T('crack_spread', 'крэк-спред 3:2:1')} (<code>2·Бензин + 1·Дизель − 3·Нефть</code>) считает реальную маржу завода. Точно так же в агросекторе работает ${T('crush_spread', 'краш-спред')} (соя против масла и шрота).</li>
        <li><b>Защита от ${T('idiosyncratic', 'аварии в одной компании')}.</b> Если вы хеджируете бумагу <code>A</code> одной-единственной бумагой <code>B</code>, внезапный судебный иск, отмена дивидендов или авария у <code>B</code> бьёт по вашему счёту в полную силу. В ${T('basket_spread', 'корзинном спреде')} из <code>m</code> бумаг отрасли удар делится в <code>m</code> раз, а случайный дневной шум бумаг гасит друг друга в <code>√m</code> раз!</li>
      </ol>
      <span class="formula">Спред корзины = A − (w₁·B₁ + w₂·B₂ + … + w<sub>m</sub>·B<sub>m</sub>)<small>сумма весов отраслевой корзины обычно близка к 1, а удар по одной бумаге режется пропорционально её доле wᵢ</small></span>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Испытание аварией: пара A − B против отраслевой корзины из m бумаг</h4>
          <p class="cap">На 140-м дне у компании B выходит тяжёлая собственная новость, хотя вся остальная отрасль и бумага A спокойны. Подвигайте размер обвала B и число бумаг m в хеджирующей корзине.</p>
          <div id="sl1a"></div>
          <div id="sl1b"></div>
          <div class="legend" style="margin-top:8px">
            <span><i style="background:${PRE}"></i>бумага A</span>
            <span><i style="background:${BAD}"></i>бумага B (попала под удар)</span>
            <span><i style="background:${GOLD}"></i>среднее остальных бумаг корзины</span>
          </div>
          <div id="c1a"></div>
          <div class="legend" style="margin-top:10px">
            <span><i style="background:${BAD}"></i>простая пара: A − B</span>
            <span><i style="background:${ME}"></i>корзина: A − (B₁ + … + Bₘ) ÷ m</span>
          </div>
          <div id="c1b"></div>
          <div id="k1" style="margin-top:10px"></div>
        </div>`;

      HV.slider(el.querySelector('#sl1a'), {
        label: 'Индивидуальный обвал бумаги B на 140-м дне', min: -45, max: 0, step: 5, value: s1.shock,
        fmt: (v) => U.sgn(v, 0) + ' п.',
        onInput: (v) => { s1.shock = v; draw1(); }
      });
      HV.slider(el.querySelector('#sl1b'), {
        label: 'Число бумаг m в хеджирующей корзине (включая B)', min: 1, max: 6, step: 1, value: s1.mLegs,
        fmt: (v) => v === 1 ? '1 бумага (обычная пара A − B)' : v + ' бумаги (доля B = ' + Math.round(100 / v) + '%)',
        onInput: (v) => { s1.mLegs = v; draw1(); }
      });

      const c1a = A.mkChart(el.querySelector('#c1a'), 155, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>A: <b>' + f(last1.a[i]) + '</b> · B: <b style="color:' + BAD + '">' + f(last1.b[i]) + '</b> · остальные: ' + f(last1.rest[i])
      });
      const c1b = A.mkChart(el.querySelector('#c1b'), 160, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>пара A − B: <b style="color:' + BAD + '">' + U.sgn(last1.pair[i]) + ' п.</b><br>корзина (m = ' + s1.mLegs + '): <b style="color:' + ME + '">' + U.sgn(last1.bask[i]) + ' п.</b>'
      });
      let last1 = {};

      function draw1() {
        const rng = E.mulberry32(7 * 31 + 5);
        const n = 240, a = [], b = [], rest = [], pair = [], bask = [];
        let sec = 100, u = 0;
        const g = () => {
          let u1 = 0, v1 = 0, s = 0;
          do { u1 = rng() * 2 - 1; v1 = rng() * 2 - 1; s = u1 * u1 + v1 * v1; } while (s >= 1 || s === 0);
          return u1 * Math.sqrt(-2 * Math.log(s) / s);
        };
        for (let t = 0; t < n; t++) {
          if (t > 0) sec += 1.1 * g();
          u = 0.72 * u + 1.2 * g();
          const sh = t >= 139 ? s1.shock * Math.min(1, (t - 138) / 8) : 0;
          const at = sec + u;
          const bt = sec + 1.3 * g() + sh;
          let sumOther = 0;
          const mOther = Math.max(1, s1.mLegs - 1);
          for (let k = 0; k < mOther; k++) sumOther += sec + 1.3 * g();
          const avgOther = sumOther / mOther;
          const basketPrice = s1.mLegs === 1 ? bt : (bt + (s1.mLegs - 1) * avgOther) / s1.mLegs;
          a.push(E.round2(at)); b.push(E.round2(bt)); rest.push(E.round2(avgOther));
          pair.push(E.round2(at - bt));
          bask.push(E.round2(at - basketPrice));
        }
        last1 = { a, b, rest, pair, bask };

        c1a.render({
          n, spans: [{ i0: 139, i1: n - 1, color: '#ff6b6b14' }],
          series: [
            { data: rest, color: GOLD, width: 1.4, dash: [4, 3] },
            { data: b, color: BAD, width: 1.7 },
            { data: a, color: PRE, width: 1.8 }
          ]
        });
        c1b.render({
          n, spans: [{ i0: 139, i1: n - 1, color: '#ff6b6b14' }],
          hlines: [{ y: 0, color: '#ffffff30', dash: [3, 3] }],
          series: [
            { data: pair, color: BAD, width: 1.5, dash: [4, 3] },
            { data: bask, color: ME, width: 2.0 }
          ]
        });

        const jumpPair = -s1.shock;
        const jumpBasket = -s1.shock / s1.mLegs;
        el.querySelector('#k1').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + BAD + '">' + U.sgn(jumpPair, 1) + ' п.</div><div class="l">перекос пары A − B</div><div class="e">100% удара B ложится на вас</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + ME + '">' + U.sgn(jumpBasket, 1) + ' п.</div><div class="l">перекос корзины (m = ' + s1.mLegs + ')</div><div class="e">в ' + s1.mLegs + '× мягче простого хеджа</div></div>' +
            '<div class="kpi"><div class="v">÷ ' + f(Math.sqrt(s1.mLegs), 2) + '</div><div class="l">сжатие шума хеджа</div><div class="e">случайные рывки бумаг гасят друг друга</div></div>' +
          '</div>';
      }
      draw1();
    }
  });

  /* ---------- 2. Множественная регрессия, два ветра и идея Йохансена ---------- */
  const s2 = { w1: 0.6, w2: 0.0 };

  Z.push({
    id: 'weights-johansen',
    title: 'Как подобрать веса: два ветра, регрессия и идея Йохансена',
    lead: 'В динамическом хедже мы подбирали один наклон k. Когда инструментов три и больше, мы решаем ту же задачу сразу для нескольких весов — чтобы одним махом обнулить все общие рыночные тренды.',
    text: () => `
      <h3>Зачем нужны две «ручки» вместо одной</h3>
      <p>Представьте, что цены на рынке двигают сразу <b>два независимых ветра</b> — например, мировая цена сырой нефти и сезонный перекос спроса между бензином и дизелем:</p>
      <ul>
        <li>Если составить пару только из двух контрактов (<code>A − k·B</code>), у вас есть всего один рычажок <code>k</code>. Подкрутив его, вы погасите первый ветер — но второй останется неприкрытым и утащит спред в безоткатный тренд!</li>
        <li>Добавив третий контракт (<code>A − w₁·B − w₂·C</code>), вы получаете <b>два уравнения с двумя неизвестными</b>. ${T('mult_ols', 'Множественная линейная регрессия')} подбирает пару весов <code>(w₁, w₂)</code> так, чтобы <b>оба ветра одновременно обратились в ноль</b>, а в остатке качалась чистая «резинка».</li>
      </ul>
      <h3>В чём ${T('johansen', 'идея метода Йохансена')} и ${T('pca_factors', 'главных компонент')}</h3>
      <p>У обычной регрессии есть особенность: нужно заранее решить, какую бумагу поставить слева от знака равно (<code>A</code> через <code>B, C</code> или <code>B</code> через <code>A, C</code>). Метод Йохансена смотрит на всю тройку симметрично и считает <b>число независимых «резинок»</b> внутри набора:</p>
      <ul>
        <li><b>0 резинок</b> — все три цены гуляют сами по себе, торговать нечего.</li>
        <li><b>1 резинка</b> — у трёх бумаг два общих ветра; существует ровно одна пропорция корзины <code>A − w₁B − w₂C</code>, которая их гасит (попробуйте нащупать её ползунками справа!).</li>
        <li><b>2 резинки</b> — все три бумаги ходят за <i>одним-единственным</i> общим ветром: тогда стационарна и пара <code>A − B</code>, и пара <code>A − C</code>, и любая их смесь!</li>
      </ul>`,
    mount(el) {
      const bk = E.genBasketScenario(7, E.BASKET_SCENARIOS[0]);
      const fitOpt = E.olsMulti(bk.a, [bk.b, bk.c]);
      const fitPair = E.olsMulti(bk.a, [bk.b]);

      el.innerHTML = `
        <div class="viz">
          <h4>Песочница двух ветров: обнулите оба тренда ползунками w₁ и w₂</h4>
          <p class="cap">Истинная природа ряда здесь: A ≈ 10 + 1,20·B + 0,60·C + шум. Попробуйте сначала оставить w₂ = 0 (обычная пара), а затем нажмите кнопку точной регрессии.</p>
          <div class="btns" id="b2" style="margin:0 0 10px">
            <button class="b" id="b2pair">Лучшая пара (w₂ = 0)</button>
            <button class="b" id="b2eq">Поровну (0,50 и 0,50)</button>
            <button class="b primary" id="b2ols">Найти веса регрессией МНК</button>
          </div>
          <div id="sl2a"></div>
          <div id="sl2b"></div>
          <div id="k2" style="margin-top:10px"></div>
        </div>
        <div class="viz">
          <h4>Что остаётся после вычитания корзины</h4>
          <div class="legend">
            <span><i style="background:${BAD}"></i>лучшая пара A − k·B (второй ветер не погашен!)</span>
            <span><i style="background:${ME}"></i>ваша корзина A − w₁·B − w₂·C</span>
          </div>
          <div id="c2"></div>
        </div>`;

      let slA, slB;
      function makeSliders() {
        el.querySelector('#sl2a').innerHTML = '';
        el.querySelector('#sl2b').innerHTML = '';
        slA = HV.slider(el.querySelector('#sl2a'), {
          label: 'Вес первого партнёра w₁ (контракт B)', min: 0, max: 2, step: 0.05, value: s2.w1,
          fmt: (v) => f(v, 2),
          onInput: (v) => { s2.w1 = v; draw2(); }
        });
        slB = HV.slider(el.querySelector('#sl2b'), {
          label: 'Вес второго партнёра w₂ (контракт C)', min: -0.5, max: 1.5, step: 0.05, value: s2.w2,
          fmt: (v) => f(v, 2),
          onInput: (v) => { s2.w2 = v; draw2(); }
        });
      }

      el.querySelector('#b2pair').addEventListener('click', () => {
        s2.w1 = Math.round(fitPair.weights[0] * 20) / 20; s2.w2 = 0; makeSliders(); draw2();
      });
      el.querySelector('#b2eq').addEventListener('click', () => {
        s2.w1 = 0.5; s2.w2 = 0.5; makeSliders(); draw2();
      });
      el.querySelector('#b2ols').addEventListener('click', () => {
        s2.w1 = Math.round(fitOpt.weights[0] * 20) / 20; s2.w2 = Math.round(fitOpt.weights[1] * 20) / 20; makeSliders(); draw2();
      });

      const pairCentered = bk.a.map((v, i) => v - fitPair.c - fitPair.weights[0] * bk.b[i]);
      const c2 = A.mkChart(el.querySelector('#c2'), 210, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>пара A − kB: <b style="color:' + BAD + '">' + U.sgn(pairCentered[i]) + '</b><br>ваша корзина: <b style="color:' + ME + '">' + U.sgn(cur2[i]) + '</b>'
      });
      let cur2 = [];

      function draw2() {
        const raw = bk.a.map((v, i) => v - s2.w1 * bk.b[i] - s2.w2 * bk.c[i]);
        const m = raw.reduce((s, x) => s + x, 0) / raw.length;
        cur2 = raw.map((x) => E.round2(x - m));
        const sd = Math.sqrt(cur2.reduce((s, x) => s + x * x, 0) / cur2.length);
        const df = E.dfTest(cur2);

        // Остаточная чувствительность к двум ветрам: B = F1 + 0.9*F2, C = F1 - 0.9*F2, A = 1.8*F1 + 0.54*F2
        const remWind1 = 1.8 - (s2.w1 + s2.w2);
        const remWind2 = 0.54 - 0.9 * (s2.w1 - s2.w2);

        el.querySelector('#k2').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + (Math.abs(remWind1) < 0.12 ? ME : SIM) + '">' + U.sgn(remWind1, 2) + '</div><div class="l">остаток Ветра 1</div><div class="e">цель: около 0,00</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + (Math.abs(remWind2) < 0.12 ? ME : BAD) + '">' + U.sgn(remWind2, 2) + '</div><div class="l">остаток Ветра 2</div><div class="e">цель: около 0,00</div></div>' +
            '<div class="kpi"><div class="v">' + f(sd, 2) + ' п.</div><div class="l">разброс σ корзины</div><div class="e">чем меньше, тем ровнее</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + (df && df.tau <= -3.74 ? ME : BAD) + '">' + (df ? f(df.tau, 2) : '—') + '</div><div class="l">τ-статистика</div><div class="e">порог 3 ног ≤ −3,74</div></div>' +
          '</div>';

        c2.render({
          n: cur2.length,
          hlines: [{ y: 0, color: '#ffffff30', dash: [3, 3] }],
          series: [
            { data: pairCentered, color: BAD, width: 1.4, dash: [4, 3] },
            { data: cur2, color: ME, width: 2.0 }
          ]
        });
      }
      makeSliders();
      draw2();
    }
  });

  /* ---------- 3. Ручной расчёт на 6 днях и округление до целых контрактов ---------- */
  const SAMPLES3 = [
    { name: 'Пропорция 2:1 (как в крэк-спреде)', A: [110, 114, 113, 119, 116, 122], B: [100, 106, 102, 110, 108, 114], C: [98, 96, 103, 102, 99, 105] },
    { name: 'Отраслевая корзина (почти поровну)', A: [105, 108, 104, 112, 111, 116], B: [96, 101, 95, 104, 100, 108], C: [94, 95, 93, 100, 102, 104] },
    { name: 'Асимметричные веса (1,25 и 0,40)', A: [172, 179, 173, 188, 184, 194], B: [100, 106, 101, 111, 108, 115], C: [95, 92, 96, 99, 101, 103] }
  ];
  const s3 = { idx: 0, maxA: 5 };

  Z.push({
    id: 'manual-lots',
    title: 'Ручной расчёт весов на 6 днях и целые лоты',
    lead: 'Никакой «чёрной магии»: для трёх инструментов множественная регрессия сводится к обычной школьной системе из двух линейных уравнений с двумя неизвестными.',
    text: () => `
      <h3>Как посчитать w₁ и w₂ на листке бумаги</h3>
      <ol>
        <li><b>Вычитаем средние.</b> Для каждого из трёх рядов считаем среднюю цену за окно (<code>Ā, B̄, C̄</code>) и переходим к отклонениям от среднего: <code>a = A − Ā</code>, <code>b = B − B̄</code>, <code>c = C − C̄</code>.</li>
        <li><b>Считаем пять сумм произведений.</b> Складываем по всем дням окна: <code>Σb²</code>, <code>Σc²</code>, <code>Σ(b·c)</code>, <code>Σ(b·a)</code> и <code>Σ(c·a)</code>.</li>
        <li><b>Решаем систему 2×2.</b> Два нормальных уравнения регрессии выглядят ровно как в 8-м классе:</li>
      </ol>
      <span class="formula">w₁·Σb² + w₂·Σ(b·c) = Σ(b·a)<br>w₁·Σ(b·c) + w₂·Σc² = Σ(c·a)<small>определитель D = Σb²·Σc² − (Σbc)²; отсюда w₁ = (Σba·Σc² − Σca·Σbc) ÷ D, w₂ = (Σb²·Σca − Σba·Σbc) ÷ D</small></span>
      <h3>От дробных весов к целым фьючерсам</h3>
      <p>На бирже нельзя продать <code>0,67</code> фьючерса на бензин и <code>0,33</code> на дизель. Поэтому мы умножаем всю тройку <code>(1 : w₁ : w₂)</code> на небольшое целое число <code>q<sub>A</sub></code> и округляем партнёров до целых контрактов — так знаменитая дробь <code>(1 : 0,67 : 0,33)</code> превращается в классический пакет <b>3 : 2 : 1</b>!</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Пример из 6 дней и лимит масштаба пакета</h4>
          <div class="btns" id="b3" style="margin:0 0 10px"></div>
          <div id="sl3"></div>
          <table class="t" id="raw3" style="margin-top:10px"></table>
        </div>
        <div class="viz">
          <h4>Пошаговое решение системы 2×2 и подбор целых лотов</h4>
          <div class="calc-steps" id="steps3"></div>
        </div>`;

      const bEl = el.querySelector('#b3');
      bEl.innerHTML = SAMPLES3.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      bEl.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (b) { s3.idx = +b.dataset.i; draw3(); }
      });
      HV.slider(el.querySelector('#sl3'), {
        label: 'Максимум контрактов A в одном пакете (q_A)', min: 1, max: 10, step: 1, value: s3.maxA,
        fmt: (v) => 'до ' + v + ' лотов A',
        onInput: (v) => { s3.maxA = v; draw3(); }
      });

      function draw3() {
        bEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s3.idx));
        const sm = SAMPLES3[s3.idx], n = sm.A.length;
        const mA = sm.A.reduce((s, x) => s + x, 0) / n;
        const mB = sm.B.reduce((s, x) => s + x, 0) / n;
        const mC = sm.C.reduce((s, x) => s + x, 0) / n;

        let sBB = 0, sCC = 0, sBC = 0, sBA = 0, sCA = 0;
        const rows = [];
        for (let i = 0; i < n; i++) {
          const da = sm.A[i] - mA, db = sm.B[i] - mB, dc = sm.C[i] - mC;
          sBB += db * db; sCC += dc * dc; sBC += db * dc; sBA += db * da; sCA += dc * da;
          rows.push({ i: i + 1, A: sm.A[i], B: sm.B[i], C: sm.C[i], da, db, dc });
        }
        const D = sBB * sCC - sBC * sBC;
        const fit = E.olsMulti(sm.A, [sm.B, sm.C]);
        const w1 = fit.weights[0], w2 = fit.weights[1], c0 = fit.c;
        const lots = E.roundBasketLots([w1, w2], s3.maxA);

        el.querySelector('#raw3').innerHTML =
          '<tr><th>День</th><th>A</th><th>B</th><th>C</th><th>a = A − Ā</th><th>b = B − B̄</th><th>c = C − C̄</th><th>Остаток e</th></tr>' +
          rows.map((r, idx) => '<tr><td>' + r.i + '</td><td>' + r.A + '</td><td>' + r.B + '</td><td>' + r.C + '</td><td>' + U.sgn(r.da, 2) + '</td><td>' + U.sgn(r.db, 2) + '</td><td>' + U.sgn(r.dc, 2) + '</td><td>' + col(fit.resid[idx], 2) + '</td></tr>').join('');

        el.querySelector('#steps3').innerHTML = `
          <div class="row"><div class="n">1</div><div><b>Средние значения за 6 дней</b><div class="v">Ā = ${f(mA)} · B̄ = ${f(mB)} · C̄ = ${f(mC)}</div></div></div>
          <div class="row"><div class="n">2</div><div><b>Пять сумм квадратов и произведений отклонений</b><div class="v">Σb² = ${f(sBB)} · Σc² = ${f(sCC)} · Σ(bc) = ${f(sBC)} · Σ(ba) = ${f(sBA)} · Σ(ca) = ${f(sCA)}</div></div></div>
          <div class="row"><div class="n">3</div><div><b>Решаем систему 2×2 (определитель D = ${f(sBB)}·${f(sCC)} − (${f(sBC)})² = ${f(D)})</b><div class="v">w₁ = <b>${f(w1, 3)}</b> · w₂ = <b>${f(w2, 3)}</b> · сдвиг c = Ā − w₁B̄ − w₂C̄ = <b>${f(c0, 2)}</b> (R² = ${f(fit.r2, 3)})</div></div></div>
          <div class="row"><div class="n">4</div><div><b>Перевод в целые фьючерсные лоты</b> (при лимите q<sub>A</sub> ≤ ${s3.maxA})<div class="v">Берём <b>${lots.qA} лота A</b> против <b>${lots.qs[0]} лотов B</b> и <b>${lots.qs[1]} лотов C</b> (всего ${lots.totalLots} контр. в пакете; реальная пропорция ${f(lots.approx[0], 2)} и ${f(lots.approx[1], 2)}, макс. ошибка веса ${f(lots.maxErr, 3)})</div></div></div>`;
      }
      draw3();
    }
  });

  /* ---------- 4. Исполнение нескольких ног в стакане ---------- */
  const s4 = { legs: 4, halfSpread: 0.18, slipThin: 0.45, grossMove: 2.6 };

  Z.push({
    id: 'execution-legs',
    title: 'Исполнение в стакане: накопление комиссий и тонкая нога',
    lead: 'На бумаге корзина из шести инструментов всегда глаже обычной пары. Но в живом биржевом стакане каждая лишняя нога — это ещё одна очередь заявок, ещё одна комиссия и шанс застрять с «недособранным» пакетом.',
    text: () => `
      <h3>Почему слишком большие корзины съедают сами себя</h3>
      <p>Чтобы войти и выйти из корзины на <code>M</code> ногах, нужно пересечь или отработать в стакане <b>2 × M заявок</b>. Если на каждой ноге вы отдаёте бирже и маркет-мейкеру хотя бы по четверти пункта, на шести ногах набегает уже полтора-два пункта прямых трений — и тонкая статистическая аномалия уходит в минус после издержек.</p>
      <h3>${T('legging', 'Риск недособранной корзины')} и ${T('illiquid_first', 'правило «сначала тонкий стакан»')}</h3>
      <p>В корзине почти всегда есть «быстрые» ноги с глубоким стаканом (фьючерс на индекс, нефть, Сбербанк) и «узкие» ноги, где в первой строке стоит всего несколько лотов. Здесь действуют два практических правила:</p>
      <ul>
        <li><b>Никогда не бить рыночными заявками во все ноги разом</b>, если среди них есть неликвидная бумага — вы сами раздвинете её стакан против себя.</li>
        <li><b>Начинать сборку с самой капризной (менее ликвидной) ноги</b> аккуратной лимитной заявкой, и лишь в ту долю секунды, когда по ней прошла сделка, мгновенно закрывать ликвидные ноги в глубоких стаканах.</li>
      </ul>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Калькулятор трений многоногой сделки: сколько останется от грязной прибыли?</h4>
          <div id="sl4a"></div>
          <div id="sl4b"></div>
          <div id="sl4c"></div>
          <div id="sl4d"></div>
          <div id="svg4" style="margin-top:12px"></div>
          <table class="t" id="tab4" style="margin-top:10px"></table>
          <div id="note4" class="note" style="margin-top:10px"></div>
        </div>`;

      HV.slider(el.querySelector('#sl4a'), {
        label: 'Число инструментов M в корзине', min: 2, max: 8, step: 1, value: s4.legs,
        fmt: (v) => v + ' ног (' + (v * 2) + ' сделок на круг вход + выход)',
        onInput: (v) => { s4.legs = v; draw4(); }
      });
      HV.slider(el.querySelector('#sl4b'), {
        label: 'Грязное схождение спреда за сделку', min: 1.0, max: 5.0, step: 0.2, value: s4.grossMove,
        fmt: (v) => '+' + f(v, 1) + ' п.',
        onInput: (v) => { s4.grossMove = v; draw4(); }
      });
      HV.slider(el.querySelector('#sl4c'), {
        label: 'Комиссия + полспреда ликвидной ноги (на круг)', min: 0.05, max: 0.45, step: 0.05, value: s4.halfSpread,
        fmt: (v) => f(v, 2) + ' п. на ногу',
        onInput: (v) => { s4.halfSpread = v; draw4(); }
      });
      HV.slider(el.querySelector('#sl4d'), {
        label: 'Доп. проскальзывание при ударе «по рынку» в тонкие ноги', min: 0.1, max: 1.0, step: 0.05, value: s4.slipThin,
        fmt: (v) => f(v, 2) + ' п. на каждую тонкую ногу',
        onInput: (v) => { s4.slipThin = v; draw4(); }
      });

      function draw4() {
        const M = s4.legs;
        const thinCnt = Math.max(1, Math.floor(M / 2));
        // Веса корзины нормированы так, что суммарный оборот пакета растёт умеренно с числом ног: 1 нога A + (M-1) ног с суммой весов ~1.2, но у каждой есть минимальный лот и фикс. накладные
        const baseFriction = (1 + 0.32 * (M - 1)) * 2 * s4.halfSpread;
        const marketPenalty = thinCnt * s4.slipThin;
        const smartPenalty = thinCnt * s4.slipThin * 0.22; // лимитный вход в тонкую ногу экономит львиную долю сдвига стакана

        const netMarket = s4.grossMove - baseFriction - marketPenalty;
        const netSmart = s4.grossMove - baseFriction - smartPenalty;

        const W = 560, H = 118, scale = 82;
        const bar = (y, label, val, color) => {
          const zeroX = 210;
          const w = Math.min(320, Math.abs(val) * scale);
          const x = val >= 0 ? zeroX : zeroX - w;
          return `<text x="12" y="${y + 15}" fill="var(--text-2)" font-size="12.5">${label}</text>` +
            `<rect x="${x}" y="${y}" width="${Math.max(2, w)}" height="20" rx="4" fill="${color}"/>` +
            `<text x="${val >= 0 ? x + w + 8 : x - 8}" y="${y + 15}" text-anchor="${val >= 0 ? 'start' : 'end'}" fill="${color}" font-size="12.5" font-weight="600">${U.sgn(val, 2)} п.</text>`;
        };

        el.querySelector('#svg4').innerHTML = `
          <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;background:var(--surface-inset);border:1px solid var(--line);border-radius:10px;display:block">
            <line x1="210" y1="10" x2="210" y2="108" stroke="#ffffff33" stroke-dasharray="3,3"/>
            ${bar(14, 'Грязный ход спреда', s4.grossMove, PRE)}
            ${bar(46, 'Удар «по рынку» во все ' + M + ' ног', netMarket, netMarket >= 0 ? SIM : BAD)}
            ${bar(78, 'Сначала лимитная в тонкую ногу', netSmart, netSmart >= 0 ? ME : BAD)}
          </svg>`;

        el.querySelector('#tab4').innerHTML =
          '<tr><th>Способ сборки ' + M + ' ног</th><th>Базовые трения стаканов</th><th>Потери на тонких ногах (' + thinCnt + ' шт.)</th><th>Чистый итог на сделку</th></tr>' +
          '<tr><td>Одновременно рыночными заявками</td><td>−' + f(baseFriction) + ' п.</td><td class="neg">−' + f(marketPenalty) + ' п.</td><td><b>' + col(netMarket) + ' п.</b></td></tr>' +
          '<tr><td>Лимитная в тонкую ногу → добор ликвидных</td><td>−' + f(baseFriction) + ' п.</td><td class="warn">−' + f(smartPenalty) + ' п.</td><td><b>' + col(netSmart) + ' п.</b></td></tr>';

        const nEl = el.querySelector('#note4');
        if (netSmart <= 0) {
          nEl.className = 'note bad';
          nEl.innerHTML = '<b>Корзина слишком громоздкая для такого хода!</b> При ' + M + ' ногах суммарные комиссии и спреды съели весь грязный потенциал (+' + f(s4.grossMove, 1) + ' п.). Либо сокращайте корзину до 3–4 самых ликвидных бумаг, либо входите только на более широких отклонениях.';
        } else if (netMarket < 0 && netSmart > 0) {
          nEl.className = 'note warn';
          nEl.innerHTML = '<b>Исполнение решает исход стратегии:</b> грубый вход «по рынку» во все ' + M + ' стаканов даёт убыток <b>' + U.sgn(netMarket) + ' п.</b>, а грамотная сборка от тонкой ноги к ликвидным оставляет чистую прибыль <b>+' + f(netSmart) + ' п.</b>!';
        } else {
          nEl.className = 'note';
          nEl.innerHTML = 'Экономия на грамотной очерёдности ног составляет <b>+' + f(netSmart - netMarket) + ' п.</b> на каждой сделке — за сотню сделок в год это часто больше половины всей чистой прибыли.';
        }
      }
      draw4();
    }
  });
})();
