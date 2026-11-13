"""Os ASSUNTOS da tela "Capacidade" do Guardi (13/11/2026).

A primeira versão listava as consultas e ações cruas, com a descrição escrita
para o AGENTE: o TalentHS de um colaborador saía com 42 linhas de "Consultar",
incluindo passos que só servem ao Guardi ("Uma pessoa pelo user_id", "Os
ciclos de metas", "Quem você é no TalentHS"). O Erick abriu, viu o print e
disse que ninguém entende o que dá para fazer.

Aqui cada item de cada catálogo ganha um **assunto** (≈3–8 por sistema, com
nome de quem usa) e uma **frase curta escrita à mão** — ou a marca `INTERNO`,
quando é só passo intermediário (id, ciclo, tipo, "quem você é", lista de
referência). Interno não aparece, mas continua contando para a permissão onde
é pré-requisito: o item que depende dele o declara em `requer` e só aparece se
as rotas dos dois estiverem liberadas (sem o ciclo, "a sua avaliação" não
abre).

**Por que um arquivo só, e não ao lado de cada catálogo:** os catálogos
(`*_consultas.py`, `talenths_escrita.py`, `capacidade.ACOES`) são texto PARA O
AGENTE e mudam junto com a integração; isto aqui é texto DA TELA — título,
ícone, cor, a frase que a pessoa lê. Juntos num arquivo dá para ler a tela
inteira de uma vez, manter o tom igual entre os sistemas e não poluir o
catálogo do agente com decisão visual. O que impede esquecer item novo é o
teste `test_todo_item_tem_assunto_ou_e_interno`: catálogo ganhou uma chave sem
entrada aqui → falha, nomeando a chave.

Puro, testado em `tests/test_capacidade.py`.
"""
from __future__ import annotations

from dataclasses import dataclass

# As cores e os ícones que a tela sabe desenhar (`frontend/src/lib/capacidade.ts`
# tem as mesmas listas). Nome de cor do Tailwind; ícone do lucide-react.
CORES = ("sky", "emerald", "amber", "violet", "rose", "teal", "indigo", "orange", "cyan", "fuchsia")
ICONES = (
    "list-checks", "kanban", "alarm-clock", "plane", "clock", "target", "messages-square",
    "graduation-cap", "gift", "building", "megaphone", "wallet", "trending-up", "file-text",
    "landmark", "alert-triangle", "users", "package", "shopping-cart", "book-open", "list-todo",
    "gauge", "truck", "clipboard-list", "flask", "receipt", "briefcase", "calendar-clock", "wrench",
    "layout-dashboard", "brain", "bell", "inbox", "calendar-days",
)

INTERNO = "interno"


@dataclass(frozen=True)
class Assunto:
    chave: str
    titulo: str
    icone: str
    cor: str


@dataclass(frozen=True)
class Onde:
    """Onde um item aparece: o assunto, a frase curta e, opcionalmente, um
    exemplo do que dizer ao Guardi (sem ele, vale o do catálogo). `requer` =
    chaves de itens INTERNOS do mesmo sistema cujas rotas também precisam estar
    liberadas. `na_hora` só para o HS.OS: o que sai sem cartão."""
    assunto: str
    frase: str
    exemplo: str | None = None
    requer: tuple[str, ...] = ()
    na_hora: bool = False


def o(assunto: str, frase: str, exemplo: str | None = None, requer: tuple[str, ...] = (),
      na_hora: bool = False) -> Onde:
    return Onde(assunto, frase, exemplo, requer, na_hora)


A = Assunto

