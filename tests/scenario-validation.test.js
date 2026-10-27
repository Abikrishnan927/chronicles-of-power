const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const scenarios = require('../universal-scenarios.js');
const simulation = require('../engine.js');
const catalogIndex = require('../catalog-index.js');

test('every imported event initializes, accepts a state-changing action, advances, and completes', () => {
  const events = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/history-events.json'), 'utf8'));
  const failures = [];
  for (const event of events) {
    try {
      const scenario = scenarios.build(event);
      const game = scenarios.initialize(event, scenario.roles[0]);
      assert.ok(scenario.roles.includes(game.role));
      assert.ok(scenario.supportedActions.length);
      assert.ok(simulation.validateSave({ node: 0, state: game.state, choices: [], entries: [] }, 0));
      for (const action of scenario.supportedActions) {
        const result = simulation.interpretAction(action, { scenarioId: event.id, date: scenario.date, role: game.role, allowedRoles: scenario.roles });
        assert.ok(!result.clarification, result.clarification);
        const next = simulation.applyEffects(game.state, result.effects);
        assert.ok(Object.keys(result.effects).some(key => game.state[key] !== next[key]), `no modeled effect for ${action}`);
      }
      const firstResult = simulation.interpretAction(scenario.supportedActions[0]);
      game.state = simulation.applyEffects(game.state, firstResult.effects);
      for (let turn = 0; turn < scenario.maxTurns; turn++) scenarios.nextTurn(game, Number(event.year));
      assert.equal(game.ended, true);
      assert.ok(scenarios.evaluateOutcome(game));
      assert.deepEqual(event.coordinates, events.find(record => record.id === event.id).coordinates, 'scenario validation does not mutate source map data');
    } catch (error) { failures.push(`${event.id}: ${error.message}`); }
  }
  assert.deepEqual(failures, [], failures.slice(0, 20).join('\n'));
});

test('every imported event is routed past the old archive gate into its playable scenario modal', () => {
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.ok(app.includes('function playable(e){return e.imported===true'), 'imported events must be considered launchable');
  assert.ok(app.includes("id!=='emergency'){openModal("), 'generic campaign path must receive imported events');
  assert.ok(app.includes('id="launch-simulation"'), 'event detail must include a launch action');
  assert.ok(app.includes('PLAY SCENARIO'), 'launch action must be clearly labeled');
  assert.ok(app.includes("$$('[data-scenario-action]').forEach"), 'scenario action buttons must all be wired');
  assert.ok(app.includes("$$('[data-related]').forEach"), 'related event buttons must all be wired');
});

test('imported archive records retain unverified history labels while receiving a playable fallback', () => {
  const records = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/history-events.json'), 'utf8'));
  const one = records[0];
  const scenario = scenarios.build(one);
  assert.equal(one.confidence, 'unverified');
  assert.equal(one.isPlayable, false);
  assert.equal(one.simulationAvailable, false);
  assert.equal(scenario.hypothetical, true);
  assert.match(scenario.assumptions.join(' '), /not historical measurements/);
  assert.equal(scenario.sourceRefs[0], one.sourceRefs[0]);
});

test('shared catalogue index makes all authored and imported records searchable and filterable', () => {
  const imported = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/history-events.json'), 'utf8'));
  const sandbox = { window: { COPImportedEvents: imported } };
  const campaignSource = fs.readFileSync(path.join(__dirname, '../campaign-data.js'), 'utf8');
  require('node:vm').runInNewContext(campaignSource, sandbox);
  const events = sandbox.window.COPContent.EVENTS;
  assert.equal(imported.length, 10000);
  assert.equal(new Set(imported.map(event => event.id)).size, 10000);
  assert.equal(events.length, 10007);
  assert.equal(new Set(events.map(event => event.id)).size, 10007);

  const index = catalogIndex.build(events);
  assert.equal(index.size, 10007);
  assert.equal(index.search({ query: '', status: 'all', country: 'all', region: 'all', category: 'all', era: 'all', from: '1000', to: '2026', sort: 'oldest' }).length, 10007);
  const target = imported.at(-1);
  assert.ok(index.search({ query: target.title }).some(event => event.id === target.id), 'search covers records beyond the first page');
  assert.ok(index.search({ from: String(target.year), to: String(target.year) }).some(event => event.id === target.id), 'year filters include all loaded records');
  const located = imported.find(event => event.countries?.length);
  if (located) assert.ok(index.search({ country: located.countries[0] }).some(event => event.id === located.id));
  const regional = imported.find(event => event.region);
  if (regional) assert.ok(index.search({ region: regional.region }).some(event => event.id === regional.id));
  const categorized = imported.find(event => event.category);
  if (categorized) assert.ok(index.search({ category: categorized.category }).some(event => event.id === categorized.id));
  assert.ok(index.search({ from: '1900', to: '2026', era: '4', sort: 'newest' }).every(event => event.year >= 1900));

  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(app, /view==='library'\|\|view==='archive'\)renderCatalog\(view\)/);
  assert.match(app, /IntersectionObserver/);
  assert.match(app, /CATALOG_MAX_CARDS=108/);
  assert.match(html, /id="library-grid"/);
  assert.match(html, /id="archive-grid"/);
  assert.doesNotMatch(html, /Load more records/);
});
