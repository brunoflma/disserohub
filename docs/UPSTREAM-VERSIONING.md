# Numeração alinhada ao Habblaud

A partir da 1.0.3, o número de uma release do DisseroHub acompanha o número da release oficial **revisada**. Por exemplo, Habblaud 1.0.3 → DisseroHub 1.0.3. Correções próprias usam um quarto número: **1.0.3.1**, **1.0.3.2**, e assim por diante. A publicação e a instalação continuam pelo repositório `brunoflma/disserohub`.

## Referência e base técnica

| Identificação | Onde fica | Significado nesta versão |
| --- | --- | --- |
| Versão pública do DisseroHub | `distributionVersion(package.json)` | 1.0.3.3 |
| Revisão própria | `disserohub.revision` | 3 |
| Base compatível com npm/plugins | `package.json.version` e manifests locais | 1.0.3 |
| Referência oficial revisada | `disserohub.upstreamReferenceVersion` e `UPSTREAM_REFERENCE_VERSION` | Habblaud 1.0.3 foi comparado e classificado |
| Base técnica integrada | `disserohub.upstreamVersion` e `UPSTREAM_BASE_VERSION` | Habblaud 0.11.0, com backports e customizações registrados |

A referência revisada não declara uma mesclagem integral do motor. A base técnica só muda quando uma integração correspondente for concluída e validada. A seção Sobre mostra ambas as informações.

O quarto número identifica somente correções do DisseroHub. Tags, releases, `/api/health` e a interface usam a versão pública. Os manifests npm/plugins preservam três números por compatibilidade com suas ferramentas. A próxima referência oficial, por exemplo 1.0.4, começa com revisão zero e é mais recente que qualquer 1.0.3.x. Nunca reutilizar ou mover uma tag já publicada.

O verificador passa a aceitar quatro números na 1.0.3.1. A migração de instalações antigas para essa primeira revisão requer o procedimento administrado/manual; o verificador antigo não identifica a tag de quatro números. A partir dela, as revisões seguintes são reconhecidas normalmente.

## Procedimento por release oficial

1. Consultar a release estável no repositório canônico `marmottajr/habblaud` e fixar seu commit.
2. Comparar com a referência anterior. Classificar cada mudança como incorporada, já atendida, não aplicável ou pendente. Avaliar conflitos com o código local antes de aplicar alterações.
3. Manter os recursos deliberadamente excluídos separados; a numeração não autoriza habilitar World, serviços externos ou integração automática do plugin jurídico.
4. Alinhar `package.json.version` e os dois campos da referência revisada; zerar `disserohub.revision` ao passar para uma referência oficial nova. Para uma correção própria na mesma referência, incrementar somente a revisão. Preservar a base efetiva quando houver apenas revisão ou backport seletivo.
5. Executar `node scripts/version-sync.mjs`; registrar a decisão no CHANGELOG; validar testes, tipos e build. Publicar somente após CI aprovada no commit exato, com a main limpa e igual à origin/main.

O publicador recusa versões que não correspondam à referência registrada ou metadados que contradigam a base técnica. Tags e releases publicadas são preservadas, inclusive a antiga v0.11.3. Commits locais adicionais não alteram automaticamente o número, nem permitem reutilizar uma tag existente. Não antecipar o número de uma versão oficial ainda não revisada.

## Revisão da referência 1.0.3

- Release: https://github.com/marmottajr/habblaud/releases/tag/v1.0.3
- Commit: `faa1a012b5fbf632c66dc6801c5383e53a542406`.
- Comparação com 1.0.2: a mudança funcional está em `client/src/ui/index.ts` e `client/src/ui/world/scene-switch.ts`; ao selecionar um agente com a cidade aberta, a cidade fecha antes de medir os painéis e focar o pedido.
- Classificação: **não aplicável ao DisseroHub atual**, que não inclui a cena World. Não foi incorporado código da cidade.
- Resultado: mantidas as funcionalidades da distribuição 0.11.3 e a sua ressalva de validação do clipboard legado; alteradas identificação, metadados, documentação e verificações de publicação.
