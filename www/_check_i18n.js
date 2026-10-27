const fs = require('fs');
const path = require('path');
const dir = __dirname;
const src = fs.readFileSync(path.join(dir, 'i18n.js'), 'utf8');
const windowShim = {};
const navigatorShim = { language: 'en' };
const localStorageShim = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; } };
const documentShim = {
  documentElement: { lang: '' },
  readyState: 'complete',
  addEventListener() {},
  dispatchEvent() {},
  querySelectorAll: () => [],
  getElementById: () => null,
};
const fn = new Function('window', 'navigator', 'localStorage', 'document', 'CustomEvent', src + '; return I18n;');
const I18n = fn(windowShim, navigatorShim, localStorageShim, documentShim, function(){});
try { I18n.init(); } catch (e) { console.log('init note:', e.message); }

const missing = new Set();
function checkKey(key, where) {
  I18n.setLang('en');
  const en = I18n.t(key);
  I18n.setLang('zh');
  const zh = I18n.t(key);
  if (en === key) missing.add(where + ': EN missing ' + key);
  if (zh === key) missing.add(where + ': ZH missing ' + key);
}

// 1. Static t('dotted.key') calls in JS — require word boundary before t( and a dotted key
const jsFiles = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'i18n.js' && f !== '_check_i18n.js');
for (const f of jsFiles) {
  const code = fs.readFileSync(path.join(dir, f), 'utf8');
  const re = /[^a-zA-Z0-9_$.]t\(\s*['"]([a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)['"]\s*[),]/g;
  let m;
  while ((m = re.exec(code))) checkKey(m[1], f);
}

// 2. Dynamic prefixes like t('faq.q' + i) — expand with digits 0-9
const dynPrefixes = [
  { file: 'app.js', re: /t\(\s*['"]([a-z][a-zA-Z0-9_.]*\.)['"]\s*\+\s*[a-zA-Z_]+/g },
];
for (const { file, re } of dynPrefixes) {
  const code = fs.readFileSync(path.join(dir, file), 'utf8');
  let m;
  while ((m = re.exec(code))) {
    for (let i = 0; i <= 12; i++) checkKey(m[1] + i, file + ' (dynamic)');
  }
}

// 2b. Enumerated key lists/arrays in modules (moods, prompts, templates, category maps)
const enumKeys = [
  // secrets catLabel
  'secrets.cat_api_label','secrets.cat_db_label','secrets.cat_ssh_label','secrets.cat_password_label','secrets.cat_other_label',
  // journal moods
  'journal.mood_rough','journal.mood_low','journal.mood_okay','journal.mood_good','journal.mood_great',
  // journal prompts 1..22
  ...Array.from({length:22},(_,i)=>'journal.prompt_'+(i+1)),
  // journal templates
  'journal.tpl_daily','journal.tpl_gratitude','journal.tpl_goals','journal.tpl_meeting','journal.tpl_travel',
  // journal categories
  'journal.cat_personal','journal.cat_work','journal.cat_evidence','journal.cat_ideas',
  // cool tour (template literal cool.${id}_title/_body)
  ...['alive','wallpaper','voice','send'].flatMap(id=>['cool.'+id+'_title','cool.'+id+'_body']),
  // update error codes
  'update.err_github_unreachable','update.err_timeout','update.err_no_network',
  // privacy permission states
  'privacy.state_granted','privacy.state_denied','privacy.state_prompt','privacy.state_unknown','privacy.state_unsupported',
  // privacy permission names
  'privacy.perm_camera','privacy.perm_microphone','privacy.perm_geolocation','privacy.perm_notifications','privacy.perm_clipboard',
];
for (const k of enumKeys) checkKey(k, '(enum)');

// 3. data-i18n* attributes in HTML
const htmlFiles = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
for (const f of htmlFiles) {
  const code = fs.readFileSync(path.join(dir, f), 'utf8');
  const re = /data-i18n(?:-[a-z-]+)?=["']([a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)["']/g;
  let m;
  while ((m = re.exec(code))) checkKey(m[1], f);
}

if (missing.size) {
  console.log('MISSING KEYS (' + missing.size + '):');
  [...missing].sort().forEach(x => console.log(' ' + x));
  process.exit(1);
}
console.log('OK: all static and dynamic i18n keys resolve in EN and ZH.');