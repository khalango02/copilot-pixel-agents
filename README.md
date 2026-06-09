# Copilot Pixel Agents

Visualize seus agentes de IA como personagens pixel art animados em um escritório virtual.

Compatível com **GitHub Copilot Agent Mode** e **Claude Code**.

![Escritório com personagens pixel art animados](.github/preview.png)

---

## Como funciona

```
Agente (Copilot / Claude Code)
        │ hooks PreToolUse / PostToolUse / Stop
        ▼
   hook.sh  ──POST──▶  Servidor local (porta 7823)
                                │
                                ▼
                       Extensão VS Code
                                │ postMessage
                                ▼
                       Canvas pixel art
```

Cada sessão de agente vira um personagem. Quando o agente usa uma ferramenta, o personagem anima: digitando, lendo, executando, pesquisando. A barra de tokens mostra o uso de contexto em tempo real.

---

## Instalação

### Pré-requisitos

- [VS Code](https://code.visualstudio.com/) ≥ 1.95
- [Node.js](https://nodejs.org/) ≥ 20
- `curl` disponível no PATH
- GitHub Copilot com Agent Mode **ou** Claude Code instalado

### 1. Clonar e instalar dependências

```bash
git clone https://github.com/khalango02/copilot-pixel-agents
cd copilot-pixel-agents

npm install
cd webview-ui && npm install && cd ..
```

### 2. Build

```bash
# Webview (React/canvas)
cd webview-ui && npm run build && cd ..

# Extensão
node esbuild.js
```

---

## Testar localmente (modo desenvolvimento)

### 1. Abrir no VS Code

```bash
code /caminho/para/copilot-pixel-agents
```

### 2. Iniciar a extensão em modo debug

Pressione `F5` (ou **Run → Start Debugging**).

Uma nova janela do VS Code abre — esta é a **janela de desenvolvimento**.

### 3. Abrir o painel Pixel Agents

Na janela de desenvolvimento:

- Clique no ícone **Copilot Pixel Agents** na barra lateral esquerda  
  **ou**  
- `Ctrl+Shift+P` → `Copilot Pixel Agents: Show Pixel Office`

### 4. Instalar os hooks

`Ctrl+Shift+P` → **`Copilot Pixel Agents: Install Hooks`**

O comando:
- Cria `~/.copilot-pixel-agents/hook.sh` (script universal)
- Gera `~/.copilot-pixel-agents/agent-hooks.json` (config pronta)
- Mostra opção para copiar automaticamente para `~/.vscode/agent-hooks.json`

### 5. Ativar os hooks

#### GitHub Copilot Agent Mode

Copie (ou merge) o arquivo gerado:

```bash
cp ~/.copilot-pixel-agents/agent-hooks.json ~/.vscode/agent-hooks.json
```

Se já tiver um `agent-hooks.json`, use a opção **"Copy to VS Code Hooks"** do comando de instalação — ela faz o merge automaticamente.

#### Claude Code

Adicione ao `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse":  [{ "hooks": [{ "type": "command", "command": "~/.copilot-pixel-agents/hook.sh" }] }],
    "PostToolUse": [{ "hooks": [{ "type": "command", "command": "~/.copilot-pixel-agents/hook.sh" }] }],
    "Stop":        [{ "hooks": [{ "type": "command", "command": "~/.copilot-pixel-agents/hook.sh" }] }],
    "SessionStart":[{ "hooks": [{ "type": "command", "command": "~/.copilot-pixel-agents/hook.sh" }] }]
  }
}
```

### 6. Usar o agente

Abra qualquer projeto no VS Code de desenvolvimento e use o Copilot em Agent Mode (ou inicie o Claude Code).

Os personagens aparecem no painel e animam conforme as ferramentas são invocadas.

---

## Variáveis de ambiente dos hooks

O script `hook.sh` lê as seguintes variáveis (set automaticamente pelo runtime):

| Variável | Copilot | Claude Code | Descrição |
|---|---|---|---|
| `COPILOT_HOOK_EVENT` / `HOOK_EVENT` | ✓ | ✓ | Nome do evento |
| `COPILOT_SESSION_ID` / `SESSION_ID` | ✓ | ✓ | ID único da sessão |
| `COPILOT_TOOL_NAME` / `TOOL_NAME` | ✓ | ✓ | Nome da ferramenta |
| `COPILOT_TOOL_ID` / `TOOL_ID` | ✓ | ✓ | ID da invocação |

---

## Eventos suportados

| Evento | Animação |
|---|---|
| `session_start` | Personagem aparece no escritório |
| `pre_tool_use` (read/view) | 📖 Lendo |
| `pre_tool_use` (write/edit) | ⌨ Digitando |
| `pre_tool_use` (bash/exec) | ⚙ Executando |
| `pre_tool_use` (search/grep) | 🔍 Pesquisando |
| `post_tool_use` | Volta ao idle |
| `waiting` / `UserPromptSubmit` | ⏳ Aguardando input |
| `stop` | Idle |
| `session_end` | Personagem sai do escritório |

---

## Configurações

`Ctrl+,` → pesquise `copilotPixelAgents`:

| Chave | Padrão | Descrição |
|---|---|---|
| `copilotPixelAgents.port` | `7823` | Porta do servidor de hooks |
| `copilotPixelAgents.autoShowPanel` | `false` | Abrir painel automaticamente no startup |

---

## Estrutura do projeto

```
copilot-pixel-agents/
├── src/                    # Extensão VS Code (TypeScript)
│   ├── extension.ts        # Entry point
│   ├── hooksServer.ts      # HTTP server recebe eventos dos hooks
│   ├── agentStore.ts       # Estado dos agentes em memória
│   ├── viewProvider.ts     # WebviewViewProvider
│   ├── hooksInstaller.ts   # Instala hook.sh e configs
│   └── types.ts            # Tipos compartilhados
├── webview-ui/src/         # Canvas pixel art (TypeScript)
│   ├── main.ts             # Bootstrap e handler de mensagens
│   ├── engine.ts           # Motor de animação (canvas 2D)
│   ├── style.css           # Estilos do painel
│   └── types.ts            # Tipos compartilhados
├── hooks/
│   ├── hook.sh             # Script de hook (macOS/Linux)
│   ├── hook.cmd            # Script de hook (Windows)
│   └── agent-hooks.json    # Config de referência
└── media/
    └── icon.svg            # Ícone da extensão
```

---

## Roadmap

- [ ] Sprites pixel art reais (baseados nos assets do [Pixel Agents](https://github.com/pablodelucca/pixel-agents))
- [ ] Painel de times para múltiplas sessões simultâneas
- [ ] Inspeção de agente (clique no personagem → histórico de ferramentas)
- [ ] Publicação no VS Code Marketplace

---

## Licença

MIT — baseado nos conceitos do [Pixel Agents](https://github.com/pablodelucca/pixel-agents) por [@pablodelucca](https://github.com/pablodelucca).
