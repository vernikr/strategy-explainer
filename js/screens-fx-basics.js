/* Межбиржевой и валютный спред, экраны 1–4: паритет валют и единиц измерения,
   зачем нужна третья валютная нога, ручной расчёт 3 ног и ловушка разных часов торгов (#41). */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, HV = window.HV;
  const C = U.COLORS;
  const Z = (window.FXSCREENS = window.FXSCREENS || []);
  const ME = '#7ee0b5', SIM = '#f5a65b', BAD = '#ff6b6b', PRE = '#5aa9ff', GOLD = '#ffd166', PURP = '#c9b6ff';
  const f = (v, d) => U.fmt(v, d === undefined ? 2 : d);
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 2 : d) + '</span>';

  /* ---------- 1. Один актив, две валюты и разные единицы ---------- */
  const PARITY_PRESETS = [
    { name: 'Золото ($/унция и ₽/грамм)', world: 2650, fx: 90, div: 31.1035, dom: 7820, wUnit: '$/унц.', dUnit: '₽/г', divHint: '1 тройская унция = 31,1035 грамма' },
    { name: 'Акция и расписка (1 расписка = 4 акции)', world: 11.2, fx: 90, div: 4, dom: 246, wUnit: '$/расп.', dUnit: '₽/акцию', divHint: 'в 1 зарубежной расписке упаковано 4 акции' },
    { name: 'Учебный контракт раздела (1 п. = 100 ₽)', world: 100, fx: 90, div: 100, dom: 91.5, wUnit: '$', dUnit: 'п. (по 100 ₽)', divHint: 'перевод долларов в пункты по 100 ₽' }
  ];
  const s1 = Object.assign({ preset: 0 }, PARITY_PRESETS[0]);

  Z.push({
    id: 'parity',
    title: 'Один актив, две валюты и разные единицы',
    lead: 'На двух биржах может торговаться один и тот же металл, нефть или акция — но в разных валютах и разных мерах веса. Вычитать такие котировки «в лоб» нельзя: сначала обе цены приводят к общему знаменателю.',
    text: () => `
      <h3>Яблоки в рублях за килограмм и в долларах за фунт</h3>
      <p>Представьте, что в Москве яблоки стоят 200 ₽ за килограмм, а в Нью-Йорке — 1,20 $ за фунт. Если просто вычесть <code>200 − 1,20 = 198,8</code>, получится число без всякого смысла: смешались и валюты, и вес.</p>
      <p>Точно так же устроен ${T('inter_exchange', 'межбиржевой спред')}. Например, мировое золото котируется в долларах за ${T('troy_ounce', 'тройскую унцию')} (31,1035 грамма), а внутренний контракт — в рублях за 1 грамм. Чтобы увидеть настоящую разницу площадок, зарубежную цену переводят в ${T('fx_parity', 'валютный паритет')}:</p>
      <span class="formula">Паритет = (Цена<sub>мир</sub> × Курс<sub>FX</sub>) ÷ Делитель единиц<small>золото: 2 650 $/унц. × 90 ₽/$ ÷ 31,1035 г/унц. = 7 667,95 ₽/г</small></span>
      <h3>Истинный спред против «обманки курса»</h3>
      <p>Только после пересчёта можно вычитать одну цену из другой в одних и тех же единицах:</p>
      <span class="formula">Спред = Цена<sub>внутр</sub> − Паритет</span>
      <p>Посмотрите на правый нижний график в сценарии роста курса доллара: и внутренняя рублёвая цена, и мировой паритет в рублях взлетают почти вдвое, а <b>истинный спред между ними спокойно колеблется возле +1,5 пункта</b>.</p>
      <div class="note"><b>Договорённость в этом разделе.</b> В симуляторе на следующих экранах мировая цена выражена в долларах (около 100 $), курс — в рублях за доллар (около 90 ₽/$), а 1 пункт внутреннего контракта равен 100 ₽. Тогда паритет равен <code>Цена_$ × Курс ÷ 100</code> пунктов.</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Калькулятор паритета: переведите зарубежную котировку во внутренние единицы</h4>
          <div class="btns" id="p1" style="margin:0 0 10px"></div>
          <div id="ctl1"></div>
          <div id="res1" style="margin-top:10px"></div>
        </div>
        <div class="viz">
          <h4>Как курс двигает обе рублёвые цены вместе, оставляя спред на месте</h4>
          <p class="cap">Сценарий «Валютное ралли»: доллар вырастает с 90 выше 180 ₽/$. Сверху — внутренняя цена и паритет, снизу — их разница (истинный спред).</p>
          <div class="legend">
            <span><i style="background:${PRE}"></i>внутренняя цена (п.)</span>
            <span><i style="background:${SIM}"></i>мировой паритет в рублях (п.)</span>
          </div>
          <div id="c1a"></div>
          <div class="legend" style="margin-top:10px">
            <span><i style="background:${ME}"></i>истинный спред: Внутр − Паритет</span>
            <span><i style="background:${BAD}"></i>ошибочная разность без курса: Внутр − Цена_$</span>
          </div>
          <div id="c1b"></div>
        </div>`;

      const pEl = el.querySelector('#p1');
      pEl.innerHTML = PARITY_PRESETS.map((p, i) => '<button class="b" data-i="' + i + '">' + p.name + '</button>').join('');

      const fxDemo = E.genFxScenario(7, E.FX_SCENARIOS[1]);
      const rawWrong = fxDemo.pDom.map((d, i) => E.round2(d - fxDemo.pWorld[i]));
      const c1a = A.mkChart(el.querySelector('#c1a'), 165, {
        tip: (i) => '<b>День ' + (i + 1) + '</b> · курс ' + f(fxDemo.fx[i], 2) + ' ₽/$<br>внутренняя: <b>' + f(fxDemo.pDom[i]) + ' п.</b><br>паритет: <b>' + f(fxDemo.parity[i]) + ' п.</b>'
      });
      const c1b = A.mkChart(el.querySelector('#c1b'), 155, {
        tip: (i) => '<b>День ' + (i + 1) + '</b><br>истинный спред: <b style="color:' + ME + '">' + U.sgn(fxDemo.syncSpread[i]) + ' п.</b><br>без учёта курса: <b style="color:' + BAD + '">' + U.sgn(rawWrong[i]) + '</b>'
      });
      c1a.render({
        n: fxDemo.pDom.length,
        series: [
          { data: fxDemo.pDom, color: PRE, width: 1.8 },
          { data: fxDemo.parity, color: SIM, width: 1.6, dash: [5, 4] }
        ]
      });
      c1b.render({
        n: fxDemo.pDom.length,
        hlines: [{ y: 0, color: '#ffffff28', dash: [3, 3] }],
        series: [
          { data: rawWrong, color: BAD, width: 1.4, dash: [4, 3] },
          { data: fxDemo.syncSpread, color: ME, width: 1.9 }
        ]
      });

      function rebuildSliders() {
        const pr = PARITY_PRESETS[s1.preset];
        const box = el.querySelector('#ctl1');
        box.innerHTML = '<div id="sl_w"></div><div id="sl_fx"></div><div id="sl_d"></div>';
        HV.slider(box.querySelector('#sl_w'), {
          label: 'Зарубежная цена (' + pr.wUnit + ')',
          min: +(pr.world * 0.6).toFixed(1), max: +(pr.world * 1.4).toFixed(1), step: pr.world > 200 ? 10 : 0.2, value: s1.world,
          fmt: (v) => f(v, pr.world > 200 ? 0 : 2) + ' ' + pr.wUnit,
          onInput: (v) => { s1.world = v; drawCalc(); }
        });
        HV.slider(box.querySelector('#sl_fx'), {
          label: 'Валютный курс (₽ за 1 $)', min: 60, max: 140, step: 0.5, value: s1.fx,
          fmt: (v) => f(v, 1) + ' ₽/$',
          onInput: (v) => { s1.fx = v; drawCalc(); }
        });
        HV.slider(box.querySelector('#sl_d'), {
          label: 'Внутренняя цена (' + pr.dUnit + ')',
          min: +(pr.dom * 0.6).toFixed(1), max: +(pr.dom * 1.4).toFixed(1), step: pr.dom > 500 ? 20 : 0.5, value: s1.dom,
          fmt: (v) => f(v, pr.dom > 500 ? 0 : 2) + ' ' + pr.dUnit,
          onInput: (v) => { s1.dom = v; drawCalc(); }
        });
      }

      function drawCalc() {
        pEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s1.preset));
        const pr = PARITY_PRESETS[s1.preset];
        const par = E.fxParity(s1.world, s1.fx, pr.div);
        const sp = s1.dom - par;
        const pct = (sp / par) * 100;
        el.querySelector('#res1').innerHTML =
          '<div class="kpis">' +
            '<div class="kpi"><div class="v">' + f(par, 2) + '</div><div class="l">паритет, ' + pr.dUnit + '</div><div class="e">' + pr.divHint + '</div></div>' +
            '<div class="kpi"><div class="v">' + col(sp, 2) + '</div><div class="l">спред, ' + pr.dUnit + '</div><div class="e">внутренняя − паритет</div></div>' +
            '<div class="kpi"><div class="v">' + col(pct, 2) + '%</div><div class="l">премия / дисконт</div><div class="e">' + (sp > 0 ? 'внутренняя дороже мира' : sp < 0 ? 'внутренняя дешевле мира' : 'точный паритет') + '</div></div>' +
          '</div>';
      }

      pEl.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        s1.preset = +b.dataset.i;
        Object.assign(s1, PARITY_PRESETS[s1.preset]);
        rebuildSliders();
        drawCalc();
      });
      rebuildSliders();
      drawCalc();
    }
  });

  /* ---------- 2. Третья нога: зачем нужен валютный фьючерс ---------- */
  const s2 = { dir: -1, dWorld: 0, dFx: 15 };

  Z.push({
    id: 'fx-leg',
    title: 'Третья нога: зачем нужен валютный фьючерс',
    lead: 'Главная загадка межбиржевого спреда: при покупке зарубежного фьючерса мы не платим полную стоимость товара в долларах — зачем же тогда хеджировать валютный курс на весь полный объём сделки?',
    text: () => `
      <h3>Разгадка ${T('quanto_trap', 'иллюзии «в фьючерсе нет полной суммы»')}</h3>
      <p>Частый вопрос новичка звучит очень логично: <i>«На зарубежной бирже у меня лежит лишь скромный залог, а долларовая прибыль или убыток — это маленькая разница цен. Зачем же покупать ${T('fx_leg', 'валютный фьючерс')} на всю полную стоимость контракта?»</i></p>
      <p>Проверим на самом простом примере. Пусть мировой актив стоит <b>100 $</b>, курс — <b>90 ₽/$</b> (паритет = 9 000 ₽, или 90 п.), а внутренний рублёвый фьючерс торгуется с премией по <b>95 п. (9 500 ₽)</b>. Мы встаём в шорт спреда: продаём дорогой внутренний контракт и покупаем мировой долларовый.</p>
      <p>Допустим, к выходу мировая цена в долларах вообще не шелохнулась (<code>100 $ → 100 $</code>), премия честно сжалась с 5 до 1 пункта, но <b>курс доллара вырос с 90 до 105 ₽/$</b>:</p>
      <ul>
        <li><b>Зарубежная нога ($):</b> цена была 100 $ и осталась 100 $. Вариационная маржа равна <b>0 $ = 0 ₽</b>! Она никак не компенсировала скачок курса.</li>
        <li><b>Внутренняя нога (₽):</b> курс сидит прямо внутри рублёвой цены (<code>100 $ × 105 ₽/$ + 100 ₽ = 10 600 ₽</code>, или 106 п.). Проданный по 95 п. рублёвый фьючерс ушёл на 106 п. и принёс <b>убыток −11 п. (−1 100 ₽)</b> вместо ожидаемой прибыли +4 п.!</li>
        <li><b>Третья нога — фьючерс на доллар:</b> покупка валютного фьючерса на номинал <b>100 $</b> при росте курса с 90 до 105 ₽/$ даёт ровно <code>+100 × (105 − 90) = +1 500 ₽ (+15 п.)</code>. Складываем: <code>−11 + 0 + 15 = +4 п.</code> — ровно сужение спреда с 5 до 1 пункта!</li>
      </ul>
      <h3>Геометрия прямоугольника «Цена_$ × Курс»</h3>
      <p>Стоимость актива в рублях — это площадь прямоугольника со сторонами <code>Цена_$</code> и <code>Курс</code>. Когда меняются обе стороны, прирост площади распадается на части:</p>
      <span class="formula">Δ(Цена_$ × Курс) = ΔЦена_$ · Курс<sub>0</sub> + Цена_$<sub>0</sub> · ΔКурс + ΔЦена_$ · ΔКурс<small>зарубежная нога в $ (переведённая по новому курсу) гасит первую и третью части, а валютный фьючерс гасит вторую!</small></span>
      <div class="note warn"><b>Правило знака третьей ноги.</b> Валютная нога всегда смотрит в ту же сторону по валюте, что и зарубежная нога: если на внешней бирже вы <b>купили</b> долларовый актив (и продали рублёвый внутри), то фьючерс на доллар к рублю тоже нужно <b>купить</b>; если внешний актив продан — валютный фьючерс продаётся.</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Прямоугольник паритета: подвигайте мировую цену и курс рубля</h4>
          <div class="btns" id="dir2" style="margin:0 0 10px">
            <button class="b" data-d="-1">Шорт спреда (продали внутр. ₽, купили мир $ + купили FX)</button>
            <button class="b" data-d="1">Лонг спреда (купили внутр. ₽, продали мир $ + продали FX)</button>
          </div>
          <div id="sl2a"></div>
          <div id="sl2b"></div>
          <div id="svg2" style="margin-top:12px"></div>
          <table class="t" id="tab2" style="margin-top:10px"></table>
          <div id="note2" class="note" style="margin-top:10px"></div>
        </div>`;

      const dirEl = el.querySelector('#dir2');
      dirEl.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (b) { s2.dir = +b.dataset.d; draw2(); }
      });
      HV.slider(el.querySelector('#sl2a'), {
        label: 'Изменение мировой цены актива (ΔЦена_$ от 100 $)', min: -25, max: 25, step: 1, value: s2.dWorld,
        fmt: (v) => U.sgn(v, 0) + ' $ (стало ' + (100 + v) + ' $)',
        onInput: (v) => { s2.dWorld = v; draw2(); }
      });
      HV.slider(el.querySelector('#sl2b'), {
        label: 'Изменение курса рубля (ΔКурс от 90 ₽/$)', min: -20, max: 30, step: 1, value: s2.dFx,
        fmt: (v) => U.sgn(v, 0) + ' ₽/$ (стало ' + (90 + v) + ' ₽/$)',
        onInput: (v) => { s2.dFx = v; draw2(); }
      });

      function draw2() {
        dirEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.d === s2.dir));
        const w0 = 100, fx0 = 90, w1 = w0 + s2.dWorld, fx1 = fx0 + s2.dFx;
        const spIn = s2.dir === -1 ? 5 : -5;
        const spOut = s2.dir === -1 ? 1 : -1;
        const par0 = (w0 * fx0) / 100, par1 = (w1 * fx1) / 100;
        const dom0 = par0 + spIn, dom1 = par1 + spOut;

        const pnlDom = s2.dir * (dom1 - dom0);
        const pnlWorldRub = (-s2.dir * (w1 - w0) * fx1) / 100;
        const pnlFxRub = (-s2.dir * w0 * (fx1 - fx0)) / 100;
        const crossOnly = (-s2.dir * (w1 - w0) * (fx1 - fx0)) / 100;
        const twoLegs = pnlDom + pnlWorldRub;
        const threeLegs = twoLegs + pnlFxRub;

        // SVG прямоугольника паритета
        const W = 560, H = 205, ox = 72, oy = 22;
        const sx = 3.1, sy = 1.25;
        const bw0 = w0 * sx, bh0 = fx0 * sy;
        const bw1 = w1 * sx, bh1 = fx1 * sy;
        const pPrice = (s2.dWorld * fx0) / 100;
        const pRate = (w0 * s2.dFx) / 100;
        const pCross = (s2.dWorld * s2.dFx) / 100;

        el.querySelector('#svg2').innerHTML = `
          <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;background:#10151f;border:1px solid #262e3f;border-radius:10px;display:block">
            <rect x="${ox}" y="${oy}" width="${bw0}" height="${bh0}" fill="#1d2638" stroke="#5aa9ff" stroke-width="1.5"/>
            <rect x="${ox}" y="${oy}" width="${bw1}" height="${bh1}" fill="none" stroke="#ffd166" stroke-width="2" stroke-dasharray="6,4"/>
            ${s2.dWorld !== 0 ? `<rect x="${s2.dWorld > 0 ? ox + bw0 : ox + bw1}" y="${oy}" width="${Math.abs(bw1 - bw0)}" height="${Math.min(bh0, bh1)}" fill="#5aa9ff44"/>` : ''}
            ${s2.dFx !== 0 ? `<rect x="${ox}" y="${s2.dFx > 0 ? oy + bh0 : oy + bh1}" width="${Math.min(bw0, bw1)}" height="${Math.abs(bh1 - bh0)}" fill="#f5a65b55"/>` : ''}
            ${s2.dWorld !== 0 && s2.dFx !== 0 ? `<rect x="${s2.dWorld > 0 ? ox + bw0 : ox + bw1}" y="${s2.dFx > 0 ? oy + bh0 : oy + bh1}" width="${Math.abs(bw1 - bw0)}" height="${Math.abs(bh1 - bh0)}" fill="#c9b6ff66"/>` : ''}
            <text x="${ox + 10}" y="${oy + 22}" fill="#e4e9f2" font-size="12.5" font-weight="600">База: 100 $ × 90 ₽/$ = 90,0 п.</text>
            <text x="${ox + 10}" y="${oy + 42}" fill="#5aa9ff" font-size="12">Синяя полоса (ΔЦена·Курс₀): ${U.sgn(pPrice, 2)} п.</text>
            <text x="${ox + 10}" y="${oy + 60}" fill="#f5a65b" font-size="12">Оранжевая полоса (Цена₀·ΔКурс): ${U.sgn(pRate, 2)} п. — голый FX-риск без 3-й ноги!</text>
            <text x="${ox + 10}" y="${oy + 78}" fill="#c9b6ff" font-size="12">Уголок (ΔЦена·ΔКурс): ${U.sgn(pCross, 2)} п.</text>
            <text x="${ox}" y="${H - 8}" fill="#98a3b6" font-size="11.5">Ширина = цена в $ (${w0} → ${w1} $) · Высота = курс (${fx0} → ${fx1} ₽/$) · Жёлтый пунктир = новый паритет ${f(par1, 2)} п.</text>
          </svg>`;

        el.querySelector('#tab2').innerHTML =
          '<tr><th>Нога сделки</th><th>Вход → Выход</th><th>Результат, п. (по 100 ₽)</th></tr>' +
          '<tr><td>1. Внутренняя нога (₽)</td><td>' + f(dom0) + ' → ' + f(dom1) + ' п.</td><td>' + col(pnlDom) + '</td></tr>' +
          '<tr><td>2. Зарубежная нога ($ → ₽ по ' + fx1 + ' ₽/$)</td><td>' + w0 + ' → ' + w1 + ' $ ' + (crossOnly !== 0 ? '<span style="color:#98a3b6">(вкл. уголок ' + U.sgn(crossOnly) + ')</span>' : '') + '</td><td>' + col(pnlWorldRub) + '</td></tr>' +
          '<tr><td style="color:' + BAD + '"><b>Итого 2 ноги БЕЗ валютного хеджа</b></td><td>спред сжался на +4,00 п., но курс вмешался</td><td><b>' + col(twoLegs) + '</b></td></tr>' +
          '<tr><td style="color:' + SIM + '">3. Валютный фьючерс (номинал ' + w0 + ' $)</td><td>' + fx0 + ' → ' + fx1 + ' ₽/$</td><td>' + col(pnlFxRub) + '</td></tr>' +
          '<tr><td style="color:' + ME + '"><b>Итого честные 3 ноги С валютным хеджем</b></td><td>ровно чистое схождение спреда (+4,00 п.)</td><td><b>' + col(threeLegs) + '</b></td></tr>';

        const nEl = el.querySelector('#note2');
        if (s2.dFx === 0) {
          nEl.className = 'note';
          nEl.innerHTML = 'Пока курс замер на месте (<code>ΔКурс = 0</code>), оранжевая полоса равна нулю, и две ноги случайно совпадают с тремя. Именно это усыпляет бдительность в штиль!';
        } else {
          nEl.className = twoLegs < 0 ? 'note bad' : 'note warn';
          nEl.innerHTML = 'Спред сработал в нашу пользу на <b>+4,00 п.</b>, но без третьей ноги счёт получил <b>' + U.sgn(twoLegs) + ' п.</b> из-за сдвига курса на ' + U.sgn(s2.dFx, 0) + ' ₽/$. Третья валютная нога дала ровно <b>' + U.sgn(pnlFxRub) + ' п.</b> и вернула чистый результат <b>+4,00 п.</b>';
        }
      }
      draw2();
    }
  });

  /* ---------- 3. Ручной расчёт сделки в трёх ногах и округление лота FX ---------- */
  const CASES3 = [
    { name: 'Курс взлетел (+15 ₽/$), мировая цена стоит', dir: -1, wIn: 100, wOut: 100, fxIn: 90, fxOut: 105, spIn: 5.5, spOut: 1.0, units: 26 },
    { name: 'Мировая цена упала (−12 $), курс спокойный', dir: -1, wIn: 100, wOut: 88, fxIn: 90, fxOut: 91, spIn: 5.0, spOut: 1.2, units: 26 },
    { name: 'Лонг спреда при укреплении рубля (−12 ₽/$)', dir: 1, wIn: 100, wOut: 106, fxIn: 95, fxOut: 83, spIn: -5.2, spOut: -0.8, units: 26 }
  ];
  const s3 = { idx: 0, units: 26, cost: 0.7 };

  Z.push({
    id: 'manual-3leg',
    title: 'Ручной расчёт сделки в трёх ногах',
    lead: 'Разберём по косточкам, как считаются деньги на всех трёх счетах от открытия до закрытия — и откуда берётся маленький остаток при округлении валютного фьючерса до целых лотов.',
    text: () => `
      <h3>Пять шагов в каждом трейде</h3>
      <ol>
        <li><b>Сверяем паритет на входе.</b> Переводим мировую цену в пункты внутренней биржи и фиксируем начальный спред <code>Внутр<sub>вх</sub> − Паритет<sub>вх</sub></code>.</li>
        <li><b>Подбираем объём третьей ноги.</b> Если открыта позиция на <code>V</code> долларов внешнего актива, а стандартный валютный фьючерс равен <code>1 000 $</code>, нужно взять <code>V ÷ 1 000</code> валютных контрактов (округляя до ближайшего целого числа).</li>
        <li><b>Считаем три отдельные ${T('var_margin', 'вариационные маржи')}.</b> Внутренняя нога сразу в рублях; зарубежная — сначала в долларах, а затем переводится по курсу выхода; валютная нога — разница курсов, умноженная на число лотов FX.</li>
        <li><b>Проверяем ${T('cross_term', 'перекрёстную добавку')} и остаток округления.</b> Если число лотов FX округлялось (например, на 2 600 $ взяли 3 лота по 1 000 $), лишние 400 $ дают крошечную остаточную чувствительность к курсу.</li>
        <li><b>Вычитаем тройные издержки.</b> Вместо двух стаканов мы входим и выходим в трёх — комиссия и проскальзывание выше примерно в 1,3–1,5 раза.</li>
      </ol>
      <div class="note"><b>Практический совет.</b> Чем крупнее рабочий объём пакета (например, 10 000 $ вместо 2 600 $), тем точнее делится сумма на стандартный лот 1 000 $ и тем меньше погрешность округления валютного хеджа.</div>`,
    mount(el) {
      el.innerHTML = `
        <div class="viz">
          <h4>Выберите живую ситуацию и размер позиции</h4>
          <div class="btns" id="c3b" style="margin:0 0 10px"></div>
          <div id="sl3u"></div>
          <div id="sl3c"></div>
        </div>
        <div class="viz">
          <h4>Пошаговая ведомость по трём ногам (на весь пакет контрактов)</h4>
          <div class="calc-steps" id="steps3"></div>
        </div>`;

      const bEl = el.querySelector('#c3b');
      bEl.innerHTML = CASES3.map((c, i) => '<button class="b" data-i="' + i + '">' + c.name + '</button>').join('');
      bEl.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (b) { s3.idx = +b.dataset.i; draw3(); }
      });
      HV.slider(el.querySelector('#sl3u'), {
        label: 'Размер позиции (контрактов по ~100 $)', min: 5, max: 50, step: 1, value: s3.units,
        fmt: (v) => v + ' контр. (~' + (v * 100).toLocaleString('ru-RU') + ' $)',
        hint: 'Стандартный валютный фьючерс кратен 1 000 $ (10 наших товарных контрактов).',
        onInput: (v) => { s3.units = v; draw3(); }
      });
      HV.slider(el.querySelector('#sl3c'), {
        label: 'Суммарные издержки круга по 3 ногам (на 1 контр.)', min: 0, max: 2, step: 0.1, value: s3.cost,
        fmt: (v) => f(v, 2) + ' п. (' + Math.round(v * 100) + ' ₽)',
        onInput: (v) => { s3.cost = v; draw3(); }
      });

      function draw3() {
        bEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s3.idx));
        const c = CASES3[s3.idx];
        const q = s3.units;
        const parIn = (c.wIn * c.fxIn) / 100, parOut = (c.wOut * c.fxOut) / 100;
        const domIn = parIn + c.spIn, domOut = parOut + c.spOut;

        const usdNotional = q * c.wIn;
        const exactFxLots = usdNotional / 1000;
        const intFxLots = Math.max(1, Math.round(exactFxLots));
        const hedgedUsd = intFxLots * 1000;

        const rubDom = q * c.dir * (domOut - domIn) * 100;
        const usdWorld = q * (-c.dir) * (c.wOut - c.wIn);
        const rubWorld = usdWorld * c.fxOut;
        const rubFxExact = (-c.dir) * usdNotional * (c.fxOut - c.fxIn);
        const rubFxInt = (-c.dir) * hedgedUsd * (c.fxOut - c.fxIn);
        const feeRub = q * s3.cost * 100;

        const netNoFx = rubDom + rubWorld - feeRub * 0.74;
        const netExact = rubDom + rubWorld + rubFxExact - feeRub;
        const netInt = rubDom + rubWorld + rubFxInt - feeRub;
        const roundErr = rubFxInt - rubFxExact;

        const rub = (v) => '<span class="' + (v >= 0 ? 'pos' : 'neg') + '">' + U.sgn(v, 0) + ' ₽</span>';
        el.querySelector('#steps3').innerHTML = `
          <div class="row"><div class="n">1</div><div><b>Вход в ${c.dir === -1 ? 'шорт' : 'лонг'} спреда (${q} контр.)</b> — мировая цена ${c.wIn} $, курс ${c.fxIn} ₽/$, паритет ${f(parIn)} п., внутренняя ${f(domIn)} п. (спред ${U.sgn(c.spIn)} п.)<div class="v">Валютный номинал пакета: ${q} × ${c.wIn} $ = ${usdNotional.toLocaleString('ru-RU')} $ → точный FX-хедж ${f(exactFxLots, 2)} лота, берём целых <b>${intFxLots} лота</b> (${hedgedUsd.toLocaleString('ru-RU')} $)</div></div></div>
          <div class="row"><div class="n">2</div><div><b>Нога 1 — внутренняя площадка (в рублях)</b>: цена ${f(domIn)} → ${f(domOut)} п. (спред на выходе ${U.sgn(c.spOut)} п.)<div class="v">${q} × (${c.dir > 0 ? '+1' : '−1'}) × (${f(domOut)} − ${f(domIn)}) × 100 ₽ = ${rub(rubDom)}</div></div></div>
          <div class="row"><div class="n">3</div><div><b>Нога 2 — внешняя площадка (в $ с переводом по курсу выхода ${c.fxOut} ₽/$)</b>: цена ${c.wIn} → ${c.wOut} $<div class="v">${U.sgn(usdWorld, 0)} $ × ${c.fxOut} ₽/$ = ${rub(rubWorld)}</div></div></div>
          <div class="row"><div class="n">4</div><div><b>Нога 3 — валютный фьючерс (${intFxLots} лота по 1 000 $)</b>: курс ${c.fxIn} → ${c.fxOut} ₽/$<div class="v">(${c.dir > 0 ? '−1' : '+1'}) × ${hedgedUsd.toLocaleString('ru-RU')} $ × (${c.fxOut} − ${c.fxIn}) = ${rub(rubFxInt)} (погрешность округления лота: ${rub(roundErr)})</div></div></div>
          <div class="row"><div class="n">5</div><div><b>Чистый итог после издержек (${Math.round(feeRub).toLocaleString('ru-RU')} ₽)</b><div class="v">С валютным хеджем (целые лоты): <b>${rub(netInt)}</b> · идеальный дробный хедж: ${rub(netExact)} · если бы забыли 3-ю ногу: ${rub(netNoFx)}</div></div></div>`;
      }
      draw3();
    }
  });

  /* ---------- 4. Разные часы торгов и ложные сигналы на закрытии ---------- */
  const s4 = { hour: 22.5, shock: 6.5 };

  Z.push({
    id: 'desync-hours',
    title: 'Разные часы торгов и «миражи» дневного закрытия',
    lead: 'Биржи в разных часовых поясах открываются и закрываются не одновременно. Если скормить формуле обычную таблицу «цен закрытия дня», стратегия начнёт торговать тени вчерашних новостей.',
    text: () => `
      <h3>Откуда берутся фантомные выбросы</h3>
      <p>Представьте обычный рабочий день двух площадок:</p>
      <ul>
        <li>В <b>18:30</b> закрывается дневной фиксинг внешней площадки (или наоборот — заканчиваются основные торги на внутреннем рынке), и в таблицу дневных итогов записывается цена <code>100,0 $</code>.</li>
        <li>В <b>20:30</b> выходит важная мировая статистика: актив подскакивает на <code>+6,5 $</code>. На внутренней вечерней сессии (которая идёт до <b>23:50</b>) участники мгновенно переставляют котировки вверх на <code>+5,8 п.</code>!</li>
        <li>Вечером робот скачивает «цены закрытия за сегодня»: внутренняя котировка взята за <b>23:50</b> (уже с новостью), а внешняя осталась ${T('stale_quote', '«уснувшей» котировкой')} за <b>18:30</b> (до новости)!</li>
      </ul>
      <p>Формула видит кажущийся взрыв спреда на +6 пунктов (<code>z = +2,8</code>) и сигналит: <i>«Срочно продавай внутренний рынок и покупай внешний!»</i> Но на самом деле никакого расхождения нет — утром внешняя биржа откроется ровно там же, а вы просто заплатите тройную комиссию за вход в пустоту.</p>
      <h3>Золотое правило: ${T('sync_slice', 'синхронный срез котировок')}</h3>
      <p>И для расчёта истории в окне <code>N</code>, и для живого сигнала все три цены — внутренний контракт, внешний контракт и валютный курс — снимаются <b>строго в одну и ту же минуту внутри общих рабочих часов</b>, когда живая ликвидность есть во всех трёх стаканах.</p>`,
    mount(el) {
      const fxDes = E.genFxScenario(7, E.FX_SCENARIOS[2]);
      el.innerHTML = `
        <div class="viz">
          <h4>Шкала суток: передвиньте часы до и после закрытия одной из площадок</h4>
          <div id="sl4h"></div>
          <div id="sl4s"></div>
          <div id="svg4" style="margin-top:10px"></div>
          <div id="note4" class="note" style="margin-top:10px"></div>
        </div>
        <div class="viz">
          <h4>Живой ряд: несинхронные «закрытия дня» против синхронного среза (17:00)</h4>
          <div class="legend">
            <span><i style="background:${SIM}"></i>по таблице закрытий дня (с миражами)</span>
            <span><i style="background:${ME}"></i>строго синхронный срез</span>
            <span><i class="dot" style="background:${BAD}"></i>вечерняя новость после 18:30</span>
          </div>
          <div id="c4"></div>
        </div>`;

      HV.slider(el.querySelector('#sl4h'), {
        label: 'Момент снятия котировок (часы суток)', min: 11, max: 23.5, step: 0.5, value: s4.hour,
        fmt: (v) => {
          const h = Math.floor(v), m = v % 1 ? '30' : '00';
          return h + ':' + m + (v <= 18.5 ? ' (обе биржи открыты)' : ' (первая биржа уже закрыта!)');
        },
        onInput: (v) => { s4.hour = v; draw4(); }
      });
      HV.slider(el.querySelector('#sl4s'), {
        label: 'Вечерняя новость в 20:00 (движение актива, $)', min: -10, max: 10, step: 0.5, value: s4.shock,
        fmt: (v) => U.sgn(v, 1) + ' $',
        onInput: (v) => { s4.shock = v; draw4(); }
      });

      const staleMarks = [];
      fxDes.isStale.forEach((st, i) => { if (st) staleMarks.push({ i, y: fxDes.obsSpread[i], kind: 'dot', color: BAD, size: 4.5 }); });
      const c4 = A.mkChart(el.querySelector('#c4'), 190, {
        tip: (i) => '<b>День ' + (i + 1) + '</b>' + (fxDes.isStale[i] ? ' · <span style="color:' + BAD + '">вечерний скачок после закрытия!</span>' : '') +
          '<br>несинхронное закрытие: <b style="color:' + SIM + '">' + U.sgn(fxDes.obsSpread[i]) + ' п.</b>' +
          '<br>синхронный срез: <b style="color:' + ME + '">' + U.sgn(fxDes.syncSpread[i]) + ' п.</b>'
      });
      c4.render({
        n: fxDes.pDom.length, x0: 0, x1: 140,
        markers: staleMarks,
        series: [
          { data: fxDes.obsSpread, color: SIM, width: 1.35 },
          { data: fxDes.syncSpread, color: ME, width: 2.0 }
        ]
      });

      function draw4() {
        const W = 560, H = 126, xOf = (h) => 34 + ((h - 10) / 14) * (W - 56);
        const curX = xOf(s4.hour), closeX = xOf(18.5), newsX = xOf(20.0);
        const afterClose = s4.hour > 18.5;
        const afterNews = s4.hour >= 20.0;
        const trueW = 100 + (afterNews ? s4.shock : 0);
        const obsW = 100; // фиксинг в 18:30 не двигается после 18:30
        const fx = 90;
        const dom = (trueW * fx) / 100 + 1.5;
        const trueSp = 1.5;
        const obsSp = dom - ((afterClose ? obsW : trueW) * fx) / 100;

        el.querySelector('#svg4').innerHTML = `
          <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;background:#10151f;border:1px solid #262e3f;border-radius:10px;display:block">
            <rect x="${xOf(11)}" y="18" width="${closeX - xOf(11)}" height="18" rx="4" fill="#35d07f26" stroke="#35d07f66"/>
            <text x="${xOf(11) + 6}" y="31" fill="#7ee0b5" font-size="11.5">Общее окно всех 3 рынков (11:00–18:30) — честный синхронный срез</text>
            <rect x="${xOf(10)}" y="46" width="${xOf(23.8) - xOf(10)}" height="18" rx="4" fill="#5aa9ff33"/>
            <text x="${xOf(10) + 6}" y="59" fill="#cdd7e8" font-size="11.5">Внутренняя площадка с вечерней сессией (10:00–23:50)</text>
            <rect x="${xOf(11)}" y="72" width="${closeX - xOf(11)}" height="18" rx="4" fill="#f5a65b44"/>
            <text x="${xOf(11) + 6}" y="85" fill="#ffd166" font-size="11.5">Дневной фиксинг внешней площадки (замирает в 18:30)</text>
            <line x1="${newsX}" y1="12" x2="${newsX}" y2="100" stroke="${BAD}" stroke-dasharray="4,3"/>
            <text x="${newsX + 4}" y="108" fill="${BAD}" font-size="11">20:00 новость (${U.sgn(s4.shock, 1)} $)</text>
            <line x1="${curX}" y1="10" x2="${curX}" y2="104" stroke="#ffffff" stroke-width="2"/>
            <circle cx="${curX}" cy="55" r="4" fill="#ffffff"/>
          </svg>`;

        const nEl = el.querySelector('#note4');
        if (!afterNews || s4.shock === 0) {
          nEl.className = 'note';
          nEl.innerHTML = 'В выбранный момент расхождения нет: истинный спред <b>+1,50 п.</b>, видимый по последним котировкам <b>' + U.sgn(obsSp) + ' п.</b>';
        } else {
          nEl.className = 'note bad';
          nEl.innerHTML = '<b>Ловушка сработала!</b> После новости в 20:00 внутренняя сессия уже стоит <b>' + f(dom) + ' п.</b>, а внешняя котировка застыла на отметке 18:30 (100 $ = 90 п.). В таблице виден ложный спред <b>' + U.sgn(obsSp) + ' п.</b> вместо реальных <b>+' + f(trueSp) + ' п.</b>!';
        }
      }
      draw4();
    }
  });
})();
