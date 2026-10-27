const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createServer } = require('../server');

const faq = { id: 1, question: 'How do I reset my password?', answer: 'Use the Forgot password link.', category: 'Account access' };
const logEntries = [];
const storeState = { tickets: [] };
const store = {
  ready: Promise.resolve(),
  async getFaqs(query = '') { return !query || /password/i.test(query) ? [faq] : []; },
  async createTicket(ticket) {
    storeState.tickets.push(ticket);
    return { ticketNumber: 'SUP-2026-ABCDEF0123', status: 'open' };
  },
  async health() { return true; }
};
const mongo = {
  async logConversation() { return false; },
  async saveFeedback() { return true; },
  async attachTicket() { return true; },
  async health() { return false; }
};
const assistant = {
  async answer(question, faqs) {
    return {
      answer: faqs.length ? 'Use the Forgot password link. [FAQ: How do I reset my password?]' : 'I cannot answer from the available sources.',
      confidence: faqs.length ? 0.95 : 0.1,
      faqIds: faqs.map(item => item.id),
      errorCodeReferences: [],
      escalated: faqs.length === 0
    };
  },
  async health() { return { available: true, provider: 'test-ai' }; }
};
const statusApi = { async getStatus() { return { source: 'live', available: true, indicator: 'none', description: 'All systems operational' }; } };
const logger = {
  info(entry) { logEntries.push(JSON.parse(entry)); },
  warn(entry) { logEntries.push(JSON.parse(entry)); },
  error(entry) { logEntries.push(JSON.parse(entry)); }
};
const gameAI = { async health() { return { available: true, model: 'test', modelAvailable: true }; } };

async function startServer(t, {
  allowTestError = false,
  mongoLogger = mongo,
  useDefaultAssistant = false,
  storeImpl = store,
  statusService = statusApi
} = {}) {
  const app = createServer({
    ai: gameAI,
    support: { store: storeImpl, mongo: mongoLogger, assistant: useDefaultAssistant ? undefined : assistant, statusApi: statusService, logger, allowTestError }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('FAQ API, error catalogue, and health endpoint report truthful dependency status', async t => {
  const base = await startServer(t);
  const faqs = await fetch(`${base}/api/support/faqs?q=password`);
  assert.equal(faqs.status, 200);
  assert.match((await faqs.json()).faqs[0].question, /password/i);
  const errors = await fetch(`${base}/api/support/errors`);
  assert.equal((await errors.json()).errorCodes.length, 8);
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  const healthData = await health.json();
  assert.equal(healthData.status, 'degraded');
  assert.equal(healthData.services.sql.status, 'healthy');
  assert.equal(healthData.services.mongodb.status, 'unavailable');
  assert.equal(healthData.provider, 'test-ai');
  const renderHealth = await fetch(`${base}/health`);
  assert.equal(renderHealth.status, 200);
  assert.equal((await renderHealth.json()).ok, true);
});

test('chat answers with FAQ references and reports MongoDB save failures truthfully', async t => {
  const base = await startServer(t);
  const response = await fetch(`${base}/api/support/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'How do I reset my password?', route: '/support/faqs' })
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.references[0].id, faq.id);
  assert.equal(result.chatLogSaved, false);
  assert.equal(result.chatLogError.code, '503');
  assert.equal(result.chatLogError.siteCode, 'APP-1001');
  assert.ok(result.chatLogError.requestId);
  assert.match(result.chatLogMessage, /logging is currently unavailable/);
  const unknown = await fetch(`${base}/api/support/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'How do I fix an unknown device?' })
  });
  assert.equal((await unknown.json()).offerTicket, true);
});

test('ticket inputs are validated and successful creation returns its stored ticket number', async t => {
  const base = await startServer(t);
  const invalid = await fetch(`${base}/api/support/tickets`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ issue: 'Issue', description: 'Details', category: 'Other', contactEmail: 'not-an-email' })
  });
  assert.equal(invalid.status, 400);
  const invalidBody = await invalid.json();
  assert.equal(invalidBody.error.code, '400');
  assert.equal(invalidBody.error.field, 'contactEmail');
  assert.equal(invalidBody.error.retryable, false);
  const valid = await fetch(`${base}/api/support/tickets`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ issue: 'Page unavailable', description: 'It did not load.', category: 'Troubleshooting' })
  });
  assert.equal(valid.status, 201);
  assert.equal((await valid.json()).ticketNumber, 'SUP-2026-ABCDEF0123');
  assert.equal(storeState.tickets.at(-1).contactEmail, '');
});

test('feedback API acknowledges saved records and returns 503 when MongoDB fails', async t => {
  const base = await startServer(t);
  const saved = await fetch(`${base}/api/support/feedback`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId: '00000000-0000-4000-8000-000000000001', messageReference: 'answer-1', rating: 'up', comment: 'Helpful' })
  });
  assert.equal(saved.status, 201);
  const failed = await startServer(t, { mongoLogger: { ...mongo, async saveFeedback() { return false; } } });
  const notSaved = await fetch(`${failed}/api/support/feedback`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId: '00000000-0000-4000-8000-000000000001', messageReference: 'answer-2', rating: 'down' })
  });
  assert.equal(notSaved.status, 503);
  const failureBody = await notSaved.json();
  assert.equal(failureBody.error.code, '503');
  assert.equal(failureBody.error.siteCode, 'APP-1001');
  assert.match(failureBody.error.message, /not saved/);
  assert.ok(failureBody.error.requestId);
});

