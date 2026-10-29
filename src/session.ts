import { scenarios, type Scenario } from './scenarios'

/** A test-injectable RNG; production never reads seeds from URLs or browser globals. */
type RandomSource = () => number
type FlowVariant = 'unchanged' | 'fragmented' | 'inspection' | 'policy'

function browserRandom(): number {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000
  }
  return Math.random()
}

function checkedRandom(random: RandomSource): RandomSource {
  return () => {
    const value = random()
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError('Scenario randomness must be finite and in [0, 1).')
    }
    return value
  }
}

function choose(random: RandomSource, count: number): number {
  return Math.floor(random() * count)
}

function randomHex(random: RandomSource, bytes: number): string {
  let result = ''
  for (let index = 0; index < bytes; index += 1) {
    result += choose(random, 256).toString(16).padStart(2, '0')
  }
  return result
}

function cloneScenario(template: Scenario): Scenario {
  return {
    ...template,
    indicators: [...template.indicators],
    inspection: [...template.inspection],
    ...(template.attack ? { attack: { ...template.attack } } : {}),
  }
}

/** Keep host roles, subnets, and shared destinations consistent throughout a shift. */
function addressRemapper(random: RandomSource): (address: string) => string {
  const offsets = new Map<string, number>()
  return (address) => {
    const octets = address.split('.')
    const host = Number(octets.pop())
    const subnet = octets.join('.')
    if (octets.length !== 3 || !Number.isInteger(host) || host < 1 || host > 254) {
      throw new Error('A scenario address must be an IPv4 host, not a network or broadcast address.')
    }
    let offset = offsets.get(subnet)
    if (offset === undefined) {
      // A nonzero rotation preserves one-to-one host relationships without rejection loops.
      offset = 1 + choose(random, 253)
      offsets.set(subnet, offset)
    }
    return `${subnet}.${1 + ((host - 1 + offset) % 254)}`
  }
}

function varyBenignSize(size: string, random: RandomSource): string {
  const parsed = /^(\d+(?:\.\d+)?) (B|KB)$/.exec(size)
  if (!parsed) return size
  // Preserve the size class and semantic clues (small request, large backup, etc.).
  const value = Number(parsed[1]) * (0.85 + random() * 0.3)
  return parsed[2] === 'B'
    ? `${Math.max(1, Math.round(value))} B`
    : `${Math.max(0.1, Math.round(value * 10) / 10)} KB`
}

function applyFlowVariant(scenario: Scenario, variant: FlowVariant): void {
  if (variant === 'unchanged') return
  scenario.expectedRoute = 'full'
  if (variant === 'fragmented') {
    scenario.title = `Фрагментированный сеанс: ${scenario.app}`
    scenario.summary = 'Ранее проверенный поток передаёт фрагментированные IP-пакеты.'
    scenario.indicators = [
      'Сеанс ESTABLISHED; IP-фрагментация: ДА',
      'Перед анализом содержимого требуется сборка IP-фрагментов',
      'Приложение, участники сеанса и разрешающее правило прежние',
    ]
    scenario.inspection = [
      'IP-фрагменты собраны; структура потока корректна',
      'Содержимое соответствует штатному обмену приложения',
      'Сигнатур угроз нет; сама фрагментация не означает атаку',
    ]
    scenario.routeReason = 'Фрагментированные IP-пакеты не допускаются в FastPath даже в установленном сеансе. Нужен обычный путь обработки со сборкой фрагментов.'
  } else if (variant === 'inspection') {
    scenario.title = `Обязательная инспекция: ${scenario.app}`
    scenario.summary = 'Установленному потоку назначена обязательная СОВ/L7-инспекция.'
    scenario.indicators = [
      'Сеанс ESTABLISHED; IP-фрагментации нет',
      'СОВ/L7-инспекция по разрешающему правилу: ОБЯЗАТЕЛЬНА',
      'Приложение и участники соединения не изменились',
    ]
    scenario.inspection = [
      'Полная проверка по назначенному профилю выполнена',
      'Обмен соответствует разрешённой работе приложения',
      'Сигнатуры угроз не обнаружены',
    ]
    scenario.routeReason = 'ESTABLISHED не разрешает обход инспекции. Пакеты, предназначенные для СОВ/L7, не обрабатываются FastPath.'
  } else {
    scenario.title = `Изменение политики: ${scenario.app}`
    scenario.summary = 'Для ранее проверенного потока обновлено разрешающее правило безопасности.'
    scenario.indicators = [
      'Сеанс ESTABLISHED; IP-фрагментации нет',
      'Политика сеанса изменилась: прежнего результата проверки недостаточно',
      'Новое правило требует СОВ/L7-инспекции этого потока',
    ]
    scenario.inspection = [
      'Повторная проверка по новому профилю выполнена',
      'Запрос соответствует разрешённой работе приложения',
      'Изменение политики не изменило нормальный характер трафика',
    ]
    scenario.routeReason = 'После изменения политики этот поток требует СОВ/L7-инспекции. Его нельзя направить в FastPath только на основании состояния ESTABLISHED.'
  }
}

/**
 * Create a local, independent shift. This varies the exercise, not its secrecy:
 * a browser owner can still inspect or modify local state.
 */
export function createScenarioSession(random: RandomSource = browserRandom): Scenario[] {
  const draw = checkedRandom(random)
  const sessionNonce = randomHex(draw, 16)
  const remapAddress = addressRemapper(draw)
  const eligible = scenarios.filter((scenario) => !scenario.malicious && scenario.expectedRoute === 'fast')
  // Keep both accelerated and newly inspection-required flows in every shift.
  const keepFast = choose(draw, eligible.length)
  const variationSlot = choose(draw, eligible.length - 1)
  const forceVariant = variationSlot >= keepFast ? variationSlot + 1 : variationSlot
  const variants: FlowVariant[] = ['unchanged', 'fragmented', 'inspection', 'policy']
  let eligibleIndex = 0
  const session = scenarios.map((template) => {
    const scenario = cloneScenario(template)
    scenario.source = remapAddress(template.source)
    scenario.destination = remapAddress(template.destination)
    if (!scenario.malicious) scenario.size = varyBenignSize(template.size, draw)
    if (!template.malicious && template.expectedRoute === 'fast') {
      const selected = choose(draw, variants.length)
      const variant = eligibleIndex === keepFast
        ? 'unchanged'
        : eligibleIndex === forceVariant
          ? variants[1 + choose(draw, variants.length - 1)]
          : variants[selected]
      applyFlowVariant(scenario, variant)
      eligibleIndex += 1
    }
    return scenario
  })

  // Fisher–Yates; unlike sorting with a random comparator, each slot is selected uniformly.
  for (let index = session.length - 1; index > 0; index -= 1) {
    const other = choose(draw, index + 1)
    ;[session[index], session[other]] = [session[other], session[index]]
  }
  return session.map((scenario, index) => ({
    ...scenario,
    // The position guarantees uniqueness even with a constant test RNG. It reveals no template ID.
    id: `${sessionNonce}${index.toString(16).padStart(2, '0')}${randomHex(draw, 4)}`,
  }))
}
