/* Динамический хедж, экраны 5–6: округление до целых контрактов, правила и сделки с замороженным k. */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, S = window.SPECS, HV = window.HV;
  const C = U.COLORS;
  const Z = (window.HSCREENS = window.HSCREENS || []);
  const SC = E.HEDGE_SCENARIOS;
  const ME = '#7ee0b5', GOLD = '#ffd166', GREY = '#8b95a7';
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 1 : d) + '</span>';
  // число без лишних нулей: 1,4 вместо 1,400; до трёх знаков
  const nz = (v) => { if (v === null || v === undefined || Number.isNaN(v)) return '—'; for (let d = 0; d <= 3; d++) if (Math.abs(v * Math.pow(10, d) - Math.round(v * Math.pow(10, d))) < 1e-9) return U.fmt(v, d); return U.fmt(v, 3); };
  const gen = (i, seed) => E.genHedge(seed === undefined ? A.state.seed : seed, SC[i]);
  const hp = (over) => Object.assign(A.btParams(), over || {});
  const btH = (d, over) => E.backtestHedge(d.a, d.b, hp(over));
  const prereq = '<div class="note">Если слова «спред», «z-score» и «коэффициент хеджирования» вам не знакомы, начните с <a href="#zscore/1" style="color:var(--accent)">разбора простого z-score</a> и экранов 1–4 этого раздела.</div>';

  /* ---------- 5. Округление до целых контрактов ---------- */
  const s5 = { k: 1.43, cap: 10, move: 10, scn: 1, lots: 5 };

  // Для каждого L от 1 до cap: сколько контрактов B брать, какой получается k и каков «перекос» от рынка.
  function lotRows(k, cap, move) {
    const rows = []; let best = null;
    for (let L = 1; L <= cap; L++) {
      const nB = Math.round(k * L), kf = nB / L, err = Math.abs(kf - k);
      const o = { L, nB, kf, err, skew: move * (k - kf), total: L + nB };
      rows.push(o);
      if (best === null || err < best.err - 1e-9) best = o;
    }
    return { rows, best };
  }

  // Средние по 11 наборам данных: ошибка k относительно настоящего β и результат стратегии при данном L.
  function aggLots(si, lots) {
    let err = 0, ec = 0, tot = 0, cnt = 0, dd = 0;
    SEEDS.forEach((sd) => {
      const d = gen(si, sd), r = btH(d, { lots });
      for (let t = 120; t < d.a.length; t++) if (r.hedge.kUsed[t] !== null) { err += Math.abs(r.hedge.kUsed[t] - d.beta[t]); ec++; }
      tot += r.metrics.total; cnt += r.metrics.count; dd += r.metrics.maxDD;
    });
    const n = SEEDS.length;
    return { err: err / ec, total: tot / n, count: cnt / n, dd: dd / n };
  }

  Z.push({
    id: 'lots',
    title: 'Округление до целых контрактов',
    lead: 'Регрессия выдаёт дробное k, например 1,43. Но на бирже нельзя купить «43 сотых контракта». Разберём, как из дробного числа получить целое количество контрактов и что мы при этом теряем.',
    text: () => `
      <h3>Проблема: контракт нельзя разрезать</h3>
      <p>${T('contract', 'Контракт (лот)')} — неделимая единица: можно купить 1, 2 или 7 контрактов, но не 1,43. Поэтому «1,43 контракта B на каждый контракт A» взять не получится: нужно подобрать целые числа.</p>
      <h3>Решение: брать контракты пачками</h3>
      <p>Берём не один контракт A, а сразу <b>L</b> штук (буква L — от английского lots, «лоты»), а контрактов B берём целое число, ближайшее к k × L. «Округлить до ближайшего целого» значит: 7,15 → 7, а 7,6 → 8. Эту идею называют ${T('lots_ratio', 'хеджем в лотах')}.</p>
      <span class="formula">контрактов B = округлить(k × L)<br>k факт = контрактов B ÷ L<small>k факт — коэффициент, который мы реально получили. Он почти всегда немного отличается от идеального k.</small></span>
      <p><b>Пример.</b> k = 1,43. Берём L = 5 контрактов A: k × L = 7,15, округляем до 7 контрактов B. Фактический коэффициент 7 ÷ 5 = 1,4, ошибка всего 0,03. А если взять L = 1: 1,43 округляется до 1 контракта B, фактический коэффициент 1, ошибка 0,43. Это уже простой спред A − B, от которого мы и хотели уйти.</p>
      <h3>Что такое «перекос»</h3>
      <p>Из-за округления рынок снова немного влияет на позицию. Допустим, k = 1,43, а мы взяли 1 контракт B. Рынок вырос на 10 пунктов: B вырос на 10, A в среднем на 14,3. По A мы заработали 14,3, по B потеряли 10, остаётся <b>+4,3</b> «от рынка». Если рынок упадёт на 10, будет −4,3. Эту остаточную чувствительность к рынку мы называем перекосом. Таблица справа считает его для любого k.</p>
      <h3>Цена точности</h3>
      <ul>
        <li><b>Деньги под залог.</b> За каждый контракт биржа замораживает ${T('margin', 'гарантийное обеспечение')}. Чем больше L, тем больше денег «заморожено».</li>
        <li><b>Комиссии.</b> Платим за каждый контракт на входе и на выходе: чем больше контрактов, тем дороже сделка.</li>
        <li><b>Минимальный размер.</b> Если мало денег, большое L просто недоступно.</li>
      </ul>
      <p>Поэтому на практике ищут компромисс: наименьшее L, при котором ошибка уже приемлемо мала. Ползунок «потолок L» справа показывает лучший вариант в пределах вашего потолка.</p>
      <h3>Как это сочетается со всем остальным</h3>
      <p>Коэффициент k пересчитывается каждый день, значит, и k факт меняется «ступеньками» (например, 1,4 → 1,5), а не плавно. Z-score по-прежнему считается честно: спред всего окна заново пересчитывается с сегодняшним k факт. А внутри открытой сделки число контрактов не меняют вообще: это следующий экран.</p>
      <div class="note warn"><b>Честная оговорка про издержки.</b> В нашем учебнике издержки заданы одним числом на сделку и не растут с числом контрактов. В жизни они растут, поэтому большие L обходятся дороже, чем показывает таблица результатов справа.</div>
      ${prereq}`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><h4>Калькулятор: сколько контрактов брать</h4>
          <p class="cap">Для каждого L от 1 до выбранного потолка: сколько контрактов B брать, какой k получится и сколько рынка «просочится» в позицию.</p>
          <div id="ctl1"></div><table class="t" id="tab1"></table><div class="note" id="read1"></div></div>
        <div class="viz"><h4>Как округление влияет на стратегию</h4>
          <div class="btns" id="tabs" style="margin:0 0 10px"></div><p id="snote" style="margin:0 0 10px;color:var(--muted)"></p>
          <div class="legend"><span><i style="background:${GREY}"></i>настоящее β (в реальности неизвестно)</span><span><i style="background:#7ee0b566"></i>k из регрессии</span><span><i style="background:${GOLD}"></i>k факт (после округления)</span></div>
          <div id="c1"></div><div id="ctl2"></div>
          <table class="t" id="tab2" style="margin-top:12px"></table><div class="note" id="read2"></div></div>`;

      /* --- калькулятор --- */
      const c1 = el.querySelector('#ctl1');
      HV.slider(c1, { label: 'Коэффициент k из регрессии', min: 1, max: 2.5, step: 0.01, value: s5.k, fmt: (v) => f(v), hint: 'Идеальное число контрактов B на один контракт A.', onInput: (v) => { s5.k = v; draw1(); } });
      HV.slider(c1, { label: 'Потолок L: сколько контрактов A вы готовы взять', min: 1, max: 10, step: 1, value: s5.cap, fmt: (v) => f(v, 0), hint: 'Чем больше можно взять, тем точнее удастся подобрать.', onInput: (v) => { s5.cap = v; draw1(); } });
      HV.slider(c1, { label: 'Рынок сдвинулся на (пунктов B)', min: 1, max: 30, step: 1, value: s5.move, fmt: (v) => f(v, 0), hint: 'A при этом в среднем двигается в k раз сильнее.', onInput: (v) => { s5.move = v; draw1(); } });
      function draw1() {
        const r = lotRows(s5.k, s5.cap, s5.move), best = r.best, first = r.rows[0];
        el.querySelector('#tab1').innerHTML = '<tr><th>Контрактов A (L)</th><th>Контрактов B = округлить(k × L)</th><th>k факт</th><th>ошибка |k факт − k|</th><th>перекос на 1 контракт A, пунктов</th><th>всего контрактов</th></tr>' +
          r.rows.map((o) => '<tr' + (o === best ? ' class="sel"' : '') + '><td>' + o.L + (o === best ? ' (лучший)' : '') + '</td><td>' + o.nB + '</td><td>' + nz(Math.round(o.kf * 1000) / 1000) + '</td><td>' + f(o.err, 3) + '</td><td>' + col(o.skew, 2) + '</td><td>' + o.total + '</td></tr>').join('');
        el.querySelector('#read1').innerHTML = 'При k = <b>' + f(s5.k) + '</b> лучший вариант в пределах ' + s5.cap + ' контрактов A: <b>L = ' + best.L + '</b>, то есть ' + best.L + ' контр. A против ' + best.nB + ' контр. B (k факт = ' + nz(Math.round(best.kf * 1000) / 1000) + ', ошибка ' + f(best.err, 3) + '). ' +
          (best === first ? 'Здесь уже один контракт A даёт наименьшую ошибку из доступных.' : 'Если взять только 1 контракт A, ошибка будет ' + f(first.err, 3) + ', а при движении рынка на ' + s5.move + ' пунктов перекос составит ' + U.sgn(first.skew, 2) + ' пункта на контракт A (у лучшего варианта ' + U.sgn(best.skew, 2) + '). Всего контрактов при этом: ' + first.total + ' против ' + best.total + '.') +
          ' Знак перекоса показывает, в какую сторону позиция «смотрит»: плюс — выигрывает от роста рынка и проигрывает от падения.';
      }

      /* --- влияние на стратегию --- */
      const tabs = el.querySelector('#tabs');
      const scn = [1, 2, 3];
      tabs.innerHTML = scn.map((i) => '<button class="b" data-i="' + i + '">' + SC[i].name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s5.scn = +b.dataset.i; draw2(); } });
      let d, h;
      const ch = A.mkChart(el.querySelector('#c1'), 220, { tip: (i) => (h.k[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>настоящее β: ' + f(d.beta[i]) + '<br>k из регрессии: ' + f(h.k[i]) + '<br>k факт: ' + f(h.kUsed[i])) });
      const sl = HV.slider(el.querySelector('#ctl2'), { label: 'Контрактов A (L) для округления', min: 0, max: 10, step: 1, value: s5.lots, fmt: (v) => (v === 0 ? 'без округления' : f(v, 0) + ' контр. A'), hint: '0 — коэффициент берётся дробным (для сравнения). 1 — на каждый контракт A целое число контрактов B.', onInput: (v) => { s5.lots = v; draw2(); } });
      const LIST = [0, 1, 2, 3, 5, 10];
      function draw2() {
        tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.i === s5.scn));
        el.querySelector('#snote').textContent = SC[s5.scn].note;
        d = gen(s5.scn);
        h = E.hedgeStats(d.a, d.b, A.state.params.n, { lots: s5.lots });
        ch.render({ n: d.a.length, series: [{ data: d.beta, color: GREY, width: 1.6, dash: [6, 5] }, { data: h.k, color: '#7ee0b566', width: 1.2 }, { data: h.kUsed, color: GOLD, width: 2 }], yMin: 0, yMax: 3 });
        const list = LIST.indexOf(s5.lots) >= 0 ? LIST : LIST.concat([s5.lots]).sort((p, q) => p - q);
        const res = {};
        list.forEach((L) => { res[L] = aggLots(s5.scn, L); });
        el.querySelector('#tab2').innerHTML = '<tr><th>Контрактов A (L)</th><th>средняя ошибка k (|k факт − β|)</th><th>итог, пунктов (среднее по 11 наборам)</th><th>сделок</th><th>макс. просадка</th></tr>' +
          list.map((L) => { const x = res[L]; return '<tr' + (L === s5.lots ? ' class="sel"' : '') + '><td>' + (L === 0 ? 'без округления' : L) + '</td><td>' + f(x.err, 3) + '</td><td>' + col(x.total, 0) + '</td><td>' + f(x.count, 1) + '</td><td>' + f(-x.dd, 1) + '</td></tr>'; }).join('');
        const a0 = res[0], aL = res[s5.lots], one = res[1];
        let msg;
        if (s5.lots === 0) {
          msg = 'Сейчас округления нет: ошибка k в среднем <b>' + f(a0.err, 3) + '</b>, итог <b>' + U.sgn(a0.total, 0) + '</b> пунктов, максимальная просадка <b>' + f(-a0.dd, 1) + '</b>. Если выбрать L = 1, ошибка вырастет до <b>' + f(one.err, 3) + '</b>, итог станет <b>' + U.sgn(one.total, 0) + '</b>, просадка <b>' + f(-one.dd, 1) + '</b>.';
        } else {
          msg = 'При L = <b>' + s5.lots + '</b> ошибка k в среднем <b>' + f(aL.err, 3) + '</b> против <b>' + f(a0.err, 3) + '</b> без округления; итог <b>' + U.sgn(aL.total, 0) + '</b> против <b>' + U.sgn(a0.total, 0) + '</b>; максимальная просадка <b>' + f(-aL.dd, 1) + '</b> против <b>' + f(-a0.dd, 1) + '</b>. ' +
            (aL.err > a0.err * 1.5 ? 'Ступеньки заметно портят хедж: k факт уходит от нужного значения.' : 'Ошибка почти не выросла: округление здесь почти ничего не отняло.');
        }
        el.querySelector('#read2').innerHTML = msg + ' Цифры усреднены по 11 учебным наборам данных, поэтому небольшие различия между соседними L — это шум, а не закономерность.';
      }
      draw1();
      A.controls(el.querySelector('#ctl2'), [S.n], draw2);
      draw2();
    }
  });
})();
