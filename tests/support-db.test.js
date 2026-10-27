const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSupportStore } = require('../support-db');
const { FAQS, ERROR_CODES } = require('../support-catalog');

test('SQLite FAQ seed is searchable and contains at least ten useful records', async t => {
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

test('ticket data persists in SQLite and each ticket number is unique', async t => {
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

test('the catalogue defines all required HTTP and application error codes', () => {
  assert.deepEqual(ERROR_CODES.map(item => item.code), ['400', '401', '403', '404', '429', '500', '503', 'APP-1001']);
  for (const item of ERROR_CODES) {
    assert.ok(item.title && item.explanation && item.causes.length && item.steps.length);
  }
});
