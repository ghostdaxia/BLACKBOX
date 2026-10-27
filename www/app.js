const PIN_KEY = 'bb_pin';
const DECOY_KEY = 'bb_decoy';
const SETT_KEY = 'bb_settings';

let PIN = localStorage.getItem(PIN_KEY) || null; // salted SHA-256 verifier (or legacy plaintext, migrated on first unlock)
let DECOY_PIN = localStorage.getItem(DECOY_KEY) || ''; // same, for the decoy profile
let digits = [];
let activeTab = 'home';
let _setupActive = false;
let _bioReady = false; // a persisted master key exists → fingerprint can unlock
let _animLock = false; // re-lock while the unlock animation is playing
let failCount = 0;
let lockoutEnd = 0;
let lockoutInterval = null;
let autoLockTimer = null;

let S = {blur: false, shake: false, autoLock: true, selfDestruct: false, alive: true, wallpaper: 'none', uiStyle: 'glass', voiceModel: 'Xenova/whisper-tiny.en', theme: 'dark'};
try { S = {...S, ...JSON.parse(localStorage.getItem(SETT_KEY) || '{}')}; } catch {}

const App = { lock: _lockApp };

window.addEventListener('DOMContentLoaded', () => {
  // About-section version always comes from the single source of truth
  // (updater.js currentVersion, enforced == package.json == gradle by ci/checks.js)
  const aboutVersion = document.getElementById('aboutVersion');
  if (aboutVersion && window.Updater) aboutVersion.textContent = 'BLACKBOX v' + Updater.currentVersion;

  _initDialogs();
  _initModalA11y();
  _initLock();
  _initBiometric();
  _initNav();
  _initSettings();
  _applySettings();
  SecretsModule.init();
  FilesManager.init();
  JournalModule.init();
  AuthModule.init();
  PrivacyModule.init();
  EncClipboard.init();
  VoiceModule.init();
  PasswordGen.init();
  VaultHealth.init();

  // Escape dismisses the topmost open modal (keyboard parity with the X/close buttons).
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    // `.modal:not(.hidden)` alone also matches panels nested in an inactive
    // .tab-content — those are display:none via their ancestor, not via their
    // own class — so Escape could "click" a close button on an invisible
    // panel. getClientRects() is empty for anything not actually rendered.
    const openMods = [...document.querySelectorAll('.modal:not(.hidden)')]
      .filter(m => m.getClientRects().length > 0);
    if (!openMods.length) return;
    const top = openMods[openMods.length - 1];
    const btn = top.querySelector('.modal-close-btn') || top.querySelector('.modal-cancel');
    btn?.click();
  });

  // Appearance suite (alive colours, wallpapers) + tour
  Appearance.apply();
  _syncToggle('aliveToggle', S.alive, v => { S.alive = v; _saveSett(); Appearance.apply(); });
  const uiStyleSel = document.getElementById('uiStyleSelect');
  if (uiStyleSel) {
    uiStyleSel.value = S.uiStyle || 'solid';
    uiStyleSel.addEventListener('change', () => { S.uiStyle = uiStyleSel.value; _saveSett(); Appearance.apply(); });
  }
  const themeSel = document.getElementById('themeSelect');
  if (themeSel) {
    themeSel.value = S.theme || 'dark';
    themeSel.addEventListener('change', () => { S.theme = themeSel.value; _saveSett(); Appearance.apply(); });
  }
  const voiceModelSel = document.getElementById('voiceModelSelect');
  if (voiceModelSel) {
    voiceModelSel.value = S.voiceModel || 'Xenova/whisper-tiny.en';
    voiceModelSel.addEventListener('change', () => { S.voiceModel = voiceModelSel.value; _saveSett(); });
  }
  const wallSel = document.getElementById('wallpaperSelect');
  if (wallSel) {
    wallSel.value = S.wallpaper;
    wallSel.addEventListener('change', () => { S.wallpaper = wallSel.value; _saveSett(); Appearance.apply(); });
  }
  document.getElementById('coolTourBtn')?.addEventListener('click', () => CoolTour.open());
  document.getElementById('closeCoolModal')?.addEventListener('click', () => document.getElementById('coolModal').classList.add('hidden'));
  document.querySelector('#coolModal .modal-backdrop')?.addEventListener('click', () => document.getElementById('coolModal').classList.add('hidden'));
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && Vault.isUnlocked()) _lockApp();
});

/* ══════════════════════════════════════════════
   IN-APP DIALOGS — replaces all native
   alert()/confirm()/prompt() popups, which render
   in the OS theme (not ours) and trap flows.
   ══════════════════════════════════════════════ */
