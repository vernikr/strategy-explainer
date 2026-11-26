/* Динамический хедж, экран 6: правила и сделки с замороженным k, разбор одной сделки по ногам (#23). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, S = window.SPECS;
  const C = U.COLORS;
  const Z = (window.HSCREENS = window.HSCREENS || []);
  const SC = E.HEDGE_SCENARIOS;
  const SIM = '#f5a65b', ME = '#7ee0b5', GOLD = '#ffd166', GREY = '#8b95a7';
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 1 : d) + '</span>';
  const gen = (i, seed) => E.genHedge(seed === undefined ? A.state.seed : seed, SC[i]);
  const hp = (over) => Object.assign(A.btParams(), over || {});
  const simple = (d) => E.backtest(d.a.map((v, i) => v - d.b[i]), A.btParams());
  const s6 = { scn: 1, lots: 0, sel: 0 };

  Z.push({
    id: 'trades',
    title: 'Правила и сделки: k замораживается на входе',
    lead: 'Правила входа и выхода те же, что у простого z-score. Новое одно: в момент входа мы фиксируем коэффициент k и держим его неизменным до конца сделки. Разберём, зачем, и как выглядит одна сделка по каждой ноге отдельно.',
    text: () => `
      <h3>Те же пять правил</h3>
      <p>z ≥ +порог входа → ${T('short_spread', 'шорт спреда')} (продать A, купить B); z ≤ −порог → ${T('long_spread', 'лонг спреда')} (купить A, продать B); z вернулся к порогу выхода → закрыть с прибылью; z ушёл за стоп → закрыть с убытком; одна позиция за раз. Подробности каждого правила: <a href="#zscore/5" style="color:#7ee0b5">экран «Правила» простого z-score</a>. Меняется только то, из чего считается спред: теперь это A − k·B, а не A − B.</p>
      <h3>Что значит «заморозить k»</h3>
      <p>Регрессия пересчитывается каждый день, и k каждый день немного другой. Но в открытой сделке у нас уже есть реальные контракты: например, 5 контрактов A и 7 контрактов B. Если подгонять позицию под новый k, придётся каждый день докупать и продавать, и за каждую такую операцию платить. Это называется ${T('rebalance', 'ребалансировкой')}. Поэтому в нашей модели:</p>
      <ol>
        <li>в день, когда подан сигнал на вход, берём тогдашний k; на следующий день (так устроено исполнение в модели) покупаем и продаём контракты именно по нему;</li>
        <li>до выхода <b>не трогаем</b> число контрактов, то есть k ${T('frozen_k', 'заморожен')};</li>
        <li>результат сделки считаем именно с замороженным k;</li>
        <li>после выхода всё начинается заново, с новым k.</li>
      </ol>
      <h3>Как считается результат по ногам</h3>
      <p>У сделки две ${T('leg', 'ноги')}, и каждая приносит свой результат:</p>
      <span class="formula">нога A = (±1) × (цена A на выходе − цена A на входе)<br>нога B = (∓k) × (цена B на выходе − цена B на входе)<br>итого = нога A + нога B − издержки<small>Верхний знак — лонг спреда (A купили, B продали), нижний — шорт. Если мы продали B, то рост цены B даёт убыток, поэтому у ноги B знак противоположный.</small></span>
      <p><b>Пример.</b> Лонг спреда при k = 1,5. A выросла с 100 до 110 (+10), B выросла с 50 до 56 (+6). Нога A: +10. Нога B: −1,5 × 6 = −9. Итого +1 пункт до издержек. Видно главную идею: обе ноги вместе почти гасят общий рост рынка, остаётся небольшая разница. Если бы мы брали k = 1, нога B дала бы −6, и итог был бы +4: он выше, но только потому, что рынок вырос; при падении рынка тот же «лишний» ход обернулся бы убытком.</p>
      <h3>Что осталось не идеальным</h3>
      <ul>
        <li><b>Решение и учёт идут по разным k.</b> Сигнал выхода считается по сегодняшнему z, где k уже пересчитан, а прибыль позиции — по замороженному k. Это сознательная простота: на практике решение принимают по свежим данным, а позиция остаётся такой, какой её открыли.</li>
        <li><b>Позиция стареет.</b> Если настоящая связь за время сделки заметно изменилась (сценарий «Связь меняется со временем»), замороженный k перестаёт гасить рынок. Это видно в таблице ниже по колонке «β на выходе».</li>
      </ul>
      <div class="note bad"><b>Риски те же и добавляются новые.</b> Разрыв связи, издержки и подгонка под прошлое описаны на <a href="#zscore/9" style="color:#7ee0b5">экране «Риски» z-score</a>. К ним добавляется ошибка k и округление: см. экраны 3–5.</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><h4>Сценарий данных</h4><div class="btns" id="tabs" style="margin:0 0 10px"></div><p id="snote" style="margin:0 0 10px;color:#98a3b6"></p><div id="ctl"></div></div>
        <div class="viz"><h4>Z-score и сделки</h4>
          <div class="legend"><span><i class="dot" style="background:${C.up}"></i>▲ лонг спреда</span><span><i class="dot" style="background:${C.down}"></i>▼ шорт спреда</span><span><i class="dot" style="background:${C.exit}"></i>✕ выход</span></div>
          <div id="c1"></div></div>
        <div class="viz"><h4>Коэффициент k: ежедневный и замороженный в сделках</h4>
          <div class="legend"><span><i style="background:${GREY}"></i>настоящее β (в реальности неизвестно)</span><span><i style="background:#7ee0b566"></i>k из регрессии каждый день</span><span><i style="background:${GOLD}"></i>k, замороженный в сделке</span></div><div id="c2"></div></div>
        <div class="viz"><h4>Накопленный результат, пунктов</h4><div class="legend"><span><i style="background:${SIM}"></i>простой спред A − B</span><span><i style="background:${ME}"></i>динамический хедж</span></div><div id="c3"></div><div id="kp" style="margin-top:10px"></div></div>
        <div class="viz"><h4>Разбор одной сделки по ногам</h4><div class="btns" id="pick" style="margin:0 0 10px"></div><div id="leg"></div></div>`;
      const tabs = el.querySelector('#tabs');
      tabs.innerHTML = SC.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.scn = +b.dataset.i; s6.sel = 0; draw(); } });
      let d, r;
      const c1 = A.mkChart(el.querySelector('#c1'), 230, { tip: (i) => (r.z[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>k: ' + f(r.hedge.kUsed[i]) + '<br>z-score: <b>' + f(r.z[i]) + '</b>') });
      const c2 = A.mkChart(el.querySelector('#c2'), 170, {});
      const c3 = A.mkChart(el.querySelector('#c3'), 190, {});
      const ctl = el.querySelector('#ctl');
      const specs = [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost];
      const lotsBox = document.createElement('div');
      ctl.appendChild(lotsBox);
      function drawLegs() {
        const pick = el.querySelector('#pick'), tr = r.trades;
        if (!tr.length) { pick.innerHTML = ''; el.querySelector('#leg').innerHTML = '<div class="note">При этих настройках не было ни одной сделки. Уменьшите порог входа.</div>'; return; }
        if (s6.sel >= tr.length) s6.sel = 0;
        pick.innerHTML = tr.map((t, i) => '<button class="b' + (i === s6.sel ? ' on' : '') + '" data-i="' + i + '">№' + (i + 1) + ' · ' + (t.dir === 1 ? 'лонг' : 'шорт') + ' · ' + col(t.net) + '</button>').join('');
        const t = tr[s6.sel], L = s6.lots;
        const a0 = d.a[t.entryIdx], a1 = d.a[t.exitIdx], b0 = d.b[t.entryIdx], b1 = d.b[t.exitIdx];
        const legA = t.dir * (a1 - a0), legB = -t.dir * t.k * (b1 - b0), one = t.dir * ((a1 - a0) - (b1 - b0));
        const nb = L > 0 ? Math.round(t.k * L) : null;
        const verbA = t.dir === 1 ? 'купили' : 'продали', verbB = t.dir === 1 ? 'продали' : 'купили';
        const size = (L > 0 ? L + ' контр. A против ' + nb + ' контр. B' : '1 контракт A против k = ' + f(t.k, 3) + ' контракта B');
        el.querySelector('#leg').innerHTML = '<p style="margin:0 0 8px">Сигнал на вход в день <b>' + (t.signalIn + 1) + '</b>, вход в день <b>' + (t.entryIdx + 1) + '</b>, выход в день <b>' + (t.exitIdx + 1) + '</b> (' + A.REASON[t.reason] + '), держали ' + t.bars + ' дн. Позиция: <b>' + size + '</b>. Замороженный k = <b>' + f(t.k, 3) + '</b>.</p>' +
          '<table class="t"><tr><th>Нога</th><th>Действие на входе</th><th>Цена на входе</th><th>Цена на выходе</th><th>Результат, пунктов</th></tr>' +
          '<tr><td>A</td><td>' + verbA + ' 1</td><td>' + f(a0) + '</td><td>' + f(a1) + '</td><td>' + col(legA, 2) + '</td></tr>' +
          '<tr><td>B</td><td>' + verbB + ' ' + f(t.k, 3) + '</td><td>' + f(b0) + '</td><td>' + f(b1) + '</td><td>' + col(legB, 2) + '</td></tr>' +
          '<tr><td colspan="4"><b>Итого до издержек</b> (нога A + нога B)</td><td><b>' + col(legA + legB, 2) + '</b></td></tr>' +
          '<tr><td colspan="4">Издержки</td><td>' + col(-t.cost, 2) + '</td></tr>' +
          '<tr><td colspan="4"><b>Итого после издержек</b></td><td><b>' + col(t.net, 2) + '</b></td></tr></table>' +
          '<div class="note" style="margin-top:10px">Те же дни при простом спреде A − B (k = 1) дали бы <b>' + col(one, 2) + '</b> до издержек. Настоящее β (в учебных данных известно): на входе <b>' + f(d.beta[t.entryIdx]) + '</b>, на выходе <b>' + f(d.beta[t.exitIdx]) + '</b>; k на входе <b>' + f(t.k) + '</b>, k из регрессии в день выхода <b>' + f(r.hedge.k[t.exitIdx]) + '</b>. ' +
          (Math.abs(d.beta[t.exitIdx] - t.k) > 0.25 ? 'За время сделки связь заметно ушла от замороженного k: позиция уже хуже защищена от рынка, чем в момент входа.' : 'Замороженный k остался близок к настоящему β: защита от рынка сохранилась.') + '</div>';
      }
      el.querySelector('#pick').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.sel = +b.dataset.i; drawLegs(); } });
      function draw() {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s6.scn));
        el.querySelector('#snote').textContent = SC[s6.scn].note;
        d = gen(s6.scn);
        r = E.backtestHedge(d.a, d.b, hp({ lots: s6.lots }));
        const sm = simple(d), p = A.state.params, lim = Math.max(6, p.stopZ + 0.5), n = d.a.length;
        const frozen = new Array(n).fill(null);
        r.trades.forEach((t) => { for (let i = t.entryIdx; i <= t.exitIdx; i++) frozen[i] = t.k; });
        c1.render({ n, series: [{ data: r.z, color: C.z }], hlines: A.zLines(p), spans: A.positionSpans(r), markers: A.tradeMarkers(r, (i) => r.z[i]), yMin: -lim, yMax: lim });
        c2.render({ n, series: [{ data: d.beta, color: GREY, width: 1.6, dash: [6, 5] }, { data: r.hedge.k, color: '#7ee0b566', width: 1.2 }, { data: frozen, color: GOLD, width: 3 }], yMin: 0, yMax: 3 });
        c3.render({ n, series: [{ data: sm.equity, color: SIM, width: 2 }, { data: r.equity, color: ME, width: 2.4 }], hlines: [{ y: 0, color: '#ffffff44', dash: [] }] });
        el.querySelector('#kp').innerHTML = '<table class="t"><tr><th></th><th>Простой A − B</th><th>Динамический хедж</th></tr>' +
          '<tr><td>Сделок</td><td>' + sm.metrics.count + '</td><td>' + r.metrics.count + '</td></tr>' +
          '<tr><td>Итог, пунктов</td><td>' + col(sm.metrics.total) + '</td><td>' + col(r.metrics.total) + '</td></tr>' +
          '<tr><td>Макс. просадка</td><td>' + f(-sm.metrics.maxDD, 1) + '</td><td>' + f(-r.metrics.maxDD, 1) + '</td></tr></table>';
        drawLegs();
      }
      window.HV.slider(lotsBox, { label: 'Контрактов A (L) для округления', min: 0, max: 10, step: 1, value: s6.lots, fmt: (v) => (v === 0 ? 'без округления' : f(v, 0) + ' контр. A'), hint: '0 — дробный k. Больше нуля — реальное целое число контрактов, как на экране 5.', onInput: (v) => { s6.lots = v; draw(); } });
      A.controls(ctl.insertBefore(document.createElement('div'), lotsBox), specs, draw);
      draw();
    }
  });
})();
