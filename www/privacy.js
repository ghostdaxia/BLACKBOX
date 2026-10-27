const PrivacyModule = (() => {
  function init() {
    document.getElementById('permAuditBtn')?.addEventListener('click', runPermAudit);
    document.getElementById('trackerCleanBtn')?.addEventListener('click', () => showTool('trackerTool'));
    document.getElementById('fingerprintBtn')?.addEventListener('click', () => showTool('fingerprintTool'));
    document.getElementById('urlScanBtn')?.addEventListener('click', () => showTool('urlScanTool'));

    document.getElementById('trackerToolBack')?.addEventListener('click', () => hideTool('trackerTool'));
    document.getElementById('urlScanToolBack')?.addEventListener('click', () => hideTool('urlScanTool'));
    document.getElementById('fingerprintToolBack')?.addEventListener('click', () => hideTool('fingerprintTool'));

    document.getElementById('trackerCleanAction')?.addEventListener('click', cleanUrl);
    document.getElementById('trackerCopy')?.addEventListener('click', () => {
      const output = document.getElementById('trackerOutput');
      if (output) { navigator.clipboard.writeText(output.textContent); toast(t('common.copied')); }
    });

    document.getElementById('urlScanAction')?.addEventListener('click', scanUrl);

    document.addEventListener('langchange', () => {
      if (!document.getElementById('fingerprintTool')?.classList.contains('hidden')) showFingerprint();
      else if (!document.getElementById('urlScanTool')?.classList.contains('hidden')) scanUrl();
    });
  }

  function showTool(id) {
    document.getElementById('privacyGrid')?.classList.add('hidden');
    document.querySelectorAll('.privacy-tool').forEach(t => t.classList.add('hidden'));
    document.getElementById(id)?.classList.remove('hidden');
    if (id === 'fingerprintTool') showFingerprint();
  }

  function hideTool(id) {
    document.getElementById(id)?.classList.add('hidden');
    document.getElementById('privacyGrid')?.classList.remove('hidden');
  }

  /* Permission Audit */
  function stateLabel(state) {
    return t({
      granted: 'privacy.state_granted',
      denied: 'privacy.state_denied',
      prompt: 'privacy.state_prompt',
      unknown: 'privacy.state_unknown',
      unsupported: 'privacy.state_unsupported',
    }[state] || 'privacy.state_unknown');
  }
  async function runPermAudit() {
    const perms = [
      {name:'privacy.perm_camera', api:'camera', check:() => queryPermission('camera')},
      {name:'privacy.perm_microphone', api:'microphone', check:() => queryPermission('microphone')},
      {name:'privacy.perm_geolocation', api:'geolocation', check:() => queryPermission('geolocation')},
      {name:'privacy.perm_notifications', api:'notifications', check:() => Notification.permission},
      {name:'privacy.perm_clipboard', api:'clipboard-read', check:() => queryPermission('clipboard-read')},
    ];
    const results = await Promise.all(perms.map(async p => {
      try { const state = await p.check(); return {name: t(p.name), state: stateLabel(state)}; } catch { return {name: t(p.name), state: stateLabel('unsupported')}; }
    }));
    const lines = results.map(r => `${r.name}: ${r.state}`).join('\n');
    await uiAlert(t('privacy.audit_title'), t('privacy.audit_intro') + '\n\n' + lines);
  }

  async function queryPermission(name) {
    if (!navigator.permissions) return 'unknown';
    try { const r = await navigator.permissions.query({name}); return r.state; } catch { return 'unknown'; }
  }

  /* Tracker Cleaner */
  function cleanUrl() {
    const input = document.getElementById('trackerInput')?.value?.trim();
    if (!input) return;
    try {
      const url = new URL(input);
      const trackerParams = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid','twclid','_hsenc','_hsmi','hsa_acc','hsa_cam','hsa_grp','hsa_ad','hsa_src','hsa_tgt','hsa_kw','hsa_mt','hsa_ol','hsa_net','ref','source','share'];
      const params = new URLSearchParams(url.search);
      let removed = 0;
      for (const key of [...params.keys()]) {
        if (trackerParams.some(t => key.toLowerCase().includes(t))) { params.delete(key); removed++; }
      }
      url.search = params.toString();
      const result = document.getElementById('trackerResult');
      const output = document.getElementById('trackerOutput');
      if (output) output.textContent = url.toString();
      if (result) result.classList.remove('hidden');
      toast(removed > 0 ? t('privacy.removed_n_trackers', removed) : t('privacy.no_trackers'));
    } catch {
      toast(t('privacy.invalid_url'), 'red');
    }
  }

  /* URL Scanner */
  function scanUrl() {
    const input = document.getElementById('urlScanInput')?.value?.trim();
    if (!input) return;
    const result = document.getElementById('urlScanResult');
    const output = document.getElementById('urlScanOutput');
    if (!result || !output) return;
    try {
      const url = new URL(input);
      const params = new URLSearchParams(url.search);
      const analysis = [
        {label: t('privacy.protocol'), value: url.protocol === 'https:' ? t('privacy.secure_https') : t('privacy.not_secure_http')},
        {label: t('privacy.domain'), value: url.hostname},
        {label: t('privacy.path'), value: url.pathname || '/'},
        {label: t('privacy.query_params'), value: params.size > 0 ? t('privacy.n_params', params.size) : t('privacy.none')},
        {label: t('privacy.trackers_found'), value: [...params.keys()].filter(k => ['utm_','fbclid','gclid','twclid'].some(x => k.includes(x))).length.toString()},
      ];
      output.innerHTML = analysis.map(a => `
        <div class="fp-item"><span class="fp-label">${a.label}</span><span class="fp-value">${a.value}</span></div>
      `).join('');
      result.classList.remove('hidden');
    } catch {
      toast(t('privacy.invalid_url'), 'red');
    }
  }

  /* Browser Fingerprint */
  function showFingerprint() {
    const output = document.getElementById('fingerprintOutput');
    if (!output) return;
    const items = [
      {label: t('privacy.user_agent'), value: navigator.userAgent.slice(0,80)+'…'},
      {label: t('privacy.language'), value: navigator.language},
      {label: t('privacy.platform'), value: navigator.platform},
      {label: t('privacy.screen'), value: `${screen.width}x${screen.height}`},
      {label: t('privacy.color_depth'), value: `${screen.colorDepth}-bit`},
      {label: t('privacy.cookies'), value: navigator.cookieEnabled ? t('privacy.enabled') : t('privacy.disabled')},
      {label: t('privacy.do_not_track'), value: navigator.doNotTrack || t('privacy.not_set')},
      {label: t('privacy.touch'), value: navigator.maxTouchPoints > 0 ? t('privacy.n_touch_points', navigator.maxTouchPoints) : t('privacy.touch_no')},
      {label: t('privacy.online'), value: navigator.onLine ? t('privacy.yes') : t('privacy.no')},
      {label: t('privacy.cores'), value: navigator.hardwareConcurrency || t('privacy.unknown')},
      {label: t('privacy.memory'), value: navigator.deviceMemory ? t('privacy.n_gb', navigator.deviceMemory) : t('privacy.unknown')},
    ];
    output.innerHTML = items.map(i => `
      <div class="fp-item"><span class="fp-label">${i.label}</span><span class="fp-value">${i.value}</span></div>
    `).join('');
  }

  function toast(msg, type) {
    const t = document.createElement('div');
    t.className = 'toast' + (type === 'red' ? ' red' : ' green');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2000);
  }

  return { init };
})();