/* Микроструктура срочного рынка MOEX, экраны 1–4: Spectra 9.3 и вечерний клиринг SP,
   формула вариационной маржи через W/R и пары full/mini, вечные фьючерсы со SwapRate и дивгэпами,
   нативный стакан календарного спреда против леггирования (#54, #46). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, HV = window.HV;
  const Z = (window.MXSCREENS = window.MXSCREENS || []);
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', PRE = '#5aa9ff', GOLD = '#ffd166', PURP = '#c9b6ff';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 2 : d) + '</span>';

  /* ---------- 1. Spectra 9.3, вечерний клиринг SP и выходные ---------- */
  const s1 = { dailyRate: 0.18, daysHeld: 5 };

  Z.push({
    id: 'clearing-vm',
    title: 'Единая сессия MOEX, вечерний клиринг SP и выходные',
    lead: 'В учебниках спред считают по абстрактным «ценам закрытия». На реальном срочном рынке MOEX (FORTS) деньги списываются и зачисляются строго по расчётным ценам вечернего клиринга — а пятница и выходные меняют ритм переноса.',
    text: () => `
      <h3>Как устроен торговый день в ${T('spectra_session', 'Spectra 9.3')}</h3>
      <p>Торги на срочном рынке МосБиржи делятся на <b>утреннюю сессию</b> (09:00–10:00), <b>основную</b> (10:00–18:50) с ${T('interm_clearing', 'промежуточным дневным клирингом 14:00–14:05')}, затем проходит главный <b>вечерний клиринг</b> (18:50–19:05), после чего стартует <b>вечерняя сессия</b> (19:05–23:50) уже следующего расчётного дня!</p>
      <ul>
        <li><b>Дневная пауза 14:00–14:05:</b> на пять минут торги замирают, НКЦ пересчитывает внутридневную вариационную маржу, обновляет базовое ГО и при сильном движении расширяет ценовые планки — алгоритм исполнения обязан ставить отправку ордеров на паузу вокруг клиринговых окон.</li>
        <li><b>${T('settlement_sp', 'Расчётная цена SP')} против «последней сделки 23:49».</b> На тонкой вечерней сессии перед 23:50 одиночная рыночная заявка легко дёргает последнюю цену в сторону. Но бухгалтерия клиринга считает ${T('var_margin', 'вариационную маржу')} строго по официальной расчётной цене <code>SP</code> (в 14:00 и 18:50), поэтому бэктест по «закрытию 23:50» ловит фантомные иголки тонкого стакана!</li>
        <li><b>Ловушка выходных и праздников (начисляемое финансирование против цены фьючерса).</b> Финансирование вечных фьючерсов (<code>SwapRate</code>), ставка репо по шорту акций и овернайт капают по <i>календарным</i> суткам, а клиринг проходит только в <i>торговые</i> дни — поэтому между пятницей и понедельником (или через длинные праздники) списывается сразу <b>3–10 суток финансирования одним куском</b>. У обычного же срочного фьючерса (<code>Si</code>, <code>MIX</code>) отдельной строки за выходные в отчёте нет: его перенос вшит прямо в рыночную цену с учётом даты расчётов <code>T+1</code> и в понедельник сливается с общим движением рынка!</li>
      </ul>`,
    mount(el) {
      const mx = E.genMoexScenario(7, E.MOEX_SCENARIOS[2]);
      el.innerHTML = `
        <div class="viz">
          <h4>Неделя клирингов: почему понедельник весит как три будних дня</h4>
          <div id="sl1a"></div>
          <div id="sl1b"></div>
          <table class="t" id="tab1" style="margin-top:10px"></table>
        </div>
        <div class="viz">
          <h4>Прострелы последней сделки 23:49 против честной цены клиринга SP</h4>
          <div class="legend">
            <span><i style="background:${BAD}"></i>последняя сделка 23:49 (шум тонкого стакана)</span>
            <span><i style="background:${ME}"></i>расчётная цена вечернего клиринга SP</span>
          </div>
          <div id="c1"></div>
        </div>`;

      HV.slider(el.querySelector('#sl1a'), {
        label: 'Суточная ставка переноса / финансирования (на 1 календарный день)', min: 0.05, max: 0.40, step: 0.01, value: s1.dailyRate,
        fmt: (v) => f(v, 2) + ' п./сутки (' + Math.round(v * 100) + ' ₽)',
        onInput: (v) => { s1.dailyRate = v; draw1(); }
      });
      HV.slider(el.querySelector('#sl1b'), {
        label: 'Длительность выходных / праздников подряд', min: 2, max: 9, step: 1, value: s1.daysHeld,
        fmt: (v) => (v - 1) + ' неторговых дня → первый клиринг за ' + v + ' суток сразу!',
        onInput: (v) => { s1.daysHeld = v; draw1(); }
      });

      const c1 = A.mkChart(el.querySelector('#c1'), 195, {
        tip: (i) => '<b>Торговый день ' + (i + 1) + '</b>' +
          '<br>по последней сделке 23:49: <b style="color:' + BAD + '">' + f(mx.lastRaw[i]) + ' п.</b>' +
          '<br>по вечернему клирингу SP: <b style="color:' + ME + '">' + f(mx.spRaw[i]) + ' п.</b>'
      });
      c1.render({
        n: mx.spRaw.length, x0: 0, x1: 120,
        series: [
          { data: mx.lastRaw, color: BAD, width: 1.25 },
          { data: mx.spRaw, color: ME, width: 2.0 }
        ]
      });

      function draw1() {
        const d = s1.dailyRate, g = s1.daysHeld;
        const rows = [
          ['Вторник (будний клиринг)', 1, d * 1, d * 1],
          ['Среда (будний клиринг)', 1, d * 2, d * 1],
          ['Четверг (будний клиринг)', 1, d * 3, d * 1],
          ['Пятница (вечерний клиринг)', 1, d * 4, d * 1],
          ['Выходные / праздники (' + (g - 1) + ' дн.)', 0, d * 4, 0],
          ['Первый торговый день после паузы', g, d * (4 + g), d * g]
        ];
        el.querySelector('#tab1').innerHTML =
          '<tr><th>День</th><th>Календарных суток в клиринге</th><th>Списание в этот вечер</th><th>Накоплено с начала</th></tr>' +
          rows.map((r, i) => '<tr' + (i === 5 ? ' class="sel"' : '') + '><td>' + (i === 5 ? '<b>' + r[0] + '</b>' : r[0]) + '</td><td>' + r[1] + '</td><td style="color:' + (r[3] > d * 1.5 ? GOLD : '#cdd7e8') + '">' + (r[3] ? '−' + f(r[3]) + ' п. (' + Math.round(r[3] * 100) + ' ₽)' : '0 (клиринга нет)') + '</td><td>−' + f(r[2]) + ' п.</td></tr>').join('');
      }
      draw1();
    }
  });

  /* ---------- 2. Паспорт контракта: формула VM через W/R и связки full / mini ---------- */
  const PAIRS2 = [
    {
      name: 'MIX (полный) против MXI (мини-индекс)',
      aName: 'MIX (полный индекс)', aSp0: 285000, aSp1: 291000, aR: 25, aW: 25, aNom: 285000,
      bName: 'MXI (мини-индекс)', bSp0: 2850, bSp1: 2910, bR: 0.05, bW: 0.5, bNom: 28500,
      note: 'В полном MIX зашит множитель 1 ₽ за пункт котировки (285 000 ₽), а в рублёвом мини-контракте MXI шаг 0,05 п. стоит 0,50 ₽ (W/R = 10 ₽ за 1 п. индекса, номинал 28 500 ₽ — ровно в 10 раз меньше!).'
    },
    {
      name: 'Квартальный Si против вечного USDRUBF',
      aName: 'Si (за 1 000 $)', aSp0: 91500, aSp1: 93000, aR: 1, aW: 1, aNom: 91500,
      bName: 'USDRUBF (котировка за 1 $)', bSp0: 90.20, bSp1: 91.70, bR: 0.01, bW: 10, bNom: 90200,
      note: 'Котировки отличаются в 1 000 раз (91 500 против 90,20), но у USDRUBF шаг R = 0,01 стоит W = 10 ₽, то есть W/R = 1 000 ₽! Оба контракта несут ровно по 1 000 $ и берутся 1 к 1.'
    },
    {
      name: 'Два фьючерса на акции с разным лотом (100 и 10 акций)',
      aName: 'Фьючерс А (100 акций)', aSp0: 24000, aSp1: 25200, aR: 1, aW: 1, aNom: 24000,
      bName: 'Фьючерс Б (10 акций)', bSp0: 8000, bSp1: 8400, bR: 1, bW: 1, bNom: 8000,
      note: 'Даже когда у обоих контрактов W/R = 1 ₽, номинал лота А втрое крупнее лота Б (24 000 ₽ против 8 000 ₽): для денежной нейтральности на 1 лот А нужно 3 лота Б.'
    }
  ];
  const s2 = { idx: 0, movePct: 3 };

  Z.push({
    id: 'contract-econ',
    title: 'Паспорт контракта: формула VM = (SP₁ − SP₀) × (W ÷ R) и full / mini',
    lead: 'На графике терминала два инструмента могут выглядеть одинаково, но приносить в пять или десять раз разное число рублей на каждый шаг цены. Без чтения спецификации контракта любой хедж окажется перекошенным.',
    text: () => `
      <h3>Главная формула срочного рынка</h3>
      <p>В спецификации каждого фьючерса на сайте биржи указаны ${T('tick_econ', 'шаг цены R и стоимость шага W')}, а также ${T('contract_mult', 'мультипликатор контракта')}. Ежедневная вариационная маржа на один лот считается по точной формуле:</p>
      <span class="formula">VM = (SP₁ − SP₀) × (W ÷ R)<small>пример USDRUBF: цена выросла с 90,20 до 91,45 (+1,25), R = 0,01, W = 10 ₽ → VM = 1,25 × (10 ÷ 0,01) = +1 250 ₽</small></span>
      <h3>Ловушка связок ${T('full_mini', 'full / mini')} и разных единиц котировки</h3>
      <ul>
        <li><b>Разные котировки при одинаковом лоте:</b> квартальный <code>Si</code> котируется в рублях за 1 000 $ (около 91 500), а вечный <code>USDRUBF</code> — за 1 $ (около 90,20). Но отношение <code>W ÷ R</code> у <code>USDRUBF</code> равно <code>10 ÷ 0,01 = 1 000 ₽</code>, поэтому их рублёвые номиналы равны и хеджируются <b>1 : 1</b>!</li>
        <li><b>Одинаковый индекс при разном мультипликаторе:</b> если продать 1 полный контракт <code>MIX</code> и купить всего 1 мини-контракт <code>MXI</code>, <b>90% вашей позиции останется вообще без защиты</b> — для ровного хеджа нужно <b>1 MIX против 10 MXI</b>!</li>
        <li><b>${T('physical_delivery', 'Поставочные (SR, GZ, LK) против расчётных (Si, MIX, BR)')}:</b> валютные, индексные и товарные фьючерсы на MOEX — <i>расчётные</i> (закрываются деньгами), а большинство фьючерсов на российские акции — <i>поставочные</i>! Удержите такой контракт до экспирации — и выйдет поставка реальных лотов акций на фондовой секции (или принудительное закрытие брокером накануне).</li>
        <li><b>${T('price_limits', 'Ценовые коридоры («планки» НКЦ)')}:</b> в день резкого шока одна нога межотраслевого или спот-фьючерсного спреда может лечь на верхнюю или нижнюю планку (сделки по ней встанут до клиринга), тогда как вторая нога продолжит двигаться, разрывая нейтральность хеджа!</li>
      </ul>
      <details class="quiz"><summary>Проверьте себя до расчёта: сколько лотов MXI нужно против 2 контрактов MIX?</summary><p>Рублёвый номинал одного полного <code>MIX</code> в 10 раз крупнее мини-контракта <code>MXI</code>, поэтому против <b>2 MIX</b> нужно взять <b>20 MXI</b> (иначе 90% позиции останется не захеджировано!).</p></details>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Проверьте паспорт пары и рублёвый баланс двух ног</h4>
          <div class="btns" id="b2" style="margin:0 0 10px"></div>
          <p id="note2p" style="margin:0 0 10px;color:#98a3b6"></p>
          <div id="sl2"></div>
          <table class="t" id="tab2" style="margin-top:10px"></table>
          <div id="ver2" class="note" style="margin-top:10px"></div>
        </div>`;

      const bEl = el.querySelector('#b2');
      bEl.innerHTML = PAIRS2.map((p, i) => '<button class="b" data-i="' + i + '">' + p.name + '</button>').join('');
      bEl.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (b) { s2.idx = +b.dataset.i; draw2(); }
      });
      HV.slider(el.querySelector('#sl2'), {
        label: 'Общее движение базового рынка за день', min: -8, max: 8, step: 0.5, value: s2.movePct,
        fmt: (v) => U.sgn(v, 1) + '% (обе ноги двигаются синхронно)',
        onInput: (v) => { s2.movePct = v; draw2(); }
      });

      function draw2() {
        bEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s2.idx));
        const p = PAIRS2[s2.idx];
        el.querySelector('#note2p').textContent = p.note;

        const kMove = s2.movePct / 100;
        const a1 = p.aSp0 * (1 + kMove), b1 = p.bSp0 * (1 + kMove);
        const match = E.matchContractLots(p.aNom, p.bNom, 10);

        const vmA1 = E.calcVM(p.aSp0, a1, p.aR, p.aW, 1);
        const vmBNaive = E.calcVM(p.bSp0, b1, p.bR, p.bW, -1);
        const vmBMatched = E.calcVM(p.bSp0, b1, p.bR, p.bW, -match.qB);
        const vmAMatched = E.calcVM(p.aSp0, a1, p.aR, p.aW, match.qA);

        const rub = (v) => '<span class="' + (Math.abs(v) < 50 ? 'pos' : v > 0 ? 'pos' : 'neg') + '">' + U.sgn(v, 0) + ' ₽</span>';
        el.querySelector('#tab2').innerHTML =
          '<tr><th>Контракт</th><th>SP₀ → SP₁</th><th>R / W (W ÷ R)</th><th>VM на 1 : 1</th><th>VM при выравнивании (' + match.qA + ' : ' + match.qB + ')</th></tr>' +
          '<tr><td>' + p.aName + ' (лонг)</td><td>' + f(p.aSp0, p.aR < 1 ? 2 : 0) + ' → ' + f(a1, p.aR < 1 ? 2 : 0) + '</td><td>' + p.aR + ' / ' + p.aW + ' ₽ (' + f(p.aW / p.aR, 0) + ')</td><td>' + rub(vmA1) + '</td><td>' + rub(vmAMatched) + '</td></tr>' +
          '<tr><td>' + p.bName + ' (шорт)</td><td>' + f(p.bSp0, p.bR < 1 ? 2 : 0) + ' → ' + f(b1, p.bR < 1 ? 2 : 0) + '</td><td>' + p.bR + ' / ' + p.bW + ' ₽ (' + f(p.bW / p.bR, 0) + ')</td><td>' + rub(vmBNaive) + '</td><td>' + rub(vmBMatched) + '</td></tr>' +
          '<tr><td colspan="3"><b>Суммарная VM на счёте при общем ходе рынка ' + U.sgn(s2.movePct, 1) + '%</b></td><td><b>' + rub(vmA1 + vmBNaive) + '</b></td><td><b>' + rub(vmAMatched + vmBMatched) + '</b></td></tr>';

        const vEl = el.querySelector('#ver2');
        const unhedged = Math.abs(vmA1 + vmBNaive);
        if (unhedged > 200) {
          vEl.className = 'note bad';
          vEl.innerHTML = '<b>Наивная пропорция 1 : 1 оставила дыру в ' + Math.round(unhedged).toLocaleString('ru-RU') + ' ₽!</b> Хотя оба актива прошли ровно ' + U.sgn(s2.movePct, 1) + '%, разный масштаб лотов превратил «нейтральный спред» в направленную ставку. Пакет <b>' + match.qA + ' : ' + match.qB + '</b> сводит рыночный перекос практически к нулю.';
        } else {
          vEl.className = 'note';
          vEl.innerHTML = 'Здесь рублёвые номиналы одного лота близки (' + p.aNom.toLocaleString('ru-RU') + ' ₽ и ' + p.bNom.toLocaleString('ru-RU') + ' ₽) благодаря множителю <code>W ÷ R</code> — поэтому пропорция <b>1 : 1</b> уже сбалансирована.';
        }
      }
      draw2();
    }
  });

  /* ---------- 3. Вечные фьючерсы (SwapRate) и дивидендные отсечки ---------- */
  const s3 = { tab: 0, swapDay: 0.22, holdDays: 18, priceConv: 3.0 };

  Z.push({
    id: 'perp-swap-div',
    title: 'Вечные фьючерсы, ежедневный SwapRate и дивидендные гэпы',
    lead: 'На Московской бирже огромную долю оборота заняли бессрочные фьючерсы (USDRUBF, CNYRUBF, IMOEXF). Они никогда не истекают — но вместо экспирации через вариационную маржу каждый вечер течёт плата финансирования SwapRate.',
    text: () => `
      <h3>Куда течёт река ${T('swap_rate', 'SwapRate')} в ${T('perpetual_fut', 'вечном фьючерсе')}</h3>
      <p>У обычного квартального фьючерса разница ставок зашита внутрь его более высокой цены (контанго) и постепенно тает к экспирации. У бессрочного фьючерса даты окончания нет, поэтому разница ставок перечисляется живыми деньгами в каждый вечерний клиринг:</p>
      <ul>
        <li>Если <b>SwapRate &gt; 0</b> — финансирование <b>платят покупатели (лонги)</b> вечного фьючерса, а <b>получают продавцы (шорты)</b>.</li>
        <li>Если <b>SwapRate &lt; 0</b> — наоборот: <b>платят шорты</b>, а <b>получают лонги</b>.</li>
      </ul>
      <div class="note warn"><b>Классическая ловушка «дорогого квартального фьючерса».</b> Новичок видит: квартальный контракт стоит на +12 п. выше вечного, продаёт квартальный и покупает вечный «ждать схождения». Контанго за три недели действительно сжимается на +3 п. — но по купленному вечному фьючерсу с него за 18 дней списывают <code>18 × 0,22 = −3,96 п.</code> SwapRate, превращая «верную прибыль» в убыток!</div>
      <h3>${T('div_gap', 'Дивидендный гэп')} во фьючерсах на акции и индекс</h3>
      <p>Если отсечка под дивиденды попадает внутрь жизни квартального фьючерса, он <b>заранее торгуется со скидкой на размер будущего дивиденда</b>. Принимать эту плановую скидку за «случайное удешевление» и покупать её без вычитания календаря дивидендов — вторая типичная ошибка на MOEX.</p>`,
    mount(el) {
      const mxSwap = E.genMoexScenario(7, E.MOEX_SCENARIOS[0]);
      const mxDiv = E.genMoexScenario(7, E.MOEX_SCENARIOS[1]);

      el.innerHTML = `
        <div class="viz">
          <h4>Калькулятор удержания вечного фьючерса: кто кого перетянет — схождение цены или SwapRate?</h4>
          <p class="cap">Шорт спреда «Квартальный − Вечный»: продали квартальный, купили вечный. При положительном SwapRate длинная нога вечного платит каждый календарный день.</p>
          <div id="sl3a"></div>
          <div id="sl3b"></div>
          <div id="sl3c"></div>
          <div id="k3" style="margin-top:10px"></div>
        </div>
        <div class="viz">
          <h4>Сырой спред против очищенного от ставки и дивидендного календаря</h4>
          <div class="btns" id="b3" style="margin:0 0 8px">
            <button class="b" data-t="0">Рост ключевой ставки (контанго уплывает)</button>
            <button class="b" data-t="1">Три дивидендные отсечки (дни 70, 155, 240)</button>
          </div>
          <div class="legend">
            <span><i style="background:${BAD}"></i>сырой спред SP (Кварт − Вечный/Спот)</span>
            <span><i style="background:${GOLD}"></i>справедливый перенос с учётом дивидендов</span>
            <span><i style="background:${ME}"></i>очищенный сигнал (Mispricing без дрейфа)</span>
          </div>
          <div id="c3"></div>
        </div>`;

      HV.slider(el.querySelector('#sl3a'), {
        label: 'Ежедневный SwapRate вечного фьючерса', min: -0.20, max: 0.40, step: 0.02, value: s3.swapDay,
        fmt: (v) => U.sgn(v, 2) + ' п./календ. день (' + (v > 0 ? 'лонг платит' : v < 0 ? 'лонг получает' : 'ноль') + ')',
        onInput: (v) => { s3.swapDay = v; draw3(); }
      });
      HV.slider(el.querySelector('#sl3b'), {
        label: 'Срок удержания сделки (календарных дней, вкл. выходные)', min: 2, max: 45, step: 1, value: s3.holdDays,
        fmt: (v) => v + ' календ. дн.',
        onInput: (v) => { s3.holdDays = v; draw3(); }
      });
      HV.slider(el.querySelector('#sl3c'), {
        label: 'Ценовое схождение спреда в вашу пользу за это время', min: 0.5, max: 8.0, step: 0.5, value: s3.priceConv,
        fmt: (v) => '+' + f(v, 1) + ' п.',
        onInput: (v) => { s3.priceConv = v; draw3(); }
      });

      const bEl = el.querySelector('#b3');
      bEl.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (b) { s3.tab = +b.dataset.t; drawChart3(); }
      });
      const c3 = A.mkChart(el.querySelector('#c3'), 195, {
        tip: (i) => {
          const d = s3.tab === 0 ? mxSwap : mxDiv;
          return '<b>День ' + (i + 1) + '</b><br>сырой спред: <b style="color:' + BAD + '">' + U.sgn(d.spRaw[i]) + ' п.</b><br>справедливый перенос: <b style="color:' + GOLD + '">' + U.sgn(d.fairBasis[i]) + ' п.</b><br>очищенный сигнал: <b style="color:' + ME + '">' + U.sgn(d.cleanSpread[i]) + ' п.</b>';
        }
      });

      function drawChart3() {
        bEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s3.tab));
        const d = s3.tab === 0 ? mxSwap : mxDiv;
        const spans = [];
        d.isDivDay.forEach((dv, i) => { if (dv) spans.push({ i0: i - 0.8, i1: i + 0.8, color: '#ffd16638' }); });
        c3.render({
          n: d.spRaw.length, spans,
          hlines: [{ y: 0, color: '#ffffff28', dash: [3, 3] }],
          series: [
            { data: d.spRaw, color: BAD, width: 1.5 },
            { data: d.fairBasis, color: GOLD, width: 1.6, dash: [5, 4] },
            { data: d.cleanSpread, color: ME, width: 1.9 }
          ]
        });
      }

      function draw3() {
        const swapTot = -s3.swapDay * s3.holdDays; // лонг вечного платит при SwapRate > 0
        const netBeforeFee = s3.priceConv + swapTot;
        el.querySelector('#k3').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + PRE + '">+' + f(s3.priceConv) + ' п.</div><div class="l">ценовой ход спреда</div><div class="e">то, что видно на графике цен</div></div>' +
            '<div class="kpi"><div class="v">' + col(swapTot) + ' п.</div><div class="l">поток SwapRate за ' + s3.holdDays + ' дн.</div><div class="e">' + (swapTot < 0 ? 'списано с лонга вечного' : 'начислено лонгу вечного') + '</div></div>' +
            '<div class="kpi"><div class="v">' + col(netBeforeFee) + ' п.</div><div class="l">итог до комиссий</div><div class="e">' + (netBeforeFee < 0 ? 'SwapRate съел всю идею!' : 'сделка выдержала финансирование') + '</div></div>' +
          '</div>';
      }
      draw3();
      drawChart3();
    }
  });

  /* ---------- 4. Нативный (синтетический) стакан спреда против леггирования ---------- */
  const s4 = { stressed: false, lots: 4 };

  Z.push({
    id: 'synth-book',
    title: 'Нативный стакан календарного спреда против ручного леггирования',
    lead: 'Для календарных спредов на MOEX существует отдельный биржевой инструмент: вы выставляете цену сразу за разницу двух серий, а ядро биржи атомарно сводит сделку без риска остаться в одной ноге.',
    text: () => `
      <h3>Как работает ${T('synth_matching', 'синтетический матчинг')}</h3>
      <p>При ручном сборе (${T('legging', 'леггировании')}) вы отправляете два независимых ордера в две разные книги заявок: если первый сработал, а второй за долю секунды отскочил — вы повисли в голом рыночном риске и платите двойной спред.</p>
      <p>В биржевом календарном спреде MOEX ядро Spectra объединяет встречные заявки из стаканов ближней и дальней серий в единую ${T('implied_liq', 'имплицированную ликвидность')}:</p>
      <ul>
        <li><b>В спокойный рынок:</b> обе ноги исполняются строго одновременно как одна неделимая сделка, а суммарный спред и биржевой сбор ниже ручного удара в два стакана.</li>
        <li><b>${T('effective_spread', 'Три L2-метрики живого стакана')} (§6.2):</b> скринер следит не только за дневным оборотом, но и за <i>эффективным спредом</i> (реальным отступом принта от mid), <i>лакунами сделок</i> (минутами немоты ленты) и <i>синхронностью ног</i> (когда котировки живые одновременно в обоих стаканах — строго в основную сессию <code>10:05–18:40</code>).</li>
        <li><b>${T('l2_replay', 'Трёхсценарный L2-реплей проскальзывания')} (§6.3):</b> крупная заявка съедает несколько этажей стакана (<i>walk-the-book</i>), а в шторм имплицированная ликвидность исчезает, спред удваивается и глубина редеет втрое. Проверьте все три сценария справа!</li>
      </ul>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Сборка спреда и 3-сценарный L2-реплей стакана (подвиньте объём заявки!)</h4>
          <div class="btns" id="b4" style="margin:0 0 10px">
            <button class="b" data-s="0">Спокойная основная сессия (штиль)</button>
            <button class="b" data-s="1">Новостной шок / стресс (стакан разъехался!)</button>
          </div>
          <div id="sl4"></div>
          <table class="t" id="tab4" style="margin-top:10px"></table>
          <table class="t" id="tab4l2" style="margin-top:10px"></table>
          <div id="note4" class="note" style="margin-top:10px"></div>
        </div>`;

      const bEl = el.querySelector('#b4');
      bEl.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (b) { s4.stressed = b.dataset.s === '1'; draw4(); }
      });
      HV.slider(el.querySelector('#sl4'), {
        label: 'Размер вашей заявки (лотов спреда)', min: 1, max: 15, step: 1, value: s4.lots,
        fmt: (v) => v + ' лот.',
        onInput: (v) => { s4.lots = v; draw4(); }
      });

      function draw4() {
        bEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b.dataset.s === '1') === s4.stressed));
        const cNat = E.decomposeCosts({ nativeBook: true, stressed: s4.stressed, volumeLots: s4.lots });
        const cLeg = E.decomposeCosts({ nativeBook: false, stressed: s4.stressed, volumeLots: s4.lots });
        const l2 = E.replayL2OrderBook({ lots: s4.lots });

        el.querySelector('#tab4').innerHTML =
          '<tr><th>Слой издержек на круг (вход + выход)</th><th>Нативный стакан спреда</th><th>Ручное леггирование (2 ордера)</th></tr>' +
          '<tr><td>1. Биржевой сбор (maker / taker)</td><td>−' + f(cNat.exch) + ' п.</td><td>−' + f(cLeg.exch) + ' п.</td></tr>' +
          '<tr><td>2. Клиринговый сбор НКЦ</td><td>−' + f(cNat.clear) + ' п.</td><td>−' + f(cLeg.clear) + ' п.</td></tr>' +
          '<tr><td>3. Брокерская комиссия</td><td>−' + f(cNat.broker) + ' п.</td><td>−' + f(cLeg.broker) + ' п.</td></tr>' +
          '<tr><td>4. Полуспред + глубина + рассинхрон ног</td><td>−' + f(cNat.slip) + ' п.</td><td class="neg">−' + f(cLeg.slip) + ' п.</td></tr>' +
          '<tr><td><b>Итого трений на 1 лот (круговой оборот)</b></td><td><b style="color:' + (cNat.usedNative ? ME : GOLD) + '">−' + f(cNat.total) + ' п.</b></td><td><b style="color:' + BAD + '">−' + f(cLeg.total) + ' п.</b></td></tr>';

        el.querySelector('#tab4l2').innerHTML =
          '<tr><th>3-сценарный L2-реплей на объёме ' + s4.lots + ' лот. (§6.3)</th><th>Проскальзывание (4 пересечения)</th><th>Полный круг со сборами</th></tr>' +
          '<tr><td>1. Оптимистичный Top-of-book (иллюзия 1-го уровня)</td><td>−' + f(l2.optimistic.slip) + ' п.</td><td>−' + f(l2.optimistic.total) + ' п.</td></tr>' +
          '<tr><td>2. Реалистичный L2 (проход уровней walk-the-book)</td><td>−' + f(l2.realistic.slip) + ' п.</td><td style="color:' + GOLD + '"><b>−' + f(l2.realistic.total) + ' п.</b></td></tr>' +
          '<tr><td>3. Стрессовый L2 (спред ×2, глубина ÷3, лаг ноги)</td><td class="neg">−' + f(l2.stressed.slip) + ' п.</td><td class="neg"><b>−' + f(l2.stressed.total) + ' п.</b></td></tr>';

        const nEl = el.querySelector('#note4');
        if (!s4.stressed) {
          nEl.className = 'note';
          nEl.innerHTML = '<b>В спокойный рынок нативный стакан экономит ' + f(cLeg.total - cNat.total) + ' п. на каждом круге</b> и полностью убирает риск зависнуть с одной исполненной ногой.';
        } else {
          nEl.className = 'note bad';
          nEl.innerHTML = '<b>Предупреждение стресс-режима:</b> во время паники имплицированная ликвидность в стакане спреда пропадает, а проскальзывание на объёме ' + s4.lots + ' лот. взлетает более чем вдвое (до −' + f(cNat.total) + ' п.). Никогда не закладывайте в расчёт только «спокойную» цену выхода!';
        }
      }
      draw4();
    }
  });
})();