const Dialog = (() => {
  let alertRes = null, confirmRes = null, promptRes = null;

  function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
  function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

  function init() {
    document.getElementById('infoOk')?.addEventListener('click', () => { hide('infoModal'); if (alertRes) { alertRes(); alertRes = null; } });
    document.getElementById('infoX')?.addEventListener('click', () => { hide('infoModal'); if (alertRes) { alertRes(); alertRes = null; } });
    document.getElementById('deleteCancel')?.addEventListener('click', () => { hide('deleteModal'); if (confirmRes) { confirmRes(false); confirmRes = null; } });
    document.getElementById('deleteOk')?.addEventListener('click', () => { hide('deleteModal'); if (confirmRes) { confirmRes(true); confirmRes = null; } });
    document.getElementById('promptCancel')?.addEventListener('click', () => { hide('promptModal'); if (promptRes) { promptRes(null); promptRes = null; } });
    document.getElementById('promptOk')?.addEventListener('click', () => {
      const v = document.getElementById('promptInput').value;
      hide('promptModal'); if (promptRes) { promptRes(v); promptRes = null; }
    });
    document.getElementById('promptInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); document.getElementById('promptOk').click(); }
    });

    // Backdrop dismissal was inconsistent: most panels closed when you tapped
    // outside, but these three did nothing — the same visual affordance
    // behaving differently depending on which dialog you happened to be
    // looking at. Each routes through its own cancel path, so the semantics
    // (false / null / dismiss) are unchanged.
    document.querySelector('#infoModal .modal-backdrop')?.addEventListener('click', () => {
      hide('infoModal'); if (alertRes) { alertRes(); alertRes = null; }
    });
    document.querySelector('#deleteModal .modal-backdrop')?.addEventListener('click', () => {
      hide('deleteModal'); if (confirmRes) { confirmRes(false); confirmRes = null; }
    });
    document.querySelector('#promptModal .modal-backdrop')?.addEventListener('click', () => {
      hide('promptModal'); if (promptRes) { promptRes(null); promptRes = null; }
    });
  }

  function uiAlert(title, msg) {
    document.getElementById('infoTitle').textContent = title;
    document.getElementById('infoBody').textContent = msg;
    show('infoModal');
    return new Promise(res => { alertRes = res; });
  }

  /** Returns Promise<boolean>. `danger` styles OK red. Custom labels supported. */
  function uiConfirm(title, msg, opts) {
    opts = opts || {};
    document.getElementById('deleteTitle').textContent = title;
    document.getElementById('deleteMsg').textContent = msg;
    const okBtn = document.getElementById('deleteOk');
    const cancelBtn = document.getElementById('deleteCancel');
    okBtn.textContent = opts.okLabel || t('common.ok');
    cancelBtn.textContent = opts.cancelLabel || t('common.cancel');
    okBtn.classList.toggle('danger-btn', !!opts.danger);
    show('deleteModal');
    return new Promise(res => { confirmRes = res; });
  }

  /** Returns Promise<string|null>. */
  function uiPrompt(title, placeholder, opts) {
    opts = opts || {};
    document.getElementById('promptTitle').textContent = title;
    const inp = document.getElementById('promptInput');
    inp.value = '';
    inp.placeholder = placeholder || '';
    inp.type = opts.type || 'text';
    inp.autocomplete = 'off';
    show('promptModal');
    setTimeout(() => inp.focus(), 60);
    return new Promise(res => { promptRes = res; });
  }

  return { init, uiAlert, uiConfirm, uiPrompt };
})();

// Short aliases used across modules
function uiAlert(t, m) { return Dialog.uiAlert(t, m); }
function uiConfirm(t, m, o) { return Dialog.uiConfirm(t, m, o); }
function uiPrompt(t, p, o) { return Dialog.uiPrompt(t, p, o); }
function _initDialogs() { Dialog.init(); }

/* ══════════════════════════════════════════════
   LOCK
   ══════════════════════════════════════════════ */
function _initLock() {
  PinBuddy.attach(); // the lock-screen character (buddy.js)
  document.querySelectorAll('#numpad .num-key[data-digit]').forEach(b => b.addEventListener('click', () => _addDigit(b.dataset.digit)));
  document.getElementById('delBtn')?.addEventListener('click', _delDigit);
  document.getElementById('decoyBtn')?.addEventListener('click', _triggerPanic);
  document.getElementById('panicBtn')?.addEventListener('click', _triggerPanic);
  document.getElementById('biometricBtn')?.addEventListener('click', _biometricUnlock);

  // Decoy calculator keypad (replaces inline onclick + eval)
  document.querySelectorAll('.calc-btn[data-calc]').forEach(b => b.addEventListener('click', () => _calcInput(b.dataset.calc)));

  let tapCount = 0;
  document.getElementById('panicOverlay')?.addEventListener('click', (e) => {
    if (!e.target.classList.contains('calc-btn')) {
      tapCount++;
      if (tapCount >= 5) { tapCount = 0; _lockApp(); }
    }
  });

  if (!PIN) _showSetupPinModal();
}

function _initBiometric() {
  async function check() {
    if (!window.Capacitor?.Plugins?.ShieldBiometric) return;
    try {
      const res = await window.Capacitor.Plugins.ShieldBiometric.isAvailable();
      // Only offer the button when a key from a previous successful unlock is
      // actually stored — otherwise tapping it can never work.
      if (res.available) {
        const persisted = await window.Capacitor.Plugins.ShieldBiometric.hasPersistedKey();
        _bioReady = !!(persisted && persisted.hasKey);
        if (_bioReady) document.getElementById('biometricBtn').style.display = 'flex';
      }
    } catch {}
  }
  if (window.Capacitor) {
    check();
  } else {
    window.addEventListener('capacitorReady', check, { once: true });
  }
}

