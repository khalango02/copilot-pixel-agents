# Copilot Pixel Agents

Visualize seus agentes de IA como personagens pixel art animados em um escritório virtual.

Compatível com **GitHub Copilot Agent Mode** e **Claude Code**.

![Escritório pixel art com agentes animados](.github/preview.gif)

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

## Instalação rápida (via Marketplace)

> **Pré-requisito:** `curl` disponível no PATH.  
> Não é necessário clonar o repositório.

1. Instale a extensão pelo [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=cl-oliveira.copilot-pixel-agents)
2. Na primeira abertura do VS Code, aparece o prompt:  
   **"🎮 Copilot Pixel Agents is ready! Install hooks…"** → clique **"Install Hooks (automatic)"**
3. Pronto — hooks configurados para Copilot e Claude Code automaticamente.

Ou a qualquer momento: `Ctrl+Shift+P` → **`Copilot Pixel Agents: Install Hooks`**

O comando instala **sem necessidade de reinicialização** e é idempotente (pode ser executado mais de uma vez com segurança).

### O que é instalado automaticamente

| Arquivo | Propósito |
|---|---|
| `~/.copilot-pixel-agents/hook.sh` | Script de hook universal |
| `~/.vscode/agent-hooks.json` | Hooks para GitHub Copilot Agent Mode |
| `~/.claude/settings.json` | Hooks para Claude Code |

---

## Usar o agente

Após instalar os hooks:

1. Abra o painel **Copilot Pixel Agents** na barra lateral (ou `Ctrl+Shift+P` → `Show Pixel Office`)
2. Inicie uma sessão de agente normalmente (Copilot em Agent Mode ou `claude` no terminal)
3. Cada sessão aparece como um personagem no escritório virtual

### Escritório isométrico

O cenário usa uma perspectiva **2,5D** com piso em losangos, paredes e móveis
volumétricos, sombras e sobreposição por profundidade, mantendo os personagens pixel art.

- **Arraste o cenário** para navegar pelo escritório.
- Use **+ / −** para aproximar ou afastar a câmera e **↺** para reenquadrar a sala.
- Clique em um personagem ou no seu nome na barra inferior para ver as atividades.
- O escritório cresce conforme novos agentes chegam; redimensionar o painel não interrompe suas atividades.

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

## Desenvolvimento local

```bash
git clone https://github.com/khalango02/copilot-pixel-agents
cd copilot-pixel-agents
npm install
cd webview-ui && npm install && cd ..
```

Pressione `F5` no VS Code para abrir uma janela de desenvolvimento com a extensão carregada.

Após instalar as dependências da raiz e da webview, valide a interface com
`npm --prefix webview-ui test` e `npm --prefix webview-ui run typecheck`.
Os testes cobrem projeção, enquadramento responsivo, zoom, arraste, seleção,
preservação das atividades ao redimensionar e renderização sem sprites disponíveis.

---

## Estrutura do projeto

```
copilot-pixel-agents/
├── src/                    # Extensão VS Code (TypeScript)
│   ├── extension.ts        # Entry point + prompt de instalação automática
│   ├── hooksServer.ts      # HTTP server recebe eventos dos hooks
│   ├── agentStore.ts       # Estado dos agentes em memória
│   ├── viewProvider.ts     # WebviewViewProvider
│   ├── hooksInstaller.ts   # Instala hook.sh e configura Copilot + Claude Code
│   └── types.ts
├── webview-ui/src/         # Canvas pixel art (TypeScript + Vite)
│   ├── engine.ts           # Simulação, layout e interação com a câmera
│   ├── isometric.ts        # Projeção 2,5D, cenário, profundidade e seleção
│   ├── sprites.ts          # Carregamento de sprites
│   ├── main.ts             # Bootstrap e handler de mensagens
│   └── style.css
├── hooks/
│   ├── hook.sh             # Script universal (Copilot + Claude Code via stdin)
│   └── hook.cmd            # Windows
└── media/icon.png
```

---

## Licença

MIT — sprites pixel art baseados no [Pixel Agents](https://github.com/pablodelucca/pixel-agents) por [@pablodelucca](https://github.com/pablodelucca).
