/* Визуализации для динамического хеджа: диаграмма рассеяния («облако точек») с прямой и остатками,
   а также небольшой помощник для ползунков. Только canvas, без зависимостей. */
(function () {
  'use strict';
  const U = window.UI, C = U.COLORS;

  function niceTicks(lo, hi, count) {
    const span = hi - lo || 1, raw = span / count, mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag, out = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(Math.abs(t) < step / 1e6 ? 0 : t);
    out.step = step;
    return out;
  }

  /* Диаграмма рассеяния. Каждая точка — один день: по горизонтали цена B, по вертикали цена A.
     render({ points: [{x, y, label, hot}], lines: [{k, alpha, color, dash, width}], residualsOf: {k, alpha, color}, xLabel, yLabel }) */
  function Scatter(canvas, opts) {
    this.c = canvas;
    this.o = Object.assign({ height: 320, left: 62, right: 16, top: 14, bottom: 40 }, opts || {});
    this.m = null; this.hover = null;
    const box = canvas.parentElement;
    this.tipEl = document.createElement('div'); this.tipEl.className = 'tip'; this.tipEl.hidden = true; box.appendChild(this.tipEl);
    canvas.addEventListener('mousemove', (e) => this.onMove(e));
    canvas.addEventListener('mouseleave', () => { this.hover = null; this.tipEl.hidden = true; this.draw(); });
    if (U.registerChart) U.registerChart(this);
  }

  Scatter.prototype.onMove = function (e) {
    const m = this.m;
    if (!m || !this.px) return;
    const r = this.c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 18 * 18;
    m.points.forEach((p, i) => { const dx = this.px(p.x) - x, dy = this.py(p.y) - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } });
    this.hover = best;
    this.draw();
    if (best === null || !this.o.tip) { this.tipEl.hidden = true; return; }
    this.tipEl.innerHTML = this.o.tip(m.points[best], best);
    this.tipEl.hidden = false;
    const px = this.px(m.points[best].x), w = this.c.clientWidth;
    this.tipEl.style.left = (px > w / 2 ? px - this.tipEl.offsetWidth - 14 : px + 14) + 'px';
    this.tipEl.style.top = '8px';
  };

  Scatter.prototype.render = function (m) { this.m = Object.assign({ points: [], lines: [] }, m); this.draw(); };

  Scatter.prototype.draw = function () {
    const m = this.m, o = this.o, c = this.c;
    if (!m) return;
    const dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = o.height;
    if (!W) return;
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.height = H + 'px';
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const pw = W - o.left - o.right, ph = H - o.top - o.bottom;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    m.points.forEach((p) => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); });
    if (!Number.isFinite(x0)) { x0 = 0; x1 = 1; y0 = 0; y1 = 1; }
    const xp = (x1 - x0 || 1) * 0.08;
    x0 -= xp; x1 += xp;
    // прямые тоже должны помещаться на график, но не растягивать его чрезмерно
    (m.lines || []).forEach((l) => { [x0, x1].forEach((x) => { const y = l.alpha + l.k * x; if (y > y1) y1 = Math.min(y, y1 + (y1 - y0)); if (y < y0) y0 = Math.max(y, y0 - (y1 - y0)); }); });
    const yp = (y1 - y0 || 1) * 0.08;
    y0 -= yp; y1 += yp;
    const px = (x) => o.left + ((x - x0) / (x1 - x0)) * pw, py = (y) => o.top + (1 - (y - y0) / (y1 - y0)) * ph;
    this.px = px; this.py = py;

    g.font = C.font || '11px "Segoe UI", Roboto, sans-serif';
    g.textBaseline = 'middle';
    g.strokeStyle = C.grid; g.fillStyle = C.axis; g.lineWidth = 1;
    g.textAlign = 'right';
    niceTicks(y0, y1, 5).forEach((t) => { const y = Math.round(py(t)) + 0.5; g.beginPath(); g.moveTo(o.left, y); g.lineTo(W - o.right, y); g.stroke(); g.fillText(U.fmt(t, 0), o.left - 8, y); });
    g.textAlign = 'center';
    niceTicks(x0, x1, 7).forEach((t) => { const x = Math.round(px(t)) + 0.5; g.beginPath(); g.moveTo(x, o.top); g.lineTo(x, o.top + ph); g.stroke(); g.fillText(U.fmt(t, 0), x, H - o.bottom + 14); });
    if (m.xLabel) { g.fillStyle = C.text; g.fillText(m.xLabel, o.left + pw / 2, H - 8); }
    if (m.yLabel) { g.save(); g.translate(12, o.top + ph / 2); g.rotate(-Math.PI / 2); g.fillStyle = C.text; g.fillText(m.yLabel, 0, 0); g.restore(); }

    // отрезки-остатки: расстояние по вертикали от точки до прямой
    if (m.residualsOf) {
      const r = m.residualsOf;
      g.strokeStyle = r.color || '#ff6b6b99'; g.lineWidth = 1.5;
      m.points.forEach((p) => { g.beginPath(); g.moveTo(px(p.x), py(p.y)); g.lineTo(px(p.x), py(r.alpha + r.k * p.x)); g.stroke(); });
    }
    (m.lines || []).forEach((l) => {
      g.strokeStyle = l.color; g.lineWidth = l.width || 2; g.setLineDash(l.dash || []);
      g.beginPath(); g.moveTo(px(x0), py(l.alpha + l.k * x0)); g.lineTo(px(x1), py(l.alpha + l.k * x1)); g.stroke(); g.setLineDash([]);
    });
    m.points.forEach((p, i) => {
      g.fillStyle = p.hot ? C.exit : (m.pointColor || C.a);
      g.beginPath(); g.arc(px(p.x), py(p.y), p.hot ? 6 : (i === this.hover ? 6 : 4), 0, Math.PI * 2); g.fill();
      if (p.hot) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke(); }
    });
  };

  /* Ползунок с подписью. o: {label, min, max, step, value, fmt, hint, onInput}. Возвращает {set, get}. */
  function slider(root, o) {
    const el = document.createElement('div');
    el.className = 'ctl';
    el.innerHTML = '<label><span>' + o.label + '</span><b></b></label><input type="range"><div class="hint">' + (o.hint || '') + '</div>';
    const inp = el.querySelector('input'), out = el.querySelector('b');
    inp.min = o.min; inp.max = o.max; inp.step = o.step; inp.value = o.value;
    const show = () => { out.textContent = o.fmt ? o.fmt(parseFloat(inp.value)) : inp.value; };
    inp.addEventListener('input', () => { show(); o.onInput(parseFloat(inp.value)); });
    show();
    root.appendChild(el);
    return { set(v) { inp.value = v; show(); }, get() { return parseFloat(inp.value); }, el };
  }

  window.HV = { Scatter, slider, niceTicks };
})();
