import { chromium } from '@playwright/test';

const baseUrl = process.env.QATRIAL_BASE_URL ?? 'http://localhost:3001';
const email = process.env.QATRIAL_E2E_EMAIL;
const password = process.env.QATRIAL_E2E_PASSWORD;
const executablePath = process.env.QATRIAL_BROWSER_PATH
  ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

if (!email || !password) {
  throw new Error('Set QATRIAL_E2E_EMAIL and QATRIAL_E2E_PASSWORD before running this smoke test.');
}

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const consoleErrors = [];

page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(error.message));

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('#root').waitFor();
  if (!(await page.locator('#root').innerText()).trim()) {
    throw new Error('The application root rendered no visible content.');
  }

  await page.locator('#auth-email').fill(email);
  await page.locator('#auth-password').fill(password);
  await page.locator('form button[type="submit"]').click();

  const projectPicker = page.getByRole('combobox', { name: 'Project' });
  await projectPicker.waitFor({ state: 'visible', timeout: 15_000 });
  if (await projectPicker.locator('option').count() < 1) {
    throw new Error('Login succeeded but no server projects rendered.');
  }

  // Recreate the legacy worker's stale app-shell cache and offline database.
  // The current page must delete both during the next boot and continue to
  // render normally.
  await page.evaluate(async () => {
    const cache = await caches.open('qatrial-v2');
    await cache.put('/', new Response('<main>obsolete app shell</main>', {
      headers: { 'Content-Type': 'text/html' },
    }));
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('qatrial-offline', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('mutations');
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await projectPicker.waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForFunction(async () => !(await caches.keys()).includes('qatrial-v2'));
  await page.waitForFunction(async () => {
    const databases = await indexedDB.databases();
    return !databases.some((database) => database.name === 'qatrial-offline');
  });

  if (!(await page.locator('#root').innerText()).trim()) {
    throw new Error('The app became blank after the poisoned-cache reload.');
  }
  if (consoleErrors.length > 0) {
    throw new Error(`Browser console errors:\n${consoleErrors.join('\n')}`);
  }

  console.log('Browser smoke passed: root rendered, login/projects succeeded, legacy cache was purged.');
} finally {
  await browser.close();
}
