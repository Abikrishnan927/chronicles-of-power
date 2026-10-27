(() => {
  const pageSize = 1000;
  const pages = new Map();
  const loadedScripts = new Set();
  const scripts = ['catalog-index.js', 'campaign-data.js', 'engine.js', 'universal-scenarios.js', 'app.js', 'ai-ui.js'];
  let total = null;
  let running = false;

  const title = document.querySelector('#catalog-loader-title');
  const message = document.querySelector('#catalog-loader-message');
  const retry = document.querySelector('#catalog-retry');
  const loader = document.querySelector('#catalog-loader');

  function showError(error) {
    const failure = error && error.code ? error : {
      code: '503',
      title: 'Historical Catalogue Unavailable',
      message: error?.message || 'The historical catalogue could not be loaded.',
      cause: 'The browser could not retrieve or validate all catalogue records.',
      steps: ['Check that the local server is running.', 'Check your connection and try again.'],
      retryable: true
    };
    title.textContent = `${failure.code}${failure.siteCode ? ` · ${failure.siteCode}` : ''} — ${failure.title}`;
    message.textContent = [
      failure.message,
      failure.cause ? `Likely cause: ${failure.cause}` : '',
      failure.steps?.length ? `What you can do: ${failure.steps.join(' ')}` : '',
      failure.requestId ? `Request ID: ${failure.requestId}` : ''
    ].filter(Boolean).join('\n');
    retry.classList.toggle('hidden', !failure.retryable);
    loader.querySelector('.catalog-error-actions')?.remove();
    const actions = document.createElement('div');
    actions.className = 'catalog-error-actions';
    const ask = document.createElement('a');
    ask.textContent = 'ASK SUPPORT ASSISTANT';
    ask.href = window.COPSupportErrorLink
      ? window.COPSupportErrorLink({ ...failure, currentPage: location.pathname }, 'loading the historical catalogue')
      : '/support/';
    const reference = document.createElement('a');
    reference.href = '/support/errors';
    reference.textContent = 'ERROR CODE GUIDE';
    actions.append(ask, reference);
    loader.append(actions);
  }

  async function fetchPage(offset) {
    const response = await fetch(`/api/history/events?offset=${offset}&limit=${pageSize}`);
    let page;
    try {
      page = await response.json();
    } catch {
      throw Object.assign(new Error(`The catalogue server returned an unreadable HTTP ${response.status} response.`), {
        code: String(response.status),
        title: 'Invalid Server Response',
        retryable: response.status >= 500
      });
    }
    if (!response.ok) {
      const source = page?.error && typeof page.error === 'object' ? page.error : page;
      throw Object.assign(new Error(source.message || `Catalogue request failed (${response.status}).`), source);
    }
    if (!Array.isArray(page.events) || !Number.isSafeInteger(page.total) || page.offset !== offset ||
        page.events.length !== Math.min(pageSize, Math.max(0, page.total - offset))) {
      throw new Error(`The catalogue server returned an invalid page at offset ${offset}.`);
    }
    if (total !== null && total !== page.total) throw new Error('The catalogue changed while it was loading. Retry to load a consistent copy.');
    total = page.total;
    pages.set(offset, page.events);
    message.textContent = `Fetched ${pages.size} of ${Math.ceil(total / pageSize)} catalogue pages…`;
  }

  async function fetchCatalogue() {
    if (!pages.has(0)) await fetchPage(0);
    const offsets = [];
    for (let offset = pageSize; offset < total; offset += pageSize) {
      if (!pages.has(offset)) offsets.push(offset);
    }
    const results = await Promise.allSettled(offsets.map(fetchPage));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;

    const records = [];
    for (let offset = 0; offset < total; offset += pageSize) {
      const page = pages.get(offset);
      if (!page) throw new Error(`Catalogue page ${offset} is missing.`);
      records.push(...page);
    }
    const ids = new Set(records.map(event => event.id));
    if (ids.size !== total) throw new Error(`Catalogue integrity check failed: ${ids.size} unique IDs for ${total} records.`);
    window.COPImportedEvents = records;
    window.COPCatalogStatus = { imported: total, unique: ids.size, pages: pages.size };
  }

  function loadScript(src) {
    if (loadedScripts.has(src)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => { loadedScripts.add(src); resolve(); };
      script.onerror = () => { script.remove(); reject(new Error(`Could not load ${src}.`)); };
      document.body.append(script);
    });
  }

  async function start() {
    if (running) return;
    running = true;
    retry.classList.add('hidden');
    try {
      title.textContent = 'Loading the historical catalogue';
      message.textContent = total === null ? 'Fetching and indexing source records…' : `Loading records… ${pages.size} of ${Math.ceil(total / pageSize)} pages ready.`;
      await fetchCatalogue();
      message.textContent = `Indexed ${total.toLocaleString()} imported records. Starting the application…`;
      for (const src of scripts) await loadScript(src);
      loader.classList.add('hidden');
    } catch (error) {
      showError(error);
    } finally {
      running = false;
    }
  }

  retry.addEventListener('click', start);
  start();
})();
