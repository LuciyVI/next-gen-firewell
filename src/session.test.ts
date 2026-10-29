import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateDecision } from './game'
import { scenarios } from './scenarios'
import { createScenarioSession } from './session'

function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}
const fastApps = new Set(scenarios.filter(scenario => scenario.expectedRoute === 'fast').map(scenario => scenario.app))
const subnet = (address: string) => address.slice(0, address.lastIndexOf('.'))

test('sessions preserve every exercise and dossier while changing order, identities and metadata', () => {
  const first = createScenarioSession(seeded(15))
  const second = createScenarioSession(seeded(26))
  for (const session of [first, second]) {
    assert.equal(session.length, 24)
    assert.equal(session.filter(scenario => scenario.malicious).length, 12)
    assert.equal(session.filter(scenario => !scenario.malicious).length, 12)
    assert.equal(new Set(session.map(scenario => scenario.id)).size, 24)
    assert.ok(session.every(scenario => /^[0-9a-f]{42}$/.test(scenario.id)))
    assert.deepEqual(
      session.filter(scenario => scenario.attack).map(scenario => scenario.attack).sort((a, b) => a!.name.localeCompare(b!.name)),
      scenarios.filter(scenario => scenario.attack).map(scenario => scenario.attack).sort((a, b) => a!.name.localeCompare(b!.name)),
    )
    assert.deepEqual(session.map(scenario => scenario.app).sort(), scenarios.map(scenario => scenario.app).sort())
    assert.ok(session.some(scenario => !scenario.malicious && scenario.expectedRoute === 'fast'))
    assert.ok(session.some(scenario => !scenario.malicious && fastApps.has(scenario.app) && scenario.expectedRoute === 'full'))
  }
  assert.notDeepEqual(first.map(scenario => scenario.app), second.map(scenario => scenario.app))
  assert.equal(first.some(scenario => second.some(other => other.id === scenario.id)), false)
  assert.notDeepEqual(first.map(scenario => scenario.source), second.map(scenario => scenario.source))
})

test('injected randomness is deterministic without query parameters or exposed application hooks', () => {
  assert.deepEqual(createScenarioSession(seeded(42)), createScenarioSession(seeded(42)))
  assert.deepEqual(createScenarioSession(() => 0.5), createScenarioSession(() => 0.5))
})

test('session generation and subsequent mutations never change the source templates or another session', () => {
  const originals = structuredClone(scenarios)
  const first = createScenarioSession(seeded(7))
  const second = createScenarioSession(seeded(7))
  first[0].indicators[0] = 'changed by this session'
  first[0].inspection.push('changed by this session')
  first.find(scenario => scenario.attack)!.attack!.description = 'changed by this session'
  assert.deepEqual(scenarios, originals)
  assert.notDeepEqual(first, second)
  assert.deepEqual(second, createScenarioSession(seeded(7)))
  for (const scenario of first) {
    assert.equal(scenarios.some(template => scenario === template || scenario.indicators === template.indicators || scenario.inspection === template.inspection), false)
  }
})

test('address variations preserve roles, subnets, host ranges and shared destinations', () => {
  for (let seed = 1; seed <= 32; seed += 1) {
    const session = createScenarioSession(seeded(seed))
    const portalDestinations = session.filter(scenario => scenario.app === 'Корпоративный портал').map(scenario => scenario.destination)
    assert.equal(new Set(portalDestinations).size, 1, 'shared service remains the same within a shift')
    for (const scenario of session) {
      const candidates = scenarios.filter(template => template.app === scenario.app)
      assert.ok(candidates.some(template => subnet(template.source) === subnet(scenario.source)))
      assert.ok(candidates.some(template => subnet(template.destination) === subnet(scenario.destination)))
      assert.ok(candidates.some(template => template.protocol === scenario.protocol && template.port === scenario.port))
      for (const address of [scenario.source, scenario.destination]) {
        const last = Number(address.split('.').at(-1))
        assert.ok(last >= 1 && last <= 254, 'no network or broadcast host is generated')
      }
      if (candidates.length === 1) {
        assert.notEqual(scenario.source, candidates[0].source)
        assert.notEqual(scenario.destination, candidates[0].destination)
      }
    }
  }
})

