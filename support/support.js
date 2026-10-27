(function () {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  let conversationId = null;
  let history = [];

  class SupportApiError extends Error {
    constructor(data = {}) {
      super(data.message || 'The request could not be completed. Please try again.');
      this.code = String(data.code || 'APP-1001');
      this.title = data.title || 'Support Service Unavailable';
      this.siteCode = data.siteCode;
      this.requestId = data.requestId;
      this.cause = data.cause;
      this.steps = Array.isArray(data.steps) ? data.steps : [];
      this.retryable = Boolean(data.retryable);
      this.field = data.field;
      this.retryAfter = Number(data.retryAfter) || 0;
      this.currentPage = data.currentPage;
    }
  }

  async function getJson(url, options) {
    let response;
    try {
      response = await fetch(url, options);
    } catch {
      throw new SupportApiError({
        code: 'APP-1001',
        title: 'Support Service Unavailable',
        message: 'We could not reach the support service. Check your connection and try again.',
        cause: 'The browser could not establish a connection to the server.',
        steps: ['Check your internet connection.', 'Check the service health page.', 'Try again when the service is available.'],
        retryable: true
      });
    }
    let data;
    try {
      data = await response.json();
    } catch {
      if (!response.ok) {
        throw new SupportApiError({
          code: String(response.status),
          title: 'Request Failed',
          message: `The server returned HTTP ${response.status} without a readable error response.`,
          requestId: response.headers.get('X-Request-Id'),
          retryable: response.status === 429 || response.status >= 500
        });
      }
      throw new SupportApiError({
        code: 'APP-1001',
        title: 'Invalid Server Response',
        message: 'The support service returned a response that could not be read.',
        requestId: response.headers.get('X-Request-Id'),
        retryable: true
      });
    }
    if (!response.ok) {
      const error = new SupportApiError(data?.error && typeof data.error === 'object'
        ? data.error
        : { code: String(response.status), message: data?.message, siteCode: data?.siteCode, retryable: response.status === 429 || response.status >= 500 });
      error.retryAfter = Number(response.headers.get('Retry-After')) || error.retryAfter;
      throw error;
    }
    return data;
  }

  function askAboutError(error, operation) {
    const currentPage = (error.currentPage || location.pathname).slice(0, 60);
    const code = error.siteCode ? `${error.code} (${error.siteCode})` : error.code;
    const diagnostics = ` Request ID: ${error.requestId || 'unavailable'}.`;
    const likelyCause = error.cause ? ` Likely cause: ${error.cause.slice(0, 50)}.` : '';
    const guidance = error.steps.length ? ` Next steps: ${error.steps.slice(0, 2).join(' ').slice(0, 80)}` : '';
    const question = `Explain error ${code}, ${error.title}. It occurred while ${operation.slice(0, 50)} on ${currentPage}. ${error.message.slice(0, 80)}${likelyCause}${diagnostics}${guidance}`.slice(0, 500);
    openChat();
    const input = $('#support-chat-input');
    input.value = question;
    $('#support-chat-form').requestSubmit();
  }

  function renderError(container, error, { operation = 'using support', retry } = {}) {
    if (!container) return;
    $('.support-error-notice', container)?.remove();
    let field;
    if (error.field) {
      field = [...container.querySelectorAll('[name]')].find(input => input.name === error.field);
      if (field) {
        field.setAttribute('aria-invalid', 'true');
        if (!field.dataset.errorBound) {
          field.dataset.errorBound = 'true';
          field.addEventListener('input', () => field.removeAttribute('aria-invalid'));
        }
      }
    }
    const notice = make('section', 'support-error-notice');
    notice.setAttribute('role', 'alert');
    const code = error.siteCode ? `${error.code} · ${error.siteCode}` : error.code;
    notice.append(make('p', 'error-notice-code', code), make('h3', '', error.title), make('p', '', error.message));
    if (error.cause) notice.append(make('p', '', `Likely cause: ${error.cause}`));
    if (error.steps.length) {
      const list = make('ul');
      error.steps.forEach(step => list.append(make('li', '', step)));
      notice.append(make('p', '', 'What you can do:'), list);
    }
    if (error.requestId) notice.append(make('small', 'muted', `Request ID: ${error.requestId}`));
    const actions = make('div', 'page-actions');
    const ask = make('button', 'secondary-button', 'Ask the Assistant');
    ask.type = 'button';
    ask.addEventListener('click', () => askAboutError(error, operation));
    actions.append(ask);
    if (error.retryable && retry) {
      const again = make('button', 'primary-button', 'Try Again');
      again.type = 'button';
      if (error.retryAfter > 0) {
        const wait = Math.min(error.retryAfter, 300);
        again.disabled = true;
        again.textContent = `Try Again in ${wait}s`;
        setTimeout(() => {
          again.disabled = false;
          again.textContent = 'Try Again';
        }, wait * 1000);
      }
      again.addEventListener('click', () => {
        notice.remove();
        retry();
      });
      actions.append(again);
    }
    const faq = make('a', 'text-link', 'Browse FAQs');
    faq.href = '/support/faqs';
    actions.append(faq);
    notice.append(actions);
    if (field) field.insertAdjacentElement('afterend', notice);
    else container.append(notice);
    return notice;
  }

  function warningError(warning) {
    return new SupportApiError({ ...warning, steps: warning.steps || ['Check the service health page.', 'Try again later.'] });
  }

  function navigateSearch(form) {
    form?.addEventListener('submit', event => {
      event.preventDefault();
      const query = $('#home-query', form)?.value.trim() || '';
      location.href = `/support/faqs${query ? `?q=${encodeURIComponent(query)}` : ''}`;
    });
  }

  async function loadPopularFaqs() {
    const target = $('#popular-faqs');
    if (!target) return;
    try {
      const { faqs } = await getJson('/api/support/faqs');
      target.replaceChildren();
      for (const faq of faqs.slice(0, 6)) {
        const card = make('article', 'faq-card');
        card.append(make('p', 'eyebrow', faq.category), make('h3', '', faq.question), make('p', 'faq-answer', faq.answer));
        target.append(card);
      }
    } catch (error) {
      target.replaceChildren();
      renderError(target, error, { operation: 'loading popular FAQs', retry: loadPopularFaqs });
    }
  }

  async function loadFaqPage() {
    const target = $('#faq-results');
    if (!target) return;
    const search = $('#faq-search');
    const category = $('#faq-category');
    const count = $('#faq-count');
    let timer;
    async function refresh() {
      target.replaceChildren(make('p', 'muted', 'Searching the support database…'));
      try {
        const { faqs } = await getJson(`/api/support/faqs?q=${encodeURIComponent(search.value)}`);
        const categories = [...new Set(faqs.map(faq => faq.category))].sort();
        const selected = category.value;
        category.replaceChildren(new Option('All categories', ''));
        categories.forEach(value => category.add(new Option(value, value)));
        category.value = categories.includes(selected) ? selected : '';
        const shown = category.value ? faqs.filter(faq => faq.category === category.value) : faqs;
        target.replaceChildren();
        for (const faq of shown) {
          const article = make('article', 'faq-row');
          const heading = make('h2', '', faq.question);
          const answer = make('p', '', faq.answer);
          article.append(make('span', 'category-tag', faq.category), heading, answer);
          target.append(article);
        }
        if (!shown.length) target.append(make('p', 'empty-state', 'No FAQs matched this search. Ask the assistant if you need more help.'));
        count.textContent = `Showing ${shown.length} of ${faqs.length} matching FAQ records.`;
      } catch (error) {
        target.replaceChildren();
        renderError(target, error, { operation: 'searching the FAQ database', retry: refresh });
        count.textContent = 'The FAQ database is currently unavailable.';
      }
    }
    search.value = new URLSearchParams(location.search).get('q') || '';
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refresh, 180); });
    category.addEventListener('change', refresh);
    refresh();
  }

  async function loadErrorCodes() {
    const target = $('#error-code-list');
    if (!target) return;
    try {
      const { errorCodes } = await getJson('/api/support/errors');
      const renderCodes = query => {
        const normalized = query.trim().toLowerCase();
        const matching = errorCodes.filter(code =>
          [code.code, code.title, code.explanation, ...code.causes, ...code.steps]
            .some(value => value.toLowerCase().includes(normalized))
        );
        target.replaceChildren();
        if (!matching.length) {
          target.append(make('p', 'empty-state', 'No error codes matched this search.'));
          return;
        }
        for (const code of matching) {
          const card = make('article', 'error-card');
          const header = make('div', 'error-heading');
          header.append(make('span', 'error-code', code.code), make('h2', '', code.title));
          card.append(header, make('p', '', code.explanation));
          for (const [title, values] of [['Common causes', code.causes], ['What to try', code.steps]]) {
            const section = make('div', 'error-detail');
            section.append(make('h3', '', title));
            const list = make('ul');
            values.forEach(item => list.append(make('li', '', item)));
            section.append(list);
            card.append(section);
          }
          const ask = make('button', 'text-link button-link', 'Ask the Assistant about this code →');
          ask.type = 'button';
          ask.addEventListener('click', () => askAboutError(new SupportApiError({
            code: code.code,
            title: code.title,
            message: code.explanation,
            steps: code.steps,
            retryable: false
          }), `learning about error ${code.code}`));
          card.append(ask);
          target.append(card);
        }
      };
      renderCodes($('#error-code-search')?.value || '');
      $('#error-code-search')?.addEventListener('input', event => renderCodes(event.currentTarget.value));
    } catch (error) {
      target.replaceChildren();
      renderError(target, error, { operation: 'loading the error-code reference', retry: loadErrorCodes });
    }
  }

  async function loadHealth() {
    const target = $('#health-overview');
    if (!target) return;
    target.replaceChildren(make('p', 'muted', 'Checking service dependencies…'));
    try {
      const data = await getJson('/api/health');
      target.replaceChildren();
      const summary = make('p', `health-summary status-${data.status}`, `Overall status: ${data.status}`);
      target.append(summary);
      const names = { backend: 'Support backend', sql: 'SQL FAQ and ticket database', mongodb: 'MongoDB chat and feedback', ai: 'AI assistant provider', thirdParty: 'GitHub public status API' };
      for (const [key, service] of Object.entries(data.services)) {
        const card = make('article', `health-card status-${service.status}`);
        card.append(make('span', 'status-indicator', service.status), make('h2', '', names[key] || key));
        if (service.provider) card.append(make('p', 'muted', `Configured provider: ${service.provider}`));
        if (service.description) card.append(make('p', 'muted', service.description));
        if (service.source === 'fallback') card.append(make('p', 'fallback-note', 'Fallback status is shown because the live provider did not respond.'));
        if (key === 'mongodb' && service.status === 'unavailable') card.append(make('p', 'muted', 'The website and SQL-based FAQ search can still work without MongoDB.'));
        target.append(card);
        if (service.status === 'unavailable') {
          renderError(card, new SupportApiError({
            code: '503',
            siteCode: 'APP-1001',
            requestId: data.requestId,
            title: `${names[key] || key} Unavailable`,
            message: `${names[key] || key} is not responding. Some support features may be unavailable.`,
            cause: 'A required or optional dependency did not respond to its health check.',
            steps: ['Wait briefly and check again.', 'Use FAQ search if the assistant or logging service is unavailable.'],
            retryable: true
          }), { operation: `checking ${names[key] || key} health`, retry: loadHealth });
        }
      }
      $('#health-updated').textContent = `Last checked ${new Date().toLocaleTimeString()}.`;
    } catch (error) {
      target.replaceChildren();
      renderError(target, error, { operation: 'checking support service health', retry: loadHealth });
    }
  }

  async function loadPublicStatus() {
    const target = $('#provider-status');
    if (!target) return;
    try {
      const result = await getJson('/api/support/status');
      target.replaceChildren(make('span', `status-dot ${result.available ? 'status-' + result.indicator : 'status-unavailable'}`));
      target.append(make('span', '', `GitHub public service status: ${result.description}`));
      if (result.source === 'fallback' && !result.warning) target.append(make('strong', 'fallback-note', ' Live status unavailable; this is a fallback notice, not an outage report.'));
      const link = make('a', 'text-link', 'View provider →');
      link.href = 'https://www.githubstatus.com/';
      link.rel = 'noopener noreferrer';
      link.target = '_blank';
      target.append(link);
      if (result.warning) renderError(target, warningError(result.warning), {
        operation: 'checking the live third-party status API',
        retry: loadPublicStatus
      });
    } catch (error) {
      target.replaceChildren();
      renderError(target, error, { operation: 'checking the live third-party status API', retry: loadPublicStatus });
    }
  }

  function addChatMessage(role, text, { references = [], errorCodeReferences = [], messageId, offerTicket = false, logMessage } = {}) {
    const log = $('#support-chat-messages');
    const item = make('article', `chat-message ${role}`);
    item.append(make('span', 'message-label', role === 'user' ? 'YOU' : 'SUPPORT ASSISTANT'), make('p', 'message-text', text));
    if (references.length) {
      const refs = make('div', 'chat-references');
      refs.append(make('span', '', 'Help sources: '));
      references.forEach(reference => {
        const link = make('a', '', reference.question);
        link.href = `/support/faqs?q=${encodeURIComponent(reference.question)}`;
        refs.append(link);
      });
      item.append(refs);
    }
    if (errorCodeReferences.length) {
      const refs = make('div', 'chat-references');
      refs.append(make('span', '', 'Error-code guide: '));
      errorCodeReferences.forEach(reference => refs.append(make('span', '', `${reference.code} — ${reference.title}`)));
      item.append(refs);
    }
    if (role === 'assistant' && messageId) {
      const feedback = make('div', 'feedback-row');
      feedback.append(make('span', 'muted', 'Was this useful?'));
      const commentDetails = make('details', 'feedback-comment');
      const commentSummary = make('summary', '', 'Add an optional comment');
      const comment = make('textarea');
      comment.maxLength = 500;
      comment.rows = 2;
      comment.setAttribute('aria-label', 'Optional feedback comment, up to 500 characters');
      comment.placeholder = 'What could be clearer? Do not include sensitive information.';
      commentDetails.append(commentSummary, comment);
      for (const [rating, label] of [['up', 'Yes'], ['down', 'No']]) {
        const button = make('button', 'feedback-button', label);
        button.type = 'button';
        button.setAttribute('aria-label', `${label}, this answer was ${rating === 'up' ? 'helpful' : 'not helpful'}`);
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            await getJson('/api/support/feedback', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ conversationId, messageReference: messageId, rating, comment: comment.value.trim() })
            });
            button.textContent = 'Thanks';
          } catch (error) {
            button.disabled = false;
            renderError(item, error, {
              operation: 'submitting feedback on this answer',
              retry: () => button.click()
            });
          }
        });
        feedback.append(button);
      }
      item.append(feedback);
      item.append(commentDetails);
    }
    if (logMessage) item.append(make('small', 'chat-log-note', logMessage));
    log.append(item);
    if (offerTicket) addTicketOffer();
    log.scrollTop = log.scrollHeight;
  }

  function setChatNotice(text) {
    const notice = $('#support-chat-notice');
    notice.textContent = text || '';
    notice.classList.toggle('hidden', !text);
  }

  function addTicketOffer() {
    if ($('#ticket-form')) return;
    const offer = make('section', 'ticket-form-wrap');
    offer.append(make('h3', '', 'Would you like to create a support ticket?'), make('p', 'muted', 'The assistant could not confirm an answer from the available sources. A support ticket is optional.'));
    const form = make('form', 'ticket-form');
    form.id = 'ticket-form';
    const fields = [
      ['issue', 'Issue summary', 'text', 160, true],
      ['description', 'What happened?', 'textarea', 2000, true]
    ];
    for (const [name, label, type, max, required] of fields) {
      const fieldLabel = make('label', '', label);
      let input;
      if (type === 'textarea') {
        input = make('textarea');
        input.rows = 3;
      } else {
        input = make('input');
        input.type = type;
      }
      input.name = name;
      input.maxLength = max;
      input.required = required;
      input.id = `ticket-${name}`;
      if (name === 'issue') input.value = history.filter(message => message.role === 'user').at(-1)?.content.slice(0, max) || '';
      if (name === 'description') input.placeholder = 'Include the page and steps tried. Do not include passwords or payment details.';
      fieldLabel.htmlFor = input.id;
      form.append(fieldLabel, input);
    }
    const categoryLabel = make('label', '', 'Category');
    categoryLabel.htmlFor = 'ticket-category';
    const category = make('select');
    category.id = 'ticket-category';
    category.name = 'category';
    ['Other', 'Account access', 'Getting help', 'Troubleshooting', 'Privacy and security', 'Using the assistant'].forEach(value => category.add(new Option(value, value)));
    form.append(categoryLabel, category);
    const emailLabel = make('label', '', 'Email address (optional)');
    emailLabel.htmlFor = 'ticket-email';
    const email = make('input');
    email.type = 'email';
    email.id = 'ticket-email';
    email.name = 'contactEmail';
    email.autocomplete = 'email';
    email.maxLength = 254;
    email.placeholder = 'name@example.com';
    form.append(emailLabel, email);
    const submit = make('button', 'primary-button', 'Create ticket');
    submit.type = 'submit';
    form.append(submit);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      submit.disabled = true;
      setChatNotice('Submitting your support request…');
      const values = Object.fromEntries(new FormData(form));
      try {
        const result = await getJson('/api/support/tickets', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...values, conversationRef: conversationId || '' })
        });
        form.replaceWith(make('p', 'ticket-confirmation', `Ticket ${result.ticketNumber} was created successfully.`));
        setChatNotice('');
        if (result.warning) renderError(offer, warningError(result.warning), {
          operation: 'saving the optional chat reference for your support ticket'
        });
      } catch (error) {
        submit.disabled = false;
        setChatNotice('');
        renderError(offer, error, {
          operation: 'creating a support request',
          retry: () => form.requestSubmit()
        });
      }
    });
    offer.append(form);
    $('#support-chat-messages').append(offer);
  }

  function clearConversation() {
    conversationId = null;
    history = [];
    $('#support-chat-messages').replaceChildren();
    addChatMessage('assistant', 'I can answer using the support articles and error-code guide. If the sources are not enough, I will say so and offer a support ticket.');
    setChatNotice('');
    $('#support-chat-input').focus();
  }

  async function sendChat(event) {
    event.preventDefault();
    const input = $('#support-chat-input');
    const button = $('#support-chat-send');
    const question = input.value.trim();
    if (!question) return;
    input.value = '';
    addChatMessage('user', question);
    history.push({ role: 'user', content: question });
    const loading = make('p', 'chat-loading', 'Searching support sources and asking the configured AI…');
    $('#support-chat-messages').append(loading);
    button.disabled = true;
    setChatNotice('');
    try {
      const result = await getJson('/api/support/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, conversationId, route: location.pathname, history: history.slice(-7, -1) })
      });
      loading.remove();
      conversationId = result.conversationId;
      history.push({ role: 'assistant', content: result.answer });
      addChatMessage('assistant', result.answer, {
        references: result.references,
        errorCodeReferences: result.errorCodeReferences,
        messageId: result.messageId,
        offerTicket: result.offerTicket,
      });
      if (result.chatLogError) {
        const answerMessage = $$('.chat-message.assistant', $('#support-chat-messages')).at(-1);
        renderError(answerMessage, warningError(result.chatLogError), {
          operation: 'saving the optional conversation log'
        });
      }
      if (result.offerTicket) setChatNotice('The available support sources were not sufficient. You may submit a ticket below.');
      input.focus();
    } catch (error) {
      loading.remove();
      renderError($('#support-chat-messages'), error, {
        operation: 'asking the AI support assistant',
        retry: () => {
          input.value = question;
          $('#support-chat-form').requestSubmit();
        }
      });
    } finally {
      button.disabled = false;
    }
  }

  function openChat() {
    const panel = $('#support-chat-panel');
    panel.classList.remove('hidden');
    $('#support-chat-toggle').setAttribute('aria-expanded', 'true');
    $('#support-chat-input').focus();
  }

  function handleIncomingErrorContext() {
    const params = new URLSearchParams(location.search);
    if (params.get('explainError') !== '1') return;
    const rawCode = params.get('errorCode') || 'APP-1001';
    const code = /^\d{3}$/.test(rawCode) || rawCode === 'APP-1001' ? rawCode : 'APP-1001';
    const requestId = params.get('errorRequestId') || '';
    const page = params.get('errorPage') || '/';
    const error = new SupportApiError({
      code,
      siteCode: params.get('errorSiteCode') === 'APP-1001' ? 'APP-1001' : undefined,
      title: (params.get('errorTitle') || 'Request Failed').slice(0, 100),
      message: (params.get('errorMessage') || 'The request could not be completed.').slice(0, 180),
      cause: (params.get('errorCause') || '').slice(0, 120),
      steps: (params.get('errorSteps') || '').split('; ').filter(Boolean).slice(0, 3),
      requestId: /^[a-f\d-]{36}$/i.test(requestId) ? requestId : undefined,
      currentPage: page.startsWith('/') ? page.slice(0, 100) : '/',
      retryable: false
    });
    const operation = (params.get('errorOperation') || 'using the game').slice(0, 80);
    window.history.replaceState(null, '', location.pathname);
    askAboutError(error, operation);
  }

  function setupChat() {
    const root = $('#support-chat-root');
    if (!root) return;
    const toggle = make('button', 'chat-toggle', 'Ask the Assistant');
    toggle.id = 'support-chat-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'support-chat-panel');
    const panel = make('aside', 'chat-panel hidden');
    panel.id = 'support-chat-panel';
    panel.setAttribute('aria-label', 'Support assistant chat');
    const header = make('div', 'chat-header');
    header.append(make('div', '', ''));
    header.firstChild.append(make('span', 'eyebrow', 'SUPPORT ASSISTANT'), make('h2', '', 'How can I help?'));
    const controls = make('div', 'chat-controls');
    const clear = make('button', 'icon-action', 'Clear');
    clear.type = 'button';
    clear.addEventListener('click', clearConversation);
    const close = make('button', 'close-chat', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close assistant');
    close.addEventListener('click', () => {
      panel.classList.add('hidden');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    });
    controls.append(clear, close);
    header.append(controls);
    const notice = make('p', 'chat-notice hidden');
    notice.id = 'support-chat-notice';
    notice.setAttribute('role', 'status');
    const messages = make('div', 'chat-messages');
    messages.id = 'support-chat-messages';
    const suggestions = make('div', 'chat-suggestions');
    suggestions.append(make('span', 'eyebrow', 'SUGGESTED QUESTIONS'));
    for (const question of ['How do I reset my password?', 'Why is a page unavailable?', 'What should I do about error 429?']) {
      const button = make('button', 'suggestion-button', question);
      button.type = 'button';
      button.addEventListener('click', () => { $('#support-chat-input').value = question; $('#support-chat-form').requestSubmit(); });
      suggestions.append(button);
    }
    const form = make('form', 'chat-form');
    form.id = 'support-chat-form';
    const input = make('input');
    input.id = 'support-chat-input';
    input.name = 'question';
    input.type = 'text';
    input.maxLength = 500;
    input.placeholder = 'Type your question…';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Ask a support question');
    input.required = true;
    const send = make('button', 'primary-button', 'Send');
    send.id = 'support-chat-send';
    send.type = 'submit';
    form.append(input, send);
    form.addEventListener('submit', sendChat);
    panel.append(header, notice, messages, suggestions, form);
    root.append(toggle, panel);
    toggle.addEventListener('click', () => panel.classList.contains('hidden') ? openChat() : close.click());
    addChatMessage('assistant', 'I can answer using the support articles and error-code guide. If the sources are not enough, I will say so and offer a support ticket.');
    $$('[data-open-chat]').forEach(button => button.addEventListener('click', openChat));
    $$('[data-ask-error]').forEach(button => button.addEventListener('click', () => {
      const page = $('.error-page[data-error-code]');
      if (!page) return openChat();
      const error = new SupportApiError({
        code: page.dataset.errorCode,
        title: page.dataset.errorTitle,
        message: page.dataset.errorMessage,
        cause: page.dataset.errorCause,
        requestId: page.dataset.errorRequestId,
        steps: page.dataset.errorGuidance ? page.dataset.errorGuidance.split('; ') : [],
        retryable: page.dataset.errorCode === '500'
      });
      askAboutError(error, 'opening the requested page');
    }));
  }

  navigateSearch($('#home-search'));
  $('#retry-page')?.addEventListener('click', () => location.reload());
  $('#refresh-health')?.addEventListener('click', loadHealth);
  setupChat();
  handleIncomingErrorContext();
  loadPopularFaqs();
  loadFaqPage();
  loadErrorCodes();
  loadHealth();
  loadPublicStatus();
}());
