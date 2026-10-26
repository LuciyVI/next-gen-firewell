import type { Route, Scenario, Verdict } from './scenarios';

export type { Route, Scenario, Verdict } from './scenarios';

export const MAX_MISSED_ATTACKS = 10;

export interface DecisionResult {
  correct: boolean;
  routeCorrect: boolean;
  verdictCorrect: boolean;
  missedAttack: boolean;
  falsePositive: boolean;
  scoreDelta: number;
  feedback: string;
  discoveredAttack: boolean;
}

export interface GameState {
  score: number;
  processed: number;
  correct: number;
  missedAttacks: number;
  falsePositives: number;
  streak: number;
  bestStreak: number;
  idpsEnabled: boolean;
  idpsProfileAttached: boolean;
  discoveredIds: string[];
  gameOver: boolean;
  lastResult: DecisionResult | null;
}

export function createGameState(): GameState {
  return {
    score: 0, processed: 0, correct: 0, missedAttacks: 0,
    falsePositives: 0, streak: 0, bestStreak: 0,
    idpsEnabled: true, idpsProfileAttached: true, discoveredIds: [], gameOver: false, lastResult: null,
  };
}

/** Assess a synthetic packet without changing state or issuing any network request. */
export function evaluateDecision(
  scenario: Scenario,
  route: Route,
  verdict: Verdict,
  idpsEnabled: boolean,
  idpsProfileAttached = true,
): DecisionResult {
  const routeCorrect = route === scenario.expectedRoute;
  const verdictCorrect = scenario.malicious ? verdict === 'block' : verdict === 'allow';
  const missedAttack = scenario.malicious && verdict === 'allow';
  const falsePositive = !scenario.malicious && verdict === 'block';
  const inspectionActive = route !== 'full' || (idpsEnabled && idpsProfileAttached);
  const correct = routeCorrect && verdictCorrect && inspectionActive;
  const discoveredAttack = correct && scenario.malicious;
  let scoreDelta = 100;
  let feedback: string;

  if (missedAttack) {
    scoreDelta = -100;
    feedback = 'Атака пропущена: вредоносный трафик разрешён. Проверьте признаки и заблокируйте такой запрос в следующий раз.';
  } else if (falsePositive) {
    scoreDelta = -40;
    feedback = 'Ложная блокировка: это нормальный трафик. Подозрительный признак нужно оценивать вместе с контекстом.';
  } else if (!routeCorrect) {
    scoreDelta = -25;
    feedback = scenario.routeReason || (scenario.expectedRoute === 'full'
      ? 'Вердикт верный, но путь выбран неверно. Новому или изменившемуся потоку нужна полная проверка.'
      : 'Вердикт верный, но этот проверенный неизменившийся сеанс допускает ускоренный путь. Полная проверка создаёт лишнюю нагрузку.');
  } else if (!inspectionActive) {
    scoreDelta = -25;
    feedback = !idpsEnabled
      ? 'Вердикт и путь верны, но модуль IDPS выключен. Включите его, чтобы полная проверка выполнялась.'
      : 'Модуль включён, но профиль СОВ не назначен разрешающему правилу. Назначьте профиль: одного активного IDPS недостаточно.';
  } else {
    feedback = scenario.malicious
      ? 'Угроза распознана и заблокирована. Полная проверка выполнена с активным IDPS — карточка атаки открыта.'
      : route === 'fast'
        ? 'Верно: проверенный сеанс без изменений направлен по ускоренному пути, нормальный трафик разрешён.'
        : 'Верно: поток прошёл полную проверку с активной СОВ и назначенным профилем. Трафик нормальный и разрешён.';
  }

  return { correct, routeCorrect, verdictCorrect, missedAttack, falsePositive, scoreDelta, feedback, discoveredAttack };
}

/** Immutable transition; the caller owns packet progression and IDPS switching. */
export function resolveScenario(
  state: GameState,
  scenario: Scenario,
  route: Route,
  verdict: Verdict,
): GameState {
  if (state.gameOver) return state;

  const evaluated = evaluateDecision(scenario, route, verdict, state.idpsEnabled, state.idpsProfileAttached);
  const newDiscovery = evaluated.discoveredAttack && !state.discoveredIds.includes(scenario.id);
  const nextScore = Math.max(0, state.score + evaluated.scoreDelta);
  const result = {
    ...evaluated,
    // Report the applied score change, including the floor at zero.
    scoreDelta: nextScore - state.score,
    discoveredAttack: newDiscovery,
  };
  const missedAttacks = state.missedAttacks + Number(result.missedAttack);
  const streak = result.correct ? state.streak + 1 : 0;

  return {
    ...state,
    score: nextScore,
    processed: state.processed + 1,
    correct: state.correct + Number(result.correct),
    missedAttacks,
    falsePositives: state.falsePositives + Number(result.falsePositive),
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    discoveredIds: newDiscovery ? [...state.discoveredIds, scenario.id] : [...state.discoveredIds],
    gameOver: missedAttacks >= MAX_MISSED_ATTACKS,
    lastResult: result,
  };
}