# ── TaskHS ────────────────────────────────────────────────────────────────────
_TASKHS = (
    A("tarefas", "Minhas tarefas", "list-checks", "sky"),
    A("quadros", "Quadros e equipe", "kanban", "violet"),
    A("atrasos", "Parados e atrasados", "alarm-clock", "amber"),
)
_TASKHS_VE = {
    "taskhs_eu": INTERNO,
    "taskhs_minhas": o("tarefas", "as tarefas em que você está"),
    "taskhs_tarefa": o("tarefas", "os checklists de cada tarefa"),
    "taskhs_buscar": o("tarefas", "procurar tarefas pelo texto"),
    "taskhs_quadros": o("quadros", "os quadros que você pode abrir"),
    "taskhs_quadro": o("quadros", "as listas e os cards de cada quadro"),
    "taskhs_membros_quadro": o("quadros", "quem está em cada quadro"),
    "taskhs_parados": o("atrasos", "os cards parados ou atrasados"),
}
_TASKHS_FAZ = {
    "criar": o("tarefas", "criar tarefas, com checklist"),
    "atualizar": o("tarefas", "concluir, mudar prazo ou prioridade"),
    "comentar": o("tarefas", "comentar numa tarefa"),
    "mover": o("quadros", "mover tarefas de lista"),
    "membros": o("quadros", "pôr ou tirar pessoas de uma tarefa"),
}