/* ── PIN SETUP (with confirm step — a typo must never lock you out) ── */
function _showSetupPinModal() {
  const modal = document.getElementById('setupPinModal');
  const confirmModal = document.getElementById('confirmPinModal');
  if (!modal || !confirmModal) return;
  _setupActive = true;
  modal.classList.remove('hidden');

  const setupDots = [0, 1, 2, 3].map(i => document.getElementById('sd' + i));
  const confirmDots = [0, 1, 2, 3].map(i => document.getElementById('cp' + i));
  let setupDigits = [];
  let confirmDigits = [];
  let firstPin = null;

  const updateDots = (dots, arr) => dots.forEach((dot, i) => dot && dot.classList.toggle('filled', i < arr.length));

  const bindKeys = (root, dots, arr, onDone, delBtnId) => {
    root.querySelectorAll('.num-key[data-digit]').forEach(b => b.addEventListener('click', () => {
      if (arr.length < 4) {
        arr.push(b.dataset.digit);
        updateDots(dots, arr);
        if (arr.length === 4) onDone();
      }
    }));
    document.getElementById(delBtnId)?.addEventListener('click', () => {
      if (arr.length > 0) { arr.pop(); updateDots(dots, arr); }
    });
  };

  bindKeys(modal, setupDots, setupDigits, () => {
    firstPin = setupDigits.join('');
    setTimeout(() => {
      modal.classList.add('hidden');
      // Clear IN PLACE. Reassigning (confirmDigits = []) would swap in a new
      // array while bindKeys' closure keeps pushing into the original one —
      // the confirm check then always compared "" against firstPin ("don't
      // match" on every attempt) and after 4 stale digits the pad went dead.
      confirmDigits.length = 0;
      updateDots(confirmDots, confirmDigits);
      confirmModal.classList.remove('hidden');
    }, 180);
  }, 'setupDelBtn');

  bindKeys(confirmModal, confirmDots, confirmDigits, async () => {
    if (confirmDigits.join('') === firstPin) {
      PIN = await Vault.hashPin(firstPin);
      localStorage.setItem(PIN_KEY, PIN);
      await Vault.unlockWithPin(firstPin); // derive master key immediately
      _bioReady = true; // key persisted → fingerprint unlock available
      _setupActive = false;
      confirmModal.classList.add('hidden');
      if (window.Capacitor?.Plugins?.ShieldBiometric) {
        try {
          const res = await window.Capacitor.Plugins.ShieldBiometric.isAvailable();
          if (res.available && await uiConfirm(t('lock.biometrics_register_title'), t('lock.biometrics_register_msg'), { okLabel: t('lock.biometrics_register_yes'), cancelLabel: t('lock.biometrics_register_later') })) {
            _biometricUnlock();
          }
        } catch {}
      }
    } else {
      const errEl = document.getElementById('confirmError');
      if (errEl) errEl.textContent = t('lock.pins_dont_match');
      confirmDigits.length = 0; // in place — see note above; keeps the pad live
      updateDots(confirmDots, confirmDigits);
      setTimeout(() => { if (errEl) errEl.textContent = ''; }, 2000);
    }
  }, 'confirmDelBtn');
}

async function _biometricUnlock() {
  if (!window.Capacitor?.Plugins?.ShieldBiometric) return;
  try {
    const res = await window.Capacitor.Plugins.ShieldBiometric.authenticate({ title: t('lock.unlock_title') });
    if (res.success) {
      failCount = 0;
      try {
        await Vault.unlockFromSession(); // session key, or Keystore-backed key after a restart
      } catch {
        // No stored key (e.g. web / first run) — the fingerprint prompt succeeded
        // but there is nothing to unlock with. Fall back to the PIN pad.
        return;
      }
      PinBuddy.unlock();
      _showApp();
    }
  } catch (e) { console.error('Biometric error:', e); }
}

function _addDigit(d) {
  if (_isLockedOut()) return;
  if (_verifying) return; // a check is in flight; ignoring taps prevents a second
                          // concurrent _checkPin (two shakes, two _refreshAll)
  if (digits.length >= 4) return;
  if (_setupActive) return;
  digits.push(d);
  PinBuddy.input(); // eyes shut the instant a digit lands — see buddy.js
  _renderDots();
  if (digits.length === 4) _checkPin();
}

function _delDigit() {
  if (_verifying) return;
  if (digits.length === 0) return;
  digits.pop();
  PinBuddy.input(); // still actively typing, so the eyes stay shut
  _renderDots();
  document.getElementById('pinError').textContent = '';
}

function _renderDots() {
  [0, 1, 2, 3].forEach(i => {
    const el = document.getElementById('pd' + i);
    if (el) el.classList.toggle('filled', i < digits.length);
  });
}

let _verifying = false; // true while _verifyPin() is in flight — see _checkPin

/* Key derivation is deliberately expensive (PBKDF2), so there is a real gap
   between the 4th digit and either outcome — long enough on a low-end phone to
   look like a dropped tap. This wrapper only exists to bracket that gap: the
   pad dims and the dots pulse while _verifyPin() is in flight, and the
   `finally` guarantees the state is cleared on every exit path (success, wrong
   PIN, decoy panic, self-destruct) so the pad can never be left dimmed. */
async function _checkPin() {
  const content = document.querySelector('.lock-content');
  const endVerifying = () => { _verifying = false; content?.classList.remove('verifying'); };
  _verifying = true;
  content?.classList.add('verifying');
  // Safety net only: the pad is dimmed and input is ignored while this is set,
  // so if a derivation ever failed to settle it would lock the user out of
  // their own lock screen. A watchdog that can only *clear* the state costs
  // nothing on the normal path and makes the dimming strictly safe.
  const watchdog = setTimeout(endVerifying, 8000);
  try {
    await _verifyPin();
  } finally {
    clearTimeout(watchdog);
    endVerifying();
  }
}

