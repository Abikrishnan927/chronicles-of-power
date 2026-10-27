const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { ERROR_CODES } = require('./support-catalog');
const { createSupportStore } = require('./support-db');
const { createSupportLogger } = require('./support-mongo');
const { createSupportAI } = require('./support-ai');
const { createStatusApi } = require('./support-third-party');

const SUPPORT_DIR = path.join(__dirname, 'support');
const CATEGORIES = new Set(['Account access', 'Getting help', 'Troubleshooting', 'Privacy and security', 'Using the assistant', 'Other']);
const cleanText = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
const HTTP_TITLES = new Map([
  ...ERROR_CODES.filter(item => /^\d{3}$/.test(item.code)).map(item => [Number(item.code), item.title]),
  [413, 'Request Too Large'],
  [502, 'Bad Gateway'],
  [504, 'Gateway Timeout']
]);

function buildApiError(req, status, message, { field, cause, steps, retryable = status === 429 || status >= 500, siteCode, retryAfter } = {}) {
  const reference = ERROR_CODES.find(item => item.code === String(status));
  const supportCode = siteCode === null
    ? undefined
    : siteCode || (status === 503 && (req.path.startsWith('/api/support') || req.path === '/api/health') ? 'APP-1001' : undefined);
  return {
    code: String(status),
    title: HTTP_TITLES.get(status) || 'Request Failed',
    message,
    cause: cause || reference?.causes[0] || 'The request could not be completed as submitted.',
    steps: steps || reference?.steps || ['Check the request and try again.', 'Ask the support assistant if the problem continues.'],
    requestId: req.requestId,
    retryable,
    ...(supportCode ? { siteCode: supportCode } : {}),
    ...(field ? { field } : {})
  };
}

function sendApiError(req, res, status, message, options = {}) {
  const error = buildApiError(req, status, message, options);
  const { retryAfter } = options;
  if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
  return res.status(status).json({ error });
}

function createSupportRequestLogger(logger = console) {
  return (req, res, next) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.on('finish', () => {
      const entry = JSON.stringify({
        timestamp: new Date().toISOString(),
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt
      });
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      (logger[level] || logger.log || (() => {})).call(logger, entry);
    });
    next();
  };
}

function createRateLimiter({ limit, windowMs, message }) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      return sendApiError(req, res, 429, message, { retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) });
    }
    if (buckets.size > 5000) {
      for (const [address, entry] of buckets) if (now >= entry.resetAt) buckets.delete(address);
    }
    next();
  };
}