test('all generated variants retain a valid intended answer and preserve attack classification', () => {
  const reasons = new Set<string>()
  const orders = new Set<string>()
  for (let seed = 1; seed <= 64; seed += 1) {
    const session = createScenarioSession(seeded(seed))
    orders.add(session.map(scenario => scenario.app).join('|'))
    for (const scenario of session) {
      const result = evaluateDecision(scenario, scenario.expectedRoute, scenario.malicious ? 'block' : 'allow', true)
      assert.equal(result.correct, true, scenario.title)
      if (scenario.malicious) {
        assert.equal(scenario.expectedRoute, 'full')
        assert.ok(scenario.attack)
      } else {
        assert.equal(scenario.attack, undefined)
      }
      if (scenario.expectedRoute === 'fast') {
        assert.match(scenario.indicators.join(' '), /СОВ\/L7 не требуется; фрагментации нет/)
        assert.doesNotMatch(scenario.indicators.join(' '), /ОБЯЗАТЕЛЬНА|IP-фрагментация: ДА|Политика сеанса изменилась/)
      }
      if (!scenario.malicious && fastApps.has(scenario.app) && scenario.expectedRoute === 'full') {
        assert.ok(scenario.routeReason)
        const wrong = evaluateDecision(scenario, 'fast', 'allow', true)
        assert.equal(wrong.correct, false)
        assert.equal(wrong.feedback, scenario.routeReason)
        assert.doesNotMatch(scenario.indicators.join(' '), /СОВ\/L7 не требуется|параметры не менялись|политика не изменились/)
        assert.doesNotMatch(scenario.inspection.join(' '), /Условия ускоренного пути соблюдены|Оснований для повторной полной проверки нет/)
        if (scenario.indicators.some(line => line.includes('IP-фрагментация: ДА'))) {
          reasons.add('fragmentation')
          assert.match(scenario.inspection.join(' '), /фрагменты собраны/)
        }
        if (scenario.indicators.some(line => line.includes('ОБЯЗАТЕЛЬНА'))) reasons.add('inspection')
        if (scenario.indicators.some(line => line.includes('Политика сеанса изменилась'))) reasons.add('policy')
      }
    }
  }
  assert.deepEqual(reasons, new Set(['fragmentation', 'inspection', 'policy']))
  assert.ok(orders.size >= 60, 'shifts must not retain one fixed order')
})

test('cosmetic size changes preserve the size class and leave attack evidence untouched', () => {
  const session = createScenarioSession(seeded(30))
  for (const scenario of session) {
    const template = scenarios.find(candidate => candidate.title === scenario.title)
    assert.match(scenario.size, /^\d+(?:\.\d+)? (?:B|KB)$/)
    if (scenario.malicious) {
      assert.ok(template)
      assert.equal(scenario.size, template.size)
      assert.deepEqual(scenario.indicators, template.indicators)
      assert.deepEqual(scenario.inspection, template.inspection)
    } else if (template) {
      assert.equal(scenario.size.split(' ')[1], template.size.split(' ')[1])
      const ratio = Number(scenario.size.split(' ')[0]) / Number(template.size.split(' ')[0])
      assert.ok(ratio >= 0.8 && ratio <= 1.2)
    }
  }
})

test('boundary RNG values terminate and keep IDs unique; invalid values are rejected', () => {
  for (const value of [0, 1 - Number.EPSILON]) {
    const session = createScenarioSession(() => value)
    assert.equal(session.length, 24)
    assert.equal(new Set(session.map(scenario => scenario.id)).size, 24)
    assert.ok(session.some(scenario => scenario.expectedRoute === 'fast'))
    assert.ok(session.some(scenario => !scenario.malicious && fastApps.has(scenario.app) && scenario.expectedRoute === 'full'))
  }
  for (const value of [-1, 1, 1.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => createScenarioSession(() => value), RangeError)
  }
})

test('default browser randomness creates independent shifts', () => {
  const first = createScenarioSession()
  const second = createScenarioSession()
  assert.notDeepEqual(first.map(scenario => scenario.id), second.map(scenario => scenario.id))
})
