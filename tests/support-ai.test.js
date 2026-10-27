const test = require('node:test');
const assert = require('node:assert/strict');
const { createSupportAI } = require('../support-ai');

const faq = { id: 2, question: 'How do I reset my password?', answer: 'Use the Forgot password link and follow the email instructions.', category: 'Account access' };

function fakeOllama(content, record) {
  return async (url, options) => {
    if (url.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'qwen2.5:3b' }] }) };
    record.request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ message: { content: JSON.stringify(content) } }) };
  };
}

test('AI receives matching SQL FAQ context and returns only valid FAQ references', async () => {
  const record = {};
  const assistant = createSupportAI({
    fetchImpl: fakeOllama({ answer: 'Use the Forgot password link.', confidence: 0.95, faqIds: [2, 999] }, record)
  });
  const answer = await assistant.answer('How can I reset my password?', [faq]);
  assert.match(record.request.messages[1].content, /Use the Forgot password link/);
  assert.deepEqual(answer.faqIds, [2]);
  assert.equal(answer.escalated, false);
});

test('low confidence or unsupported questions offer ticket escalation', async () => {
  const assistant = createSupportAI({
    fetchImpl: fakeOllama({ answer: 'I do not have enough information.', confidence: 0.1, faqIds: [] }, {})
  });
  const answer = await assistant.answer('How can I repair an unknown device?', []);
  assert.equal(answer.escalated, true);
});

test('provider connection failures retain a retryable 503 service error', async () => {
  const assistant = createSupportAI({
    fetchImpl: async () => { throw new TypeError('internal network diagnostic'); }
  });
  await assert.rejects(
    assistant.answer('How can I reset my password?', [faq]),
    error => error.status === 503 && error.code === 'ai_unavailable' && /provider is unavailable/i.test(error.message)
  );
});

test('error-code questions are grounded in the error guide, not incorrectly escalated for missing FAQ rows', async () => {
  const assistant = createSupportAI({
    fetchImpl: fakeOllama({ answer: 'A 404 means the requested page was not found.', confidence: 0.9, faqIds: [] }, {})
  });
  const answer = await assistant.answer('What does HTTP 404 mean?', []);
  assert.deepEqual(answer.errorCodeReferences, [{ code: '404', title: 'Not Found' }]);
  assert.equal(answer.escalated, false);
});

test('OpenAI-compatible endpoints preserve the configured API path and report missing models', async () => {
  const urls = [];
  const assistant = createSupportAI({
    provider: 'openai-compatible',
    apiKey: 'test-key-not-a-real-credential',
    model: 'configured-model',
    baseUrl: 'https://provider.example/v1/',
    fetchImpl: async (url, options) => {
      urls.push({ url, options });
      if (url.endsWith('/models')) return { ok: true, json: async () => ({ data: [{ id: 'another-model' }] }) };
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ answer: 'A grounded answer.', confidence: 0.8, faqIds: [2] }) } }] }) };
    }
  });
  const answer = await assistant.answer('How can I reset my password?', [faq]);
  assert.equal(answer.answer, 'A grounded answer.');
  assert.ok(urls[0].url.endsWith('/v1/chat/completions'));
  const health = await assistant.health();
  assert.equal(health.available, true);
  assert.equal(health.modelAvailable, false);
  assert.ok(urls[1].url.endsWith('/v1/models'));
  assert.equal(urls[0].options.headers.authorization, 'Bearer test-key-not-a-real-credential');
});

test('OpenAI-compatible remote endpoints require TLS when sending an API key', () => {
  assert.throws(() => createSupportAI({
    provider: 'openai-compatible',
    apiKey: 'test-key',
    baseUrl: 'http://provider.example/v1'
  }), /HTTPS/);
  assert.doesNotThrow(() => createSupportAI({
    provider: 'openai-compatible',
    apiKey: 'test-key',
    baseUrl: 'http://127.0.0.1:8000/v1'
  }));
});