async function _verifyPin() {
  const entered = digits.join('');
  digits = [];
  _renderDots();

  if (DECOY_PIN && await Vault.verifyPin(entered, DECOY_PIN)) {
    if (!Vault.isPinVerifier(DECOY_PIN)) { // migrate legacy plaintext decoy verifier too
      DECOY_PIN = await Vault.hashPin(entered);
      localStorage.setItem(DECOY_KEY, DECOY_PIN);
    }
    _triggerPanic();
    return;
  }
  if (PIN && await Vault.verifyPin(entered, PIN)) {
    failCount = 0;
    // ── Legacy migration (pre-2.0.4 installs): the stored verifier was the
    // plaintext PIN. Accept it, then replace it with a salted hash so it is
    // never persisted again. Data itself was always AES-encrypted with a key
    // derived from the PIN, so the same digits still decrypt everything.
    if (!Vault.isPinVerifier(PIN)) {
      PIN = await Vault.hashPin(entered);
      localStorage.setItem(PIN_KEY, PIN);
    }
    // (A legacy plaintext decoy verifier is not migrated here — we only have
    // the real digits. It keeps working and upgrades if the decoy PIN is
    // entered; see the decoy branch above.)
    try { await Vault.unlockWithPin(entered); } catch {}
    _bioReady = true; // key is persisted → fingerprint can unlock from now on
    const bioBtn = document.getElementById('biometricBtn');
    if (bioBtn && window.Capacitor?.Plugins?.ShieldBiometric) bioBtn.style.display = 'flex';
    PinBuddy.unlock(); // it peeks and smiles as the vault opens
    _showApp();
  } else {
    failCount++;
    PinBuddy.reject(); // a small "hands up" to go with the dot shake
    document.getElementById('lockAttemptInfo').textContent = t('lock.attempt_n', failCount);
    const errEl = document.getElementById('pinError');
    errEl.textContent = t('lock.wrong_pin');
    const dots = document.querySelectorAll('.pin-display .pin-dot');
    const content = document.querySelector('.lock-content');
    dots.forEach(d => { d.classList.add('error'); });
    content?.classList.add('shake');
    setTimeout(() => {
      content?.classList.remove('shake');
      dots.forEach(d => { d.classList.remove('error', 'filled'); });
      errEl.textContent = '';
    }, 450);

    if (S.selfDestruct && failCount >= 5) { _selfDestruct(); return; }
    if (failCount >= 3) _startLockout();
  }
}

function _startLockout() {
  lockoutEnd = Date.now() + 120000;
  const numpad = document.getElementById('numpad');
  if (numpad) { numpad.style.opacity = '0.3'; numpad.style.pointerEvents = 'none'; }
  const el = document.getElementById('lockoutTimer');
  if (el) el.classList.remove('hidden');
  lockoutInterval = setInterval(() => {
    const rem = Math.ceil((lockoutEnd - Date.now()) / 1000);
    if (rem <= 0) {
      clearInterval(lockoutInterval);
      lockoutEnd = 0;
      // failCount deliberately NOT reset here. Resetting it made the
      // documented Self-Destruct unreachable: attempts 1-3 started a lockout,
      // the lockout zeroed the counter, and _addDigit refuses input while
      // locked out — so the counter could never climb past 3 and the
      // `failCount >= 5` wipe was dead code. Failures now accumulate across
      // lockouts and only a successful unlock clears them.
      if (numpad) { numpad.style.opacity = ''; numpad.style.pointerEvents = ''; }
      if (el) el.classList.add('hidden');
      const info = document.getElementById('lockAttemptInfo');
      if (info) info.textContent = failCount > 0 ? t('lock.attempt_n', failCount) : '';
    } else {
      if (el) el.textContent = t('lock.locked_out_wait', rem);
    }
  }, 500);
}

function _isLockedOut() { return lockoutEnd > Date.now(); }

function _selfDestruct() {
  Vault.clearAll(); // also wipes the Keystore-backed biometric key
  localStorage.clear();
  try { sessionStorage.clear(); } catch {}
  document.getElementById('pinError').textContent = t('lock.vault_wiped');
  document.getElementById('lockAttemptInfo').textContent = t('lock.all_data_destroyed');
  setTimeout(() => location.reload(), 2000);
}

function _showApp() {
  const lock = document.getElementById('lockScreen');
  const app = document.getElementById('mainApp');
  document.getElementById('pinError').textContent = '';
  document.getElementById('lockAttemptInfo').textContent = '';
  document.getElementById('biometricBtn')?.classList.add('unlocking');
  lock.classList.add('unlocking'); // fade+scale the vault door away
  _animLock = true;
  document.getElementById('panicOverlay').classList.add('hidden');
  setTimeout(() => {
    lock.classList.remove('active', 'unlocking');
    document.getElementById('biometricBtn')?.classList.remove('unlocking');
    app.classList.remove('hidden');
    app.classList.add('entering');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      app.classList.remove('entering');
      _animLock = false;
    }));
  }, 380);
  _resetAutoLock();
  _refreshAll();
  _notifyIfUpdate();
}

