function createStatusApi({ fetchImpl = globalThis.fetch, timeoutMs = Number(process.env.STATUS_API_TIMEOUT_MS) || 2500, now = Date.now } = {}) {
  let cached;
  let cachedAt = 0;
  const fallback = () => ({ source: 'fallback', available: false, description: 'Live status information is temporarily unavailable.', updatedAt: null });
  return {
    async getStatus() {
      if (cached && now() - cachedAt < 60000) return cached;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(Math.max(timeoutMs, 250), 10000));
      try {
        const response = await fetchImpl('https://www.githubstatus.com/api/v2/status.json', {
          headers: { accept: 'application/json' },
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Status API returned HTTP ${response.status}.`);
        const payload = await response.json();
        const indicator = payload?.status?.indicator;
        const description = payload?.status?.description;
        if (!['none', 'minor', 'major', 'critical', 'maintenance'].includes(indicator) || typeof description !== 'string') {
          throw new Error('Status API returned an unexpected response.');
        }
        cached = { source: 'live', available: true, description: description.slice(0, 200), indicator, updatedAt: payload.page?.updated_at || null };
      } catch {
        cached = fallback();
      } finally {
        cachedAt = now();
        clearTimeout(timer);
      }
      return cached;
    }
  };
}

module.exports = { createStatusApi };
