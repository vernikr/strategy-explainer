/* Коинтеграция, экраны 5–8: отбор пар из корзины и множественные проверки,
   правила и сделки со светофором связи, пошаговый разбор дня, честный эксперимент (#28). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, S = window.SPECS, HV = window.HV;
  const C = U.COLORS;
  const Z = (window.CSCREENS = window.CSCREENS || []);
  const SC = E.COINT_SCENARIOS;
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  const SIM = '#f5a65b', PRE = '#5aa9ff', ME = '#7ee0b5', BAD = '#ff6b6b', GREY = '#8b95a7', GOLD = '#ffd166';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 1 : d) + '</span>';

  /* ---------- 5. Отбор пар и ловушка «охоты за парами» ---------- */
  const s5 = { basket: 0, rule: 1, maxHL: 12, sel: 0, assets: 20 };
  const BASKETS = [7, 13, 21, 42];
  const SPLIT = 140;

  Z.push({
    id: 'screener',
    title: 'Отбор пар и ловушка «охоты за парами»',
    lead: 'На практике коинтеграцию чаще всего применяют как сито до начала торговли: из десятков пар-кандидатов оставляют только те, у которых спред ведёт себя как «резинка». Проверим, что из этого выходит на новых днях.',
    full: true,
    mount(el) {
      el.innerHTML = `
        <div class="note"><b>Честная постановка опыта.</b> У каждой из 16 пар ниже есть 320 дней истории. Мы делим её пополам без заглядывания в будущее (см. ${T('in_sample', 'обучающая и проверочная часть')}): на первых <b>${SPLIT} днях</b> отбираем пары, а на оставшихся <b>${320 - SPLIT} днях</b> торгуем только отобранные и считаем реальный итог.</div>

        <h3 style="margin:24px 0 10px">1. Сито из 16 кандидатов: сравните три способа отбора</h3>
        <div class="viz">
          <div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
            <div class="btns" id="rules" style="margin:0"></div>
            <div class="btns" id="baskets" style="margin:0"></div>
          </div>
          <div id="hlctl"></div>
          <div class="note" id="sum" style="margin-top:10px"></div>
          <div style="display:grid;grid-template-columns:1.35fr 1fr;gap:22px;margin-top:14px;align-items:start">
            <div class="scroll" style="max-height:470px"><table class="t" id="tab"></table></div>
            <div>
              <h4 id="ptitle" style="margin:0 0 4px"></h4>
              <p class="cap" id="pcap"></p>
              <div id="c1"></div>
              <h4 style="margin:14px 0 4px">Накопленный результат на будущих днях (${SPLIT + 1}–320)</h4>
              <div id="c2"></div>
            </div>
          </div>
        </div>

        <h3 style="margin:28px 0 10px">2. ${T('multiple_testing', 'Ловушка множественных проверок')}: почему нельзя перебирать всё подряд</h3>
        <div class="cols"><div class="text">
          <p>Когда порог теста настроен на 5%, это значит: если дать ему <b>абсолютно несвязанную случайную пару</b>, он ошибётся в среднем 1 раз из 20 (${T('false_positive', 'ложное срабатывание')}). Пока вы проверяете одну осмысленную пару — скажем, две марки нефти — риск невелик.</p>
          <p>Но компьютер позволяет за секунду сравнить каждый инструмент с каждым! Из K инструментов получается <b>K × (K − 1) ÷ 2</b> возможных пар. Уже у 30 фьючерсов это <b>435 пар</b>. Если связи нет ни у одной из них, порог 5% радостно найдёт около <b>22 «коинтегрированных» пар-призраков</b>!</p>
          <div class="note warn"><b>Золотое правило отбора пар.</b> Статистический тест — это <i>второй</i> фильтр, а не первый. Сначала спрашиваем: «почему эти два актива обязаны сходиться экономически?» (одно сырьё, одна компания, связанная цепочка производства). И только для экономически понятных пар запускаем расчёт τ и ${T('reversion_half', 'полувозврата T½')}.</div>
        </div><div>
          <div class="viz">
            <h4>Калькулятор «охотника за парами»</h4>
            <div id="mctl"></div>
            <table class="t" id="mtab" style="margin-top:10px"></table>
            <div class="note" id="mread"></div>
          </div>
        </div></div>`;

      const RULES = [
        ['Наивно: R² цен ≥ 0,80', (c) => c.r2 !== null && c.r2 >= 0.8],
        ['Коинтеграция: τ ≤ порог 5%', (c) => c.passed],
        ['Коинтеграция + быстрый T½', (c) => c.passed && c.halfLife !== null && c.halfLife <= s5.maxHL]
      ];
      const rulesEl = el.querySelector('#rules'), baskEl = el.querySelector('#baskets');
      rulesEl.innerHTML = RULES.map((r, i) => '<button class="b" data-i="' + i + '">' + r[0] + '</button>').join('');
      baskEl.innerHTML = BASKETS.map((b, i) => '<button class="b" data-i="' + i + '">корзина ' + (i + 1) + '</button>').join('');
      rulesEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s5.rule = +b.dataset.i; drawPool(); } });
      baskEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s5.basket = +b.dataset.i; drawPool(); } });

      HV.slider(el.querySelector('#hlctl'), {
        label: 'Максимальный полувозврат T½ (для третьего правила)', min: 4, max: 30, step: 2, value: s5.maxHL,
        fmt: (v) => 'не дольше ' + f(v, 0) + ' дн.',
        hint: 'Отсеивает вялые пары, у которых возврата приходится ждать слишком долго.',
        onInput: (v) => { s5.maxHL = v; if (s5.rule === 2) drawPool(); }
      });

      let rowsData = [];
      const c1 = A.mkChart(el.querySelector('#c1'), 190, {
        tip: (i) => {
          const cur = rowsData[s5.sel];
          return cur ? '<b>День ' + (i + 1) + (i < SPLIT ? ' (отбор)' : ' (проверка)') + '</b><br>остаток A − c − k·B: ' + f(cur.resAll[i]) : null;
        }
      });
      const c2 = A.mkChart(el.querySelector('#c2'), 155, {
        tip: (i) => {
          const cur = rowsData[s5.sel];
          return cur ? '<b>День ' + (i + 1) + '</b><br>результат на проверке: ' + f(cur.bt.equity[i]) + ' п.' : null;
        }
      });

      function drawSelected() {
        const cur = rowsData[s5.sel];
        if (!cur) return;
        el.querySelector('#ptitle').textContent = cur.p.name + ' (' + cur.p.kindLabel + ')';
        el.querySelector('#pcap').innerHTML = 'На отборе (дни 1–' + SPLIT + '): k = <b>' + f(cur.ct.k) + '</b>, R² = <b>' + f(cur.ct.r2) + '</b>, τ = <b>' + f(cur.ct.tau) + '</b> (порог ' + f(cur.ct.crit5) + '), T½ = <b>' + (cur.ct.halfLife === null ? '∞' : f(cur.ct.halfLife, 1) + ' дн.') + '</b>. Синяя полоса слева — участок отбора, справа — будущее.';
        c1.render({
          n: 320,
          series: [{ data: cur.resAll, color: cur.picked ? ME : SIM, width: 1.7 }],
          hlines: [{ y: 0, color: '#ffffff44', dash: [4, 4] }],
          spans: [{ i0: 0, i1: SPLIT - 1, color: '#5aa9ff14' }]
        });
        c2.render({
          n: 320,
          series: [{ data: cur.bt.equity, color: cur.bt.metrics.total >= 0 ? ME : BAD, width: 2.1 }],
          hlines: [{ y: 0, color: '#ffffff44', dash: [] }],
          spans: [{ i0: 0, i1: SPLIT - 1, color: '#5aa9ff14' }]
        });
      }

      function drawPool() {
        rulesEl.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s5.rule));
        baskEl.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s5.basket));
        const pool = E.genCointPool(BASKETS[s5.basket]);
        const check = RULES[s5.rule][1];
        const p = Object.assign(A.btParams(), { filterMode: 'none', startAt: SPLIT });
        rowsData = pool.map((pair) => {
          const ct = E.cointTest(pair.a.slice(0, SPLIT), pair.b.slice(0, SPLIT));
          const picked = check(ct);
          const bt = E.backtestCoint(pair.a, pair.b, p);
          const resAll = pair.a.map((y, i) => y - ct.alpha - ct.k * pair.b[i]);
          return { p: pair, ct, picked, bt, resAll };
        });

        let nPick = 0, nReal = 0, nFake = 0, tot = 0, dd = 0, tr = 0;
        rowsData.forEach((r) => {
          if (!r.picked) return;
          nPick++;
          if (r.p.kind === 'true' || r.p.kind === 'slow') nReal++;
          else nFake++;
          tot += r.bt.metrics.total;
          dd += r.bt.metrics.maxDD;
          tr += r.bt.metrics.count;
        });

        el.querySelector('#sum').innerHTML = 'Правило «<b>' + RULES[s5.rule][0] + '</b>» отобрало <b>' + nPick + ' из 16</b> пар: среди них действительно с возвратом в будущем <b>' + nReal + '</b>, а ловушек (без поводка или со сломом после отбора) — <b>' + nFake + '</b>. Если торговать все отобранные пары равными долями на днях ' + (SPLIT + 1) + '–320: сделок <b>' + tr + '</b>, суммарный итог ' + col(tot, 1) + ' п., сумма макс. просадок <b>' + f(-dd, 1) + '</b> п. Нажмите на любую строку таблицы, чтобы увидеть график пары.';

        el.querySelector('#tab').innerHTML =
          '<tr><th>Пара (истинная природа — скрыта в жизни)</th><th>R²</th><th>τ</th><th>T½</th><th>Сито</th><th>Будущее, п.</th></tr>' +
          rowsData.map((r, i) => '<tr class="click' + (i === s5.sel ? ' sel' : '') + '" data-i="' + i + '">' +
            '<td><b>' + r.p.name + '</b><br><span style="font-size:12px;color:#8b95a7">' + r.p.kindLabel + '</span></td>' +
            '<td>' + f(r.ct.r2, 2) + '</td>' +
            '<td class="' + (r.ct.passed ? 'pos' : '') + '">' + f(r.ct.tau, 2) + '</td>' +
            '<td>' + (r.ct.halfLife === null || r.ct.halfLife > 99 ? '∞' : f(r.ct.halfLife, 1)) + '</td>' +
            '<td>' + (r.picked ? '<span class="pill go">берём</span>' : '<span style="color:#8b95a7">отсев</span>') + '</td>' +
            '<td>' + col(r.bt.metrics.total, 1) + '</td></tr>').join('');

        el.querySelector('#tab').querySelectorAll('tr.click').forEach((trEl) => trEl.addEventListener('click', () => {
          s5.sel = +trEl.dataset.i;
          el.querySelector('#tab').querySelectorAll('tr.click').forEach((x, k) => x.classList.toggle('sel', k === s5.sel));
          drawSelected();
        }));
        drawSelected();
      }

      HV.slider(el.querySelector('#mctl'), {
        label: 'Сколько несвязанных инструментов свалили в общий перебор (K)', min: 5, max: 50, step: 5, value: s5.assets,
        fmt: (v) => f(v, 0) + ' инстр.',
        hint: 'Из K инструментов получается K·(K−1)÷2 пар для сравнения.',
        onInput: (v) => { s5.assets = v; drawMult(); }
      });

      function drawMult() {
        const K = s5.assets, pairs = (K * (K - 1)) / 2;
        const f10 = pairs * 0.10, f5 = pairs * 0.05, f1 = pairs * 0.01;
        el.querySelector('#mtab').innerHTML =
          '<tr><th>Строгость порога</th><th>Примерный порог τ</th><th>Ожидаемо «пройдут» случайно из ' + pairs + ' пустых пар</th></tr>' +
          '<tr><td>Мягкий (10%)</td><td>≈ −3,06</td><td><b>' + f(f10, 1) + '</b> пустых пар</td></tr>' +
          '<tr><td>Стандартный (5%)</td><td>≈ −3,36</td><td><b>' + f(f5, 1) + '</b> пустых пар</td></tr>' +
          '<tr><td>Строгий (1%)</td><td>≈ −3,94</td><td><b>' + f(f1, 1) + '</b> пустых пар</td></tr>';
        el.querySelector('#mread').innerHTML = 'При <b>' + K + '</b> инструментах компьютер проверит <b>' + pairs + '</b> пар. Даже если на рынке нет ни одной настоящей связи, стандартный порог 5% принесёт вам около <b>' + Math.round(f5) + '</b> «красивых находок» чисто случайно. При широком переборе всегда ужесточают порог (например, до 1%) и требуют понятную экономическую связь.';
      }

      drawPool();
      drawMult();
    }
  });

  /* ---------- 6. Правила и сделки со светофором связи ---------- */
  const s6 = { scn: 2, cointWin: 100, tauMax: -3.39 };

  Z.push({
    id: 'trades',
    title: 'Правила и сделки со светофором связи',
    lead: 'Соединим динамический хедж с проверкой коинтеграции. Правила входа и выхода по z-score не меняются — добавляется «светофор», который не пускает в новые сделки, если связь не подтверждена.',
    text: () => `
      <h3>Два способа встроить проверку</h3>
      <ol>
        <li><b>Отбор на старте (один раз).</b> На первых M днях считаем ${T('tau_stat', 'τ-статистику')}. Если τ левее порога — дальше торгуем пару обычным динамическим хеджем; если правее — вообще не трогаем её.</li>
        <li><b>Скользящий светофор (каждый день).</b> Перед каждым новым входом проверяем коинтеграцию по последним M дням. Если τ ≤ порога — горит <span class="pill go">зелёный свет</span>, сигнал z открывает сделку. Если τ поднялась правее порога — горит <span class="pill stop">красный свет</span>: спред может сколько угодно пробивать ±2σ, но <b>новые сделки не открываются</b> (серые кружки ○ на графике справа).</li>
      </ol>
      <h3>Важная деталь: выход никогда не блокируется!</h3>
      <p>Если позиция уже была открыта при зелёном свете, а затем светофор покраснел, правила закрытия (цель по возврату, ${T('stop', 'стоп-лосс')}, лимит времени) продолжают работать штатно. Блокировать выход было бы катастрофой: это оставило бы вас запертым в расходящейся позиции.</p>
      <h3>Зачем здесь два разных окна — M и N</h3>
      <p>Обратите внимание: для z-score берётся короткое окно <b>N</b> (например, 30 дней), а для проверки коинтеграции — длинное окно <b>M</b> (например, 100 дней). Это не случайность:</p>
      <ul>
        <li>z-score ищет <i>короткое свежее отклонение</i> от недавнего уровня;</li>
        <li>${T('dickey_fuller', 'тесту Дики — Фуллера')} нужно увидеть несколько полных циклов отхода и возврата — на 25–30 днях его ${T('test_power', 'мощность')} слишком мала, и он будет браковать даже отличные пары.</li>
      </ul>
      <p>Посмотрите справа сценарий «Поводок рвётся на 150-м дне»: отбор на старте видит крепкую связь в начале и идёт торговать сломанную пару, а скользящий светофор замечает поломку и гасит серию убыточных входов.</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Сценарий и параметры светофора</h4>
          <div class="btns" id="tabs" style="margin:0 0 8px"></div>
          <p id="snote" style="margin:0 0 10px;color:#98a3b6"></p>
          <div id="cctl"></div>
          <div id="ctl"></div>
        </div>
        <div class="viz">
          <h4>Z-score и сделки скользящего светофора</h4>
          <div class="legend">
            <span><i class="dot" style="background:${C.up}"></i>▲ вход лонг</span>
            <span><i class="dot" style="background:${C.down}"></i>▼ вход шорт</span>
            <span><i class="dot" style="background:${C.exit}"></i>✕ выход</span>
            <span><i class="dot" style="background:${GREY}"></i>○ вход заблокирован светофором</span>
          </div>
          <div id="c1"></div>
        </div>
        <div class="viz">
          <h4>τ-статистика по скользящему окну M (зелёные зоны — вход разрешён)</h4>
          <div id="c2"></div>
        </div>
        <div class="viz">
          <h4>Сравнение накопленного результата (торговля с дня M + 1, чтобы условия были равными)</h4>
          <div class="legend">
            <span><i style="background:${SIM}"></i>хедж без проверки</span>
            <span><i style="background:${PRE}"></i>отбор на старте</span>
            <span><i style="background:${ME}"></i>скользящий светофор</span>
          </div>
          <div id="c3"></div>
          <table class="t" id="tab" style="margin-top:10px"></table>
        </div>`;

      const tabs = el.querySelector('#tabs');
      tabs.innerHTML = SC.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.scn = +b.dataset.i; draw(); } });

      const cctl = el.querySelector('#cctl');
      cctl.className = 'controls';
      HV.slider(cctl, {
        label: 'Окно проверки связи M', min: 60, max: 160, step: 10, value: s6.cointWin,
        fmt: (v) => f(v, 0) + ' дн.',
        hint: 'По скольким последним дням проверяется коинтеграция.',
        onInput: (v) => { s6.cointWin = v; draw(); }
      });
      HV.slider(cctl, {
        label: 'Порог светофора для τ', min: -4.2, max: -2.4, step: 0.1, value: s6.tauMax,
        fmt: (v) => f(v, 2),
        hint: 'Левее (например, −3,8) — строже фильтр; правее (−2,8) — мягче, больше ложных входов.',
        onInput: (v) => { s6.tauMax = v; draw(); }
      });
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost], draw);

      let d, rNo, rPre, rRoll;
      const c1 = A.mkChart(el.querySelector('#c1'), 210, {
        tip: (i) => (rRoll.z[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>z-score: <b>' + f(rRoll.z[i]) + '</b>' + (rRoll.blocked[i] ? '<br><span style="color:#ffd166">вход заблокирован светофором</span>' : ''))
      });
      const c2 = A.mkChart(el.querySelector('#c2'), 165, {
        tip: (i) => (rRoll.coint.tau[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>τ: <b>' + f(rRoll.coint.tau[i], 2) + '</b> (порог ' + f(s6.tauMax, 2) + ')<br>светофор: ' + (rRoll.coint.ok[i] ? '<span class="pos">зелёный</span>' : '<span class="neg">красный</span>'))
      });
      const c3 = A.mkChart(el.querySelector('#c3'), 180, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>без проверки: ' + f(rNo.equity[i]) + '<br>отбор на старте: ' + f(rPre.equity[i]) + '<br>скользящий: ' + f(rRoll.equity[i])
      });

      function greenSpans(okArr) {
        const out = [];
        let s = null;
        for (let i = 0; i < okArr.length; i++) {
          if (okArr[i] && s === null) s = i;
          if (!okArr[i] && s !== null) { out.push({ i0: s, i1: i - 1, color: '#35d07f1a' }); s = null; }
        }
        if (s !== null) out.push({ i0: s, i1: okArr.length - 1, color: '#35d07f1a' });
        return out;
      }

      function draw() {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s6.scn));
        el.querySelector('#snote').textContent = SC[s6.scn].note;
        d = E.genCoint(A.state.seed, SC[s6.scn]);
        const M = s6.cointWin, base = A.btParams(), n = d.a.length;
        rNo = E.backtestCoint(d.a, d.b, Object.assign({}, base, { filterMode: 'none', startAt: M }));
        rPre = E.backtestCoint(d.a, d.b, Object.assign({}, base, { filterMode: 'prescreen', cointWin: M, tauMax: s6.tauMax }));
        rRoll = E.backtestCoint(d.a, d.b, Object.assign({}, base, { filterMode: 'rolling', cointWin: M, tauMax: s6.tauMax, startAt: M }));

        const p = A.state.params, lim = Math.max(6, p.stopZ + 0.5);
        const mk = A.tradeMarkers(rRoll, (i) => rRoll.z[i]);
        rRoll.blocked.forEach((b, i) => { if (b && rRoll.z[i] !== null) mk.push({ i, y: rRoll.z[i], kind: 'ring', color: GREY, size: 5 }); });
        c1.render({ n, series: [{ data: rRoll.z, color: C.z }], hlines: A.zLines(p), spans: A.positionSpans(rRoll), markers: mk, yMin: -lim, yMax: lim });

        c2.render({
          n,
          series: [{ data: rRoll.coint.tau, color: ME, width: 2 }],
          hlines: [{ y: s6.tauMax, color: GOLD, label: 'порог τ = ' + f(s6.tauMax, 2), dash: [6, 4] }, { y: 0, color: '#ffffff33', dash: [] }],
          spans: greenSpans(rRoll.coint.ok),
          yMin: -6.5, yMax: 1
        });

        c3.render({
          n,
          series: [
            { data: rNo.equity, color: SIM, width: 2 },
            { data: rPre.equity, color: PRE, width: 2, dash: [6, 4] },
            { data: rRoll.equity, color: ME, width: 2.5 }
          ],
          hlines: [{ y: 0, color: '#ffffff44', dash: [] }]
        });

        const nBlocked = rRoll.blocked.filter(Boolean).length;
        const preBadge = rPre.prescreen.filterOk ? '<span class="pos">прошла (τ = ' + f(rPre.prescreen.tau, 2) + ')</span>' : '<span class="neg">отсеяна (τ = ' + f(rPre.prescreen.tau, 2) + ')</span>';
        el.querySelector('#tab').innerHTML =
          '<tr><th>Режим (дни ' + (M + 1) + '–' + n + ')</th><th>Сделок</th><th>Отклонено сигналов входа</th><th>Итог, п.</th><th>Макс. просадка</th><th>Примечание</th></tr>' +
          '<tr><td style="color:' + SIM + '">Хедж без проверки</td><td>' + rNo.metrics.count + '</td><td>0</td><td>' + col(rNo.metrics.total) + '</td><td>' + f(-rNo.metrics.maxDD, 1) + '</td><td>торгует любой сигнал z</td></tr>' +
          '<tr><td style="color:' + PRE + '">Отбор на старте (дни 1–' + M + ')</td><td>' + rPre.metrics.count + '</td><td>' + rPre.blocked.filter(Boolean).length + '</td><td>' + col(rPre.metrics.total) + '</td><td>' + f(-rPre.metrics.maxDD, 1) + '</td><td>на старте: ' + preBadge + '</td></tr>' +
          '<tr><td style="color:' + ME + '"><b>Скользящий светофор</b></td><td><b>' + rRoll.metrics.count + '</b></td><td><b>' + nBlocked + '</b></td><td><b>' + col(rRoll.metrics.total) + '</b></td><td><b>' + f(-rRoll.metrics.maxDD, 1) + '</b></td><td>зелёный свет в ' + rRoll.coint.ok.slice(M).filter(Boolean).length + ' из ' + (n - M) + ' дн.</td></tr>';
      }
      draw();
    }
  });

  /* ---------- 7. Пошаговый разбор одного дня ---------- */
  const s7 = { scn: 2, cointWin: 100, tauMax: -3.39, day: null };

  Z.push({
    id: 'day',
    title: 'Пошаговый разбор одного дня',
    lead: 'Выберите любой день и проследите всю цепочку расчёта изнутри: от проверки коинтеграции на длинном окне M до сигнала z-score на коротком окне N и итогового решения со светофором.',
    full: true,
    mount(el) {
      el.innerHTML = `
        <div style="display:grid;grid-template-columns:560px 1fr;gap:28px;align-items:start">
          <div>
            <div class="viz"><h4>Сценарий данных</h4><div class="btns" id="tabs" style="margin:0 0 8px"></div><p id="snote" style="margin:0;color:#98a3b6"></p></div>
            <div class="viz"><h4>Выбор дня: <span id="dayv"></span></h4><input type="range" id="day" style="margin-top:8px">
              <div class="btns">
                <button class="b" id="bp">◀ День назад</button>
                <button class="b" id="bn">День вперёд ▶</button>
                <button class="b" id="bs">К следующей сделке</button>
                <button class="b" id="bb">К заблокированному входу</button>
                <button class="b primary" id="play">▶ Автопроигрывание</button>
              </div>
            </div>
            <div class="viz calc-steps" id="steps"></div>
            <div class="viz"><h4>Настройки</h4><div id="cctl"></div><div id="ctl"></div></div>
          </div>
          <div>
            <div class="viz"><h4>Окно проверки M: вчерашний остаток e<sub>t−1</sub> и шаг Δe<sub>t</sub></h4><p class="cap">Жёлтая точка — сегодняшний переход. Прямая показывает наклон возврата b.</p><div id="sc"></div></div>
            <div class="viz"><h4>Светофор коинтеграции: τ-статистика и порог</h4><div id="c1"></div></div>
            <div class="viz"><h4>Z-score на окне N (кружки ○ — заблокированные светофором входы)</h4><div id="c2"></div></div>
            <div class="viz"><h4>Последние переходы остатка в окне проверки M</h4><div class="scroll" style="max-height:290px"><table class="t" id="win"></table></div></div>
          </div>
        </div>`;

      el.querySelector('#sc').innerHTML = '<div class="chartbox"><canvas></canvas></div>';
      const scat = new HV.Scatter(el.querySelector('#sc canvas'), {
        height: 250,
        tip: (p) => '<b>День ' + (p.idx + 1) + '</b><br>вчера e<sub>t−1</sub>: ' + f(p.x) + '<br>шаг Δe<sub>t</sub>: ' + U.sgn(p.y, 2)
      });
      const tabs = el.querySelector('#tabs');
      tabs.innerHTML = SC.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s7.scn = +b.dataset.i; draw(); } });

      const cctl = el.querySelector('#cctl');
      cctl.className = 'controls';
      HV.slider(cctl, { label: 'Окно проверки M', min: 60, max: 150, step: 10, value: s7.cointWin, fmt: (v) => f(v, 0) + ' дн.', hint: 'Окно теста коинтеграции.', onInput: (v) => { s7.cointWin = v; draw(); } });
      HV.slider(cctl, { label: 'Порог τ', min: -4.2, max: -2.4, step: 0.1, value: s7.tauMax, fmt: (v) => f(v, 2), hint: 'Граница зелёного света.', onInput: (v) => { s7.tauMax = v; draw(); } });
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost], draw);

      let d, r;
      const n = 320;
      const day = el.querySelector('#day');
      day.min = 1; day.max = n; day.step = 1;
      const c1 = A.mkChart(el.querySelector('#c1'), 155, { onClick: (i) => { s7.day = i; draw(); }, tip: (i) => (r.coint.tau[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>τ: <b>' + f(r.coint.tau[i], 2) + '</b>') });
      const c2 = A.mkChart(el.querySelector('#c2'), 175, { onClick: (i) => { s7.day = i; draw(); }, tip: (i) => (r.z[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>z-score: <b>' + f(r.z[i], 2) + '</b>') });

      const minBar = () => Math.max(s7.cointWin, A.state.params.n) - 1;
      const firstSig = () => { const i = r.signal.findIndex((x) => x); return i >= 0 ? i : minBar(); };
      day.addEventListener('input', () => { s7.day = parseInt(day.value, 10) - 1; draw(); });
      el.querySelector('#bp').addEventListener('click', () => { s7.day = Math.max(minBar(), s7.day - 1); draw(); });
      el.querySelector('#bn').addEventListener('click', () => { s7.day = Math.min(n - 1, s7.day + 1); draw(); });
      el.querySelector('#bs').addEventListener('click', () => { let i = s7.day + 1; while (i < n && !r.signal[i]) i++; s7.day = i < n ? i : firstSig(); draw(); });
      el.querySelector('#bb').addEventListener('click', () => {
        let i = s7.day + 1;
        while (i < n && !r.blocked[i]) i++;
        if (i >= n) { i = 0; while (i < n && !r.blocked[i]) i++; }
        if (i < n) { s7.day = i; draw(); }
      });
      el.querySelector('#play').addEventListener('click', (ev) => {
        if (window.__stepTimer) { clearInterval(window.__stepTimer); window.__stepTimer = null; ev.target.textContent = '▶ Автопроигрывание'; return; }
        ev.target.textContent = '❚❚ Пауза';
        window.__stepTimer = setInterval(() => {
          if (s7.day >= n - 1) { clearInterval(window.__stepTimer); window.__stepTimer = null; ev.target.textContent = '▶ Автопроигрывание'; return; }
          s7.day++; draw();
        }, 350);
      });

      const row = (k, title, text, val) => '<div class="row"><div class="n">' + k + '</div><div><b>' + title + '</b><div style="color:#98a3b6;font-size:14px">' + text + '</div>' + (val ? '<div class="v">' + val + '</div>' : '') + '</div></div>';

      function draw() {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s7.scn));
        el.querySelector('#snote').textContent = SC[s7.scn].note;
        d = E.genCoint(A.state.seed, SC[s7.scn]);
        const M = s7.cointWin, p = A.state.params, N = p.n;
        r = E.backtestCoint(d.a, d.b, Object.assign(A.btParams(), { filterMode: 'rolling', cointWin: M, tauMax: s7.tauMax, startAt: M - 1 }));
        if (s7.day === null) s7.day = firstSig();
        if (s7.day < minBar()) s7.day = minBar();
        const t = s7.day;
        day.value = t + 1;
        el.querySelector('#dayv').textContent = 'день ' + (t + 1) + ' из ' + n;

        const ex = E.explainCoint(d.a, d.b, M, N, t, { tauMax: s7.tauMax });
        if (!ex || !ex.hedge) { el.querySelector('#steps').innerHTML = '<div class="note">Для этого дня расчёт невозможен.</div>'; return; }
        const ct = ex.coint, hg = ex.hedge;
        let dec = A.decisionText(t, r, r.params);
        if (r.blocked[t]) {
          const dirTxt = r.blocked[t].dir === 1 ? 'лонг спреда' : 'шорт спреда';
          dec = {
            cls: 'close',
            html: '<p>z = <b>' + f(hg.z, 2) + '</b> пересёк порог входа (±' + f(p.entryZ) + ') для сделки «' + dirTxt + '».</p><p><b>Решение: ВХОД ЗАБЛОКИРОВАН</b> — светофор коинтеграции красный (τ = ' + f(ct.tau, 2) + ' правее порога ' + f(s7.tauMax, 2) + '). Остаёмся вне рынка.</p>'
          };
        }

        el.querySelector('#steps').innerHTML =
          row(1, 'Окно проверки связи M', 'Дни с ' + (t - M + 2) + '-го по ' + (t + 1) + '-й (' + M + ' дн.). Проводим регрессию A ≈ c + k·B и берём остатки e.', 'k(M) = ' + f(ct.k, 3) + ',  c = ' + f(ct.alpha, 2) + ',  R² = ' + f(ct.r2, 2)) +
          row(2, 'Регрессия возврата Δe на вчерашний остаток', 'По ' + ct.m + ' переходам: Σ(e<sub>вчера</sub> − ē)² = ' + f(ct.sxx, 1) + ', Σ произведений = ' + f(ct.sxy, 1) + '.', 'b = ' + f(ct.b, 3) + ',  se(b) = ' + f(ct.se, 3) + ',  T½ = ' + (ct.halfLife === null ? '∞' : f(ct.halfLife, 1) + ' дн.')) +
          row(3, 'τ-статистика и светофор', 'Делим b на se(b) и сравниваем с порогом ' + f(s7.tauMax, 2) + '.', 'τ = ' + f(ct.b, 3) + ' ÷ ' + f(ct.se, 3) + ' = <b>' + f(ct.tau, 2) + '</b> → ' + (ex.ok ? '<span class="pos">ЗЕЛЁНЫЙ СВЕТ (связь подтверждена)</span>' : '<span class="neg">КРАСНЫЙ СВЕТ (новые входы закрыты)</span>')) +
          row(4, 'Окно сигнала N и свежий спред', 'Последние N = ' + N + ' дн. (дни ' + (t - N + 2) + '–' + (t + 1) + '): свежий k = ' + f(hg.k, 3) + ', сегодняшний спред A − k·B = ' + f(hg.value, 2) + '.', 'среднее = ' + f(hg.mean, 2) + ',  σ = ' + f(hg.std, 2) + ',  <b>z = ' + f(hg.z, 2) + '</b>') +
          '<div class="row"><div class="n">5</div><div><b>Итоговое решение</b><div class="decision ' + dec.cls + '">' + dec.html + '</div></div></div>';

        scat.render({
          points: ex.steps.map((q, j) => ({ x: q.prev, y: q.step, idx: q.idx, hot: j === ex.steps.length - 1 })),
          lines: [{ k: 0, alpha: 0, color: '#ffffff33', width: 1, dash: [4, 4] }, { k: ct.b, alpha: ct.a, color: ex.ok ? ME : SIM, width: 2.3 }],
          xLabel: 'вчера e(t−1)', yLabel: 'шаг Δe(t)'
        });
        c1.render({
          n, series: [{ data: r.coint.tau, color: ME, width: 1.9 }],
          hlines: [{ y: s7.tauMax, color: GOLD, label: 'порог ' + f(s7.tauMax, 2), dash: [6, 4] }, { y: 0, color: '#ffffff33', dash: [] }],
          spans: [{ i0: t - M + 1, i1: t, color: ex.ok ? '#35d07f1e' : '#ff6b6b1c' }],
          cursor: t, yMin: -6.5, yMax: 1
        });
        const lim = Math.max(5.5, p.stopZ + 0.5);
        const mk = A.tradeMarkers(r, (i) => r.z[i]);
        r.blocked.forEach((b, i) => { if (b && r.z[i] !== null) mk.push({ i, y: r.z[i], kind: 'ring', color: GREY, size: 5 }); });
        c2.render({ n, series: [{ data: r.z, color: C.z }], hlines: A.zLines(p), spans: [{ i0: t - N + 1, i1: t, color: '#c9b6ff1c' }], cursor: t, markers: mk, yMin: -lim, yMax: lim });

        const tail = ex.steps.slice(-20);
        el.querySelector('#win').innerHTML =
          '<tr><th>День</th><th>вчера e<sub>t−1</sub></th><th>сегодня e<sub>t</sub></th><th>шаг Δe<sub>t</sub></th><th>dX²</th><th>dX·dY</th></tr>' +
          tail.map((q, j) => '<tr' + (j === tail.length - 1 ? ' class="sel"' : '') + '><td>' + (q.idx + 1) + '</td><td>' + f(q.prev) + '</td><td>' + f(q.cur) + '</td><td>' + U.sgn(q.step, 2) + '</td><td>' + f(q.dxx) + '</td><td>' + U.sgn(q.dxy, 2) + '</td></tr>').join('');
      }
      draw();
    }
  });

  /* ---------- 8. Когда помогает и когда вредит ---------- */
  const s8 = { scn: 0, cointWin: 100, tauMax: -3.39 };
  const MS = [40, 60, 80, 100, 130, 160, 200];
  let powCache = null;

  function powerCurves() {
    if (powCache) return powCache;
    // Доля окон с зелёным светом (по стандартному 5%-му порогу egCrit(M, 5)) для [Устойчивая связь, Медленная резинка, Без поводка]
    const idxs = [0, 3, 1];
    powCache = idxs.map((si) => MS.map((m) => {
      let ok = 0, tot = 0;
      SEEDS.forEach((sd) => {
        const d = E.genCoint(sd, SC[si]);
        const rc = E.rollingCoint(d.a, d.b, m);
        for (let t = 200; t < d.a.length; t++) { tot++; if (rc.ok[t]) ok++; }
      });
      return (100 * ok) / tot;
    }));
    return powCache;
  }

  Z.push({
    id: 'verdict',
    title: 'Когда помогает и когда вредит',
    lead: 'Коинтеграция не предсказывает будущее — она лишь проверяет, вела ли себя пара как «резинка» на недавней истории. Посмотрим на честном эксперименте, где этот фильтр спасает счёт, а где мешает заработать.',
    full: true,
    mount(el) {
      el.innerHTML = `
        <div class="note warn"><b>Честные равные условия.</b> Все три подхода проверяются строго на одних и тех же торговых днях (с дня M + 1 по 320-й день) на 11 разных случайных наборах данных в каждом сценарии. Вся разница в цифрах возникает исключительно из-за фильтра коинтеграции.</div>

        <h3 style="margin:26px 0 10px">1. Эксперимент: четыре сценария, 11 наборов, три подхода</h3>
        <div class="viz">
          <div class="btns" id="tabs" style="margin:0 0 10px"></div>
          <p id="snote" style="margin:0 0 10px;color:#98a3b6"></p>
          <div id="cctl"></div>
          <div id="ctl"></div>
          <div class="note" id="sum" style="margin-top:10px"></div>
          <div class="scroll" style="max-height:none;margin-top:12px"><table class="t" id="tab"></table></div>
        </div>

        <h3 style="margin:30px 0 10px">2. Почему тест слепнет на коротком окне и вялых парах (${T('test_power', 'мощность теста')})</h3>
        <div class="cols"><div class="text">
          <p>У любого статистического теста две возможные ошибки, и уменьшить обе сразу на коротком окне нельзя:</p>
          <ul>
            <li><b>Пропустить пустышку (${T('false_positive', 'ложное срабатывание')}):</b> связи нет, а тест сказал «есть». Порог Энгла — Грейнджера специально держит эту ошибку около 5% на любой длине окна (красная линия справа внизу).</li>
            <li><b>Забраковать рабочую пару (нехватка ${T('test_power', 'мощности')}):</b> связь настоящая, но данных в окне M мало, и тест осторожно отвечает «не доказано».</li>
          </ul>
          <p>График справа показывает, в какой доле дней горит «зелёный свет» при разных длинах окна проверки M:</p>
          <ul>
            <li>На <b style="color:${ME}">быстрой резинке</b> (полувозврат ~3 дня) при M = 40 тест узнаёт связь меньше чем в половине дней, зато к M = 100–130 мощность превышает 80–90%.</li>
            <li>На <b style="color:${PRE}">медленной резинке</b> (полувозврат ~15 дней) даже окно в 100 дней узнаёт связь редко: спред просто не успевает совершить достаточно возвратов внутри окна!</li>
          </ul>
        </div><div>
          <div class="viz">
            <h4>Как часто горит «зелёный свет» при разной длине окна M, % дней</h4>
            <div class="legend">
              <span><i style="background:${ME}"></i>устойчивая быстрая резинка</span>
              <span><i style="background:${PRE}"></i>медленная («вялая») резинка</span>
              <span><i style="background:${BAD}"></i>ложная пара без поводка (~5%)</span>
            </div>
            <div id="pc"></div>
            <div id="pt" style="margin-top:10px"></div>
          </div>
        </div></div>

        <h3 style="margin:30px 0 14px">3. Итоги простыми словами</h3>
        <div class="cards" id="cards"></div>

        <div class="viz" style="margin-top:22px">
          <h4>Чек-лист: пять вопросов перед торговлей пары по коинтеграции</h4>
          <ol style="margin:8px 0 0;padding-left:22px;max-width:980px">
            <li><b>Есть ли понятная экономическая связь?</b> Если два фьючерса никак не связаны в реальной экономике, красивый τ почти наверняка — результат ${T('multiple_testing', 'случайного перебора')}.</li>
            <li><b>Хватает ли длины окна M относительно полувозврата T½?</b> Окно проверки должно вмещать хотя бы 6–10 периодов ${T('reversion_half', 'полувозврата')}: пару с T½ = 15 дней бессмысленно проверять окном в 40 дней.</li>
            <li><b>Используете ли вы правильный порог?</b> Для остатков регрессии двух цен нужен порог ${T('engle_granger', 'Энгла — Грейнджера')} (около −3,34 для 5%, а при массовом отборе пар — −3,90 для 1%), а не обычные «−2 ошибки».</li>
            <li><b>Что защищает открытую сделку, если связь порвётся сегодня?</b> Тест смотрит только в прошлое и реагирует на слом с опозданием. Внутри открытой позиции защищают лишь ${T('stop', 'стоп-лосс')} и ограничение размера позиции.</li>
            <li><b>Хватает ли размаха «резинки» после издержек?</b> Пара может быть идеально коинтегрированной с узким коридором в 1 пункт — и при комиссиях в 1,5 пункта приносить гарантированный убыток.</li>
          </ol>
        </div>`;

      const tabs = el.querySelector('#tabs');
      tabs.innerHTML = SC.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s8.scn = +b.dataset.i; drawTable(); } });

      const cctl = el.querySelector('#cctl');
      cctl.className = 'controls';
      HV.slider(cctl, { label: 'Окно проверки связи M', min: 60, max: 160, step: 10, value: s8.cointWin, fmt: (v) => f(v, 0) + ' дн.', hint: 'Дни 1..M идут на стартовую проверку; торговля сравнивается на днях (M+1)..320.', onInput: (v) => { s8.cointWin = v; drawTable(); } });
      HV.slider(cctl, { label: 'Порог τ', min: -4.2, max: -2.4, step: 0.1, value: s8.tauMax, fmt: (v) => f(v, 2), hint: 'Порог Энгла — Грейнджера для 5% равен около −3,39.', onInput: (v) => { s8.tauMax = v; drawTable(); } });
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost], drawTable);

      const MODES = [['n', 'Хедж без проверки', SIM], ['p', 'Отбор на старте', PRE], ['r', 'Скользящий светофор', ME]];

      function drawTable() {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s8.scn));
        const sc = SC[s8.scn], M = s8.cointWin, base = A.btParams();
        el.querySelector('#snote').textContent = sc.note;
        const tot = { n: 0, p: 0, r: 0 }, dd = { n: 0, p: 0, r: 0 }, cn = { n: 0, p: 0, r: 0 };
        let passedPre = 0;
        const rows = SEEDS.map((sd) => {
          const d = E.genCoint(sd, sc);
          const m = {
            n: E.backtestCoint(d.a, d.b, Object.assign({}, base, { filterMode: 'none', startAt: M })).metrics,
            p: E.backtestCoint(d.a, d.b, Object.assign({}, base, { filterMode: 'prescreen', cointWin: M, tauMax: s8.tauMax })),
            r: E.backtestCoint(d.a, d.b, Object.assign({}, base, { filterMode: 'rolling', cointWin: M, tauMax: s8.tauMax, startAt: M })).metrics
          };
          if (m.p.prescreen.filterOk) passedPre++;
          m.p = m.p.metrics;
          MODES.forEach(([k]) => { tot[k] += m[k].total; dd[k] += m[k].maxDD; cn[k] += m[k].count; });
          return '<tr><td>Набор ' + sd + '</td>' + MODES.map(([k]) => '<td>' + m[k].count + '</td><td>' + col(m[k].total) + '</td><td>' + f(-m[k].maxDD, 1) + '</td>').join('') + '</tr>';
        });
        el.querySelector('#tab').innerHTML =
          '<tr><th rowspan="2"></th>' + MODES.map(([, name, c]) => '<th colspan="3" style="text-align:center;color:' + c + '">' + name + '</th>').join('') + '</tr>' +
          '<tr>' + MODES.map(() => '<th>сделок</th><th>итог</th><th>макс. просадка</th>').join('') + '</tr>' +
          rows.join('') +
          '<tr><td><b>Сумма</b></td>' + MODES.map(([k]) => '<td><b>' + cn[k] + '</b></td><td><b>' + col(tot[k]) + '</b></td><td><b>' + f(-dd[k], 1) + '</b></td>').join('') + '</tr>';

        el.querySelector('#sum').innerHTML = 'Сценарий «<b>' + sc.name + '</b>» (торговля на днях ' + (M + 1) + '–320). Отбор на старте пропустил <b>' + passedPre + ' из ' + SEEDS.length + '</b> наборов. ' +
          'Число сделок: без проверки <b>' + cn.n + '</b>, отбор на старте <b>' + cn.p + '</b>, скользящий светофор <b>' + cn.r + '</b>. ' +
          'Сумма итогов: ' + col(tot.n, 0) + ' / ' + col(tot.p, 0) + ' / ' + col(tot.r, 0) + '; сумма максимальных просадок: <b>' + f(-dd.n, 0) + '</b> / <b>' + f(-dd.p, 0) + '</b> / <b>' + f(-dd.r, 0) + '</b> п.';
      }

      const pc = A.mkChart(el.querySelector('#pc'), 210, {
        xfmt: (i) => (MS[i] === undefined ? '' : 'M=' + MS[i]),
        tip: (i) => (MS[i] === undefined ? null : '<b>Окно M = ' + MS[i] + ' дн.</b><br>быстрая резинка: ' + f(powerCurves()[0][i], 0) + '%<br>медленная резинка: ' + f(powerCurves()[1][i], 0) + '%<br>без поводка: ' + f(powerCurves()[2][i], 1) + '%')
      });
      function drawPower() {
        const pw = powerCurves();
        pc.render({
          n: MS.length,
          series: [
            { data: pw[0], color: ME, width: 2.4 },
            { data: pw[1], color: PRE, width: 2.4 },
            { data: pw[2], color: BAD, width: 2, dash: [5, 4] }
          ],
          yMin: 0, yMax: 100
        });
        el.querySelector('#pt').innerHTML = '<table class="t"><tr><th>Окно M</th>' + MS.map((m) => '<th>' + m + '</th>').join('') + '</tr>' +
          '<tr><td style="color:' + ME + '">Быстрая резинка</td>' + pw[0].map((v) => '<td>' + f(v, 0) + '%</td>').join('') + '</tr>' +
          '<tr><td style="color:' + PRE + '">Медленная резинка</td>' + pw[1].map((v) => '<td>' + f(v, 0) + '%</td>').join('') + '</tr>' +
          '<tr><td style="color:' + BAD + '">Без поводка</td>' + pw[2].map((v) => '<td>' + f(v, 1) + '%</td>').join('') + '</tr></table>';
      }

      const cards = [
        ['Главный выигрыш — защита от пустышек', 'На парах без поводка фильтр коинтеграции сокращает число пустых сделок и суммарную просадку в разы (в сценарии без поводка — со 109 сделок до нескольких штук и с просадки ~450 до ~50–65 п.). Он не даёт торговать красивый R², за которым нет возврата.'],
        ['Чем платим на хороших парах', 'На настоящей коинтегрированной паре фильтр ничего не улучшает в самой формуле спреда — он может только иногда усомниться из-за шума и пропустить часть хороших сделок (поэтому в первом сценарии хедж без фильтра зарабатывает чуть больше).'],
        ['Редкие ложные срабатывания болезненны', 'Даже на пустой паре примерно в 5% случаев случайное блуждание временно сжимается так удачно, что пробивает порог −3,39, а при выходе из сжатия бьёт по стопу. Тест резко снижает частоту входа в мусор, но не делает её нулевой.'],
        ['Отбор на старте слеп к будущему слому', 'В третьем сценарии первые 100 дней связь безупречна — стартовый отбор одобряет 9 из 11 наборов, а на 150-м дне поводок рвётся, и стратегия терпит тяжёлые убытки. Прошлая коинтеграция — не пожизненная гарантия.'],
        ['Скользящий светофор выключает сломанную пару', 'В том же сценарии со сломом связи скользящий фильтр замечает, что остатки перестали возвращаться, гасит зелёный свет и сокращает суммарную просадку почти вчетверо. Но он срабатывает с задержкой и не спасает сделку, открытую до слома.'],
        ['Медленные пары тест бракует', 'Когда возврат вялый (полувозврат 15+ дней), на окне в 100 дней тесту не хватает мощности: он пропускает большинство сделок, хотя пара рабочая. Для медленных связок нужны более длинные окна истории.'],
        ['Корреляция ≠ коинтеграция', 'Два актива одного сектора могут каждый день ходить вверх и вниз синхронно (высокая корреляция шагов и высокий R² цен), но их разница может блуждать без возврата. Проверять нужно именно остатки A − c − k·B.'],
        ['Охота за парами плодит миражи', 'Слепой перебор сотен комбинаций неизбежно находит десятки случайных пар, пробивших порог 5%. Без предварительного экономического смысла статистический отбор превращается в самообман.'],
        ['Что остаётся неизменным', 'Комиссии, проскальзывание, целые лоты контрактов, заморозка k внутри сделки и необходимость стоп-лосса на случай внезапного разрыва связи.']
      ];
      el.querySelector('#cards').innerHTML = cards.map((c) => '<div class="card"><h4>' + c[0] + '</h4><p>' + c[1] + '</p></div>').join('');

      drawTable();
      drawPower();
    }
  });
})();