function createSupportRoutes(app, {
  store = createSupportStore(),
  mongo = createSupportLogger(),
  assistant,
  statusApi = createStatusApi(),
  logger = console,
  allowTestError = process.env.NODE_ENV === 'development'
} = {}) {
  let supportAI = assistant;
  if (!supportAI) {
    try {
      supportAI = createSupportAI();
    } catch (error) {
      (logger.error || logger.log || (() => {})).call(logger, JSON.stringify({ event: 'support_ai_configuration_error', message: error.message }));
      supportAI = {
        async answer() {
          throw Object.assign(new Error('The support AI provider is not configured correctly.'), { status: 503, code: 'ai_configuration_error' });
        },
        async health() {
          return { available: false, modelAvailable: false, provider: process.env.AI_PROVIDER || 'ollama' };
        }
      };
    }
  }

  const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
  app.post('/api/support/chat', createRateLimiter({ limit: 20, windowMs: 60_000, message: 'Please wait before sending another assistant question.' }));
  app.post('/api/support/tickets', createRateLimiter({ limit: 5, windowMs: 60 * 60_000, message: 'Too many support tickets were submitted. Please try again later.' }));
  app.post('/api/support/feedback', createRateLimiter({ limit: 30, windowMs: 60 * 60_000, message: 'Please wait before sending more feedback.' }));
  const withStore = async operation => {
    try {
      await store.ready;
      return await operation();
    } catch (error) {
      throw Object.assign(new Error('The support database is temporarily unavailable.'), {
        status: 503,
        code: 'support_store_unavailable',
        cause: error
      });
    }
  };
  const withMongo = async operation => {
    try {
      return await operation();
    } catch {
      return false;
    }
  };
  const reportMongoUnavailable = (action, requestId) => {
    (logger.warn || logger.log || (() => {})).call(logger, JSON.stringify({
      event: 'support_optional_mongo_operation_failed',
      action,
      requestId
    }));
  };
  app.get('/support', (req, res, next) => req.path === '/support' ? res.redirect(301, '/support/') : next());
  app.get('/support/', (_req, res) => res.sendFile(path.join(SUPPORT_DIR, 'index.html')));
  app.get('/support/faqs', (_req, res) => res.sendFile(path.join(SUPPORT_DIR, 'faqs.html')));
  app.get('/support/errors', (_req, res) => res.sendFile(path.join(SUPPORT_DIR, 'errors.html')));
  app.get('/support/health', (_req, res) => res.sendFile(path.join(SUPPORT_DIR, 'health.html')));

  if (allowTestError) {
    app.get('/support/test-500', (_req, _res, next) => {
      next(Object.assign(new Error('Controlled development error.'), { status: 500, code: 'development_test_error' }));
    });
    app.get('/api/support/test-error/:status', (req, res, next) => {
      const status = Number(req.params.status);
      if (![400, 401, 403, 429, 500, 503].includes(status)) {
        return sendApiError(req, res, 404, 'The requested development test error is not supported.', { retryable: false });
      }
      if (status === 500) {
        return next(Object.assign(new Error('Controlled development error with private diagnostic detail.'), {
          status: 500,
          code: 'development_test_error'
        }));
      }
      return sendApiError(req, res, status, 'This is a controlled development-only error response.', {
        retryable: status === 429 || status >= 500,
        ...(status === 429 ? { retryAfter: 60 } : {})
      });
    });
  }

  app.get('/api/support/faqs', asyncRoute(async (req, res) => {
    const faqs = await withStore(() => store.getFaqs(req.query.q || ''));
    res.json({ faqs, total: faqs.length });
  }));
  app.get('/api/support/errors', (_req, res) => res.json({ errorCodes: ERROR_CODES }));

  const statusCounts = new Map();
  app.get('/api/support/status', asyncRoute(async (req, res) => {
    const now = Date.now();
    const current = statusCounts.get(req.ip);
    if (!current || now - current.startedAt >= 60000) {
      statusCounts.set(req.ip, { startedAt: now, count: 1 });
    } else if (current.count >= 30) {
      return sendApiError(req, res, 429, 'Please wait before checking service status again.', { retryAfter: 60 });
    } else {
      current.count += 1;
    }
    const result = await statusApi.getStatus();
    if (result.source === 'fallback') {
      return res.json({
        ...result,
        warning: {
          code: '503',
          siteCode: 'APP-1001',
          requestId: req.requestId,
          title: 'Third-Party Status Unavailable',
          message: 'The live provider status could not be checked. The displayed status is a fallback notice, not a confirmed outage.',
          cause: 'The third-party status API did not return live status.',
          steps: ['Check the provider status page directly.', 'Retry the status check later.'],
          retryable: true
        }
      });
    }
    res.json(result);
  }));

  app.post('/api/support/chat', asyncRoute(async (req, res) => {
    const question = cleanText(req.body?.question);
    if (!question || question.length > 500) {
      return sendApiError(req, res, 400, 'Enter a question of 1 to 500 characters.', { field: 'question', retryable: false });
    }
    const requestedId = cleanText(req.body?.conversationId);
    const conversationId = /^[a-f\d-]{36}$/i.test(requestedId) ? requestedId : randomUUID();
    const route = cleanText(req.body?.route).slice(0, 120) || '/support/';
    const history = Array.isArray(req.body?.history)
      ? req.body.history.slice(-6).filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string')
        .map(item => ({ role: item.role, content: cleanText(item.content).slice(0, 500) }))
      : [];
    const faqs = await withStore(() => store.getFaqs(question));
    const answer = await supportAI.answer(question, faqs, history);
    const messageId = randomUUID();
    const saved = await withMongo(() => mongo.logConversation({
      conversationId,
      route,
      userMessage: question,
      assistantMessage: answer.answer,
      faqIds: answer.faqIds,
      escalated: answer.escalated,
      ticketReference: null
    }));
    if (!saved) reportMongoUnavailable('log_conversation', req.requestId);
    res.json({
      conversationId,
      messageId,
      answer: answer.answer,
      references: faqs.filter(faq => answer.faqIds.includes(faq.id)).map(faq => ({ id: faq.id, question: faq.question })),
      errorCodeReferences: answer.errorCodeReferences || [],
      offerTicket: answer.escalated,
      confidence: answer.confidence,
      chatLogSaved: saved,
      chatLogMessage: saved ? 'Conversation saved.' : 'The answer is available, but conversation logging is currently unavailable.',
      ...(!saved ? {
        chatLogError: {
          code: '503',
          siteCode: 'APP-1001',
          requestId: req.requestId,
          title: 'Chat Logging Unavailable',
          message: 'Your answer was generated, but the optional conversation log was not saved.',
          cause: 'MongoDB is not configured or could not save the conversation.',
          steps: ['Your answer is still available.', 'No action is needed unless you expected the conversation to be saved.'],
          retryable: false
        }
      } : {})
    });
  }));

  app.post('/api/support/tickets', asyncRoute(async (req, res) => {
    const issue = cleanText(req.body?.issue);
    const description = cleanText(req.body?.description);
    const category = cleanText(req.body?.category);
    const contactEmail = cleanText(req.body?.contactEmail);
    const conversationRef = cleanText(req.body?.conversationRef);
    if (!issue || issue.length > 160) return sendApiError(req, res, 400, 'Issue must be between 1 and 160 characters.', { field: 'issue', retryable: false });
    if (!description || description.length > 2000) return sendApiError(req, res, 400, 'Description must be between 1 and 2000 characters.', { field: 'description', retryable: false });
    if (!CATEGORIES.has(category)) return sendApiError(req, res, 400, 'Choose a listed support category.', { field: 'category', retryable: false });
    if (contactEmail && (contactEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))) {
      return sendApiError(req, res, 400, 'Enter a valid email address or leave it blank.', { field: 'contactEmail', retryable: false });
    }
    if (conversationRef.length > 100) return sendApiError(req, res, 400, 'Conversation reference is too long.', { field: 'conversationRef', retryable: false });
    const ticket = await withStore(() => store.createTicket({ issue, description, category, contactEmail, conversationRef }));
    const attached = !conversationRef || !mongo.attachTicket || await withMongo(
      () => mongo.attachTicket(conversationRef, ticket.ticketNumber)
    );
    if (!attached) reportMongoUnavailable('attach_ticket', req.requestId);
    res.status(201).json({
      ticketNumber: ticket.ticketNumber,
      status: ticket.status,
      ...(!attached ? {
        warning: {
          code: '503',
          siteCode: 'APP-1001',
          requestId: req.requestId,
          title: 'Ticket Reference Logging Unavailable',
          message: 'Your support ticket was created, but its optional chat reference could not be saved.',
          cause: 'MongoDB is not configured or could not update the conversation record.',
          steps: ['Keep your ticket number for reference.', 'The ticket itself was created successfully.'],
          retryable: false
        }
      } : {})
    });
  }));

  app.post('/api/support/feedback', asyncRoute(async (req, res) => {
    const conversationId = cleanText(req.body?.conversationId);
    const messageReference = cleanText(req.body?.messageReference);
    const rating = cleanText(req.body?.rating);
    const comment = cleanText(req.body?.comment);
    if (!/^[a-f\d-]{36}$/i.test(conversationId) || !messageReference || messageReference.length > 150) {
      return sendApiError(req, res, 400, 'A valid conversation and answer reference are required.', { retryable: false });
    }
    if (!['up', 'down'].includes(rating) || comment.length > 500) {
      return sendApiError(req, res, 400, 'Choose a rating and keep comments under 500 characters.', { retryable: false });
    }
    const saved = await withMongo(() => mongo.saveFeedback({ conversationId, messageReference, rating, comment }));
    if (!saved) {
      reportMongoUnavailable('save_feedback', req.requestId);
      return sendApiError(req, res, 503, 'Feedback was not saved because the feedback service is unavailable. Please try again later.', {
        cause: 'MongoDB feedback storage is not configured or could not complete the write.'
      });
    }
    res.status(201).json({ saved: true });
  }));

  const healthHandler = asyncRoute(async (req, res) => {
    const checks = await Promise.allSettled([
      store.health(),
      mongo.health(),
      supportAI.health(),
      statusApi.getStatus()
    ]);
    const sqlAvailable = checks[0].status === 'fulfilled' && checks[0].value === true;
    const mongoAvailable = checks[1].status === 'fulfilled' && checks[1].value === true;
    const aiResult = checks[2].status === 'fulfilled' ? checks[2].value : { available: false, provider: process.env.AI_PROVIDER || 'ollama' };
    const thirdPartyResult = checks[3].status === 'fulfilled' ? checks[3].value : { source: 'fallback', available: false };
    const services = {
      backend: { status: 'healthy' },
      sql: { status: sqlAvailable ? 'healthy' : 'unavailable' },
      mongodb: { status: mongoAvailable ? 'healthy' : 'unavailable' },
      ai: { status: aiResult.available && aiResult.modelAvailable !== false ? 'healthy' : 'unavailable', provider: aiResult.provider },
      thirdParty: { status: thirdPartyResult.available ? 'healthy' : 'unavailable', source: thirdPartyResult.source, description: thirdPartyResult.description }
    };
    const coreAvailable = services.backend.status === 'healthy' && sqlAvailable;
    const allAvailable = Object.values(services).every(service => service.status === 'healthy');
    const status = !coreAvailable ? 'unavailable' : allAvailable ? 'healthy' : 'degraded';
    const body = {
      status,
      ok: coreAvailable,
      requestId: req.requestId,
      services,
      available: aiResult.available,
      model: aiResult.model || process.env.AI_MODEL || process.env.OLLAMA_MODEL || 'qwen2.5:3b',
      modelAvailable: aiResult.modelAvailable ?? aiResult.available,
      provider: aiResult.provider === 'ollama' ? 'local-ollama' : aiResult.provider
    };
    if (!coreAvailable) {
      return res.status(503).json({
        ...body,
        error: buildApiError(req, 503, 'The support database is temporarily unavailable. FAQ and ticket operations cannot be completed.', {
          cause: 'The SQL support database is not responding to its health check.',
          steps: ['Wait briefly and check again.', 'Verify DATABASE_URL and the PostgreSQL provider status.']
        })
      });
    }
    res.json(body);
  });
  app.get('/api/health', healthHandler);
  app.get('/health', healthHandler);

  app.use('/support', express.static(SUPPORT_DIR, { dotfiles: 'deny', index: false, fallthrough: true }));
}