/* Tear down every open overlay.
   Only modals living inside #mainApp were hidden by hiding that container;
   #genModal, #healthModal, #voiceModal, #coolModal, #infoModal, #deleteModal
   and #promptModal are direct children of <body> at z-index 1100 — above the
   lock screen (z-index 1000). So opening the Password Generator and walking
   away left the plaintext password sitting on top of an unlocked-looking
   lock screen, and the Change-PIN prompt stayed readable too. Lock now closes
   everything, releases media, and drops decrypted object URLs. */
function _closeAllOverlays() {
  document.querySelectorAll('.modal:not(.hidden)').forEach(m => m.classList.add('hidden')); // every panel, visible or not
  document.getElementById('panicOverlay')?.classList.add('hidden');
  document.getElementById('voiceProgressPanel')?.classList.add('hidden');
  if (typeof VoiceModule !== 'undefined' && VoiceModule.abort) VoiceModule.abort();
  if (typeof FilesManager !== 'undefined' && FilesManager.closeViewer) FilesManager.closeViewer();
  _lastActivityAt = 0;
}

function _lockApp() {
  if (_animLock) return; // don't fight the unlock transition
  if (!Vault.isUnlocked() && document.getElementById('lockScreen').classList.contains('active')) return;
  Vault.lock();
  AuthModule.stopTimers();
  _closeAllOverlays();
  const lock = document.getElementById('lockScreen');
  lock.classList.remove('unlocking');
  lock.classList.add('active');
  document.getElementById('mainApp').classList.add('hidden');
  digits = [];
  PinBuddy.idle();
  _renderDots();
  document.querySelectorAll('.pin-display .pin-dot').forEach(d => d.classList.remove('error'));
  document.getElementById('pinError').textContent = '';
  _clearAutoLock();
  if (PrivacyOverlay.isEnabled()) PrivacyOverlay.disable();
}

/* ── AUTO-LOCK ── */
function _resetAutoLock() {
  if (!S.autoLock) return;
  _clearAutoLock();
  autoLockTimer = setTimeout(_lockApp, 30000);
}

function _clearAutoLock() {
  if (autoLockTimer) { clearTimeout(autoLockTimer); autoLockTimer = null; }
}

/* Any real interaction resets the idle timer. Binding touchstart alone meant
   typing on the Android soft keyboard — a separate window, so its taps never
   reach the document — or using a desktop/PWA session let the vault seal
   itself mid-sentence with the form unsaved. Throttled to 1/s; mousemove and
   scroll would otherwise re-arm the timer hundreds of times a second. */
const _ACTIVITY_EVENTS = ['touchstart', 'pointerdown', 'keydown', 'wheel', 'scroll', 'mousemove'];
let _lastActivityAt = 0;
let _lockEl = null;
function _onActivity() {
  // Cheap throttle first: these fire continuously, so the DOM lookup below
  // must not run per-event (mousemove alone would do it hundreds of times a
  // second). Longest path is now one getElementById per second.
  const now = Date.now();
  if (now - _lastActivityAt < 1000) return;
  if (!_lockEl) _lockEl = document.getElementById('lockScreen');
  if (_lockEl && _lockEl.classList.contains('active')) return;
  _lastActivityAt = now;
  _resetAutoLock();
}
_ACTIVITY_EVENTS.forEach(ev => document.addEventListener(ev, _onActivity, { passive: true, capture: true }));

/* ── PANIC CALCULATOR (decoy) — no eval(), no globals on onclick ── */
let calcExpr = '', calcPrev = null, calcOp = null, calcFresh = true;

function _calcInput(v) {
  const d = document.getElementById('calcDisplay');
  if (!d) return;
  if (v === 'AC') { calcExpr = ''; calcPrev = null; calcOp = null; calcFresh = true; d.textContent = '0'; return; }
  if (v === '+/-') { const n = parseFloat(calcExpr); if (!isNaN(n)) { calcExpr = String(-n); d.textContent = calcExpr; } return; }
  if (v === '%') { const n = parseFloat(calcExpr); if (!isNaN(n)) { calcExpr = String(n / 100); d.textContent = calcExpr; } return; }
  if (v === '=') { _calcEquals(); return; }
  if ('+-*/'.includes(v)) {
    if (calcExpr !== '' && calcExpr !== '-') { calcPrev = parseFloat(calcExpr); calcOp = v; calcFresh = true; }
    return;
  }
  if (calcFresh) { calcExpr = v === '.' ? '0.' : v; calcFresh = false; }
  else {
    if (v === '.' && calcExpr.includes('.')) return;
    if (calcExpr.length >= 14) return;
    calcExpr += v;
  }
  d.textContent = calcExpr;
}

function _calcEquals() {
  const d = document.getElementById('calcDisplay');
  if (calcOp === null || calcPrev === null || calcExpr === '') return;
  const cur = parseFloat(calcExpr);
  let r;
  switch (calcOp) {
    case '+': r = calcPrev + cur; break;
    case '-': r = calcPrev - cur; break;
    case '*': r = calcPrev * cur; break;
    case '/': r = cur === 0 ? NaN : calcPrev / cur; break;
  }
  if (!isFinite(r)) { d.textContent = t('panic.calc_error'); calcExpr = ''; calcPrev = null; calcOp = null; calcFresh = true; return; }
  r = Math.round(r * 1e10) / 1e10;
  calcExpr = String(r);
  d.textContent = calcExpr;
  calcPrev = null; calcOp = null; calcFresh = true;
}

function _triggerPanic() {
  document.getElementById('mainApp').classList.add('hidden');
  document.getElementById('lockScreen').classList.remove('active');
  document.getElementById('panicOverlay').classList.remove('hidden');
  Vault.lock();
  AuthModule.stopTimers();
}

