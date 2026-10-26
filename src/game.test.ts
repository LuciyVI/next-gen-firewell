import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameState, evaluateDecision, resolveScenario } from './game';
import { scenarios, type Scenario } from './scenarios';

const attack = scenarios.find((scenario) => scenario.malicious)!;
const normalFull = scenarios.find((scenario) => !scenario.malicious && scenario.expectedRoute === 'full')!;
const normalFast = scenarios.find((scenario) => scenario.expectedRoute === 'fast')!;

test('scenario library has 12 normal and 12 malicious unique training records', () => {
  assert.equal(scenarios.length, 24);
  assert.equal(scenarios.filter((scenario) => scenario.malicious).length, 12);
  assert.equal(new Set(scenarios.map((scenario) => scenario.id)).size, 24);
  for (const scenario of scenarios) {
    assert.ok(scenario.indicators.length >= 2);
    assert.ok(scenario.inspection.length >= 2);
    if (scenario.malicious) {
      assert.equal(scenario.expectedRoute, 'full');
      assert.ok(scenario.attack?.description);
      assert.ok(scenario.attack?.sourceUrl.startsWith('https://'));
    } else {
      assert.equal(scenario.attack, undefined);
    }
  }
});

test('a correct malicious block opens a card, adds points and increments the streak', () => {
  const initial = createGameState();
  const state = resolveScenario(initial, attack, 'full', 'block');
  assert.equal(state.correct, 1);
  assert.equal(state.processed, 1);
  assert.equal(state.score, 100);
  assert.equal(state.streak, 1);
  assert.equal(state.bestStreak, 1);
  assert.deepEqual(state.discoveredIds, [attack.id]);
  assert.equal(state.lastResult?.discoveredAttack, true);
  assert.equal(initial.score, 0);
  assert.deepEqual(initial.discoveredIds, []);
});

test('allowing an attack counts as a miss for every route and IDPS state', () => {
  for (const route of ['fast', 'full'] as const) {
    for (const idpsEnabled of [true, false]) {
      const result = evaluateDecision(attack, route, 'allow', idpsEnabled);
      assert.equal(result.missedAttack, true);
      assert.equal(result.correct, false);
      assert.equal(result.discoveredAttack, false);
      assert.equal(result.scoreDelta, -100);
    }
  }
});

test('explicitly blocking an attack never counts as a miss even with bad route or inactive IDPS', () => {
  for (const route of ['fast', 'full'] as const) {
    for (const idpsEnabled of [true, false]) {
      const result = evaluateDecision(attack, route, 'block', idpsEnabled);
      assert.equal(result.missedAttack, false);
      assert.equal(result.falsePositive, false);
      assert.equal(result.verdictCorrect, true);
      assert.equal(result.correct, route === 'full' && idpsEnabled);
    }
  }
});

test('the tenth missed attack ends the game and subsequent transitions are ignored', () => {
  let state = createGameState();
  for (let count = 1; count <= 10; count += 1) {
    state = resolveScenario(state, attack, 'full', 'allow');
    assert.equal(state.missedAttacks, count);
    assert.equal(state.gameOver, count === 10);
  }
  assert.equal(state.processed, 10);
  assert.equal(resolveScenario(state, normalFull, 'full', 'allow'), state);
  assert.equal(resolveScenario(state, attack, 'full', 'block'), state);
});

test('false positives are tracked separately and do not consume the missed-attack limit', () => {
  let state = createGameState();
  state = resolveScenario(state, normalFull, 'full', 'allow');
  state = resolveScenario(state, normalFull, 'full', 'block');
  assert.equal(state.falsePositives, 1);
  assert.equal(state.missedAttacks, 0);
  assert.equal(state.score, 60);
  assert.equal(state.lastResult?.scoreDelta, -40);
  assert.equal(state.streak, 0);
  assert.equal(state.bestStreak, 1);
  assert.equal(state.gameOver, false);
});

test('a disabled IDPS invalidates full-path success and prevents discovery', () => {
  const state = resolveScenario({ ...createGameState(), idpsEnabled: false }, attack, 'full', 'block');
  assert.equal(state.correct, 0);
  assert.equal(state.lastResult?.routeCorrect, true);
  assert.equal(state.lastResult?.verdictCorrect, true);
  assert.equal(state.lastResult?.discoveredAttack, false);
  assert.deepEqual(state.discoveredIds, []);
  assert.equal(state.missedAttacks, 0);
  assert.equal(evaluateDecision(normalFull, 'full', 'allow', false).correct, false);
  assert.equal(evaluateDecision(normalFast, 'fast', 'allow', false).correct, true);
});

test('an enabled IDPS without an attached profile cannot inspect or unlock full-path traffic', () => {
  for (const scenario of [normalFull, attack]) {
    const verdict = scenario.malicious ? 'block' : 'allow';
    const initial = { ...createGameState(), score: 100, idpsProfileAttached: false };
    const state = resolveScenario(initial, scenario, 'full', verdict);
    assert.equal(state.idpsEnabled, true);
    assert.equal(state.lastResult?.routeCorrect, true);
    assert.equal(state.lastResult?.verdictCorrect, true);
    assert.equal(state.lastResult?.correct, false);
    assert.equal(state.lastResult?.discoveredAttack, false);
    assert.equal(state.lastResult?.missedAttack, false);
    assert.equal(state.lastResult?.falsePositive, false);
    assert.match(state.lastResult!.feedback, /профиль СОВ не назначен/);
    assert.equal(state.score, 75);
    assert.equal(state.correct, 0);
    assert.deepEqual(state.discoveredIds, []);
  }
});

