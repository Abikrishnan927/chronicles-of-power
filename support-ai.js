const { ERROR_CODES } = require('./support-catalog');

function createSupportAI({
  provider = process.env.AI_PROVIDER || 'ollama',
  apiKey = process.env.AI_API_KEY || '',
  model = process.env.AI_MODEL || process.env.OLLAMA_MODEL || 'qwen2.5:3b',
  baseUrl = process.env.AI_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  fetchImpl = globalThis.fetch,
  timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 90000
} = {}) {
  if (!['ollama', 'openai-compatible'].includes(provider)) throw new TypeError('AI_PROVIDER must be ollama or openai-compatible.');
  const aiConfigured = provider !== 'openai-compatible' || Boolean(apiKey);
  let parsed;
  try { parsed = new URL(baseUrl); } catch { throw new TypeError('AI_BASE_URL must be a valid URL.'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new TypeError('AI_BASE_URL must not contain credentials, query parameters, or fragments.');
  if (provider === 'ollama' && (parsed.protocol !== 'http:' || !loopback)) {
    throw new TypeError('Ollama must use a loopback HTTP address.');
  }
  if (provider === 'openai-compatible' && aiConfigured && (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback))) {
    throw new TypeError('AI_API_KEY and an HTTPS AI_BASE_URL are required for openai-compatible (HTTP is allowed only on loopback).');
  }
  const basePath = parsed.pathname.replace(/\/+$/, '');
  const endpoint = suffix => `${parsed.origin}${basePath}${suffix}`;

  async function request(messages) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const isOllama = provider === 'ollama';
      const requestUrl = endpoint(isOllama ? '/api/chat' : '/chat/completions');
      const headers = { 'content-type': 'application/json' };
      if (!isOllama) headers.authorization = `Bearer ${apiKey}`;
      const body = isOllama
        ? { model, messages, stream: false, format: 'json', options: { temperature: 0.1, num_ctx: 2048, num_predict: 240 } }
        : { model, messages, temperature: 0.1, response_format: { type: 'json_object' } };
      let response;
      try {
        response = await fetchImpl(requestUrl, { method: 'POST', headers, signal: controller.signal, body: JSON.stringify(body) });
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw Object.assign(new Error('The configured AI provider is unavailable.'), { status: 503, code: 'ai_unavailable' });
      }
      if (!response.ok) throw Object.assign(new Error('The configured AI provider is unavailable.'), { status: 503, code: 'ai_unavailable' });
      let data;
      try {
        data = await response.json();
      } catch {
        throw Object.assign(new Error('The AI provider returned an invalid answer.'), { status: 502, code: 'invalid_ai_response' });
      }
      const content = isOllama ? data?.message?.content : data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw Object.assign(new Error('The AI provider returned an invalid answer.'), { status: 502, code: 'invalid_ai_response' });
      let parsedAnswer;
      try { parsedAnswer = JSON.parse(content); } catch { throw Object.assign(new Error('The AI provider returned an invalid answer.'), { status: 502, code: 'invalid_ai_response' }); }
      if (typeof parsedAnswer.answer !== 'string' || typeof parsedAnswer.confidence !== 'number' || !Number.isFinite(parsedAnswer.confidence)) {
        throw Object.assign(new Error('The AI provider returned an invalid answer.'), { status: 502, code: 'invalid_ai_response' });
      }
      if (!parsedAnswer.answer.trim()) throw Object.assign(new Error('The AI provider returned an empty answer.'), { status: 502, code: 'invalid_ai_response' });
      return parsedAnswer;
    } catch (error) {
      if (error.name === 'AbortError') throw Object.assign(new Error('The AI provider took too long to respond.'), { status: 504, code: 'ai_timeout' });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async answer(question, faqs, conversation = []) {
      const fallback = () => {
        const normalized = question.toLowerCase();
        const errorCode = ERROR_CODES.find(item => normalized.includes(item.code.toLowerCase()) || normalized.includes(item.title.toLowerCase()));
        if (errorCode) return {
          answer: `${errorCode.code} — ${errorCode.title}: ${errorCode.explanation} ${errorCode.steps.join(' ')}`,
          confidence: 0.98,
          faqIds: [],
          errorCodeReferences: [{ code: errorCode.code, title: errorCode.title }],
          escalated: false,
          provider: 'faq-fallback'
        };
        const terms = normalized.match(/[a-z0-9-]+/g)?.filter(term => term.length >= 3) || [];
        const ranked = faqs.map(faq => ({ faq, score: terms.reduce((count, term) => count + (`${faq.question} ${faq.answer} ${faq.category}`.toLowerCase().includes(term) ? 1 : 0), 0) }))
          .filter(item => item.score > 0).sort((a, b) => b.score - a.score);
        if (ranked.length) return {
          answer: `${ranked[0].faq.answer}${ranked.length > 1 ? ` Related FAQ: ${ranked[1].faq.question}` : ''}`,
          confidence: 0.82,
          faqIds: ranked.slice(0, 3).map(item => item.faq.id),
          errorCodeReferences: [],
          escalated: false,
          provider: 'faq-fallback'
        };
        return {
          answer: 'I could not find a supported answer in the FAQ or error-code records. You can create a support ticket and include the page and what you were trying to do.',
          confidence: 0.1,
          faqIds: [],
          errorCodeReferences: [],
          escalated: true,
          provider: 'faq-fallback'
        };
      };
      const faqContext = faqs.map(faq => ({ id: faq.id, question: faq.question, answer: faq.answer, category: faq.category }));
      const terms = question.toLowerCase().match(/[a-z0-9-]+/g)?.filter(term => term.length >= 3 && !['the', 'and', 'for', 'with', 'how', 'can', 'what', 'does'].includes(term)) || [];
      const errorContext = ERROR_CODES.map(item => {
        const text = `${item.code} ${item.title} ${item.explanation} ${item.causes.join(' ')} ${item.steps.join(' ')}`.toLowerCase();
        return { item, score: terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0) };
      }).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 3)
        .map(({ item: { code, title, explanation, causes, steps } }) => ({ code, title, explanation, causes, steps }));
      const messages = [
        { role: 'system', content: 'Answer support questions only from the supplied FAQs and error-code guide. Do not invent instructions or policies. If sources are insufficient, say so and set confidence below 0.55. Return JSON: answer, confidence from 0 to 1, and faqIds from the supplied records.' },
        { role: 'user', content: JSON.stringify({ question, faqs: faqContext, errorCodes: errorContext, previousMessages: conversation.slice(-4) }) }
      ];
      if (!aiConfigured) return fallback();
      let result;
      try {
        result = await request(messages);
      } catch {
        return fallback();
      }
      const validIds = new Set(faqContext.map(faq => faq.id));
      const faqIds = Array.isArray(result.faqIds) ? result.faqIds.filter(id => Number.isInteger(id) && validIds.has(id)).slice(0, 5) : [];
      const errorCodeReferences = ERROR_CODES.filter(item =>
        question.toLowerCase().includes(item.code.toLowerCase()) ||
        question.toLowerCase().includes(item.title.toLowerCase())
      ).map(item => ({ code: item.code, title: item.title }));
      return {
        answer: result.answer.trim().slice(0, 1200),
        confidence: Math.max(0, Math.min(1, result.confidence)),
        faqIds,
        errorCodeReferences,
        escalated: result.confidence < 0.55 || (faqs.length === 0 && errorCodeReferences.length === 0)
      };
    },
    async health() {
      if (!aiConfigured) return { available: false, modelAvailable: false, provider: 'faq-fallback', model };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 2500));
      try {
        if (provider === 'ollama') {
          const response = await fetchImpl(endpoint('/api/tags'), { signal: controller.signal });
          if (!response.ok) return { available: false, modelAvailable: false, provider, model };
          const data = await response.json();
          return { available: true, modelAvailable: (data.models || []).some(item => item.name === model), provider, model };
        }
        const response = await fetchImpl(endpoint('/models'), { headers: { authorization: `Bearer ${apiKey}` }, signal: controller.signal });
        if (!response.ok) return { available: false, modelAvailable: false, provider, model };
        const data = await response.json();
        const models = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
        return { available: true, modelAvailable: models.some(item => item.id === model || item.name === model), provider, model };
      } catch {
        return { available: false, modelAvailable: false, provider, model };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

module.exports = { createSupportAI };