/* ── NAV ── */
function _initNav() {
  document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => _switchTab(b.dataset.tab)));
  document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => _switchTab(b.dataset.goto)));
}

function _switchTab(tab) {
  if (tab === activeTab) return;
  activeTab = tab;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(tc => {
    tc.classList.toggle('hidden', tc.id !== 'tab-' + tab);
    tc.classList.toggle('active', tc.id === 'tab-' + tab);
  });
  if (tab === 'secrets') { SecretsModule.refresh(); FilesManager.refresh(); }
  if (tab === 'journal') JournalModule.refresh();
  if (tab === 'auth') AuthModule.refresh();
}

/* ── REFRESH ALL ── */
function _refreshAll() {
  SecretsModule.refresh();
  FilesManager.refresh();
  JournalModule.refresh();
  AuthModule.refresh();
  VaultHealth.refreshScore();
}

/* ── SETTINGS ── */
function _initSettings() {
  _syncToggle('autoLockToggle', S.autoLock, v => {
    S.autoLock = v;
    if (!v) _clearAutoLock(); else _resetAutoLock();
    document.getElementById('autoLockToggle2').checked = v;
    _saveSett();
  });
  _syncToggle('autoLockToggle2', S.autoLock, v => {
    S.autoLock = v;
    if (!v) _clearAutoLock(); else _resetAutoLock();
    document.getElementById('autoLockToggle').checked = v;
    _saveSett();
  });
  _syncToggle('overlayToggle', S.blur, v => {
    S.blur = v;
    v ? PrivacyOverlay.enable() : PrivacyOverlay.disable();
    _saveSett();
  });
  _syncToggle('selfDestructToggle', S.selfDestruct, v => { S.selfDestruct = v; _saveSett(); });
  const shakeEl = document.getElementById('shakeToggle');
  if (shakeEl) {
    shakeEl.checked = !!S.shake;
    shakeEl.addEventListener('change', async () => {
      const on = shakeEl.checked;
      if (!on) { ShakeLock.disable(); S.shake = false; _saveSett(); return; }
      const ok = await ShakeLock.enable();
      if (!ok) {
        // Never leave the switch claiming a capability the device refused.
        shakeEl.checked = false;
        S.shake = false;
        _saveSett();
        await uiAlert(t('shake.denied_title'), t('shake.denied_msg'));
        return;
      }
      S.shake = true;
      _saveSett();
      _toast(t('toast.shake_enabled'));
    });
  }
  // This toggle used to be wired to an empty callback, so it rendered checked
  // and did nothing — a switch that silently lied. It now drives the real
  // clipboard auto-clear (on by default).
  if (typeof S.clipAutoClear !== 'boolean') S.clipAutoClear = true;
  _syncToggle('clipAutoClear', S.clipAutoClear, v => {
    S.clipAutoClear = v;
    _saveSett();
    EncClipboard.setAutoClear(v);
  });
  EncClipboard.setAutoClear(S.clipAutoClear);

  document.getElementById('changePinBtn')?.addEventListener('click', _changePinFlow);
  document.getElementById('setupDecoyBtn')?.addEventListener('click', _setupDecoyFlow);
  document.getElementById('clearVaultBtn')?.addEventListener('click', async () => {
    if (await uiConfirm(t('settings.clear_all'), t('settings.clear_msg'), { danger: true, okLabel: t('common.delete_everything') })) {
      Vault.clearAll();
      _toast(t('toast.vault_cleared'), 'red');
    }
  });
  document.getElementById('resetAppBtn')?.addEventListener('click', async () => {
    if (await uiConfirm(t('settings.factory_reset'), t('settings.reset_msg'), { danger: true, okLabel: t('common.reset_app') })) {
      localStorage.clear();
      location.reload();
    }
  });
  document.getElementById('exportSettingsBtn')?.addEventListener('click', async () => {
    const pass = await uiPrompt(t('backup.title'), t('backup.pass_ph'), { type: 'password' });
    if (pass === null) return;
    if (pass.length < 8) { await uiAlert(t('backup.title'), t('backup.too_short')); return; }
    const confirm2 = await uiPrompt(t('backup.title'), t('backup.confirm_ph'), { type: 'password' });
    if (confirm2 === null) return;
    if (confirm2 !== pass) { await uiAlert(t('backup.title'), t('backup.mismatch')); return; }
    try { await Vault.exportEncryptedBackup(pass); }
    catch (e) { await uiAlert(t('backup.title'), e.message || t('backup.export_failed')); }
  });
  document.getElementById('importSettingsBtn')?.addEventListener('click', async () => {
    const pass = await uiPrompt(t('backup.restore_title'), t('backup.restore_ph'), { type: 'password' });
    if (pass === null) return;
    document.getElementById('importInput')._pass = pass;
    document.getElementById('importInput')?.click();
  });
  document.getElementById('importInput')?.addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      let n;
      if (f.name.endsWith('.bbvault')) {
        n = await Vault.importEncryptedBackup(f, document.getElementById('importInput')._pass || '');
      } else {
        n = await Vault.importBackup(f); // legacy .blackbox (ciphertext merge)
      }
      _toast(t('toast.imported_n', n));
      _refreshAll();
    } catch (err) {
      await uiAlert(t('backup.import_failed_title'), err.message || t('backup.import_failed'));
    }
    e.target.value = '';
  });
  document.getElementById('websiteBtn')?.addEventListener('click', () => window.open('https://alpha1studio.vercel.app', '_blank'));
  document.getElementById('featureReqBtn')?.addEventListener('click', _requestFeature);
  document.getElementById('githubBtn')?.addEventListener('click', () => window.open('https://github.com/alpha-1-design/BLACKBOX', '_blank'));
  document.getElementById('faqBtn')?.addEventListener('click', _showFaq);
  document.getElementById('privacyPolicyBtn')?.addEventListener('click', _showPrivacyPolicy);
  // One tap, one outcome. This row used to fire BOTH listeners: its own
  // _checkUpdate() and the document-level chooser below, so tapping "Update
  // available" re-ran the network check (resetting the label to "Checking…")
  // and popped the store picker on top of it. The chooser owns the tap
  // whenever an update is already known.
  document.getElementById('updateStatus')?.addEventListener('click', () => {
    const row = document.getElementById('updateStatus');
    if (row && row._updateData) return;
    _checkUpdate();
  });
}

