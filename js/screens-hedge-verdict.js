/* Динамический хедж, экран 8: когда помогает и когда вредит; риски нестабильного k (#25). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, S = window.SPECS, HV = window.HV;
  const Z = (window.HSCREENS = window.HSCREENS || []);
  const SC = E.HEDGE_SCENARIOS;
  const SIM = '#f5a65b', ME = '#7ee0b5', RD = '#5aa9ff', GREY = '#8b95a7';
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 11, 13, 21, 42];
  const NS = [10, 15, 20, 30, 45, 60, 90, 120];
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 1 : d) + '</span>';
  const s8 = { scn: 1, lots: 2, kscn: 2, kseed: 0 };

  /* Средняя ошибка k (|k − β|) по всем наборам для каждого N. Считается один раз: от настроек не зависит. */
  let errCache = null;
  function kErrors() {
    if (errCache) return errCache;
    errCache = SC.slice(1, 3).map((sc) => NS.map((n) => {
      let err = 0, c = 0;
      SEEDS.forEach((seed) => {
        const d = E.genHedge(seed, sc), h = E.hedgeStats(d.a, d.b, n);
        for (let t = 120; t < d.a.length; t++) if (h.k[t] !== null) { err += Math.abs(h.k[t] - d.beta[t]); c++; }
      });
      return err / c;
    }));
    return errCache;
  }

  Z.push({
    id: 'verdict',
    title: 'Когда помогает и когда вредит',
    lead: 'Хедж с коэффициентом k не бесплатен: мы каждый день оцениваем k по шумным данным и можем ошибиться. Проверим на эксперименте, где эта плата окупается, где нет, и от чего зависит, насколько k «шатается».',
    full: true,
    mount(el) {
      el.innerHTML = `
        <div class="note warn"><b>Как читать.</b> Данные синтетические: мы сами задали, как A связана с B, поэтому знаем «правильный ответ» (настоящее β) и можем проверить, насколько программа к нему приблизилась. В реальности β никто не знает. Эксперимент показывает механику, а не обещает прибыль.</div>

        <h3 style="margin:28px 0 10px">1. Эксперимент: четыре сценария, 11 наборов данных, три способа</h3>
        <p style="max-width:1000px">Для каждого сценария генерируем 11 разных наборов цен (разные «случайные истории» с одними и теми же правилами) и торгуем каждый тремя способами: <b style="color:${SIM}">простой спред A − B</b> (k = 1 всегда), <b style="color:${ME}">хедж с дробным k</b> (как будто можно купить 1,43 контракта) и <b style="color:${RD}">хедж в целых контрактах</b> (число контрактов A задаётся ползунком). Правила входа и выхода одинаковые. Сравниваем три вещи: сколько было сделок, итог в пунктах и ${T('drawdown', 'максимальную просадку')} — самое глубокое падение счёта от предыдущего максимума.</p>
        <div class="viz"><div class="btns" id="tabs" style="margin:0 0 12px"></div><p id="snote" style="margin:0 0 10px;color:var(--muted)"></p><div id="ctl"></div><div id="sum" class="note" style="margin-top:10px"></div><div class="scroll" style="max-height:none;margin-top:12px"><table class="t" id="tab"></table></div></div>

        <h3 style="margin:30px 0 10px">2. Почему при β = 1 хедж проигрывает</h3>
        <div class="cols"><div class="text">
          <p>В первом сценарии правильный ответ k = 1 известен заранее, и простой спред A − B уже идеален. Хедж же <i>каждый день заново угадывает</i> k по последним N дням. Из-за случайного шума угаданное значение получается то 0,9, то 1,1, и спред A − k·B получает лишнее «дрожание», которого у A − B нет.</p>
          <p>Это дрожание порождает ложные сигналы: z выходит за порог не потому, что спред действительно необычный, а потому, что k сегодня немного другой, чем вчера. Поэтому сделок у хеджа больше, а каждая сделка стоит ${T('cost', 'издержек')}.</p>
          <div class="note"><b>Общий принцип.</b> Если что-то можно знать точно, не надо это оценивать: любая оценка добавляет шум. Регрессия полезна, когда связь неизвестна или меняется, а не «на всякий случай».</div>
        </div><div>
          <div class="viz"><h4>Ошибка k по дням: насколько k отличается от настоящего β</h4><p class="cap">Выбранный набор данных, окно N из настроек выше. Серый пунктир — настоящее β, зелёная линия — k из регрессии, светлые пунктиры — коридор «k ± 2 стандартные ошибки».</p>
            <div class="btns" id="ktabs" style="margin:0 0 8px"></div><div class="btns" id="kseeds" style="margin:0 0 8px"></div><div id="kc"></div><p id="knote" class="cap" style="margin-top:8px"></p></div>
        </div></div>

        <h3 style="margin:30px 0 10px">3. Шум против запаздывания: какое окно N выбрать</h3>
        <div class="cols"><div class="text">
          <p>У окна N два противоположных недостатка:</p>
          <ul>
            <li><b>Короткое окно — много шума.</b> Регрессия по 10 точкам легко обманывается случайными колебаниями: k сегодня 1,3, завтра 1,8. Это видно по ширине коридора ${T('stderr', 'стандартной ошибки')} на графике выше.</li>
            <li><b>Длинное окно — запаздывание.</b> Регрессия по 120 дням спокойная, но в ней ещё сидят дни, когда связь была другой. Если β растёт, k «тянется» за ним с опозданием, как средняя температура за год плохо описывает сегодняшнюю погоду.</li>
          </ul>
          <p>График справа: средняя по 11 наборам ошибка |k − β| при разных N. Вертикальные палочки |…| означают модуль: берём величину ошибки без знака, чтобы ошибки «вверх» и «вниз» не гасили друг друга при усреднении.</p>
          <ul>
            <li><b style="color:${ME}">Когда связь постоянна</b> (β = 1,6 всё время), ошибка только падает с ростом N: запаздывать не за чем, а больше точек — меньше шума.</li>
            <li><b style="color:${SIM}">Когда связь меняется</b> (β растёт с 1,0 до 1,8), у ошибки есть минимум: слишком короткое окно шумит, слишком длинное опаздывает. Лучшее N находится где-то посередине.</li>
          </ul>
          <div class="note warn"><b>Ловушка.</b> Лучшее N мы нашли здесь потому, что знаем настоящее β. В реальности его нет, и N подбирают по прошлым результатам торговли. Это прямой путь к ${T('overfit', 'подгонке под прошлое')}: окно, идеальное на истории, на будущем может оказаться плохим.</div>
        </div><div>
          <div class="viz"><h4>Средняя ошибка k при разных N</h4><div class="legend"><span><i style="background:${ME}"></i>связь постоянна (β = 1,6)</span><span><i style="background:${SIM}"></i>связь меняется (β от 1,0 до 1,8)</span></div><div id="ec"></div><div id="et" style="margin-top:10px"></div></div>
        </div></div>

        <h3 style="margin:30px 0 14px">4. Итоги и все риски динамического k</h3>
        <div class="cards" id="cards"></div>

        <div class="viz" style="margin-top:22px">
          <h4>Чек-лист: пять вопросов перед использованием динамического хеджа</h4>
          <ol style="margin:8px 0 0;padding-left:22px;max-width:980px">
            <li><b>Нужен ли вообще k ≠ 1?</b> Если два инструмента одной природы и двигаются почти один к одному, простой спред A − B точнее и дешевле: лишняя оценка k только добавит шум и ложные входы.</li>
            <li><b>Достаточно ли двигался B внутри окна?</b> В формуле k мы делим на разброс B: Σ(B − B̄)². Если B стоял в узком коридоре («боковике»), деление идёт почти на ноль — k и его ${T('stderr', 'стандартная ошибка')} взлетают. При широкой ошибке новому k доверять нельзя.</li>
            <li><b>Хватает ли размера счёта на целые контракты?</b> При 1 контракте A коэффициент 1,4 превращается в 1 или 2 — рыночный риск возвращается. Точное отношение 5 к 7 требует в 6 раз больше ${T('margin', 'гарантийного обеспечения')} и комиссий.</li>
            <li><b>Устойчива ли сама связь, а не только наклон?</b> Высокий ${T('r2', 'R²')} на 30 днях бывает и у двух совершенно чужих рядов, случайно шедших в одну сторону. Сначала проверяют экономический смысл и стационарность остатков (следующий раздел — «Коинтеграция»).</li>
            <li><b>Что делать, если связь порвётся во время сделки?</b> Внутри открытой позиции k ${T('frozen_k', 'заморожен')}, и регрессия не спасёт от разъезда ног — нужен заранее заданный ${T('stop', 'стоп-лосс')} или лимит времени.</li>
          </ol>
        </div>`;

      /* ---------- 1. эксперимент ---------- */
      const tabs = el.querySelector('#tabs');
      tabs.innerHTML = SC.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      tabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s8.scn = +b.dataset.i; draw(); } });
      const MODES = [['s', 'Простой A − B', SIM], ['h', 'Хедж, дробный k', ME], ['r', 'Хедж, целые контракты', RD]];
      function run(d) {
        const p = A.btParams();
        return {
          s: E.backtest(d.a.map((v, i) => v - d.b[i]), p).metrics,
          h: E.backtestHedge(d.a, d.b, Object.assign({}, p, { lots: 0 })).metrics,
          r: E.backtestHedge(d.a, d.b, Object.assign({}, p, { lots: s8.lots })).metrics
        };
      }
      function drawTable() {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s8.scn));
        const sc = SC[s8.scn];
        el.querySelector('#snote').textContent = sc.note;
        const tot = { s: 0, h: 0, r: 0 }, dd = { s: 0, h: 0, r: 0 }, cn = { s: 0, h: 0, r: 0 };
        let winsH = 0;
        const rows = SEEDS.map((seed) => {
          const m = run(E.genHedge(seed, sc));
          MODES.forEach(([k]) => { tot[k] += m[k].total; dd[k] += m[k].maxDD; cn[k] += m[k].count; });
          if (m.h.total > m.s.total) winsH++;
          return '<tr><td>Набор ' + seed + '</td>' + MODES.map(([k]) => '<td>' + m[k].count + '</td><td>' + col(m[k].total) + '</td><td>' + f(-m[k].maxDD, 1) + '</td>').join('') + '</tr>';
        });
        el.querySelector('#tab').innerHTML = '<tr><th rowspan="2"></th>' + MODES.map(([, name, c]) => '<th colspan="3" style="text-align:center;color:' + c + '">' + name + '</th>').join('') + '</tr><tr>' + MODES.map(() => '<th>сделок</th><th>итог</th><th>макс. просадка</th>').join('') + '</tr>' + rows.join('') +
          '<tr><td><b>Сумма</b></td>' + MODES.map(([k]) => '<td><b>' + cn[k] + '</b></td><td><b>' + col(tot[k]) + '</b></td><td><b>' + f(-dd[k], 1) + '</b></td>').join('') + '</tr>';
        const better = tot.h > tot.s, safer = dd.h < dd.s;
        el.querySelector('#sum').innerHTML = 'Сценарий «<b>' + sc.name + '</b>». Сумма итогов: простой спред ' + col(tot.s, 0) + ', хедж с дробным k ' + col(tot.h, 0) + ', хедж в целых контрактах (' + s8.lots + ' контр. A) ' + col(tot.r, 0) + '. ' +
          'Хедж ' + (better ? 'заработал больше' : 'заработал меньше') + ' простого спреда в сумме и обогнал его в <b>' + winsH + ' из ' + SEEDS.length + '</b> наборов; суммарная просадка у него ' + (safer ? '<b>меньше</b>' : '<b>больше</b>') + ' (' + f(dd.h, 0) + ' против ' + f(dd.s, 0) + '). Сделок: ' + cn.s + ' / ' + cn.h + ' / ' + cn.r + '.';
      }
      const ctl = el.querySelector('#ctl');
      const ctlA = document.createElement('div'), ctlB = document.createElement('div');
      ctl.appendChild(ctlA); ctl.appendChild(ctlB);
      A.controls(ctlA, [S.n, S.entryZ, S.exitZ, S.stopZ, S.stopOn, S.cost], draw);
      HV.slider(ctlB, { label: 'Контрактов A (L) для третьего столбца', min: 1, max: 10, step: 1, value: s8.lots, fmt: (v) => f(v, 0) + ' контр. A', hint: 'Чем меньше контрактов, тем грубее округление k.', onInput: (v) => { s8.lots = v; drawTable(); } });

      /* ---------- 2. ошибка k по дням ---------- */
      const ktabs = el.querySelector('#ktabs'), kseeds = el.querySelector('#kseeds');
      ktabs.innerHTML = SC.map((s, i) => '<button class="b" data-i="' + i + '">' + s.name + '</button>').join('');
      kseeds.innerHTML = SEEDS.map((s, i) => '<button class="b" data-i="' + i + '">набор ' + s + '</button>').join('');
      ktabs.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s8.kscn = +b.dataset.i; drawK(); } });
      kseeds.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s8.kseed = +b.dataset.i; drawK(); } });
      let kd, kh;
      const kc = A.mkChart(el.querySelector('#kc'), 220, { tip: (i) => (kh.k[i] === null ? null : '<b>День ' + (i + 1) + '</b><br>k: ' + f(kh.k[i], 3) + ' ± ' + f(2 * kh.se[i], 3) + '<br>настоящее β: ' + f(kd.beta[i], 3)) });
      function drawK() {
        ktabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s8.kscn));
        kseeds.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === s8.kseed));
        const N = A.state.params.n;
        kd = E.genHedge(SEEDS[s8.kseed], SC[s8.kscn]);
        kh = E.hedgeStats(kd.a, kd.b, N);
        const up = kh.k.map((k, i) => (k === null || kh.se[i] === null ? null : k + 2 * kh.se[i]));
        const lo = kh.k.map((k, i) => (k === null || kh.se[i] === null ? null : k - 2 * kh.se[i]));
        kc.render({ n: kd.a.length, series: [{ data: up, color: '#7ee0b555', width: 1, dash: [3, 3] }, { data: lo, color: '#7ee0b555', width: 1, dash: [3, 3] }, { data: kd.beta, color: GREY, width: 1.6, dash: [6, 5] }, { data: kh.k, color: ME, width: 2 }], yMin: 0, yMax: 3 });
        let err = 0, c = 0, out = 0, w = 0;
        for (let t = N - 1; t < kd.a.length; t++) if (kh.k[t] !== null) { err += Math.abs(kh.k[t] - kd.beta[t]); c++; w += 2 * kh.se[t]; if (Math.abs(kh.k[t] - kd.beta[t]) > 2 * kh.se[t]) out++; }
        el.querySelector('#knote').innerHTML = 'При N = ' + N + ' средняя ошибка |k − β| = <b>' + f(err / c, 3) + '</b>, средняя полуширина коридора = ' + f(w / c, 3) + '. Настоящее β вышло за коридор в ' + out + ' из ' + c + ' дней (' + f(100 * out / c, 0) + '%).' +
          (s8.kscn === 3 ? ' После 200-го дня связи нет, и k показывает уже не «правильный коэффициент», а случайное число, под которое подстроилась регрессия.' : '');
      }

      /* ---------- 3. ошибка k при разных N ---------- */
      const ec = A.mkChart(el.querySelector('#ec'), 220, { xfmt: (i) => (NS[i] === undefined ? '' : 'N=' + NS[i]), tip: (i) => (NS[i] === undefined ? null : '<b>N = ' + NS[i] + '</b><br>β постоянно: ' + f(kErrors()[0][i], 3) + '<br>β меняется: ' + f(kErrors()[1][i], 3)) });
      function drawErr() {
        const e = kErrors();
        ec.render({ n: NS.length, series: [{ data: e[0], color: ME, width: 2.4 }, { data: e[1], color: SIM, width: 2.4 }], yMin: 0 });
        const best = e[1].indexOf(Math.min.apply(null, e[1]));
        el.querySelector('#et').innerHTML = '<table class="t"><tr><th>N</th>' + NS.map((n) => '<th>' + n + '</th>').join('') + '</tr>' +
          '<tr><td style="color:' + ME + '">β постоянно</td>' + e[0].map((v) => '<td>' + f(v, 3) + '</td>').join('') + '</tr>' +
          '<tr><td style="color:' + SIM + '">β меняется</td>' + e[1].map((v, i) => '<td' + (i === best ? ' style="font-weight:700;color:' + SIM + '"' : '') + '>' + f(v, 3) + '</td>').join('') + '</tr></table>' +
          '<p class="cap" style="margin-top:8px">Ошибка считается с 121-го дня, чтобы все окна были одинаково «разогреты». При меняющейся связи меньше всего ошибка при N = ' + NS[best] + '.</p>';
      }

      function draw() { drawTable(); drawK(); }

      const cards = [
        ['Что хедж реально даёт', 'Если инструменты двигаются в разной степени (β ≠ 1) или степень меняется со временем, коэффициент k убирает из спреда общее движение рынка. Спред становится «чище», и главный выигрыш — заметно меньшая просадка, а не только больший итог.'],
        ['Чем за это платим', 'k каждый день оценивается по шумным данным, поэтому спред A − k·B немного «дрожит». Отсюда больше ложных сигналов, больше сделок и издержек. Если β на самом деле равно 1, эта плата ничем не окупается.'],
        ['Окно N — компромисс', 'Короткое окно делает k нервным, длинное — запаздывающим. Хорошего N «для всех» нет, а подбирать его по прошлому опасно: легко получить ' + T('overfit', 'подгонку под прошлое') + '.'],
        ['Малая вариация B', 'В знаменателе формулы k стоит сумма квадратов отклонений B: Σ(B − B̄)². Когда B в окне почти не двигался, мы делим на крошечное число — любой случайный шорох в A раздувает k до нелепых значений. На «спящем» B регрессия слепнет.'],
        ['Расходы на округление', 'Биржа торгует только целыми ' + T('contract', 'контрактами') + '. На малом числе контрактов округление k оставляет перекос к рынку, а точный ' + T('lots_ratio', 'хедж в лотах') + ' (например, 5 к 7 вместо 1 к 1) кратно увеличивает залог и комиссии.'],
        ['Заморозка k против ребалансировки', 'Пока сделка открыта, мы держим исходное число контрактов (' + T('frozen_k', 'замороженный k') + '). Если связь сильно уплыла внутри долгой сделки, защита ослабевает, но ежедневная ' + T('rebalance', 'ребалансировка') + ' съела бы прибыль на комиссиях.'],
        ['Слом связи хедж не лечит', 'Когда связь исчезает, регрессия всё равно выдаёт какое-то k и с ним — «необычный» спред. Стратегия продолжает входить, ожидая возврата, которого не будет: в сценарии «слом связи» хедж открыл больше сделок и потерял больше простого спреда. Защита — ' + T('stop', 'стоп-лосс') + ', а не регрессия.'],
        ['Ложная («случайная») связь', 'Регрессия проведёт прямую даже через два несвязанных ряда, случайно шедших в одну сторону. Высокий ' + T('r2', 'R²') + ' на коротком окне — не доказательство связи. Отсеивать ' + T('spurious', 'ложные пары') + ' — задача раздела «Коинтеграция».'],
        ['Что не меняется', 'Всё сказанное про простой z-score: издержки съедают маленькую прибыль, исполнение по цене сигнала не гарантировано, данные здесь синтетические. Хедж чинит неравный шаг A и B, но не делает стратегию безрисковой.']
      ];
      el.querySelector('#cards').innerHTML = cards.map((c) => '<div class="card"><h4>' + c[0] + '</h4><p>' + c[1] + '</p></div>').join('');
      draw();
      drawErr();
    }
  });
})();
