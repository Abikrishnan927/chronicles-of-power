const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSupportStore, createPostgresSupportStore } = require('../support-db');
const { FAQS, ERROR_CODES } = require('../support-catalog');

test('local SQLite FAQ seed is searchable and contains at least ten useful records', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chronicles-support-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createSupportStore({ dbPath: path.join(directory, 'support.sqlite') });
  await store.ready;
  const all = await store.getFaqs();
  assert.ok(all.length >= 10);
  assert.equal(all.length, FAQS.length);
  assert.match((await store.getFaqs('password'))[0].question, /password/i);
  assert.deepEqual(await store.getFaqs("' OR 1=1 --"), []);
  assert.equal(await store.health(), true);
});

test('local development ticket data persists in SQLite and ticket numbers are unique', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chronicles-tickets-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const dbPath = path.join(directory, 'support.sqlite');
  const store = createSupportStore({ dbPath });
  await store.ready;
  const first = await store.createTicket({ issue: 'Page unavailable', description: 'The page did not load.', category: 'Troubleshooting' });
  const second = await store.createTicket({ issue: 'Reset help', description: 'The link was not received.', category: 'Account access' });
  assert.match(first.ticketNumber, /^SUP-\d{4}-[A-F0-9]{10}$/);
  assert.notEqual(first.ticketNumber, second.ticketNumber);
  const reopened = createSupportStore({ dbPath });
  assert.equal((await reopened.getTicket(first.ticketNumber)).issue, 'Page unavailable');
  assert.equal((await reopened.getTicket(first.ticketNumber)).contact_email, null);
});

test('PostgreSQL support adapter initializes schema, seeds FAQs, writes tickets, and checks health', async () => {
  const calls = [];
  class Pool {
    constructor(options) { assert.equal(options.connectionString, 'postgresql://test'); }
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('SELECT id, question, answer, category FROM faqs')) return { rows: [{ id: 1, question: FAQS[0].question, answer: FAQS[0].answer, category: FAQS[0].category }] };
      if (sql.includes('INSERT INTO tickets')) return { rows: [{ ticket_number: values[0], status: 'open' }] };
      if (sql.includes('SELECT 1 AS healthy')) return { rows: [{ healthy: 1 }] };
      return { rows: [] };
    }
    async end() {}
  }
  const store = createPostgresSupportStore({ databaseUrl: 'postgresql://test', poolFactory: Pool });
  await store.ready;
  assert.equal((await store.getFaqs('password')).length, 1);
  const ticket = await store.createTicket({ issue: 'Page unavailable', description: 'The page did not load.', category: 'Troubleshooting' });
  assert.match(ticket.ticketNumber, /^SUP-\d{4}-[A-F0-9]{10}$/);
  assert.equal(await store.health(), true);
  assert.ok(calls.some(call => /CREATE TABLE IF NOT EXISTS faqs/.test(call.sql)));
  assert.equal(calls.filter(call => /INSERT INTO faqs/.test(call.sql)).length, FAQS.length);
});

test('production refuses file-backed support storage', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL;
    assert.throws(() => createSupportStore(), /DATABASE_URL must point to PostgreSQL/);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test('the catalogue defines all required HTTP and application error codes', () => {
  assert.deepEqual(ERROR_CODES.map(item => item.code), ['400', '401', '403', '404', '429', '500', '503', 'APP-1001']);
  for (const item of ERROR_CODES) {
    assert.ok(item.title && item.explanation && item.causes.length && item.steps.length);
  }
});
