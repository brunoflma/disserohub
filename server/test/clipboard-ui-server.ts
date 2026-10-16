// Opt-in browser regression fixture. Imports only the copy helper, without accounts or agent sessions.
// node --import tsx server/test/clipboard-ui-server.ts
import http from 'node:http';
import { resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';

const html = `<!doctype html>
<html lang="pt-BR">
<meta charset="utf-8">
<title>Dissero · validação de cópia</title>
<style>
  body { font: 16px Segoe UI, sans-serif; color: #e4e9ec; background: #18212a; padding: 28px; }
  button { font: inherit; padding: 10px 16px; margin: 8px; }
  dialog { color: inherit; background: #24313e; padding: 24px; border: 1px solid #93aab9; }
  dialog::backdrop { background: #0009; }
  pre { white-space: pre-wrap; padding: 16px; background: #101820; }
</style>
<h1>Validação de cópia do Dissero</h1>
<p>Somente texto sintético. Nenhum agente ou conta é carregado.</p>
<button id="open">Abrir janela de teste</button>
<button id="outside">Copiar fora da janela</button>
<pre id="result" role="status">Aguardando teste</pre>
<dialog id="modal" aria-labelledby="title">
  <h2 id="title">Janela modal de teste</h2>
  <button id="inside">Copiar dentro da janela</button>
  <button id="close">Fechar janela</button>
  <label>Conferir texto colado <input id="pasted" autocomplete="off"></label>
  <pre id="modal-result" role="status">Aguardando teste</pre>
</dialog>
<script type="module">
  import { copyText } from '/src/ui/dom.ts';
  const mode = new URLSearchParams(location.search).get('mode') ?? 'fallback';
  // The embedded browser can provide a host clipboard even when Permissions-Policy rejects it.
  // Model browsers without the modern API explicitly, only on this isolated fixture page.
  if (mode !== 'modern') Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  const modal = document.querySelector('#modal');
  const result = document.querySelector('#result');
  const modalResult = document.querySelector('#modal-result');
  const text = 'DISSERO-CLIPBOARD-SYNTHETIC-' + mode;
  let calls = 0;
  let helperInsideDialog = false;
  let copyEventSelection = '';
  document.addEventListener('copy', () => {
    const helper = document.querySelector('textarea');
    copyEventSelection = helper ? helper.value.slice(helper.selectionStart, helper.selectionEnd) : '';
  });
  const exec = document.execCommand.bind(document);
  // Instrument the native fallback; only the two denial scenarios change its result.
  document.execCommand = (command, ...args) => {
    calls++;
    helperInsideDialog = !!modal.querySelector('textarea');
    if (mode === 'legacy-false') return false;
    if (mode === 'legacy-throw') throw new Error('Synthetic copy denial');
    return exec(command, ...args);
  };
  async function copy() {
    calls = 0;
    helperInsideDialog = false;
    copyEventSelection = '';
    const originalFocus = document.activeElement;
    const ok = await copyText(text);
    const state = {
      mode, ok, fallbackCalls: calls, helperInsideDialog,
      focusRestored: document.activeElement === originalFocus,
      temporaryFields: document.querySelectorAll('textarea').length,
      copyEventHasExpectedText: copyEventSelection === text,
    };
    result.textContent = modalResult.textContent = JSON.stringify(state, null, 2);
  }
  document.querySelector('#open').onclick = () => modal.showModal();
  document.querySelector('#close').onclick = () => modal.close();
  document.querySelector('#inside').onclick = copy;
  document.querySelector('#outside').onclick = copy;
  result.textContent = 'Modo: ' + mode;
</script>
</html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/') return vite.middlewares(req, res);
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (url.searchParams.get('mode') !== 'modern') res.setHeader('Permissions-Policy', 'clipboard-write=()');
  res.end(html);
});
const vite = await createViteServer({ configFile: resolve('vite.config.ts'), server: { middlewareMode: true, ws: { server } }, appType: 'custom' });
await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok));
console.log('CLIPBOARD_UI_URL=http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port);
const stop = () => { server.closeAllConnections(); server.close(); void vite.close().then(() => process.exit(0)); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
