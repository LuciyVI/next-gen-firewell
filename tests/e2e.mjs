import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { scenarios } from '../src/scenarios.ts';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

function stat(label) {
  return page.locator('.stat-card').filter({ has: page.locator('.stat-label', { hasText: label }) }).locator('.stat-value');
}
async function visible(locator, message) {
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await locator.isVisible(), true, message);
}
async function fresh() {
  await page.goto(baseURL);
  await visible(page.getByRole('heading', { name: 'Трафик под контролем.' }));
  await visible(page.locator('.packet-number', { hasText: '#0001' }));
}
async function route(value) {
  await page.getByRole('button', { name: value === 'fast' ? /FastPath Проверенный сеанс/ : /Полная проверка Глубокая проверка/ }).click();
}
async function verdict(value) {
  await page.getByRole('button', { name: value === 'allow' ? /Разрешить Нормальный трафик/ : /Заблокировать Вредоносный трафик/ }).click();
}
async function closeAttack() {
  const dialog = page.getByRole('dialog');
  if (await dialog.count()) await dialog.getByRole('button', { name: 'Продолжить смену' }).click();
}
async function advance() {
  await page.getByRole('button', { name: 'Следующий пакет', exact: true }).click();
}
async function activateIfNeeded() {
  const toggle = page.getByRole('switch', { name: 'Модуль IDPS' });
  const profile = page.getByRole('switch', { name: 'Профиль СОВ' });
  if (await toggle.getAttribute('aria-checked') === 'false') {
    const restore = page.getByRole('button', { name: 'Активировать IDPS' });
    if (await restore.count()) await restore.click();
    else await toggle.click();
  }
  if (await profile.getAttribute('aria-checked') === 'false') {
    const restore = page.getByRole('button', { name: 'Назначить профиль СОВ' });
    if (await restore.count()) await restore.click();
    else await profile.click();
  }
  assert.equal(await toggle.getAttribute('aria-checked'), 'true');
  assert.equal(await profile.getAttribute('aria-checked'), 'true');
}
async function playCorrect(scenario) {
  await activateIfNeeded();
  await route(scenario.expectedRoute);
  await verdict(scenario.malicious ? 'block' : 'allow');
  if (scenario.malicious) {
    await visible(page.getByRole('dialog', { name: scenario.attack.name }));
    const source = page.getByRole('dialog').getByRole('link', { name: 'Подробнее об угрозе' });
    assert.equal(await source.getAttribute('href'), scenario.attack.sourceUrl);
    await closeAttack();
  }
  await visible(page.getByRole('status').getByText('Верное решение!', { exact: true }));
}
async function checkNoOverflow(label) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(widths.document <= widths.viewport + 1, `${label}: horizontal overflow ${JSON.stringify(widths)}`);
  assert.ok(widths.body <= widths.viewport + 1, `${label}: body overflow ${JSON.stringify(widths)}`);
}

