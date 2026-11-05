// Run against server/test/work-center-ui-server.ts only. No live sessions or accounts.
// npx tsx server/test/work-center-ui-server.ts
// node scripts/test-work-center.mjs http://127.0.0.1:<fixture-port>
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const url = process.argv[2];
if (!url || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new Error('Pass the isolated fixture URL.');
const output = join(tmpdir(), 'disserohub-work-center-browser');
await mkdir(output, { recursive: true });
const channel = process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'chrome' : undefined);
const browser = await chromium.launch({ headless: true, channel });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && message.text().includes('[ui]')) errors.push(message.text()); });
const results = [];
const initialWrites = (await (await page.request.get(`${url}/fixture/counters`)).json()).writes;
const check = (name) => { results.push(name); console.log(`PASS ${name}`); };
const center = page.getByRole('dialog', { name: 'Central de trabalho', exact: true });
const open = async () => { await page.getByRole('button', { name: /^Central de trabalho/ }).click(); await center.waitFor(); };
const tab = async name => { await center.getByRole('tab', { name, exact: true }).click(); };
const scenario = async name => {
  await page.request.get(`${url}/fixture/scenario?name=${name}`);
  await page.goto(url);
  await page.waitForFunction(() => window.dissero?.store.snapshot && window.dissero.store.connection === 'open');
  await open();
};

