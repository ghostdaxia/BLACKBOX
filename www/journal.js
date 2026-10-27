const JournalModule = (() => {
  let _entries = [];
  let _activeCat = 'all';
  let _editingId = null;
  let _viewingId = null; // read mode: entry is being read, not edited
  let _images = [];         // photo file ids attached to the entry being edited
  let _pendingImages = new Set(); // ids created during THIS edit (cleaned up if abandoned)
  let _thumbUrls = [];      // object URLs alive for the edit-mode thumb strip
  let _readUrls = [];       // object URLs alive for the read-mode photo grid
  let _mood = 0;            // 1–5 mood of the entry in view/edit (0 = none)
  let _fav = false;         // favorite flag of the entry in view/edit
  let _calMonth = null;     // Date (first of month) shown in the calendar panel
  let _dayFilter = null;    // 'YYYY-MM-DD' when the list is scoped to a single day
  let _locateQ = '';
  let _findOpen = false;
  let _findIdx = -1;
  let _promptDismissed = false;
  let _promptIdx = -1;

  const MOOD_EMOJI = ['😞', '😕', '😐', '🙂', '😄'];
  const MOOD_LABEL_KEYS = ['journal.mood_rough', 'journal.mood_low', 'journal.mood_okay', 'journal.mood_good', 'journal.mood_great'];
  function moodLabel(i) { return MOOD_LABEL_KEYS[i - 1] ? t(MOOD_LABEL_KEYS[i - 1]) : ''; }
  function moodEmoji(i) { return MOOD_EMOJI[i - 1] || ''; }

  const PROMPT_KEYS = [
    'journal.prompt_1', 'journal.prompt_2', 'journal.prompt_3', 'journal.prompt_4',
    'journal.prompt_5', 'journal.prompt_6', 'journal.prompt_7', 'journal.prompt_8',
    'journal.prompt_9', 'journal.prompt_10', 'journal.prompt_11', 'journal.prompt_12',
    'journal.prompt_13', 'journal.prompt_14', 'journal.prompt_15', 'journal.prompt_16',
    'journal.prompt_17', 'journal.prompt_18', 'journal.prompt_19', 'journal.prompt_20',
    'journal.prompt_21', 'journal.prompt_22',
  ];

  const TEMPLATE_KEYS = {
    daily: 'journal.tpl_daily',
    gratitude: 'journal.tpl_gratitude',
    goals: 'journal.tpl_goals',
    meeting: 'journal.tpl_meeting',
    travel: 'journal.tpl_travel',
  };

  const _dayKey = ts => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const _words = s => {
    if (!(s || '').trim()) return 0;
    if (I18n.getLang() === 'zh') {
      const cjk = (s.match(/[一-鿿㐀-䶿]/g) || []).length;
      const other = (s.replace(/[一-鿿㐀-䶿]/g, ' ').match(/[^\s]+/g) || []).length;
      return cjk + other;
    }
    return s.trim().split(/\s+/).length;
  };

  function catLabel(cat) {
    const map = {
      personal: 'journal.cat_personal',
      work: 'journal.cat_work',
      evidence: 'journal.cat_evidence',
      ideas: 'journal.cat_ideas',
    };
    return map[cat] ? t(map[cat]) : (cat || '');
  }

  function init() {
    document.getElementById('addEntryBtn')?.addEventListener('click', () => openForm(null));
    document.getElementById('closeJournalModal')?.addEventListener('click', () => closeForm(false));
    document.getElementById('cancelJournalBtn')?.addEventListener('click', () => closeForm(false));
    document.getElementById('journalDelete')?.addEventListener('click', deleteEditing);
    document.getElementById('journalMoreEdit')?.addEventListener('click', () => { _closeMenu(); editViewing(); });
    document.getElementById('journalReadEdit')?.addEventListener('click', editViewing);
    document.getElementById('journalReadClose')?.addEventListener('click', () => closeForm(false));
    document.getElementById('journalMoreBtn')?.addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('journalMoreMenu')?.classList.toggle('open');
    });
    // Tapping anywhere outside the menu closes it.
    document.addEventListener('click', e => {
      const menu = document.getElementById('journalMoreMenu');
      if (menu && menu.classList.contains('open') && !menu.contains(e.target)) {
        menu.classList.remove('open');
      }
    });
    document.getElementById('journalAttachBtn')?.addEventListener('click', () => document.getElementById('journalPhotoInput')?.click());
    document.getElementById('journalPhotoInput')?.addEventListener('change', async e => {
      const files = Array.from(e.target.files || []);
      let failed = 0;
      for (const f of files) {
        try {
          const id = await Vault.saveFile(f); // encrypted like every other file
          _images.push(id);
          _pendingImages.add(id); // unlinked again if the edit is abandoned
        } catch { failed++; }
      }
      e.target.value = '';
      _renderThumbs();
      if (failed) await uiAlert(t('journal.photos_alert_title'), t('journal.photos_failed_toast', failed));
    });
    document.getElementById('journalMoreFav')?.addEventListener('click', () => { _closeMenu(); toggleFav(); });
    document.getElementById('journalMoreExport')?.addEventListener('click', () => { _closeMenu(); exportEntry(); });
    document.getElementById('journalMoreFind')?.addEventListener('click', () => { _closeMenu(); _openFind(); });
    document.getElementById('journalFindInput')?.addEventListener('input', () => _runFind(true));
    document.getElementById('journalFindInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); _stepFind(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); _closeFind(); }
    });
    document.getElementById('journalFindPrev')?.addEventListener('click', () => _stepFind(-1));
    document.getElementById('journalFindNext')?.addEventListener('click', () => _stepFind(1));
    document.getElementById('journalFindClose')?.addEventListener('click', _closeFind);
    document.getElementById('journalCalBtn')?.addEventListener('click', _toggleCalendar);
    document.getElementById('calPrev')?.addEventListener('click', () => _stepMonth(-1));
    document.getElementById('calNext')?.addEventListener('click', () => _stepMonth(1));
    document.getElementById('journalDayFilterClear')?.addEventListener('click', () => {
      _dayFilter = null;
      _syncDayFilter();
      render();
    });
    document.getElementById('calGrid')?.addEventListener('click', e => {
      const cell = e.target.closest('.cal-cell.has');
      if (!cell) return;
      _dayFilter = _dayFilter === cell.dataset.key ? null : cell.dataset.key;
      _syncDayFilter();
      render();
    });
    document.getElementById('journalMood')?.addEventListener('click', e => {
      const btn = e.target.closest('.mood-opt');
      if (!btn) return;
      const m = +btn.dataset.mood;
      _mood = _mood === m ? 0 : m; // tap the same mood again to clear it
      _syncMood();
    });
    document.getElementById('journalTemplate')?.addEventListener('change', e => {
      if (_editingId) { e.target.value = ''; return; } // never inject into an existing entry
      const key = TEMPLATE_KEYS[e.target.value];
      if (key) _fillBody(t(key));
    });
    document.getElementById('journalPromptShuffle')?.addEventListener('click', () => _showPrompt(_nextPrompt()));
    document.getElementById('journalPromptUse')?.addEventListener('click', () => {
      const t = document.getElementById('journalPromptText')?.textContent;
      if (t) _fillBody(t);
    });
    document.getElementById('journalPromptHide')?.addEventListener('click', () => {
      _promptDismissed = true;
      document.getElementById('journalPromptCard')?.classList.add('hidden');
    });
    document.getElementById('journalForm')?.addEventListener('submit', async e => { e.preventDefault(); await saveForm(); });
    document.getElementById('journalSearch')?.addEventListener('input', render);
    document.querySelectorAll('#journalPills .pill').forEach(p => {
      p.addEventListener('click', () => {
        document.querySelectorAll('#journalPills .pill').forEach(x => x.classList.remove('active'));
        p.classList.add('active');
        _activeCat = p.dataset.cat;
        render();
      });
    });
    document.querySelector('#journalModal .modal-backdrop')?.addEventListener('click', () => closeForm(false));

    document.addEventListener('langchange', () => {
      render();
      const cur = currentEntry();
      if (cur) {
        if (_viewingId) openRead(cur);
        else if (_editingId) _renderThumbs();
      }
    });
  }

  async function refresh() {
    if (!Vault.isUnlocked()) return;
    _entries = await Vault.getAllEntries();
    render();
  }

  function _query() {
    return (document.getElementById('journalSearch')?.value || '').trim();
  }

  function _escRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function _highlight(escaped, q) {
    if (!q || !escaped) return escaped;
    const needle = _escRegex(Vault.esc(q));
    if (!needle) return escaped;
    return escaped.replace(new RegExp(needle, 'gi'), m => `<mark class="jnl-mark">${m}</mark>`);
  }

  function render() {
    const list = document.getElementById('journalList');
    if (!list) return;
    const qRaw = _query();
    const q = qRaw.toLowerCase();
    let filtered = _entries;
    if (_activeCat === '__fav') filtered = filtered.filter(e => e.fav);
    else if (_activeCat !== 'all') filtered = filtered.filter(e => e.category === _activeCat);
    if (_dayFilter) filtered = filtered.filter(e => _dayKey(e.ts) === _dayFilter);
    if (q) filtered = filtered.filter(e => e.title.toLowerCase().includes(q) || e.body.toLowerCase().includes(q) || (e.tags || []).join(' ').toLowerCase().includes(q));

    if (filtered.length === 0) {
      const emptyMsg = q ? t('journal.empty_search')
        : _dayFilter ? t('journal.empty_day')
        : _activeCat === '__fav' ? t('journal.empty_favorites')
        : t('journal.empty_default');
      list.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="40" height="40"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg><p>${emptyMsg}</p></div>`;
      _renderStats();
      _renderCal();
      return;
    }

    list.innerHTML = filtered.map(e => `
      <div class="journal-item" data-id="${e.id}">
        <div class="journal-item-header">
          <span class="journal-item-title">${e.fav ? '<span class="fav-star">★</span> ' : ''}${_highlight(Vault.esc(e.title), qRaw)}</span>
          <span class="journal-item-cat">${catLabel(e.category)}${e.mood ? ` <span class="journal-item-mood">${moodEmoji(e.mood)}</span>` : ''}</span>
        </div>
        <div class="journal-item-body">${_highlight(Vault.esc(e.body), qRaw)}</div>
        <div class="journal-item-date">${Vault.relTime(e.ts)}${e.images && e.images.length ? t('journal.n_photos_badge', e.images.length) : ''}</div>
      </div>
    `).join('');

    // Tap opens the entry in read mode — a diary entry is for reading first.
    list.querySelectorAll('.journal-item').forEach(el => {
      el.addEventListener('click', () => {
        const entry = _entries.find(x => x.id === el.dataset.id);
        if (entry) {
          _locateQ = qRaw;
          openRead(entry, !!qRaw);
        }
      });
    });
    _renderStats();
    _renderCal();
  }

  function currentEntry() {
    return _entries.find(x => x.id === (_editingId || _viewingId)) || null;
  }

  function editViewing() {
    const entry = currentEntry();
    if (entry) openForm(entry);
  }

  function _closeMenu() {
    document.getElementById('journalMoreMenu')?.classList.remove('open');
  }

  function _setMode(viewing) {
    document.getElementById('journalReadView')?.classList.toggle('hidden', !viewing);
    document.getElementById('journalForm')?.classList.toggle('hidden', viewing);
  }

  // Read mode: full panel with the entry rendered as readable prose.
  function openRead(e, locate) {
    _viewingId = e.id;
    _editingId = null;
    _findOpen = false;
    _findIdx = -1;
    document.getElementById('journalFindBar')?.classList.add('hidden');
    const findInput = document.getElementById('journalFindInput');
    if (findInput) findInput.value = '';
    document.getElementById('journalModalTitle').textContent = t('journal.modal_view');
    document.getElementById('journalReadTitle').innerHTML = _highlight(Vault.esc(e.title || t('journal.untitled')), _locateQ);
    document.getElementById('journalReadCat').textContent = catLabel(e.category);
    document.getElementById('journalReadDate').textContent = Vault.relTime(e.ts);
    document.getElementById('journalReadBody').innerHTML = _highlight(Vault.esc(e.body), _locateQ);
    _renderReadMeta(e);
    _renderReadPhotos(e);
    _fav = !!e.fav;
    _mood = typeof e.mood === 'number' ? e.mood : 0;
    _setMode(true);
    document.getElementById('journalMoreBtn')?.classList.remove('hidden');
    document.getElementById('journalMoreFind')?.classList.remove('hidden');
    document.getElementById('journalMoreEdit')?.classList.remove('hidden');
    document.getElementById('journalMoreExport')?.classList.remove('hidden');
    document.getElementById('journalMoreEditDiv')?.classList.remove('hidden');
    document.getElementById('journalDelete')?.classList.remove('hidden');
    const favBtn = document.getElementById('journalMoreFav');
    if (favBtn) {
      favBtn.textContent = e.fav ? t('journal.more_fav_remove') : t('journal.more_fav_add');
      favBtn.classList.remove('hidden');
    }
    _closeMenu();
    const modal = document.getElementById('journalModal');
    modal.classList.remove('hidden');
    const view = document.getElementById('journalReadView');
    if (view) view.scrollTop = 0;
    if (locate && _locateQ && view) {
      requestAnimationFrame(() => requestAnimationFrame(() => _locateFirstHit(view)));
    }
  }

  function _locateFirstHit(view) {
    const hit = document.querySelector('#journalReadBody .jnl-mark')
      || document.querySelector('#journalReadTitle .jnl-mark');
    if (!hit) return;
    hit.scrollIntoView({ block: 'center', behavior: 'smooth' });
    hit.classList.add('jnl-mark-locate');
    setTimeout(() => hit.classList.remove('jnl-mark-locate'), 1600);
  }

  function _paintReadHighlight(entry, q) {
    if (!entry) return;
    const titleEl = document.getElementById('journalReadTitle');
    const bodyEl = document.getElementById('journalReadBody');
    if (titleEl) titleEl.innerHTML = _highlight(Vault.esc(entry.title || t('journal.untitled')), q);
    if (bodyEl) bodyEl.innerHTML = _highlight(Vault.esc(entry.body), q);
  }

  function _findMarks() {
    return Array.from(document.querySelectorAll('#journalReadTitle .jnl-mark, #journalReadBody .jnl-mark'));
  }

  function _openFind() {
    if (!currentEntry()) return;
    _findOpen = true;
    const bar = document.getElementById('journalFindBar');
    const input = document.getElementById('journalFindInput');
    bar?.classList.remove('hidden');
    if (input) {
      if (!input.value && _locateQ) input.value = _locateQ;
      input.focus();
      input.select();
    }
    _runFind(true);
  }

  function _closeFind() {
    _findOpen = false;
    _findIdx = -1;
    document.getElementById('journalFindBar')?.classList.add('hidden');
    const count = document.getElementById('journalFindCount');
    if (count) count.textContent = '';
    document.getElementById('journalFindInput')?.classList.remove('nomatch');
    _paintReadHighlight(currentEntry(), _locateQ);
  }

  function _syncCurrentMark(marks) {
    marks.forEach((m, i) => m.classList.toggle('jnl-current', i === _findIdx));
    const cur = marks[_findIdx];
    if (cur) cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function _runFind(resetIdx) {
    const entry = currentEntry();
    if (!entry || !_findOpen) return;
    const input = document.getElementById('journalFindInput');
    const countEl = document.getElementById('journalFindCount');
    const q = (input?.value || '').trim();
    _paintReadHighlight(entry, q);
    const marks = _findMarks();
    input?.classList.toggle('nomatch', !!q && marks.length === 0);
    if (!q) {
      _findIdx = -1;
      if (countEl) countEl.textContent = '';
      return;
    }
    if (marks.length === 0) {
      _findIdx = -1;
      if (countEl) countEl.textContent = t('journal.find_no_match');
      return;
    }
    if (resetIdx || _findIdx < 0 || _findIdx >= marks.length) _findIdx = 0;
    if (countEl) countEl.textContent = t('journal.find_count', _findIdx + 1, marks.length);
    _syncCurrentMark(marks);
  }

  function _stepFind(dir) {
    const marks = _findMarks();
    if (!marks.length) return;
    _findIdx = (_findIdx + dir + marks.length) % marks.length;
    const countEl = document.getElementById('journalFindCount');
    if (countEl) countEl.textContent = t('journal.find_count', _findIdx + 1, marks.length);
    _syncCurrentMark(marks);
  }

  function openForm(e) {
    _editingId = e ? e.id : null;
    _viewingId = null;
    document.getElementById('journalModalTitle').textContent = e ? t('journal.modal_edit') : t('journal.modal_new');
    document.getElementById('journalTitle').value = e ? e.title : '';
    document.getElementById('journalCategory').value = e ? e.category : 'personal';
    document.getElementById('journalBody').value = e ? e.body : '';
    _images = Array.isArray(e && e.images) ? [...e.images] : [];
    _pendingImages.clear();
    _renderThumbs();
    document.getElementById('journalTags').value = e && Array.isArray(e.tags) ? e.tags.join(', ') : '';
    document.getElementById('journalTemplate').value = '';
    _mood = e && typeof e.mood === 'number' ? e.mood : 0;
    _fav = !!(e && e.fav);
    _syncMood();
    // The prompt card is a blank-page helper — new entries only.
    const pc = document.getElementById('journalPromptCard');
    if (pc) {
      if (!e && !_promptDismissed) { _showPrompt(_nextPrompt()); pc.classList.remove('hidden'); }
      else pc.classList.add('hidden');
    }
    _setMode(false);
    // Delete option only makes sense for an existing entry — the 3-dot menu
    // in the top bar carries it now instead of a third button in the action row.
    const del = document.getElementById('journalDelete');
    if (del) del.classList.toggle('hidden', !e);
    // "Edit entry" is meaningless while already editing (divider hides with it).
    document.getElementById('journalMoreEdit')?.classList.add('hidden');
    document.getElementById('journalMoreEditDiv')?.classList.add('hidden');
    document.getElementById('journalMoreFav')?.classList.add('hidden');
    document.getElementById('journalMoreExport')?.classList.add('hidden');
    document.getElementById('journalMoreFind')?.classList.add('hidden');
    document.getElementById('journalFindBar')?.classList.add('hidden');
    _findOpen = false;
    const moreBtn = document.getElementById('journalMoreBtn');
    if (moreBtn) moreBtn.classList.toggle('hidden', !e);
    _closeMenu();
    document.getElementById('journalModal').classList.remove('hidden');
  }

  function _revokeUrls(arr) { arr.forEach(u => URL.revokeObjectURL(u)); }

  // Edit-mode thumbnail strip: decrypt previews, one remove button per photo.
  function _renderThumbs() {
    const wrap = document.getElementById('journalThumbs');
    if (!wrap) return;
    _revokeUrls(_thumbUrls); _thumbUrls = [];
    if (!_images.length) {
      wrap.innerHTML = `<span class="journal-thumbs-empty">${t('journal.no_photos')}</span>`;
      return;
    }
    wrap.innerHTML = _images.map((id, i) => `
      <div class="jthumb" data-i="${i}">
        <span class="jthumb-ph"></span>
        <button type="button" class="jthumb-x" data-i="${i}" title="${t('journal.remove_photo')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="10" height="10"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`).join('');
    wrap.querySelectorAll('.jthumb').forEach(el => {
      const id = _images[+el.dataset.i];
      Vault.getFileBlob(id).then(blob => {
        if (!blob || !el.isConnected) return;
        const url = URL.createObjectURL(blob);
        if (!el.isConnected) { URL.revokeObjectURL(url); return; }
        _thumbUrls.push(url);
        const tag = (blob.type || '').startsWith('video/') ? `<video src="${url}" muted playsinline></video>` : `<img src="${url}" alt=""/>`;
        el.insertAdjacentHTML('afterbegin', tag);
      }).catch(() => {});
    });
    wrap.querySelectorAll('.jthumb-x').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const i = +btn.dataset.i;
        const id = _images[i];
        _images.splice(i, 1);
        // Only photos added during THIS edit session get deleted from the
        // vault; pre-existing ones stay in the file vault (they may be
        // referenced elsewhere) — the entry simply unlinks from them.
        if (_pendingImages.has(id)) {
          _pendingImages.delete(id);
          Vault.deleteFile(id).catch(() => {});
        }
        _renderThumbs();
      });
    });
  }

  // Read-mode photo grid: tap opens the shared full-screen viewer.
  function _renderReadPhotos(entry) {
    const wrap = document.getElementById('journalPhotos');
    if (!wrap) return;
    _revokeUrls(_readUrls); _readUrls = [];
    const ids = Array.isArray(entry.images) ? entry.images : [];
    wrap.innerHTML = '';
    wrap.classList.toggle('hidden', ids.length === 0);
    ids.forEach((id, i) => {
      const cell = document.createElement('div');
      cell.className = 'journal-photo';
      cell.innerHTML = `<span class="jthumb-ph"></span>`;
      cell.addEventListener('click', () => {
        if (typeof FilesManager !== 'undefined') FilesManager.openViewer(ids, i);
      });
      wrap.appendChild(cell);
      Vault.getFileBlob(id).then(blob => {
        if (!blob) { cell.remove(); return; } // deleted from the vault since
        const url = URL.createObjectURL(blob);
        if (!cell.isConnected) { URL.revokeObjectURL(url); return; }
        _readUrls.push(url);
        const tag = (blob.type || '').startsWith('video/') ? `<video src="${url}" muted playsinline></video>` : `<img src="${url}" alt=""/>`;
        cell.innerHTML = tag;
      }).catch(() => {});
    });
  }

  function closeForm(keepData) {
    const modal = document.getElementById('journalModal');
    const form = document.getElementById('journalForm');
    if (!keepData) form.reset();
    // Photos added in this session but never saved must not linger as orphans
    // in the file vault. Saved ones are owned by the entry from here on.
    if (!keepData) for (const id of _pendingImages) Vault.deleteFile(id).catch(() => {});
    _pendingImages.clear();
    _images = [];
    _mood = 0;
    _fav = false;
    _revokeUrls(_thumbUrls); _thumbUrls = [];
    _revokeUrls(_readUrls); _readUrls = [];
    _editingId = null;
    _viewingId = null;
    _locateQ = '';
    _findOpen = false;
    _findIdx = -1;
    const findCount = document.getElementById('journalFindCount');
    if (findCount) findCount.textContent = '';
    document.getElementById('journalFindInput')?.classList.remove('nomatch');
    _setMode(false); // next open starts from the form (Add entry)
    _closeMenu();
    modal.classList.add('hidden');
  }

  /* ── Premium journal: stats, calendar, moods, prompts, favorites ──
     Everything below computes locally over encrypted entry data — the
     offline answer to the paid tiers of Day One / Stoic / Daylio. */

  function _syncMood() {
    document.querySelectorAll('#journalMood .mood-opt').forEach(b => b.classList.toggle('active', +b.dataset.mood === _mood));
  }

  // Never overwrites what's already written: fills an empty page, appends otherwise.
  function _fillBody(text) {
    const b = document.getElementById('journalBody');
    if (!b) return;
    b.value = b.value.trim() ? b.value.trimEnd() + '\n\n' + text : text;
    b.focus();
  }

  function _nextPrompt() {
    if (!PROMPT_KEYS.length) return '';
    let i;
    do { i = Math.floor(Math.random() * PROMPT_KEYS.length); } while (PROMPT_KEYS.length > 1 && i === _promptIdx);
    _promptIdx = i;
    return t(PROMPT_KEYS[i]);
  }
  function _showPrompt(text) {
    const el = document.getElementById('journalPromptText');
    if (el) el.textContent = text;
  }

  function _syncDayFilter() {
    const chip = document.getElementById('journalDayFilter');
    if (!chip) return;
    chip.classList.toggle('hidden', !_dayFilter);
    if (_dayFilter) {
      const d = new Date(_dayFilter + 'T00:00:00');
      const label = document.getElementById('journalDayFilterLabel');
      if (label) label.textContent = t('journal.day_filter_label', d.toLocaleDateString(I18n.getLang() === 'zh' ? 'zh-CN' : undefined, { weekday: 'long', month: 'short', day: 'numeric' }));
    }
  }

  function _toggleCalendar() {
    const cal = document.getElementById('journalCalendar');
    if (!cal) return;
    const opening = cal.classList.contains('hidden');
    if (opening && !_calMonth) _calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    cal.classList.toggle('hidden', !opening);
    if (opening) _renderCal();
  }
  function _stepMonth(d) {
    if (!_calMonth) _calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    _calMonth = new Date(_calMonth.getFullYear(), _calMonth.getMonth() + d, 1);
    _renderCal();
  }

  function _renderStats() {
    const el = document.getElementById('journalStats');
    if (!el) return;
    if (!_entries.length) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const days = new Set(_entries.map(e => _dayKey(e.ts)));
    let streak = 0;
    const cursor = new Date();
    if (!days.has(_dayKey(cursor))) cursor.setDate(cursor.getDate() - 1); // an unwritten today doesn't break it yet
    while (days.has(_dayKey(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
    const words = _entries.reduce((s, e) => s + _words(e.body), 0);
    const photos = _entries.reduce((s, e) => s + (Array.isArray(e.images) ? e.images.length : 0), 0);
    el.innerHTML = [
      streak ? `<span class="js-item js-hot">${t('journal.streak_n', streak)}</span>` : `<span class="js-item">${t('journal.streak_start')}</span>`,
      `<span class="js-item"><b>${_entries.length}</b> ${t('journal.unit_entries')}</span>`,
      `<span class="js-item"><b>${words.toLocaleString()}</b> ${t('journal.unit_words')}</span>`,
      `<span class="js-item">📷 <b>${photos}</b></span>`,
    ].join('');
  }

  function _renderCal() {
    const grid = document.getElementById('calGrid');
    if (!grid || !_calMonth) return;
    const title = document.getElementById('calTitle');
    if (title) title.textContent = _calMonth.toLocaleDateString(I18n.getLang() === 'zh' ? 'zh-CN' : undefined, { month: 'long', year: 'numeric' });
    const byDay = new Map();
    for (const e of _entries) {
      const k = _dayKey(e.ts);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(e);
    }
    const y = _calMonth.getFullYear(), m = _calMonth.getMonth();
    const lead = new Date(y, m, 1).getDay();
    const daysIn = new Date(y, m + 1, 0).getDate();
    let html = '';
    for (let i = 0; i < lead; i++) html += `<span class="cal-cell"></span>`;
    for (let d = 1; d <= daysIn; d++) {
      const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const list = byDay.get(key);
      let cls = 'cal-cell';
      if (list) {
        cls += ' has';
        const moods = list.map(e => e.mood).filter(mm => typeof mm === 'number');
        if (moods.length) {
          const avg = Math.round(moods.reduce((a, b) => a + b, 0) / moods.length);
          cls += ` m${Math.max(1, Math.min(5, avg))}`; // Daylio-style mood tint
        }
      }
      if (_dayFilter === key) cls += ' sel';
      html += `<button type="button" class="${cls}" data-key="${key}"${list ? '' : ' disabled'}>${d}</button>`;
    }
    grid.innerHTML = html;
  }

  function _renderReadMeta(e) {
    const moodEl = document.getElementById('journalReadMood');
    if (moodEl) {
      const has = e.mood >= 1 && e.mood <= 5;
      moodEl.classList.toggle('hidden', !has);
      if (has) moodEl.textContent = `${moodEmoji(e.mood)} ${moodLabel(e.mood)}`;
    }
    const dateEl = document.getElementById('journalReadDate');
    if (dateEl) dateEl.textContent = new Date(e.ts).toLocaleDateString(I18n.getLang() === 'zh' ? 'zh-CN' : undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const stats = document.getElementById('journalReadStats');
    if (stats) {
      const parts = [t('journal.read_n_words', _words(e.body))];
      if (Array.isArray(e.images) && e.images.length) parts.push(t('journal.read_n_photos', e.images.length));
      stats.textContent = parts.join(' · ');
      stats.classList.remove('hidden');
    }
    const tagsEl = document.getElementById('journalReadTags');
    if (tagsEl) {
      const tags = Array.isArray(e.tags) ? e.tags : [];
      tagsEl.classList.toggle('hidden', tags.length === 0);
      tagsEl.innerHTML = tags.map(t => `<span class="tag-chip">#${Vault.esc(String(t))}</span>`).join('');
    }
  }

  async function toggleFav() {
    const e = currentEntry();
    if (!e) return;
    const nv = !e.fav;
    // Full rewrite via saveEntry — ts keeps the entry on its original diary date.
    await Vault.saveEntry({ id: e.id, title: e.title, body: e.body, category: e.category,
      tags: e.tags, images: e.images, mood: e.mood, fav: nv || undefined, ts: e.ts });
    e.fav = nv;
    const favBtn = document.getElementById('journalMoreFav');
    if (favBtn) favBtn.textContent = nv ? t('journal.more_fav_remove') : t('journal.more_fav_add');
    render(); // star + Favorites pill reflect the change
  }

  async function exportEntry() {
    const e = currentEntry();
    if (!e) return;
    const moodLine = e.mood >= 1 && e.mood <= 5 ? ` · ${moodLabel(e.mood)}` : '';
    const lines = [e.title, `${new Date(e.ts).toLocaleString()} · ${catLabel(e.category)}${moodLine}`];
    if (Array.isArray(e.tags) && e.tags.length) lines.push(t('journal.export_tags', e.tags.join(', ')));
    lines.push('', e.body);
    if (Array.isArray(e.images) && e.images.length) lines.push('', t('journal.export_photos_n', e.images.length));
    const name = ((e.title || '').replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || t('journal.export_default_name')) + '.txt';
    try {
      const res = await Vault.saveUnwrapped(name, new Blob([lines.join('\n')], { type: 'text/plain' }));
      await uiAlert(t('journal.exported_title'), res && res.uri ? t('journal.exported_body_docs', name) : t('journal.exported_body_downloads', name));
    } catch {
      await uiAlert(t('journal.export_failed_title'), t('journal.export_failed_body'));
    }
  }

  async function deleteEditing() {
    const entry = currentEntry();
    closeForm();
    if (!entry) return;
    if (await uiConfirm(t('journal.delete_title'), t('journal.delete_confirm_name', entry.title), { danger: true, okLabel: t('common.delete') })) {
      await Vault.deleteEntry(entry.id);
      await refresh();
    }
  }

  async function saveForm() {
    const title = document.getElementById('journalTitle').value.trim() || t('journal.untitled');
    const body = document.getElementById('journalBody').value.trim();
    const category = document.getElementById('journalCategory').value;
    if (!body) {
      await uiAlert(t('journal.save_empty_title'), t('journal.save_empty_body'));
      return;
    }
    const tags = document.getElementById('journalTags').value.split(',').map(t => t.trim()).filter(Boolean).slice(0, 8);
    const prev = _editingId ? _entries.find(x => x.id === _editingId) : null;
    await Vault.saveEntry({
      id: _editingId, title, body, category,
      images: [..._images],
      tags: tags.length ? tags : undefined,   // clearing all tags wipes the field
      mood: _mood || undefined,               // mood 0 clears the mood
      fav: _fav || undefined,
      ts: prev ? prev.ts : undefined,         // edits keep the original diary date
    });
    _pendingImages.clear(); // the entry owns these photos now
    closeForm(true);
    await refresh();
  }

  return { init, refresh };
})();