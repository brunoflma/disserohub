# DisseroHub — instruções para agentes

Leia o README e a documentação do componente antes de alterar o aplicativo.
Este repositório contém o ambiente visual local; não é a origem do site público,
do gateway hospedado ou do plugin distribuído. Preserve as licenças e os nomes
internos HABBLAUD_* necessários à compatibilidade.

## Orientação web consultiva

Para mudanças em páginas, consulte [Modern Web Guidance](docs/modern-web-guidance.md)
e os guias oficiais pertinentes. A meta inicial é **Baseline Widely Available**;
recursos fora dela exigem detecção de suporte e alternativa funcional. Uma
recomendação de guia não autoriza redesenho, mudança de contrato ou publicação.
Não instale ferramentas globais, não acrescente dependências de produção e não
transforme o scanner em requisito da CI por esta orientação. Preserve trabalho
local e execute as verificações existentes antes de propor uma mudança.

Limite a revisão web a `client/` e aos contratos de interface afetados. Não altere
PTY, atualizador, autenticação remota, integração de agentes ou dados pessoais
para cumprir uma recomendação visual. Use demonstração ou dados sintéticos;
não abra pastas, terminais ou sessões reais durante um teste sem autorização.
