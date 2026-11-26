/* Динамический хедж, экран 7: пошаговый разбор одного дня (#24).
   Все числа берутся из E.explainHedge: то же, что считает движок, только по шагам. */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, S = window.SPECS, HV = window.HV;
  const C = U.COLORS;
  const Z = (window.HSCREENS = window.HSCREENS || []);
  const SC = E.HEDGE_SCENARIOS;
  const ME = '#7ee0b5', GOLD = '#ffd166', GREY = '#8b95a7';
  const nz = (v) => { if (v === null || v === undefined || Number.isNaN(v)) return '—'; for (let d = 0; d <= 3; d++) if (Math.abs(v * Math.pow(10, d) - Math.round(v * Math.pow(10, d))) < 1e-9) return U.fmt(v, d); return U.fmt(v, 3); };
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const s7 = { scn: 1, lots: 0, day: null };

  Z.push({
    id: 'day',
    title: 'Пошаговый разбор одного дня',
    lead: 'Выберите любой день и посмотрите, как из сырых цен A и B получается решение «входить, держать, выходить или ждать». Каждый шаг: что делаем словами, формула с вашими числами, итог. Все цифры те же, что считает программа.',
    text: () => `
      <h3>Девять шагов от цен до решения</h3>
      <p>Каждый день программа делает одно и то же. Слева, под выбором дня, эти шаги расписаны с настоящими числами. Здесь коротко, зачем каждый:</p>
      <ol>
        <li><b>Берём окно.</b> Последние N дней, включая сегодняшний, и ничего из будущего. Так мы ничего не «подглядываем»: в реальной торговле завтрашних цен тоже нет.</li>
        <li><b>Находим средние цены</b> B и A в окне. Это «центр облака точек», через который обязательно проходит лучшая прямая.</li>
        <li><b>Считаем отклонения</b> каждого дня от своего среднего: насколько цена этого дня выше или ниже средней. Дальше нам нужны две суммы: сумма произведений отклонений (она показывает, двигаются ли A и B в одну сторону) и сумма квадратов отклонений B (она показывает, насколько вообще B гуляет).</li>
        <li><b>Получаем k</b> как отношение этих двух сумм. Это и есть ${T('slope', 'наклон прямой')}: на сколько пунктов в среднем меняется A, когда B меняется на один пункт.</li>
        <li><b>Округляем</b> k до реального числа контрактов (если вы включили округление на ползунке ниже). Контракты бывают только целыми, поэтому 1,43 приходится заменять на 1,4 (то есть 5 контрактов A против 7 контрактов B) или близкое число.</li>
        <li><b>Строим спред A − k·B</b> для каждого дня окна уже с этим k. Заметьте: старые дни окна пересчитываются с сегодняшним k, а не с тем, что был в тот день. Мы спрашиваем: «если бы сегодняшний коэффициент действовал всё окно, насколько необычен сегодняшний спред?».</li>
        <li><b>Считаем ${T('mean', 'среднее')} и ${T('std', 'разброс σ')}</b> этого спреда по окну: «обычный уровень» и «обычный размах» спреда.</li>
        <li><b>Считаем ${T('zscore', 'z-score')}:</b> сколько разбросов отделяет сегодняшний спред от среднего.</li>
        <li><b>Принимаем решение</b> по тем же правилам, что у простого z-score: сравниваем z с порогами входа, выхода и стопа.</li>
      </ol>
      <div class="note"><b>Проверьте сами.</b> Возьмите калькулятор и повторите шаги 4 и 8 на своих числах: k = (сумма произведений) ÷ (сумма квадратов), z = (спред − среднее) ÷ σ. Должно сойтись с тем, что написано слева. Если не сходится из-за округления, смотрите на количество знаков после запятой: в таблице справа показаны не все.</div>
      <div class="note warn"><b>Важная тонкость.</b> Если вы сейчас <i>в сделке</i>, то решение «держать или выйти» принимается по сегодняшнему z (он считается по сегодняшнему k), а прибыль позиции считается по замороженному k, которым сделку открыли (экран 6). Это две разные вещи: сигнал берёт свежие данные, позиция остаётся такой, какой была куплена.</div>`,
    mount(el) {
      el.innerHTML = `
        <div style="display:grid;grid-template-columns:560px 1fr;gap:28px;align-items:start">
          <div>
            <div class="viz"><h4>Сценарий данных</h4><div class="btns" id="tabs" style="margin:0 0 10px"></div><p id="snote" style="margin:0;color:#98a3b6"></p></div>
            <div class="viz"><h4>Выбор дня: <span id="dayv"></span></h4><input type="range" id="day" style="margin-top:8px">
              <div class="btns"><button class="b" id="bp">◀ День назад</button><button class="b" id="bn">День вперёд ▶</button><button class="b" id="bs">К следующему сигналу</button></div></div>
            <div class="viz calc-steps" id="steps"></div>
            <div class="viz"><h4>Настройки</h4><div id="ctl"></div></div>
          </div>
          <div>
            <div class="viz"><h4>Облако окна: цена B (по горизонтали) и цена A (по вертикали)</h4><p class="cap">Жёлтая точка — сегодняшний день. Зелёная прямая — найденная регрессия, красные отрезки — остатки.</p><div id="sc"></div></div>
            <div class="viz"><h4>Z-score</h4><div id="c1"></div></div>
            <div class="viz"><h4>Коэффициент k по дням (серый пунктир — настоящее β, в реальности неизвестное)</h4><div id="c2"></div></div>
            <div class="viz"><h4>Числа расчёта по дням окна</h4><p class="cap">Дни от старого к сегодняшнему. Нижняя строка — суммы, которые идут в формулы слева.</p><div class="scroll" style="max-height:380px"><table class="t" id="win"></table></div></div>
          </div>
        </div>`;
      el.querySelector('#sc').innerHTML = '<div class="chartbox"><canvas></canvas></div>';
      const scatter = new HV.Scatter(el.querySelector('#sc canvas'), { height: 300, tip: (p) => '<b>День ' + (p.idx + 1) + '</b><br>B: ' + f(p.x) + '<br>A: ' + f(p.y) });
      const tabs = el.querySelector('#tabs');
      tabs.innerHTML = SC.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s7.scn = +b.dataset.i; draw(); } });
      let d, r;
      const day = el.querySelector('#day');
      const n = E.genHedge(A.state.seed, SC[0]).a.length;
      day.min = 1; day.max = n; day.step = 1;
      const hp = () => Object.assign(A.btParams(), { lots: s7.lots });
      const c1 = A.mkChart(el.querySelector('#c1'), 180, { onClick: (i) => { s7.day = i; draw(); }, tip: (i) => (r.z[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>z-score: <b>' + f(r.z[i]) + '</b>') });
      const c2 = A.mkChart(el.querySelector('#c2'), 150, { onClick: (i) => { s7.day = i; draw(); }, tip: (i) => (r.hedge.k[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>k: ' + f(r.hedge.k[i], 3) + '<br>настоящее β: ' + f(d.beta[i], 3)) });
      const ctl = el.querySelector('#ctl');
      const ctlA = document.createElement('div'); ctl.appendChild(ctlA);
      const ctlB = document.createElement('div'); ctl.appendChild(ctlB);
      HV.slider(ctlB, { label: 'Контрактов A (L) для округления', min: 0, max: 10, step: 1, value: s7.lots, fmt: (v) => (v === 0 ? 'без округления' : f(v, 0) + ' контр. A'), hint: '0 — дробный k. Больше нуля — реальное целое число контрактов.', onInput: (v) => { s7.lots = v; draw(); } });
      A.controls(ctlA, [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost], draw);
      const firstSignal = () => { const i = r.signal.findIndex((s) => s); return i < 0 ? A.state.params.n - 1 : i; };
      day.addEventListener('input', () => { s7.day = parseInt(day.value, 10) - 1; draw(); });
      el.querySelector('#bp').addEventListener('click', () => { s7.day = Math.max(0, s7.day - 1); draw(); });
      el.querySelector('#bn').addEventListener('click', () => { s7.day = Math.min(n - 1, s7.day + 1); draw(); });
      el.querySelector('#bs').addEventListener('click', () => { let i = s7.day + 1; while (i < n && !r.signal[i]) i++; s7.day = i < n ? i : firstSignal(); draw(); });
      const row = (k, title, text, val) => '<div class="row"><div class="n">' + k + '</div><div><b>' + title + '</b><div style="color:#98a3b6;font-size:14px">' + text + '</div>' + (val ? '<div class="v">' + val + '</div>' : '') + '</div></div>';

      function draw() {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s7.scn));
        el.querySelector('#snote').textContent = SC[s7.scn].note;
        d = E.genHedge(A.state.seed, SC[s7.scn]);
        const p = A.state.params, N = p.n;
        r = E.backtestHedge(d.a, d.b, hp());
        if (s7.day === null) s7.day = firstSignal();
        if (s7.day < N - 1) s7.day = N - 1;
        const t = s7.day;
        day.value = t + 1;
        el.querySelector('#dayv').textContent = 'день ' + (t + 1) + ' из ' + n;
        const ex = E.explainHedge(d.a, d.b, N, t, { lots: s7.lots });
        if (!ex) { el.querySelector('#steps').innerHTML = '<div class="note">Для этого дня расчёт невозможен: B почти не менялась в окне, и k определить нельзя. Выберите другой день.</div>'; return; }
        const dec = A.decisionText(t, r, r.params);
        const lo = t - N + 1;
        const nb = s7.lots > 0 ? Math.round(ex.k * s7.lots) : null;
        const kFmt = f(ex.k, 4);
        el.querySelector('#steps').innerHTML =
          row(1, 'Окно', 'Последние N = ' + N + ' дней: с ' + (lo + 1) + '-го по ' + (t + 1) + '-й включительно. Дней из будущего в окне нет.', 'Дней в окне: ' + N) +
          row(2, 'Средние цены', 'Складываем цены и делим на N. Эта пара чисел — центр облака точек.', 'B̄ = ' + f(ex.mx, 3) + ';  Ā = ' + f(ex.my, 3)) +
          row(3, 'Отклонения и суммы', 'Для каждого дня: dB = цена B − B̄, dA = цена A − Ā (столбцы справа). Складываем произведения dB·dA и квадраты dB².', 'Σ dB·dA = ' + f(ex.sxy, 2) + ';  Σ dB² = ' + f(ex.sxx, 2)) +
          row(4, 'Коэффициент k', 'k = сумма произведений ÷ сумма квадратов. Показывает, на сколько пунктов в среднем двигается A при движении B на один пункт.', 'k = ' + f(ex.sxy, 2) + ' ÷ ' + f(ex.sxx, 2) + ' = <b>' + kFmt + '</b>;  сдвиг c = ' + f(ex.my, 2) + ' − ' + kFmt + ' × ' + f(ex.mx, 2) + ' = ' + f(ex.alpha, 2)) +
          row(5, 'Округление до контрактов', s7.lots > 0 ? 'Берём ' + s7.lots + ' контр. A и подбираем целое число контрактов B: k × L = ' + kFmt + ' × ' + s7.lots + ' = ' + f(ex.k * s7.lots, 2) + ', округляем до ' + nb + '. Рабочий коэффициент = ' + nb + ' ÷ ' + s7.lots + '.' : 'Округление выключено: берём дробный k как есть (включается ползунком «Контрактов A» в настройках).', 'k для спреда = <b>' + nz(ex.kUsed) + '</b>' + (s7.lots > 0 ? ' (' + s7.lots + ' контр. A против ' + nb + ' контр. B)' : '')) +
          row(6, 'Спред на каждый день окна', 'Для каждого дня: цена A − k × цена B (последний столбец справа). Всё окно считаем с сегодняшним k.', 'Сегодня: ' + f(ex.rows[N - 1].y, 2) + ' − ' + nz(ex.kUsed) + ' × ' + f(ex.rows[N - 1].x, 2) + ' = <b>' + f(ex.value, 3) + '</b>') +
          row(7, 'Среднее и разброс спреда', 'Среднее: сумма спредов ÷ N. Дисперсия: средний квадрат отклонений от среднего. σ — корень из дисперсии.', 'Среднее = ' + f(ex.mean, 3) + ';  дисперсия = ' + f(ex.variance, 3) + ';  σ = √' + f(ex.variance, 3) + ' = ' + f(ex.std, 3)) +
          row(8, 'Z-score', 'Сегодняшний спред минус среднее, делённый на σ.', 'z = (' + f(ex.value, 3) + ' − ' + f(ex.mean, 3) + ') ÷ ' + f(ex.std, 3) + ' = <b>' + (ex.z === null ? '—' : f(ex.z, 3)) + '</b>') +
          '<div class="row"><div class="n">9</div><div><b>Решение</b><div class="decision ' + dec.cls + '">' + dec.html + '</div></div></div>';

        scatter.render({ points: ex.rows.map((q, i) => ({ x: q.x, y: q.y, idx: q.idx, hot: i === N - 1 })), lines: [{ k: ex.k, alpha: ex.alpha, color: ME, width: 2.4 }], residualsOf: { k: ex.k, alpha: ex.alpha, color: '#ff6b6b88' }, xLabel: 'цена B', yLabel: 'цена A' });
        const lim = Math.max(4.5, p.stopZ + 0.5);
        c1.render({ n, series: [{ data: r.z, color: C.z }], hlines: A.zLines(p), cursor: t, markers: A.tradeMarkers(r, (i) => r.z[i]), yMin: -lim, yMax: lim });
        c2.render({ n, series: [{ data: d.beta, color: GREY, width: 1.6, dash: [6, 5] }, { data: r.hedge.k, color: ME, width: 2 }], cursor: t, yMin: 0, yMax: 3 });
        const sums = ex.rows.reduce((q, w) => ({ dxx: q.dxx + w.dxx, dxy: q.dxy + w.dxy }), { dxx: 0, dxy: 0 });
        el.querySelector('#win').innerHTML = '<tr><th>День</th><th>B</th><th>A</th><th>dB</th><th>dA</th><th>dB²</th><th>dB·dA</th><th>A − k·B</th></tr>' +
          ex.rows.map((q, i) => '<tr' + (i === N - 1 ? ' class="sel"' : '') + '><td>' + (q.idx + 1) + '</td><td>' + f(q.x) + '</td><td>' + f(q.y) + '</td><td>' + U.sgn(q.dx, 2) + '</td><td>' + U.sgn(q.dy, 2) + '</td><td>' + f(q.dxx) + '</td><td>' + U.sgn(q.dxy, 2) + '</td><td>' + f(q.spread, 2) + '</td></tr>').join('') +
          '<tr><td><b>Σ</b></td><td></td><td></td><td></td><td></td><td><b>' + f(sums.dxx, 2) + '</b></td><td><b>' + U.sgn(sums.dxy, 2) + '</b></td><td></td></tr>';
      }
      draw();
    }
  });
})();