# ── TalentHS ──────────────────────────────────────────────────────────────────
_TALENTHS = (
    A("ausencias", "Férias e ausências", "plane", "sky"),
    A("ponto", "Ponto", "clock", "teal"),
    A("metas", "Metas e PDI", "target", "emerald"),
    A("avaliacao", "Avaliação e feedback", "messages-square", "violet"),
    A("cursos", "Cursos e workshops", "graduation-cap", "amber"),
    A("beneficios", "Benefícios e carreira", "gift", "rose"),
    A("comunicados", "Comunicados e calendário", "megaphone", "orange"),
    A("empresa", "Empresa e pessoas", "building", "indigo"),
    A("salario", "Salário (RH)", "wallet", "fuchsia"),
)
_CICLO_META = ("ciclos_de_metas",)
_CICLO_AV = ("ciclos_de_avaliacao",)
_REF_SAL = ("referencias_salariais",)
_TALENTHS_VE = {
    "eu": INTERNO,
    "pessoa": INTERNO,
    "tipos_de_ausencia": INTERNO,
    "ciclos_de_metas": INTERNO,
    "ciclos_de_avaliacao": INTERNO,
    "referencias_salariais": INTERNO,
    "minhas_ausencias": o("ausencias", "os seus pedidos de férias e ausência"),
    "calendario_de_ausencias": o("ausencias", "quem está ausente"),
    "ausencias_do_time": o("ausencias", "os pedidos de toda a empresa"),
    "relatorio_ausencias": o("ausencias", "o relatório de ausências"),
    "meu_ponto_hoje": o("ponto", "as suas batidas de hoje"),
    "meu_ponto": o("ponto", "as suas batidas num período", "como ficou o meu ponto na semana passada?"),
    "ponto_do_time": o("ponto", "as batidas da empresa"),
    "ajustes_de_ponto": o("ponto", "os ajustes de ponto pendentes"),
    "metas": o("metas", "as metas do ciclo e o progresso", "como estão as metas deste ciclo?",
               requer=_CICLO_META),
    "meta": o("metas", "o plano e o realizado de cada meta"),
    "comentarios_da_meta": o("metas", "os comentários das metas"),
    "meu_pdi": o("metas", "o seu PDI e as ações"),
    "pdi_do_time": o("metas", "os PDIs da empresa"),
    "relatorio_pdi": o("metas", "o relatório de PDI"),
    "minha_avaliacao": o("avaliacao", "a sua avaliação", "como foi a minha avaliação?", requer=_CICLO_AV),
    "comportamentos": o("avaliacao", "os comportamentos avaliados"),
    "notas_da_avaliacao": o("avaliacao", "as notas de cada pessoa", requer=_CICLO_AV),
    "status_das_avaliacoes": o("avaliacao", "quem já avaliou e foi avaliado", requer=_CICLO_AV),
    "nove_box": o("avaliacao", "a matriz 9-box", requer=_CICLO_AV),
    "meus_feedbacks": o("avaliacao", "os pedidos de feedback para você", "tenho feedback para responder?"),
    "feedbacks": o("avaliacao", "os pedidos de feedback da empresa"),
    "respostas_do_feedback": o("avaliacao", "as respostas de cada pedido"),
    "pesquisas": o("avaliacao", "as pesquisas internas"),
    "resultado_da_pesquisa": o("avaliacao", "o resultado das pesquisas"),
    "cursos": o("cursos", "o catálogo da Universidade"),
    "meus_cursos": o("cursos", "os seus cursos e o progresso"),
    "minhas_trilhas": o("cursos", "as suas trilhas"),
    "cursos_do_time": o("cursos", "os cursos de cada pessoa"),
    "trilhas_do_time": o("cursos", "as trilhas de cada pessoa"),
    "workshops": o("cursos", "os workshops e a sua inscrição", "quais workshops estão abertos?"),
    "meus_videos": o("cursos", "os seus vídeos"),
    "testes_disponiveis": o("cursos", "os testes que você pode fazer"),
    "minhas_tentativas": o("cursos", "as suas notas nos testes"),
    "relatorio_cursos": o("cursos", "o relatório da Universidade"),
    "beneficios": o("beneficios", "os benefícios oferecidos"),
    "meus_beneficios": o("beneficios", "os seus benefícios"),
    "beneficios_do_time": o("beneficios", "os benefícios de cada pessoa"),
    "beneficios_de_uma_pessoa": o("beneficios", "os benefícios de cada pessoa"),
    "resumo_de_beneficios": o("beneficios", "o resumo dos benefícios"),
    "relatorio_beneficios": o("beneficios", "o relatório de benefícios"),
    "trilhas_de_carreira": o("beneficios", "as trilhas de carreira"),
    "minha_carreira": o("beneficios", "a sua carreira", "qual o próximo passo na minha carreira?"),
    "carreira_do_time": o("beneficios", "a carreira de cada pessoa"),
    "comunicados": o("comunicados", "os comunicados"),
    "aniversarios": o("comunicados", "os aniversariantes"),
    "tempo_de_casa": o("comunicados", "quem faz tempo de casa"),
    "eventos": o("comunicados", "os eventos da empresa"),
    "calendario": o("comunicados", "o calendário da empresa", "o que tem no calendário da empresa este mês?"),
    "notificacoes": o("comunicados", "as suas notificações"),
    "meu_perfil": o("empresa", "o seu perfil", "qual a minha data de admissão?"),
    "pessoas": o("empresa", "quem é quem na empresa"),
    "colaboradores": o("empresa", "os colaboradores, com papel e desligamento"),
    "departamentos": o("empresa", "os departamentos"),
    "empresa": o("empresa", "a apresentação da empresa"),
    "regras_internas": o("empresa", "as regras internas", "o que dizem as regras internas sobre home office?"),
    "cultura": o("empresa", "missão, visão e valores"),
    "meus_documentos": o("empresa", "os documentos do RH para você"),
    "relatorio_colaboradores": o("empresa", "o relatório de colaboradores"),
    "meu_onboarding": o("empresa", "o seu checklist de integração"),
    "onboarding_do_time": o("empresa", "a integração de cada pessoa"),
    "modelos_de_onboarding": o("empresa", "os modelos de integração"),
    "tabela_salarial": o("salario", "a tabela salarial", "mostra a tabela salarial de analista",
                         requer=_REF_SAL),
    "posicionamento_salarial": o("salario", "onde cada pessoa está na tabela", requer=_REF_SAL),
}
_TALENTHS_FAZ = {
    "pedir_ausencia": o("ausencias", "pedir folga, férias ou ausência"),
    "cancelar_ausencia": o("ausencias", "cancelar um pedido pendente"),
    "aprovar_ausencia": o("ausencias", "aprovar pedidos pendentes"),
    "recusar_ausencia": o("ausencias", "recusar pedidos pendentes"),
    "ajustar_ponto": o("ponto", "pedir ajuste de uma batida"),
    "lancar_batida": o("ponto", "lançar uma batida esquecida"),
    "aprovar_ajuste_ponto": o("ponto", "aprovar ajustes de ponto"),
    "recusar_ajuste_ponto": o("ponto", "recusar ajustes de ponto"),
    "confirmar_batida": o("ponto", "confirmar batidas lançadas à mão"),
    "recusar_batida": o("ponto", "recusar batidas lançadas à mão"),
    "lancar_realizado_meta": o("metas", "lançar o realizado do mês"),
    "comentar_meta": o("metas", "comentar uma meta"),
    "criar_pdi": o("metas", "montar o PDI de alguém"),
    "editar_pdi": o("metas", "mudar ou fechar um PDI"),
    "acrescentar_acao_pdi": o("metas", "acrescentar ações a um PDI"),
    "atualizar_acao_pdi": o("metas", "atualizar ações do PDI"),
    "responder_feedback": o("avaliacao", "responder um pedido de feedback"),
    "pedir_feedback": o("avaliacao", "abrir um pedido de feedback"),
    "inscrever_workshop": o("cursos", "se inscrever num workshop"),
    "sair_do_workshop": o("cursos", "sair de um workshop"),
    "registrar_curso": o("cursos", "registrar um curso concluído"),
    "criar_comunicado": o("comunicados", "escrever um comunicado"),
    "editar_comunicado": o("comunicados", "mudar um comunicado"),
    "criar_evento": o("comunicados", "pôr um evento no calendário"),
    "editar_evento": o("comunicados", "mudar um evento"),
    "concluir_tarefa_onboarding": o("empresa", "marcar tarefas da sua integração"),
    "atribuir_onboarding": o("empresa", "abrir a integração de alguém"),
}