try {
  await fresh();
  await checkNoOverflow('desktop');
  await page.screenshot({ path: '/tmp/ngfw-desktop.png', fullPage: true });
  assert.equal(await page.getByRole('button', { name: /Разрешить Нормальный трафик/ }).isDisabled(), true);

  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await visible(page.getByRole('heading', { name: 'Смена на паузе' }));
  const frozen = await page.locator('.timer').textContent();
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('.timer').textContent(), frozen, 'pause freezes the timer');
  assert.equal(await page.getByRole('switch', { name: 'Модуль IDPS' }).isDisabled(), true);
  assert.equal(await page.getByRole('switch', { name: 'Профиль СОВ' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: /Полная проверка Глубокая проверка/ }).isDisabled(), true);
  await page.getByRole('button', { name: 'Продолжить смену', exact: true }).click();
  assert.equal(await page.locator('.pause-overlay').count(), 0);
  console.log('PASS pause freezes time and disables decisions');

  await page.getByRole('button', { name: 'Как играть', exact: true }).first().click();
  await visible(page.getByRole('dialog', { name: 'Как играть' }));
  assert.ok((await page.getByRole('dialog').textContent()).includes('На десятой пропущенной атаке'));
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);

  await playCorrect(scenarios[0]);
  assert.match(await stat('Обработано пакетов').textContent(), /01/);
  assert.match(await stat('Ваши очки').textContent(), /100/);
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Следующий пакет', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Продолжить смену', exact: true }).click();
  await advance();
  await playCorrect(scenarios[1]);
  assert.match(await stat('Ваши очки').textContent(), /200/);
  await page.getByRole('button', { name: 'Открыть досье угрозы' }).click();
  await visible(page.getByRole('dialog', { name: 'Log4Shell' }));
  await page.keyboard.press('Escape');
  console.log('PASS correct benign and malicious decisions, automatic CVE card and reopen');

  await page.getByRole('button', { name: /Коллекция угроз/ }).click();
  assert.equal(await page.locator('.collection-card.unlocked').count(), 1);
  assert.equal(await page.locator('.collection-card.locked').count(), 11);
  await page.getByRole('textbox', { name: 'Поиск угроз' }).fill('CVE-2021-44228');
  assert.equal(await page.locator('.collection-card').count(), 1);
  await page.locator('.collection-card.unlocked').click();
  await visible(page.getByRole('dialog', { name: 'Log4Shell' }));
  await closeAttack();
  await page.getByRole('textbox', { name: 'Поиск угроз' }).fill('нет-такой-угрозы');
  await visible(page.getByRole('heading', { name: 'Ничего не найдено' }));
  await page.getByRole('textbox', { name: 'Поиск угроз' }).fill('');
  await page.getByRole('button', { name: 'Журнал событий', exact: true }).click();
  assert.equal(await page.locator('.journal-entry').count(), 2);
  assert.match(await page.locator('.journal-entry').first().textContent(), /Угроза распознана и заблокирована/);
  console.log('PASS collection, locked cards, search and decision journal');

  await page.getByRole('button', { name: 'Симулятор', exact: true }).click();
  await page.getByRole('button', { name: 'Начать заново', exact: true }).click();
  await page.getByRole('dialog', { name: 'Новая смена' }).getByRole('button', { name: 'Продолжить текущую' }).click();
  assert.match(await stat('Обработано пакетов').textContent(), /02/);
  await page.getByRole('button', { name: 'Начать заново', exact: true }).click();
  await page.getByRole('dialog', { name: 'Новая смена' }).getByRole('button', { name: 'Начать заново', exact: true }).click();
  assert.match(await stat('Обработано пакетов').textContent(), /00/);
  assert.match(await stat('Ваши очки').textContent(), /^0/);
  assert.ok(Number(await page.evaluate(() => localStorage.getItem('packet-control-record-v1'))) >= 200);
  console.log('PASS restart confirmation, cancellation, reset and record retention');

  await page.getByRole('switch', { name: 'Модуль IDPS' }).click();
  await route('full');
  await visible(page.locator('.inspection-error'));
  await verdict('allow');
  await visible(page.locator('.decision-result.error-result'));
  assert.match(await page.getByRole('status').textContent(), /модуль IDPS выключен/);
  assert.match(await stat('Пропущено атак').textContent(), /00/);
  console.log('PASS inactive IDPS withholds inspection and invalidates full-path success');

  await fresh();
  await page.getByRole('switch', { name: 'Профиль СОВ' }).click();
  assert.equal(await page.getByRole('switch', { name: 'Модуль IDPS' }).getAttribute('aria-checked'), 'true');
  await route('full');
  await visible(page.locator('.inspection-error'));
  assert.match(await page.locator('.inspection-error').textContent(), /профиль СОВ не назначен/);
  await verdict('allow');
  await visible(page.locator('.decision-result.error-result'));
  assert.match(await page.getByRole('status').textContent(), /профиль СОВ не назначен/);
  assert.equal(await page.getByRole('switch', { name: 'Профиль СОВ' }).isDisabled(), true);
  await advance();
  await route('full');
  await verdict('block');
  assert.equal(await page.getByRole('dialog').count(), 0, 'no attack card without the required profile');
  assert.match(await page.getByRole('status').textContent(), /профиль СОВ не назначен/);
  assert.match(await stat('Пропущено атак').textContent(), /00/);
  await page.getByRole('button', { name: /Коллекция угроз/ }).click();
  assert.equal(await page.locator('.collection-card.unlocked').count(), 0);
  console.log('PASS active module without a profile withholds inspection, full-path success and attack cards');

  await fresh();
  await page.getByRole('heading', { name: 'Трафик под контролем.' }).click();
  await page.keyboard.press('2');
  await visible(page.locator('.inspection'));
  await page.keyboard.press('a');
  await visible(page.getByRole('status').getByText('Верное решение!', { exact: true }));
  await page.keyboard.press('Enter');
  await visible(page.locator('.packet-number', { hasText: '#0002' }));
  console.log('PASS route, verdict and next-packet keyboard shortcuts');

  await fresh();
  const maintenanceEvents = [];
  for (let index = 0; index < scenarios.length; index += 1) {
    if (await page.getByRole('alert').count()) {
      maintenanceEvents.push(index);
      if (index === 5) {
        assert.equal(await page.getByRole('switch', { name: 'Модуль IDPS' }).getAttribute('aria-checked'), 'false');
        assert.equal(await page.getByRole('switch', { name: 'Профиль СОВ' }).getAttribute('aria-checked'), 'true');
        await visible(page.getByRole('button', { name: 'Активировать IDPS' }));
      } else if (index === 15) {
        assert.equal(await page.getByRole('switch', { name: 'Модуль IDPS' }).getAttribute('aria-checked'), 'true');
        assert.equal(await page.getByRole('switch', { name: 'Профиль СОВ' }).getAttribute('aria-checked'), 'false');
        await visible(page.getByRole('button', { name: 'Назначить профиль СОВ' }));
      } else assert.fail(`unexpected maintenance event at ${index}`);
    }
    await playCorrect(scenarios[index]);
    if (index + 1 < scenarios.length) await advance();
    else await page.getByRole('button', { name: 'Завершить смену', exact: true }).click();
  }
  assert.deepEqual(maintenanceEvents, [5, 15]);
  await visible(page.getByRole('heading', { name: 'Хорошая работа, оператор!' }));
  assert.match(await stat('Обработано пакетов').textContent(), /24/);
  assert.match(await stat('Пропущено атак').textContent(), /00/);
  assert.match(await page.locator('.finish-stats').textContent(), /2400/);
  assert.match(await page.locator('.finish-stats').textContent(), /100%/);
  assert.equal(await page.evaluate(() => localStorage.getItem('packet-control-record-v1')), '2400');
  await page.getByRole('button', { name: /Коллекция угроз/ }).click();
  assert.equal(await page.locator('.collection-card.unlocked').count(), 12);
  await page.getByRole('button', { name: 'Журнал событий', exact: true }).click();
  assert.equal(await page.locator('.journal-entry').count(), 24);
  console.log('PASS complete 24-packet shift, module/profile maintenance events, 12 unlocked cards');

  await fresh();
  for (let index = 0; index < 20; index += 1) {
    await activateIfNeeded();
    await route(scenarios[index].expectedRoute);
    await verdict('allow');
    if (index < 19) await advance();
  }
  await visible(page.getByRole('heading', { name: 'Периметр скомпрометирован' }));
  assert.match(await stat('Пропущено атак').textContent(), /10/);
  assert.match(await stat('Обработано пакетов').textContent(), /20/);
  assert.equal(await page.getByRole('button', { name: 'Следующий пакет', exact: true }).count(), 0);
  assert.equal(await page.getByRole('switch', { name: 'Модуль IDPS' }).isDisabled(), true);
  assert.equal(await page.getByRole('switch', { name: 'Профиль СОВ' }).isDisabled(), true);
  await page.keyboard.press('2');
  await page.keyboard.press('a');
  assert.match(await stat('Обработано пакетов').textContent(), /20/);
  await page.getByRole('button', { name: 'Разбор решений', exact: true }).click();
  assert.equal(await page.locator('.journal-entry').count(), 20);
  console.log('PASS exact tenth miss ends shift and blocks further decisions');

  await page.setViewportSize({ width: 390, height: 844 });
  await fresh();
  await checkNoOverflow('mobile initial');
  await page.screenshot({ path: '/tmp/ngfw-mobile.png', fullPage: true });
  await playCorrect(scenarios[0]);
  await advance();
  await route('full');
  await verdict('block');
  await visible(page.getByRole('dialog', { name: 'Log4Shell' }));
  await checkNoOverflow('mobile attack card');
  await closeAttack();
  await page.getByRole('button', { name: /Коллекция угроз/ }).click();
  await checkNoOverflow('mobile collection');
  await page.setViewportSize({ width: 360, height: 800 });
  await checkNoOverflow('small mobile collection');
  await page.getByRole('button', { name: 'Журнал событий', exact: true }).click();
  await checkNoOverflow('small mobile journal');
  console.log('PASS mobile gameplay, modal, collection and journal without horizontal overflow');

  assert.deepEqual(errors, [], 'no browser runtime exceptions');
  console.log('All browser checks passed. Screenshots: /tmp/ngfw-desktop.png, /tmp/ngfw-mobile.png');
} finally {
  await browser.close();
}
