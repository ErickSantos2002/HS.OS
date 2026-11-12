# Guardi no GestorHS, fase 2b (Laboratório): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o técnico do laboratório fala os números ao Guardi e confirma um cartão que gera o certificado de calibração de um aparelho. O avanço da caixa passa a recusar, antes do cartão, quando houver aparelho pendente no Laboratório.

**Architecture:** mesmo trilho da 2a. A regra pura vai em `app/gestorhs_escrita.py`, a ferramenta em `routers/mcp_bot.py` (`_gestorhs`), o executor em `app/acoes.py` e o cartão em `frontend/src/lib/acoes.ts`.

**Tech Stack:** FastAPI, httpx MockTransport, pytest; Vitest.

**Spec:** `docs/superpowers/specs/2026-11-12-guardi-gestorhs-laboratorio-design.md`

## Global Constraints

- Ação `("gestorhs", "gerar_certificado")`, ferramenta `gestorhs_gerar_certificado`. Cartão sempre; o executor usa só o `payload`.
- Leituras: 5, cada uma número com vírgula ou ponto (`0,181`, `0.181`, `,181`), normalizadas para vírgula com 3 casas (`0,181`). Recusar `181`, texto, negativo e acima de 9,999.
- Média = média aritmética das 5, arredondada **meio para cima** (`Decimal.quantize(ROUND_HALF_UP)`), 3 casas, vírgula. Âncora real: `0,170 0,170 0,170 0,180 0,190` → `0,176`.
- `calib_temp` e `calib_pressao`: numéricos, gravados com **ponto** (`22.0`, `1017.3`). `calib_cert` de 1 a 30 caracteres. `calib_situacao` ∈ {`Aparelho subsequente` (padrão), `Aparelho inicial`}. `data_calibracao` opcional, AAAA-MM-DD.
- Nunca mandar campos de override de cabeçalho (`nomecli`, `cnpj`, `endcli`, `modelo`, `marca`, `serie`, `patrimonio`, `datacompra`).
- OS precisa estar na fase 5 (Laboratório). `tipo_servico == "M"` é recusado.
- Baseline: backend 1263 passed (com `EMAIL_CHAVE_CIFRA` de teste). Changelog `2.7.0` (novidade), data `2026-11-12`, no topo.

## Review Focus

1. Técnico fala "um oito um" ou "181": recusa antes do cartão, pedindo `0,181` (Task 1).
2. OS com certificado já gerado: o cartão avisa "substitui" e mostra a data antiga, não "hoje" (Task 2).
3. Avançar caixa em Laboratório com um aparelho pendente: lista OS e série, sem cartão (Task 3).
4. Média com 4ª casa (`0,1718`): arredonda para 3 casas como quem faz à mão (`0,172`) (Task 1).
5. Guardi da Expedição gera certificado: 403 vira "a sua função no GestorHS não permite isso" (Task 2, já coberto pelo `_MSG_ESCRITA`; um teste confirma).

---

### Task 1: Regras puras do certificado

**Files:** Modify `backend/app/gestorhs_escrita.py`; Test `backend/tests/test_guardi_gestorhs_laboratorio.py`

**Interfaces (Produces):**
- `leitura(valor) -> str`: normaliza uma leitura ou levanta `ValueError`.
- `media(leituras: list[str]) -> str`
- `numero_ambiente(valor, campo: str) -> str`: temperatura ou pressão com ponto.
- `conferir_os_para_certificado(ordem: dict, campos: dict, certificados: list[dict]) -> dict`. Recebe o GET `/ordens/{id}`, o GET `/ordens/{id}/certificado-campos` e o GET `/ordens/{id}/certificados`. Recusa fase ≠ 5 e tipo M. Devolve o `_exibir`: `{"os", "cliente", "modelo", "serie", "data": campos.data_calibracao or "hoje", "substitui": bool, "tipo": TIPOS[...], "manutencao": tipo == "A"}`.
- `payload_do_certificado(args: dict, ordem_id: int) -> dict`. Devolve `{"ordem": id, "calib_cert", "calib_temp", "calib_pressao", "calib_teste1".."calib_teste5", "calib_teste_media", "calib_situacao", "data_calibracao"?}`.

- [ ] **Step 1: Testes**

