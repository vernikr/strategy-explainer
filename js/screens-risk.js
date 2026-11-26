/* Экраны 9–11: риски и ловушки, вариации z-score, словарь. */
(function () {
  'use strict';
  const A = window.App, U = window.UI, T = A.T, E = window.Engine, S = window.SPECS;
  const C = U.COLORS;
  const Z = window.ZSCREENS;
  const SEEDS = [21, 7, 11, 3, 5, 13, 42];
  const NS = [10, 20, 30, 40, 50, 60, 80, 100, 120], ES = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3];
  const col = (x, d) => '<span class="' + (x >= 0 ? 'pos' : 'neg') + '">' + U.sgn(x, d === undefined ? 1 : d) + '</span>';

  /* --- демо А: связь порвалась --- */
  function demoBreak(box) {
    box.innerHTML = `
      <p>Стратегия ставит на возврат к среднему. А что будет, если на 200-й день связь между инструментами пропала и спред начал уходить в одну сторону? Слева — те же данные без поломки, справа — с поломкой. Попробуйте выключить стоп.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
        <div><h4>Связь сохраняется</h4><div id="a1"></div><div id="k1"></div></div>
        <div><h4>Связь порвалась на дне 200</h4><div id="a2"></div><div id="k2"></div></div>
      </div><div id="ctl"></div><div class="note warn" id="why"></div>`;
    const mk = (id) => A.mkChart(box.querySelector(id), 230, {});
    const c1 = mk('#a1'), c2 = mk('#a2');
    A.controls(box.querySelector('#ctl'), [S.entryZ, S.stopZ, S.stopOn], draw);
    function one(chart, kp, breakAt) {
      const d = E.generate({ seed: A.state.seed, breakAt });
      const b = E.backtest(d.spread, A.btParams());
      chart.render({ n: d.spread.length, series: [{ data: b.mean, color: C.mean, width: 1.4 }, { data: d.spread, color: C.spread }], spans: A.positionSpans(b), markers: A.tradeMarkers(b, (i) => d.spread[i]) });
      box.querySelector(kp).innerHTML = A.kpis(b);
      return b.metrics;
    }
    function draw() {
      const m1 = one(c1, '#k1', null), m2 = one(c2, '#k2', 200);
      box.querySelector('#why').innerHTML = 'Максимальная просадка выросла с <b>' + U.fmt(m1.maxDD, 1) + '</b> до <b>' + U.fmt(m2.maxDD, 1) + '</b> пунктов, итог изменился с ' + col(m1.total) + ' на ' + col(m2.total) + '. Стратегия не знает, что связь порвалась: для неё спред просто «слишком высокий, надо шортить». Единственная защита — стоп-лосс и ваше внимание.';
    }
    draw();
  }

  /* --- демо Б: издержки --- */
  function demoCosts(box) {
    box.innerHTML = `
      <p>Издержки платятся за каждую сделку независимо от исхода. Если стратегия зарабатывает по чуть-чуть на сделку, они могут съесть всё. Ниже — итог при разных издержках на одни и те же сделки.</p>
      <div id="ctl"></div><table class="t" id="tab" style="margin-top:12px"></table><div class="note warn" id="why"></div>`;
    A.controls(box.querySelector('#ctl'), [S.entryZ, S.exitZ, S.stopOn], draw);
    function draw() {
      const d = A.data();
      const base = A.backtest({ cost: 0 }).metrics;
      const costs = [0, 0.5, 1, 2, 3, 5];
      const mx = Math.max(1, base.total);
      box.querySelector('#tab').innerHTML = '<tr><th>Издержки на сделку, пунктов</th><th>Сделок</th><th>Итог, пунктов</th><th style="width:300px"></th></tr>' + costs.map((c) => {
        const m = A.backtest({ cost: c }, d.spread).metrics;
        const w = Math.max(0, Math.min(100, (m.total / mx) * 100));
        return '<tr><td>' + U.fmt(c, 1) + '</td><td>' + m.count + '</td><td>' + col(m.total) + '</td><td><div style="height:10px;border-radius:5px;background:' + (m.total >= 0 ? C.up : C.down) + ';width:' + (m.total >= 0 ? w : 8) + '%"></div></td></tr>';
      }).join('');
      const avg = base.count ? base.total / base.count : 0;
      box.querySelector('#why').innerHTML = 'Без издержек средняя сделка приносит <b>' + U.fmt(avg, 2) + '</b> пунктов. Значит, как только издержки на сделку превысят эту величину, стратегия уйдёт в минус. Меняйте порог входа и смотрите, как меняются число сделок и средняя прибыль.';
    }
    draw();
  }

  /* --- демо В: подгонка под прошлое --- */
  function walkForward(seed, base) {
    const s = E.generate({ seed }).spread;
    const split = Math.floor(s.length * 0.6);
    const grid = E.sweep(s.slice(0, split), base, NS, ES);
    let bi = 0, bj = 0, bv = -Infinity;
    grid.forEach((row, i) => row.forEach((v, j) => { if (v > bv) { bv = v; bi = i; bj = j; } }));
    const p = E.tune(base, NS[bi], ES[bj]);
    const test = E.backtest(s, p).trades.filter((t) => t.entryIdx >= split).reduce((a, t) => a + t.net, 0);
    return { seed, n: NS[bi], e: ES[bj], train: bv / split * 100, test: test / (s.length - split) * 100 };
  }

  function demoOverfit(box) {
    box.innerHTML = `
      <p>Самая коварная ловушка. Мы перебираем сотни сочетаний параметров и выбираем лучшее <b>на прошлом</b> — оно, конечно, выглядит блестяще. Но часть успеха — случайные совпадения. Честная проверка: подобрать параметры на первых 60% дней, а оценить на оставшихся 40%, которых стратегия не видела (см. ${T('in_sample', 'обучающая и проверочная часть')}).</p>
      <div id="ctl"></div><table class="t" id="tab" style="margin-top:12px"></table><div class="note warn" id="why"></div>`;
    A.controls(box.querySelector('#ctl'), [S.cost, S.stopOn, S.delayOn], draw);
    function draw() {
      const base = A.btParams();
      const rows = SEEDS.map((s) => walkForward(s, base));
      box.querySelector('#tab').innerHTML = '<tr><th>Набор данных</th><th>Лучшие параметры (окно / порог входа)</th><th>Обучающая часть, пунктов на 100 дней</th><th>Новые дни, пунктов на 100 дней</th></tr>' + rows.map((r, i) => '<tr><td>№ ' + (i + 1) + '</td><td>' + r.n + ' / ' + U.fmt(r.e) + '</td><td>' + col(r.train, 0) + '</td><td>' + col(r.test, 0) + '</td></tr>').join('');
      const worse = rows.filter((r) => r.test < r.train).length;
      const avgTr = rows.reduce((a, r) => a + r.train, 0) / rows.length, avgTe = rows.reduce((a, r) => a + r.test, 0) / rows.length;
      box.querySelector('#why').innerHTML = 'В <b>' + worse + ' из ' + rows.length + '</b> наборов результат на новых днях хуже, чем на тех, где подбирали параметры. В среднем: ' + col(avgTr, 0) + ' на обучении против ' + col(avgTe, 0) + ' на новых днях (на 100 дней). Итоги пересчитаны на 100 дней, чтобы части разной длины можно было сравнивать. Оценка «по прошлому» оптимистична. Заметьте, что на новых днях стратегия всё же зарабатывает, потому что в учебных данных возврат к среднему заложен специально; на реальном рынке такой гарантии нет.';
    }
    draw();
  }

  const DEMOS = [['Связь порвалась', demoBreak], ['Издержки', demoCosts], ['Подгонка под прошлое', demoOverfit]];

  const RISKS = [
    ['Связь порвалась (смена режима)', 'Спред может не вернуться: поменялись условия, и прежняя «резинка» больше не держит. Это главный риск стратегии. Защита — стоп и постоянный контроль.'],
    ['Издержки', 'Комиссии и проскальзывание платятся всегда. Чем чаще сделки и чем мельче прибыль на сделку, тем больше они значат.'],
    ['Подгонка под прошлое', 'Параметры, лучшие на истории, во многом подогнаны под случайности. Проверяйте на данных, которых при подборе не было.'],
    ['Заглядывание в будущее', 'Если расчёт хоть раз использует данные «из завтра», проверка выглядит чудесно и ничего не стоит. Здесь окно содержит только прошлое, а исполнение на следующий день ещё осторожнее.'],
    ['Ликвидность и проскальзывание', 'У редко торгуемых контрактов широкая разница между покупкой и продажей, а крупная заявка двигает цену. Реальная цена сделки хуже расчётной.'],
    ['Риск одной ноги', 'Две сделки спреда проходят не мгновенно. Если одна исполнилась, а вторая нет, вы временно торгуете направление рынка — а это ровно то, чего мы хотели избежать.'],
    ['Гарантийное обеспечение и маржин-колл', 'Пока позиция открыта, часть денег заморожена под залог. Если убыток растёт, брокер может потребовать пополнить счёт или закрыть позицию принудительно — часто в худший момент.'],
    ['Экспирация и перенос позиции', 'У фьючерса есть дата окончания. Позицию надо закрыть или перенести на следующий контракт, а у перенесённого спред может вести себя иначе.'],
    ['Толстые хвосты', 'Крайние отклонения случаются чаще, чем подсказывает «нормальная» картина. Событие «три сигмы» на практике не раз в тысячу дней.']
  ];

  Z.push({
    id: 'risks',
    title: 'Риски и ловушки',
    lead: 'Стратегия звучит логично, но на практике «арбитраж» здесь не безрисковый. Ниже — три главные ловушки, которые можно проверить вживую, и остальные риски списком.',
    full: true,
    mount(el) {
      el.innerHTML = `
        <div class="note bad"><b>Это учебный материал, а не инвестиционная рекомендация.</b> Данные — ${T('synthetic', 'учебные')}, расчёты упрощены. Торговля фьючерсами связана с риском потери средств.</div>
        <div class="viz" style="margin-top:18px"><div class="btns" id="tabs" style="margin:0 0 14px"></div><div id="demo"></div></div>
        <h3 style="margin:30px 0 14px">Все основные риски</h3>
        <div class="cards">${RISKS.map((r) => '<div class="card risk"><h4>' + r[0] + '</h4><p>' + r[1] + '</p></div>').join('')}</div>`;
      const tabs = el.querySelector('#tabs');
      tabs.innerHTML = DEMOS.map((d, i) => '<button class="b" data-i="' + i + '">' + d[0] + '</button>').join('');
      function open(i) {
        tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === i));
        DEMOS[i][1](el.querySelector('#demo'));
      }
      tabs.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) open(+b.dataset.i); });
      open(0);
    }
  });

  /* ---------- 10. Вариации ---------- */
  const VARIANTS = [
    ['Экспоненциальное среднее (EWMA)', 'Свежие дни весят больше старых вместо равноправного окна. Появляется параметр «скорость забывания».', 'Меньше «скачков», когда день выпадает из окна.', 'Ещё один параметр для подгонки.', 'ewma'],
    ['Робастный z-score', 'Среднее и σ заменяются на медиану и медианное отклонение (MAD).', 'Единичный выброс не «слепит» стратегию.', 'Сигналы на настоящих скачках приходят позже.', 'robust'],
    ['Динамический коэффициент хеджирования', 'Спред строится как A − k·B, где k регулярно пересчитывается по данным.', 'Лучше гасит общее движение рынка.', 'k может прыгать; контрактов — только целое число.', 'hedge'],
    ['Отбор пар по коинтеграции', 'Прежде чем торговать пару, проверяем статистически, что её спред действительно «привязан».', 'Меньше случайных «ложных» пар.', 'Тест — не гарантия: связь может пропасть позже.', 'coint'],
    ['Календарные спреды', 'Пара — ближний и дальний фьючерс одного актива.', 'Есть понятная экономика разницы цен.', 'Экспирация и перенос позиции добавляют сложности.', 'calendar'],
    ['Логарифм вместо разности', 'Вместо A − B берут ln(A) − ln(B): спред измеряется в процентах, а не в пунктах.', 'Удобно, если цены сильно меняются во времени.', 'Менее наглядно; в пунктах уже не посчитать.', null],
    ['Вход на «развороте»', 'Входим не когда z достиг порога, а когда после этого начал возвращаться.', 'Реже ловим «падающий нож».', 'Часть движения упускаем.', null],
    ['Вход и выход частями', 'Например, половина позиции на 2σ, вторая половина на 3σ.', 'Сглаживает ошибку момента входа.', 'Сложнее учёт, больше издержек.', null],
    ['Фильтр режима', 'Не торговать, если σ резко выросла или связь ослабла.', 'Защита от поломки связи.', 'Фильтр тоже можно подогнать, и он иногда прячет хорошие сделки.', null]
  ];

  Z.push({
    id: 'variants',
    title: 'Вариации стратегии',
    lead: 'Простой z-score — отправная точка. Почти каждая «улучшенная» версия меняет одну из его частей: как считается обычный уровень, как строится спред, когда входить. Здесь — карта вариаций; по ссылкам выше в переключателе стратегий будут их подробные разборы.',
    full: true,
    mount(el) {
      el.innerHTML = '<div class="cards">' + VARIANTS.map((v) => '<div class="card"><h4>' + v[0] + '</h4><p>' + v[1] + '</p><p><b>Что даёт:</b> ' + v[2] + '</p><p><b>Цена:</b> ' + v[3] + '</p>' + (v[4] ? '<a href="#' + v[4] + '" class="tag" style="color:#7ee0b5;text-decoration:none">есть вкладка в переключателе</a>' : '<span class="tag">в плане</span>') + '</p></div>').join('') + '</div>';
    }
  });

  /* ---------- 11. Словарь ---------- */
  Z.push({
    id: 'glossary',
    title: 'Словарь терминов',
    lead: 'Все слова, которые встречались в тексте, в одном месте. Можно искать по названию или по смыслу.',
    full: true,
    mount(el) {
      const items = Object.keys(window.GLOSSARY).map((k) => window.GLOSSARY[k]).sort((a, b) => a[0].localeCompare(b[0], 'ru'));
      el.innerHTML = '<input type="search" id="q" placeholder="Начните вводить слово…" style="width:420px;margin-bottom:16px;background:#10151f;border:1px solid #262e3f;border-radius:8px;color:#e4e9f2;padding:9px 12px;font:inherit"><div class="cards" id="list"></div>';
      function draw() {
        const q = el.querySelector('#q').value.trim().toLowerCase();
        el.querySelector('#list').innerHTML = items.filter((g) => !q || g[0].toLowerCase().includes(q) || g[1].toLowerCase().includes(q)).map((g) => '<div class="card"><h4>' + g[0] + '</h4><p>' + g[1] + '</p></div>').join('') || '<p style="color:#98a3b6">Ничего не найдено.</p>';
      }
      el.querySelector('#q').addEventListener('input', draw);
      draw();
    }
  });
})();
