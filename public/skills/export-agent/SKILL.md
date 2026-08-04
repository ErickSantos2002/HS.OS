# Skill: export-agent v1

**ID:** export-agent

Exporta um super agente dnOS para um arquivo `.dnos`. Todo o trabalho roda no orquestrador: ler arquivos do VPS, anonimizar dados da empresa, montar o JSON final e fechar o loop via `agent-task`.

---

## Trigger

Executada pela Lia quando a task chega com:

```text
RUN_SKILL export-agent
task_id: <uuid>
target_agent_id: <agent_id>
```

---

## Contrato obrigatório

Nunca conclua apenas com uma resposta em chat. Ao terminar, sempre chame:

1. `agent-task` com `action: checkpoint`
2. `agent-task` com `action: complete`

Se qualquer etapa falhar, chame `agent-task` com `action: fail` e informe o motivo.

---

## Entrada

- `task_id`: id da task em `agent_tasks`
- `target_agent_id`: id do agente a exportar, por exemplo `milo`, `kira`, `radar`

---

## Passos

### 1. Ler arquivos do agente

Leia no VPS:

```text
/root/.openclaw/workspace-{target_agent_id}/SOUL.md
/root/.openclaw/workspace-{target_agent_id}/IDENTITY.md
/root/.openclaw/workspace-{target_agent_id}/TOOLS.md
```

Se um arquivo não existir, use string vazia para esse arquivo e registre a ausência em `notes`.

### 2. Consultar company_profile

Consulte o perfil da empresa usando a ferramenta `company_profile` ou a base configurada no dnOS.

Use os campos disponíveis para fazer find-replace reverso. Substitua valores reais por placeholders
— **estes nomes exatos**, os mesmos que a exportação síncrona (`export-agent` edge function) usa.
O importador (`ImportAgentDialog`) só reconhece exatamente estes tokens:

| Valor real | Placeholder |
|---|---|
| nome da empresa | `{{COMPANY_NAME}}` |
| fundador | `{{FOUNDER_NAME}}` |
| segmento | `{{COMPANY_SEGMENT}}` |
| descrição | `{{COMPANY_DESCRIPTION}}` |
| público-alvo | `{{TARGET_AUDIENCE}}` |
| produtos/serviços | `{{COMPANY_PRODUCT}}` |
| tom/voz da marca | `{{BRAND_VOICE}}` |

Não use nomes alternativos (`{{SEGMENT}}`, `{{TONE}}`, etc.) — o importador não os reconhece e o
placeholder ficaria cru no agente importado.

### 3. Montar JSON `.dnos`

Monte um JSON serializável com **este formato exato** — o campo é `agent_id`, não `id`. O
importador rejeita o arquivo inteiro se esse campo estiver ausente ou com nome diferente:

```json
{
  "dnos_version": "1.0",
  "agent": {
    "agent_id": "target_agent_id",
    "name": "Nome do agente"
  },
  "required_connectors": [],
  "capabilities": [],
  "files": {
    "SOUL.md": "...",
    "IDENTITY.md": "...",
    "TOOLS.md": "..."
  }
}
```

O campo `files` deve conter o conteúdo completo dos três arquivos após o find-replace reverso.

### 4. Salvar no VPS

Salve o JSON serializado em:

```text
/root/.openclaw/workspace/exports/{target_agent_id}.dnos
```

Crie a pasta `exports` se não existir.

### 5. Fechar loop

Chame `agent-task`:

```json
{
  "action": "checkpoint",
  "task_id": "<task_id>",
  "checkpoint_data": {
    "file_path": "/root/.openclaw/workspace/exports/{target_agent_id}.dnos",
    "file_content": "<JSON serializado como string>",
    "notes": "Export concluído."
  },
  "keep_status": true
}
```

Depois chame:

```json
{
  "action": "complete",
  "task_id": "<task_id>"
}
```

---

## Falha

Em qualquer erro, chame:

```json
{
  "action": "fail",
  "task_id": "<task_id>",
  "reason": "Não foi possível exportar o agente: <motivo>"
}
```

Não deixe a task em `running`.