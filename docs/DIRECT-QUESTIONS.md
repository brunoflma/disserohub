# Responder imediatamente pelo Dissero

O MCP local `dissero-perguntas` oferece `ask_user` ao Codex e ao Claude Code. A chamada fica aguardando a resposta no Dissero. Ao clicar em **Responder**, a resposta volta nessa mesma chamada, sem `codex queue`, mensagem artificial de chat ou espera pelo fim da tarefa.

## Instalação

Com a instalação nativa do Dissero funcionando:

```sh
npm run questions:install -- --provider both --port 4748
```

Use `--provider codex` ou `--provider claude` para instalar em apenas um cliente. `--dry-run` mostra os comandos antes de gravar. Os executáveis devem estar no PATH; caminhos explícitos podem ser informados em `DISSERO_CODEX_BIN` e `DISSERO_CLAUDE_BIN`.

O instalador acrescenta somente `dissero-perguntas` pelos comandos oficiais dos clientes. No Codex, ajusta o prazo dessa ferramenta para 660 segundos pelo editor de configuração do app-server, sem abrir threads. Não reinicia clientes ou sessões em andamento. Recarregue os MCPs no cliente ou abra uma nova sessão para disponibilizar a ferramenta. O plugin jurídico hospedado tem ciclo separado.

## Uso pelo agente

Quando a ferramenta estiver disponível, use `ask_user` para perguntas que devam ser respondidas pelo escritório e aguarde seu resultado. Não mande a resposta por uma ferramenta de mensagens.

No Codex, `session_id` deve ser o `CODEX_THREAD_ID` da própria sessão, obtido pela ferramenta de terminal lendo somente essa variável. No Claude Code, o MCP tenta identificar o processo pai da sessão; se isso não for possível, exige o ID exato. Não escolha outra sessão com base no nome do projeto. São atendidas sessões principais presentes no Dissero.

Exemplo de argumentos:

```json
{
  "session_id": "ID-DA-PROPRIA-SESSAO",
  "questions": [
    {"question": "Qual formato deseja?", "options": [{"label": "PDF"}, {"label": "Texto"}]},
    {"question": "Alguma observação?"}
  ],
  "timeout_seconds": 300
}
```

O resultado `status=answered` contém as respostas por índice. Cancelamento, expiração, sessão encerrada ou canal indisponível voltam explicitamente sem resposta e nunca representam autorização. Cancelar uma chamada no cliente retira apenas a pergunta correspondente.

## Compatibilidade

Este canal atende perguntas feitas com a nova ferramenta. Cartões nativos de `request_user_input_async` que já estiverem abertos continuam pertencendo ao cliente de origem; o MCP não declara tê-los respondido. As perguntas do Claude pelo hook `habblaud-permissoes` preservam seu funcionamento atual.

O MCP fala somente com `127.0.0.1` na porta configurada. O registro exige uma página local aberta e uma sessão conhecida; as rotas mantêm as verificações de bind, Host, JSON e Origin. A decisão só vale para o pedido original e é liberada ao trocar ou encerrar a sessão.

O transporte segue a [especificação stdio MCP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#stdio). A configuração do Codex usa o [app-server oficial](https://developers.openai.com/codex/app-server/).
