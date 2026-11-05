// Run against the synthetic work-center fixture only.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const base = process.argv[2];
if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error('Pass the synthetic fixture loopback URL.');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
const artifacts = join(tmpdir(), 'disserohub-work-center-browser'); await mkdir(artifacts, { recursive: true });
let passed = 0;
const check = (name) => { passed++; console.log(`PASS ${name}`); };
const tasks = page.getByRole('region', { name: 'Tarefas persistentes' });
const card = title => tasks.locator('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
async function open(project = 'project-a') {
  await page.getByRole('button', { name: /^Central de trabalho/ }).click();
  await page.getByRole('tab', { name: 'Tarefas', exact: true }).click();
  await page.getByLabel('Projeto', { exact: true }).selectOption(project);
  await tasks.getByRole('button', { name: 'Nova tarefa', exact: true }).waitFor();
}
async function create(title, criterion) {
  await tasks.getByRole('button', { name: 'Nova tarefa', exact: true }).click();
  await tasks.getByLabel('Título', { exact: true }).fill(title);
  await tasks.getByLabel('Responsável', { exact: true }).fill('Pessoa de teste');
  await tasks.getByLabel('Critérios de aceite', { exact: true }).fill(criterion);
  await tasks.getByRole('button', { name: 'Salvar tarefa', exact: true }).click();
  await card(title).waitFor();
}
try {
  assert.equal((await page.request.post(`${base}/fixture/reset-tasks`)).status(), 200);
  await page.request.get(`${base}/fixture/scenario?name=basic`);
  await page.goto(base); await open();
  await create('Conferir relatório persistente', 'Totais conferidos');
  const firstId = await card('Conferir relatório persistente').getAttribute('data-task-id');
  check('criação com responsável e critérios');
  await page.reload(); await open(); await card('Conferir relatório persistente').waitFor();
  check('persistência após recarregar a página');
  await page.getByLabel('Projeto', { exact: true }).selectOption('project-b');
  assert.equal(await tasks.locator('article').count(), 0);
  await create('Tarefa da outra sala', 'Separação conferida');
  await page.getByLabel('Projeto', { exact: true }).selectOption('project-a');
  await card('Conferir relatório persistente').waitFor();
  assert.equal(await card('Tarefa da outra sala').count(), 0); check('separação por projeto');

  await card('Conferir relatório persistente').getByRole('button', { name: 'Editar tarefa' }).click();
  await tasks.getByLabel('Título', { exact: true }).fill('Rascunho local preservado');
  await context.setOffline(true);
  await page.request.get(`${base}/fixture/disconnect`);
  await tasks.getByText(/Abra o escritório local ao vivo/).waitFor();
  await context.setOffline(false);
  await tasks.getByLabel('Título', { exact: true }).waitFor();
  assert.equal(await tasks.getByLabel('Título', { exact: true }).inputValue(), 'Rascunho local preservado');
  const existing = (await (await page.request.get(`${base}/api/project-tasks`)).json()).tasks.find(t => t.id === firstId);
  const external = await page.request.patch(`${base}/api/project-tasks/${firstId}`, { data: { ...existing, title: 'Alterado em outra aba' } });
  assert.equal(external.status(), 200);
  await tasks.getByRole('button', { name: 'Salvar tarefa', exact: true }).click();
  await tasks.getByRole('alert').filter({ hasText: 'mudou em outra página' }).waitFor();
  assert.equal(await tasks.getByLabel('Título', { exact: true }).inputValue(), 'Rascunho local preservado');
  await tasks.getByRole('button', { name: 'Atualizar lista', exact: true }).click();
  await card('Alterado em outra aba').waitFor();
  await tasks.getByRole('button', { name: 'Recarregar tarefa salva', exact: true }).click();
  assert.equal(await tasks.getByLabel('Título', { exact: true }).inputValue(), 'Alterado em outra aba');
  await tasks.getByRole('button', { name: 'Fechar edição' }).click(); check('conflito entre abas preserva o rascunho');

  await card('Alterado em outra aba').getByRole('button', { name: 'Revisar entrega' }).click();
  await tasks.getByLabel('Entrega', { exact: true }).selectOption({ index: 1 });
  await tasks.getByRole('button', { name: 'Aprovar e concluir' }).click();
  await tasks.getByRole('alert').filter({ hasText: 'Confira todos os critérios' }).waitFor();
  await tasks.getByRole('button', { name: 'Pedir ajustes' }).click();
  await tasks.getByRole('alert').filter({ hasText: 'Descreva os ajustes' }).waitFor();
  await tasks.getByLabel('Observações da revisão').fill('Conferir novamente os totais.');
  await tasks.getByRole('button', { name: 'Pedir ajustes' }).click();
  await tasks.getByRole('status').filter({ hasText: 'Revisão registrada' }).waitFor();
  assert.match(await card('Alterado em outra aba').innerText(), /Em andamento/); check('revisão exige critérios e registra ajustes');

  await card('Alterado em outra aba').getByRole('button', { name: 'Revisar entrega' }).click();
  await tasks.getByLabel('Entrega', { exact: true }).selectOption({ index: 1 });
  await tasks.getByLabel('Totais conferidos', { exact: true }).check();
  await tasks.getByRole('button', { name: 'Aprovar e concluir' }).click();
  await tasks.getByRole('status').filter({ hasText: 'Revisão registrada' }).waitFor();
  assert.match(await card('Alterado em outra aba').innerText(), /Concluída/);
  await card('Alterado em outra aba').getByRole('button', { name: 'Revisar entrega' }).click();
  await tasks.getByText('Histórico de revisões (2)', { exact: true }).click();
  await tasks.getByText('Conferir novamente os totais.', { exact: true }).waitFor();
  check('aprovação e histórico duráveis');

  for (const [width, height] of [[1440, 1000], [1024, 768], [768, 1024], [390, 844], [320, 700]]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.locator('.ui-work').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `dialog overflow ${width}`);
    assert.equal(await tasks.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `task overflow ${width}`);
    await page.screenshot({ path: join(artifacts, `tasks-${width}.png`) });
  }
  check('tarefas e revisão em cinco tamanhos de tela');
  const before = (await (await page.request.get(`${base}/fixture/counters`)).json()).writes;
  await page.request.get(`${base}/fixture/scenario?name=demo`);
  await tasks.getByText(/Abra o escritório local ao vivo/).waitFor();
  assert.equal(await tasks.getByRole('button', { name: 'Nova tarefa', exact: true }).isDisabled(), true);
  assert.equal((await (await page.request.get(`${base}/fixture/counters`)).json()).writes, before);
  check('demonstração não altera tarefas reais');
  assert.deepEqual(errors, []);
  console.log(`${passed} project task browser scenarios passed; artifacts: ${artifacts}`);
} catch (error) {
  console.error(await tasks.innerText().catch(() => 'Task panel unavailable'));
  await page.screenshot({ path: join(artifacts, 'tasks-failure.png') }).catch(() => {});
  throw error;
} finally { await browser.close(); }
