# Guardi no GestorHS, fase 2b: Laboratório (design, 12/11/2026)

Continuação da fase 2a (`2026-11-12-guardi-gestorhs-expedicao-design.md`, no ar
em 12/11/2026). Reaproveita tudo dela: cartão em `acoes_pendentes`, executores em
`app/acoes.py`, `gestorhs.chamar(..., metodo=, json=)`, a ferramenta
`gestorhs_avancar_caixa` e a regra de que **a permissão é a função do dono no
GestorHS**.

## Intenção

Quem pediu foi o **Nicholson** (dono da empresa). Para o Paulo, que faz isso
todo dia, o trabalho é simples e não incomoda, então o ganho não é tirar uma dor
dele. A cena que o Nicholson imagina é o técnico calibrando e **falando os
números ao Guardi** (voz ou texto), em vez de abrir a OS e digitar no
formulário. O Guardi monta o certificado e o técnico só confere e confirma.

Uso diário: o Guardi do **Paulo**. **Walbert e Suelen** também precisam
conseguir. Quem pode é a função **Laboratório** no GestorHS, e não uma lista de
nomes.

## Decisões do Erick (12/11/2026)

1. **Um aparelho por vez.** O Paulo calibra e registra um por um, conforme
   termina. Então é **um cartão por aparelho** (sem lote).
2. **Média calculada pelo servidor**, nunca pelo modelo.
3. **Situação padrão "Aparelho subsequente"** (2.906 dos 2.909 certificados).
4. **Temperatura e pressão:** o Guardi pede uma vez e reaproveita na mesma
   conversa, mostrando os valores no cartão.
5. **Gerar o certificado conclui o aparelho, como já é hoje** (o `gerar` do
   GestorHS marca o desfecho "concluído" na mesma chamada; correção do Erick,
   12/11). **O passo separado é AVANÇAR A CAIXA** para a próxima etapa: às vezes
   falta certificado de outros aparelhos da caixa, às vezes o laboratório ainda
   não decidiu liberar.
6. **Depois de gerar, o Guardi pergunta se o técnico quer avançar a caixa.**

## O que o GestorHS já tem (lido em `~/github/GestorHS`, 12/11/2026)

- **`POST /ordens/{id}/gerar-certificado`** (`require_funcao("Laboratório",
  "Administrador")`), corpo `GerarCertificadoIn`. Todos os campos são strings
  opcionais: `calib_cert`, `calib_temp`, `calib_pressao`, `calib_teste1`…`5`,
  `calib_teste_media`, `calib_situacao`, `data_calibracao` (date) e overrides de
  cabeçalho (`nomecli`, `cnpj`, `modelo`, `serie`…). Grava os valores na OS,
  congela o cilindro padrão vigente e gera os documentos que o `tipo_servico`
  pede (C → calibração; M → manutenção; A → os dois). Recusas em 409: aparelho
  sem modelo de certificado; M/A sem manutenção registrada (número, data,
  serviço).
- **Formato real dos valores** (últimos certificados): `calib_cert` "HF02961"
  (muda por aparelho), `calib_temp` "22.0", `calib_pressao` "1017.3", leituras
  "0,170" (vírgula, 3 casas), média "0,176" (média das 5, 3 casas).
- **`GET /ordens/{id}/certificado-campos`** devolve o que o formulário mostra:
  cabeçalho do cliente e do aparelho mais os valores já gravados.
- **`POST /ordens/{id}/desfecho-lab`** (`exige_funcao_da_fase`: Laboratório),
  `{desfecho: concluido|sem_conserto|liberado, obs}`. "concluido" exige os
  certificados que o tipo pede e espelha a calibração na frota.
- **O `gerar` já conclui:** no fim, se a OS está em Laboratório com desfecho
  pendente, chama `concluir_laboratorio` e loga "Laboratório concluído —
  certificado gerado" (`certificados_os.py:127`). Isso fica como está.
- **A caixa só sai do Laboratório quando TODAS as OS ativas têm desfecho**
  (`pode_avancar_caixa`: "faltam N aparelho(s) sem desfecho no laboratorio").
  Como gerar já conclui, o que trava o avanço é aparelho sem certificado (ou
  com desfecho pendente por outro motivo).

## O que entra

### 1. Gerar certificado (um aparelho)

- O técnico diz a OS (ou a série, e o Guardi acha a OS ativa dela no
  Laboratório) e os valores: código do certificado (`calib_cert`), temperatura,
  pressão, as 5 leituras e, se não for o padrão, a situação.
- **Antes do cartão**, o servidor lê a OS e o `certificado-campos`:
  - recusa OS fora da fase Laboratório;
  - recusa leitura que não seja número (aceita "0,181", "0.181" e "181" não);
  - normaliza para vírgula com 3 casas;
  - **calcula a média** (média aritmética das 5, arredondada a 3 casas, com
    vírgula) e a põe no payload.
- O cartão mostra cliente, modelo, série e OS (do GestorHS), cada uma das 5
  leituras numa linha, a média calculada, temperatura, pressão, código, situação
  e **a data que vai sair**: a do `certificado-campos` se a OS já tiver uma, senão
  "hoje". O agente só manda `data_calibracao` quando o técnico disser outra.
  *(Chamada do Claude: regerar mantém a data, e com ela o cilindro congelado.)*
