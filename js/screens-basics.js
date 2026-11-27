/* Экраны 1–4: идея, спред, среднее и разброс, z-score. */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine;
  const C = U.COLORS;
  const SEEDS = [21, 7, 11, 3, 5, 13, 42];

  window.SPECS = {
    n: { key: 'n', label: 'Длина окна N, дней', min: 5, max: 120, step: 1, d: 0, hint: 'Сколько последних дней берём, чтобы определить «обычный уровень» спреда.' },
    entryZ: { key: 'entryZ', label: 'Порог входа, σ', min: 0.5, max: 4, step: 0.25, d: 2, hint: 'Насколько необычным должен быть спред, чтобы открыть сделку.' },
    exitZ: { key: 'exitZ', label: 'Порог выхода, σ', min: 0, max: 3, step: 0.25, d: 2, hint: '0 — ждём полного возврата к среднему; больше нуля — выходим раньше.' },
    stopZ: { key: 'stopZ', label: 'Стоп, σ', min: 1, max: 6, step: 0.25, d: 2, hint: 'Если спред ушёл ещё дальше, признаём ошибку и закрываем позицию.' },
    stopOn: { key: 'stopOn', type: 'check', label: 'Использовать стоп', hint: 'Без стопа убыточная сделка может висеть сколько угодно.' },
    maxHold: { key: 'maxHold', label: 'Макс. удержание, дней (0 = нет)', min: 0, max: 60, step: 1, d: 0, hint: 'Если за это время спред не вернулся, закрываем принудительно.' },
    cost: { key: 'cost', label: 'Издержки на сделку, пунктов', min: 0, max: 5, step: 0.25, d: 2, hint: 'Комиссии и проскальзывание по обеим ногам, вход и выход вместе.' },
    delayOn: { key: 'delayOn', type: 'check', label: 'Исполнять на следующий день после сигнала', hint: 'Реалистичнее: сигнал виден по итогам дня, а сделка проходит на следующий.' }
  };

  const Z = (window.ZSCREENS = window.ZSCREENS || []);

  /* ---------- 1. Идея ---------- */
  Z.push({
    id: 'idea',
    title: 'Идея: на чём здесь зарабатывают',
    lead: 'Сначала — только общая картина и самые необходимые слова. Любой термин с пунктирным подчёркиванием можно навести курсором и прочитать, что он значит.',
    text: () => `
      <h3>Что такое срочный рынок и фьючерс</h3>
      <p>На обычном рынке вы платите деньги и сразу получаете актив. На ${T('term_market', 'срочном рынке')} торгуют ${T('futures', 'фьючерсами')}: договорами «купить или продать что-то в будущем по цене, зафиксированной сегодня». Самого актива вы не получаете — меняется только цена договора, и именно на этой разнице вы зарабатываете или теряете.</p>
      <h3>Что такое спред</h3>
      <p>Возьмём два связанных инструмента — назовём их A и B. Обычно они двигаются вместе: например, два фьючерса на один актив с разными датами исполнения (${T('calendar_spread', 'календарный спред')}) или фьючерсы на близкие по смыслу активы. Разница их цен называется ${T('spread', 'спредом')}.</p>
      <h3>В чём идея стратегии</h3>
      <p>Сами цены гуляют непредсказуемо, а вот разница между двумя связанными ценами часто колеблется возле «обычного» уровня — как резинка, привязанная к колышку. Оттянули слишком далеко — тянет назад. Это называют ${T('mean_reversion', 'возвратом к среднему')}.</p>
      <p>Стратегия ставит именно на это: когда спред необычно далеко от обычного уровня, открываем сразу две сделки (одну на покупку, другую на продажу) и ждём, пока разница вернётся.</p>
      <div class="note"><b>Почему это называют ${T('arbitrage', 'арбитражем')}.</b> Мы не угадываем, куда пойдёт рынок в целом: если он вырастет, выигрыш по одной ${T('leg', 'ноге')} почти погасит проигрыш по другой. Важно только, как изменится разница. Но это ${T('stat_arb', 'статистический арбитраж')}: при смене ${T('regime', 'режима рынка')} или просадке ${T('liquidity', 'ликвидности')} связь может нарушиться, и тогда будут убытки.</div>
      <div class="note warn"><b>Данные здесь — ${T('synthetic', 'учебные')}.</b> Их создал компьютер, и они специально «возвращаются к среднему», чтобы механику было видно. Реальный рынок устроен суровее; про это — отдельный экран «Риски и ловушки».</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><h4>Цены двух инструментов</h4><p class="cap">Каждая точка — один торговый день. Наведите курсор на график.</p>
          <div class="legend"><span><i style="background:${C.a}"></i>Инструмент A</span><span><i style="background:${C.b}"></i>Инструмент B</span></div><div id="c1"></div></div>
        <div class="viz"><h4>Спред = цена A − цена B</h4><p class="cap">Та же история, но показана только разница.</p><div id="c2"></div>
          <div class="note" id="facts"></div>
          <div class="btns"><button class="b" id="newdata">Показать другие учебные данные</button></div></div>`;
      const c1 = A.mkChart(el.querySelector('#c1'), 230, { tip: (i) => { const d = A.data(); return '<b>День ' + (i + 1) + '</b><br>A: ' + U.fmt(d.a[i]) + '<br>B: ' + U.fmt(d.b[i]); } });
      const c2 = A.mkChart(el.querySelector('#c2'), 210, { tip: (i) => { const d = A.data(); return '<b>День ' + (i + 1) + '</b><br>Спред: ' + U.fmt(d.spread[i]); } });
      function draw() {
        const d = A.data(), n = d.a.length;
        c1.render({ n, series: [{ data: d.a, color: C.a }, { data: d.b, color: C.b }] });
        const avg = d.spread.reduce((s, x) => s + x, 0) / n;
        c2.render({ n, series: [{ data: d.spread, color: C.spread }], hlines: [{ y: avg, color: C.mean, label: 'среднее ' + U.fmt(avg, 1) }] });
        const rng = (a) => Math.max.apply(null, a) - Math.min.apply(null, a);
        el.querySelector('#facts').innerHTML = 'Цена B за эти дни прошла путь шириной <b>' + U.fmt(rng(d.b), 0) + '</b> пунктов, а спред колебался в коридоре шириной всего <b>' + U.fmt(rng(d.spread), 0) + '</b>. Именно эта «привязанность» разницы к своему уровню и есть то, что использует стратегия.';
      }
      el.querySelector('#newdata').addEventListener('click', () => { const s = A.state; s.seed = SEEDS[(SEEDS.indexOf(s.seed) + 1) % SEEDS.length]; draw(); });
      draw();
    }
  });

  /* ---------- 2. Спред ---------- */
  Z.push({
    id: 'spread',
    title: 'Спред: что мы измеряем и как зарабатываем',
    lead: 'Главное, что нужно понять на этом экране: прибыль по спреду зависит только от изменения разницы цен, а не от того, куда пошёл рынок целиком.',
    text: () => `
      <h3>Формула</h3>
      <span class="formula">спред = цена A − цена B<small>результат в ${T('point', 'пунктах')} — единицах цены</small></span>
      <p>Пример: A стоит 1 062, B стоит 1 000. Спред = 1 062 − 1 000 = 62 пункта.</p>
      <h3>Два способа торговать спред</h3>
      <ul>
        <li>${T('long_spread', 'Лонг спреда')}: <b>купить A (${T('long', 'лонг')}) и продать B (${T('short', 'шорт')})</b>. Выигрываем, если спред вырос.</li>
        <li>${T('short_spread', 'Шорт спреда')}: <b>продать A и купить B</b>. Выигрываем, если спред упал.</li>
      </ul>
      <p>Почему так? Покупка A приносит прибыль, когда A дорожает, а продажа B — когда B дешевеет. Если A дорожает сильнее, чем B, разница растёт — и обе ноги работают на нас.</p>
      <h3>Результат равен изменению спреда</h3>
      <span class="formula">результат = направление × (спред на выходе − спред на входе)<small>направление: +1 для лонга спреда, −1 для шорта спреда</small></span>
      <p>Поиграйте с калькулятором справа. Сдвиньте ползунок «рынок целиком»: обе цены на выходе вырастут или упадут на одно и то же число — а итог по спреду не изменится. Это и есть «независимость от рынка».</p>
      <div class="note"><b>Упрощения учебника.</b> Берём по одному контракту каждой ноги, стоимость пункта одинакова, ${T('hedge_ratio', 'коэффициент хеджирования')} равен 1. На бирже у контрактов могут быть разные множители, и тогда число контрактов подбирают иначе.</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><h4>Калькулятор спреда</h4><p class="cap">Меняйте любые числа — результат пересчитывается сразу.</p>
          <div class="calc-grid">
            <div><label>Цена A при входе</label><input type="number" id="ain" value="1062" step="1"></div>
            <div><label>Цена B при входе</label><input type="number" id="bin" value="1000" step="1"></div>
            <div><label>Цена A при выходе</label><input type="number" id="aout" value="1070" step="1"></div>
            <div><label>Цена B при выходе</label><input type="number" id="bout" value="1018" step="1"></div>
            <div><label>Позиция</label><select id="dir"><option value="1">Лонг спреда: купить A, продать B</option><option value="-1">Шорт спреда: продать A, купить B</option></select></div>
            <div><label>Рынок целиком сдвинулся на: <b id="shv">0</b> пунктов (добавляется к обеим ценам выхода)</label><input type="range" id="shift" min="-60" max="60" step="1" value="0"></div>
          </div>
          <div class="result" id="res"></div></div>`;
      const g = (id) => parseFloat(el.querySelector('#' + id).value) || 0;
      function calc() {
        const sh = g('shift');
        el.querySelector('#shv').textContent = U.sgn(sh, 0);
        const ain = g('ain'), bin = g('bin'), aout = g('aout') + sh, bout = g('bout') + sh;
        const dir = parseInt(el.querySelector('#dir').value, 10);
        const legA = dir * (aout - ain), legB = -dir * (bout - bin);
        const sin = ain - bin, sout = aout - bout;
        const col = (x) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, 1) + '</span>';
        el.querySelector('#res').innerHTML =
          '<table class="t"><tr><th></th><th>Вход</th><th>Выход</th><th>Результат</th></tr>' +
          '<tr><td>Нога A (' + (dir === 1 ? 'купили' : 'продали') + ')</td><td>' + U.fmt(ain, 1) + '</td><td>' + U.fmt(aout, 1) + '</td><td>' + col(legA) + '</td></tr>' +
          '<tr><td>Нога B (' + (dir === 1 ? 'продали' : 'купили') + ')</td><td>' + U.fmt(bin, 1) + '</td><td>' + U.fmt(bout, 1) + '</td><td>' + col(legB) + '</td></tr>' +
          '<tr><td>Спред A − B</td><td>' + U.fmt(sin, 1) + '</td><td>' + U.fmt(sout, 1) + '</td><td></td></tr></table>' +
          '<p style="margin:10px 0 4px">Сумма двух ног: <span class="big">' + col(legA + legB) + '</span> пунктов</p>' +
          '<p style="margin:0;color:#98a3b6;font-size:14px">Проверка по формуле: ' + (dir === 1 ? '+1' : '−1') + ' × (' + U.fmt(sout, 1) + ' − ' + U.fmt(sin, 1) + ') = ' + U.sgn(dir * (sout - sin), 1) + '. Совпадает с суммой ног.</p>';
      }
      el.addEventListener('input', calc);
      calc();
    }
  });

  /* ---------- 3. Среднее и разброс ---------- */
  Z.push({
    id: 'stats',
    title: 'Среднее и разброс: что считать «обычным»',
    lead: 'Чтобы заметить, что спред необычно далеко, нужно знать, что для него обычно. Для этого считаем два числа по последним N дням.',
    text: () => `
      <h3>Число 1. ${T('mean', 'Среднее')}</h3>
      <span class="formula">среднее = (сумма значений в окне) ÷ N<small>центр, вокруг которого колеблется спред</small></span>
      <h3>Число 2. Разброс — ${T('std', 'стандартное отклонение')} («сигма», σ)</h3>
      <p>Показывает, насколько спред обычно отходит от среднего. Считается в четыре шага:</p>
      <ol>
        <li>для каждого дня находим ${T('deviation', 'отклонение')}: значение минус среднее;</li>
        <li>возводим каждое отклонение в квадрат, чтобы плюсы и минусы не гасили друг друга;</li>
        <li>берём среднее этих квадратов — это ${T('variance', 'дисперсия')};</li>
        <li>извлекаем квадратный корень — получаем σ.</li>
      </ol>
      <p>σ = 4 читается так: «обычно спред отходит от среднего примерно на 4 пункта».</p>
      <h3>Почему окно «скользящее»</h3>
      <p>Это ${T('window', 'скользящее окно')} (${T('sample', 'выборка')} последних N дней): каждый день добавляется свежее значение, а самое старое выпадает. Так среднее и σ подстраиваются под текущие условия. Первые N−1 дней посчитать нельзя — окно ещё не набралось.</p>
      <div class="note"><b>Только прошлое.</b> В окно входит сегодняшний день и предыдущие. Будущее неизвестно; если бы расчёт его использовал, это было бы ${T('lookahead', 'заглядыванием в будущее')}.</div>
      <h3>Что даёт длина окна N</h3>
      <ul>
        <li><b>Короткое</b> (10–20 дней): быстро подстраивается, но «нервное» — временный всплеск легко принимает за норму.</li>
        <li><b>Длинное</b> (60–120 дней): спокойное, но медленно замечает, что обстановка изменилась.</li>
      </ul>
      <p>Подвигайте ползунок справа и посмотрите, как меняются линии.</p>`,
    mount(el) {
      el.innerHTML = `<div class="viz"><h4>Спред, его среднее и коридор ±1σ, ±2σ</h4>
        <p class="cap">Нажмите на график, чтобы увидеть, какие дни попали в окно выбранного дня.</p>
        <div class="legend"><span><i style="background:${C.spread}"></i>спред</span><span><i style="background:${C.mean}"></i>среднее</span><span><i style="background:#5aa9ff"></i>среднее ± σ</span><span><i style="background:#f5a65b"></i>среднее ± 2σ</span></div>
        <div id="ch"></div><div id="ctl"></div><div class="note" id="read"></div></div>`;
      const bt0 = () => A.backtest();
      let chart;
      const ctl = A.controls(el.querySelector('#ctl'), [window.SPECS.n], draw);
      chart = A.mkChart(el.querySelector('#ch'), 300, {
        tip: (i) => A.barTip(i, bt0()),
        onClick: (i) => { A.state.bar = i; draw(); }
      });
      function draw() {
        const d = A.data(), p = A.state.params, r = E.rolling(d.spread, p.n), n = d.spread.length;
        const band = (k) => r.mean.map((m, i) => (m === null ? null : m + k * r.std[i]));
        let t = A.state.bar === null ? 120 : A.state.bar;
        if (t < p.n - 1) t = p.n - 1;
        chart.render({
          n,
          series: [
            { data: band(2), color: '#f5a65b', width: 1, dash: [4, 4] }, { data: band(-2), color: '#f5a65b', width: 1, dash: [4, 4] },
            { data: band(1), color: '#5aa9ff', width: 1, dash: [4, 4] }, { data: band(-1), color: '#5aa9ff', width: 1, dash: [4, 4] },
            { data: r.mean, color: C.mean, width: 2 }, { data: d.spread, color: C.spread, width: 1.6 }
          ],
          spans: [{ i0: t - p.n + 1, i1: t, color: '#c9b6ff1c' }],
          cursor: t
        });
        const ex = E.explainBar(d.spread, p.n, t);
        el.querySelector('#read').innerHTML = '<b>День ' + (t + 1) + '.</b> Окно — дни с ' + (t - p.n + 2) + ' по ' + (t + 1) + ' (' + p.n + ' дней). Среднее = <b>' + U.fmt(ex.mean) + '</b>, σ = <b>' + U.fmt(ex.std) + '</b>. Значит, «обычно» спред колеблется примерно от ' + U.fmt(ex.mean - ex.std, 1) + ' до ' + U.fmt(ex.mean + ex.std, 1) + '.';
      }
      draw();
    }
  });

  /* ---------- 4. Z-score ---------- */
  Z.push({
    id: 'zscore',
    title: 'Z-score: единая шкала отклонений',
    lead: 'Z-score превращает «спред равен 68,4» в понятное «спред необычно высок: на 2,1 сигмы выше обычного». Именно по нему стратегия принимает решения.',
    text: () => `
      <h3>Формула</h3>
      <span class="formula">z = (спред сегодня − среднее) ÷ σ<small>${T('zscore', 'Z-score')} — на сколько сигм спред отошёл от среднего</small></span>
      <h3>Как читать число</h3>
      <ul>
        <li><b>z = 0</b> — спред ровно на среднем уровне;</li>
        <li><b>z = +2</b> — спред выше среднего на две сигмы: необычно высокий;</li>
        <li><b>z = −2</b> — ниже среднего на две сигмы: необычно низкий;</li>
        <li>знак показывает сторону, величина — силу отклонения.</li>
      </ul>
      <h3>Зачем делить на σ</h3>
      <p>Отклонение в 6 пунктов — пустяк для «бурного» спреда (σ = 10) и событие для спокойного (σ = 2). Деление на σ переводит всё в одну шкалу: «насколько это необычно именно для этого спреда».</p>
      <h3>Как часто бывают большие значения</h3>
      <p>Если отклонения похожи на ${T('normal', 'нормальное распределение')}, то за пределами ±1σ спред оказывается примерно в 32% дней, за пределами ±2σ — примерно в 4,6%, ±3σ — примерно в 0,3%. Таблица справа сравнивает эти ожидания с тем, что есть в учебных данных.</p>
      <div class="note warn"><b>Оговорка.</b> У реального рынка есть ${T('fat_tails', '«толстые хвосты»')}: крайние значения встречаются чаще, чем у нормального распределения. Поэтому z = 3 на практике — не «событие раз в тысячу дней».</div>
      <details class="quiz"><summary>Проверьте себя до клика по графику: где сигнал сильнее?</summary><p>Спред A отошёл от среднего на <b>+6 п.</b> при привычном разбросе <code>σ = 2 п.</code>, а спред B — на <b>+15 п.</b> при <code>σ = 10 п.</code> У кого сигнал сильнее? <b>Ответ:</b> у спреда A <code>z = +6 ÷ 2 = +3,0σ</code> (редкое отклонение!), а у B лишь <code>+15 ÷ 10 = +1,5σ</code> (обычный шум).</p></details>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz"><h4>Спред и его среднее</h4><div id="c1"></div></div>
        <div class="viz"><h4>Z-score по дням</h4><p class="cap">Пунктирные линии — ±1, ±2, ±3 сигмы. Наведите курсор: внизу будет видна подстановка в формулу.</p>
          <div id="c2"></div><div id="ctl"></div><div class="note" id="sub">Наведите курсор на график z-score.</div>
          <table class="t" id="tab"></table></div>`;
      const bt = () => A.backtest();
      const sub = el.querySelector('#sub');
      const c1 = A.mkChart(el.querySelector('#c1'), 190, { tip: (i) => A.barTip(i, bt()) });
      const c2 = A.mkChart(el.querySelector('#c2'), 250, {
        tip: (i) => { const b = bt(); return b.z[i] === null ? null : A.barTip(i, b); }
      });
      A.controls(el.querySelector('#ctl'), [window.SPECS.n], draw);
      el.querySelector('#c2').addEventListener('mousemove', () => {
        const i = c2.hover, b = bt();
        if (i === null || b.z[i] === null) return;
        const d = A.data();
        sub.innerHTML = '<b>День ' + (i + 1) + ':</b> z = (' + U.fmt(d.spread[i]) + ' − ' + U.fmt(b.mean[i]) + ') ÷ ' + U.fmt(b.std[i]) + ' = <b>' + U.fmt(b.z[i]) + '</b>';
      });
      function draw() {
        const d = A.data(), n = d.spread.length, b = bt();
        c1.render({ n, series: [{ data: b.mean, color: C.mean, width: 2 }, { data: d.spread, color: C.spread }] });
        const hl = [3, 2, 1, 0, -1, -2, -3].map((k) => ({ y: k, color: k === 0 ? '#ffffff55' : Math.abs(k) === 3 ? '#ff6b6b88' : Math.abs(k) === 2 ? '#f5a65b88' : '#5aa9ff77', dash: k === 0 ? [] : [4, 4], label: k === 0 ? '' : (k > 0 ? '+' : U.MINUS) + Math.abs(k) + 'σ' }));
        c2.render({ n, series: [{ data: b.z, color: C.z }], hlines: hl, yMin: -4.5, yMax: 4.5 });
        const valid = b.z.filter((x) => x !== null);
        const share = (k) => valid.filter((x) => Math.abs(x) > k).length / valid.length;
        el.querySelector('#tab').innerHTML = '<tr><th>Отклонение больше</th><th>ожидание для «нормального» случая</th><th>в учебных данных</th></tr>' +
          [1, 2, 3].map((k) => '<tr><td>' + k + 'σ (в любую сторону)</td><td>' + U.fmt(E.tailTwoSided(k) * 100, 1) + '% дней</td><td>' + U.fmt(share(k) * 100, 1) + '% дней</td></tr>').join('');
      }
      draw();
    }
  });
})();
