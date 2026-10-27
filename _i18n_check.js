// Temporary verification: ensure every data-i18n* key in index.html exists in DICT (en).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, 'www');

// Minimal browser stubs so i18n.js can load in Node.
const stubs = {
  localStorage: { _d: {}, getItem(k){return this._d[k]||null;}, setItem(k,v){this._d[k]=String(v);} },
  navigator: { language: 'en' },
  document: {
    readyState: 'complete',
    documentElement: { lang: '' },
    addEventListener(){},
    dispatchEvent(){},
    getElementById(){ return null; },
    querySelectorAll(){ return []; },
  },
};
const sandbox = { window: stubs, ...stubs, console, CustomEvent: function(){}, setTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
const code = fs.readFileSync(path.join(dir, 'i18n.js'), 'utf8') + '\n;globalThis.__I18n = I18n;';
vm.runInContext(code, sandbox);
const I18n = sandbox.__I18n;

const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const attrs = ['data-i18n','data-i18n-ph','data-i18n-title','data-i18n-aria-label','data-i18n-label','data-i18n-alt'];
const keys = new Set();
for (const a of attrs) {
  const re = new RegExp(a + '="([^"]+)"', 'g');
  let m;
  while ((m = re.exec(html))) keys.add(m[1]);
}

// Access the en dictionary through t(): a missing key returns the key itself.
let missing = [];
for (const k of keys) {
  if (I18n.t(k) === k) missing.push(k);
}
console.log('Total referenced keys:', keys.size);
if (missing.length) {
  console.log('MISSING IN EN DICT (' + missing.length + '):');
  missing.forEach(k => console.log('  -', k));
  process.exit(1);
} else {
  console.log('All referenced keys exist. OK');
}

// Also sanity-check zh has the same keys as en (report zh-missing only).
// We can't read DICT directly; compare by switching language.
I18n.setLang('zh');
let zhMissing = [];
for (const k of keys) {
  // For zh, fallback returns the EN value; a key entirely absent returns k.
  // We only detect completely-absent keys here (returns k).
  if (I18n.t(k) === k) zhMissing.push(k);
}
if (zhMissing.length) {
  console.log('MISSING ENTIRELY (' + zhMissing.length + '):', zhMissing);
} else {
  console.log('No entirely-missing keys. OK');
}