/* Календарный спред, экраны 1–4: экономика разницы ближнего и дальнего фьючерса,
   контанго и бэквордация, экспирация и склейка (ролл), ручной расчёт сделки с переносом (#31). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, HV = window.HV;
  const C = U.COLORS;
  const Z = (window.CALSCREENS = window.CALSCREENS || []);
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', PRE = '#5aa9ff', GOLD = '#ffd166', GREY = '#8b95a7';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const nz = (v) => {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    for (let d = 0; d <= 3; d++) if (Math.abs(v * Math.pow(10, d) - Math.round(v * Math.pow(10, d))) < 1e-9) return U.fmt(v, d);
    return U.fmt(v, 2);
  };
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 1 : d) + '</span>';

  /* ---------- 1. Из чего состоит разница цен ---------- */
  const CARRY_PRESETS = [
    { name: 'Золото (ставка + хранилище)', spot: 1000, r: 15, u: 2, y: 0, dt: 73 },
    { name: 'Акция перед дивидендом', spot: 1000, r: 15, u: 0, y: 22, dt: 73 },
    { name: 'Нефть в спокойный сезон', spot: 1000, r: 14, u: 8, y: 6, dt: 73 },
    { name: 'Газ зимой (дефицит)', spot: 1000, r: 14, u: 10, y: 39, dt: 73 }
  ];
  const s1 = Object.assign({}, CARRY_PRESETS[0]);

  Z.push({
    id: 'carry',
    title: 'Из чего состоит разница ближнего и дальнего фьючерса',
    lead: 'В календарном спреде мы торгуем не два разных актива, а один и тот же актив в два разных срока окончания. Поэтому у разницы цен здесь есть прозрачная экономическая формула.',
    text: () => `
      <div class="note"><b>Договорённость о знаке.</b> Во всём разделе ${T('calendar_spread', 'календарный спред')} записывается как <b>Дальний фьючерс − Ближний фьючерс</b>. Если дальний дороже — число положительное (${T('contango', 'контанго')}), если ближний дороже — отрицательное (${T('backwardation', 'бэквордация')}). В терминах прошлых разделов «инструмент A» — это дальний контракт, а «инструмент B» — ближний.</div>
      <h3>Почему март и июнь стоят по-разному</h3>
      <p>Пусть сегодня реальный товар (${T('spot', 'спот')}) стоит 1000 пунктов, а между ${T('near_far', 'ближним и дальним фьючерсом')} лежит ΔT дней (например, 73 дня — ровно одна пятая года). Из чего складывается честная надбавка к дальней цене — ${T('cost_of_carry', 'стоимость переноса')}?</p>
      <ol>
        <li><b>Процент на деньги (+r).</b> Покупая фьючерс, вы платите за товар позже, а свободные деньги держат вклад под ${T('risk_free_rate', 'ставку r')}. Эту выгоду продавец закладывает в дальнюю цену со знаком «плюс».</li>
        <li><b>Хранение и страховка (+u).</b> Держать зерно на элеваторе или нефть в резервуаре лишние месяцы стоит денег — это тоже увеличивает цену дальнего контракта.</li>
        <li><b>Дивиденды или ${T('convenience_yield', 'выгода владения')} (−y).</b> Держатель реальной акции получит дивиденд, а держатель фьючерса — нет. А у сырья в разгар дефицита бочка «в руках прямо сегодня» ценнее обещания через квартал. Это уменьшает дальнюю цену.</li>
      </ol>
      <span class="formula">Справедливый спред = Спот × (r + u − y) × (ΔT ÷ 365)<small>пример: 1000 × (15% + 5% − 0%) × (73 ÷ 365) = 1000 × 0,20 × 0,2 = +40 пунктов</small></span>
      <h3>Откуда тогда берутся колебания для стратегии?</h3>
      <p>Ставка ЦБ, заполненность хранилищ, ожидания дивидендов и потоки заявок меняются каждый день. Из-за этого фактический спред качается вокруг справедливого уровня, то убегая слишком далеко, то возвращаясь обратно.</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Калькулятор стоимости переноса (при споте = 1000 п.)</h4>
          <div class="btns" id="pr" style="margin:0 0 10px"></div>
          <div id="ctl" class="controls"></div>
          <table class="t" id="tab" style="margin-top:10px"></table>
          <div class="note" id="read"></div>
        </div>
        <div class="viz">
          <h4>${T('term_curve', 'Срочная кривая')}: как выглядят цены фьючерсов по срокам</h4>
          <p class="cap">Точка 0 — спот сегодня; дальше — контракты с поставкой через 1, 2, 3 и 4 интервала по ΔT дней.</p>
          <div id="cc"></div>
        </div>`;

      const pr = el.querySelector('#pr');
      pr.innerHTML = CARRY_PRESETS.map((p, i) => '<button class="b" data-i="' + i + '">' + p.name + '</button>').join('');
      const ctl = el.querySelector('#ctl');
      const slR = HV.slider(ctl, { label: 'Ставка по деньгам r, % годовых', min: 0, max: 25, step: 1, value: s1.r, fmt: (v) => f(v, 0) + '%', hint: 'Увеличивает цену дальнего контракта.', onInput: (v) => { s1.r = v; draw(); } });
      const slU = HV.slider(ctl, { label: 'Хранение и страховка u, % годовых', min: 0, max: 20, step: 1, value: s1.u, fmt: (v) => f(v, 0) + '%', hint: 'У золота и валюты почти 0%, у нефти и газа велико.', onInput: (v) => { s1.u = v; draw(); } });
      const slY = HV.slider(ctl, { label: 'Выгода владения / дивиденды y, % годовых', min: 0, max: 45, step: 1, value: s1.y, fmt: (v) => f(v, 0) + '%', hint: 'Дивиденд по акции или премия за дефицит товара сегодня.', onInput: (v) => { s1.y = v; draw(); } });
      const slT = HV.slider(ctl, { label: 'Разница сроков между контрактами ΔT', min: 30, max: 180, step: 5, value: s1.dt, fmt: (v) => f(v, 0) + ' дн.', hint: 'Например, 90 дней между квартальными фьючерсами.', onInput: (v) => { s1.dt = v; draw(); } });

      pr.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        Object.assign(s1, CARRY_PRESETS[+b.dataset.i]);
        slR.set(s1.r); slU.set(s1.u); slY.set(s1.y); slT.set(s1.dt);
        draw();
      });

      let curve = [];
      const labels = () => ['Спот', '+' + s1.dt + ' дн.', '+' + (2 * s1.dt) + ' дн.', '+' + (3 * s1.dt) + ' дн.', '+' + (4 * s1.dt) + ' дн.'];
      const cc = A.mkChart(el.querySelector('#cc'), 205, {
        xfmt: (i) => labels()[i] || '',
        tip: (i) => (curve[i] === undefined ? null : '<b>' + labels()[i] + '</b><br>теоретическая цена: <b>' + f(curve[i], 1) + '</b> п.')
      });

      function draw() {
        const pR = E.carryFair(s1.spot, s1.r / 100, 0, 0, s1.dt);
        const pU = E.carryFair(s1.spot, 0, s1.u / 100, 0, s1.dt);
        const pY = -E.carryFair(s1.spot, 0, 0, s1.y / 100, s1.dt);
        const tot = E.carryFair(s1.spot, s1.r / 100, s1.u / 100, s1.y / 100, s1.dt);
        el.querySelector('#tab').innerHTML =
          '<tr><th>Слагаемое за ' + s1.dt + ' дн. (' + f((s1.dt / 365) * 100, 1) + '% года)</th><th>Годовая ставка</th><th>Вклад в спред, пунктов</th></tr>' +
          '<tr><td>Процент на деньги (+r)</td><td>+' + s1.r + '%</td><td>' + col(pR, 2) + '</td></tr>' +
          '<tr><td>Хранение и страховка (+u)</td><td>+' + s1.u + '%</td><td>' + col(pU, 2) + '</td></tr>' +
          '<tr><td>Выгода владения / дивиденды (−y)</td><td>−' + s1.y + '%</td><td>' + col(pY, 2) + '</td></tr>' +
          '<tr><td><b>Итого справедливый спред (Дальний − Ближний)</b></td><td><b>' + U.sgn(s1.r + s1.u - s1.y, 0) + '% год.</b></td><td><b>' + col(tot, 2) + '</b></td></tr>';
        el.querySelector('#read').innerHTML = tot > 0.05
          ? '<span class="pill go">Контанго (' + U.sgn(tot, 1) + ' п.)</span> Процент и хранение перевешивают выгоду владения: дальний контракт дороже ближнего на <b>' + f(tot, 1) + '</b> п. на каждые ' + s1.dt + ' дней.'
          : tot < -0.05
            ? '<span class="pill stop">Бэквордация (' + f(tot, 1) + ' п.)</span> Выгода иметь актив прямо сейчас перевешивает ставку и склад: ближний контракт дороже дальнего на <b>' + f(-tot, 1) + '</b> п.'
            : 'Слагаемые уравновесили друг друга: срочная кривая плоская (спред около нуля).';

        curve = [0, 1, 2, 3, 4].map((k) => s1.spot + k * tot);
        cc.render({ n: 5, series: [{ data: curve, color: tot >= 0 ? ME : BAD, width: 2.6 }], hlines: [{ y: s1.spot, color: '#ffffff33', dash: [4, 4], label: 'спот = 1000' }] });
      }
      draw();
    }
  });

  /* ---------- 2. Контанго и бэквордация ---------- */
  const s2 = { inv: 60 };

  Z.push({
    id: 'curves',
    title: 'Контанго и бэквордация: несимметричный риск',
    lead: 'Кажется, что спред может одинаково отклоняться и вверх, и вниз. В сырьевых фьючерсах это опасная иллюзия: вверх у контанго есть жёсткий потолок, а вниз у бэквордации потолка нет!',
    text: () => `
      <h3>Два состояния рынка</h3>
      <ul>
        <li>${T('contango', 'Контанго')} (Дальний &gt; Ближний, спред положительный) — обычная картина, когда на складах достаточно товара. Кривая цен плавно поднимается вправо.</li>
        <li>${T('backwardation', 'Бэквордация')} (Ближний &gt; Дальний, спред отрицательный) — сигнал нехватки товара «здесь и сейчас»: заводы или потребители готовы переплачивать за ближайшую поставку.</li>
      </ul>
      <h3>Железный потолок сверху: ${T('cash_carry', 'арбитраж со складом')}</h3>
      <p>Представьте, что ставка плюс склад стоят +20 пунктов за квартал, а дальний фьючерс вдруг оторвался от ближнего на +35 пунктов. Крупный трейдер тут же покупает ближний товар, кладёт на склад за 20 пунктов и продаёт дальний по +35, забирая <b>15 пунктов почти без риска</b>! Миллиардные заявки мгновенно прижимают контанго обратно к потолку хранения.</p>
      <h3>Отсутствие дна снизу: нельзя занять из будущего — и ловушка шорта акций!</h3>
      <p>А теперь обратная картина: морозная зима или авария на трубопроводе, хранилища пустеют, и ближний фьючерс улетает на 50 пунктов выше дальнего (спред падает до −50). Чтобы заработать обратным арбитражем, нужно <i>продать реальный товар сегодня</i> и купить дальний фьючерс. <b>Но склады пусты — продавать физически нечего!</b></p>
      <p>На фондовом рынке работает похожая ${T('short_stock_repo', 'асимметрия шорта акции против фьючерса')}: продать фьючерс бесплатно (нужен лишь залог ГО), а обратный cash-and-carry («шорт акции + лонг фьючерса») упирается в <b>платное репо за заём бумаг у брокера (15–25% годовых по календарным суткам)</b>, обязанность <b>возместить кредитору дивиденды</b> при переносе через отсечку, немаржинальность 2–3 эшелона и риск внезапного запрета шортов ЦБ РФ!</p>
      <div class="note bad"><b>Главный практический вывод.</b> Вставать в лонг календарного спреда сырья («купили дальний, продали ближний») без жёсткого стопа или считать симметричным «шорт акции против фьючерса» опасно: подвигайте ползунок запасов справа и посмотрите на обрыв слева.</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Как запасы на складах гнут срочную кривую</h4>
          <div id="ctl"></div>
          <div id="c1"></div>
          <div class="note" id="read"></div>
        </div>
        <div class="viz">
          <h4>Равновесный спред (Дальний − Ближний) в зависимости от заполненности складов</h4>
          <p class="cap">Справа при полных складах спред упирается в потолок хранения (+20 п.). Слева при пустых складах — крутой провал в бэквордацию.</p>
          <div id="c2"></div>
        </div>`;

      const MAX_CARRY = 20;
      const spreadOfInv = (pct) => {
        // Нелинейная кривая хранения (Working curve): при избытке запасов стремится к +20, при нехватке обрывается вниз
        const scarcity = 58 * Math.exp(-pct / 16);
        return Math.min(MAX_CARRY, MAX_CARRY - scarcity);
      };
      const INV_GRID = [];
      for (let k = 0; k <= 20; k++) INV_GRID.push(k * 5);

      HV.slider(el.querySelector('#ctl'), {
        label: 'Заполненность хранилищ товара', min: 0, max: 100, step: 5, value: s2.inv,
        fmt: (v) => f(v, 0) + '% (' + (v < 20 ? 'острый дефицит!' : v < 45 ? 'напряжённо' : 'запасов достаточно') + ')',
        hint: 'Сдвиньте влево к 0–15%, чтобы увидеть взрыв бэквордации.',
        onInput: (v) => { s2.inv = v; draw(); }
      });

      const M_LABELS = ['Спот', '1-й фьюч.', '2-й фьюч.', '3-й фьюч.', '4-й фьюч.', '5-й фьюч.'];
      let term = [];
      const c1 = A.mkChart(el.querySelector('#c1'), 195, {
        xfmt: (i) => M_LABELS[i] || '',
        tip: (i) => (term[i] === undefined ? null : '<b>' + M_LABELS[i] + '</b>: ' + f(term[i], 1) + ' п.')
      });
      const gridVals = INV_GRID.map(spreadOfInv);
      const c2 = A.mkChart(el.querySelector('#c2'), 195, {
        xfmt: (i) => (INV_GRID[i] === undefined ? '' : INV_GRID[i] + '%'),
        tip: (i) => (INV_GRID[i] === undefined ? null : '<b>Запасы ' + INV_GRID[i] + '%</b><br>спред Дальний − Ближний: <b>' + U.sgn(gridVals[i], 1) + ' п.</b>')
      });

      function draw() {
        const sp = spreadOfInv(s2.inv);
        // При дефиците сильнее всего задирается спот и самый ближний контракт, дальние реагируют слабее
        const baseFar = 1000;
        if (sp >= 0) {
          term = [0, 1, 2, 3, 4, 5].map((k) => baseFar + k * sp);
        } else {
          const shock = -sp;
          term = [0, 1, 2, 3, 4, 5].map((k) => baseFar + shock * Math.pow(0.55, k) * 2.2 + k * 4);
        }
        c1.render({ n: 6, series: [{ data: term, color: sp >= 0 ? ME : BAD, width: 2.6 }], yMin: 980, yMax: 1125 });
        const curIdx = Math.round(s2.inv / 5);
        c2.render({
          n: INV_GRID.length,
          series: [{ data: gridVals, color: PRE, width: 2.4 }],
          hlines: [
            { y: MAX_CARRY, color: GOLD, label: 'потолок хранения (+20 п.)', dash: [6, 4] },
            { y: 0, color: '#ffffff33', dash: [3, 3] }
          ],
          markers: [{ i: curIdx, y: gridVals[curIdx], kind: 'dot', color: sp >= 0 ? ME : BAD, size: 7 }],
          yMin: -42, yMax: 26
        });
        const f12 = term[2] - term[1];
        el.querySelector('#read').innerHTML = sp >= 0
          ? 'При запасах <b>' + s2.inv + '%</b> рынок в спокойном <b>контанго</b>: второй фьючерс выше первого на <b>+' + f(f12, 1) + ' п.</b> Выше +20 п. разница уйти не может — её тут же прижмёт арбитраж со складом.'
          : 'При запасах <b>' + s2.inv + '%</b> на рынке <b>дефицит и бэквордация</b>: первый фьючерс взлетел выше второго, разница Дальний − Ближний упала до <b>' + f(f12, 1) + ' п.</b> Складам нечем погасить дефицит, поэтому падение спреда не имеет близкого предела!';
      }
      draw();
    }
  });

  /* ---------- 3. Экспирация, склейка и перенос позиции ---------- */
  const s3 = { seedIdx: 2 };
  const S3_SEEDS = [1, 3, 7, 11, 21];

  Z.push({
    id: 'roll',
    title: 'Экспирация, склейка и перенос позиции',
    lead: 'Фьючерс не живёт вечно: каждые месяц или квартал ближний контракт заканчивается. Разберём, откуда на графике берутся фальшивые ступеньки и как устроен честный перенос (ролл).',
    text: () => `
      <h3>Жизненный цикл пары</h3>
      <p>Допустим, мы торгуем квартальную пару <b>Март–Июнь</b>. В марте ближний фьючерс прекратит существование (${T('expiry', 'экспирация')}). В последние дни перед истечением из него уходят крупные участники, расширяется ${T('slippage', 'проскальзывание')}, а в ${T('physical_delivery', 'поставочных контрактах')} возникает риск выйти на реальную поставку товара. Поэтому переход делают заранее — в нашей модели за <b>5 торговых дней до экспирации</b>.</p>
      <h3>Почему «склейка в лоб» врёт</h3>
      <p>В вечер перехода на бирже одновременно торгуются обе пары: старая (Март–Июнь), допустим, стоит <b>+8 п.</b>, а следующая (Июнь–Сентябрь) — <b>+22 п.</b> (потому что летнее хранение или ставки другие). Если просто продолжить график числами новой пары, на ровном месте появится вертикальная ступенька <b>+14 п.</b>!</p>
      <ul>
        <li><b>Ошибка индикатора:</b> скользящее окно принимает ступеньку +14 за огромный скачок рынка, z-score бьёт в потолок и открывает ложную сделку!</li>
        <li><b>Ошибка расчёта прибыли:</b> эти +14 п. нельзя положить в карман — чтобы пересесть в новую пару, нужно совершить ${T('rollover', 'ролл')}: закрыть Март–Июнь по +8 и купить Июнь–Сентябрь по +22, заплатив вторые издержки!</li>
      </ul>
      <h3>Как работает честная ${T('stitching', 'бесшовная склейка')}</h3>
      <p>В вечер ролла мы знаем цены обеих пар и фиксируем ступеньку: <b>сдвиг = новая пара − старая пара</b>. Со следующего дня вычитаем накопленный сдвиг из новой серии (никакого заглядывания в будущее — используются только уже прошедшие роллы!). Тогда каждый дневной шаг склеенного ряда в точности равен реальному дневному заработку на счёте.</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <div class="btns" id="seeds" style="margin:0 0 8px"></div>
          <h4>Сырая склейка со ступеньками против честной бесшовной склейки</h4>
          <p class="cap">Жёлтые вертикальные полосы — вечера ролла (дни 64, 128, 192, 256), когда происходит переход в следующую квартальную пару.</p>
          <div class="legend"><span><i style="background:${SIM}"></i>сырая склейка (со ступеньками смены серий)</span><span><i style="background:${ME}"></i>бесшовная склейка (реальное движение цены)</span></div>
          <div id="c1"></div>
        </div>
        <div class="viz">
          <h4>Что происходит с z-score (N = 30) на стыках серий</h4>
          <div class="legend"><span><i style="background:${SIM}"></i>наивный z-score (бьёт ложную тревогу на стыках!)</span><span><i style="background:${ME}"></i>честный z-score по бесшовной склейке</span></div>
          <div id="c2"></div>
        </div>
        <div class="viz">
          <h4>Таблица всех четырёх переходов (роллов) на этом наборе данных</h4>
          <table class="t" id="tab"></table>
          <div class="note" id="read"></div>
        </div>`;

      const seeds = el.querySelector('#seeds');
      seeds.innerHTML = S3_SEEDS.map((s, i) => '<button class="b" data-i="' + i + '">набор ' + s + '</button>').join('');
      seeds.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s3.seedIdx = +b.dataset.i; draw(); } });

      let cal, zRaw, zSt;
      const c1 = A.mkChart(el.querySelector('#c1'), 190, {
        tip: (i) => '<b>День ' + (i + 1) + ' (' + cal.seriesNames[cal.seriesIdx[i]] + ')</b><br>сырой спред: ' + f(cal.raw[i]) + ' п.<br>бесшовный: ' + f(cal.stitched[i]) + ' п.<br>до экспирации: ' + cal.daysToExp[i] + ' дн.'
      });
      const c2 = A.mkChart(el.querySelector('#c2'), 175, {
        tip: (i) => (zSt[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>наивный z: <b>' + f(zRaw[i]) + '</b><br>бесшовный z: <b>' + f(zSt[i]) + '</b>')
      });

      function draw() {
        seeds.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s3.seedIdx));
        cal = E.genCalScenario(S3_SEEDS[s3.seedIdx], E.CAL_SCENARIOS[0]);
        zRaw = E.rolling(cal.raw, 30).z;
        zSt = E.rolling(cal.stitched, 30).z;
        const rollSpans = [];
        cal.isRoll.forEach((r, i) => { if (r) rollSpans.push({ i0: i, i1: i + 1, color: '#ffd16638' }); });
        c1.render({ n: 320, series: [{ data: cal.raw, color: SIM, width: 1.8 }, { data: cal.stitched, color: ME, width: 2.1 }], spans: rollSpans });
        c2.render({
          n: 320,
          series: [{ data: zRaw, color: SIM, width: 1.6 }, { data: zSt, color: ME, width: 2 }],
          hlines: [{ y: 2, color: '#ff6b6b88', dash: [4, 4] }, { y: -2, color: '#35d07f88', dash: [4, 4] }, { y: 0, color: '#ffffff33', dash: [] }],
          spans: rollSpans, yMin: -4.5, yMax: 4.5
        });

        const rolls = [];
        let acc = 0;
        cal.isRoll.forEach((r, i) => {
          if (!r) return;
          acc += cal.rollGap[i];
          rolls.push({
            day: i + 1,
            from: cal.seriesNames[cal.seriesIdx[i]],
            to: cal.seriesNames[cal.seriesIdx[i] + 1],
            oldSp: cal.raw[i],
            newSp: cal.nextRaw[i],
            gap: cal.rollGap[i],
            acc,
            zBad: zRaw[i + 1],
            zGood: zSt[i + 1]
          });
        });
        el.querySelector('#tab').innerHTML =
          '<tr><th>Вечер ролла</th><th>Переход серий</th><th>Старая пара</th><th>Новая пара</th><th>Ступенька</th><th>Накопленный сдвиг</th><th>Наивный z назавтра</th><th>Честный z назавтра</th></tr>' +
          rolls.map((r) => '<tr><td>День ' + r.day + '</td><td>' + r.from + ' → ' + r.to + '</td><td>' + f(r.oldSp) + '</td><td>' + f(r.newSp) + '</td><td><b>' + U.sgn(r.gap, 2) + '</b></td><td>' + U.sgn(r.acc, 2) + '</td><td class="' + (Math.abs(r.zBad) >= 2 ? 'neg' : '') + '"><b>' + f(r.zBad) + '</b></td><td>' + f(r.zGood) + '</td></tr>').join('');

        const btBad = E.backtestCalendar(cal, Object.assign(A.btParams(), { expiryMode: 'naive' })).metrics;
        const btGood = E.backtestCalendar(cal, Object.assign(A.btParams(), { expiryMode: 'roll' })).metrics;
        el.querySelector('#read').innerHTML = 'На этом наборе данных наивный z-score по сырой склейке принёс на реальном счёте ' + col(btBad.total, 1) + ' п. (' + btBad.count + ' сделок), а бесшовная склейка с честным роллом — ' + col(btGood.total, 1) + ' п. (' + btGood.count + ' сделок). Посмотрите на два последних столбца таблицы: сразу после ролла наивный z срывается за порог ±2 просто из-за смены контракта!';
      }
      draw();
    }
  });

  /* ---------- 4. Ручной расчёт сделки с роллом ---------- */
  const R_PRESETS = [
    { name: 'Лонг с прибылью (разбор)', dir: 1, m0: 1010, j0: 1020, m1: 1014, j1: 1027, s1: 1049, j2: 1025, s2: 1051, cost: 0.5, rcost: 0.5 },
    { name: 'Шорт спреда через ролл', dir: -1, m0: 1000, j0: 1024, m1: 1005, j1: 1025, s1: 1038, j2: 1010, s2: 1039, cost: 0.5, rcost: 0.5 },
    { name: 'Иллюзия «прибыли» от ступеньки', dir: 1, m0: 1000, j0: 1010, m1: 1005, j1: 1012, s1: 1032, j2: 1015, s2: 1033, cost: 0.5, rcost: 0.5 }
  ];
  const s4 = Object.assign({}, R_PRESETS[0]);

  Z.push({
    id: 'manual',
    title: 'Как посчитать вручную: сделка через ролл',
    lead: 'Проследим до копейки реальные сделки на брокерском счёте, когда открытая позиция переносится из пары «Март–Июнь» в пару «Июнь–Сентябрь», и увидим, почему ступенька между сериями никогда не идёт в прибыль.',
    wide: true,
    text: () => `
      <h3>Три ключевых вечера одной сделки</h3>
      <p>Пусть мы открыли <b>лонг календарного спреда</b> (купили дальний контракт, продали ближний) и не успели выйти до планового ролла:</p>
      <ol>
        <li><b>День входа (пара Март–Июнь):</b> продали Март по 1010, купили Июнь по 1020. Спред входа = 1020 − 1010 = <b>+10 п.</b></li>
        <li><b>Вечер ролла (обе пары живы):</b> Март вырос до 1014, Июнь до 1027. Спред старой пары стал 1027 − 1014 = <b>+13 п.</b> Закрываем старую пару (откупаем Март по 1014 → −4 п.; продаём Июнь по 1027 → +7 п.; итого по Серии 1 заработано <b>+3 п.</b>!). Тут же открываем новую пару Июнь–Сентябрь: продаём ближний теперь уже Июнь по 1027 и покупаем дальний Сентябрь по 1049 (спред новой пары = <b>+22 п.</b>, ступенька склейки = 22 − 13 = <b>+9 п.</b>).</li>
        <li><b>День выхода (пара Июнь–Сентябрь):</b> Июнь стал 1025, Сентябрь 1051. Спред новой пары вырос с +22 до <b>+26 п.</b> Откупаем Июнь (+2 п.) и продаём Сентябрь (+2 п.) → по Серии 2 заработано ещё <b>+4 п.</b>!</li>
      </ol>
      <span class="formula">Валовый итог = прибыль в Серии 1 + прибыль в Серии 2<br>Чистый итог = валовый − издержки входа/выхода − издержки ролла<small>в примере: (+3) + (+4) − 0,5 − 0,5 = +6,0 пунктов (а НЕ 26 − 10 = +16!)</small></span>
      <div class="note warn"><b>Проверьте третью кнопку («Иллюзия прибыли»).</b> В ней спред в первой серии вырос лишь на +2 п., во второй — на +1 п., но из-за ступеньки +20 п. наивная формула «выход минус вход» рисует бумажные +23 пункта вместо скромных +2 пунктов после комиссий!</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Редактируемые цены контрактов на трёх шагах</h4>
          <div class="btns" id="pr" style="margin:0 0 10px"></div>
          <div class="btns" id="dirs" style="margin:0 0 10px">
            <button class="b" data-d="1">Лонг спреда (купить дальний, продать ближний)</button>
            <button class="b" data-d="-1">Шорт спреда (продать дальний, купить ближний)</button>
          </div>
          <table class="t" id="inpt"></table>
        </div>
        <div class="viz calc-steps" id="steps"></div>
        <div class="viz">
          <h4>Пооперационная ведомость всех 6 сделок по ногам на бирже</h4>
          <table class="t" id="legs"></table>
        </div>`;

      const pr = el.querySelector('#pr');
      pr.innerHTML = R_PRESETS.map((p, i) => '<button class="b" data-i="' + i + '">' + p.name + '</button>').join('');
      pr.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        Object.assign(s4, R_PRESETS[+b.dataset.i]);
        build(); draw();
      });
      el.querySelector('#dirs').addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        s4.dir = +b.dataset.d;
        draw();
      });

      function inp(key, w) {
        return '<input type="number" step="0.5" data-k="' + key + '" value="' + s4[key] + '" style="width:' + (w || 86) + 'px;text-align:right">';
      }

      function build() {
        el.querySelector('#inpt').innerHTML =
          '<tr><th>Момент</th><th>Ближний контракт</th><th>Дальний контракт</th><th>Спред (Дальний − Ближний)</th></tr>' +
          '<tr><td>1. Вход (Март и Июнь)</td><td>Март: ' + inp('m0') + '</td><td>Июнь: ' + inp('j0') + '</td><td id="sp0"></td></tr>' +
          '<tr><td>2а. Ролл — закрытие старой (Март и Июнь)</td><td>Март: ' + inp('m1') + '</td><td>Июнь: ' + inp('j1') + '</td><td id="sp1"></td></tr>' +
          '<tr><td>2б. Ролл — открытие новой (Июнь и Сент.)</td><td>Июнь: <span id="j1dup"></span> (та же цена)</td><td>Сент.: ' + inp('s1') + '</td><td id="sp1n"></td></tr>' +
          '<tr><td>3. Выход (Июнь и Сент.)</td><td>Июнь: ' + inp('j2') + '</td><td>Сент.: ' + inp('s2') + '</td><td id="sp2"></td></tr>' +
          '<tr><td>Издержки (пунктов)</td><td>Вход + выход: ' + inp('cost', 72) + '</td><td>Перенос (ролл): ' + inp('rcost', 72) + '</td><td></td></tr>';
        el.querySelector('#inpt').querySelectorAll('input').forEach((x) => x.addEventListener('input', () => {
          s4[x.dataset.k] = parseFloat(x.value);
          draw();
        }));
      }

      const row = (k, title, text, val) => '<div class="row"><div class="n">' + k + '</div><div><b>' + title + '</b><div style="color:#98a3b6;font-size:14px">' + text + '</div>' + (val ? '<div class="v">' + val + '</div>' : '') + '</div></div>';

      function draw() {
        el.querySelector('#dirs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.d === s4.dir));
        const vals = [s4.m0, s4.j0, s4.m1, s4.j1, s4.s1, s4.j2, s4.s2, s4.cost, s4.rcost];
        if (vals.some(Number.isNaN)) {
          el.querySelector('#steps').innerHTML = '<div class="note warn">Заполните все поля числами.</div>';
          return;
        }
        const sp0 = s4.j0 - s4.m0, sp1 = s4.j1 - s4.m1, sp1n = s4.s1 - s4.j1, sp2 = s4.s2 - s4.j2;
        const gap = sp1n - sp1;
        el.querySelector('#j1dup').textContent = nz(s4.j1);
        el.querySelector('#sp0').innerHTML = '<b>' + U.sgn(sp0, 2) + '</b>';
        el.querySelector('#sp1').innerHTML = '<b>' + U.sgn(sp1, 2) + '</b>';
        el.querySelector('#sp1n').innerHTML = '<b>' + U.sgn(sp1n, 2) + '</b> (ступенька ' + U.sgn(gap, 2) + ')';
        el.querySelector('#sp2').innerHTML = '<b>' + U.sgn(sp2, 2) + '</b>';

        const d = s4.dir;
        const legM = -d * (s4.m1 - s4.m0), legJ_old = d * (s4.j1 - s4.j0), pnl1 = legM + legJ_old;
        const legJ_new = -d * (s4.j2 - s4.j1), legS = d * (s4.s2 - s4.s1), pnl2 = legJ_new + legS;
        const gross = pnl1 + pnl2;
        const net = gross - s4.cost - s4.rcost;
        const fakeGross = d * (sp2 - sp0);
        const stOut = sp2 - gap;

        el.querySelector('#steps').innerHTML =
          row(1, 'Результат в Серии 1 (Март–Июнь)', 'Спред изменился с ' + U.sgn(sp0, 2) + ' до ' + U.sgn(sp1, 2) + '.', 'Прибыль Серии 1 = ' + U.sgn(pnl1, 2) + ' п.') +
          row(2, 'Пересадка на ролле и ступенька склейки', 'Закрыли Март–Июнь по ' + U.sgn(sp1, 2) + ', открыли Июнь–Сент. по ' + U.sgn(sp1n, 2) + '. Разница ' + U.sgn(gap, 2) + ' — это ступенька склейки, на счёте от неё 0 ₽.', 'Ступенька gap = ' + U.sgn(gap, 2) + ' п.; платим издержки ролла −' + nz(s4.rcost) + ' п.') +
          row(3, 'Результат в Серии 2 (Июнь–Сентябрь)', 'Спред новой пары изменился с ' + U.sgn(sp1n, 2) + ' до ' + U.sgn(sp2, 2) + '.', 'Прибыль Серии 2 = ' + U.sgn(pnl2, 2) + ' п.') +
          row(4, 'Проверка через бесшовный спред', 'Бесшовный спред на выходе = ' + nz(sp2) + ' − (' + nz(gap) + ') = ' + nz(stOut) + '. Разница с входом (' + nz(sp0) + ') даёт ровно тот же валовый итог!', 'Валовый итог = ' + U.sgn(gross, 2) + ' п.;  чистый после всех издержек = <b>' + col(net, 2) + ' п.</b>') +
          row(5, 'Чему бы обманулась наивная формула без учёта ролла', 'Если вычесть сырой вход из сырого выхода (' + nz(sp2) + ' − ' + nz(sp0) + '), ступенька ' + U.sgn(gap, 2) + ' попадёт в «бумажную прибыль».', 'Бумажная иллюзия до издержек: ' + U.sgn(fakeGross, 2) + ' п. (ошибка на ' + U.sgn(fakeGross - gross, 2) + ' п.!)');

        const actNear = d === 1 ? 'Продали 1 → откупили 1' : 'Купили 1 → продали 1';
        const actFar = d === 1 ? 'Купили 1 → продали 1' : 'Продали 1 → откупили 1';
        el.querySelector('#legs').innerHTML =
          '<tr><th>Серия и контракт</th><th>Операции</th><th>Цена открытия</th><th>Цена закрытия</th><th>Итог ноги, п.</th></tr>' +
          '<tr><td>Серия 1 · Март (ближний)</td><td>' + actNear + '</td><td>' + nz(s4.m0) + '</td><td>' + nz(s4.m1) + '</td><td>' + col(legM, 2) + '</td></tr>' +
          '<tr><td>Серия 1 · Июнь (дальний)</td><td>' + actFar + '</td><td>' + nz(s4.j0) + '</td><td>' + nz(s4.j1) + '</td><td>' + col(legJ_old, 2) + '</td></tr>' +
          '<tr><td>Серия 2 · Июнь (теперь ближний!)</td><td>' + actNear + '</td><td>' + nz(s4.j1) + '</td><td>' + nz(s4.j2) + '</td><td>' + col(legJ_new, 2) + '</td></tr>' +
          '<tr><td>Серия 2 · Сентябрь (дальний)</td><td>' + actFar + '</td><td>' + nz(s4.s1) + '</td><td>' + nz(s4.s2) + '</td><td>' + col(legS, 2) + '</td></tr>' +
          '<tr><td colspan="4"><b>Сумма по всем четырём фьючерсным ногам (валовый итог)</b></td><td><b>' + col(gross, 2) + '</b></td></tr>' +
          '<tr><td colspan="4">Издержки входа/выхода (−' + nz(s4.cost) + ') и издержки ролла (−' + nz(s4.rcost) + ')</td><td>' + col(-(s4.cost + s4.rcost), 2) + '</td></tr>' +
          '<tr><td colspan="4"><b>Реальный чистый итог на брокерском счёте</b></td><td><b>' + col(net, 2) + '</b></td></tr>';
      }

      build();
      draw();
    }
  });
})();