function _syncToggle(id, val, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.checked = val;
  el.addEventListener('change', () => { onChange(el.checked); });
}

function _applySettings() {
  if (S.blur) PrivacyOverlay.enable();
  _applyShake();
}

function _saveSett() { localStorage.setItem(SETT_KEY, JSON.stringify(S)); }

/* ── CHANGE PIN — re-encrypts every store with the new PIN's key ── */
async function _changePinFlow() {
  const cur = await uiPrompt(t('pin.change_title'), t('pin.current_ph'), { type: 'password' });
  if (cur === null) return;
  if (!/^\d{4}$/.test(cur)) { await uiAlert(t('pin.change_title'), t('pin.must_4')); return; }
  if (!PIN || !await Vault.verifyPin(cur, PIN)) { await uiAlert(t('pin.change_title'), t('pin.wrong_current')); return; }

  const next = await uiPrompt(t('pin.change_title'), t('pin.new_ph'), { type: 'password' });
  if (next === null) return;
  if (!/^\d{4}$/.test(next)) { await uiAlert(t('pin.change_title'), t('pin.new_must_4')); return; }
  if (next === cur) { await uiAlert(t('pin.change_title'), t('pin.new_different')); return; }

  const confirmPin = await uiPrompt(t('pin.change_title'), t('pin.confirm_ph'), { type: 'password' });
  if (confirmPin === null) return;
  if (confirmPin !== next) { await uiAlert(t('pin.change_title'), t('pin.change_mismatch')); return; }

  try {
    await Vault.changePin(cur, next); // re-encrypts all stores under the new key
    PIN = await Vault.hashPin(next);
    localStorage.setItem(PIN_KEY, PIN);
    _toast(t('toast.pin_updated'));
  } catch (err) {
    console.error('PIN change failed:', err);
    await uiAlert(t('pin.change_title'), t('pin.reencrypt_failed'));
  }
}

/* ── DECOY PIN ── */
async function _setupDecoyFlow() {
  const d = await uiPrompt(t('pin.decoy_title'), t('pin.decoy_ph'), { type: 'password' });
  if (d === null) return;
  if (d === '') {
    DECOY_PIN = '';
    localStorage.removeItem(DECOY_KEY);
    _toast(t('toast.decoy_disabled'));
    return;
  }
  if (!/^\d{4}$/.test(d)) { await uiAlert(t('pin.decoy_title'), t('pin.decoy_must_4')); return; }
  if (PIN && await Vault.verifyPin(d, PIN)) { await uiAlert(t('pin.decoy_title'), t('pin.decoy_different')); return; }
  DECOY_PIN = await Vault.hashPin(d);
  localStorage.setItem(DECOY_KEY, DECOY_PIN);
  _toast(t('toast.decoy_set'));
}

/* ── FAQ / PRIVACY POLICY — in-app modal, not native alert() ── */
async function _showFaq() {
  const faq = [1, 2, 3, 4, 5, 6, 7].map(i => ({ q: t('faq.q' + i), a: t('faq.a' + i) }));
  const html = faq.map(f => `<div class="faq-item"><strong>${f.q}</strong><p>${f.a}</p></div>`).join('');
  document.getElementById('infoTitle').textContent = t('faq.title');
  document.getElementById('infoBody').innerHTML = html;
  document.getElementById('infoModal').classList.remove('hidden');
}

async function _showPrivacyPolicy() {
  await uiAlert(t('policy.title'), t('policy.body'));
}

/* ── REQUEST A FEATURE — opens the user's mail app, pre-filled ── */
const FEATURE_EMAIL = 'alpha1.design.dev@gmail.com';
async function _requestFeature() {
  const idea = await uiPrompt(t('feature.title'), t('feature.ph'), { type: 'text' });
  if (idea === null) return; // cancelled
  const body = idea.trim() ? idea.trim() : t('feature.placeholder_body');
  const mailto = 'mailto:' + FEATURE_EMAIL
    + '?subject=' + encodeURIComponent('[Feature] BLACKBOX v' + Updater.currentVersion)
    + '&body=' + encodeURIComponent(body + '\n\n---\nSent from BLACKBOX v' + Updater.currentVersion);
  try {
    window.open(mailto, '_system');
  } catch {
    await uiAlert(t('feature.title'), t('feature.no_email', FEATURE_EMAIL));
  }
}

