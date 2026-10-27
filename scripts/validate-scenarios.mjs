import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import scenarios from '../universal-scenarios.js';
import simulation from '../engine.js';

const events = JSON.parse(await readFile(resolve('data/history-events.json'), 'utf8'));
const failures = [];
const fallbackTiers = { tier2: 0, tier3: 0 };
for (const event of events) {
  try {
    const scenario = scenarios.build(event);
    const game = scenarios.initialize(event, scenario.roles[0]);
    if (!scenario.roles.length || !scenario.roles.includes(game.role)) throw new Error('missing valid playable role');
    if (!scenario.supportedActions.length || !simulation.validateSave({ node: 0, state: game.state, choices: [], entries: [] }, 0)) throw new Error('invalid starting conditions or no actions');
    const result = simulation.interpretAction(scenario.supportedActions[0], { scenarioId: event.id, date: scenario.date, role: game.role, allowedRoles: scenario.roles });
    if (result.clarification) throw new Error(result.clarification);
    const updated = simulation.applyEffects(game.state, result.effects);
    if (!Object.keys(result.effects).some(key => updated[key] !== game.state[key])) throw new Error('supported action did not change modeled state');
    game.state = updated;
    for (let turn = 0; turn < scenario.maxTurns; turn++) scenarios.nextTurn(game, Number(event.year));
    if (!game.ended || !scenarios.evaluateOutcome(game)) throw new Error('turn progression did not produce a completion outcome');
    if (event.coordinates && (!Array.isArray(event.coordinates) || Math.abs(event.coordinates[0]) > 180 || Math.abs(event.coordinates[1]) > 90)) throw new Error('invalid map coordinates');
    fallbackTiers[scenario.tier === '2' ? 'tier2' : 'tier3']++;
  } catch (error) {
    failures.push({ id: event.id, title: event.title, error: error.message });
  }
}
const report = {
  generatedAt: new Date().toISOString(),
  totalImportedEvents: events.length,
  scenariosGenerated: events.length - failures.length,
  successfullyPlayable: events.length - failures.length,
  fallbackScenarios: fallbackTiers.tier2 + fallbackTiers.tier3,
  fallbackTiers,
  remainingFailures: failures.length,
  failures
};
const output = resolve('data/scenario-coverage-report.json');
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
