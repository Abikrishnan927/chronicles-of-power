(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const deployment = window.COPDeployment;
  const accountConfigured = Boolean(deployment?.accountApiConfigured && deployment.accountApiBaseUrl);
  let user = null;
  let autosaveTimer = null;
  let saveQueue = Promise.resolve();

  function endpoint(path) {
    if (!accountConfigured) {
      throw new Error('Account services are not configured. Set ACCOUNT_API_BASE_URL in the local server environment or COP_ACCOUNT_API_BASE_URL for static hosting.');
    }
    return new URL(path.replace(/^\/+/, ''), `${deployment.accountApiBaseUrl.replace(/\/+$/, '')}/`).href;
  }

  async function request(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const csrfResponse = await fetch(endpoint('api/auth/csrf/'), { credentials: 'include' });
      if (!csrfResponse.ok) throw new Error(`Could not establish a secure session (HTTP ${csrfResponse.status}).`);
      const csrf = await csrfResponse.json();
      headers.set('X-CSRFToken', csrf.csrfToken);
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(endpoint(path), {
      ...options,
      method,
      headers,
      credentials: 'include',
    });
    if (response.status === 204) return null;
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`The account service returned an unreadable response (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      const message = formatApiError(data);
      const error = new Error(message);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function formatApiError(data) {
    if (typeof data?.detail === 'string') return data.detail;
    if (Array.isArray(data?.non_field_errors)) return data.non_field_errors.join(' ');
    if (data && typeof data === 'object') {
      return Object.entries(data).map(([field, messages]) => {
        const label = field === 'detail' ? '' : `${field.replaceAll('_', ' ')}: `;
        return `${label}${Array.isArray(messages) ? messages.join(' ') : String(messages)}`;
      }).join(' ');
    }
    return 'The account request could not be completed.';
  }

  function setAccountUi() {
    $('#login-link')?.classList.toggle('hidden', Boolean(user));
    $('#register-link')?.classList.toggle('hidden', Boolean(user));
    $('#logout-link')?.classList.toggle('hidden', !user);
    $('#dashboard-link')?.classList.toggle('hidden', !user);
    const avatar = $('#account-button');
    if (avatar) {
      avatar.textContent = user ? (user.displayName || user.username).slice(0, 1).toUpperCase() : 'A';
      avatar.title = user ? `Player account: ${user.displayName || user.username}` : 'Sign in or create an account';
    }
    $('#save-button')?.classList.toggle('account-save-enabled', Boolean(user));
  }

  function showMessage(message, isError = false) {
    const node = $('#account-message');
    if (node) {
      node.textContent = message;
      node.classList.toggle('error', isError);
      node.classList.toggle('success', !isError);
    }
    if (message && !$('#account-message')) window.notify?.(message);
  }

  function closeModal() {
    $('#modal-backdrop')?.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function showAuth(mode = 'login') {
    const backdrop = $('#modal-backdrop');
    const modal = $('#modal-content');
    const titles = {
      login: ['RETURN TO YOUR CAMPAIGN', 'Sign in'],
      register: ['JOIN THE CHRONICLE', 'Create your account'],
      reset: ['ACCOUNT RECOVERY', 'Reset your password'],
      'reset-confirm': ['ACCOUNT RECOVERY', 'Choose a new password'],
    };
    const [kicker, title] = titles[mode] || titles.login;
    const resetParams = new URLSearchParams(location.search);
    const form = mode === 'register'
      ? `<label>Username<input name="username" autocomplete="username" maxlength="150" required></label><label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" required></label><label>Password<input name="password" type="password" autocomplete="new-password" minlength="10" required></label><label>Confirm password<input name="confirm_password" type="password" autocomplete="new-password" minlength="10" required></label><button class="primary-button" type="submit">CREATE ACCOUNT</button><button class="account-text-button" type="button" data-auth-mode="login">Already have an account? Sign in</button>`
      : mode === 'reset'
        ? `<label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" required></label><button class="primary-button" type="submit">REQUEST RESET</button><button class="account-text-button" type="button" data-auth-mode="login">Return to sign in</button>`
        : mode === 'reset-confirm'
          ? `<input type="hidden" name="uid" value="${escapeHtml(resetParams.get('uid') || '')}"><input type="hidden" name="token" value="${escapeHtml(resetParams.get('token') || '')}"><label>New password<input name="new_password" type="password" autocomplete="new-password" minlength="10" required></label><label>Confirm new password<input name="confirm_password" type="password" autocomplete="new-password" minlength="10" required></label><button class="primary-button" type="submit">UPDATE PASSWORD</button>`
          : `<label>Username or email<input name="username_or_email" autocomplete="username" maxlength="254" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="primary-button" type="submit">SIGN IN</button><button class="account-text-button" type="button" data-auth-mode="reset">Forgot password?</button><button class="account-text-button" type="button" data-auth-mode="register">Create an account</button>`;
    modal.className = 'modal account-modal';
    modal.innerHTML = `<button class="account-modal-close" type="button" aria-label="Close">×</button><div class="eyebrow">${kicker}</div><h2>${title}</h2><p class="account-intro">Your campaign saves and progress are stored with your account.</p><div id="account-message" class="account-message" role="status"></div><form id="account-form" data-mode="${mode}">${form}</form>`;
    backdrop.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    $('.account-modal-close', modal).onclick = closeModal;
    modal.querySelectorAll('[data-auth-mode]').forEach(button => button.addEventListener('click', () => showAuth(button.dataset.authMode)));
    $('#account-form', modal).addEventListener('submit', submitAuth);
    modal.querySelectorAll('input[type="password"]').forEach(input => {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'account-text-button';
      toggle.textContent = 'Show password';
      toggle.addEventListener('click', () => {
        const reveal = input.type === 'password';
        input.type = reveal ? 'text' : 'password';
        toggle.textContent = reveal ? 'Hide password' : 'Show password';
      });
      input.insertAdjacentElement('afterend', toggle);
    });
    if (!accountConfigured) showMessage('Account backend not configured. The game remains available with device-only saves.', true);
  }

  async function submitAuth(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const mode = form.dataset.mode;
    const payload = Object.fromEntries(new FormData(form));
    const submit = $('button[type="submit"]', form);
    submit.disabled = true;
    try {
      if (mode === 'login' || mode === 'register') {
        user = await request(`api/auth/${mode}/`, {
          method: 'POST',
          body: JSON.stringify(mode === 'login' ? payload : payload),
        });
        if (mode === 'register') {
          user = { ...user, displayName: user.displayName || user.username };
        }
        setAccountUi();
        closeModal();
        await openDashboard();
      } else if (mode === 'reset') {
        const result = await request('api/auth/password-reset/', { method: 'POST', body: JSON.stringify(payload) });
        showMessage(result.detail);
      } else {
        const result = await request('api/auth/password-reset/confirm/', { method: 'POST', body: JSON.stringify(payload) });
        showMessage(result.detail);
        window.setTimeout(() => showAuth('login'), 1200);
      }
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      submit.disabled = false;
    }
  }

  function readableDate(value) {
    if (!value) return 'Not recorded';
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? escapeHtml(value) : date.toLocaleString();
  }

  function campaignTitle(id) {
    const event = window.COPContent?.EVENTS?.find(item => item.id === id);
    return event?.title || id || 'Campaign';
  }

  async function openDashboard() {
    if (!user) {
      showAuth('login');
      return;
    }
    window.setView?.('account');
    const container = $('#account-content');
    container.innerHTML = '<div class="account-loading">Loading your saved campaigns…</div>';
    try {
      const [summary, profile] = await Promise.all([
        request('api/progress/'),
        request('api/profile/'),
      ]);
      const stats = summary.stats;
      const saves = summary.saves || [];
      const lastCampaign = summary.campaigns?.[0];
      const lastSave = saves.find(save => save.id === lastCampaign?.last_save) ||
        saves.find(save => save.campaign_id === lastCampaign?.campaign_id) || saves[0];
      const hasCurrentGame = Boolean(window.COPRuntime?.currentGame?.());
      container.innerHTML = `
        <section class="account-heading"><div><div class="eyebrow"><span class="live-dot"></span> PLAYER COMMAND</div><h1>Welcome back, <em>${escapeHtml(profile.display_name || user.displayName || user.username)}.</em></h1><p>Your campaigns and decisions, secured to your account.</p></div><div><button class="primary-button" data-account-action="new-save" ${hasCurrentGame ? '' : 'disabled'}>SAVE CURRENT GAME AS…</button><button class="history-link" data-account-action="bookmark-current" ${hasCurrentGame ? '' : 'disabled'}>BOOKMARK THIS SCENARIO</button></div></section>
        <section class="account-panel account-welcome"><div class="account-emblem">${escapeHtml((profile.display_name || user.username).slice(0, 1).toUpperCase())}</div><div><span class="eyebrow">CONTINUE PLAYING</span><h2>${lastSave ? escapeHtml(campaignTitle(lastSave.campaign_id)) : 'No campaign saved yet'}</h2><p>${lastSave ? `Turn ${lastSave.turn} · ${escapeHtml(lastSave.game_date || 'Date not recorded')} · Last saved ${readableDate(lastSave.updated_at)}` : 'Begin a campaign and your progress will be saved here.'}</p></div>${lastSave ? `<button class="primary-button" data-account-action="resume" data-save-id="${escapeHtml(lastSave.id)}">CONTINUE →</button>` : ''}</section>
        <section class="account-stats">${[
          ['Campaigns started', stats.campaignsStarted], ['Campaigns completed', stats.campaignsCompleted],
          ['Events discovered', stats.eventsDiscovered], ['Decisions in saves', stats.decisionsMade],
          ['Achievements', stats.achievementsUnlocked], ['Overall progress', `${Number(stats.completionPercentage || 0)}%`],
          ['Saved scenarios', stats.savedScenarios || 0], ['Bookmarks', stats.bookmarks || 0]
        ].map(([label, value]) => `<article class="account-stat"><strong>${Number(value).toLocaleString()}</strong><span>${label}</span></article>`).join('')}</section>
        <section class="account-columns"><div class="account-panel"><div class="account-section-head"><div><div class="eyebrow">PERSISTENT CAMPAIGNS</div><h2>Campaign progress</h2></div></div>${summary.campaigns?.length ? `<div class="account-campaign-list">${summary.campaigns.map(campaign => `<article><div><strong>${escapeHtml(campaignTitle(campaign.campaign_id))}</strong><small>${escapeHtml(campaign.status.replaceAll('_', ' '))} · Last played ${readableDate(campaign.last_played_at)}</small></div></article>`).join('')}</div>` : '<p class="account-empty">Your campaign progress will appear after your first saved game.</p>'}</div>
          <div class="account-panel"><div class="account-section-head"><div><div class="eyebrow">CHRONICLE</div><h2>Recent activity</h2></div></div>${summary.activity?.length ? `<ul class="account-activity">${summary.activity.map(item => `<li><span>${escapeHtml(item.description)}</span><time>${readableDate(item.created_at)}</time></li>`).join('')}</ul>` : '<p class="account-empty">No activity recorded yet.</p>'}</div></section>
        <section class="account-panel"><div class="account-section-head"><div><div class="eyebrow">HONOURS</div><h2>Achievements earned</h2></div></div>${summary.achievements?.length ? `<div class="account-campaign-list">${summary.achievements.map(item => `<article><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description)} · Earned ${readableDate(item.unlocked_at)}</small></div></article>`).join('')}</div>` : '<p class="account-empty">Achievements appear when a server-verified milestone is earned.</p>'}</section>
        <section class="account-panel"><div class="account-section-head"><div><div class="eyebrow">YOUR SAVE SLOTS</div><h2>Saved games</h2></div></div>${saves.length ? `<div class="account-save-list">${saves.map(save => `<article class="account-save-row"><div><strong>${escapeHtml(save.name)}</strong><small>${escapeHtml(campaignTitle(save.campaign_id))} · Turn ${save.turn} · ${escapeHtml(save.game_date || 'Date not recorded')}</small><small>Updated ${readableDate(save.updated_at)}</small></div><div class="account-save-actions"><button data-account-action="resume" data-save-id="${escapeHtml(save.id)}">RESUME</button><button data-account-action="rename" data-save-id="${escapeHtml(save.id)}" data-revision="${save.revision}">RENAME</button><button data-account-action="delete" data-save-id="${escapeHtml(save.id)}">DELETE</button></div></article>`).join('')}</div>` : '<p class="account-empty">No saved games yet. Start a campaign to create your first persistent save.</p>'}</section>
        <section class="account-panel"><div class="account-section-head"><div><div class="eyebrow">SAVED REFERENCES</div><h2>Bookmarks</h2></div></div>${summary.bookmarks?.length ? `<div class="account-save-list">${summary.bookmarks.map(item => `<article class="account-save-row"><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.item_type)} · ${readableDate(item.created_at)}</small></div><div class="account-save-actions"><button data-account-action="unbookmark" data-bookmark-id="${item.id}">REMOVE</button></div></article>`).join('')}</div>` : '<p class="account-empty">Bookmark a scenario while playing to keep it here.</p>'}</section>
        <section class="account-panel account-profile"><div><div class="eyebrow">PLAYER PROFILE</div><h2>Display name</h2></div><form id="profile-form"><input name="display_name" maxlength="80" value="${escapeHtml(profile.display_name || '')}" placeholder="${escapeHtml(user.username)}"><button class="history-link" type="submit">UPDATE PROFILE</button></form></section>
        <p id="account-message" class="account-message" role="status"></p>`;
      $('#profile-form', container).addEventListener('submit', updateProfile);
      $('#account-message', container).textContent = '';
    } catch (error) {
      container.innerHTML = `<div class="account-error" role="alert">${escapeHtml(error.message)}<button class="history-link" id="account-retry">RETRY</button></div>`;
      $('#account-retry', container).onclick = openDashboard;
    }
  }

  async function updateProfile(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const profile = await request('api/profile/', {
        method: 'PATCH',
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      user.displayName = profile.display_name || user.username;
      setAccountUi();
      showMessage('Profile updated.');
      await openDashboard();
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  function gameSavePayload(game, name) {
    const { _serverSaveId, _serverRevision, ...gameState } = game;
    return {
      name,
      campaign_id: game.campaignId || game.eventId || 'emergency',
      scenario_id: game.scenarioId || game.eventId || 'emergency',
      faction: game.role || '',
      turn: Number.isSafeInteger(game.turn) ? game.turn : Number.isSafeInteger(game.node) ? game.node : 0,
      game_date: game.date || game.entries?.at(-1)?.date || '',
      game_state: gameState,
      format_version: 1,
      ...(game._serverRevision ? { expected_revision: game._serverRevision } : {}),
    };
  }

  async function saveGame({ newSlot = false, silent = false } = {}) {
    const game = window.COPRuntime?.currentGame?.();
    if (!game) throw new Error('Start a campaign or scenario before saving.');
    const existingId = !newSlot ? game._serverSaveId : null;
    let name = existingId ? null : silent
    ? `${campaignTitle(game.campaignId || game.eventId).slice(0, 45)} — ${new Date().toISOString()}`
    : window.prompt('Name this save slot:', campaignTitle(game.campaignId || game.eventId));
    if (!existingId && name === null) return;
    name = name?.trim();
    if (!existingId && !name) throw new Error('Save name cannot be empty.');
    const payload = gameSavePayload(game, name || '');
    const saved = existingId
      ? await request(`api/saves/${encodeURIComponent(existingId)}/`, { method: 'PATCH', body: JSON.stringify(payload) })
      : await request('api/saves/', { method: 'POST', body: JSON.stringify(payload) });
    window.COPRuntime?.setActiveSaveId?.(saved.id, saved.revision);
    if (!silent) window.notify?.('Game saved to your account.');
    return saved;
  }

  function queueAutosave(game) {
    if (!user || !accountConfigured || !game) return;
    window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => {
      saveQueue = saveQueue.then(() => saveGame({ silent: true })).catch(error => {
        showMessage(`Autosave failed: ${error.message}`, true);
        window.notify?.('Autosave failed. Open your player dashboard to retry.');
      });
    }, 500);
  }

  async function handleSaveAction(action, saveId, revision, bookmarkId) {
    try {
      if (action === 'bookmark-current') {
        const context = window.COPRuntime?.context?.();
        if (!context?.eventId) throw new Error('Open a scenario before bookmarking it.');
        await request('api/bookmarks/', {
          method: 'POST',
          body: JSON.stringify({ item_type: 'scenario', item_id: context.eventId, title: context.eventTitle || campaignTitle(context.eventId) }),
        });
        window.notify?.('Scenario bookmarked to your account.');
        await openDashboard();
      } else if (action === 'unbookmark') {
        await request(`api/bookmarks/${encodeURIComponent(bookmarkId)}/`, { method: 'DELETE' });
        await openDashboard();
      } else if (action === 'resume') {
        const save = await request(`api/saves/${encodeURIComponent(saveId)}/resume/`, { method: 'POST', body: '{}' });
        if (save.format_version !== 1) throw new Error('This save uses an incompatible game-state version.');
        const restored = window.COPRuntime?.restoreSavedGame?.(save.game_state, save.id, save.revision);
        if (!restored) throw new Error('This save is incompatible with the current game version.');
        window.setView?.('map');
        closeModal();
      } else if (action === 'rename') {
        const old = $('.account-save-row [data-account-action="rename"][data-save-id="' + CSS.escape(saveId) + '"]')?.closest('.account-save-row')?.querySelector('strong')?.textContent || '';
        const name = window.prompt('Rename this save slot:', old);
        if (name === null) return;
        if (!name.trim()) throw new Error('Save name cannot be empty.');
        await request(`api/saves/${encodeURIComponent(saveId)}/`, {
          method: 'PATCH',
          body: JSON.stringify({ name: name.trim(), expected_revision: revision }),
        });
        await openDashboard();
      } else if (action === 'delete') {
        if (!window.confirm('Delete this saved game? This cannot be undone.')) return;
        await request(`api/saves/${encodeURIComponent(saveId)}/`, { method: 'DELETE' });
        await openDashboard();
      } else if (action === 'new-save') {
        await saveGame({ newSlot: true });
        await openDashboard();
      }
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  async function discoverEvent(eventId) {
    if (!user || !accountConfigured) return;
    try {
      await request('api/progress/events/discover/', {
        method: 'POST',
        body: JSON.stringify({ event_id: eventId }),
      });
    } catch (error) {
      console.error('[Chronicles account] Could not record event discovery.', error);
    }
  }

  document.addEventListener('click', event => {
    const action = event.target.closest('[data-account-action]');
    if (action) {
      event.preventDefault();
      handleSaveAction(action.dataset.accountAction, action.dataset.saveId, Number(action.dataset.revision), action.dataset.bookmarkId);
      return;
    }
    if (event.target.closest('#login-link')) showAuth('login');
    if (event.target.closest('#register-link')) showAuth('register');
    if (event.target.closest('#account-button')) user ? openDashboard() : showAuth('login');
    if (event.target.closest('#dashboard-link')) openDashboard();
    if (event.target.closest('#save-button') || event.target.closest('#game-save')) {
      if (!accountConfigured || !user) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      saveGame().catch(error => showMessage(error.message, true));
    }
    if (event.target.closest('#logout-link')) {
      event.preventDefault();
      request('api/auth/logout/', { method: 'POST', body: '{}' }).then(() => {
        user = null;
        setAccountUi();
        window.setView?.('map');
        window.notify?.('Signed out.');
      }).catch(error => showMessage(error.message, true));
    }
    if (event.target.id === 'launch-simulation') {
      window.setTimeout(() => window.COPAccount?.gameChanged?.(window.COPRuntime?.currentGame?.()), 0);
    }
  }, true);

  window.COPAccount = {
    gameChanged: queueAutosave,
    discoverEvent,
    saveCurrent: options => saveGame(options),
  };
  setAccountUi();

  if (accountConfigured) {
    request('api/auth/me/').then(authenticatedUser => {
      user = authenticatedUser;
      setAccountUi();
    }).catch(error => {
      if (![401, 403].includes(error.status)) {
        console.error('[Chronicles account] Could not restore the account session.', error);
        $('#account-button').title = 'Account service is currently unavailable';
      }
    });
  }

  if (new URLSearchParams(location.search).has('uid') && new URLSearchParams(location.search).has('token')) {
    showAuth('reset-confirm');
  }
})();
