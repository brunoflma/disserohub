import type { Provider } from '../../shared/types';

/** Marcas locais compartilhadas pelos componentes HTML e pelo escritório em canvas. */
export const PROVIDER_LOGO: Record<Provider, string> = {
  claude: '/assets/brand/claude-code.svg',
  codex: '/assets/brand/chatgpt.svg',
};