```python
def test_leitura_normaliza_e_recusa_o_que_nao_e_leitura():
    """Número errado num certificado é documento da Qualidade errado."""
    assert ge.leitura("0,181") == "0,181" and ge.leitura("0.18") == "0,180" and ge.leitura(",181") == "0,181"
    for ruim in ("181", "abc", "-0,1", "12,5", "", None):
        with pytest.raises(ValueError):
            ge.leitura(ruim)

def test_media_bate_com_os_certificados_reais():
    assert ge.media(["0,170", "0,170", "0,170", "0,180", "0,190"]) == "0,176"
    assert ge.media(["0,186", "0,180", "0,184", "0,190", "0,190"]) == "0,186"
    assert ge.media(["0,171", "0,172", "0,172", "0,172", "0,172"]) == "0,172"   # 0,1718
    with pytest.raises(ValueError):
        ge.media(["0,170"] * 4)

def test_os_fora_do_laboratorio_ou_so_manutencao_recusa():
    campos = {"data_calibracao": None}
    with pytest.raises(ValueError):
        ge.conferir_os_para_certificado({"id": 1, "fase": 4, "tipo_servico": "C"}, campos, [])
    with pytest.raises(ValueError, match="manutenção"):
        ge.conferir_os_para_certificado({"id": 1, "fase": 5, "tipo_servico": "M"}, campos, [])

def test_regerar_mostra_a_data_antiga_e_avisa_que_substitui():
    ex = ge.conferir_os_para_certificado(
        {"id": 1, "fase": 5, "tipo_servico": "C", "cliente_nome": "ACME",
         "equipamento_descricao": "Phoebus", "equipamento_serie": "F1"},
        {"data_calibracao": "2026-11-10"}, [{"tipo": "C"}])
    assert ex["data"] == "2026-11-10" and ex["substitui"] is True

def test_payload_nunca_leva_override_de_cabecalho():
    p = ge.payload_do_certificado({"cert": "HF1", "temperatura": "22", "pressao": "1017,3",
                                   "leituras": ["0,17"] * 5, "nomecli": "X"}, 9)
    assert p["calib_temp"] == "22.0" and p["calib_pressao"] == "1017.3"
    assert p["calib_teste_media"] == "0,170" and p["calib_situacao"] == "Aparelho subsequente"
    assert not {"nomecli", "cnpj", "serie", "modelo"} & set(p)
```

- [ ] **Step 2: Rodar e ver falhar.** `cd backend && .venv/bin/python -m pytest tests/test_guardi_gestorhs_laboratorio.py -q`
- [ ] **Step 3: Implementar** com `Decimal`. Temperatura e pressão com uma casa a mais só se o técnico deu (`"22"` → `"22.0"`, `"1017,35"` → `"1017.35"`).
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** `feat(guardi): regras do certificado de calibração`.

---

### Task 2: Ferramenta, executor e cartão do certificado

**Files:** Modify `backend/app/routers/mcp_bot.py`, `backend/app/acoes.py`, `backend/app/email/regras.py`, `frontend/src/lib/acoes.ts`, `frontend/src/lib/acoes.test.ts`; Test `backend/tests/test_guardi_gestorhs_laboratorio.py`

**Interfaces:**
- Argumentos de `gestorhs_gerar_certificado`: `{os: int, cert: str, temperatura: str, pressao: str, leituras: [5 strings], situacao?: str, data_calibracao?: "AAAA-MM-DD"}`.
- Descrição para o agente: um aparelho por vez; ache a OS pela série com `gestorhs_consultar ordens q=`; peça temperatura e pressão uma vez e reaproveite na conversa; **não calcule a média**, o servidor calcula; o cartão gera o certificado e conclui o aparelho; depois de feito, entregue o `link_pdf` e pergunte se quer avançar a caixa (`gestorhs_avancar_caixa`). NÃO executa sozinho.
- Antes do cartão: GET `/ordens/{os}`, `/ordens/{os}/certificado-campos`, `/ordens/{os}/certificados`. Resumo: `"Certificado da OS 11700 (série F006097)"`.
- Executor `_gestorhs_gerar_certificado`: POST `/ordens/{p["ordem"]}/gerar-certificado` com o payload sem `ordem`/`_exibir`, montado por lista fixa de chaves. Depois, GET `/ordens/{id}/certificados` para pegar o `link_pdf` do tipo `C`. Retorno: `"Certificado gerado e aparelho concluído no laboratório. PDF: <link>"`, ou sem a parte do PDF se o link não vier.
- Cartão (`cartaoDaAcao("gerar_certificado", p)`): verbo "Gerar certificado", título `"OS <os> · série <serie>"`. Linhas: Cliente, Modelo, Código, Temperatura, Pressão, Média, Situação, Data. As 5 leituras numa lista "Leituras". Em `texto` (rótulo "Atenção"): "gera o certificado e conclui o aparelho no laboratório", mais "substitui o certificado já gerado" quando `substitui`, mais "também gera o relatório de manutenção" quando `manutencao`.