function createSupportFallback(app, { logger = console } = {}) {
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return sendApiError(req, res, 404, 'The requested API resource was not found.', { retryable: false });
    sendErrorPage(req, res, 404, '404.html');
  });
  app.use((error, req, res, _next) => {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
    const requestId = req.requestId;
    const internalCode = error.code || (status === 413 ? 'request_too_large' : status === 400 ? 'invalid_json' : 'server_error');
    if (status >= 500 && !['development_test_error'].includes(error.code)) {
      (logger.error || logger.log || (() => {})).call(logger, JSON.stringify({ event: 'support_error', requestId, status, internalCode }));
    }
    if (req.path.startsWith('/api/')) {
      const knownMessages = {
        ai_unavailable: 'The configured AI provider is temporarily unavailable. FAQ search remains available.',
        ai_configuration_error: 'The AI provider is not configured correctly. FAQ search remains available.',
        ai_timeout: 'The AI provider took too long to respond. Try again later.',
        invalid_ai_response: 'The AI provider returned an unusable answer. Try again later.',
        support_store_unavailable: 'The support database is temporarily unavailable. FAQ and ticket operations cannot be completed.',
        ollama_unavailable: 'The local game AI service is not responding. Check service health and try again later.',
        model_missing: 'The configured local AI model is not installed. Check the AI setup instructions.',
        ollama_error: 'The local game AI service could not complete this request. Try again later.',
        ollama_timeout: 'The local game AI service took too long to respond. Try again later.'
      };
      const knownCauses = {
        ai_unavailable: 'The configured AI provider did not respond successfully.',
        ai_configuration_error: 'The AI provider configuration is incomplete or invalid.',
        ai_timeout: 'The configured AI provider exceeded its response time limit.',
        invalid_ai_response: 'The configured AI provider returned a response in an unexpected format.',
        support_store_unavailable: 'The SQL support database could not complete its operation.',
        ollama_unavailable: 'The local Ollama service could not be reached.',
        model_missing: 'The configured model is not available in the local Ollama service.',
        ollama_error: 'The local Ollama service returned an unsuccessful response.',
        ollama_timeout: 'The local Ollama request exceeded its response time limit.'
      };
      const message = status >= 500
        ? knownMessages[internalCode] || 'The support service could not complete this request.'
        : status === 413
          ? 'The request body is too large.'
          : status === 400 && error.type === 'entity.parse.failed'
            ? 'The request body must be valid JSON.'
            : status === 404
              ? 'The requested page or resource could not be found.'
              : status === 429
                ? 'Too many requests were made. Wait before trying again.'
                : status === 422
                  ? 'The request was understood but could not be processed with the supplied information.'
            : status === 401
              ? 'Valid authentication is required to complete this request.'
              : status === 403
                ? 'You are not permitted to access this resource.'
                : 'The request could not be completed. Check the submitted information and try again.';
      return sendApiError(req, res, status, message, {
        cause: knownCauses[internalCode],
        retryable: status === 429 || status >= 500
      });
    }
    sendErrorPage(req, res, status, status === 404 ? '404.html' : '500.html');
  });
}

