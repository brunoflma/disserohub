# Modern Web Guidance no DisseroHub

## Escopo

Adotamos os [guias oficiais do Chrome](https://developer.chrome.com/docs/modern-web-guidance)
como referência consultiva para a interface local. Não são uma dependência do
aplicativo, uma auditoria já aprovada nem uma instalação automática de plugin.
A instalação opcional de ferramentas segue o [guia oficial](https://developer.chrome.com/docs/modern-web-guidance/get-started)
e requer revisão do pacote, versão e escopo antes da execução. Não execute o
instalador `@latest` automaticamente, não copie o catálogo para a distribuição
e não habilite atualização global ou novo gate de CI.

A meta inicial de compatibilidade é **Baseline Widely Available**. A orientação
não dispensa a matriz real de navegadores: confira a disponibilidade de cada API
e use melhoria progressiva ou alternativa funcional quando necessário. Recursos
experimentais ficam fora da adoção inicial.

## Fluxo de trabalho

1. Escolha uma superfície e um problema verificável. Registre comportamento
   anterior, guia oficial consultado e critério de aceite.
2. Preserve identidade visual, traduções e contratos. O projeto já usa `<dialog>`
   no seletor de projetos e Popover nas configurações; não os substitua só para
   modernizar. Prefira corrigir uma regressão comprovada.
3. Faça uma alteração pequena, sem misturar servidor, PTY, atualização, credenciais
   ou dados da instalação. Não envie documentos, caminhos pessoais ou sessões a
   serviços de diagnóstico externos.
4. Execute as verificações existentes e confira a interface no navegador. Um
   build aprovado não comprova foco, acessibilidade ou desempenho.
5. No PR, registre os navegadores/versões, viewport, entrada usada, resultados e
   tudo que não foi verificado. Publicação continua sendo uma etapa separada.

## Verificação pela entrada de uso

Em um clone isolado com dados de demonstração, use `npm ci`, `npm run build` e
`npm start` e abra `http://127.0.0.1:4747`. Não inicialize uma instalação real para
essa revisão. O modo `npm run demo` pode ser usado conforme a documentação local;
não habilite PTY, instaladores de integração ou login remoto para testar layout.

| Superfície | Critério de aceite |
| --- | --- |
| Configurações | Abrir por teclado; nome acessível; Tab e setas nas opções; estado selecionado anunciado; fechar e recuperar o foco no acionador. |
| Adicionar projeto | Usar só pasta sintética; abrir/fechar o diálogo, cancelar e receber erro acessível; não cadastrar pasta nem iniciar sessão real. |
| Ritmo de uso | Abrir o modal; percorrer controles; fechar sem perder foco; não alterar preferências pessoais da instalação existente. |
| Painéis e notificações | Textos e controles não se sobrepõem em janela de 360 px; zoom de 200% preserva ações; foco visível não fica atrás de painel. |
| Movimento | Com `prefers-reduced-motion: reduce`, conferir animações, transições e movimentação do escritório sem tornar ações inacessíveis. |
| Atualização visual | Estados de carregamento, falha e indisponibilidade são legíveis; nunca clicar em instalar/atualizar como parte deste teste. |

Execute a matriz em Chrome/Edge e Firefox no desktop e Safari quando disponível.
Para layout móvel, inclua Safari no iPhone e Chrome no Android; emulação não deve
ser registrada como teste em aparelho real. Meça INP/LCP/CLS no mesmo cenário e
condições antes e depois de qualquer alegação de ganho, sem inventar números.

## Verificações existentes

```sh
npm run typecheck
npm test
npm run build
```

Não foram adicionados jobs, dependências ou thresholds. Esta adoção documental
não afirma que a matriz acima passou: cada alteração de interface deve fornecer
suas próprias evidências e indicar os testes pendentes.
