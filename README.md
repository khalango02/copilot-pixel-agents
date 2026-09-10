# Copilot Pixel Agents

**Versão atual: 0.6.0** — escritório isométrico, agentes sentados e inspetor de tarefas.

> Ao atualizar, reinstale os hooks e habilite **Capture Task Details** nas configurações para reter os conteúdos das próximas tarefas. A captura é opcional e vem desativada por padrão.

Visualize seus agentes de IA como personagens pixel art animados em um escritório com profundidade, móveis volumétricos e atividades em tempo real.

Compatível com **GitHub Copilot Agent Mode** e **Claude Code**.

[Marketplace](https://marketplace.visualstudio.com/items?itemName=cl-oliveira.copilot-pixel-agents) · [Release v0.6.0](https://github.com/khalango02/copilot-pixel-agents/tree/v0.6.0) · [Histórico de versões](CHANGELOG.md)

![Demonstração do escritório pixel art em uma versão anterior](.github/preview.gif)

> O GIF acima mostra o visual anterior; desde a versão 0.5.0, o escritório usa a perspectiva isométrica descrita abaixo.

## Novidades da versão 0.5.0

- **Cenário 2,5D:** piso em losangos, duas paredes, janelas, plantas, estante, mesas e áreas de lazer com faces sombreadas.
- **Profundidade:** móveis, personagens e mascote são desenhados em ordem de profundidade; os sprites continuam em pé, preservando o pixel art.
- **Câmera navegável:** zoom de 50% a 300%, deslocamento por arraste e botão para reenquadrar a sala.
- **Layout independente do painel:** duas estações por fileira; o escritório cresce com os agentes, sem reorganizar suas atividades ao redimensionar a janela.
- **Interface renovada:** cabeçalho, barra de agentes, seleção adaptada à projeção e estado vazio compacto, sem esconder todo o escritório.
- **Qualidade e distribuição:** nove testes de regressão da webview, verificação de tipos e pacote VSIX sem fontes de desenvolvimento ou sourcemaps.

## Novidades da versão 0.6.0 — poses sentadas e inspetor de tarefas

- **Sentar e levantar:** transições suaves de aproximadamente 300 ms de simulação nas cadeiras do computador, no assento de jogos e no sofá da TV. Cabeça e tronco mantêm a proporção pixel art; pernas dobram e os braços animam a digitação ou o controle.
- **Interação com os móveis:** o personagem só senta quando chega ao assento correto e olha para a tela. Bases e encostos têm camadas separadas; seleção e balões acompanham a postura.
- **Retorno natural ao trabalho:** ao receber uma ferramenta durante o lazer, o agente levanta, caminha até a mesa e senta. A animação não atrasa a execução real da ferramenta. O café continua sendo uma atividade em pé.
- **Histórico inspecionável:** cada tarefa abre abas **Input**, **Output**, **Error** e **Event**, com dados recebidos pelos hooks, horários e resultado. A tarefa aberta acompanha a conclusão sem perder a aba selecionada.
- **Correlação e restauração:** entradas têm identificador próprio por invocação, estados **Running / Completed / Failed / Interrupted** e restauração quando a webview é recriada, enquanto o host da extensão continuar ativo.
- **Captura opcional:** conteúdos são retidos somente com `copilotPixelAgents.captureTaskDetails` habilitado. Há mascaramento best-effort, limites de tamanho e indicação explícita de dados ausentes, truncados ou sem correlação.
- **Hooks atualizados:** transporte JSON serializado em Unix/Windows, registro de falhas e encerramento, validação HTTP e remoção do registro bruto de stdin/ambiente em disco.

**Após atualizar para este código, execute Install Copilot Hooks novamente.** O instalador não atualiza silenciosamente os scripts já instalados. Sem reinstalação, os hooks antigos podem continuar enviando apenas metadados.

---

## Como funciona

```
Agente (Copilot / Claude Code)
        │ hooks PreToolUse / PostToolUse / Stop
        ▼
 Script de hook ──POST──▶ Servidor local (127.0.0.1)
                                │
                                ▼
                       Extensão VS Code
                                │ postMessage
                                ▼
                       Canvas isométrico 2,5D
```

Cada sessão identificada pelos hooks vira um personagem. A primeira chamada de ferramenta também pode criar o personagem, mesmo sem um evento de início de sessão. As animações distinguem leitura, escrita, execução e pesquisa pelo nome da ferramenta.

O servidor escuta somente em `127.0.0.1`, inicialmente na porta `7823`. Se ela estiver ocupada, tenta as portas seguintes e registra a porta efetiva para os hooks. A extensão visualiza eventos: selecionar um personagem não inicia, interrompe nem controla o agente de IA.

---

## Instalação rápida (via Marketplace)

### Requisitos

- VS Code desktop: o manifesto aceita **1.70.0 ou superior**, mas a integração Copilot exige uma versão com suporte aos hooks utilizados. Prefira uma versão atualizada.
- GitHub Copilot com modo agente habilitado ou Claude Code instalado e configurado separadamente.
- **macOS/Linux:** `sh` e `python3` no PATH. O novo script usa a biblioteca padrão do Python para JSON e HTTP; os scripts da versão publicada 0.5.0 também dependem de `curl`.
- **Windows:** PowerShell disponível como `powershell`; o novo script usa `ConvertFrom-Json`/`ConvertTo-Json` e HTTP do .NET, com timeout e sem redirecionamentos/proxies.

Não é necessário clonar o repositório nem instalar Node.js para usar a extensão pelo Marketplace.

1. Instale a extensão pelo [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=cl-oliveira.copilot-pixel-agents)
2. Na primeira ativação, se os hooks ainda não estiverem configurados, aparece o prompt:
   **"🎮 Copilot Pixel Agents is ready! Install hooks…"** → clique **"Install Hooks (automatic)"**
3. Pronto — hooks configurados para Copilot e Claude Code automaticamente.

Ou abra a paleta de comandos — **⌘⇧P no macOS**, **Ctrl+Shift+P no Windows/Linux** — e execute **Copilot Pixel Agents: Install Copilot Hooks**. Quando a sala estiver vazia, o botão **Install / Reinstall Hooks** oferece a mesma ação.

O instalador grava as configurações imediatamente e pode ser executado novamente para atualizar os scripts sem duplicar os registros já reconhecidos. Se uma sessão aberta não reconhecer a mudança, inicie uma nova sessão do agente. Confira o aviso de instalação: falhas de configuração são informadas por integração.

### O que é instalado automaticamente

Os caminhos abaixo são relativos à pasta pessoal do usuário (`~` no macOS/Linux; `%USERPROFILE%` no Windows).

| Caminho relativo à pasta pessoal | Propósito |
|---|---|
| .copilot-pixel-agents/hook.sh | Script gerado para macOS/Linux |
| .copilot-pixel-agents/hook.cmd e .copilot-pixel-agents/hook.ps1 | Script de entrada e processamento JSON no Windows |
| .copilot/hooks/hooks.json | Definições de hooks do Copilot no diretório padrão usado pelo instalador |
| .copilot-pixel-agents/copilot-hooks/hooks.json | Cópia em diretório personalizado, registrado em `chat.hookFilesLocations` quando disponível |
| .claude/settings.json | Configurações do Claude Code, com os hooks mesclados |
| .copilot-pixel-agents/port | Porta efetiva, gravada quando o servidor inicia e lida pelos scripts |
| .copilot-pixel-agents/hook-debug.log | Arquivo legado de diagnóstico: os novos scripts não escrevem nele; arquivos antigos não são apagados automaticamente |

O instalador atual usa um único arquivo de definições por diretório e remove os antigos arquivos separados por evento. A configuração `chat.hookFilesLocations` é tratada como objeto de caminhos e valores booleanos; versões que não oferecem essa configuração não impedem a gravação no diretório padrão.

**Importante:** o caminho legado .vscode/agent-hooks.json não é o destino atual do instalador. Para instalar ou atualizar a integração, use o comando da extensão; os scripts efetivamente instalados são gerados por [src/hooksInstaller.ts](src/hooksInstaller.ts), não copiados diretamente dos exemplos em [hooks/hook.sh](hooks/hook.sh) e [hooks/hook.cmd](hooks/hook.cmd).

---

## Usar o agente

Após instalar os hooks:

1. Abra **Copilot Pixel Agents → Pixel Office** na barra lateral ou execute **Copilot Pixel Agents: Show Pixel Office** na paleta de comandos
2. Inicie uma sessão de agente normalmente (Copilot em Agent Mode ou `claude` no terminal)
3. Cada sessão aparece como um personagem no escritório virtual

### Escritório isométrico

O cenário usa uma perspectiva **2,5D** com piso em losangos, paredes e móveis
volumétricos, sombras e sobreposição por profundidade, mantendo os personagens pixel art.

- **Arraste o cenário** para navegar pelo escritório.
- Use os **botões + / −** para aproximar ou afastar a câmera entre **50% e 300%**. Esses controles não são atalhos de teclado.
- O botão **↺** retorna a **100%** e zera o deslocamento. Esse percentual é relativo ao enquadramento automático para o tamanho do painel.
- Clique em um personagem ou no seu nome na barra inferior para ver as atividades.
- O escritório cresce conforme novos agentes chegam; redimensionar o painel não interrompe suas atividades.

### Agentes, inspetor e histórico

- Os personagens alternam entre **seis paletas** e mostram nome, indicador de atividade e balões com a ferramenta ou atividade atual.
- Clique no personagem ou no nome na barra inferior para abrir o inspetor lateral. Feche com **✕** ou clicando numa área livre do cenário.
- O inspetor mostra estado, tempo desde a criação do personagem na webview, tokens de entrada/saída, ferramentas em andamento e histórico com duração e tempo relativo.
- O histórico mantém **até 50 entradas por personagem**; o campo **Tools** conta as entradas retidas, não um total ilimitado da sessão.
- Seleção e clique usam a mesma projeção da câmera; arrastar a sala não abre o inspetor por acidente.

### Inspecionar o que passou por uma tarefa

1. Instale a versão **0.6.0 ou superior** e execute **Install Copilot Hooks** para atualizar o transporte dos eventos.
2. Nas configurações, habilite **Copilot Pixel Agents: Capture Task Details** (`copilotPixelAgents.captureTaskDetails`). O link **Enable in Settings** no histórico abre essa configuração, sem ativá-la automaticamente.
3. Execute uma **nova tarefa** com o agente. Abra o personagem e clique na linha da tarefa em **History**.
4. Navegue pelas abas:

| Aba | Conteúdo |
|---|---|
| **Input** | Argumentos recebidos do provedor: por exemplo caminho, comando ou conteúdo de edição |
| **Output** | Resposta/resultado enviado pelo hook de conclusão, quando presente |
| **Error** | Erro fornecido pelo hook; a ausência de um payload de erro não comprova sucesso |
| **Event** | Metadados normalizados: IDs da invocação/ferramenta, horários, estado e origem |

Use **← History** para voltar à lista e **Close ×** para fechar. As linhas são botões acessíveis por teclado; nas abas, use as setas esquerda/direita ou Home/End. JSON é formatado quando possível; texto e código são exibidos literalmente, **sem execução de HTML ou Markdown**.

O detalhe continua aberto quando chegam outros eventos. A saída aparece após a conclusão, se o provedor a enviar. Falhas e interrupções são diferenciadas; `Stop` encerra as tarefas pendentes como **Interrupted**. Eventos sem ID confiável ou sem início correspondente recebem **Unmatched**, sem associar arbitrariamente ferramentas simultâneas pelo nome. A duração de eventos sem início não representa o tempo real de execução.

**Não é o depurador interno do chat do VS Code.** A extensão não lê transcrições, prompts do sistema, raciocínio interno do modelo nem arquivos de depuração do chat. A visualização inclui somente os campos permitidos que chegam pelos hooks; alguns provedores não fornecem argumentos ou resultados. Eventos antigos não podem ser reconstruídos. As abas informam quando a captura está desligada ou um dado não foi recebido, em vez de inventar conteúdo.

#### Retenção e proteção dos conteúdos

- Captura **desativada por padrão**. A configuração controla a retenção na extensão; os scripts atualizados encaminham os campos de ferramenta permitidos ao servidor de loopback, que descarta os conteúdos quando a captura está desligada.
- Até **50 entradas por agente**, incluindo tarefas pendentes. Entradas mais antigas são descartadas; pendências descartadas são marcadas como interrompidas antes da remoção. A invocação é identificada separadamente do `tool_id`, permitindo sua reutilização após a conclusão.
- Cada campo tem limite final de **16.000 caracteres**, profundidade de **8 níveis** e orçamento de **2.000 nós**. Conteúdos limitados são sinalizados como truncados; os scripts também podem omitir detalhes acima do limite de transporte de **60.000 bytes por campo**.
- Requisições HTTP acima de **256 KiB** são rejeitadas com **413**; JSON ou metadados inválidos recebem **400**. Os scripts preservam metadados válidos ao omitir campos excessivos e retornam a decisão `allow` mesmo se o envio falhar.
- Chaves sensíveis e padrões comuns de credenciais são mascarados; campos de ambiente, prompts e transcrições são excluídos da retenção. O filtro é **best-effort**, não uma garantia de remoção de todo segredo. Argumentos e resultados podem conter código-fonte ou dados privados.
- Os dados não são persistidos em disco pelo novo fluxo. Desativar a configuração **apaga os conteúdos retidos**, inclusive de tarefas em andamento e da visualização aberta; reativá-la não os recupera. Registros locais legados continuam sob responsabilidade do usuário.

### Pausas e mascote

- Agentes ociosos podem passear, tomar café, jogar ou assistir à TV. As pausas são animações da interface, não ações executadas pelo agente real.
- A decisão de fazer uma pausa usa um temporizador aleatório baseado em 10 segundos, com 45% de chance de escolher um local livre. Cada pausa dura entre **15 e 35 segundos**.
- Cada local de lazer recebe um agente por vez. Novos destinos de passeio são comparados aos demais personagens para reduzir sobreposição, com separação mínima de 20 unidades do mundo; isso não equivale a navegação completa com colisões.
- Ao começar uma nova ferramenta, o personagem levanta caso esteja sentado, caminha até sua mesa e volta a sentar; a ferramenta real pode terminar antes dessa animação.
- Um gato animado alterna entre sentar e caminhar, evitando as áreas de móveis de lazer.

### Tokens e persistência

A interface aceita eventos `token_usage` com contagens de entrada e saída. Quando esses dados chegam, o inspetor exibe os valores e uma barra abaixo do nome representa a soma, limitada visualmente a **200.000 tokens**, ficando vermelha acima de 80% dessa referência.

**Não há coleta automática de contagens de tokens nas chamadas comuns de ferramenta.** Os novos scripts podem encaminhar um evento `token_usage` com contagens se o provedor já o fornecer, mas o instalador não registra um evento de coleta de tokens. Sem esses dados, os valores permanecem zerados. A referência de 200.000 é fixa, não configurável, e não representa automaticamente o limite real do modelo nem uma estimativa de custo.

O estado é mantido em memória no host da extensão, não em um histórico persistente. Ocultar o painel preserva seu contexto; recriar a webview restaura as últimas 50 tarefas, ferramentas ativas, contagens e início da sessão enquanto o host continuar ativo. Encerrar a sessão remove o agente e seu histórico; recarregar o VS Code encerra o armazenamento em memória.

---

## Eventos suportados

### Eventos registrados automaticamente

- **Copilot (novo instalador):** `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart` e `UserPromptSubmit`, com `type: command` em cada entrada.
- **Claude Code:** os eventos acima mais `PostToolUseFailure` e `SessionEnd`. Esses dois eventos não constam entre os hooks suportados pela [documentação atual do VS Code](https://code.visualstudio.com/docs/copilot/customization/hooks), portanto não são registrados na configuração específica do Copilot.
- A reinstalação atualiza apenas os comandos pertencentes à extensão e preserva hooks não relacionados e outras configurações válidas. Configurações inválidas são reportadas, não substituídas silenciosamente.

Os scripts gerados interpretam campos em camelCase e snake_case, como `sessionId`/`session_id`, `toolName`/`tool_name` e `hookEventName`/`hook_event_name`. Também normalizam nomes de eventos e retornam `{"permissionDecision":"allow"}` no stdout para o protocolo de hooks do Copilot.

### Eventos aceitos pelo servidor

Nem todo evento aceito é registrado ou enviado pela instalação padrão.

| Evento interno | Efeito |
|---|---|
| `session_start` | Personagem aparece no escritório |
| `pre_tool_use` (read/view) | 📖 Lendo |
| `pre_tool_use` (write/edit) | ⌨ Digitando |
| `pre_tool_use` (bash/exec) | ⚙ Executando |
| `pre_tool_use` (search/grep) | 🔍 Pesquisando |
| `post_tool_use` | Finaliza uma ferramenta; fica ocioso quando não há outras em andamento |
| `waiting` | ⏳ Aguardando input |
| `stop` | Marca a sessão como ociosa; não remove o personagem |
| `session_end` | Personagem sai do escritório |
| `token_usage` | Atualiza contagens de tokens de um agente já existente |

O normalizador também reconhece `SubagentStart` e `SubagentStop`, além de variantes como `preToolUse`, `agentStop` e `userPromptSubmitted`. Hooks de subagentes não são registrados automaticamente; **normalizar um evento não instala seu hook**. O suporte e os dados enviados dependem da versão do provedor.

Campos de conteúdo reconhecidos: `tool_input`/`toolInput`/`toolArgs`, `tool_response`/`toolResponse`/`tool_result`/`toolResult` e `error`/`tool_error`/`toolError`. O evento de falha, `success: false` e indicadores de erro da resposta são preservados mesmo com a captura desligada.

Integrações próprias podem enviar JSON por **POST** à porta local ativa, usando `event` e `session_id`, mais os campos específicos definidos em [src/types.ts](src/types.ts). Use o mesmo `tool_id` para correlacionar início e fim de uma ferramenta. O servidor não oferece um endpoint GET de saúde; métodos diferentes de POST recebem HTTP 405.

---

## Comandos

Disponíveis na paleta de comandos, sob a categoria **Copilot Pixel Agents**:

| Comando | Função |
|---|---|
| **Show Pixel Office** | Abre/foca a visão do escritório |
| **Install Copilot Hooks** | Instala ou atualiza os scripts e configura Copilot e Claude Code |
| **Show Hooks Configuration** | Abre um documento informativo com caminhos de configuração |

> Na versão 0.6.0, **Show Hooks Configuration** ainda lista o caminho legado do Copilot e o script Unix, inclusive no Windows. Para os destinos efetivos, consulte a tabela de instalação deste README.

## Configurações

Abra as configurações (**⌘, no macOS**, **Ctrl+, no Windows/Linux**) e pesquise `copilotPixelAgents`:

| Chave | Padrão | Descrição |
|---|---|---|
| `copilotPixelAgents.port` | `7823` | Porta do servidor de hooks |
| `copilotPixelAgents.autoShowPanel` | `false` | Abrir painel automaticamente no startup |
| `copilotPixelAgents.captureTaskDetails` | `false` | Reter entradas, saídas e erros de ferramentas em memória; desligar elimina os conteúdos capturados |

Porta e abertura automática são lidas na ativação da extensão; recarregue a janela após alterá-las. **Capture Task Details é aplicada imediatamente**, sem recarregar. A barra superior informa a porta realmente utilizada. Os scripts acompanham essa porta pelo arquivo gravado pelo servidor, sem precisar reinstalar os hooks apenas por uma mudança de porta.

## Solução de problemas

### Nenhum agente aparece

1. Abra **View → Output** e selecione **Copilot Pixel Agents**. Confira a mensagem de início do servidor e os eventos recebidos.
2. Execute **Install Copilot Hooks** novamente e confira se houve avisos para alguma integração.
3. Verifique os requisitos do seu sistema: especialmente `python3` no PATH do processo que executa os hooks no macOS/Linux (`curl` também é necessário com scripts antigos), ou PowerShell no Windows.
4. Inicie uma nova sessão e peça ao agente para usar uma ferramenta; apenas abrir o chat não garante um evento.
5. Confira a porta na barra superior e os registros de metadados no canal de saída. Os scripts atualizados não geram log bruto em disco; registros antigos não comprovam que os novos eventos estão chegando.

### Porta ocupada ou várias janelas

O servidor tenta a próxima porta disponível automaticamente. O arquivo de porta é compartilhado entre as janelas do mesmo usuário; a última instância que o gravar passa a receber os eventos enviados pelos scripts. Na versão atual, não há roteamento independente por workspace.

### Personagem permanece após o agente parar

`Stop` significa ociosidade, não remoção. A remoção depende de `session_end`; o novo instalador registra `SessionEnd` para Claude Code. No Copilot, esse evento não é documentado, então o personagem pode permanecer ocioso até recarregar a extensão.

### Diagnóstico e privacidade

Os novos scripts não registram stdin, ambiente ou payloads em disco; o canal de saída registra apenas o tipo do evento e o tamanho, ou o status da rejeição. Logs legados podem conter dados privados e não são apagados automaticamente. **Revise qualquer conteúdo antes de compartilhá-lo, mesmo após o mascaramento do inspetor.** O servidor HTTP não tem autenticação e deve permanecer restrito ao loopback; não exponha sua porta na rede.

---

## Desenvolvimento local

```bash
git clone https://github.com/khalango02/copilot-pixel-agents
cd copilot-pixel-agents
npm install
cd webview-ui && npm install && cd ..
```

Prefira **Node.js 22 LTS ou superior compatível com Vite** e npm para desenvolvimento; Node.js 21 não faz parte das versões suportadas por Vite 6. Abra a pasta clonada no VS Code e selecione **Run Extension**; **F5** executa a tarefa de build e abre uma janela de desenvolvimento com a extensão carregada.

### Build e validação

Execute os comandos a partir da raiz do repositório:

| Comando | Finalidade |
|---|---|
| `npm test` | Executa os testes de backend e webview |
| `npm run typecheck` | Verifica os tipos do backend e da webview |
| `npm run vscode:prepublish` | Build completo da webview e da extensão |
| `npm run build:webview` | Compila a interface com Vite |
| `npm run build` | Compila somente o código da extensão com esbuild |
| `npm run dev` | Observa alterações somente no código da extensão |
| `npm --prefix webview-ui test` | Executa os testes de renderização, posturas e inspetor com `node:test` e jsdom |
| `npm --prefix webview-ui run typecheck` | Verifica os tipos da webview |
| `npx tsc --noEmit` | Verifica os tipos da extensão |

Os testes cobrem projeção, enquadramento, zoom, arraste, seleção por profundidade, transições de postura, ocupação dos assentos, crescimento da sala, resize, renderização sem sprites, navegação do inspetor, conteúdo hostil, correlação de eventos, limite HTTP, mascaramento e limpeza ao desativar a captura. Eles empacotam TypeScript em memória usando o esbuild da raiz; instale as dependências tanto da raiz quanto da webview.

Os testes de execução real dos scripts são opcionais: informe o caminho do Python configurado em `PIXEL_TEST_PYTHON` ou do PowerShell em `PIXEL_TEST_PWSH` antes de executar `npm test`. Sem esses runtimes, somente esses casos são ignorados. Eles usam um HOME temporário e um servidor de teste, sem alterar seus hooks instalados.

A webview depende de `acquireVsCodeApi` e usa uma entrada TypeScript, sem página HTML independente de demonstração. Para validar no navegador fora do VS Code, é necessário um ambiente de prévia que simule essa API e as mensagens dos agentes.

### Empacotamento e publicação

- `npm run package` executa o build completo e gera um VSIX com a versão de [package.json](package.json).
- O pacote inclui a extensão compilada, a webview, assets, ícones, hooks, licença e documentação. Fontes de desenvolvimento, testes, dependências e sourcemaps são excluídos pelas regras de [.vscodeignore](.vscodeignore).
- Para instalar o artefato localmente, use **Extensions: Install from VSIX…** na paleta de comandos.
- Para publicar uma nova versão, sincronize a versão em [package.json](package.json) e [package-lock.json](package-lock.json), atualize [CHANGELOG.md](CHANGELOG.md), execute as validações e use `npm run publish` com acesso ao publisher **cl-oliveira**.
- Informe credenciais somente no prompt seguro do terminal ou pelo mecanismo de segredos do ambiente. Não coloque tokens no código, em commits ou na documentação.

Atualizar este README no GitHub não altera a descrição de um VSIX já publicado; a documentação do Marketplace acompanha o pacote enviado.

---

## Estrutura do projeto

```
copilot-pixel-agents/
├── src/                    # Extensão VS Code (TypeScript)
│   ├── extension.ts        # Entry point + prompt de instalação automática
│   ├── hooksServer.ts      # HTTP server recebe eventos dos hooks
│   ├── agentStore.ts       # Estado dos agentes em memória
│   ├── viewProvider.ts     # WebviewViewProvider
│   ├── hooksInstaller.ts   # Gera scripts Unix/Windows e configura integrações
│   ├── hookScripts.ts      # Transporte JSON com campos permitidos
│   ├── hooksConfig.ts      # Registro e mesclagem dos hooks
│   ├── hookHttp.ts         # Recepção HTTP limitada e validada
│   ├── hookPayload.ts      # Normalização de eventos
│   ├── taskDetails.ts      # Mascaramento e limites dos conteúdos
│   └── types.ts
├── webview-ui/src/         # Canvas pixel art (TypeScript + Vite)
│   ├── engine.ts           # Simulação, layout e interação com a câmera
│   ├── isometric.ts        # Projeção 2,5D, cenário, profundidade e seleção
│   ├── seating.ts          # Poses e transições de sentar/levantar
│   ├── history.ts          # Sincronização do histórico por invocação
│   ├── taskInspector.ts    # Detalhe da tarefa e abas de payload
│   ├── sprites.ts          # Carregamento de sprites
│   ├── main.ts             # Bootstrap e handler de mensagens
│   └── style.css
├── hooks/
│   ├── hook.sh             # Script de referência Unix (não é o gerador atual)
│   └── hook.cmd            # Script de referência Windows
└── media/icon.png
```

Testes: [backend](tests/backend.test.mjs), [renderização](webview-ui/tests/isometric.test.mjs), [posturas](webview-ui/tests/seating.test.mjs) e [inspetor](webview-ui/tests/taskInspector.test.mjs). A configuração de depuração está em [.vscode/launch.json](.vscode/launch.json), e a tarefa de build em [.vscode/tasks.json](.vscode/tasks.json).

---

## Licença

MIT — sprites pixel art baseados no [Pixel Agents](https://github.com/pablodelucca/pixel-agents) por [@pablodelucca](https://github.com/pablodelucca).