/* ── UPDATE NOTIFICATION ──
   Runs once shortly after the vault unlocks. Notifies the user when a newer
   release exists, instead of making them discover it under Settings. */
let _updateNotified = false;
function _notifyIfUpdate() {
  if (_updateNotified) return;
  _updateNotified = true;
  setTimeout(async () => {
    const result = await Updater.check();
    // Silent on error — no network is the normal case offline, not news.
    if (result && result.updateAvailable) _markUpdateAvailable(result);
  }, 8000);
}

function _markUpdateAvailable(result) {
  const txt = document.getElementById('updateText');
  const sub = document.getElementById('updateSub');
  if (txt) { txt.textContent = t('update.available_n', result.latestVersion); txt.style.color = 'var(--accent)'; }
  if (sub) sub.textContent = t('update.tap_to_update');
  const el = document.getElementById('updateStatus');
  if (el) el._updateData = result;
  _toast(t('update.toast_n', result.latestVersion), 'green');
}

/* ── UPDATES ── */
async function _checkUpdate() {
  const el = document.getElementById('updateText');
  const sub = document.getElementById('updateSub');
  el.textContent = t('update.checking');
  sub.textContent = t('update.please_wait');
  const result = await Updater.check();
  if (result.error) {
    el.textContent = t('update.check');
    sub.textContent = t('update.error_retry', t('update.err_' + result.error));
    return;
  }
  if (result.updateAvailable) {
    _markUpdateAvailable(result);
  } else {
    el.textContent = t('update.version_n', Updater.currentVersion);
    sub.textContent = t('update.up_to_date');
  }
}

document.addEventListener('click', async e => {
  const el = document.getElementById('updateStatus');
  if (!el || !el._updateData) return;
  if (el.contains(e.target)) {
    const r = el._updateData;
    el._updateData = null;
    if (await uiConfirm(t('update.dialog_title_n', r.latestVersion), t('update.dialog_msg'), { okLabel: t('common.f_droid'), cancelLabel: t('common.github') })) {
      Updater.openFdroid();
    } else {
      Updater.openGitHub();
    }
  }
});

// Re-render the Settings update row when the language flips so its current
// state (checking / up-to-date / available) is shown in the new language.
document.addEventListener('langchange', () => {
  const row = document.getElementById('updateStatus');
  if (!row) return;
  if (row._updateData) { _markUpdateAvailable(row._updateData); return; }
  const txt = document.getElementById('updateText');
  const sub = document.getElementById('updateSub');
  if (txt && txt.textContent) txt.textContent = t('update.check');
  if (sub && sub.textContent) sub.textContent = t('settings.check_updates_sub');
});

/* ══════════════════════════════════════════════
   MODAL ACCESSIBILITY
   Only the voice panel carried role="dialog"/aria-modal; every other panel
   was an unnamed, unfocusable div. Screen readers announced nothing and Tab
   walked straight into the page behind the panel. This decorates all of them
   and manages focus across open/close, including handing focus back to
   whatever opened the dialog.
   ══════════════════════════════════════════════ */
function _initModalA11y() {
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
  let lastFocus = null;
  let openStack = [];

  document.querySelectorAll('.modal').forEach(m => {
    const box = m.querySelector('.modal-box');
    if (box) {
      if (!box.hasAttribute('role')) box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('tabindex', '-1');
      // Name the dialog from its own title bar, so it is announced as
      // "Confirm Your PIN, dialog" rather than an unlabelled group.
      const title = box.querySelector('.modal-title');
      if (title && !box.hasAttribute('aria-labelledby')) {
        if (!title.id) title.id = 'modal-title-' + (m.id || Math.random().toString(36).slice(2, 8));
        box.setAttribute('aria-labelledby', title.id);
      }
    }
    new MutationObserver(() => {
      const open = !m.classList.contains('hidden');
      if (open) {
        if (!openStack.includes(m)) openStack.push(m);
        if (!lastFocus) lastFocus = document.activeElement;
        const target = (box && box.querySelector(FOCUSABLE)) || box;
        // Next frame, so the panel has been laid out before focus enters it.
        // preventScroll keeps the page behind from jumping.
        requestAnimationFrame(() => { try { target?.focus?.({ preventScroll: true }); } catch {} });
      } else {
        openStack = openStack.filter(x => x !== m);
        // Hand focus back only once nothing else is stacked on top.
        if (!openStack.length && lastFocus && lastFocus.isConnected) {
          try { lastFocus.focus({ preventScroll: true }); } catch {}
          lastFocus = null;
        }
      }
    }).observe(m, { attributes: true, attributeFilter: ['class'] });
  });
}

/* ── SHAKE TO LOCK ──
   S.shake was declared and never read, shake.js was never enabled and there
   was no settings row — the README has advertised "shake-to-lock" since 2.0.0
   while nothing could turn it on. The toggle below is the real switch, and
   enable() now reports whether it actually bound (the permission prompt can
   be declined, and some devices report no motion at all). */
function _applyShake() {
  if (!S.shake) { ShakeLock.disable(); return; }
  ShakeLock.enable().then(ok => {
    const t = document.getElementById('shakeToggle');
    if (t) t.checked = ok;
    if (!ok) { S.shake = false; _saveSett(); }
  });
}

/* ── TOAST ── */
function _toast(msg, type) {
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'red' ? ' red' : type === 'green' ? ' green' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}