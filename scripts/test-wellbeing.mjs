// Synthetic time and desktop signals; no real usage history or OS notification is touched.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const base = process.argv[2];
if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error('Pass the synthetic fixture loopback URL.');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => {
  window.__rhythmFocused = true; window.__rhythmNotices = [];
  Object.defineProperty(document, 'hasFocus', { value: () => window.__rhythmFocused });
  Object.defineProperty(document, 'hidden', { get: () => false });
  window.Notification = class {
    static permission = 'granted';
    static async requestPermission() { return 'granted'; }
    constructor(title, options) { window.__rhythmNotices.push({ title, options }); }
    close() {}
  };
});
const page = await context.newPage(); page.setDefaultTimeout(20_000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
let claims = 0; page.on('request', request => { if (request.url().includes('/api/wellbeing/action') && request.postDataJSON()?.action === 'ack') claims++; });
const panel = page.getByRole('dialog', { name: 'Ritmo de uso', exact: true });
const reminder = page.getByRole('status', { name: 'Lembrete de pausa' });
let passed = 0; const check = name => { passed++; console.log(`PASS ${name}`); };
const scenario = async name => {
  const report = await (await page.request.get(`${base}/fixture/rhythm?name=${name}`)).json();
  await page.goto(base); await page.waitForFunction(() => window.dissero?.store.connection === 'open'); return report;
};
const open = async () => { await page.getByRole('button', { name: /^Ritmo de uso:/ }).click(); await panel.waitFor(); };
try {
  await page.request.get(`${base}/fixture/scenario?name=basic`);
  let report = await scenario('agents-only');
  assert.equal(report.periods.day.personalMs, 0); assert.equal(report.periods.day.agentMs, 300_000);
  await open(); await panel.locator('.ui-rhythm__personal').filter({ hasText: '0 min' }).waitFor();
  await panel.locator('.ui-rhythm__totals').getByText('5 min', { exact: true }).waitFor(); check('tempo dos agentes separado do tempo pessoal');
  report = await scenario('overlap');
  assert.equal(report.periods.day.personalMs, 300_000); assert.equal(report.periods.day.agentMs, 300_000);
  await open(); await panel.locator('.ui-rhythm__totals').getByText('5 min', { exact: true }).first().waitFor(); check('fontes simultâneas sem duplicar o tempo');

  report = await scenario('break'); assert.equal(report.reminder.kind, 'break');
  await reminder.getByText('Que tal uma pausa?', { exact: true }).waitFor();
  assert.equal(claims, 0, 'foreground page must not consume system notification');
  await open(); await panel.getByText('Lembretes e limites', { exact: true }).click();
  await panel.getByRole('button', { name: 'Ativar avisos do sistema' }).click();
  await page.evaluate(() => { window.__rhythmFocused = false; window.dispatchEvent(new Event('blur')); });
  await page.waitForFunction(() => window.__rhythmNotices.length === 1);
  assert.equal(claims, 1); assert.match((await page.evaluate(() => window.__rhythmNotices))[0].title, /pausa/);
  check('aviso do sistema com janela sem foco, mesmo sem document.hidden');
  await panel.getByRole('button', { name: 'Fechar acompanhamento' }).click();
  await page.evaluate(() => { window.__rhythmFocused = true; });
  await reminder.getByRole('button', { name: 'Fazer uma pausa' }).click();
  await reminder.waitFor({ state: 'hidden' });
  await open(); await panel.getByText(/Acompanhamento em pausa/).waitFor();
  const paused = await (await page.request.get(`${base}/api/wellbeing?tz=America%2FFortaleza`)).json();
  const afterPause = await (await page.request.get(`${base}/fixture/rhythm?name=advance`)).json();
  assert.equal(afterPause.periods.day.personalMs, paused.periods.day.personalMs);
  assert.equal(afterPause.periods.day.breakCount, 1); check('pausa suspende contagem pessoal e registra descanso');

  report = await scenario('daily'); assert.equal(report.reminder.kind, 'daily');
  await reminder.getByText('Seu limite de hoje foi atingido', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__rhythmNotices.length), 0);
  await page.evaluate(() => { window.__rhythmFocused = false; });
  await page.waitForFunction(() => window.__rhythmNotices.length === 1);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForResponse(response => response.url().includes('/api/wellbeing?') && response.status() === 200);
  assert.equal(await page.evaluate(() => window.__rhythmNotices.length), 1); check('alerta diário tem prioridade e não se repete');
  await page.evaluate(() => { window.__rhythmFocused = true; });
  await reminder.getByRole('button', { name: 'Lembrar em 10 min' }).click();
  await reminder.waitFor({ state: 'hidden' }); check('adiar remove o aviso durante o intervalo');

  await scenario('break'); await reminder.waitFor();
  await page.request.get(`${base}/fixture/scenario?name=demo`); await reminder.waitFor({ state: 'hidden' });
  await open(); await panel.getByText(/Demonstração, reprodução/).waitFor(); check('demonstração não apresenta alertas pessoais');
  await page.request.get(`${base}/fixture/scenario?name=basic`); await page.reload(); await open();
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 700]]) {
    await page.setViewportSize({ width, height });
    assert.equal(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    await page.screenshot({ path: join(tmpdir(), 'disserohub-work-center-browser', `rhythm-${width}.png`) });
  }
  check('painel preservado em desktop e telas pequenas');
  assert.deepEqual(errors, []); console.log(`${passed} wellbeing browser scenarios passed`);
} catch (error) {
  console.error(await panel.innerText().catch(() => 'Panel unavailable'));
  throw error;
} finally { await browser.close(); }
