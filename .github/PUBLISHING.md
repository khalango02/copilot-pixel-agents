# Publicando no VS Code Marketplace

## Pré-requisitos

1. Conta em https://marketplace.visualstudio.com/manage
2. Azure DevOps Personal Access Token (PAT) com escopo **Marketplace → Manage**
3. Publisher registrado com o mesmo `publisher` do `package.json` (`cl-oliveira`)

## Passo a passo

### 1. Criar o publisher (se ainda não existir)

Acesse: https://marketplace.visualstudio.com/manage/publishers

Crie um publisher com o ID `cl-oliveira` (ou atualize `package.json` com seu ID).

### 2. Gerar o PAT

- Acesse https://dev.azure.com → User Settings → Personal Access Tokens
- New Token:
  - Name: `vsce-publish`
  - Organization: All accessible organizations
  - Scopes: Custom → **Marketplace → Manage**
  - Expiration: 1 year

### 3. Build e empacotamento

```bash
cd copilot-pixel-agents

# Instalar dependências
npm install
cd webview-ui && npm install && cd ..

# Build completo
npm run build:webview
npm run build

# Gerar .vsix
npm run package
# Isso cria: copilot-pixel-agents-0.2.0.vsix
```

### 4. Testar o .vsix localmente

```bash
# Instalar na instância atual do VS Code
code --install-extension copilot-pixel-agents-0.2.0.vsix
```

### 5. Publicar

```bash
npm run publish
# Solicitará o PAT
```

Ou com o PAT direto:

```bash
npx @vscode/vsce publish --pat <SEU_PAT> --no-dependencies
```

### 6. Atualizar versão

```bash
npm version patch   # 0.2.0 → 0.2.1
# ou
npm version minor   # 0.2.0 → 0.3.0
```

Atualizar CHANGELOG.md antes de publicar.

## Checklist antes de publicar

- [ ] `package.json`: `publisher`, `version`, `description`, `repository` corretos
- [ ] `CHANGELOG.md` atualizado
- [ ] `README.md` com screenshot ou GIF (recomendado pelo Marketplace)
- [ ] `media/icon.svg` ou `icon.png` 128×128 px
- [ ] Build sem erros: `npm run vscode:prepublish`
- [ ] Testado com F5 em modo debug