# ── DataCore ──────────────────────────────────────────────────────────────────
_DATACORE = (
    A("vendas", "Vendas e faturamento", "trending-up", "emerald"),
    A("notas", "Notas fiscais", "file-text", "sky"),
    A("financeiro", "Contas a receber e a pagar", "landmark", "teal"),
    A("inadimplencia", "Inadimplência", "alert-triangle", "rose"),
    A("clientes", "Clientes", "users", "indigo"),
    A("estoque", "Estoque", "package", "amber"),
    A("compras", "Compras", "shopping-cart", "violet"),
)
_DATACORE_VE = {
    "faturamento_filtros": INTERNO,
    "faturamento_resumo": o("vendas", "o resumo comercial do período"),
    "faturamento_mensal": o("vendas", "o faturamento mês a mês"),
    "vendas": o("vendas", "as vendas do período"),
    "observacoes_da_venda": o("vendas", "as observações de cada venda"),
    "servicos": o("vendas", "as notas de serviço do período"),
    "servicos_resumo": o("vendas", "o resumo dos serviços"),
    "centro_de_custo": o("vendas", "o resultado por produto"),
    "notas_fiscais": o("notas", "as notas fiscais", "quais notas saíram para a Vale este mês?"),
    "notas_de_venda": o("notas", "as notas de venda"),
    "notas_de_locacao": o("notas", "as notas de locação"),
    "notas_de_servico": o("notas", "as notas de serviço"),
    "itens_de_nota": o("notas", "os itens de cada nota"),
    "item_de_nota": o("notas", "os itens de cada nota"),
    "contas_receber_resumo": o("financeiro", "o resumo do contas a receber"),
    "contas_receber": o("financeiro", "os títulos a receber"),
    "contas_pagar_resumo": o("financeiro", "o resumo do contas a pagar"),
    "contas_pagar": o("financeiro", "os títulos a pagar"),
    "inadimplencia_resumo": o("inadimplencia", "os totais e as faixas de atraso"),
    "inadimplencia_indicadores": o("inadimplencia", "a taxa mês a mês"),
    "inadimplencia_empresas": o("inadimplencia", "as empresas em atraso"),
    "inadimplencia_empresa": o("inadimplencia", "os títulos de cada empresa"),
    "inadimplencia_titulos": o("inadimplencia", "os títulos de cada empresa"),
    "clientes": o("clientes", "procurar clientes por nome ou CNPJ"),
    "cliente": o("clientes", "a ficha de cada cliente"),
    "estoque": o("estoque", "os produtos em estoque, com quantidade e preço"),
    "produto_no_estoque": o("estoque", "os produtos em estoque, com quantidade e preço"),
    "notas_de_entrada_resumo": o("compras", "o resumo das compras", "quanto compramos este mês?"),
    "notas_de_entrada": o("compras", "as notas de entrada"),
    "itens_da_nota_de_entrada": o("compras", "os itens de cada compra"),
}

