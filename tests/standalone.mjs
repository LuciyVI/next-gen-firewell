import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createScenarioSession } from '../src/session.ts';

let fixture;
for (let index = 1; index <= 256; index += 1) {
  const uint = Math.floor(index / 257 * 2 ** 32);
  const deck = createScenarioSession(() => uint / 2 ** 32);
  if (!deck[0].malicious && deck[0].expectedRoute === 'full' && deck[1].malicious && deck[1].attack?.cve) {
    fixture = { uint, deck };
    break;
  }
}
assert.ok(fixture, 'generated fixture search must find benign and attack examples');
function installEntropy(value) {
  Object.defineProperty(globalThis.crypto, 'getRandomValues', {
    configurable: true,
    value(array) { array.fill(value); return array; },
  });
}


const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gamePath = resolve(root, 'dist/packet-control.html');
await access(gamePath);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 960 } });
  await context.addInitScript(installEntropy, fixture.uint);
  // File contents must work without any HTTP service or Internet connection.
  await context.setOffline(true);
  let page = await context.newPage();
  const failures = [];
  const network = [];
  function monitor(target) {
    target.on('pageerror', error => failures.push(error.message));
    target.on('request', request => {
      if (/^https?:/i.test(request.url())) network.push(request.url());
    });
  }
  monitor(page);
  let launchMode = 'file://';
  try {
    await page.goto(pathToFileURL(gamePath).href);
  } catch (error) {
    if (!String(error).includes('ERR_BLOCKED_BY_ADMINISTRATOR')) throw error;
    console.log('SKIP direct file:// launch: managed Chromium policy blocks local-file navigation.');
    await page.close();
    page = await context.newPage();
    monitor(page);
    launchMode = 'in-memory document';
    // Test our own generated document without asking Chromium to access the filesystem.
    await page.evaluate(installEntropy, fixture.uint);
    await page.setContent(await readFile(gamePath, 'utf8'));
  }
  await page.getByRole('heading', { name: 'Трафик под контролем.' }).waitFor();
  const logo = page.getByRole('img', { name: 'UserGate', exact: true });
  assert.match(await logo.getAttribute('src'), /^data:image\/svg\+xml,/);
  await logo.evaluate(image => image.decode());
  assert.ok(await logo.evaluate(image => image.naturalWidth > 0), 'inline brand logo renders offline');
  assert.equal(await page.locator('.packet-app h2').textContent(), fixture.deck[0].app);
  assert.deepEqual(await page.locator('.address-flow strong').allTextContents(), [fixture.deck[0].source, fixture.deck[0].destination]);
  const chooseFull = () => page.getByRole('button', { name: /Полная проверка Глубокая проверка/ }).click();
  await chooseFull();
  await page.getByRole('button', { name: /Разрешить Нормальный трафик/ }).click();
  await page.getByRole('status').getByText('Верное решение!', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Следующий пакет', exact: true }).click();
  await chooseFull();
  await page.getByRole('button', { name: /Заблокировать Вредоносный трафик/ }).click();
  const dossier = page.getByRole('dialog', { name: fixture.deck[1].attack.name });
  await dossier.waitFor();
  assert.ok((await dossier.textContent()).includes(fixture.deck[1].attack.cve));
  await dossier.getByRole('button', { name: 'Продолжить смену', exact: true }).click();
  await page.getByRole('button', { name: 'Коллекция угроз', exact: true }).click();
  assert.equal(await page.locator('.collection-card.unlocked').count(), 1);
  await page.getByRole('button', { name: 'Симулятор', exact: true }).click();
  await page.getByRole('button', { name: 'Начать заново', exact: true }).click();
  await page.getByRole('dialog', { name: 'Новая смена' }).getByRole('button', { name: 'Начать заново', exact: true }).click();
  assert.match(await page.locator('.packet-number').textContent(), /#0001/);
  assert.equal(await page.getByRole('button', { name: /Разрешить Нормальный трафик/ }).isDisabled(), true);
  assert.deepEqual(network, [], 'standalone game must not request HTTP assets or services');
  assert.deepEqual(failures, [], 'standalone game must not raise runtime errors');
  console.log(`PASS standalone ${launchMode} offline: normal packet, attack, CVE card, collection, restart, no network requests`);
} finally {
  await browser.close();
}
