/* Смоук-тест экранов (#17). Запуск: node test/smoke.js
   1) статически: все термины T('ключ') из экранов есть в словаре;
   2) в headless Chrome открывает каждый экран каждой готовой стратегии и проверяет:
      нет ошибок JS в консоли, заголовок на месте, правая часть (график/таблицы) непустая.
   Chrome ищется в стандартном месте macOS; другой путь: CHROME=/путь node test/smoke.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let failed = 0;
const fail = (m) => { failed++; console.log('  ✗ ' + m); };

/* ---------- 1. термины словаря ---------- */
const win = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/glossary.js'), 'utf8'), { window: win });
const gl = win.GLOSSARY || {};
console.log('Словарь: ' + Object.keys(gl).length + ' терминов');
fs.readdirSync(path.join(root, 'js')).filter((f) => /^screens-.*\.js$/.test(f)).forEach((f) => {
  const src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
  const re = /\bT\('([a-z0-9_]+)'/g;
  let m;
  const missing = new Set();
  while ((m = re.exec(src))) if (!gl[m[1]]) missing.add(m[1]);
  if (missing.size) fail(f + ': нет в словаре: ' + [...missing].join(', '));
});

/* ---------- 2. экраны в браузере ---------- */
if (!fs.existsSync(CHROME)) {
  console.log('Chrome не найден (' + CHROME + '), браузерная часть пропущена');
} else {
  const dump = (hash) => {
    const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--enable-logging=stderr', '--v=0',
      '--virtual-time-budget=4000', '--dump-dom', 'file://' + root + '/index.html#' + hash], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const errs = (r.stderr || '').split('\n').filter((l) => /CONSOLE/.test(l) && /(Uncaught|Error|error)/.test(l));
    return { dom: r.stdout || '', errs };
  };
  const onlyList = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const stratIds = onlyList || ['zscore', 'ewma', 'robust', 'hedge', 'coint', 'calendar', 'tactics', 'fx', 'baskets', 'moex', 'diag', 'bands', 'regime', 'valid', 'book', 'ml'];
  stratIds.forEach((id) => {
    const first = dump(id + '/1');
    const titles = [...first.dom.matchAll(/<button class="step[^"]*" data-i="\d+"><span class="num">\d+<\/span><span>([^<]*)<\/span>/g)].map((x) => x[1]);
    console.log(id + ': экранов ' + titles.length);
    if (!titles.length) { fail(id + ': в меню нет экранов'); return; }
    titles.forEach((title, i) => {
      const r = i === 0 ? first : dump(id + '/' + (i + 1));
      const h1 = (r.dom.match(/<h1>([^<]*)<\/h1>/) || [])[1];
      const vizStart = r.dom.indexOf('<div id="viz">') >= 0 ? r.dom.indexOf('<div id="viz">') : r.dom.indexOf('<div id="full">');
      let viz = vizStart >= 0 ? r.dom.slice(vizStart) : '';
      const navAt = viz.indexOf('nav-bottom');
      if (navAt > 0) viz = viz.slice(0, navAt);
      const vizText = viz.replace(/<[^>]*>/g, '').trim();
      const label = id + '/' + (i + 1) + ' «' + title + '»';
      const bad = [];
      if (r.errs.length) bad.push('ошибки консоли: ' + r.errs[0].slice(0, 200));
      if (h1 !== title) bad.push('заголовок «' + h1 + '»');
      if (!/<canvas|<table|<svg/.test(viz) && vizText.length < 80) bad.push('правая часть пуста (mount не отработал)');
      if (/NaN|undefined|Infinity/.test(r.dom.replace(/<script[\s\S]*?<\/script>/g, ''))) bad.push('в тексте NaN/undefined/Infinity');
      if (bad.length) fail(label + ' — ' + bad.join('; '));
      else console.log('  ✓ ' + label);
    });
  });

}

console.log(failed ? '\nПРОВАЛЕНО: ' + failed : '\nOK: смоук-тест пройден');
process.exit(failed ? 1 : 0);
