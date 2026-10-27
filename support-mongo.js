function createSupportLogger({ uri = process.env.MONGODB_URI, clientFactory } = {}) {
  let client;
  let database;
  let connection;
  let available = false;

  async function closeConnection() {
    const activeClient = client;
    client = undefined;
    database = undefined;
    available = false;
    if (activeClient) {
      try { await activeClient.close(); } catch { /* The original database failure is reported by the caller. */ }
    }
  }

  async function connect() {
    if (available) return true;
    if (!uri) return false;
    if (!connection) {
      connection = (async () => {
        try {
          const MongoClient = clientFactory || require('mongodb').MongoClient;
          client = new MongoClient(uri, { serverSelectionTimeoutMS: 1500, connectTimeoutMS: 1500 });
          await client.connect();
          database = client.db();
          await database.command({ ping: 1 });
          available = true;
          return true;
        } catch {
          await closeConnection();
          return false;
        } finally {
          connection = undefined;
        }
      })();
    }
    return connection;
  }

  return {
    async logConversation(entry) {
      if (!await connect()) return false;
      try {
        await database.collection('support_conversations').insertOne({
          conversation_id: entry.conversationId,
          timestamp: new Date(),
          route: entry.route,
          user_message: entry.userMessage.slice(0, 500),
          assistant_message: entry.assistantMessage.slice(0, 1200),
          faq_ids: entry.faqIds.slice(0, 8),
          escalated: entry.escalated,
          ticket_reference: entry.ticketReference || null
        });
        return true;
      } catch {
        await closeConnection();
        return false;
      }
    },
    async saveFeedback(entry) {
      if (!await connect()) return false;
      try {
        await database.collection('support_feedback').insertOne({
          conversation_id: entry.conversationId,
          message_reference: entry.messageReference,
          rating: entry.rating,
          comment: entry.comment?.slice(0, 500) || null,
          timestamp: new Date()
        });
        return true;
      } catch {
        await closeConnection();
        return false;
      }
    },
    async attachTicket(conversationId, ticketNumber) {
      if (!await connect()) return false;
      try {
        await database.collection('support_conversations').updateMany(
          { conversation_id: conversationId },
          { $set: { ticket_reference: ticketNumber } }
        );
        return true;
      } catch {
        await closeConnection();
        return false;
      }
    },
    async health() {
      return await connect();
    },
    async close() {
      await closeConnection();
    }
  };
}

module.exports = { createSupportLogger };
