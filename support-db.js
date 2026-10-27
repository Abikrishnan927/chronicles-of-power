const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { FAQS } = require('./support-catalog');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_number TEXT NOT NULL UNIQUE,
  issue TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  contact_email TEXT,
  conversation_ref TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`;

function createSupportStore({ dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, '.private', 'support.sqlite'), sqlFactory } = {}) {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must point to PostgreSQL in production.');
    return createPostgresSupportStore();
  }
  if (process.env.DATABASE_URL) return createPostgresSupportStore();
  const loadSql = sqlFactory || (() => require('sql.js')());
  let db;
  const ready = Promise.resolve().then(loadSql).then(SQL => {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const bytes = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined;
    db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    db.run(SCHEMA);
    const count = db.exec('SELECT COUNT(*) AS count FROM faqs')[0].values[0][0];
    if (count === 0) {
      const insert = db.prepare('INSERT INTO faqs (question, answer, category) VALUES (?, ?, ?)');
      try {
        for (const faq of FAQS) insert.run([faq.question, faq.answer, faq.category]);
      } finally {
        insert.free();
      }
    }
    persist();
  });

  function persist() {
    const tempPath = `${dbPath}.tmp`;
    fs.writeFileSync(tempPath, Buffer.from(db.export()));
    fs.renameSync(tempPath, dbPath);
  }

  function rows(query, values = []) {
    const statement = db.prepare(query, values);
    const result = [];
    try {
      while (statement.step()) result.push(statement.getAsObject());
    } finally {
      statement.free();
    }
    return result;
  }

  return {
    ready,
    async getFaqs(search = '') {
      await ready;
      const query = String(search).trim().slice(0, 100);
      if (!query) return rows('SELECT id, question, answer, category FROM faqs ORDER BY category, id');
      const terms = query.toLowerCase().split(/\s+/).filter(term => term.length >= 3 && !['the', 'and', 'for', 'with', 'how', 'can', 'why', 'what'].includes(term)).slice(0, 8);
      if (!terms.length) terms.push(query.toLowerCase());
      const clauses = terms.map(() => '(LOWER(question) LIKE ? OR LOWER(answer) LIKE ? OR LOWER(category) LIKE ?)').join(' OR ');
      const ranking = terms.map(() => '(CASE WHEN LOWER(question) LIKE ? THEN 1 ELSE 0 END)').join(' + ');
      const patterns = terms.map(term => `%${term}%`);
      const params = [...terms.flatMap(term => [`%${term}%`, `%${term}%`, `%${term}%`]), ...patterns];
      return rows(`SELECT id, question, answer, category FROM faqs WHERE ${clauses} ORDER BY ${ranking} DESC, id LIMIT 8`, params);
    },
    async createTicket(ticket) {
      await ready;
      const ticketNumber = `SUP-${new Date().getUTCFullYear()}-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
      const statement = db.prepare('INSERT INTO tickets (ticket_number, issue, description, category, contact_email, conversation_ref) VALUES (?, ?, ?, ?, ?, ?)');
      try {
        statement.run([ticketNumber, ticket.issue, ticket.description, ticket.category, ticket.contactEmail || null, ticket.conversationRef || null]);
      } finally {
        statement.free();
      }
      persist();
      return { ticketNumber, status: 'open' };
    },
    async getTicket(ticketNumber) {
      await ready;
      return rows('SELECT ticket_number, issue, description, category, contact_email, conversation_ref, status, created_at, updated_at FROM tickets WHERE ticket_number = ?', [ticketNumber])[0] || null;
    },
    async health() {
      await ready;
      return rows('SELECT 1 AS healthy')[0].healthy === 1;
    }
  };
}

function createPostgresSupportStore({ databaseUrl = process.env.DATABASE_URL, poolFactory } = {}) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL support storage.');
  const Pool = poolFactory || require('pg').Pool;
  const pool = new Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
  const ready = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS faqs (
        id SERIAL PRIMARY KEY,
        question TEXT NOT NULL UNIQUE,
        answer TEXT NOT NULL,
        category TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        ticket_number TEXT NOT NULL UNIQUE,
        issue TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        contact_email TEXT,
        conversation_ref TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    for (const faq of FAQS) {
      await pool.query(
        'INSERT INTO faqs (question, answer, category) VALUES ($1, $2, $3) ON CONFLICT (question) DO NOTHING',
        [faq.question, faq.answer, faq.category]
      );
    }
  })();
  return {
    ready,
    async getFaqs(search = '') {
      await ready;
      const query = String(search).trim().slice(0, 100);
      if (!query) return (await pool.query('SELECT id, question, answer, category FROM faqs ORDER BY category, id')).rows;
      const terms = query.toLowerCase().split(/\s+/).filter(term => term.length >= 3 && !['the', 'and', 'for', 'with', 'how', 'can', 'why', 'what'].includes(term)).slice(0, 8);
      if (!terms.length) terms.push(query.toLowerCase());
      const patterns = terms.map(term => `%${term}%`);
      return (await pool.query(
        `SELECT id, question, answer, category FROM faqs
         WHERE question ILIKE ANY($1::text[]) OR answer ILIKE ANY($1::text[]) OR category ILIKE ANY($1::text[])
         ORDER BY CASE WHEN question ILIKE ANY($1::text[]) THEN 0 ELSE 1 END, id LIMIT 8`,
        [patterns]
      )).rows;
    },
    async createTicket(ticket) {
      await ready;
      const ticketNumber = `SUP-${new Date().getUTCFullYear()}-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
      const result = await pool.query(
        'INSERT INTO tickets (ticket_number, issue, description, category, contact_email, conversation_ref) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ticket_number, status',
        [ticketNumber, ticket.issue, ticket.description, ticket.category, ticket.contactEmail || null, ticket.conversationRef || null]
      );
      return { ticketNumber: result.rows[0].ticket_number, status: result.rows[0].status };
    },
    async getTicket(ticketNumber) {
      await ready;
      return (await pool.query('SELECT ticket_number, issue, description, category, contact_email, conversation_ref, status, created_at, updated_at FROM tickets WHERE ticket_number = $1', [ticketNumber])).rows[0] || null;
    },
    async health() {
      await ready;
      return (await pool.query('SELECT 1 AS healthy')).rows[0].healthy === 1;
    },
    async close() { await pool.end(); }
  };
}

module.exports = { createSupportStore, createPostgresSupportStore, SCHEMA };
