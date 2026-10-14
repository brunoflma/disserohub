// Português fixo. Transferir preferências entre os endereços locais antes de inicializar o aplicativo.
import { setLocale } from '../../shared/i18n';
import { prepareLocalOrigin } from './local/branding-origin';

setLocale('pt-BR');
void prepareLocalOrigin().then((ready) => ready ? import('./app').then((app) => app.start()) : undefined).catch(() => {
  const panel = document.createElement('section');
  panel.style.cssText = 'position:fixed;inset:20%;padding:28px;background:#122521;color:#f3f0e8;font:18px/1.6 Segoe UI,sans-serif;border:1px solid #bca477;border-radius:14px';
  const title = document.createElement('h1'); title.textContent = 'Dissero';
  const text = document.createElement('p'); text.textContent = 'Não foi possível concluir a abertura. Recarregue a página ou continue pelo endereço anterior. As preferências anteriores foram preservadas.';
  const link = document.createElement('a');
  const previous = new URL(location.href); previous.hostname = 'habblaud.localhost'; previous.hash = ''; previous.searchParams.set('dissero-legacy', '1');
  link.href = previous.href; link.textContent = 'Abrir o endereço anterior'; link.style.color = '#dfcba4';
  panel.append(title, text, link); document.body.append(panel);
});
