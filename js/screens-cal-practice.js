/* Календарный спред, экраны 5–8: сезонность и аномальный год, правила и сделки с роллом,
   пошаговый разбор дня, честный эксперимент на 4 сценариях и анатомия рисков (#32). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, S = window.SPECS, HV = window.HV;
  const C = U.COLORS;
  const Z = (window.CALSCREENS = window.CALSCREENS || []);
  const SC = E.CAL_SCENARIOS;
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', PRE = '#5aa9ff', GOLD = '#ffd166', GREY = '#8b95a7';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 1 : d) + '</span>';

  function rollSpans(cal) {
    const out = [];
    cal.isRoll.forEach((r, i) => { if (r) out.push({ i0: i - 0.6, i1: i + 0.6, color: '#ffd16633' }); });
    return out;
  }

  /* ---------- 5. Сезонность: почему зимний фьючерс не равен летнему ---------- */
  const s5 = { abnormal: false, amp: 13 };

  Z.push({
    id: 'season',
    title: 'Сезонность: почему зимний фьючерс не равен летнему',
    lead: 'На рынках сырья, энергии и сельхозпродукции календарный спред качается по временам года. Если не знать календарь, обычное скользящее окно месяцами спорит с природой.',
    text: () => `
      <h3>Откуда берётся годовая волна</h3>
      <p>У золота или фондового индекса времена года почти неотличимы. Совсем иначе устроены газ, мазут, пшеница, кукуруза или сахар — здесь правит ${T('seasonality', 'сезонность')}:</p>
      <ul>
        <li><b>Газ и топочный мазут (зима против лета).</b> Летом отопление выключено: газ закачивают в подземные хранилища, запасов много, на рынке спокойное ${T('contango', 'контанго')} (зимний контракт заметно дороже летнего). Зимой в морозы все жгут запасы прямо сейчас — ближний контракт взлетает в ${T('backwardation', 'бэквордацию')}.</li>
        <li><b>Зерно: «старый» и «новый» урожай.</b> В августе амбары с прошлогодней пшеницей пустеют (ближний контракт дорогой), а сентябрьский — это уже свежий урожай с полей (он дешевле). В октябре элеваторы забиты зерном под завязку, и картина переворачивается.</li>
      </ul>
      <h3>Почему простое окно N = 30 здесь ошибается</h3>
      <p>Когда спред два месяца подряд плавно идёт вверх по своей обычной сезонной волне, среднее за последние 30 дней всё время отстаёт от него. Простой ${T('zscore', 'z-score')} видит «слишком высокий спред» (<b>z &gt; +2</b>) и раз за разом встаёт против нормального сезонного хода — как продавец зонтов, который удивляется осеннему дождю.</p>
      <h3>Вычитание сезонной нормы (без заглядывания в будущее)</h3>
      <p>Чтобы сравнивать «октябрь с октябрём», а не «октябрь с августом», считают средний уровень бесшовного спреда в этот же календарный день за <b>прошлые годы</b> (в нашей модели — строго по 3 предшествующим годам, без ${T('lookahead', 'заглядывания в будущее')}):</p>
      <div class="formula">Очищенный спред<sub>t</sub> = Бесшовный<sub>t</sub> − Сезонная норма прошлых лет<sub>t</sub></div>
      <p>Теперь z-score отвечает на правильный вопрос: <i>«необычен ли сегодняшний спред именно для этого времени года?»</i></p>
      <div class="note warn"><b>Ловушка аномального года.</b> Сезонная норма помнит только <i>прошлую</i> погоду. Переключите справа кнопку на «Аномальный год» (тёплая зима, засуха или перебои поставок): старый шаблон толкает расчёт в противоположную сторону, и сезонная поправка из помощника превращается в источник убытков.</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Режим природы и размах годовой волны</h4>
          <div class="btns" id="mode" style="margin:0 0 8px">
            <button class="b" data-ab="0">Обычный сезонный год (как в прошлые 3 года)</button>
            <button class="b" data-ab="1">Аномальный год (погода перевернула волну)</button>
          </div>
          <div id="ampctl"></div>
          <div id="ctl"></div>
        </div>
        <div class="viz">
          <h4>Бесшовный спред, норма прошлых 3 лет и очищенный остаток</h4>
          <div class="legend">
            <span><i style="background:${PRE}"></i>бесшовный спред</span>
            <span><i style="background:${GOLD}"></i>норма прошлых 3 лет</span>
            <span><i style="background:${ME}"></i>очищенный (бесшовный − норма)</span>
          </div>
          <div id="c1"></div>
        </div>
        <div class="viz">
          <h4>Сравнение z-score: без учёта календаря и после вычитания нормы</h4>
          <div class="legend">
            <span><i style="background:${SIM}"></i>z по бесшовному ряду</span>
            <span><i style="background:${ME}"></i>z после вычитания сезонной нормы</span>
          </div>
          <div id="c2"></div>
        </div>
        <div class="viz">
          <h4>Накопленный результат торговли (оба варианта с бесшовным роллом)</h4>
          <div class="legend">
            <span><i style="background:${SIM}"></i>ролл без сезонности</span>
            <span><i style="background:${ME}"></i>ролл + сезонная норма</span>
          </div>
          <div id="c3"></div>
          <table class="t" id="tab" style="margin-top:10px"></table>
          <div class="note" id="note" style="margin-top:10px"></div>
        </div>`;

      const modeEl = el.querySelector('#mode');
      modeEl.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (b) { s5.abnormal = b.dataset.ab === '1'; draw(); }
      });

      HV.slider(el.querySelector('#ampctl'), {
        label: 'Размах сезонной волны', min: 0, max: 20, step: 1, value: s5.amp,
        fmt: (v) => f(v, 0) + ' п.',
        hint: 'При 0 сезонности нет; при 13–18 пунктах годовая волна сильнее дневного шума.',
        onInput: (v) => { s5.amp = v; draw(); }
      });
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost], draw);

      let cal, bPlain, bSeas;
      const c1 = A.mkChart(el.querySelector('#c1'), 190, {
        tip: (i) => '<b>День ' + (i + 1) + ' (' + cal.seriesNames[cal.seriesIdx[i] % 5] + ')</b><br>бесшовный: <b>' + f(cal.stitched[i]) + '</b><br>норма прошлых 3 лет: <b>' + f(cal.seasonalNorm[i]) + '</b><br>очищенный: <b>' + f(cal.stitched[i] - cal.seasonalNorm[i]) + '</b>'
      });
      const c2 = A.mkChart(el.querySelector('#c2'), 165, {
        tip: (i) => (bPlain.z[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>z без календаря: <b>' + f(bPlain.z[i]) + '</b><br>z с сезонной нормой: <b>' + f(bSeas.z[i]) + '</b>')
      });
      const c3 = A.mkChart(el.querySelector('#c3'), 175, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>ролл без сезонности: ' + f(bPlain.equity[i]) + ' п.<br>ролл + сезонная норма: ' + f(bSeas.equity[i]) + ' п.'
      });

      function draw() {
        modeEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b.dataset.ab === '1') === s5.abnormal));
        cal = E.genCalendar({ seed: A.state.seed, steps: [12, 14, 11, 13, 12], seasonAmp: s5.amp, abnormal: s5.abnormal });
        const base = A.btParams(), n = cal.raw.length;
        bPlain = E.backtestCalendar(cal, Object.assign({}, base, { expiryMode: 'roll', seasonal: false }));
        bSeas = E.backtestCalendar(cal, Object.assign({}, base, { expiryMode: 'roll', seasonal: true }));
        const adj = cal.stitched.map((v, i) => v - cal.seasonalNorm[i]);

        c1.render({
          n,
          series: [
            { data: cal.stitched, color: PRE, width: 1.9 },
            { data: cal.seasonalNorm, color: GOLD, width: 1.8, dash: [6, 4] },
            { data: adj, color: ME, width: 1.9 }
          ],
          hlines: [{ y: 0, color: '#ffffff33', dash: [] }]
        });

        const p = A.state.params, lim = Math.max(5.5, p.stopZ + 0.5);
        c2.render({
          n,
          series: [
            { data: bPlain.z, color: SIM, width: 1.5 },
            { data: bSeas.z, color: ME, width: 1.9 }
          ],
          hlines: A.zLines(p), yMin: -lim, yMax: lim
        });

        c3.render({
          n,
          series: [
            { data: bPlain.equity, color: SIM, width: 2 },
            { data: bSeas.equity, color: ME, width: 2.5 }
          ],
          hlines: [{ y: 0, color: '#ffffff44', dash: [] }]
        });

        const row = (name, c, m) => '<tr><td style="color:' + c + '"><b>' + name + '</b></td><td>' + m.count + '</td><td>' + (m.winRate === null ? '—' : Math.round(m.winRate * 100) + '%') + '</td><td>' + col(m.total) + '</td><td>' + f(-m.maxDD, 1) + '</td></tr>';
        el.querySelector('#tab').innerHTML =
          '<tr><th>Вариант</th><th>Сделок</th><th>Доля плюсовых</th><th>Итог, п.</th><th>Макс. просадка</th></tr>' +
          row('Ролл без учёта сезонности', SIM, bPlain.metrics) +
          row('Ролл + вычитание нормы прошлых 3 лет', ME, bSeas.metrics);

        const noteEl = el.querySelector('#note');
        if (s5.amp === 0) {
          noteEl.className = 'note';
          noteEl.innerHTML = 'При нулевой амплитуде сезонной волны нет — вычитание среднего за прошлые 3 года лишь добавляет немного прошлогоднего шума.';
        } else if (!s5.abnormal) {
          noteEl.className = 'note';
          noteEl.innerHTML = '<b>Обычный сезонный год:</b> оранжевая линия без календаря всё время спорит с волной и показывает ' + col(bPlain.metrics.total) + ' п., а сезонно очищенный вариант видит настоящие отклонения вокруг нормы и приносит ' + col(bSeas.metrics.total) + ' п.';
        } else {
          noteEl.className = 'note bad';
          noteEl.innerHTML = '<b>Аномальный год:</b> прошлые 3 года ждут подъёма спреда там, где погода в этом году устроила спад. Вычитание старой нормы раздувает ошибку до ' + col(bSeas.metrics.total) + ' п. против ' + col(bPlain.metrics.total) + ' п. без сезонной поправки.';
        }
      }
      draw();
    }
  });

  /* ---------- 6. Правила и сделки: закрывать до экспирации или роллировать ---------- */
  const s6 = { scn: 0, mode: 2, rollCost: 0.5, sel: 0 };
  const MODES6 = [
    { key: 'naive', name: 'Наивная (сырой ряд)', color: BAD, opts: { expiryMode: 'naive', seasonal: false } },
    { key: 'close', name: 'Выход до экспирации', color: PRE, opts: { expiryMode: 'close', seasonal: false } },
    { key: 'roll', name: 'Бесшовный ролл', color: ME, opts: { expiryMode: 'roll', seasonal: false } },
    { key: 'seas', name: 'Ролл + сезонность', color: GOLD, opts: { expiryMode: 'roll', seasonal: true } }
  ];

  Z.push({
    id: 'trades',
    title: 'Правила и сделки: закрывать до экспирации или роллировать',
    lead: 'Каждые 64 дня в нашей модели ближний фьючерс подходит к экспирации (остаётся 5 дней). Посмотрим на живых сделках, чем отличаются выход до экспирации, бесшовный перенос (ролл) и наивная торговля по сырому графику.',
    text: () => `
      <h3>Четыре способа обходиться со сменой серий</h3>
      <ol>
        <li><b style="color:${BAD}">Наивная по сырому графику (учебная ошибка).</b> Считаем z-score прямо по сырому ряду со ступеньками. На каждом стыке серий скачок в 12–16 пунктов кажется «гигантским отклонением» и открывает ложную сделку, хотя реальные цены контрактов с места не сдвинулись.</li>
        <li><b style="color:${PRE}">Выход перед экспирацией.</b> Сигнал считаем честно по ${T('stitching', 'бесшовной склейке')}, но если за 5 дней до ${T('expiry', 'экспирации')} позиция всё ещё открыта — принудительно закрываем её и ждём новой возможности уже в следующей серии. Никаких расходов на перенос, но часть хороших сделок обрывается на полпути!</li>
        <li><b style="color:${ME}">Бесшовный ролл.</b> Сигнал по бесшовной склейке; в день ухода открытую позицию ${T('rollover', 'роллируем')} в следующую пару контрактов (платим дополнительные издержки ролла) и доводим идею возврата до конца.</li>
        <li><b style="color:${GOLD}">Ролл + сезонность.</b> То же самое, но перед расчётом z-score из бесшовного спреда вычитается норма прошлых 3 лет.</li>
      </ol>
      <h3>Куда смотреть на графиках и в паспорте сделки</h3>
      <ul>
        <li>Жёлтые вертикальные полосы на верхнем графике — <b>дни ухода в новую серию</b> (дни 64, 128, 192 и 256, когда до экспирации остаётся 5 дней).</li>
        <li>Жёлтые колечки <b>○</b> показывают моменты, когда открытая позиция прошла через ролл и переехала в следующую пару контрактов.</li>
        <li>Ниже таблицы результатов нажмите на любую сделку — откроется <b>поконтрактная раскладка по коленам</b>, точно такая же, какую мы считали вручную на экране 4!</li>
      </ul>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Сценарий, режим показа сделок и стоимость ролла</h4>
          <div class="btns" id="tabs" style="margin:0 0 8px"></div>
          <p id="snote" style="margin:0 0 10px;color:#98a3b6"></p>
          <div class="btns" id="modes" style="margin:0 0 10px"></div>
          <div id="rctl"></div>
          <div id="ctl"></div>
        </div>
        <div class="viz">
          <h4 id="c1t">Рабочий ряд сигнала, среднее и сделки</h4>
          <div class="legend">
            <span><i class="dot" style="background:${C.up}"></i>▲ вход лонг</span>
            <span><i class="dot" style="background:${C.down}"></i>▼ вход шорт</span>
            <span><i class="dot" style="background:${C.exit}"></i>✕ выход</span>
            <span><i class="dot" style="background:${GOLD}"></i>○ перенос (ролл) в новую серию</span>
          </div>
          <div id="c1"></div>
        </div>
        <div class="viz">
          <h4>Z-score выбранного режима</h4>
          <div id="c2"></div>
        </div>
        <div class="viz">
          <h4>Сравнение накопленного результата всех четырёх режимов</h4>
          <div class="legend">
            <span><i style="background:${BAD}"></i>наивная (сырой ряд)</span>
            <span><i style="background:${PRE}"></i>выход до экспирации</span>
            <span><i style="background:${ME}"></i>бесшовный ролл</span>
            <span><i style="background:${GOLD}"></i>ролл + сезонность</span>
          </div>
          <div id="c3"></div>
          <table class="t" id="tab" style="margin-top:10px"></table>
        </div>
        <div class="viz">
          <h4>Журнал сделок выбранного режима (нажмите строку, чтобы увидеть расчёт по сериям)</h4>
          <div class="scroll" style="max-height:220px"><table class="t" id="tlist"></table></div>
          <div id="tbox" style="margin-top:12px"></div>
        </div>`;

      const tabs = el.querySelector('#tabs'), modesEl = el.querySelector('#modes');
      tabs.innerHTML = SC.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      modesEl.innerHTML = MODES6.map((m, i) => '<button class="b" data-i="' + i + '">Показать сделки: ' + m.name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.scn = +b.dataset.i; s6.sel = 0; draw(); } });
      modesEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s6.mode = +b.dataset.i; s6.sel = 0; draw(); } });

      HV.slider(el.querySelector('#rctl'), {
        label: 'Издержки одного переноса (ролла)', min: 0, max: 3, step: 0.25, value: s6.rollCost,
        fmt: (v) => f(v, 2) + ' п.',
        hint: 'Платятся только при переносе открытой позиции через экспирацию (4 заявки в стакане).',
        onInput: (v) => { s6.rollCost = v; draw(); }
      });
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost], draw);

      let cal, runs = [];
      const c1 = A.mkChart(el.querySelector('#c1'), 205, {
        tip: (i) => {
          const r = runs[s6.mode];
          return '<b>День ' + (i + 1) + ' (' + cal.seriesNames[cal.seriesIdx[i] % 5] + ', до эксп. ' + cal.daysToExp[i] + ' дн.)</b><br>рабочий ряд: <b>' + f(r.sigSeries[i]) + '</b>' +
            (r.mean[i] !== null ? '<br>среднее окна: ' + f(r.mean[i]) : '') +
            (cal.isRoll[i] ? '<br><span style="color:#ffd166">день ухода в серию «' + cal.seriesNames[(cal.seriesIdx[i] + 1) % 5] + '»</span>' : '');
        }
      });
      const c2 = A.mkChart(el.querySelector('#c2'), 160, {
        tip: (i) => {
          const r = runs[s6.mode];
          return r.z[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>z-score: <b>' + f(r.z[i]) + '</b>';
        }
      });
      const c3 = A.mkChart(el.querySelector('#c3'), 180, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>' + MODES6.map((m, k) => m.name + ': ' + f(runs[k].equity[i])).join('<br>')
      });

      function drawTradeDetail(r) {
        const box = el.querySelector('#tbox');
        if (!r.trades.length) {
          box.innerHTML = '<div class="note">В этом режиме при текущих настройках не открыто ни одной сделки.</div>';
          return;
        }
        if (s6.sel >= r.trades.length) s6.sel = 0;
        const tr = r.trades[s6.sel];
        const dirTxt = tr.dir === 1 ? 'Лонг спреда (+1: купили Дальний, продали Ближний)' : 'Шорт спреда (−1: продали Дальний, купили Ближний)';
        const legRows = tr.legs.map((lg, idx) => {
          const legPnl = tr.dir * (lg.rawOut - lg.rawIn);
          const sName = cal.seriesNames[lg.series % 5];
          return '<tr><td>Колено ' + (idx + 1) + ': серия <b>«' + sName + '»</b></td><td>день ' + (lg.inIdx + 1) + ' (' + f(lg.rawIn) + ')</td><td>день ' + (lg.outIdx + 1) + ' (' + f(lg.rawOut) + ')</td><td>' + col(legPnl, 2) + ' п.</td></tr>';
        }).join('');
        box.innerHTML =
          '<div class="note"><b>Паспорт сделки #' + (s6.sel + 1) + ':</b> ' + dirTxt + ', дни <b>' + (tr.entryIdx + 1) + '–' + (tr.exitIdx + 1) + '</b> (' + tr.bars + ' дн.), причина выхода — <b>' + (A.REASON[tr.reason] || tr.reason) + '</b>.<br>' +
          'Бесшовный спред: вход <b>' + f(tr.stitchedIn) + '</b> → выход <b>' + f(tr.stitchedOut) + '</b>, грязный итог по бесшовной формуле = ' + col(tr.gross, 2) + ' п. Проверим по реальным контрактам каждой серии:</div>' +
          '<table class="t" style="margin-top:8px"><tr><th>Серия контрактов</th><th>Вход в колено (сырой спред)</th><th>Выход из колена (сырой спред)</th><th>Результат колена</th></tr>' +
          legRows +
          '<tr><td colspan="3"><b>Сумма по реальным контрактам (грязный итог)</b></td><td><b>' + col(tr.gross, 2) + ' п.</b></td></tr>' +
          '<tr><td colspan="3">Издержки входа/выхода (' + f(r.params.cost, 2) + ' п.) + роллов (' + tr.rolls + ' × ' + f(s6.rollCost, 2) + ' п.)</td><td>−' + f(tr.cost, 2) + ' п.</td></tr>' +
          '<tr><td colspan="3"><b>Чистый итог сделки на счёте</b></td><td><b>' + col(tr.net, 2) + ' п.</b></td></tr></table>';
      }

      function draw() {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s6.scn));
        modesEl.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s6.mode));
        el.querySelector('#snote').textContent = SC[s6.scn].note;

        cal = E.genCalScenario(A.state.seed, SC[s6.scn]);
        const base = A.btParams(), n = cal.raw.length;
        runs = MODES6.map((m) => E.backtestCalendar(cal, Object.assign({}, base, m.opts, { rollCost: s6.rollCost })));

        const cur = runs[s6.mode], mInfo = MODES6[s6.mode];
        el.querySelector('#c1t').textContent = 'Рабочий ряд сигнала, среднее и сделки — «' + mInfo.name + '»';

        const mk = A.tradeMarkers(cur, (i) => cur.sigSeries[i]);
        cur.rolled.forEach((rl, i) => { if (rl) mk.push({ i, y: cur.sigSeries[i], kind: 'ring', color: GOLD, size: 6 }); });
        c1.render({
          n,
          series: [
            { data: cur.mean, color: C.mean, width: 1.4 },
            { data: cur.sigSeries, color: mInfo.color, width: 1.8 }
          ],
          spans: rollSpans(cal).concat(A.positionSpans(cur)),
          markers: mk
        });

        const p = A.state.params, lim = Math.max(6, p.stopZ + 0.5);
        const zmk = A.tradeMarkers(cur, (i) => cur.z[i]);
        cur.rolled.forEach((rl, i) => { if (rl && cur.z[i] !== null) zmk.push({ i, y: cur.z[i], kind: 'ring', color: GOLD, size: 5 }); });
        c2.render({
          n,
          series: [{ data: cur.z, color: C.z }],
          hlines: A.zLines(p),
          spans: A.positionSpans(cur),
          markers: zmk,
          yMin: -lim, yMax: lim
        });

        c3.render({
          n,
          series: MODES6.map((m, k) => ({ data: runs[k].equity, color: m.color, width: k === s6.mode ? 2.6 : 1.8, dash: k === 0 ? [5, 4] : [] })),
          hlines: [{ y: 0, color: '#ffffff44', dash: [] }]
        });

        el.querySelector('#tab').innerHTML =
          '<tr><th>Режим</th><th>Сделок</th><th>Роллов</th><th>Выходов по эксп.</th><th>Итог, п.</th><th>Макс. просадка</th></tr>' +
          MODES6.map((m, k) => {
            const r = runs[k], nRolls = r.trades.reduce((s, x) => s + x.rolls, 0);
            const nExp = r.trades.filter((x) => x.reason === 'expiry').length;
            const bold = k === s6.mode;
            return '<tr><td style="color:' + m.color + '">' + (bold ? '<b>' + m.name + '</b>' : m.name) + '</td><td>' + r.metrics.count + '</td><td>' + nRolls + '</td><td>' + nExp + '</td><td>' + col(r.metrics.total) + '</td><td>' + f(-r.metrics.maxDD, 1) + '</td></tr>';
          }).join('');

        const tl = el.querySelector('#tlist');
        tl.innerHTML = '<tr><th>#</th><th>Дни</th><th>Напр.</th><th>Серия входа → выхода</th><th>Роллов</th><th>Причина выхода</th><th>Чистый итог</th></tr>' +
          (cur.trades.map((tr, i) => '<tr class="click' + (i === s6.sel ? ' sel' : '') + '" data-i="' + i + '">' +
            '<td>' + (i + 1) + '</td><td>' + (tr.entryIdx + 1) + '–' + (tr.exitIdx + 1) + '</td>' +
            '<td>' + (tr.dir === 1 ? '<span class="pos">лонг</span>' : '<span class="neg">шорт</span>') + '</td>' +
            '<td>' + cal.seriesNames[tr.seriesIn % 5] + (tr.seriesOut !== tr.seriesIn ? ' → <b>' + cal.seriesNames[tr.seriesOut % 5] + '</b>' : '') + '</td>' +
            '<td>' + (tr.rolls ? '<b style="color:' + GOLD + '">' + tr.rolls + '</b>' : '0') + '</td>' +
            '<td>' + (A.REASON[tr.reason] || tr.reason) + '</td>' +
            '<td>' + col(tr.net, 2) + '</td></tr>').join('') || '<tr><td colspan="7" style="color:#8b95a7">Нет сделок</td></tr>');

        tl.querySelectorAll('tr.click').forEach((trEl) => trEl.addEventListener('click', () => {
          s6.sel = +trEl.dataset.i;
          tl.querySelectorAll('tr.click').forEach((x, k) => x.classList.toggle('sel', k === s6.sel));
          drawTradeDetail(cur);
        }));
        drawTradeDetail(cur);
      }
      draw();
    }
  });

  /* ---------- 7. Пошаговый разбор одного дня ---------- */
  const s7 = { scn: 0, mode: 2, rollCost: 0.5, day: null };

  Z.push({
    id: 'day',
    title: 'Пошаговый разбор одного дня',
    lead: 'Выберите любой день (особенно интересно заглянуть в день ролла за 5 дней до экспирации!) и проследите каждую цифру: от цен ближнего и дальнего фьючерсов до склейки, сезонности, окна N и торгового решения.',
    full: true,
    mount(el) {
      el.innerHTML = `
        <div style="display:grid;grid-template-columns:560px 1fr;gap:28px;align-items:start">
          <div>
            <div class="viz">
              <h4>Сценарий и режим расчёта</h4>
              <div class="btns" id="tabs" style="margin:0 0 8px"></div>
              <p id="snote" style="margin:0 0 10px;color:#98a3b6"></p>
              <div class="btns" id="modes" style="margin:0"></div>
            </div>
            <div class="viz">
              <h4>Выбор дня: <span id="dayv"></span></h4>
              <input type="range" id="day" style="margin-top:8px">
              <div class="btns">
                <button class="b" id="bp">◀ День назад</button>
                <button class="b" id="bn">День вперёд ▶</button>
                <button class="b" id="br">К следующему роллу ◆</button>
                <button class="b" id="bs">К следующей сделке</button>
                <button class="b" id="play">▶ Автопроигрывание</button>
              </div>
              <div id="c1" style="margin-top:10px"></div>
              <div id="c2" style="margin-top:10px"></div>
            </div>
            <div id="ctl"></div>
          </div>
          <div>
            <div class="viz"><div class="calc-steps" id="steps"></div></div>
            <details style="margin-top:14px"><summary>Показать все N дней расчётного окна</summary>
              <div class="scroll" style="margin-top:8px"><table class="t" id="wtab"></table></div>
            </details>
          </div>
        </div>`;

      const tabs = el.querySelector('#tabs'), modesEl = el.querySelector('#modes'), slider = el.querySelector('#day');
      tabs.innerHTML = SC.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      modesEl.innerHTML = MODES6.map((m, i) => '<button class="b" data-i="' + i + '">' + m.name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s7.scn = +b.dataset.i; draw(); } });
      modesEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s7.mode = +b.dataset.i; draw(); } });

      let cal, bt;
      const c1 = A.mkChart(el.querySelector('#c1'), 175, { onClick: (i) => setDay(i), tip: (i) => 'День ' + (i + 1) + ' (' + cal.seriesNames[cal.seriesIdx[i] % 5] + '): ' + f(bt.sigSeries[i]) });
      const c2 = A.mkChart(el.querySelector('#c2'), 145, { onClick: (i) => setDay(i), tip: (i) => (bt.z[i] === null ? null : 'День ' + (i + 1) + ': z = ' + f(bt.z[i])) });
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn], draw);

      function setDay(i) {
        const min = A.state.params.n - 1;
        s7.day = Math.max(min, Math.min(cal.raw.length - 1, i));
        draw();
      }
      slider.addEventListener('input', () => setDay(+slider.value));
      el.querySelector('#bp').addEventListener('click', () => setDay(s7.day - 1));
      el.querySelector('#bn').addEventListener('click', () => setDay(s7.day + 1));
      el.querySelector('#br').addEventListener('click', () => {
        for (let i = s7.day + 1; i < cal.raw.length; i++) if (cal.isRoll[i]) return setDay(i);
        for (let i = A.state.params.n - 1; i <= s7.day; i++) if (cal.isRoll[i]) return setDay(i);
      });
      el.querySelector('#bs').addEventListener('click', () => {
        for (let i = s7.day + 1; i < cal.raw.length; i++) if (bt.signal[i]) return setDay(i);
        for (let i = A.state.params.n - 1; i <= s7.day; i++) if (bt.signal[i]) return setDay(i);
      });
      el.querySelector('#play').addEventListener('click', (ev) => {
        if (window.__stepTimer) { clearInterval(window.__stepTimer); window.__stepTimer = null; ev.target.textContent = '▶ Автопроигрывание'; return; }
        ev.target.textContent = '❚❚ Пауза';
        window.__stepTimer = setInterval(() => {
          if (s7.day >= cal.raw.length - 1) { clearInterval(window.__stepTimer); window.__stepTimer = null; ev.target.textContent = '▶ Автопроигрывание'; return; }
          s7.day++; draw();
        }, 350);
      });

      function draw() {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s7.scn));
        modesEl.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s7.mode));
        el.querySelector('#snote').textContent = SC[s7.scn].note;

        const p = A.state.params, mInfo = MODES6[s7.mode];
        cal = E.genCalScenario(A.state.seed, SC[s7.scn]);
        bt = E.backtestCalendar(cal, Object.assign(A.btParams(), mInfo.opts, { rollCost: s7.rollCost }));

        slider.min = p.n - 1; slider.max = cal.raw.length - 1;
        if (s7.day === null || s7.day < p.n - 1 || s7.day >= cal.raw.length) {
          s7.day = 63 >= p.n - 1 ? 63 : p.n + 10;
        }
        slider.value = s7.day;
        const t = s7.day;
        const ex = E.explainCalendar(cal, p.n, t, mInfo.opts);
        el.querySelector('#dayv').textContent = 'день ' + (t + 1) + ' из ' + cal.raw.length + ' (' + ex.seriesName + ', до эксп. ' + ex.daysToExp + ' дн.)';

        const w0 = t - p.n + 1;
        const mk = A.tradeMarkers(bt, (i) => bt.sigSeries[i]);
        bt.rolled.forEach((rl, i) => { if (rl) mk.push({ i, y: bt.sigSeries[i], kind: 'ring', color: GOLD, size: 6 }); });
        c1.render({
          n: cal.raw.length,
          series: [{ data: bt.mean, color: C.mean, width: 1.3 }, { data: bt.sigSeries, color: mInfo.color }],
          spans: rollSpans(cal).concat([{ i0: w0, i1: t, color: '#5aa9ff22' }]),
          markers: mk, cursor: t
        });
        const lim = Math.max(5.5, p.stopZ + 0.5);
        c2.render({
          n: cal.raw.length,
          series: [{ data: bt.z, color: C.z }],
          hlines: A.zLines(p), spans: [{ i0: w0, i1: t, color: '#5aa9ff22' }],
          cursor: t, yMin: -lim, yMax: lim
        });

        const rollLine = ex.isRoll
          ? '<br><span style="color:#ffd166"><b>Сегодня день ухода из серии!</b> До экспирации осталось 5 дней. Котировка следующей пары «' + cal.seriesNames[(ex.seriesIdx + 1) % 5] + '» сейчас равна <b>' + f(ex.nextRaw) + '</b> (ступенька склейки = ' + f(ex.nextRaw) + ' − ' + f(ex.raw) + ' = <b>' + U.sgn(ex.rollGap, 2) + '</b> п.; она добавится к сдвигу с завтрашнего дня).</span>'
          : '';

        let step2Html;
        if (mInfo.opts.expiryMode === 'naive') {
          step2Html = 'В наивном режиме склейка выключена — в расчёт z-score идёт сырой спред со всеми прошлыми ступеньками: <b>' + f(ex.value) + '</b> п.';
        } else if (!mInfo.opts.seasonal) {
          step2Html = 'Накопленная сумма прошлых ступенек до сегодняшнего дня = <b>' + U.sgn(ex.cumShift, 2) + '</b> п.<br>' +
            'Бесшовный спред = ' + f(ex.raw) + ' − (' + f(ex.cumShift) + ') = <b>' + f(ex.stitched) + '</b> п.';
        } else {
          step2Html = 'Бесшовный спред = ' + f(ex.raw) + ' − (' + f(ex.cumShift) + ') = <b>' + f(ex.stitched) + '</b> п.<br>' +
            'Вычитаем норму прошлых 3 лет для дня ' + (t + 1) + ' (' + f(ex.seasonalNorm) + ' п.): ' +
            f(ex.stitched) + ' − (' + f(ex.seasonalNorm) + ') = <b>' + f(ex.value) + '</b> п.';
        }

        const prevPos = t > 0 ? bt.pos[t - 1] : 0;
        const posName = prevPos === 1 ? 'открыт лонг спреда (+1)' : prevPos === -1 ? 'открыт шорт спреда (−1)' : 'позиции нет (0)';
        let decText, decCls = 'decision';
        if (mInfo.opts.expiryMode === 'close' && ex.isRoll) {
          if (prevPos !== 0) {
            decText = '<p>До экспирации осталось 5 дней: режим «Выход до экспирации» <b>принудительно закрывает</b> открытую позицию в серии «' + ex.seriesName + '», не дожидаясь цели по z.</p>';
            decCls = 'decision close';
          } else {
            decText = '<p>Сегодня день смены серии (до экспирации 5 дней): позиция была пуста, новые входы в уходящей серии не открываем.</p>';
          }
        } else {
          const dec = A.decisionText(t, bt, bt.params);
          decText = dec.html;
          decCls = 'decision' + (dec.cls ? ' ' + dec.cls : (bt.rolled[t] ? ' open' : ''));
          if (bt.rolled[t]) {
            decText += '<p><b>Ролл позиции:</b> сегодня день ухода из серии — открытая позиция переносится из «' + ex.seriesName + '» в «' + cal.seriesNames[(ex.seriesIdx + 1) % 5] + '» (закрываем старую пару по ' + f(ex.raw) + ', открываем новую по ' + f(ex.nextRaw) + ', платим ' + f(s7.rollCost, 2) + ' п. издержек ролла).</p>';
          }
        }

        el.querySelector('#steps').innerHTML = `
          <div class="row"><div class="n">1</div><div>
            <b>Контрактная серия и сырой спред дня ${t + 1}</b>
            <div style="color:#98a3b6;font-size:14px">Активная пара: <b>«${ex.seriesName}»</b>, до экспирации ближнего фьючерса <b>${ex.daysToExp} дн.</b> (${ex.raw >= 0 ? 'контанго' : 'бэквордация'}).${rollLine}</div>
            <div class="v">Ближний = ${f(ex.near)}, Дальний = ${f(ex.far)} → сырой спред = <b>${f(ex.raw)}</b> п.</div>
          </div></div>
          <div class="row"><div class="n">2</div><div>
            <b>Склейка серий и сезонная поправка (режим «${mInfo.name}»)</b>
            <div style="color:#98a3b6;font-size:14px">${step2Html}</div>
            <div class="v">Рабочее число для окна = <b>${f(ex.value)}</b> п.</div>
          </div></div>
          <div class="row"><div class="n">3</div><div>
            <b>Среднее и разброс σ за последние N = ${p.n} дней (дни ${w0 + 1}–${t + 1})</b>
            <div class="v">Среднее = ${f(ex.sum)} ÷ ${p.n} = <b>${f(ex.mean)}</b>, &nbsp; σ = √(${f(ex.sumSq)} ÷ ${p.n}) = <b>${f(ex.std)}</b></div>
          </div></div>
          <div class="row"><div class="n">4</div><div>
            <b>Отклонение в сигмах (z-score)</b>
            <div class="v">z = (${f(ex.value)} − ${f(ex.mean)}) ÷ ${f(ex.std)} = <b>${f(ex.z)}</b></div>
          </div></div>
          <div class="row"><div class="n">5</div><div>
            <b>Решение и работа с экспирацией (до этого дня: ${posName})</b>
            <div class="${decCls}">${decText}</div>
          </div></div>`;

        el.querySelector('#wtab').innerHTML =
          '<tr><th>День</th><th>Серия</th><th>Сырой</th><th>Сдвиг склейки</th><th>Рабочее число</th><th>Отклонение</th><th>Квадрат</th></tr>' +
          ex.rows.map((r) => '<tr' + (r.idx === t ? ' style="font-weight:700;color:#fff"' : '') + '><td>' + (r.idx + 1) + (cal.isRoll[r.idx] ? ' ◆' : '') + '</td><td>' + cal.seriesNames[cal.seriesIdx[r.idx] % 5] + '</td><td>' + f(cal.raw[r.idx]) + '</td><td>' + U.sgn(cal.cumShifts[r.idx], 2) + '</td><td>' + f(r.value) + '</td><td>' + U.sgn(r.dev) + '</td><td>' + f(r.sq) + '</td></tr>').join('');
      }
      draw();
    }
  });

  /* ---------- 8. Когда помогает, когда вредит и главные риски ---------- */
  const s8 = { scn: 0, rollCost: 0.5, disc: 5, shock: 40 };

  Z.push({
    id: 'verdict',
    title: 'Когда помогает, когда вредит и главные риски',
    lead: 'Сведём все четыре режима на 11 независимых наборах данных в каждом из четырёх сценариев, а затем разберём главную ловушку календарных спредов на реальных биржах — скрытое плечо из-за скидки на гарантийное обеспечение и катастрофу фонда Amaranth.',
    full: true,
    mount(el) {
      el.innerHTML = `
        <h3 style="margin:0 0 10px">1. Честный эксперимент: 4 сценария × 11 наборов данных × 4 режима</h3>
        <p style="max-width:940px">Настройки входа, выхода и стопа одинаковы для всех четырёх столбцов. Переключайте вкладки сценариев и двигайте ползунок стоимости ролла: видно, когда бесшовный перенос обгоняет выход до экспирации, когда спасает только сезонная норма, а где ломаются все подходы.</p>
        <div class="btns" id="tabs"></div>
        <p id="snote" style="margin:0 0 10px;color:#98a3b6"></p>
        <div id="rctl"></div>
        <div id="ctl"></div>
        <div class="viz" style="margin-top:14px">
          <div class="scroll" style="max-height:420px"><table class="t" id="tab"></table></div>
          <div class="note" id="sum"></div>
        </div>

        <h3 style="margin:30px 0 10px">2. Скрытое плечо, скидка на ${T('margin', 'ГО')} и урок фонда Amaranth (2006)</h3>
        <div class="cols"><div class="text">
          <p>Почему именно на «спокойных» календарных спредах случались одни из самых громких разорений в истории бирж?</p>
          <ul>
            <li><b>Ловушка скидки на залог.</b> Одиночный фьючерс на газ или нефть требует, скажем, 20% ${T('margin', 'гарантийного обеспечения (ГО)')}. Но когда вы одновременно покупаете один срок и продаёте другой на тот же товар, биржа видит календарный спред и снижает залог в <b>4–6 раз</b>! Неопытный участник на весь освободившийся капитал набирает в 5 раз больше контрактов — не замечая, что включил огромное скрытое плечо.</li>
            <li><b>Катастрофа Amaranth Advisors (сентябрь 2006).</b> Американский хедж-фонд с капиталом около 9 млрд долларов поставил гигантские объёмы на календарные спреды природного газа (между зимними и весенними фьючерсами, опираясь на прошлую ${T('seasonality', 'сезонность')}). Погода и запасы в хранилищах пошли не по шаблону, спред сжался против фонда, а попытка срочно закрыть огромную позицию в неликвидных дальних месяцах обрушила цены ещё сильнее. За две недели фонд потерял <b>свыше 6 млрд долларов</b> и закрылся.</li>
            <li><b>Риск ${T('physical_delivery', 'физической поставки')} в последние дни.</b> У поставочных фьючерсов на сырьё забытая до последнего дня позиция может превратиться в реальное обязательство принять или отгрузить цистерны нефти, зерно или газ — а брокер закроет вас принудительно по любой цене пустого стакана. Поэтому ролл делают заранее (за 5–10 дней, ориентируясь на переток объёма торгов).</li>
          </ul>
        </div><div>
          <div class="viz">
            <h4>Калькулятор ловушки «пониженного ГО» (счёт = 100 000 ₽, цена контракта = 1 000 п., 1 п. = 100 ₽)</h4>
            <div id="mctl"></div>
            <table class="t" id="mtab" style="margin-top:10px"></table>
            <div class="note bad" id="mread"></div>
          </div>
        </div></div>

        <h3 style="margin:30px 0 14px">3. Итоги простыми словами</h3>
        <div class="cards" id="cards"></div>

        <div class="viz" style="margin-top:22px">
          <h4>Чек-лист: пять вопросов перед торговлей календарного спреда</h4>
          <ol style="margin:8px 0 0;padding-left:22px;max-width:980px">
            <li><b>Как склеена история для расчёта z-score?</b> Считать индикатор по сырому ряду со ступеньками нельзя: нужна честная ${T('stitching', 'бесшовная склейка')} по разнице старой и новой серии в день ролла.</li>
            <li><b>Поставочный или расчётный ближний фьючерс и за сколько дней вы уходите?</b> У поставочного товара ликвидность уходит в следующий контракт заранее — дату ухода привязывают к падению объёма торгов, никогда не дожидаясь последних дней ${T('expiry', 'экспирации')}.</li>
            <li><b>Выгодно ли роллировать открытую сделку?</b> Сравните средний остаток прибыли до цели с двойной стоимостью ${T('rollover', 'ролла')} (комиссии + проскальзывание в двух стаканах). Если ролл дорогой, проще закрывать позицию до экспирации.</li>
            <li><b>Есть ли у актива сезонность — и что, если год аномальный?</b> Для газа, зерна или сахара вычитание многолетней нормы обязательно, но на случай аномальной погоды или неурожая жёсткий ${T('stop', 'стоп-лосс')} должен ограничивать убыток.</li>
            <li><b>Посчитан ли риск на один спред от полного стресс-движения, а не от биржевого ГО?</b> Скидка биржи на залог по спреду — это удобство учёта, а не приглашение набрать в 5 раз больше лотов перед взрывом ${T('backwardation', 'бэквордации')}.</li>
          </ol>
        </div>`;

      const tabs = el.querySelector('#tabs');
      tabs.innerHTML = SC.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s8.scn = +b.dataset.i; drawTable(); } });

      HV.slider(el.querySelector('#rctl'), {
        label: 'Издержки одного переноса (ролла)', min: 0, max: 3, step: 0.25, value: s8.rollCost,
        fmt: (v) => f(v, 2) + ' п.',
        hint: 'Увеличение стоимости ролла бьёт по режимам с переносом, но не трогает «Выход до экспирации».',
        onInput: (v) => { s8.rollCost = v; drawTable(); }
      });
      A.controls(el.querySelector('#ctl'), [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost], drawTable);

      function drawTable() {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s8.scn));
        const sc = SC[s8.scn], base = A.btParams();
        el.querySelector('#snote').textContent = sc.note;

        const tot = [0, 0, 0, 0], dd = [0, 0, 0, 0], cn = [0, 0, 0, 0];
        const rows = SEEDS.map((sd) => {
          const cal = E.genCalScenario(sd, sc);
          const ms = MODES6.map((m) => E.backtestCalendar(cal, Object.assign({}, base, m.opts, { rollCost: s8.rollCost })).metrics);
          ms.forEach((m, k) => { tot[k] += m.total; dd[k] += m.maxDD; cn[k] += m.count; });
          return '<tr><td>Набор ' + sd + '</td>' + ms.map((m) => '<td>' + m.count + '</td><td>' + col(m.total, 0) + '</td><td>' + f(-m.maxDD, 0) + '</td>').join('') + '</tr>';
        });

        el.querySelector('#tab').innerHTML =
          '<tr><th rowspan="2"></th>' + MODES6.map((m) => '<th colspan="3" style="text-align:center;color:' + m.color + '">' + m.name + '</th>').join('') + '</tr>' +
          '<tr>' + MODES6.map(() => '<th>сделок</th><th>итог</th><th>просадка</th>').join('') + '</tr>' +
          rows.join('') +
          '<tr><td><b>Сумма</b></td>' + MODES6.map((_, k) => '<td><b>' + cn[k] + '</b></td><td><b>' + col(tot[k], 0) + '</b></td><td><b>' + f(-dd[k], 0) + '</b></td>').join('') + '</tr>';

        el.querySelector('#sum').innerHTML =
          'Сценарий «<b>' + sc.name + '</b>» по ' + SEEDS.length + ' наборам данных. Суммарный итог: ' +
          MODES6.map((m, k) => '<span style="color:' + m.color + '">' + m.name + '</span> ' + col(tot[k], 0)).join(' · ') +
          ' п. Сумма макс. просадок: ' + MODES6.map((_, k) => '<b>' + f(-dd[k], 0) + '</b>').join(' / ') + ' п.';
      }

      const mctl = el.querySelector('#mctl');
      HV.slider(mctl, {
        label: 'Во сколько раз биржа снизила ГО для спреда', min: 1, max: 8, step: 1, value: s8.disc,
        fmt: (v) => 'в ' + f(v, 0) + ' раз(а)',
        hint: 'Одиночный контракт требует 20 000 ₽ залога; при скидке в 5 раз спред требует всего 4 000 ₽.',
        onInput: (v) => { s8.disc = v; drawMargin(); }
      });
      HV.slider(mctl, {
        label: 'Стресс-движение спреда против позиции (дефицит / погода)', min: 10, max: 60, step: 5, value: s8.shock,
        fmt: (v) => f(v, 0) + ' п.',
        hint: '1 пункт = 100 ₽ на один спред.',
        onInput: (v) => { s8.shock = v; drawMargin(); }
      });

      function drawMargin() {
        const cap = 100000, baseMargin = 20000;
        const spreadMargin = Math.round(baseMargin / s8.disc);
        const lotsSafe = Math.floor(cap / baseMargin);
        const lotsMax = Math.floor(cap / spreadMargin);
        const lossPerSpread = s8.shock * 100;
        const lossSafe = lotsSafe * lossPerSpread;
        const lossMax = lotsMax * lossPerSpread;
        const pctSafe = (lossSafe / cap) * 100;
        const pctMax = (lossMax / cap) * 100;

        el.querySelector('#mtab').innerHTML =
          '<tr><th>Подход к размеру позиции</th><th>Залог на 1 спред</th><th>Куплено спредов</th><th>Убыток при скачке ' + s8.shock + ' п.</th><th>Доля от счёта</th></tr>' +
          '<tr><td>Осторожный (как без скидки)</td><td>20 000 ₽</td><td><b>' + lotsSafe + '</b></td><td>−' + U.fmt(lossSafe, 0) + ' ₽</td><td>−' + f(pctSafe, 0) + '%</td></tr>' +
          '<tr><td style="color:' + BAD + '"><b>«На все плечи» со скидкой ГО</b></td><td>' + U.fmt(spreadMargin, 0) + ' ₽</td><td><b>' + lotsMax + '</b></td><td class="neg"><b>−' + U.fmt(lossMax, 0) + ' ₽</b></td><td class="neg"><b>−' + f(pctMax, 0) + '%</b></td></tr>';

        el.querySelector('#mread').innerHTML =
          'При скидке на ГО в <b>' + s8.disc + ' раз(а)</b> на 100 000 ₽ можно открыть <b>' + lotsMax + '</b> спредов вместо <b>' + lotsSafe + '</b>. Стоит дефициту на складах сдвинуть спред на <b>' + s8.shock + ' п.</b> (всего ' + f(s8.shock / 10, 1) + '% от цены актива 1 000 п.!), и позиция «на всё пониженное ГО» теряет <b>' + f(pctMax, 0) + '% счёта</b>' +
          (pctMax >= 100 ? ' — это полное обнуление и ' + T('margin_call', 'маржин-колл') + '!' : '.');
      }

      const cards = [
        ['Понятная экономика вместо угадывания', 'Разница цен дальнего и ближнего фьючерса опирается на ставку, стоимость хранения и дивиденды или выгоду наличного запаса — у этого спреда есть ясный фундамент.'],
        ['Несимметричный потолок и пол', 'Контанго на товарах ограничено сверху арбитражем «купи спот и храни», а бэквордация при пустых складах не имеет потолка — продажа ближнего фьючерса несёт взрывной риск.'],
        ['Сырой график на стыках врёт', 'Без бесшовной склейки смена серии выглядит как ложный скачок цены и заставляет z-score открывать сделки в пустоту, теряя сотни пунктов.'],
        ['Ролл продлевает сделку за плату', 'Бесшовный перенос позволяет не бросать незавершённую сделку за 5 дней до экспирации, но требует заплатить за закрытие старой и открытие новой пары.'],
        ['Сезонность обязательна для сырья и опасна в аномалию', 'В обычный год вычитание многолетней нормы превращает убыточную борьбу с зимой/летом в устойчивый плюс, но в аномальный по погоде год даёт обратный эффект.'],
        ['Скидка на ГО — главная ловушка плеча', 'Пониженный залог биржи создаёт иллюзию безопасности: перегруз лотами превращает умеренный 3–4% скачок спреда в потерю всего депозита, как у фонда Amaranth.']
      ];
      el.querySelector('#cards').innerHTML = cards.map((c) => '<div class="card"><h4>' + c[0] + '</h4><p>' + c[1] + '</p></div>').join('');

      drawTable();
      drawMargin();
    }
  });
})();
