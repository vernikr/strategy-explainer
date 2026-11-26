/* Экраны 5–8: правила входа и выхода, параметры, сделки и результат, пошаговый разбор. */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, S = window.SPECS;
  const C = U.COLORS;
  const Z = window.ZSCREENS;
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 1 : d) + '</span>';
  const dirName = (d) => (d === 1 ? 'лонг спреда' : 'шорт спреда');
  const dirLegs = (d) => (d === 1 ? 'купили A, продали B' : 'продали A, купили B');

  function zLines(p) {
    const L = [];
    const add = (y, color, label, dash) => L.push({ y, color, label, dash: dash || [5, 4] });
    add(p.entryZ, '#ff6b6b99', 'вход: шорт спреда (+' + U.fmt(p.entryZ) + ')');
    add(-p.entryZ, '#35d07f99', 'вход: лонг спреда (' + U.MINUS + U.fmt(p.entryZ) + ')');
    add(p.exitZ, '#ffd16688', '', [2, 4]);
    add(-p.exitZ, '#ffd16688', 'выход (±' + U.fmt(p.exitZ) + ')', [2, 4]);
    if (p.stopOn) { add(p.stopZ, '#ff6b6bcc', 'стоп', [8, 3]); add(-p.stopZ, '#ff6b6bcc', 'стоп', [8, 3]); }
    L.push({ y: 0, color: '#ffffff44', dash: [] });
    return L;
  }

  /* ---------- 5. Правила ---------- */
  Z.push({
    id: 'rules',
    title: 'Правила: когда входить и выходить',
    lead: 'Вся стратегия — это несколько простых «если — то», которые применяются к z-score каждый день. Никаких прогнозов и интуиции.',
    text: () => `
      <h3>1. Вход</h3>
      <p><span class="pill stop">шорт спреда</span> Если z ≥ +${T('entry_threshold', 'порог входа')}: спред необычно высок. Продаём A, покупаем B и ждём, что спред опустится.</p>
      <p><span class="pill go">лонг спреда</span> Если z ≤ −порог входа: спред необычно низок. Покупаем A, продаём B и ждём, что спред поднимется.</p>
      <h3>2. Выход по цели</h3>
      <p>Сделка открыта, и z вернулся к ${T('exit_threshold', 'порогу выхода')}: закрываем обе ноги и фиксируем результат. При пороге 0 ждём возврата ровно к среднему, при 0,5 выходим немного раньше, не дожидаясь последнего отрезка пути.</p>
      <h3>3. Стоп-лосс</h3>
      <p>Если z пошёл не назад, а ещё дальше — за уровень ${T('stop', 'стопа')}, — значит, «резинка» тянет не туда, где мы ожидали. Признаём ошибку и закрываем позицию с убытком, пока он не вырос.</p>
      <h3>4. Время вышло (по желанию)</h3>
      <p>Если сделка висит дольше ${T('max_hold', 'предельного удержания')}, закрываем её независимо от z: возврат слишком затянулся.</p>
      <h3>5. Одна позиция за раз</h3>
      <p>Пока сделка открыта, новые не открываем.</p>
      <div class="note"><b>Порядок проверки при открытой позиции:</b> сначала стоп, затем цель, затем время. Это важно: если сработали сразу два условия, побеждает более осторожное.</div>
      <p>Двигайте пороги справа и смотрите, как меняются точки входа и выхода. Нажмите на график внутри сделки, чтобы увидеть её подробности.</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><h4>Z-score и пороги</h4>
          <div class="legend"><span><i class="dot" style="background:${C.up}"></i>▲ вход в лонг спреда</span><span><i class="dot" style="background:${C.down}"></i>▼ вход в шорт спреда</span><span><i class="dot" style="background:${C.exit}"></i>✕ выход по цели</span><span><i class="dot" style="background:${C.down}"></i>✕ красный — стоп</span></div>
          <div id="c1"></div><div id="ctl"></div></div>
        <div class="viz"><h4>Спред и сделки</h4><p class="cap">Зелёная заливка — лонг спреда, красная — шорт спреда.</p><div id="c2"></div>
          <div class="note" id="info">Нажмите на график внутри заливки, чтобы увидеть подробности сделки.</div><div id="kp"></div></div>`;
      const bt = () => A.backtest();
      const tripOf = (i) => bt().trades.findIndex((t) => i >= t.entryIdx && i <= t.exitIdx);
      function pick(i) {
        const b = bt(), k = tripOf(i);
        if (k < 0) { el.querySelector('#info').textContent = 'В этот день позиции нет. Выберите день внутри цветной заливки.'; return; }
        const t = b.trades[k];
        el.querySelector('#info').innerHTML = '<b>Сделка ' + (k + 1) + ': ' + dirName(t.dir) + '</b> (' + dirLegs(t.dir) + '). Вошли в день ' + (t.entryIdx + 1) + ' при спреде ' + U.fmt(t.entryS) + ' (z = ' + U.fmt(t.entryZ) + '), вышли в день ' + (t.exitIdx + 1) + ' при спреде ' + U.fmt(t.exitS) + '. Причина выхода: ' + A.REASON[t.reason] + '. Результат: ' + col(t.net) + ' пунктов.';
      }
      const c1 = A.mkChart(el.querySelector('#c1'), 260, { tip: (i) => { const b = bt(); return b.z[i] === null ? null : A.barTip(i, b); }, onClick: pick });
      const c2 = A.mkChart(el.querySelector('#c2'), 220, { tip: (i) => A.barTip(i, bt()), onClick: pick });
      A.controls(el.querySelector('#ctl'), [S.entryZ, S.exitZ, S.stopZ, S.stopOn], draw);
      function draw() {
        const d = A.data(), n = d.spread.length, b = bt(), p = A.state.params;
        const lim = Math.max(4.5, p.stopZ + 0.5);
        c1.render({ n, series: [{ data: b.z, color: C.z }], hlines: zLines(p), spans: A.positionSpans(b), markers: A.tradeMarkers(b, (i) => b.z[i]), yMin: -lim, yMax: lim });
        c2.render({ n, series: [{ data: b.mean, color: C.mean, width: 1.4 }, { data: d.spread, color: C.spread }], spans: A.positionSpans(b), markers: A.tradeMarkers(b, (i) => d.spread[i]) });
        el.querySelector('#kp').innerHTML = A.kpis(b);
      }
      draw();
    }
  });

  /* ---------- 6. Параметры ---------- */
  const PARAMS = [
    ['Длина окна N', 'Сколько дней берём для среднего и σ.', 'Короткое окно быстро подстраивается и «нервничает»: часто принимает всплеск за норму, сигналов много.', 'Длинное окно спокойное, но медленно замечает смену обстановки, сигналов меньше.'],
    ['Порог входа', 'Насколько необычным должен быть спред, чтобы войти.', 'Низкий порог: сделок много, но многие — на пустых колебаниях; издержки их съедают.', 'Высокий порог: сделок мало, но каждая — на более сильном отклонении. Рискуете упустить возможность или остаться без сделок.'],
    ['Порог выхода', 'При каком z закрываем сделку с прибылью.', 'Близко к 0: ждём полного возврата, прибыль в сделке больше, но возврат может не дойти до конца.', 'Большой (но меньше входа): выходим рано, прибыль меньше, зато чаще успеваем её забрать.'],
    ['Стоп', 'При каком z признаём ошибку.', 'Близкий стоп: убытки малы, но легко выбивает из сделок, которые вернулись бы.', 'Далёкий стоп (или без него): сделки живут дольше, но редкие провалы становятся очень дорогими.'],
    ['Предельное удержание', 'Сколько дней максимум сидим в сделке.', 'Короткое: быстро освобождаем капитал, но можем закрыть сделку незадолго до возврата.', 'Длинное или 0: терпеливо ждём, но зависшая сделка надолго блокирует и деньги, и новые входы.'],
    ['Издержки', 'Что платим за сделку (комиссия + проскальзывание).', 'Малые: почти не влияют на результат — но реальные издержки редко бывают нулевыми.', 'Большие: стратегия с мелкой прибылью на сделку уходит в минус. Особенно опасно при низком пороге входа.'],
    ['Исполнение на следующий день', 'Когда проходит сделка: сразу по итогу дня сигнала или на следующий день.', 'Выключено: сделка по цене того же дня — удобно для обучения, но оптимистично.', 'Включено: реалистичнее, обычно результат слегка хуже, потому что цена за ночь успевает уйти.']
  ];

  Z.push({
    id: 'params',
    title: 'Параметры: что делает каждая «ручка»',
    lead: 'У стратегии семь настроек. Ниже — что означает каждая, а затем можно покрутить их вживую и посмотреть, как меняется результат.',
    full: true,
    mount(el) {
      el.innerHTML = `
        <table class="t left" style="margin-bottom:26px"><tr><th style="width:190px">Параметр</th><th style="width:250px">Что это</th><th>Если уменьшать</th><th>Если увеличивать</th></tr>
          ${PARAMS.map((r) => '<tr style="vertical-align:top"><td><b>' + r[0] + '</b></td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td></tr>').join('')}
        </table>
        <div style="display:grid;grid-template-columns:600px 1fr;gap:24px;align-items:start">
          <div class="viz"><h4>Крутите настройки вживую</h4><div id="ctl"></div><div id="kp"></div><div id="eq"></div></div>
          <div class="viz"><h4>Карта чувствительности</h4>
            <p class="cap">Итог (в пунктах) для разных сочетаний окна и порога входа; остальное — как в настройках слева. Нажмите на клетку, чтобы применить её.</p>
            <div id="heat"></div><div class="note" id="heatnote"></div></div>
        </div>`;
      const ns = [10, 20, 30, 40, 50, 60, 80, 100, 120], es = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3];
      const eq = A.mkChart(el.querySelector('#eq'), 180, {});
      const ctl = A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.maxHold, S.cost, S.delayOn], draw);
      el.querySelector('#heat').addEventListener('click', (e) => {
        const td = e.target.closest('td[data-n]');
        if (!td) return;
        A.state.params.n = +td.dataset.n; A.state.params.entryZ = +td.dataset.e; A.normalize(); ctl.sync(); draw();
      });
      function draw() {
        const d = A.data(), b = A.backtest(), p = A.state.params;
        el.querySelector('#kp').innerHTML = A.kpis(b);
        eq.render({ n: d.spread.length, series: [{ data: b.equity, color: '#5aa9ff', width: 2 }], hlines: [{ y: 0, color: '#ffffff44', dash: [] }], spans: A.positionSpans(b) });
        const grid = E.sweep(d.spread, A.btParams(), ns, es);
        const flat = [].concat.apply([], grid);
        const mx = Math.max.apply(null, flat.map(Math.abs)) || 1;
        const color = (v) => (v >= 0 ? 'rgba(53,208,127,' + (0.15 + 0.7 * v / mx) + ')' : 'rgba(255,107,107,' + (0.15 + 0.7 * -v / mx) + ')');
        let h = '<table class="heat"><tr><td class="h">N \\ вход σ</td>' + es.map((x) => '<td class="h">' + U.fmt(x) + '</td>').join('') + '</tr>';
        ns.forEach((n, r) => {
          h += '<tr><td class="h">' + n + '</td>' + es.map((x, c) => '<td data-n="' + n + '" data-e="' + x + '" class="' + (n === p.n && x === p.entryZ ? 'cur' : '') + '" style="background:' + color(grid[r][c]) + '">' + U.fmt(grid[r][c], 0) + '</td>').join('') + '</tr>';
        });
        el.querySelector('#heat').innerHTML = h + '</table>';
        const best = Math.max.apply(null, flat), worst = Math.min.apply(null, flat);
        el.querySelector('#heatnote').innerHTML = 'Лучшая клетка даёт <b>' + U.sgn(best, 0) + '</b>, худшая — <b>' + U.sgn(worst, 0) + '</b>. Соседние клетки заметно различаются, то есть «идеальных» параметров нет: результат во многом зависит от конкретных данных. Подробнее — на экране «Риски и ловушки».';
      }
      draw();
    }
  });

  /* ---------- 7. Сделки и результат ---------- */
  Z.push({
    id: 'results',
    title: 'Сделки и результат',
    lead: 'Как из набора сделок получается итог: что считается прибылью, что — издержками и как читать показатели качества.',
    text: () => `
      <h3>Результат одной сделки</h3>
      <span class="formula">чистый результат = направление × (спред на выходе − спред на входе) − издержки<small>направление: +1 — лонг спреда, −1 — шорт спреда</small></span>
      <p>Первая часть — «валовый» результат, вторая — ${T('cost', 'издержки')}. Издержки платятся в любом случае, даже если сделка прибыльная; поэтому мелкие прибыли легко «съедаются».</p>
      <h3>Кривая капитала</h3>
      <p>${T('equity', 'Кривая капитала')} показывает накопленный итог по дням, включая плавающий результат открытой сделки. Растёт — зарабатываем, падает — теряем.</p>
      <h3>Показатели</h3>
      <ul>
        <li>${T('winrate', 'Доля прибыльных')}: сколько сделок закрылось в плюс. Высокий процент не гарантирует прибыль: несколько больших убытков могут перевесить много маленьких выигрышей.</li>
        <li>${T('profit_factor', 'Профит-фактор')}: все прибыли ÷ все убытки. Больше 1 — в плюсе.</li>
        <li>${T('drawdown', 'Максимальная просадка')}: самая глубокая «яма» кривой капитала. Показывает, что придётся пережить по дороге.</li>
      </ul>
      <h3>Пункты → рубли</h3>
      <p>Результат в пунктах умножается на число контрактов и стоимость пункта. В учебнике по умолчанию 1 пункт = 1 ₽ на контракт; на бирже стоимость пункта указана в спецификации контракта.</p>
      <div class="note warn"><b>Не путайте с доходностью.</b> Здесь не учтены ${T('margin', 'гарантийное обеспечение')} и размер счёта: деньги под залог заморожены, пока позиция открыта.</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><h4>Кривая капитала (пункты)</h4><div id="eq"></div><div id="kp"></div>
          <div class="calc-grid" style="margin-top:12px"><div><label>Контрактов на каждую ногу</label><input type="number" id="lots" value="1" min="1" step="1"></div><div><label>Стоимость пункта, ₽</label><input type="number" id="pv" value="1" min="0" step="0.5"></div></div>
          <div class="result" id="money"></div></div>
        <div class="viz"><h4>Журнал сделок</h4><p class="cap">Нажмите на строку — сделка появится крупно.</p><div class="scroll"><table class="t" id="tbl"></table></div></div>
        <div class="viz"><h4>Выбранная сделка</h4><div id="zoom"></div><div class="note" id="detail"></div></div>`;
      const eq = A.mkChart(el.querySelector('#eq'), 200, {});
      const zoom = A.mkChart(el.querySelector('#zoom'), 220, { tip: (i) => A.barTip(i, A.backtest()) });
      el.querySelector('#lots').addEventListener('input', draw);
      el.querySelector('#pv').addEventListener('input', draw);
      el.querySelector('#tbl').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-k]'); if (tr) { A.state.trade = +tr.dataset.k; draw(); } });
      function draw() {
        const d = A.data(), b = A.backtest(), m = b.metrics;
        if (A.state.trade >= b.trades.length) A.state.trade = 0;
        el.querySelector('#kp').innerHTML = A.kpis(b, { explain: true });
        eq.render({ n: d.spread.length, series: [{ data: b.equity, color: '#5aa9ff', width: 2 }], hlines: [{ y: 0, color: '#ffffff44', dash: [] }], spans: A.positionSpans(b) });
        const lots = Math.max(1, parseFloat(el.querySelector('#lots').value) || 1), pv = parseFloat(el.querySelector('#pv').value) || 0;
        el.querySelector('#money').innerHTML = 'Итог: ' + col(m.total, 1) + ' пунктов × ' + lots + ' контр. × ' + U.fmt(pv, 2) + ' ₽ = <span class="big">' + col(m.total * lots * pv, 0) + ' ₽</span>';
        el.querySelector('#tbl').innerHTML = '<tr><th>№</th><th>Позиция</th><th>Вход, день</th><th>Выход, день</th><th>Спред</th><th>Валовый</th><th>Издер.</th><th>Чистый</th><th>Выход по</th></tr>' +
          b.trades.map((t, k) => '<tr class="click ' + (k === A.state.trade ? 'sel' : '') + '" data-k="' + k + '"><td>' + (k + 1) + '</td><td>' + dirName(t.dir) + '</td><td>' + (t.entryIdx + 1) + '</td><td>' + (t.exitIdx + 1) + '</td><td>' + U.fmt(t.entryS, 1) + ' → ' + U.fmt(t.exitS, 1) + '</td><td>' + col(t.gross) + '</td><td>' + U.fmt(-t.cost) + '</td><td>' + col(t.net) + '</td><td>' + ({ target: 'цели', stop: 'стопу', time: 'времени', end: 'концу данных' })[t.reason] + '</td></tr>').join('');
        const t = b.trades[A.state.trade];
        if (!t) { el.querySelector('#detail').textContent = 'При таких настройках сделок нет.'; zoom.render({ n: d.spread.length, series: [{ data: d.spread, color: C.spread }] }); return; }
        const x0 = Math.max(0, t.entryIdx - 15), x1 = Math.min(d.spread.length - 1, t.exitIdx + 15);
        zoom.render({
          n: d.spread.length, x0, x1,
          series: [{ data: b.mean, color: C.mean, width: 1.4 }, { data: d.spread, color: C.spread }],
          hlines: [{ y: t.entryS, color: t.dir === 1 ? '#35d07f88' : '#ff6b6b88', label: 'вход ' + U.fmt(t.entryS, 1) }, { y: t.exitS, color: '#ffd16688', label: 'выход ' + U.fmt(t.exitS, 1) }],
          spans: [{ i0: t.entryIdx, i1: t.exitIdx, color: t.dir === 1 ? '#35d07f18' : '#ff6b6b18' }],
          markers: A.tradeMarkers({ trades: [t] }, (i) => d.spread[i])
        });
        el.querySelector('#detail').innerHTML = '<b>Сделка ' + (A.state.trade + 1) + ' (' + dirName(t.dir) + ', ' + t.bars + ' дн.).</b> Чистый результат = ' + (t.dir === 1 ? '+1' : '−1') + ' × (' + U.fmt(t.exitS) + ' − ' + U.fmt(t.entryS) + ') − ' + U.fmt(t.cost) + ' = ' + U.sgn(t.dir * (t.exitS - t.entryS), 2) + ' − ' + U.fmt(t.cost) + ' = <b>' + col(t.net, 2) + '</b>. Причина выхода: ' + A.REASON[t.reason] + '.';
      }
      draw();
    }
  });

  /* ---------- 8. Пошаговый разбор ---------- */
  function decisionText(t, b, p) {
    const z = b.z[t];
    if (z === null) return { cls: '', html: 'Окно ещё не набралось (или σ = 0), решение не принимается.' };
    const posNow = b.pos[t];
    const sig = b.signal[t];
    const ex = b.executed[t];
    let h = '';
    if (ex && p.delay === 1 && ex.type) h += '<p>С утра исполнена вчерашняя команда: <b>' + (ex.type === 'open' ? 'открыта позиция' : 'позиция закрыта') + '</b> по сегодняшнему спреду.</p>';
    if (sig && sig.type === 'open') {
      const up = sig.dir === 1;
      h += '<p>z = <b>' + U.fmt(z) + '</b> ' + (up ? '≤ −' : '≥ +') + U.fmt(p.entryZ) + ' (порог входа) → спред ' + (up ? 'необычно низок' : 'необычно высок') + '.</p><p><b>Решение: открыть ' + dirName(sig.dir) + '</b> (' + dirLegs(sig.dir) + ').' + (p.delay === 1 ? ' Сделка пройдёт завтра.' : ' Исполняем по сегодняшнему спреду.') + '</p>';
      return { cls: 'open', html: h };
    }
    if (sig && sig.type === 'close') {
      const why = { target: 'z вернулся к порогу выхода (±' + U.fmt(p.exitZ) + ') — цель достигнута', stop: 'z ушёл за стоп (±' + U.fmt(p.stopZ) + ') — признаём ошибку', time: 'сделка висит дольше ' + p.maxHold + ' дн. — время вышло' }[sig.reason];
      h += '<p>z = <b>' + U.fmt(z) + '</b> → ' + why + '.</p><p><b>Решение: закрыть позицию.</b>' + (p.delay === 1 ? ' Закроем завтра.' : ' Закрываем по сегодняшнему спреду.') + '</p>';
      return { cls: 'close', html: h };
    }
    if (posNow !== 0) h += '<p>z = <b>' + U.fmt(z) + '</b>. Позиция открыта (' + dirName(posNow) + '). Ни цель, ни стоп, ни лимит времени не сработали.</p><p><b>Решение: держим.</b></p>';
    else h += '<p>z = <b>' + U.fmt(z) + '</b> лежит внутри ±' + U.fmt(p.entryZ) + ' — спред не настолько необычен.</p><p><b>Решение: ждём.</b></p>';
    return { cls: '', html: h };
  }

  A.decisionText = decisionText;
  A.zLines = zLines;

  Z.push({
    id: 'walk',
    title: 'Пошаговый разбор: один день изнутри',
    lead: 'Выберите любой день и увидите все числа: какие дни попали в окно, как посчитаны среднее, σ и z и почему принято именно такое решение.',
    full: true,
    mount(el) {
      if (window.__stepTimer) clearInterval(window.__stepTimer);
      el.innerHTML = `
        <div style="display:grid;grid-template-columns:560px 1fr;gap:28px;align-items:start">
          <div>
            <div class="viz"><h4>Выбор дня: <span id="dayv"></span></h4><input type="range" id="day" style="margin-top:8px">
              <div class="btns"><button class="b" id="bp">◀ День назад</button><button class="b" id="bn">День вперёд ▶</button><button class="b" id="bs">К следующему сигналу</button><button class="b primary" id="play">▶ Автопроигрывание</button></div></div>
            <div class="viz calc-steps" id="steps"></div>
            <div class="viz"><h4>Настройки</h4><div id="ctl"></div></div>
          </div>
          <div>
            <div class="viz"><h4>Спред: окно выбранного дня</h4><div id="c1"></div></div>
            <div class="viz"><h4>Z-score</h4><div id="c2"></div></div>
            <div class="viz"><h4>Числа окна</h4><p class="cap">Из этой таблицы получаются среднее и σ.</p><div class="scroll"><table class="t" id="win"></table></div></div>
          </div>
        </div>`;
      const d = A.data(), n = d.spread.length;
      const day = el.querySelector('#day');
      day.min = 1; day.max = n; day.step = 1;
      let t = null;
      const b0 = () => A.backtest();
      const firstSignal = () => { const b = b0(); const i = b.signal.findIndex((s) => s); return i < 0 ? A.state.params.n - 1 : i; };
      t = A.state.bar !== null && A.state.bar >= A.state.params.n - 1 ? A.state.bar : firstSignal();
      const c1 = A.mkChart(el.querySelector('#c1'), 230, { tip: (i) => A.barTip(i, b0()), onClick: (i) => { t = i; draw(); } });
      const c2 = A.mkChart(el.querySelector('#c2'), 180, { tip: (i) => A.barTip(i, b0()), onClick: (i) => { t = i; draw(); } });
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost, S.delayOn], draw);
      day.addEventListener('input', () => { t = parseInt(day.value, 10) - 1; draw(); });
      el.querySelector('#bp').addEventListener('click', () => { t = Math.max(0, t - 1); draw(); });
      el.querySelector('#bn').addEventListener('click', () => { t = Math.min(n - 1, t + 1); draw(); });
      el.querySelector('#bs').addEventListener('click', () => { const b = b0(); let i = t + 1; while (i < n && !b.signal[i]) i++; t = i < n ? i : firstSignal(); draw(); });
      el.querySelector('#play').addEventListener('click', (e) => {
        if (window.__stepTimer) { clearInterval(window.__stepTimer); window.__stepTimer = null; e.target.textContent = '▶ Автопроигрывание'; return; }
        e.target.textContent = '❚❚ Пауза';
        window.__stepTimer = setInterval(() => { if (t >= n - 1) { clearInterval(window.__stepTimer); window.__stepTimer = null; e.target.textContent = '▶ Автопроигрывание'; return; } t++; draw(); }, 350);
      });
      function draw() {
        const p = A.state.params, b = A.backtest();
        if (t < p.n - 1) t = p.n - 1;
        A.state.bar = t;
        day.value = t + 1;
        el.querySelector('#dayv').textContent = 'день ' + (t + 1) + ' из ' + n;
        const ex = E.explainBar(d.spread, p.n, t);
        const dec = decisionText(t, b, p);
        el.querySelector('#steps').innerHTML =
          row(1, 'Берём окно', 'Последние N = ' + p.n + ' значений спреда: дни с ' + (t - p.n + 2) + ' по ' + (t + 1) + '. Они в таблице справа.') +
          row(2, 'Среднее', 'Складываем все значения и делим на N.', 'Σ = ' + U.fmt(ex.sum) + ';  ' + U.fmt(ex.sum) + ' ÷ ' + p.n + ' = ' + U.fmt(ex.mean, 3)) +
          row(3, 'Отклонения и квадраты', 'У каждого дня: значение − среднее, затем в квадрат (столбцы таблицы справа). Складываем квадраты.', 'Σ квадратов = ' + U.fmt(ex.sumSq, 2)) +
          row(4, 'Дисперсия и σ', 'Делим сумму квадратов на N, затем извлекаем корень.', U.fmt(ex.sumSq, 2) + ' ÷ ' + p.n + ' = ' + U.fmt(ex.variance, 3) + ';  √' + U.fmt(ex.variance, 3) + ' = ' + U.fmt(ex.std, 3)) +
          row(5, 'Z-score', 'Берём сегодняшний спред, вычитаем среднее, делим на σ.', 'z = (' + U.fmt(ex.value) + ' − ' + U.fmt(ex.mean, 3) + ') ÷ ' + U.fmt(ex.std, 3) + ' = ' + U.fmt(ex.z, 3)) +
          '<div class="row"><div class="n">6</div><div><b>Решение</b><div class="decision ' + dec.cls + '">' + dec.html + '</div></div></div>';
        const band = (k) => b.mean.map((m, i) => (m === null ? null : m + k * b.std[i]));
        c1.render({
          n, series: [{ data: band(p.entryZ), color: '#f5a65b', width: 1, dash: [4, 4] }, { data: band(-p.entryZ), color: '#f5a65b', width: 1, dash: [4, 4] }, { data: b.mean, color: C.mean, width: 1.6 }, { data: d.spread, color: C.spread }],
          spans: [{ i0: t - p.n + 1, i1: t, color: '#c9b6ff1c' }], cursor: t, markers: A.tradeMarkers(b, (i) => d.spread[i])
        });
        const lim = Math.max(4.5, p.stopZ + 0.5);
        c2.render({ n, series: [{ data: b.z, color: C.z }], hlines: zLines(p), cursor: t, markers: A.tradeMarkers(b, (i) => b.z[i]), yMin: -lim, yMax: lim });
        el.querySelector('#win').innerHTML = '<tr><th>День</th><th>Спред</th><th>Отклонение</th><th>Квадрат</th></tr>' +
          ex.rows.map((r) => '<tr' + (r.idx === t ? ' class="sel"' : '') + '><td>' + (r.idx + 1) + '</td><td>' + U.fmt(r.value) + '</td><td>' + U.sgn(r.dev, 2) + '</td><td>' + U.fmt(r.sq, 2) + '</td></tr>').join('') +
          '<tr><td><b>Σ</b></td><td><b>' + U.fmt(ex.sum) + '</b></td><td></td><td><b>' + U.fmt(ex.sumSq, 2) + '</b></td></tr>';
        const sc = el.querySelector('.scroll'); sc.scrollTop = sc.scrollHeight;
      }
      function row(k, title, text, val) {
        return '<div class="row"><div class="n">' + k + '</div><div><b>' + title + '</b><div style="color:#98a3b6;font-size:14px">' + text + '</div>' + (val ? '<div class="v">' + val + '</div>' : '') + '</div></div>';
      }
      draw();
    }
  });
})();