# ── DocsHS ────────────────────────────────────────────────────────────────────
_DOCSHS = (
    A("pendencias", "Minhas pendências", "list-todo", "amber"),
    A("documentos", "Documentos", "file-text", "sky"),
    A("leituras", "Leituras", "book-open", "emerald"),
    A("treinamentos", "Treinamentos", "graduation-cap", "violet"),
)
_DOCSHS_VE = {
    "eu": INTERNO,
    "setores": INTERNO,
    "tipos_de_documento": INTERNO,
    "minhas_pendencias": o("pendencias", "o que você tem para fazer: leituras, treinamentos, assinaturas"),
    "painel": o("pendencias", "o painel do DocsHS"),
    "documentos": o("documentos", "a Lista Mestra: procurar por código ou título"),
    "documento": o("documentos", "a revisão vigente e o vencimento"),
    "revisoes_do_documento": o("documentos", "as revisões de cada documento"),
    "normas": o("documentos", "as normas cadastradas"),
    "verificacoes": o("documentos", "os documentos de fora do sistema"),
    "minhas_leituras": o("leituras", "as suas leituras pendentes"),
    "leituras_por_pessoa": o("leituras", "as leituras de cada pessoa"),
    "leituras_de_uma_pessoa": o("leituras", "as leituras de cada pessoa"),
    "leituras_da_revisao": o("leituras", "quem já leu cada revisão"),
    "meus_treinamentos": o("treinamentos", "o seu histórico de treinamentos"),
    "treinamentos": o("treinamentos", "os treinamentos"),
    "treinamento": o("treinamentos", "a ficha de cada treinamento"),
    "controle_de_treinamentos": o("treinamentos", "o controle de treinamentos encerrados"),
    "plano_de_treinamento": o("treinamentos", "o plano anual de treinamento"),
}

# ── GestorHS ──────────────────────────────────────────────────────────────────
_GESTORHS = (
    A("frota", "Frota de aparelhos", "gauge", "sky"),
    A("expedicao", "Expedição e caixas", "truck", "amber"),
    A("os", "Ordens de serviço", "clipboard-list", "teal"),
    A("laboratorio", "Laboratório e certificados", "flask", "violet"),
    A("propostas", "Propostas", "receipt", "emerald"),
    A("clientes", "Clientes", "users", "indigo"),
)
_CATALOGO_GH = ("servicos", "produtos")
_GESTORHS_VE = {
    "modelos": INTERNO,
    "fases": INTERNO,
    "servicos": INTERNO,
    "produtos": INTERNO,
    "aparelhos": o("frota", "os aparelhos dos clientes e o vencimento"),
    "aparelho": o("frota", "a ficha de cada aparelho"),
    "historico_do_aparelho": o("frota", "o histórico de cada aparelho"),
    "os_do_aparelho": o("frota", "as OS de cada aparelho"),
    "aparelhos_por_modelo": o("frota", "quantos aparelhos há por modelo"),
    "caixas": o("expedicao", "as caixas e a fase de cada uma"),
    "caixa": o("expedicao", "os aparelhos de cada caixa"),
    "ordens": o("os", "as OS"),
    "ordem": o("os", "a fase e a caixa de cada OS"),
    "certificados_da_ordem": o("laboratorio", "os certificados de cada OS"),
    "certificados_do_aparelho": o("laboratorio", "os certificados de cada aparelho"),
    "propostas": o("propostas", "as propostas"),
    "proposta": o("propostas", "o valor e a situação de cada proposta"),
    "versoes_da_proposta": o("propostas", "as versões de cada proposta"),
    "clientes": o("clientes", "procurar clientes"),
    "cliente": o("clientes", "a ficha de cada cliente"),
}
_GESTORHS_FAZ = {
    "cadastrar_aparelho": o("frota", "cadastrar um aparelho na frota de um cliente"),
    "receber": o("expedicao", "receber aparelhos (abre as OS)"),
    "avancar_caixa": o("expedicao", "avançar uma caixa de fase"),
    "fechar_caixa": o("expedicao", "finalizar uma caixa com o rastreio"),
    "gerar_certificado": o("laboratorio", "gerar o certificado de calibração"),
    # O preparo confere cada item contra o catálogo de serviços e produtos.
    "criar_proposta": o("propostas", "montar uma proposta", requer=_CATALOGO_GH),
    "alterar_proposta": o("propostas", "alterar uma proposta", requer=_CATALOGO_GH),
}

