# DisseroHub

Ambiente visual de trabalho do **Dissero**, baseado no [Habblaud](https://github.com/marmottajr/habblaud) e adaptado para o escritório jurídico. Mostra a atividade de agentes locais em um escritório virtual, com painéis, projetos e áreas comuns.

Este repositório público contém o motor local, as customizações e as melhorias da interface. O plugin do Dissero hospedado no Cloudflare tem implementação e distribuição independentes. Credenciais, documentos, sessões, nomes de pessoas, certificados e dados de uso de uma instalação não pertencem a este repositório.

## Instalação

Requer Node.js 22.12 ou superior. Selecione uma versão na página de [releases do DisseroHub](https://github.com/brunoflma/disserohub/releases).

```powershell
git clone https://github.com/brunoflma/disserohub.git
cd disserohub
git checkout --detach v0.11.1
npm ci
npm run build
npm start
```

O servidor local escuta em `127.0.0.1:4747` por padrão. A configuração de HTTPS e do nome `dissero.localhost` é opcional e depende da instalação. Claude Code, Codex e seus acessos são configurados separadamente; consulte [a documentação do servidor](server/README.md) e os comandos de instalação em `package.json`.

Os identificadores internos `habblaud`, as variáveis `HABBLAUD_*` e o diretório de dados `~/.habblaud` são mantidos por compatibilidade com instalações existentes.

## Atualizações

**Verificar agora** apenas consulta versões: não baixa nem instala código. As consultas e os links de atualização usam exclusivamente `brunoflma/disserohub`. Uma versão publicada pelo Habblaud não é uma atualização do Dissero.

A atualização é administrada. Pare o serviço, faça backup do diretório de dados e confira `git status --porcelain` na instalação. Se houver modificações, preserve e integre essas alterações em um candidato separado antes de continuar. Em uma instalação sem alterações, selecione a tag aprovada nas releases do DisseroHub, execute `npm ci` e `npm run build` e então reinicie o serviço. Preserve a instalação anterior até validar a nova versão.

Não instale o pacote oficial do Habblaud sobre uma instalação do Dissero. O código público permite contribuições, mas a distribuição do Dissero utiliza apenas releases deste fork.

## Desenvolvimento e publicação

A base inicial é o Habblaud **v0.11.0**, sob licença MIT. As alterações estão descritas em [CUSTOMIZATIONS.md](CUSTOMIZATIONS.md). O histórico anterior e seus créditos são preservados.

Configure a origem técnica separadamente:

```powershell
git remote add upstream https://github.com/marmottajr/habblaud.git
git fetch upstream --tags
```

Novidades do Habblaud devem ser conciliadas em uma branch de integração, mantendo as customizações. A versão do Dissero é independente da versão do motor; atualize a base registrada em `package.json` e `shared/distribution.ts` quando integrar uma nova versão do motor.

```powershell
npm run typecheck
npm test
npm run build
```

A CI executa essas verificações no Linux. Alguns testes originais dependem de permissões e caminhos Unix; execute a suíte completa no Linux ou WSL ao trabalhar no Windows.

Após aprovação, aumente a versão, escreva as notas no `CHANGELOG.md` e publique a partir da `main` limpa e sincronizada:

```powershell
npm run release -- --dry-run
npm run release
```

O publicador exige `origin` e `package.json` apontando para este fork e CI bem-sucedida no commit exato. Todas as chamadas de publicação ao GitHub selecionam explicitamente o DisseroHub, inclusive quando o GitHub CLI usa o upstream como padrão de um fork.

## Licença

[MIT](LICENSE). Os avisos de licença e os créditos do Habblaud original são preservados.