test('reattaching the profile restores inspection only if the IDPS module is also enabled', () => {
  assert.equal(evaluateDecision(attack, 'full', 'block', true, false).correct, false);
  assert.equal(evaluateDecision(attack, 'full', 'block', false, true).correct, false);
  assert.equal(evaluateDecision(attack, 'full', 'block', false, false).correct, false);
  const restored = resolveScenario({ ...createGameState(), idpsProfileAttached: true }, attack, 'full', 'block');
  assert.equal(restored.correct, 1);
  assert.equal(restored.lastResult?.discoveredAttack, true);
  assert.deepEqual(restored.discoveredIds, [attack.id]);
});

test('eligible FastPath sessions do not depend on the IDPS module or profile being active', () => {
  const fastScenarios = scenarios.filter((scenario) => scenario.expectedRoute === 'fast');
  assert.ok(fastScenarios.length > 0);
  for (const scenario of fastScenarios) {
    assert.equal(scenario.malicious, false);
    assert.match(scenario.indicators.join(' '), /ESTABLISHED/);
    assert.match(scenario.indicators.join(' '), /СОВ\/L7 не требуется; фрагментации нет/);
    for (const idpsEnabled of [true, false]) {
      for (const idpsProfileAttached of [true, false]) {
        const result = evaluateDecision(scenario, 'fast', 'allow', idpsEnabled, idpsProfileAttached);
        assert.equal(result.correct, true, `${scenario.id}: ${idpsEnabled}/${idpsProfileAttached}`);
        assert.equal(result.discoveredAttack, false);
      }
    }
  }
});

test('established but fragmented traffic rejects FastPath with a fragmentation-specific explanation', () => {
  const fragmented = scenarios.find((scenario) => scenario.id === 'pkt-017')!;
  assert.match(fragmented.indicators.join(' '), /ESTABLISHED.*IP-фрагментация: ДА/);
  const result = evaluateDecision(fragmented, 'fast', 'allow', true, true);
  assert.equal(result.verdictCorrect, true);
  assert.equal(result.routeCorrect, false);
  assert.equal(result.correct, false);
  assert.equal(result.scoreDelta, -25);
  assert.match(result.feedback, /Фрагментированные IP-пакеты не допускаются в FastPath/);
  assert.equal(evaluateDecision(fragmented, 'full', 'allow', true, true).correct, true);
});

test('established traffic requiring IDS/L7 inspection rejects FastPath with a specific explanation', () => {
  const inspected = scenarios.find((scenario) => scenario.id === 'pkt-023')!;
  assert.match(inspected.indicators.join(' '), /ESTABLISHED/);
  const result = evaluateDecision(inspected, 'fast', 'allow', true, true);
  assert.equal(result.verdictCorrect, true);
  assert.equal(result.routeCorrect, false);
  assert.equal(result.correct, false);
  assert.equal(result.scoreDelta, -25);
  assert.match(result.feedback, /ESTABLISHED не разрешает обход инспекции/);
  assert.match(result.feedback, /СОВ\/L7/);
  assert.equal(evaluateDecision(inspected, 'full', 'allow', true, true).correct, true);
});

test('the correct verdict alone cannot unlock an attack when the route is wrong', () => {
  const state = resolveScenario(createGameState(), attack, 'fast', 'block');
  assert.equal(state.correct, 0);
  assert.equal(state.lastResult?.routeCorrect, false);
  assert.equal(state.lastResult?.verdictCorrect, true);
  assert.deepEqual(state.discoveredIds, []);
});

test('attack cards unlock only once per scenario id', () => {
  const first = resolveScenario(createGameState(), attack, 'full', 'block');
  const second = resolveScenario(first, attack, 'full', 'block');
  assert.deepEqual(second.discoveredIds, [attack.id]);
  assert.equal(second.lastResult?.discoveredAttack, false);
  assert.equal(second.correct, 2);
  assert.equal(second.score, 200);
  assert.equal(second.streak, 2);
});

test('errors reset current streak, retain the record, and floor the score at zero', () => {
  let state = createGameState();
  state = resolveScenario(state, normalFast, 'fast', 'allow');
  state = resolveScenario(state, normalFull, 'full', 'allow');
  state = resolveScenario(state, normalFast, 'full', 'allow');
  assert.equal(state.score, 175);
  assert.equal(state.correct, 2);
  assert.equal(state.streak, 0);
  assert.equal(state.bestStreak, 2);
  state = resolveScenario(state, attack, 'full', 'allow');
  state = resolveScenario(state, attack, 'full', 'allow');
  assert.equal(state.score, 0);
  assert.equal(state.lastResult?.scoreDelta, -75);
  assert.equal(state.missedAttacks, 2);
});

test('every supplied scenario has one successful intended decision', () => {
  for (const scenario of scenarios as Scenario[]) {
    const verdict = scenario.malicious ? 'block' : 'allow';
    const result = evaluateDecision(scenario, scenario.expectedRoute, verdict, true);
    assert.equal(result.correct, true, scenario.id);
    assert.equal(result.missedAttack, false);
    assert.equal(result.falsePositive, false);
  }
});