function sendErrorPage(req, res, status, file) {
  const reference = ERROR_CODES.find(item => item.code === String(status));
  const message = status === 404
    ? 'We could not find the page you requested. The address may be incorrect, or the page may have moved.'
    : status === 500
      ? 'An unexpected server-side problem interrupted this request. No private diagnostic information is shown here.'
      : reference?.explanation || `The request could not be completed (HTTP ${status}).`;
  const cause = reference?.causes.join(' ') || 'The server could not complete the request.';
  const steps = reference?.steps || ['Check the request and try again.', 'Ask the support assistant if the problem continues.'];
  const heading = ({
    400: 'Check the request details.',
    401: 'Sign-in is required.',
    403: 'Access is not permitted.',
    404: 'We can’t find that page.',
    429: 'Please wait before trying again.',
    500: 'Something went wrong.',
    503: 'This service is temporarily unavailable.'
  })[status] || 'This request could not be completed.';
  const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
  const requestId = String(req.requestId || '');
  const safeRequestId = escapeHtml(requestId);
  const html = fs.readFileSync(path.join(SUPPORT_DIR, file), 'utf8')
    .replaceAll('{{REQUEST_ID}}', safeRequestId)
    .replaceAll('{{ERROR_CODE}}', escapeHtml(status))
    .replaceAll('{{ERROR_TITLE}}', escapeHtml(HTTP_TITLES.get(status) || 'Request Failed'))
    .replaceAll('{{ERROR_MESSAGE}}', escapeHtml(message))
    .replaceAll('{{ERROR_CAUSE}}', escapeHtml(cause))
    .replaceAll('{{ERROR_HEADING}}', escapeHtml(heading))
    .replaceAll('{{ERROR_GUIDANCE}}', escapeHtml(steps.join('; ')))
    .replaceAll('{{ERROR_GUIDANCE_LIST}}', steps.map(step => `<li>${escapeHtml(step)}</li>`).join(''))
    .replaceAll('{{RETRY_BUTTON}}', status === 429 || status >= 500
      ? '<button class="primary-button" id="retry-page" type="button">Try again</button>'
      : '');
  res.status(status).type('html').send(html);
}

module.exports = { createSupportRequestLogger, createSupportRoutes, createSupportFallback, createRateLimiter, cleanText, sendApiError, buildApiError };