- [ ] **Step 1: Testes**: `test_ferramenta_no_guardi`; `test_sem_gestorhs_recusa_sem_rede`; `test_cartao_tem_media_do_servidor_e_nenhuma_escrita_antes_do_clique` (conn falsa captura `criar_pendente`; só GETs no MockTransport; `payload["calib_teste_media"] == "0,176"`); `test_executor_gera_e_devolve_link_pdf`; `test_403_de_quem_nao_e_laboratorio` (mensagem com "sua função no GestorHS"); `test_descricao_manda_nao_calcular_e_perguntar_avancar` ("não calcule" e "avançar" na descrição). No front, um teste de `cartaoDaAcao("gerar_certificado", …)` conferindo as 5 leituras e o aviso "conclui o aparelho".
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Suítes.** Backend inteiro e `npx vitest run src/lib/acoes.test.ts`.
- [ ] **Step 5: Commit** `feat(guardi): gerar certificado de calibração por cartão`.

---

### Task 3: Avançar caixa recusa aparelho pendente no Laboratório

**Files:** Modify `backend/app/gestorhs_escrita.py` (`conferir_caixa_para_avancar`), `backend/app/routers/mcp_bot.py` (passar a caixa com `ordens`); Test `backend/tests/test_guardi_gestorhs_laboratorio.py`

**Interfaces:** `conferir_caixa_para_avancar(caixa, cliente_principal)` passa a olhar `caixa["ordens"]` (o `CaixaDetalhe` do `GET /caixas/{id}` já traz `desfecho_lab`, `fase` e `equipamento_serie` por OS). Na fase 5, se houver OS em fase ativa com `desfecho_lab` em `None` ou `"pendente"`, levanta `ValueError` com `"Ainda sem certificado no laboratório: OS 11700 (série F1), OS 11701 (série F2)."`.

- [ ] **Step 1: Teste** `test_avancar_no_laboratorio_lista_os_pendentes`: caixa fase 5 com uma OS `concluido` e uma `pendente` → `ValueError` citando só a pendente; com todas terminais (`concluido`, `sem_conserto`, `liberado`) → passa.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Suíte inteira.**
- [ ] **Step 5: Commit** `feat(guardi): avançar caixa diz quais aparelhos faltam no laboratório`.

---

### Task 4: Template, changelog e documentação

**Files:** `backend/app/bots_pessoais.py`, `frontend/src/data/changelog.ts` (2.7.0), `CLAUDE.md`; Test `backend/tests/test_guardi_gestorhs_laboratorio.py`

Acrescentar ao bloco do GestorHS no AGENTS.md (exato):

```
  Certificado de calibração (`gestorhs_gerar_certificado`): um aparelho por
  vez; a média quem calcula é o servidor. Depois de gerado, pergunto se
  {primeiro} quer avançar a caixa.
```

- [ ] **Step 1: Teste** `test_agents_md_fala_do_certificado_e_cabe_no_teto`: `"gestorhs_gerar_certificado"` presente e `not excede_o_teto`.
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar.** Changelog: "O Guardi agora ajuda o laboratório: você fala os números da calibração e ele prepara o certificado para você conferir e confirmar — a média ele calcula sozinho." No CLAUDE.md: a ação nova, a média no servidor, o cabeçalho preservado pelo GestorHS e o avanço que lista o que falta.
- [ ] **Step 4: Suítes** (backend e `npx vitest run src/test/novidades.test.ts src/lib/acoes.test.ts`).
- [ ] **Step 5: Commit** `feat(guardi): laboratório no template e na documentação`.

---

## Depois do plano (não é código)

1. Prompt "Para o GestorHS" da spec → `cl GestorHS` → deploy do `gestorhs-api`.
2. Deploy do HS.OS → `publicar-bots-mcp.py --aplicar` → `criar-bots-pessoais.py --reescrever-agents-md --aplicar --todos`.
3. Conferência sem escrita no `erick-bot`. Primeira escrita real com o Paulo.
