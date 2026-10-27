/* "Take the tour" — onboarding tour for the appearance suite. */
const CoolTour = (() => {
  const FEATURE_IDS = ['alive', 'wallpaper', 'voice', 'send'];

  const ICONS = {
    alive: '<circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>',
    wallpaper: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    voice: '<rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10v1a7 7 0 0014 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  };

  let _step = 0;

  function open() {
    _step = 0;
    _renderWelcome();
    document.getElementById('coolModal').classList.remove('hidden');
  }

  function _close() {
    document.getElementById('coolModal').classList.add('hidden');
  }

  function _features() {
    return FEATURE_IDS.map(id => ({
      id,
      title: t(`cool.${id}_title`),
      body: t(`cool.${id}_body`),
      icon: ICONS[id],
    }));
  }

  function _renderWelcome() {
    const box = document.getElementById('coolBody');
    box.innerHTML = `
      <div class="cool-hero">
        <div class="cool-orb"></div>
        <h1 class="cool-title">${t('cool.welcome_title')}</h1>
        <p class="cool-sub">${t('cool.welcome_sub')}</p>
        <button class="cool-cta" id="coolStart">${t('cool.begin')}</button>
      </div>`;
    document.getElementById('coolStart')?.addEventListener('click', () => { _step = 0; _renderStep(); });
  }

  function _renderStep() {
    const features = _features();
    const f = features[_step];
    const box = document.getElementById('coolBody');
    const last = _step === features.length - 1;

    // Live demo: first two steps toggle the real thing
    if (f.id === 'alive') { S.alive = true; _saveSett(); Appearance.apply(); }
    if (f.id === 'wallpaper') { S.wallpaper = '3'; _saveSett(); Appearance.apply(); }

    box.innerHTML = `
      <div class="cool-hero">
        <div class="cool-orb ${f.id}-orb"></div>
        <h1 class="cool-title">${f.title}</h1>
        <p class="cool-sub">${f.body}</p>
        ${f.id === 'wallpaper' ? `
        <div class="cool-walls">
          <button class="cool-wall w1" data-w="1"></button>
          <button class="cool-wall w2" data-w="2"></button>
          <button class="cool-wall w3" data-w="3"></button>
          <button class="cool-wall w4" data-w="4"></button>
          <button class="cool-wall w0" data-w="none">✕</button>
        </div>` : ''}
        <div class="cool-nav">
          ${_step > 0 ? `<button class="cool-back" id="coolPrev">${t('cool.back')}</button>` : '<span></span>'}
          <button class="cool-cta" id="coolNext">${last ? t('cool.apply_all') : t('cool.next')}</button>
        </div>
        <div class="cool-dots">${features.map((_, i) => `<span class="${i === _step ? 'on' : ''}"></span>`).join('')}</div>
      </div>`;

    document.getElementById('coolPrev')?.addEventListener('click', () => { _step--; _renderStep(); });
    document.getElementById('coolNext')?.addEventListener('click', async () => {
      if (last) {
        S.alive = true; S.wallpaper = S.wallpaper || '3'; _saveSett(); Appearance.apply();
        await uiAlert(t('cool.done_title'), t('cool.done_body'));
        _close();
        return;
      }
      _step++; _renderStep();
    });
    box.querySelectorAll('.cool-wall').forEach(b => b.addEventListener('click', () => {
      S.wallpaper = b.dataset.w; _saveSett(); Appearance.apply();
    }));
  }

  document.addEventListener('langchange', () => {
    if (!document.getElementById('coolModal')?.classList.contains('hidden')) {
      if (_step === 0 && document.getElementById('coolStart')) _renderWelcome();
      else if (document.getElementById('coolNext')) _renderStep();
    }
  });

  return { open };
})();