test('branded 404 and development-only custom 500 pages use actual HTTP error statuses', async t => {
  const base = await startServer(t, { allowTestError: true });
  const missing = await fetch(`${base}/this-page-does-not-exist`);
  assert.equal(missing.status, 404);
  const missingPage = await missing.text();
  assert.match(missingPage, /ERROR 404 — Not Found/);
  assert.match(missingPage, /We can’t find/);
  assert.match(missingPage, new RegExp(missing.headers.get('x-request-id')));
  const failure = await fetch(`${base}/support/test-500`);
  assert.equal(failure.status, 500);
  const page = await failure.text();
  assert.match(page, /ERROR 500 — Internal Server Error/);
  assert.match(page, /Something went wrong/);
  assert.doesNotMatch(page, /Controlled development error|stack|Error:/);
  const malformed = await fetch(`${base}/api/support/tickets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  const malformedBody = await malformed.json();
  assert.equal(malformedBody.error.code, '400');
  assert.equal(malformedBody.error.title, 'Bad Request');
  assert.ok(malformedBody.error.requestId);
});

test('central error responses preserve real HTTP statuses, provide IDs, and do not expose diagnostics', async t => {
  const base = await startServer(t, { allowTestError: true });
  for (const [status, title] of [[400, 'Bad Request'], [401, 'Unauthorized'], [403, 'Forbidden'], [429, 'Too Many Requests'], [503, 'Service Unavailable']]) {
    const response = await fetch(`${base}/api/support/test-error/${status}`);
    const body = await response.json();
    assert.equal(response.status, status);
    assert.equal(body.error.code, String(status));
    assert.equal(body.error.title, title);
    assert.ok(body.error.message);
    assert.equal(body.error.requestId, response.headers.get('x-request-id'));
    assert.equal(body.error.retryable, status === 429 || status === 503);
    assert.doesNotMatch(JSON.stringify(body), /stack|private diagnostic|AI_API_KEY|MONGODB_URI/i);
    if (status === 503) assert.equal(body.error.siteCode, 'APP-1001');
  }
  const unexpected = await fetch(`${base}/api/support/test-error/500`);
  const body = await unexpected.json();
  assert.equal(unexpected.status, 500);
  assert.equal(body.error.code, '500');
  assert.equal(body.error.title, 'Internal Server Error');
  assert.equal(body.error.retryable, true);
  assert.doesNotMatch(JSON.stringify(body), /private diagnostic|stack|Error:/i);
});

test('rate limit and unavailable SQL dependencies return 429 and 503, not success-shaped errors', async t => {
  const base = await startServer(t);
  let limited;
  for (let i = 0; i < 31; i++) limited = await fetch(`${base}/api/support/status`);
  assert.equal(limited.status, 429);
  const limitedBody = await limited.json();
  assert.equal(limitedBody.error.code, '429');
  assert.equal(limited.headers.get('retry-after'), '60');

  const unavailableStore = { ...store, async health() { return false; } };
  const unavailableBase = await startServer(t, { storeImpl: unavailableStore });
  const health = await fetch(`${unavailableBase}/api/health`);
  const healthBody = await health.json();
  assert.equal(health.status, 503);
  assert.equal(healthBody.error.code, '503');
  assert.equal(healthBody.error.siteCode, 'APP-1001');
  assert.ok(healthBody.error.requestId);
});

test('third-party fallback data is explicit and includes a retryable service warning', async t => {
  const base = await startServer(t, {
    statusService: { async getStatus() { return { source: 'fallback', available: false, description: 'Live status is unavailable.' }; } }
  });
  const response = await fetch(`${base}/api/support/status`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.source, 'fallback');
  assert.equal(body.warning.code, '503');
  assert.equal(body.warning.siteCode, 'APP-1001');
  assert.equal(body.warning.retryable, true);
});

test('request logs contain request id, path, status, and duration but no body content', async t => {
  const before = logEntries.length;
  const base = await startServer(t);
  await fetch(`${base}/api/support/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'Private phrase not to log' })
  });
  const entry = logEntries.slice(before).find(item => item.path === '/api/support/chat');
  assert.ok(entry.requestId);
  assert.equal(entry.status, 200);
  assert.equal(typeof entry.durationMs, 'number');
  assert.doesNotMatch(JSON.stringify(entry), /Private phrase/);
});

test('support pages load accessible responsive styles and expose no client-side API keys', async t => {
  const base = await startServer(t);
  for (const route of ['/support/', '/support/faqs', '/support/errors', '/support/health']) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /support\.js/);
  }
  const css = fs.readFileSync(path.join(__dirname, '..', 'support', 'support.css'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'support', 'support.js'), 'utf8');
  const ignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(js, /aria-label/);
  assert.doesNotThrow(() => new vm.Script(js));
  assert.match(js, /function askAboutError/);
  assert.match(js, /\[data-ask-error\]/);
  assert.match(js, /support-chat-form'\)\.requestSubmit\(\)/);
  assert.doesNotMatch(js, /sk-[A-Za-z0-9]{20,}|AI_API_KEY/);
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^\.private\/$/m);
});

test('invalid AI configuration degrades assistant requests without taking down support pages', async t => {
  const previousProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = 'unsupported-provider';
  const base = await startServer(t, { useDefaultAssistant: true });
  if (previousProvider === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = previousProvider;

  const page = await fetch(`${base}/support/`);
  assert.equal(page.status, 200);
  const result = await fetch(`${base}/api/support/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'How do I reset my password?' })
  });
  assert.equal(result.status, 503);
  const body = await result.json();
  assert.equal(body.error.code, '503');
  assert.equal(body.error.siteCode, 'APP-1001');
});
