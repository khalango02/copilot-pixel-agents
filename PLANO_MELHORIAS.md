# Plano de melhorias do Copilot Pixel Agents

Data: 28/10/2026

Versão de referência: 0.7.0

Status: planejamento para implementação posterior.

## Objetivo

Tornar o escritório uma ferramenta confiável de acompanhamento: identificar quem está trabalhando, quem precisa de atenção e quais tarefas falharam, preservando a identidade pixel art.

Este documento registra propostas baseadas na leitura do código, do CI e da imagem documentada. Não representa validação interativa, auditoria completa de segurança ou funcionalidades já entregues. Cada problema deverá ser reproduzido por um teste focado antes da correção.

## Base existente

- Escritório isométrico, câmera navegável e personagens animados.
- Integrações por hooks do Copilot e Claude Code.
- Histórico limitado por agente e inspetor de entrada, saída, erro e evento.
- Captura de conteúdo opcional, mascaramento best-effort e descarte ao desabilitar.
- Testes de backend e webview, CI e pipeline de release.

A extensão visualiza eventos. Selecionar um personagem não inicia, interrompe nem controla o agente real. As melhorias devem preservar essa distinção e não inventar informações ausentes nos hooks.

## Etapa 1: confiabilidade e diagnóstico

### Roteamento entre janelas

Situação observada: [hooksServer.ts](src/hooksServer.ts) grava a porta em um arquivo global, e [hookScripts.ts](src/hookScripts.ts) consulta esse mesmo arquivo. Instâncias simultâneas podem disputar o destino dos eventos.

- [ ] Reproduzir o cenário com duas janelas e workspaces distintos.
- [ ] Definir identificação de instância e workspace usando somente dados disponíveis nos provedores.
- [ ] Implementar descoberta de destino e limpeza de registros de instâncias encerradas.
- [ ] Definir comportamento explícito quando o destino não puder ser identificado, sem enviar silenciosamente para uma janela arbitrária.

Critério de conclusão: eventos de cada workspace chegam à instância correta; reiniciar ou fechar uma janela não redireciona eventos para outra. Cobrir caminhos com espaços e cenários sem metadados suficientes.

### Diagnóstico de integração

- [ ] Distinguir servidor ativo, configuração de hooks encontrada e último evento recebido.
- [ ] Exibir falhas de configuração, dependências ausentes e indícios de scripts desatualizados.
- [ ] Adicionar teste de conexão com evento identificado como diagnóstico, sem criar um agente fictício permanente.
- [ ] Revisar o comando de exibição de configuração para mostrar caminhos efetivos por sistema operacional.

Critério de conclusão: o usuário consegue diferenciar falta de atividade de falha de instalação sem depender exclusivamente do log. Ausência de eventos não deve ser apresentada como prova de defeito.

### Seleção e foco

Situação observada: [main.ts](webview-ui/src/main.ts) fecha o inspetor ao receber a remoção de qualquer agente e recria a barra de agentes durante atualizações.

- [ ] Fechar o inspetor apenas quando o agente inspecionado for removido.
- [ ] Preservar seleção, foco de teclado, rolagem e aba aberta durante atualizações.
- [ ] Cobrir remoção de outro agente e chegada de eventos durante navegação por teclado.

Critério de conclusão: atividades de outros agentes não interrompem a inspeção nem deslocam o foco indevidamente.

## Etapa 2: clareza e consulta de atividades

- [ ] Oferecer visualizações Escritório e Atividades com seleção compartilhada.
- [ ] Exibir lista compacta com agente, ferramenta, estado e duração.
- [ ] Adicionar busca e filtros por ferramenta, falha e tarefa em andamento, além de ordenação por mais recentes.
- [ ] Permitir fixar uma tarefa para acompanhamento, com comportamento definido quando ela sair da retenção.
- [ ] Permitir copiar conteúdo capturado e abrir arquivos somente após validar o caminho dentro do workspace; não executar comandos ou links arbitrários recebidos pelos hooks.
- [ ] Separar estado real da tarefa de animações como caminhar, sentar ou fazer uma pausa.
- [ ] Representar tokens ausentes como indisponíveis, distinguindo ausência de zero informado.
- [ ] Remover a interpretação de percentual de contexto quando o limite real do modelo for desconhecido.
- [ ] Melhorar tamanho de fonte e usar cores do tema do VS Code nos controles, mantendo a paleta do cenário independente.
- [ ] Implementar fechamento por `Esc`, retorno de foco e opção de movimento reduzido.

Critérios de conclusão:

- Encontrar uma tarefa com falha sem percorrer visualmente todo o escritório.
- Navegar no inspetor e nos filtros usando teclado, inclusive durante atualizações.
- Validar painéis estreitos, temas claro/escuro e alto contraste sem sobreposição ou texto inacessível.
- Não mostrar uma animação como prova do estado real nem classificar uma tarefa como travada apenas pela ausência de eventos.
- Não apresentar consumo zero ou limite de contexto fictício quando o provedor não fornecer esses dados.

## Etapa 3: proteção e testes multiplataforma

### Servidor e limites globais

Situação observada: [hookHttp.ts](src/hookHttp.ts) valida método, tamanho e conteúdo, mas não autentica o remetente. [agentStore.ts](src/agentStore.ts) limita o histórico por agente, não a quantidade global de agentes.

- [ ] Definir credencial local por instalação ou instância e seu ciclo de vida, em conjunto com o roteamento da Etapa 1.
- [ ] Restringir acesso ao arquivo da credencial e impedir sua exposição em logs.
- [ ] Validar origem e destino das requisições conforme o protocolo escolhido, mantendo escuta em loopback.
- [ ] Limitar frequência, número de sessões e orçamento global de memória, com política explícita de descarte e indicação na interface.
- [ ] Testar remetente inválido, excesso de eventos, sessões abandonadas e recuperação após limites.

Critério de conclusão: requisições sem credencial válida não alteram o estado; a memória permanece limitada e descartes são observáveis. Autenticação local não deve ser anunciada como proteção contra um processo comprometido com acesso à mesma credencial.

Os hooks devem continuar permitindo o trabalho do agente real quando a visualização estiver indisponível. Segurança do transporte não pode transformar falha do painel em bloqueio de ferramentas do usuário.

### Compatibilidade e testes

Situação observada: o [CI](.github/workflows/ci.yml) usa Ubuntu. Executar PowerShell nesse runner não equivale a testar o Windows e seu lançador `.cmd`.

- [ ] Adicionar matriz Linux, Windows e macOS, com testes dos scripts nos sistemas correspondentes.
- [ ] Tornar explícito quais testes são obrigatórios por plataforma; não aceitar skip silencioso de um teste obrigatório.
- [ ] Adicionar testes de integração no host real do VS Code para ativação, instalação de hooks e comunicação com a webview.
- [ ] Medir custo de renderização com muitos agentes e eventos antes de definir otimizações.
- [ ] Avaliar pausa ou redução do trabalho visual com a webview oculta, sem perder estado.

Critério de conclusão: plataformas anunciadas têm validação nativa, configuração não relacionada é preservada pelo instalador e os resultados distinguem testes executados de testes pulados.

## Etapa 4: evolução do produto

- [ ] Arquivar sessões recentes, começando por metadados, com limites de quantidade e idade.
- [ ] Avaliar persistência opcional de detalhes somente com consentimento, exclusão e retenção definidos; preservar captura desativada por padrão.
- [ ] Representar relações entre agentes e subagentes quando o provedor fornecer identificadores confiáveis, sem deduzir hierarquia pelo nome.
- [ ] Oferecer apelidos, cores e posições estáveis, além de acompanhamento opcional da câmera.
- [ ] Avaliar temas e móveis adicionais depois das melhorias de confiabilidade e consulta.

Critério de conclusão: sessões recentes são recuperáveis conforme a política escolhida; dados podem ser apagados; ausência de relação entre agentes é mostrada explicitamente; personalização não muda a interpretação dos eventos.

## Ordem e decisões pendentes

Ordem inicial sugerida: Etapa 1, Etapa 2, Etapa 3 e Etapa 4. Os contratos de autenticação e roteamento devem ser desenhados juntos desde a Etapa 1 para evitar retrabalho. A execução pode antecipar itens de segurança se a reprodução indicar maior risco.

Antes de cada implementação, definir o menor escopo verificável, os dados realmente fornecidos pelos hooks e o teste que demonstra o problema. Quantidades de retenção, limites de memória, orçamento de renderização e compatibilidade mínima ainda precisam de medição e decisão; não são compromissos de versão ou prazo.

## Entrega e documentação

- [ ] Reproduzir o problema e adicionar cobertura focada na alteração.
- [ ] Executar typecheck e testes aplicáveis, incluindo as validações de integração e empacotamento exigidas pelo projeto.
- [ ] Atualizar README e CHANGELOG apenas com comportamentos efetivamente entregues.
- [ ] Manter mudanças não publicadas em `Unreleased` e atualizar a versão do pacote apenas ao preparar uma release.

Este commit de planejamento não implementa as etapas, não altera a versão 0.7.0 do pacote e não publica uma nova release.