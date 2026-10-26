import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gamePath = resolve(root, 'dist/packet-control.html');
await access(gamePath);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 960 } });
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
    await page.setContent(await readFile(gamePath, 'utf8'));
  }
  await page.getByRole('heading', { name: 'Трафик под контролем.' }).waitFor();
  const logo = page.getByRole('img', { name: 'UserGate', exact: true });
  assert.match(await logo.getAttribute('src'), /^data:image\/svg\+xml,/);
  await logo.evaluate(image => image.decode());
  assert.ok(await logo.evaluate(image => image.naturalWidth > 0), 'inline brand logo renders offline');
  const chooseFull = () => page.getByRole('button', { name: /Полная проверка Глубокая проверка/ }).click();
  await chooseFull();
  await page.getByRole('button', { name: /Разрешить Нормальный трафик/ }).click();
  await page.getByRole('status').getByText('Верное решение!', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Следующий пакет', exact: true }).click();
  await chooseFull();
  await page.getByRole('button', { name: /Заблокировать Вредоносный трафик/ }).click();
  const dossier = page.getByRole('dialog', { name: 'Log4Shell' });
  await dossier.waitFor();
  assert.ok((await dossier.textContent()).includes('CVE-2021-44228'));
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