# ── HSGrowth — Vendas ─────────────────────────────────────────────────────────
_HSGROWTH = (
    A("negocios", "Meus negócios", "briefcase", "sky"),
    A("tarefas", "Tarefas e reuniões", "calendar-clock", "amber"),
    A("clientes", "Clientes e contatos", "users", "indigo"),
)
_HSGROWTH_VE = {
    "quadros": INTERNO,
    "etapas": INTERNO,
    "campos": INTERNO,
    # `meus_cards` exige o `board_id`, que sai da lista de quadros.
    "meus_cards": o("negocios", "os seus cards em cada funil", requer=("quadros",)),
    "card": o("negocios", "cliente, contato, valor e etapa de cada card"),
    "buscar": o("negocios", "procurar qualquer card"),
    "notas": o("negocios", "as anotações de cada card"),
    "parceiros_do_card": o("negocios", "se o cliente está com algum parceiro"),
    "minhas_tarefas": o("tarefas", "as suas tarefas"),
    "tarefas_atrasadas": o("tarefas", "as tarefas atrasadas"),
    "clientes": o("clientes", "os clientes"),
    "cliente": o("clientes", "a ficha de cada cliente"),
    "contatos": o("clientes", "os contatos"),
    "receita": o("clientes", "os dados da Receita pelo CNPJ"),
}
_HSGROWTH_FAZ = {
    "hsgrowth_registrar": o("negocios", "registrar o pós-ligação: nota, tarefas, etapa"),
    "hsgrowth_criar_lead": o("negocios", "criar um lead novo"),
    "hsgrowth_ganhar": o("negocios", "marcar um card como ganho", "marca o card da Ambev como ganho"),
    "hsgrowth_perder": o("negocios", "marcar um card como perdido"),
    "hsgrowth_noshow": o("tarefas", "marcar no-show numa reunião"),
    "hsgrowth_cliente": o("clientes", "completar o cliente e o contato de um card seu"),
}

# ── HSGrowth — Serviços ───────────────────────────────────────────────────────
_HSGROWTH_SERVICOS = (
    A("cards", "Cards de Serviços", "wrench", "teal"),
    A("acompanhamento", "Pendências e painel", "layout-dashboard", "amber"),
    A("clientes", "Clientes e contatos", "users", "indigo"),
)
_CATALOGO_SV = ("catalogo_aparelhos", "catalogo_servicos")
_HSGROWTH_SERVICOS_VE = {
    "quadros": INTERNO,
    "etapas": INTERNO,
    "catalogo_aparelhos": INTERNO,
    "catalogo_servicos": INTERNO,
    "cards": o("cards", "os cards de Serviços e de Cobrança"),
    "card": o("cards", "os dados, aparelhos e serviços de cada card"),
    "atividades": o("cards", "as atividades e anotações de cada card"),
    "buscar": o("cards", "procurar card por cliente, CNPJ ou série"),
    "pendencias": o("acompanhamento", "as atividades pendentes"),
    "painel": o("acompanhamento", "o painel: parados, ganhos, perdas, funil"),
    "clientes": o("clientes", "os clientes"),
    "contatos": o("clientes", "os contatos", "quem é o contato da Vale?"),
}
_HSGROWTH_SERVICOS_FAZ = {
    "hsgrowth_servicos_registrar": o("cards", "registrar o pós-contato: dados, atividades, etapa"),
    # Aparelho e serviço novo só entram se existirem no catálogo.
    "hsgrowth_servicos_itens": o("cards", "pôr ou tirar aparelhos e serviços", requer=_CATALOGO_SV),
    "hsgrowth_servicos_ganhar": o("cards", "marcar um card como ganho"),
    "hsgrowth_servicos_perder": o("cards", "marcar um card como perdido"),
    "hsgrowth_servicos_anexar_proposta": o("cards", "anexar a proposta do GestorHS"),
}