try {
  await scenario('basic');
  assert.equal(await center.getByRole('tab').count(), 5);
  await center.getByLabel('Projeto', { exact: true }).selectOption('project-b');
  await center.getByText('A sala está registrada e não tem sessões observadas agora.', { exact: true }).waitFor();
  check('registered room remains useful without agents');
  await center.getByLabel('Projeto', { exact: true }).selectOption('project-a');
  await center.getByText('Conferir filtros do projeto', { exact: true }).first().waitFor();
  await center.getByText('Relatório de filtros preparado', { exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'project-desktop.png') });
  check('project summary and actual delivery, with Windows path normalization');
  await tab('Precisa de você');
  await center.getByText('Qual escopo revisar no cartão original?', { exact: true }).waitFor();
  await center.getByText('Qual formato entregar?', { exact: true }).waitFor();
  assert.equal(await center.locator('.ui-work__item').count(), 4);
  await page.screenshot({ path: join(output, 'attention-desktop.png') });
  check('native asynchronous question, direct question, waiting and error all visible');
  await center.getByRole('button', { name: 'Abrir pedido', exact: true }).click();
  await center.waitFor({ state: 'hidden' });
  await page.getByText('Qual formato entregar?', { exact: true }).filter({ visible: true }).waitFor();
  check('direct question hands off to the existing agent drawer');
  await open(); await tab('Modelos de tarefa');
  const objective = center.getByLabel('Objetivo da tarefa', { exact: true });
  const model = center.getByLabel('Modelo de tarefa', { exact: true });
  const preview = center.getByLabel('Prévia do prompt gerado', { exact: true });
  const copy = center.getByRole('button', { name: 'Copiar prompt gerado', exact: true });
  assert.equal(await copy.isDisabled(), true);
  await objective.fill('Comparar os filtros do projeto');
  await center.getByLabel('Contexto adicional', { exact: true }).fill('Preservar a interface atual.');
  await model.selectOption('bug-fix');
  assert.equal(await objective.inputValue(), '');
  await objective.fill('Corrigir a busca');
  await model.selectOption('research');
  assert.equal(await objective.inputValue(), 'Comparar os filtros do projeto');
  await objective.focus();
  await page.request.get(`${url}/fixture/scenario?name=basic`);
  await page.waitForTimeout(250);
  assert.equal(await objective.evaluate(el => document.activeElement === el), true);
  assert.match(await preview.inputValue(), /Projeto Aurora/);
  await tab('Integrações'); await tab('Modelos de tarefa');
  assert.equal(await objective.inputValue(), 'Comparar os filtros do projeto');
  await center.getByRole('button', { name: 'Fechar central de trabalho', exact: true }).click();
  await open();
  assert.equal(await objective.inputValue(), 'Comparar os filtros do projeto');
  check('template drafts survive model/tab/dialog changes and live updates without focus loss');

  await page.evaluate(() => { window.__copiedPrompt = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copiedPrompt = text; } } }); });
  await copy.click();
  await center.getByText('Prompt copiado para a área de transferência.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__copiedPrompt), await preview.inputValue());
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } });
    document.execCommand = () => false;
  });
  await copy.click();
  await center.getByText('Não foi possível copiar. Selecione o texto da prévia e copie manualmente.', { exact: true }).waitFor();
  await page.evaluate(() => {
    document.execCommand = () => { window.__fallbackInsideDialog = document.activeElement?.closest('dialog')?.open === true; return true; };
  });
  await copy.click();
  await center.getByText('Prompt copiado para a área de transferência.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__fallbackInsideDialog), true);
  check('clipboard success, refusal and legacy fallback inside the modal');

  await tab('Integrações');
  await center.getByText('Canal disponível em 1 sessão(ões)', { exact: true }).waitFor();
  await center.getByText('Aguardando canal de uma sessão', { exact: true }).waitFor();
  assert.equal(await center.getByLabel('Projeto', { exact: true }).isDisabled(), true);
  await center.getByRole('tab', { name: 'Integrações', exact: true }).press('Home');
  assert.equal(await center.getByRole('tab', { name: 'Projetos', exact: true }).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Escape'); await center.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: /^Central de trabalho/ }).evaluate(el => document.activeElement === el), true);
  check('integration evidence and keyboard navigation with restored focus');

  await scenario('restricted'); await tab('Integrações');
  assert.equal(await center.getByText('Não permitidas nesta página', { exact: true }).count(), 4);
  const before = (await (await page.request.get(`${url}/fixture/counters`)).json()).reads;
  await tab('Projetos'); await center.getByLabel('Projeto', { exact: true }).selectOption('project-a');
  await center.getByText('Entregas não disponíveis neste modo ou acesso.', { exact: true }).waitFor();
  assert.equal((await (await page.request.get(`${url}/fixture/counters`)).json()).reads, before);
  check('restricted access avoids delivery reads and does not advertise write capabilities');

  await scenario('expired'); await tab('Precisa de você');
  assert.equal(await center.getByRole('button', { name: 'Abrir pedido', exact: true }).count(), 0);
  await center.getByText('Qual escopo revisar no cartão original?', { exact: true }).waitFor();
  check('expired permission disappears while a separate native question remains');
  await scenario('empty');
  await center.getByText('Nenhum projeto registrado ou observado ainda.', { exact: true }).waitFor();
  await tab('Precisa de você'); await center.getByText('Nenhuma pendência observada neste recorte.', { exact: true }).waitFor();
  check('empty project and attention states');

  await scenario('delivery-error'); await center.getByLabel('Projeto', { exact: true }).selectOption('project-a');
  await center.getByText('Não foi possível consultar as entregas.', { exact: true }).waitFor();
  await page.request.get(`${url}/fixture/scenario?name=basic`);
  await center.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await center.getByText('Relatório de filtros preparado', { exact: true }).waitFor();
  check('delivery failure and explicit retry recover');

  const replayReads = (await (await page.request.get(`${url}/fixture/counters`)).json()).reads;
  await page.evaluate(() => window.dissero.store.pushReplay(structuredClone(window.dissero.store.snapshot)));
  await center.getByText('Reprodução histórica. Os registros abaixo pertencem ao instante selecionado.', { exact: true }).waitFor();
  await center.getByText('Entregas não disponíveis neste modo ou acesso.', { exact: true }).waitFor();
  await tab('Integrações');
  assert.equal(await center.getByText('Somente consulta', { exact: true }).count(), 2);
  assert.equal((await (await page.request.get(`${url}/fixture/counters`)).json()).reads, replayReads);
  await page.evaluate(() => window.dissero.store.stopReplay());
  await tab('Projetos');
  await center.getByText('Relatório de filtros preparado', { exact: true }).waitFor();
  check('replay blocks delivery reads and current capabilities, then restores live view');

  await scenario('demo'); await center.getByLabel('Projeto', { exact: true }).selectOption('project-a');
  await center.getByText('Demonstração com dados fictícios.', { exact: true }).waitFor();
  await center.getByText('Entregas não disponíveis neste modo ou acesso.', { exact: true }).waitFor();
  check('demo is labelled and never mixed with real deliveries');
  await scenario('basic'); await center.getByLabel('Projeto', { exact: true }).selectOption('project-a');

  for (const [width, height] of [[1440, 1000], [1024, 768], [768, 1024], [390, 844], [320, 700]]) {
    await page.setViewportSize({ width, height });
    for (const name of ['Projetos', 'Tarefas', 'Precisa de você', 'Modelos de tarefa', 'Integrações']) {
      await tab(name);
      const dimensions = await center.evaluate(el => ({ width: el.getBoundingClientRect().width, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right,
        panelWidth: el.querySelector('[role=tabpanel]').clientWidth, panelScroll: el.querySelector('[role=tabpanel]').scrollWidth }));
      assert.ok(dimensions.left >= 0 && dimensions.right <= width + 1, `${name} fits viewport ${width}`);
      assert.ok(dimensions.panelScroll <= dimensions.panelWidth + 1, `${name} no body overflow ${width}: ${JSON.stringify(dimensions)}`);
    }
    if (width === 390) { await tab('Precisa de você'); await page.screenshot({ path: join(output, 'attention-mobile.png') }); }
  }
  check('all five sections fit five viewports, including 320px');
  assert.equal((await (await page.request.get(`${url}/fixture/counters`)).json()).writes, initialWrites);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: results.length, errors, screenshots: output }));
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  console.error(JSON.stringify({ error: String(error), pageErrors: errors, screenshots: output }));
  throw error;
} finally { await browser.close(); }
