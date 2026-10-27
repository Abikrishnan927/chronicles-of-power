const test = require('node:test');
const assert = require('node:assert/strict');
const { createSupportLogger } = require('../support-mongo');

function fakeMongo({ failInsert = false } = {}) {
  const records = [];
  let closed = 0;
  class Client {
    constructor() {}
    async connect() {}
    db() {
      return {
        command: async () => ({ ok: 1 }),
        collection: name => ({
          insertOne: async document => {
            if (failInsert) throw new Error('injected database failure');
            records.push({ collection: name, document });
          },
          updateMany: async (filter, update) => records.push({ collection: name, filter, update })
        })
      };
    }
    async close() { closed += 1; }
  }
  return { Client, records, closed: () => closed };
}

test('MongoDB chat log and feedback writes are stored only after successful inserts', async () => {
  const fake = fakeMongo();
  const logger = createSupportLogger({ uri: 'mongodb://localhost/test', clientFactory: fake.Client });
  assert.equal(await logger.logConversation({
    conversationId: 'conversation-id', route: '/support/', userMessage: 'Help',
    assistantMessage: 'Answer', faqIds: [1], escalated: false
  }), true);
  assert.equal(await logger.saveFeedback({
    conversationId: 'conversation-id', messageReference: 'message-id', rating: 'up', comment: 'Useful'
  }), true);
  assert.equal(fake.records[0].collection, 'support_conversations');
  assert.deepEqual(fake.records[0].document.faq_ids, [1]);
  assert.equal(fake.records[1].collection, 'support_feedback');
  assert.equal(fake.records[1].document.comment, 'Useful');
  assert.equal(await logger.attachTicket('conversation-id', 'SUP-2026-0123456789'), true);
  await logger.close();
});

test('MongoDB configuration and write failures return unavailable instead of claiming success', async () => {
  const unconfigured = createSupportLogger({ uri: '' });
  assert.equal(await unconfigured.logConversation({}), false);
  assert.equal(await unconfigured.saveFeedback({}), false);
  const failing = fakeMongo({ failInsert: true });
  const logger = createSupportLogger({ uri: 'mongodb://localhost/test', clientFactory: failing.Client });
  assert.equal(await logger.logConversation({
    conversationId: 'conversation-id', route: '/', userMessage: 'question',
    assistantMessage: 'answer', faqIds: [], escalated: false
  }), false);
  assert.equal(failing.closed(), 1);
});