- O cartão diz "gera o certificado **e conclui o aparelho** no laboratório".
- **OS só de manutenção (tipo M) é recusada:** não há leitura para registrar, e
  o relatório de manutenção fica pela tela. *(Chamada do Claude.)*
- Se a OS **já tem certificado**, o cartão avisa em destaque: "substitui o
  certificado já gerado".
- Se a OS for M ou A, avisa que também gera o relatório de manutenção, e que o
  GestorHS recusa se a manutenção não estiver registrada (pela tela).
- **Execução:** `POST /ordens/{id}/gerar-certificado` com os valores do payload.
  Responde com o `link_pdf` do certificado de calibração (lido de
  `GET /ordens/{id}/certificados` depois de gerar).
- **Depois** (instrução ao agente, decisão 6): entrega o link e pergunta "quer
  avançar a caixa N?".

### 2. Avançar a caixa: o `gestorhs_avancar_caixa` da 2a, com uma checagem a mais

- Sem ferramenta nova. Depois de gerar, o Guardi pergunta "quer avançar a caixa
  N?" e, se sim, usa o `gestorhs_avancar_caixa` que já existe.
- **Checagem nova antes do cartão, quando a caixa está em Laboratório:** ler as
  OS ativas da caixa e, havendo alguma com desfecho pendente, **não montar
  cartão** e dizer quais (OS e série) ainda não têm certificado. Sem isso o
  cartão sairia e o GestorHS recusaria no clique com "faltam N aparelho(s)".

## Fora desta fase

- Desfecho "sem conserto" e "liberado sem certificado" (decisões com
  justificativa): continuam pela tela.
- OS só de manutenção (tipo M).
- Registrar manutenção (número, data, serviços) e o relatório de manutenção.
- Overrides de cabeçalho do certificado (nome do cliente, CNPJ etc.).
- Certificado avulso e certificado de venda.

## Anti-objetivos

- O modelo fazer a conta da média.
- Gerar certificado sem o técnico ver cada número no cartão.
- Concluir o aparelho só porque o certificado foi gerado.
- Montar um cartão de avanço que o GestorHS vai recusar por desfecho pendente.

## Restrições

- Mesmas da 2a: cartão sempre, executor só com o `payload` gravado, corpo por
  lista fixa de chaves, texto do GestorHS saneado em uma linha no `_exibir`.
- `calib_cert` até 30 caracteres; temperatura e pressão numéricas (vírgula ou
  ponto), gravadas como o técnico disse, com ponto (o formato do banco);
  `data_calibracao` opcional (AAAA-MM-DD, padrão hoje no GestorHS);
  `calib_situacao` ∈ {"Aparelho subsequente", "Aparelho inicial"}.
- Nome de ação: `gerar_certificado`. Ferramenta: `gestorhs_gerar_certificado`.
- A temperatura e a pressão "da conversa" (decisão 4) ficam com o agente, que
  as manda em toda chamada. O servidor não guarda estado entre chamadas.

## Para o GestorHS (sessão no repo `~/github/GestorHS`)

1. Abrir a allowlist do token de agente para mais uma escrita, e só ela:
   `POST /ordens/{ordem_id}/gerar-certificado`. E, na leitura,
   `GET /ordens/{ordem_id}/certificado-campos`. Vale o `require_funcao` de
   sempre (Laboratório, Administrador), com a função do dono. `desfecho-lab`
   continua fechado ao agente.
2. Para token de agente, `gerar-certificado` **não toca em `cert_overrides`**:
   ignora os campos de override do corpo e **preserva** o que já está gravado.
   Hoje um corpo sem override zera o que havia, e 763 OS têm cabeçalho ajustado
   pela tela. Regerar pelo Guardi não pode desfazer isso.
3. "via <bot>" no log da geração e no "Laboratório concluído" que ela grava.
4. Testes: Laboratório gera (e a OS fica concluída, como hoje); Expedição e
   Consulta → 403; override via agente não muda nem apaga o cabeçalho; o log
   traz "via"; `desfecho-lab` via agente → 403.
5. Changelog e deploy do **`gestorhs-api`**.

## Conferência

- No `erick-bot`: preparar o cartão de um certificado numa OS de teste em
  Laboratório e **cancelar**; pedir para avançar uma caixa do Laboratório com
  aparelho sem certificado (deve listar quais faltam, sem cartão); um Guardi da Expedição
  pedindo para gerar certificado deve ter a recusa citando a função.
- Primeira escrita real **com o Paulo**, acompanhada: um aparelho, conferido
  contra o PDF.

## Para o construtor decidir

- Como o agente acha a OS a partir da série (consulta `ordens` com `q`, ou
  `os_do_aparelho`).
- A forma do cartão para as 5 leituras (linhas ou lista).
- De onde vem o desfecho de cada OS da caixa para a checagem do avanço (o
  `CaixaDetalhe.ordens` ou `GET /ordens?…`).
