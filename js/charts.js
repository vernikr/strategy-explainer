/* Лёгкая отрисовка графиков на canvas и мелкие помощники форматирования. */
(function () {
  'use strict';

  const COLORS = {
    grid: '#232a38', axis: '#8b95a7', text: '#aeb8c8',
    a: '#5aa9ff', b: '#f5a65b', spread: '#7ee0b5', mean: '#c9b6ff', z: '#7ee0b5',
    up: '#35d07f', down: '#ff6b6b', exit: '#ffd166', neutral: '#8b95a7'
  };

  const MINUS = '−';
  function fmt(x, d) {
    if (x === null || x === undefined || Number.isNaN(x)) return '—';
    const s = Math.abs(x).toLocaleString('ru-RU', { minimumFractionDigits: d === undefined ? 2 : d, maximumFractionDigits: d === undefined ? 2 : d });
    return (x < 0 && Number(s.replace(/\s/g, '').replace(',', '.')) !== 0 ? MINUS : '') + s;
  }
  const sgn = (x, d) => (x > 0 ? '+' : '') + fmt(x, d);

  function Chart(canvas, opts) {
    this.c = canvas;
    this.o = Object.assign({ height: 260, left: 56, right: 14, top: 12, bottom: 26 }, opts || {});
    this.hover = null;
    this.m = null;
    const box = canvas.parentElement;
    this.tipEl = document.createElement('div');
    this.tipEl.className = 'tip';
    this.tipEl.hidden = true;
    box.appendChild(this.tipEl);
    canvas.addEventListener('mousemove', (e) => this.onMove(e));
    canvas.addEventListener('mouseleave', () => { this.hover = null; this.tipEl.hidden = true; this.draw(); });
    canvas.addEventListener('click', (e) => { const i = this.indexAt(e); if (i !== null && this.o.onClick) this.o.onClick(i); });
  }

  Chart.prototype.indexAt = function (e) {
    const m = this.m;
    if (!m) return null;
    const r = this.c.getBoundingClientRect();
    const x = e.clientX - r.left;
    const o = this.o;
    const pw = r.width - o.left - o.right;
    const f = (x - o.left) / pw;
    if (f < 0 || f > 1) return null;
    return Math.round(m.x0 + f * (m.x1 - m.x0));
  };

  Chart.prototype.onMove = function (e) {
    const i = this.indexAt(e);
    this.hover = i;
    this.draw();
    if (i === null || !this.o.tip) { this.tipEl.hidden = true; return; }
    const html = this.o.tip(i);
    if (!html) { this.tipEl.hidden = true; return; }
    this.tipEl.innerHTML = html;
    this.tipEl.hidden = false;
    const w = this.c.clientWidth;
    const px = this.xs(i);
    this.tipEl.style.left = (px > w / 2 ? px - this.tipEl.offsetWidth - 14 : px + 14) + 'px';
    this.tipEl.style.top = '8px';
  };

  Chart.prototype.render = function (m) {
    this.m = Object.assign({ x0: 0, x1: m.n - 1, series: [], hlines: [], bands: [], spans: [], markers: [] }, m);
    this.draw();
  };

  Chart.prototype.draw = function () {
    const m = this.m;
    if (!m) return;
    const o = this.o;
    const c = this.c;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = o.height;
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    c.style.height = H + 'px';
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const pw = W - o.left - o.right, ph = H - o.top - o.bottom;
    let lo = m.yMin, hi = m.yMax;
    if (lo === undefined || hi === undefined) {
      let mn = Infinity, mx = -Infinity;
      const take = (v) => { if (v !== null && v !== undefined && !Number.isNaN(v)) { if (v < mn) mn = v; if (v > mx) mx = v; } };
      m.series.forEach((s) => { for (let i = m.x0; i <= m.x1; i++) take(s.data[i]); });
      m.hlines.forEach((h) => take(h.y));
      m.markers.forEach((k) => take(k.y));
      if (!Number.isFinite(mn)) { mn = 0; mx = 1; }
      const pad = (mx - mn || 1) * 0.08;
      if (lo === undefined) lo = mn - pad;
      if (hi === undefined) hi = mx + pad;
    }
    this.xs = (i) => o.left + ((i - m.x0) / Math.max(1, m.x1 - m.x0)) * pw;
    const ys = (v) => o.top + (1 - (v - lo) / (hi - lo)) * ph;
    this.ys = ys;

    g.font = '11px "Segoe UI", Roboto, sans-serif';
    g.textBaseline = 'middle';

    // сетка и подписи оси Y
    const ticks = niceTicks(lo, hi, 5);
    g.strokeStyle = COLORS.grid; g.fillStyle = COLORS.axis; g.lineWidth = 1; g.textAlign = 'right';
    ticks.forEach((t) => {
      const y = Math.round(ys(t)) + 0.5;
      g.beginPath(); g.moveTo(o.left, y); g.lineTo(W - o.right, y); g.stroke();
      g.fillText(fmt(t, ticks.step < 1 ? 1 : 0), o.left - 8, y);
    });
    // подписи оси X
    g.textAlign = 'center';
    const xt = niceTicks(m.x0, m.x1, 8);
    xt.forEach((t) => { if (t >= m.x0 && t <= m.x1) g.fillText(String(Math.round(t) + 1), this.xs(t), H - 10); });

    m.bands.forEach((b) => {
      g.fillStyle = b.color;
      const y1 = ys(b.y1), y2 = ys(b.y2);
      g.fillRect(o.left, Math.min(y1, y2), pw, Math.abs(y2 - y1));
    });
    m.spans.forEach((s) => {
      g.fillStyle = s.color;
      const x1 = this.xs(Math.max(s.i0, m.x0)), x2 = this.xs(Math.min(s.i1, m.x1));
      if (x2 > x1) g.fillRect(x1, o.top, x2 - x1, ph);
    });
    m.hlines.forEach((h) => {
      g.strokeStyle = h.color; g.lineWidth = h.width || 1; g.setLineDash(h.dash || [5, 4]);
      const y = ys(h.y);
      g.beginPath(); g.moveTo(o.left, y); g.lineTo(W - o.right, y); g.stroke();
      g.setLineDash([]);
      if (h.label) {
        g.textAlign = 'left';
        const tw = g.measureText(h.label).width;
        g.fillStyle = '#151a24d9';
        g.fillRect(o.left + 4, y - 17, tw + 8, 15);
        g.fillStyle = h.color.length > 7 ? h.color.slice(0, 7) : h.color;
        g.fillText(h.label, o.left + 8, y - 9);
      }
    });

    // линии
    m.series.forEach((s) => {
      g.strokeStyle = s.color; g.lineWidth = s.width || 1.6; g.setLineDash(s.dash || []);
      g.beginPath();
      let pen = false;
      for (let i = m.x0; i <= m.x1; i++) {
        const v = s.data[i];
        if (v === null || v === undefined || Number.isNaN(v)) { pen = false; continue; }
        const x = this.xs(i), y = ys(v);
        if (pen) g.lineTo(x, y); else { g.moveTo(x, y); pen = true; }
      }
      g.stroke();
      g.setLineDash([]);
    });

    m.markers.forEach((k) => {
      if (k.i < m.x0 || k.i > m.x1) return;
      drawMarker(g, this.xs(k.i), ys(k.y), k.kind, k.color, k.size || 6);
    });

    if (m.cursor !== undefined && m.cursor !== null && m.cursor >= m.x0 && m.cursor <= m.x1) {
      g.strokeStyle = '#ffffff55'; g.lineWidth = 1;
      const x = Math.round(this.xs(m.cursor)) + 0.5;
      g.beginPath(); g.moveTo(x, o.top); g.lineTo(x, o.top + ph); g.stroke();
    }
    if (this.hover !== null && this.hover >= m.x0 && this.hover <= m.x1) {
      g.strokeStyle = '#ffffff40'; g.lineWidth = 1;
      const x = Math.round(this.xs(this.hover)) + 0.5;
      g.beginPath(); g.moveTo(x, o.top); g.lineTo(x, o.top + ph); g.stroke();
      m.series.forEach((s) => {
        const v = s.data[this.hover];
        if (v === null || v === undefined) return;
        g.fillStyle = s.color; g.beginPath(); g.arc(x, ys(v), 3.5, 0, Math.PI * 2); g.fill();
      });
    }
  };

  function drawMarker(g, x, y, kind, color, r) {
    g.fillStyle = color; g.strokeStyle = color; g.lineWidth = 2;
    g.beginPath();
    if (kind === 'up') { g.moveTo(x, y - r - 2); g.lineTo(x - r, y + r - 2); g.lineTo(x + r, y + r - 2); g.closePath(); g.fill(); }
    else if (kind === 'down') { g.moveTo(x, y + r + 2); g.lineTo(x - r, y - r + 2); g.lineTo(x + r, y - r + 2); g.closePath(); g.fill(); }
    else if (kind === 'cross') { g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke(); }
    else if (kind === 'ring') { g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); }
    else { g.arc(x, y, r - 1, 0, Math.PI * 2); g.fill(); }
  }

  function niceTicks(lo, hi, count) {
    const span = hi - lo || 1;
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
    const out = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(Math.abs(t) < step / 1e6 ? 0 : t);
    out.step = step;
    return out;
  }

  window.UI = { Chart, COLORS, fmt, sgn, MINUS };
})();
