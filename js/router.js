/* Навигация: переключатель стратегий, список экранов, подсказки терминов. Загружается последним. */
(function () {
  'use strict';
  const A = window.App;

  /* ---------- маршрутизация ---------- */
  let stratId = 'zscore', stepIdx = 0;
  const visited = {};
  const strategies = () => window.STRATEGIES;
  const screensOf = (id) => ({ zscore: window.ZSCREENS, ewma: window.EWSCREENS, robust: window.RBSCREENS, hedge: window.HSCREENS, coint: window.CSCREENS, calendar: window.CALSCREENS, tactics: window.TSCREENS, fx: window.FXSCREENS, baskets: window.BSCREENS, moex: window.MXSCREENS })[id] || [];

  function parseHash() {
    const m = location.hash.match(/^#([a-z0-9_-]+)(?:\/(\d+))?/);
    if (m && strategies().some((s) => s.id === m[1])) { stratId = m[1]; stepIdx = m[2] ? Math.max(0, +m[2] - 1) : 0; }
    const sc = screensOf(stratId);
    if (sc.length && stepIdx >= sc.length) stepIdx = 0;
  }

  function go(id, idx) { location.hash = '#' + id + (idx ? '/' + (idx + 1) : ''); }

  function render() {
    if (window.__stepTimer) { clearInterval(window.__stepTimer); window.__stepTimer = null; }
    const s = strategies().find((x) => x.id === stratId);
    const nav = document.getElementById('strategies');
    nav.innerHTML = strategies().map((x) => '<button data-s="' + x.id + '" class="' + (x.id === stratId ? 'on' : '') + '">' + x.name + (x.badge ? ' <span class="badge">' + x.badge + '</span>' : '') + '</button>').join('');
    nav.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => go(b.dataset.s, 0)));

    const steps = document.getElementById('steps');
    const root = document.getElementById('screen');
    if (!s.ready) { renderStub(s, steps, root); window.scrollTo(0, 0); return; }

    const sc = screensOf(s.id);
    const seen = (visited[s.id] = visited[s.id] || new Set());
    seen.add(stepIdx);
    steps.innerHTML = '<h4>' + s.name + ' · экраны</h4>' + sc.map((x, i) => '<button class="step ' + (i === stepIdx ? 'on' : seen.has(i) ? 'done' : '') + '" data-i="' + i + '"><span class="num">' + (i + 1) + '</span><span>' + x.title + '</span></button>').join('');
    steps.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => go(s.id, +b.dataset.i)));

    const cur = sc[stepIdx];
    const prev = sc[stepIdx - 1], next = sc[stepIdx + 1];
    const navHtml = '<div class="nav-bottom">' +
      (prev ? '<button class="b" id="prev">← ' + prev.title + '</button>' : '<span></span>') +
      (next ? '<button class="b primary" id="next">' + next.title + ' →</button>' : '<span></span>') + '</div>';
    if (cur.full) {
      root.innerHTML = '<h1>' + cur.title + '</h1><p class="lead">' + cur.lead + '</p><div id="full"></div>' + navHtml;
      cur.mount(document.getElementById('full'));
    } else {
      root.innerHTML = '<h1>' + cur.title + '</h1><p class="lead">' + cur.lead + '</p>' +
        '<div class="cols ' + (cur.wide ? 'wide-left' : '') + '"><div class="text">' + (typeof cur.text === 'function' ? cur.text() : cur.text) + '</div><div id="viz"></div></div>' + navHtml;
      cur.mount(document.getElementById('viz'));
    }
    const p = document.getElementById('prev'), n = document.getElementById('next');
    if (p) p.addEventListener('click', () => go(s.id, stepIdx - 1));
    if (n) n.addEventListener('click', () => go(s.id, stepIdx + 1));
    window.scrollTo(0, 0);
  }

  function renderStub(s, steps, root) {
    steps.innerHTML = '<h4>' + s.name + ' · план</h4>' + s.plan.map((t, i) => '<div class="step" style="cursor:default;opacity:.7"><span class="num">' + (i + 1) + '</span><span>' + t + '</span></div>').join('');
    root.innerHTML = '<h1>' + s.name + '</h1><p class="lead">' + s.lead + '</p>' +
      '<div class="stub"><div class="card"><h4>Статус</h4><p><span class="pill time">В разработке</span> Подробный разбор появится позже. Сейчас полностью объяснены: ' + strategies().filter((x) => x.ready).map((x) => x.name).join(', ') + '.</p></div>' +
      '<div class="card"><h4>Чем отличается от простого z-score</h4><p>' + s.diff + '</p></div>' +
      '<div class="card"><h4>Что будет объяснено</h4><p>' + s.plan.join(' · ') + '</p></div>' +
      '<button class="b primary" id="back">← Вернуться к разбору z-score</button></div>';
    document.getElementById('back').addEventListener('click', () => go('zscore', 0));
  }

  /* ---------- подсказки терминов ---------- */
  const tip = document.getElementById('glossary-tip');
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('.term');
    if (!el) { tip.hidden = true; return; }
    const g = window.GLOSSARY[el.dataset.t];
    if (!g) return;
    tip.innerHTML = '<b>' + g[0] + '</b>' + g[1];
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const left = Math.min(r.left, window.innerWidth - 380);
    tip.style.left = Math.max(8, left) + 'px';
    const below = r.bottom + 8;
    tip.style.top = (below + tip.offsetHeight > window.innerHeight ? Math.max(8, r.top - tip.offsetHeight - 8) : below) + 'px';
  });

  window.addEventListener('hashchange', () => { parseHash(); render(); });
  parseHash();
  render();
})();
