/* Режимы HMM и копулы, экраны 1–4: скрытые марковские модели (фильтр Гамильтона),
   режимный гейт и энтропия неуверенности, хвостовая зависимость копул и Mispricing Index (#63, #49). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, HV = window.HV;
  const Z = (window.RGSCREENS = []);
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', PRE = '#5aa9ff', GOLD = '#ffd166', PURP = '#c9b6ff';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const pct = (v, d) => U.fmt(v * 100, d === undefined ? 0 : d) + '%';

  /* ---------- 1. Скрытые режимы рынка и фильтр Гамильтона ---------- */
  const s1 = { scenIdx: 0, stayP: 0.93 };

  Z.push({
    id: 'hmm-hidden',
    title: 'Скрытые режимы рынка: как угадать погоду по стуку капель',
    lead: 'Связь между двумя активами не живёт вечно в одной погоде: она чередует спокойный возврат, дорогую болтанку и тихий распад. Скрытая марковская модель (HMM) оценивает вероятность каждого режима на лету.',
    text: () => `
      <h3>Почему режим называется «скрытым»</h3>
      <p>На бирже никто не вешает табличку «сегодня в 14:00 возврат к среднему сломался». Мы видим только ежедневные шаги спреда — точно так же, как человек в комнате без окон судит о погоде по стуку капель о крышу. Отсюда термин ${T('hidden_state', 'скрытое состояние')}.</p>
      <p>${T('hmm_model', 'Скрытая марковская модель (HMM)')} держит в голове три возможные «погоды» пары:</p>
      <ul>
        <li><b style="color:${ME}">Спокойный возврат:</b> отклонение тянется обратно к равновесию, шум умеренный — идеальная среда для спрэдовой торговли.</li>
        <li><b style="color:${SIM}">Волатильный шторм:</b> стакан пустеет, размах скачков вырастает втрое, возвратная пружина слабеет.</li>
        <li><b style="color:${BAD}">Распад / дрейф:</b> связь разорвана — спред шагает в одну сторону без всякого желания возвращаться, даже если внешне рынок тих!</li>
      </ul>
      <p>Вечером каждого дня каузальный ${T('hamilton_filter', 'фильтр Гамильтона')} умножает вчерашние вероятностей (с учётом ${T('transition_matrix', 'матрицы переходов')}) на правдоподобие сегодняшнего шага по формуле Байеса — строго без заглядывания в будущее.</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Спред и вероятности трёх скрытых режимов по фильтру Гамильтона</h4>
          <div class="btns" id="b1" style="margin:0 0 10px">
            <button class="b" data-i="0">Тихий распад без грома</button>
            <button class="b" data-i="1">Чередование штиля и бурь</button>
          </div>
          <div id="sl1"></div>
          <div id="kpi1" style="margin:10px 0"></div>
          <div class="legend">
            <span><i style="background:${PRE}"></i>наблюдаемый спред S(t)</span>
            <span><i style="background:#ff6b6b35"></i>истинный распад / буря</span>
          </div>
          <div id="c1sp"></div>
          <h4 style="margin-top:12px">Живые вероятности режимов (сумма всегда = 100%)</h4>
          <div class="legend">
            <span><i style="background:${ME}"></i>P(спокойный возврат)</span>
            <span><i style="background:${SIM}"></i>P(волатильный шторм)</span>
            <span><i style="background:${BAD}"></i>P(распад / дрейф)</span>
          </div>
          <div id="c1pr"></div>
        </div>`;

      const bEl = el.querySelector('#b1');
      bEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s1.scenIdx = +b.dataset.i; draw1(); } });

      HV.slider(el.querySelector('#sl1'), {
        label: 'Инерция режима p₀₀ в матрице переходов (память погоды)', min: 0.80, max: 0.97, step: 0.01, value: s1.stayP,
        fmt: (v) => pct(v, 0) + ' шанс остаться в том же режиме завтра',
        onInput: (v) => { s1.stayP = v; draw1(); }
      });

      let curRg = null, curHmm = null;
      const cSp = A.mkChart(el.querySelector('#c1sp'), 165, {
        tip: (i) => curRg ? '<b>День ' + (i + 1) + '</b><br>Спред: <b>' + U.sgn(curRg.spread[i]) + ' п.</b>' : ''
      });
      const cPr = A.mkChart(el.querySelector('#c1pr'), 165, {
        tip: (i) => curHmm ? '<b>День ' + (i + 1) + '</b><br>' +
          '<span style="color:' + ME + '">Возврат: <b>' + pct(curHmm.pRev[i], 0) + '</b></span><br>' +
          '<span style="color:' + SIM + '">Шторм: <b>' + pct(curHmm.pStorm[i], 0) + '</b></span><br>' +
          '<span style="color:' + BAD + '">Распад: <b>' + pct(curHmm.pBreak[i], 0) + '</b></span>' : ''
      });

      function draw1() {
        bEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s1.scenIdx));
        const p = s1.stayP, rem = 0.5 * (1 - p);
        const trans = [
          [p, rem * 1.1, rem * 0.9],
          [Math.min(0.22, rem * 2.4), Math.max(0.70, p - 0.08), rem * 0.8],
          [rem * 0.8, rem * 0.8, Math.min(0.96, p)]
        ];
        // Нормируем строки матрицы переходов ровно в единицу
        trans.forEach((row) => { const s = row[0] + row[1] + row[2]; row[0] /= s; row[1] /= s; row[2] /= s; });

        curRg = E.genRegimeScenario(7, E.REGIME_SCENARIOS[s1.scenIdx]);
        curHmm = E.hmmFilter(curRg.spread, { anchorWin: 45, trans });

        const spans = [];
        curRg.trueState.forEach((st, i) => {
          if (st === 1) spans.push({ i0: i - 0.5, i1: i + 0.5, color: '#f5a65b1c' });
          else if (st === 2) spans.push({ i0: i - 0.5, i1: i + 0.5, color: '#ff6b6b20' });
        });

        const calmAvg = curHmm.pRev.slice(50, 80).reduce((a, b) => a + b, 0) / 30;
        const lateAvg = curHmm.pBreak.slice(280, 310).reduce((a, b) => a + b, 0) / 30;
        el.querySelector('#kpi1').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + ME + '">' + pct(calmAvg, 0) + '</div><div class="l">P(возврат) на спокойном участке</div><div class="e">дни 50–80</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + BAD + '">' + pct(lateAvg, 0) + '</div><div class="l">P(распад) в конце истории</div><div class="e">дни 280–310</div></div>' +
            '<div class="kpi"><div class="v">' + f(1 / (1 - p), 1) + ' дн.</div><div class="l">средняя длина режима</div><div class="e">1 ÷ (1 − p₀₀)</div></div>' +
          '</div>';

        cSp.render({
          n: curRg.spread.length, spans,
          hlines: [{ y: 0, color: '#ffffff22', dash: [3, 3] }],
          series: [{ data: curRg.spread, color: PRE, width: 1.55 }]
        });
        cPr.render({
          n: curRg.spread.length, spans,
          hlines: [{ y: 0.5, color: '#ffffff20', dash: [3, 3] }],
          series: [
            { data: curHmm.pRev, color: ME, width: 2.0 },
            { data: curHmm.pStorm, color: SIM, width: 1.75 },
            { data: curHmm.pBreak, color: BAD, width: 2.0 }
          ]
        });
      }
      draw1();
    }
  });

  /* ---------- 2. Режимный гейт и энтропия неуверенности ---------- */
  const s2 = { pRev: 0.62, pStorm: 0.28 };

  Z.push({
    id: 'hmm-uncertainty',
    title: 'Режимный гейт и цена сомнений: когда «не знаю» — лучший сигнал',
    lead: 'Умный классификатор нужен не только чтобы кричать «караул, поломка!», но и чтобы честно признаваться в собственной растерянности. Когда вероятности делятся почти поровну, стратегия сама убирает ногу с педали газа.',
    text: () => `
      <h3>Двойная польза вероятностей режима</h3>
      <p>Грубый фильтр мыслит чёрно-бело: «включено» или «выключено». ${T('regime_gate', 'Режимный гейт')} на базе HMM работает тоньше и решает сразу две задачи:</p>
      <ol>
        <li><b>Выбирает правило игры под погоду:</b> в уверенном возвратном режиме открывает полный рабочий объём (<code>100%</code>), в шторме режет позицию до четверти лота и раздвигает пороги входа на <code>+55%</code>, а при распаде (<code>P_распад ≥ 42%</code>) запрещает новые входы и при <code>≥ 58%</code> принудительно закрывает открытую сделку.</li>
        <li><b>Превращает сомнение в защиту:</b> представьте прогноз <code>35% возврат / 34% шторм / 31% распад</code>. Ни одна красная лампочка ещё не набрала большинства, но ${T('regime_entropy', 'энтропия неуверенности')} взлетела почти к <code>100%</code>. Переходный туман — худшее время для ставок ва-банк, поэтому гейт объявляет паузу!</li>
      </ol>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Пульт режимного гейта: проверьте реакцию на уверенность и туман</h4>
          <div class="btns" id="pr2" style="margin:0 0 10px">
            <button class="b" data-r="0.82" data-s="0.11">Ясный штиль (82 / 11 / 7%)</button>
            <button class="b" data-r="0.62" data-s="0.28">Рабочий пример (62 / 28 / 10%)</button>
            <button class="b" data-r="0.35" data-s="0.34">Туман «не знаю» (35 / 34 / 31%)</button>
            <button class="b" data-r="0.30" data-s="0.52">Буря (30 / 52 / 18%)</button>
            <button class="b" data-r="0.18" data-s="0.20">Тихий распад (18 / 20 / 62%)</button>
          </div>
          <div id="sl2r"></div>
          <div id="sl2s"></div>
          <div id="bar2" style="margin:14px 0"></div>
          <div id="kpi2"></div>
          <div id="verdict2" class="note" style="margin-top:12px"></div>
        </div>`;

      const slR = HV.slider(el.querySelector('#sl2r'), {
        label: 'Вероятность спокойного возврата P(возврат)', min: 0.05, max: 0.92, step: 0.01, value: s2.pRev,
        fmt: (v) => pct(v, 0),
        onInput: (v) => {
          s2.pRev = v;
          if (s2.pRev + s2.pStorm > 0.98) { s2.pStorm = Math.max(0.01, 0.98 - s2.pRev); slS.set(s2.pStorm); }
          draw2();
        }
      });
      const slS = HV.slider(el.querySelector('#sl2s'), {
        label: 'Вероятность волатильного шторма P(шторм)', min: 0.02, max: 0.85, step: 0.01, value: s2.pStorm,
        fmt: (v) => pct(v, 0),
        onInput: (v) => {
          s2.pStorm = v;
          if (s2.pRev + s2.pStorm > 0.98) { s2.pRev = Math.max(0.02, 0.98 - s2.pStorm); slR.set(s2.pRev); }
          draw2();
        }
      });

      el.querySelector('#pr2').addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        s2.pRev = +b.dataset.r;
        s2.pStorm = +b.dataset.s;
        slR.set(s2.pRev);
        slS.set(s2.pStorm);
        draw2();
      });

      function draw2() {
        const pBrk = Math.max(0, 1 - s2.pRev - s2.pStorm);
        const probs = [s2.pRev, s2.pStorm, pBrk];
        const gt = E.regimeGate(probs);

        el.querySelector('#bar2').innerHTML =
          '<div style="display:flex;height:28px;border-radius:8px;overflow:hidden;border:1px solid #2a3242;font-size:13px;font-weight:600;color:#0e1218">' +
            '<div style="width:' + (s2.pRev * 100).toFixed(1) + '%;background:' + ME + ';display:flex;align-items:center;justify-content:center">' + (s2.pRev >= 0.14 ? 'Возврат ' + pct(s2.pRev, 0) : '') + '</div>' +
            '<div style="width:' + (s2.pStorm * 100).toFixed(1) + '%;background:' + SIM + ';display:flex;align-items:center;justify-content:center">' + (s2.pStorm >= 0.14 ? 'Шторм ' + pct(s2.pStorm, 0) : '') + '</div>' +
            '<div style="width:' + (pBrk * 100).toFixed(1) + '%;background:' + BAD + ';display:flex;align-items:center;justify-content:center">' + (pBrk >= 0.14 ? 'Распад ' + pct(pBrk, 0) : '') + '</div>' +
          '</div>';

        const stateCol = gt.state === 'active_rev' ? ME : (gt.state === 'storm_cautious' ? SIM : BAD);
        el.querySelector('#kpi2').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + stateCol + '">' + pct(gt.sizeMult, 0) + '</div><div class="l">доля рабочего лота</div><div class="e">множитель позиции</div></div>' +
            '<div class="kpi"><div class="v">×' + f(gt.bandMult) + '</div><div class="l">множитель ширины полос</div><div class="e">вход при ±' + f(1.75 * gt.bandMult) + 'σ</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + (gt.entropy >= 0.84 ? BAD : PRE) + '">' + pct(gt.entropy, 0) + '</div><div class="l">энтропия сомнений H</div><div class="e">уверенность ' + pct(gt.confidence, 0) + '</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + (gt.forceExit ? BAD : ME) + '">' + (gt.forceExit ? 'ДА (выход!)' : 'Нет') + '</div><div class="l">аварийное закрытие</div><div class="e">при P(распад) ≥ 58%</div></div>' +
          '</div>';

        el.querySelector('#verdict2').innerHTML =
          '<b>Вердикт режимного гейта:</b> <span style="color:' + stateCol + ';font-weight:700">' + gt.label + '</span>. ' +
          (gt.state === 'paused_uncertain'
            ? 'Обратите внимание: вероятность распада всего ' + pct(pBrk, 0) + ', но модель разводит руками (энтропия ' + pct(gt.entropy, 0) + ' ≥ 84%) и бережёт капитал до прояснения погоды!'
            : gt.state === 'blocked_break'
              ? 'Вероятность поломки связи достигла ' + pct(pBrk, 0) + ' — любые спрэдовые входы заблокированы.'
              : gt.state === 'storm_cautious'
                ? 'Рынок штормит: объём урезан до четверти лота, а порог входа отодвинут на ×1,55.'
                : 'Режим возврата подтверждён: стратегия работает в штатном коридоре.');
      }
      draw2();
    }
  });

  /* ---------- 3. Копулы и хвостовая зависимость (облака в [0,1]^2 и R^2) ---------- */
  const s3 = { fam: 'clayton', tau: 0.56, space: 'unit' };
  const FAMS = [
    { id: 'gaussian', name: 'Гауссова (обычная)', note: 'В центре точки идут дружно, но в самых углах (0,0) и (1,1) связь рассыпается: совместные паники недооценены!' },
    { id: 'clayton', name: 'Клейтона (нижний хвост)', note: 'Левый нижний угол (0,0) сжат в острый клюв: когда рынок падает, обе ноги валятся синхронно (типично для акций в кризис).' },
    { id: 'gumbel', name: 'Гамбеля (верхний хвост)', note: 'Правый верхний угол (1,1) стянут вместе: активы взлетают дуплетом на дефиците или шорт-сквизе.' },
    { id: 'student', name: 'Стьюдента t (оба хвоста)', note: 'Симметричные «уши» в обоих углах: и обвалы, и ралли случаются совместно гораздо чаще нормального закона.' }
  ];

  Z.push({
    id: 'copula-tails',
    title: 'Почему корреляция слепа в обвал: копулы и сцепка в хвостах',
    lead: 'Две пары могут иметь абсолютно одинаковую среднюю корреляцию, но вести себя противоположно в день биржевой паники. Копула отделяет форму одиночной ноги от того, как ноги сцеплены в экстремальных углах.',
    text: () => `
      <h3>Гениально простая ${T('sklar_idea', 'идея Склара')}</h3>
      <p>У одной бумаги дневные шаги могут быть плавными, а у другой — дёргаными и скошенными. Если мерить их линейной разностью и обычным колоколом Гаусса, один резкий день исказит шкалу на два месяца вперёд.</p>
      <p>Переведём шаги каждой ноги в её собственный процентный ранг от <code>0%</code> (худший обвал в окне) до <code>100%</code> (лучший взлёт) — словно место ученика в классе по физике и по математике. Тогда на квадрате <code>[0, 1] × [0, 1]</code> остаётся чистая геометрия сцепки — ${T('copula_fn', 'копула')}!</p>
      <p>Переключайте четыре ${T('clayton_gumbel', 'семейства копул')} справа при <b>одной и той же</b> ранговой связи τ: посмотрите, как пустеют углы у Гауссовой модели (<code>λ = 0%</code>) и как плотно стягивается кризисный угол у копулы Клейтона (${T('tail_dependence', 'хвостовая зависимость')} <code>λ_L &gt; 70%</code>).</p>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Четыре формы сцепки при одинаковой ранговой корреляции τ</h4>
          <div class="btns" id="f3" style="margin:0 0 8px"></div>
          <div class="btns" id="sp3" style="margin:0 0 10px">
            <button class="b" data-sp="unit">Квадрат рангов [0, 1] × [0, 1]</button>
            <button class="b" data-sp="norm">Шкала стандартных отклонений (X, Y)</button>
          </div>
          <div id="sl3"></div>
          <p id="note3" style="margin:8px 0;color:#98a3b6"></p>
          <div id="kpi3" style="margin-bottom:10px"></div>
          <canvas id="cv3" style="width:100%;max-width:520px;height:310px;display:block;margin:0 auto;border-radius:8px;background:#0e1218;border:1px solid #222938"></canvas>
        </div>`;

      const fEl = el.querySelector('#f3'), spEl = el.querySelector('#sp3');
      fEl.innerHTML = FAMS.map((fm) => '<button class="b" data-f="' + fm.id + '">' + fm.name + '</button>').join('');
      fEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s3.fam = b.dataset.f; draw3(); } });
      spEl.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { s3.space = b.dataset.sp; draw3(); } });

      HV.slider(el.querySelector('#sl3'), {
        label: 'Ранговая связь Кендалла τ (одинаковая для всех семейств!)', min: 0.25, max: 0.78, step: 0.01, value: s3.tau,
        fmt: (v) => 'τ = ' + f(v),
        onInput: (v) => { s3.tau = v; draw3(); }
      });

      const cv = el.querySelector('#cv3');

      function draw3() {
        fEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.f === s3.fam));
        spEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.sp === s3.space));
        const fmMeta = FAMS.find((x) => x.id === s3.fam);
        el.querySelector('#note3').textContent = fmMeta.note;

        const smp = E.copulaSample2D(21, 340, s3.fam, s3.tau);
        let crashBoth = 0, crashAny = 0, boomBoth = 0;
        smp.pts.forEach((p) => {
          if (p.v <= 0.12) { crashAny++; if (p.u <= 0.12) crashBoth++; }
          if (p.u >= 0.88 && p.v >= 0.88) boomBoth++;
        });

        el.querySelector('#kpi3').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + BAD + '">' + pct(smp.tails.lower, 0) + '</div><div class="l">нижний хвост обвалов λ_L</div><div class="e">предел сцепки в (0, 0)</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + ME + '">' + pct(smp.tails.upper, 0) + '</div><div class="l">верхний хвост ралли λ_U</div><div class="e">предел сцепки в (1, 1)</div></div>' +
            '<div class="kpi"><div class="v">' + (crashAny ? pct(crashBoth / crashAny, 0) : '0%') + '</div><div class="l">совместных падений в выборке</div><div class="e">доля u ≤ 12% при v ≤ 12%</div></div>' +
          '</div>';

        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(280, Math.min(520, cv.clientWidth || 460)), h = 310;
        cv.width = w * dpr; cv.height = h * dpr;
        const ctx = cv.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const pad = 34, pw = w - pad * 2, ph = h - pad * 2;
        const mapX = (p) => pad + (s3.space === 'unit' ? p.u : (Math.max(-3.2, Math.min(3.2, p.x)) + 3.2) / 6.4) * pw;
        const mapY = (p) => pad + (1 - (s3.space === 'unit' ? p.v : (Math.max(-3.2, Math.min(3.2, p.y)) + 3.2) / 6.4)) * ph;

        // Подсветка кризисного нижнего левого и верхнего правого углов
        const boxW = pw * 0.16, boxH = ph * 0.16;
        ctx.fillStyle = 'rgba(255, 107, 107, 0.11)';
        ctx.fillRect(pad, pad + ph - boxH, boxW, boxH);
        ctx.fillStyle = 'rgba(126, 224, 181, 0.10)';
        ctx.fillRect(pad + pw - boxW, pad, boxW, boxH);

        ctx.strokeStyle = '#263042';
        ctx.strokeRect(pad, pad, pw, ph);
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.moveTo(pad, pad + ph);
        ctx.lineTo(pad + pw, pad);
        ctx.stroke();
        ctx.setLineDash([]);

        smp.pts.forEach((p) => {
          const cx = mapX(p), cy = mapY(p);
          const inLow = p.u <= 0.14 && p.v <= 0.14;
          const inHigh = p.u >= 0.86 && p.v >= 0.86;
          ctx.fillStyle = inLow ? BAD : (inHigh ? ME : PRE + 'cc');
          ctx.beginPath();
          ctx.arc(cx, cy, (inLow || inHigh) ? 3.3 : 2.3, 0, Math.PI * 2);
          ctx.fill();
        });

        ctx.fillStyle = '#98a3b6';
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText(s3.space === 'unit' ? 'Ранг ноги A (u: 0 → 1)' : 'Шок ноги A (−3σ → +3σ)', pad + pw / 2 - 65, h - 8);
        ctx.fillStyle = BAD;
        ctx.fillText('Обвал (0,0)', pad + 6, pad + ph - 6);
        ctx.fillStyle = ME;
        ctx.fillText('Ралли (1,1)', pad + pw - 74, pad + 16);
      }
      draw3();
    }
  });

  /* ---------- 4. Условные вероятности, Mispricing Index и предупреждение v3 ---------- */
  const s4 = { win: 60 };

  Z.push({
    id: 'copula-mi',
    title: 'Индекс недооценки (Mispricing Index) и честные границы уровня v3',
    lead: 'Копула превращает взаимное положение рангов в вероятностный сигнал недооценки, устойчивый к тяжёлым шпилям. Но тонкая модель — обоюдоострый инструмент: на коротком шумном окне она легко переобучается.',
    text: () => `
      <h3>От копулы к сигналу сделки</h3>
      <p>Зная форму копулы <code>C(u, v)</code>, мы в любой день вычисляем условную вероятность <code>h₁ = ∂C(u, v)/∂v = P(U ≤ u | V = v)</code>. Простыми словами: <i>«При том шаге, который сегодня сделала вторая нога, какова вероятность увидеть настолько низкий шаг первой?»</i></p>
      <ul>
        <li>Если <code>h₁ ≈ 0,50</code> — ноги шагнули совершенно соразмерно (даже если весь рынок рухнул на <code>−6%</code>!).</li>
        <li>Если <code>h₁ = 0,04</code> — первая нога аномально отстала от второй даже с поправкой на хвосты. Накапливая эти условные перекосы вместе с ранговым квантилем спреда, мы получаем ${T('mispricing_index', 'индекс недооценки (Mispricing Index, MI)')}.</li>
      </ul>
      <h3>Честное предупреждение для продвинутых стратегий (F и G)</h3>
      <p>В архитектуре скринера копульная стратегия <b>F</b> и родственная ей <b>непараметрическая коинтеграция G</b> (отбор и ранжирование пар по эмпирическому времени возврата <code>ERT</code> без жёстких формул <code>2σ</code>) отнесены к исследовательскому уровню <b>v3</b>:</p>
      <ol>
        <li><b>Жадность к длине окна:</b> сожмите ползунок окна справа до <code>12–15</code> дней — и увидите, как тонкая оценка рангов начинает нервно дёргаться на каждом пустяке.</li>
        <li><b>Слепота к распаду:</b> копула не спасает от структурного слома связи, поэтому без предохранителя HMM торговать её в одиночку опасно!</li>
      </ol>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Тяжёлые тени стакана: ослепший линейный Z-score против копульного MI</h4>
          <div id="sl4"></div>
          <div id="kpi4" style="margin:10px 0"></div>
          <div class="legend">
            <span><i style="background:${SIM}"></i>обычный линейный Z-score (слепнет после шпилей!)</span>
            <span><i style="background:${ME}"></i>копульный индекс недооценки MI</span>
            <span><i style="background:${GOLD}"></i>рабочий порог входа ±1,75</span>
          </div>
          <div id="c4"></div>
        </div>`;

      HV.slider(el.querySelector('#sl4'), {
        label: 'Окно калибровки рангов и копулы W (проверьте W = 14 против W = 60!)', min: 12, max: 85, step: 2, value: s4.win,
        fmt: (v) => v + ' дн.' + (v < 24 ? ' (опасно мало — шум!)' : ' (устойчивая выборка)'),
        onInput: (v) => { s4.win = v; draw4(); }
      });

      let curZ = null, curMi = null;
      const rg = E.genRegimeScenario(7, E.REGIME_SCENARIOS[2]); // clayton_tails up to bar 240
      const c4 = A.mkChart(el.querySelector('#c4'), 210, {
        tip: (i) => curZ ? '<b>День ' + (i + 1) + '</b><br>' +
          '<span style="color:' + SIM + '">Линейный Z: <b>' + (curZ[i] !== null ? U.sgn(curZ[i]) : '—') + '</b></span><br>' +
          '<span style="color:' + ME + '">Копульный MI: <b>' + U.sgn(curMi[i]) + '</b></span>' : ''
      });

      function draw4() {
        const st = E.rolling(rg.spread.slice(0, 240), 45);
        const cop = E.mispricingIndex(rg.legA.slice(0, 240), rg.legB.slice(0, 240), { win: s4.win, family: 'clayton' });
        curZ = st.z.map((v) => v === null ? null : Math.max(-3.6, Math.min(3.6, v)));
        curMi = cop.mi;

        let zSignals = 0, miSignals = 0;
        for (let t = 50; t < 240; t++) {
          if (Math.abs(st.z[t] || 0) >= 1.75 && Math.abs(rg.spread[t] - rg.execSpread[t]) < 1) zSignals++;
          if (Math.abs(cop.mi[t]) >= 1.75 && Math.abs(rg.spread[t] - rg.execSpread[t]) < 1) miSignals++;
        }

        el.querySelector('#kpi4').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v" style="color:' + SIM + '">' + zSignals + ' дн.</div><div class="l">истинных сигналов у Z-score</div><div class="e">std раздуто прошлыми тенями</div></div>' +
            '<div class="kpi"><div class="v" style="color:' + ME + '">' + miSignals + ' дн.</div><div class="l">рабочих сигналов у MI</div><div class="e">' + (s4.win < 24 ? 'много ложной суеты на малом W!' : 'ранги не боятся прошлых шпилей') + '</div></div>' +
            '<div class="kpi"><div class="v">' + f(cop.tau[200]) + '</div><div class="l">оценка связи Кендалла τ</div><div class="e">копула Клейтона на дне #200</div></div>' +
          '</div>';

        c4.render({
          n: 240,
          hlines: [
            { y: 1.75, color: GOLD + '88', dash: [4, 4] },
            { y: 0, color: '#ffffff20', dash: [2, 3] },
            { y: -1.75, color: GOLD + '88', dash: [4, 4] }
          ],
          series: [
            { data: curZ, color: SIM, width: 1.55 },
            { data: curMi, color: ME, width: 1.9 }
          ]
        });
      }
      draw4();
    }
  });
})();
