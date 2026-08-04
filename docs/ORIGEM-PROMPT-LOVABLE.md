# Remix of [OFICIAL] dn.os - Plataforma de super agentes da dn.ia

Crie um Mission Control para gerenciar agentes de IA via OpenClaw Gateway API.

CONTEXTO TÉCNICO:

- OpenClaw Gateway roda em VPS (acesso via túnel SSH ou subdomínio Cloudflare)

- API REST disponível em: http://localhost:18789

- Autenticação: Bearer token no header Authorization

- Dados locais em SQLite no servidor

FUNCIONALIDADES (em ordem de prioridade):

1. DASHBOARD PRINCIPAL

- Status do gateway (online/offline)

- Lista de agentes ativos com status

- Métricas: tokens usados, sessões ativas, uptime

2. CHAT COM AGENTES

- Sidebar com lista de agentes

- Interface de chat por agente

- Histórico de conversas

- Indicador de qual canal está usando (Telegram, WhatsApp, etc.)

3. GERENCIAMENTO DE AGENTES

- Criar novo agente (nome, system prompt, modelo, canais)

- Editar agente existente

- Ativar/desativar agente

- Definir permissões por membro da equipe

4. CONTROLE DE TIMES

- Cadastro de membros (nome, email, cargo)

- Atribuir agentes a membros

- Níveis de acesso: Admin (eu) e Operador (equipe DN.IA)

5. GESTÃO DE ARQUIVOS

- Upload de arquivos para workspace dos agentes

- Visualizar arquivos por agente

- Deletar arquivos

DESIGN:

- Dark mode como padrão

- Sidebar esquerda com navegação

- Cores: laranja/âmbar como accent (referência à marca DN.IA)

- Interface profissional, densa, sem floreios

TECH STACK:

- React + TypeScript

- Tailwind CSS

- Conexão com OpenClaw via fetch() para a API REST

- Estado global com Zustand ou Context API

- Configuração de URL base e token na tela de Settings

TELA DE SETTINGS (obrigatória):

- Campo: Gateway URL (ex: https://agentes.dnia.ai)

- Campo: Bearer Token

- Botão: Testar conexão

- Salvar em localStorage


use o mesmo design system da área de /analytics e crm/funil de @project:f334bd90-8806-49b0-8de4-1f06503aa80a:"Nexus AI"

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/42055871-1cf6-4998-a33e-c74d8b1f2031).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