# ── juntando ──────────────────────────────────────────────────────────────────

ASSUNTOS: dict[str, tuple[Assunto, ...]] = {
    "taskhs": _TASKHS, "talenths": _TALENTHS, "docshs": _DOCSHS, "gestorhs": _GESTORHS,
    "hsgrowth": _HSGROWTH, "hsgrowth_servicos": _HSGROWTH_SERVICOS, "datacore": _DATACORE,
}
# sistema → chave do item no catálogo → Onde | INTERNO
VE: dict[str, dict[str, Onde | str]] = {
    "taskhs": _TASKHS_VE, "talenths": _TALENTHS_VE, "docshs": _DOCSHS_VE, "gestorhs": _GESTORHS_VE,
    "hsgrowth": _HSGROWTH_VE, "hsgrowth_servicos": _HSGROWTH_SERVICOS_VE, "datacore": _DATACORE_VE,
}
FAZ: dict[str, dict[str, Onde | str]] = {
    "taskhs": _TASKHS_FAZ, "talenths": _TALENTHS_FAZ, "docshs": {}, "gestorhs": _GESTORHS_FAZ,
    "hsgrowth": _HSGROWTH_FAZ, "hsgrowth_servicos": _HSGROWTH_SERVICOS_FAZ, "datacore": {},
}

# ── o que é do próprio HS.OS ──────────────────────────────────────────────────

HSOS = (
    A("memoria", "Memória", "brain", "violet"),
    A("lembretes", "Lembretes", "bell", "amber"),
    A("email", "E-mail", "inbox", "sky"),
    A("outlook", "Agenda do Outlook", "calendar-days", "teal"),
)
HSOS_VE: dict[str, Onde] = {
    "memoria": o("memoria", "o que você pediu para ele lembrar", "o que você lembra sobre mim?"),
    "lembretes": o("lembretes", "os seus lembretes", "quais lembretes eu tenho?"),
    "caixas": o("email", "as suas caixas de e-mail", "de quais caixas você lê?"),
    "emails": o("email", "os seus e-mails", "quais e-mails não lidos eu tenho?"),
    "preparados": o("email", "os e-mails que ele preparou"),
    "outlook": o("outlook", "os seus compromissos", "o que eu tenho amanhã na agenda?"),
}
HSOS_FAZ: dict[str, Onde] = {
    "lembrar": o("memoria", "guardar uma preferência ou um jeito de fazer",
                 "lembra que eu assino como Erick | TI", na_hora=True),
    "agenda_criar": o("lembretes", "criar lembretes, únicos ou de rotina",
                      "me lembra amanhã às 9h de ligar para a Vale", na_hora=True),
    "agenda_mudar": o("lembretes", "mudar ou apagar um lembrete", na_hora=True),
    "preparar": o("email", "preparar e-mails para outras pessoas",
                  "responde ao João dizendo que enviamos na sexta"),
    "para_si": o("email", "mandar um e-mail para você mesmo", "me manda esse resumo por e-mail", na_hora=True),
    "marcar_lidos": o("email", "marcar e-mails como lidos", na_hora=True),
}
