(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CPCatalogIndex = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function searchableText(event) {
    return [
      event.title, event.place, event.category, event.period, event.date, event.year,
      event.description, event.summary, event.country, event.region,
      ...(event.countries || []), ...(event.people || []), ...(event.sourceRefs || [])
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function matchesEra(year, era) {
    if (!Number.isFinite(year)) return false;
    return era === 4 ? year >= 1900
      : era === 3 ? year >= 1750 && year < 1900
        : era === 2 ? year >= 1500 && year < 1750
          : era === 1 ? year >= 500 && year < 1500
            : era === 0 ? year < 500
              : true;
  }

  function build(records) {
    if (!Array.isArray(records)) throw new TypeError('The catalogue index requires an event array.');
    const entries = records.map(event => ({ event, text: searchableText(event), title: String(event.title || '').toLowerCase() }));
    return Object.freeze({
      size: entries.length,
      search(filters = {}) {
        const query = String(filters.query || '').trim().toLowerCase();
        const words = query ? query.split(/\s+/) : [];
        const minYear = filters.from === '' || filters.from === undefined ? -Infinity : Number(filters.from);
        const maxYear = filters.to === '' || filters.to === undefined ? Infinity : Number(filters.to);
        const era = filters.era === '' || filters.era === undefined || filters.era === 'all' ? null : Number(filters.era);
        const matched = entries.filter(({ event, text }) => {
          const year = Number(event.year);
          const playable = event.imported === true || event.isPlayable === true || event.status === 'playable' || event.simulationAvailable === true;
          const countries = [...(event.countries || []), event.country].filter(Boolean);
          return (!filters.status || filters.status === 'all' ||
            (filters.status === 'curated' ? event.campaignType === 'curated'
              : filters.status === 'simulation' ? playable
                : event.imported === true || !playable)) &&
            (!filters.country || filters.country === 'all' || countries.includes(filters.country)) &&
            (!filters.region || filters.region === 'all' || event.region === filters.region) &&
            (!filters.category || filters.category === 'all' || event.category === filters.category) &&
            (era === null || matchesEra(year, era)) &&
            year >= minYear && year <= maxYear &&
            (!query || text.includes(query));
        });
        const score = event => {
          const title = String(event.title || '').toLowerCase();
          return words.reduce((total, word) => total +
            (title === word ? 10 : title.startsWith(word) ? 5 : title.includes(word) ? 3 : 0), 0);
        };
        matched.sort((left, right) => {
          const a = left.event, b = right.event;
          if (filters.sort === 'relevance' && query) return score(b) - score(a) || Number(a.year) - Number(b.year) || String(a.title).localeCompare(String(b.title));
          return filters.sort === 'newest'
            ? Number(b.year) - Number(a.year) || String(a.title).localeCompare(String(b.title))
            : Number(a.year) - Number(b.year) || String(a.title).localeCompare(String(b.title));
        });
        return matched.map(entry => entry.event);
      }
    });
  }

  return Object.freeze({ build });
});
