/**
 * A raiz do app do celular: Conversas · Atividade · Eu (spec 2026-11-03,
 * itens 1, 8 e 9), com as abas de baixo.
 */
import { useMemo, useState } from "react";
import {
  AtSign, BellOff, Bell, CheckCheck, ChevronRight, Library, LogOut, MessageCircle, Search, Smartphone, User, AudioLines,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { InstalarApp } from "@/components/InstalarApp";
import { useNotificationsContext } from "@/components/NotificationsProvider";
import { useAuthContext } from "@/contexts/auth-context";
import { useAgents } from "@/hooks/use-agents";
import { useResumoEmAudio } from "@/hooks/use-resumo-em-audio";
import { findOrCreateDm, usePeople } from "@/hooks/use-people";
import { getPermission, isEnabled } from "@/lib/browser-notifications";
import { desligarNotificacoesDoAparelho, ligarNotificacoesDoAparelho } from "@/lib/notificacoes-do-aparelho";
import { classificarAtividade, nomeDoAutor, textoDaAtividade, type TipoAtividade } from "./atividade";
import { horaDaLista, linhaDaPrevia, montarLista, type ItemCelular, type TipoItem } from "./lista";
import type { Aba, Tela } from "./pilha";
import { Avatar } from "./ui";
import { useListaDoCelular } from "./use-lista";

interface Props {
  aba: Aba;
  aoTrocarAba: (aba: Aba) => void;
  aoAbrir: (tela: Tela) => void;
}

export function TelaInicio({ aba, aoTrocarAba, aoAbrir }: Props) {
  const { itens } = useListaDoCelular();
  const { notifications } = useNotificationsContext();
  const { profile } = useAuthContext();
  const meuNome = profile?.full_name ?? "";
  const conversasComNovidade = itens.filter((i) => i.naoLidas > 0 && !i.silenciado).length;
  const atividadesNovas = notifications.filter((n) => !n.read && classificarAtividade(n, meuNome)).length;

  return (
    <>
      {aba === "conversas" && <ListaDeConversas itens={itens} aoAbrir={aoAbrir} />}
      {aba === "atividade" && <Atividade aoAbrir={aoAbrir} />}
      {aba === "eu" && <Eu aoAbrir={aoAbrir} />}
      <nav className="cel-abas" aria-label="Navegação">
        <BotaoDeAba atual={aba} id="conversas" rotulo="Conversas" icone={<MessageCircle />} n={conversasComNovidade} aoTrocar={aoTrocarAba} />
        <BotaoDeAba atual={aba} id="atividade" rotulo="Atividade" icone={<AtSign />} n={atividadesNovas} aoTrocar={aoTrocarAba} />
        <BotaoDeAba atual={aba} id="eu" rotulo="Eu" icone={<User />} n={0} aoTrocar={aoTrocarAba} />
      </nav>
    </>
  );
}

function BotaoDeAba({ atual, id, rotulo, icone, n, aoTrocar }: { atual: Aba; id: Aba; rotulo: string; icone: React.ReactNode; n: number; aoTrocar: (a: Aba) => void }) {
  return (
    <button type="button" className="cel-aba" aria-current={atual === id ? "page" : undefined} onClick={() => aoTrocar(id)}>
      <span className="cel-pilula">{icone}</span>{rotulo}
      {n > 0 && <span className="cel-ponto">{n > 99 ? "99+" : n}</span>}
    </button>
  );
}

const CHIPS: Array<[TipoItem, string]> = [["pessoa", "Pessoas"], ["agente", "Agentes"], ["canal", "Canais"]];

function ListaDeConversas({ itens, aoAbrir }: { itens: ItemCelular[]; aoAbrir: (t: Tela) => void }) {
  const { user } = useAuthContext();
  // O chip escolhido sobrevive a sair e voltar (é o que a pessoa espera de
  // um app); abre em Pessoas na primeira vez.
  const [filtro, setFiltro] = useState<TipoItem>(() => {
    try { return (sessionStorage.getItem("celular:chip") as TipoItem) || "pessoa"; } catch { return "pessoa"; }
  });
  const [busca, setBusca] = useState("");
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const lista = useMemo(() => montarLista(itens, filtro, busca), [itens, filtro, busca]);
  const agora = new Date();

  const escolher = (f: TipoItem) => {
    setFiltro(f);
    try { sessionStorage.setItem("celular:chip", f); } catch { /* sem armazenamento, sem memória */ }
  };

  const abrir = async (i: ItemCelular) => {
    if (i.tipo === "agente") return aoAbrir({ tipo: "agente", id: i.id });
    if (i.canalId) return aoAbrir({ tipo: "canal", id: i.canalId });
    // Pessoa sem conversa ainda: cria a DM, como no desktop.
    if (!user || abrindo) return;
    setAbrindo(i.id);
    try {
      const canal = await findOrCreateDm(user.id, i.id, i.nome);
      if (canal) aoAbrir({ tipo: "canal", id: canal });
      else toast.error("Não consegui abrir a conversa.");
    } finally {
      setAbrindo(null);
    }
  };

  return (
    <>
      <header className="cel-topo"><h1>HS.OS</h1></header>
      <label className="cel-busca">
        <Search className="cel-i" aria-hidden="true" />
        <input type="search" placeholder="Buscar conversas e mensagens" value={busca} onChange={(e) => setBusca(e.target.value)} autoComplete="off" />
      </label>
      <div className="cel-chips" role="group" aria-label="Filtro">
        {CHIPS.map(([k, r]) => (
          <button key={k} type="button" className="cel-chip" aria-pressed={filtro === k} onClick={() => escolher(k)}>{r}</button>
        ))}
      </div>
      <div className="cel-rolar">
        <div className="cel-cartao-instalar"><InstalarApp variante="cartao" /></div>
        {lista.length === 0 ? (
          <div className="cel-vazio">{busca.trim() ? `Nenhuma conversa com “${busca.trim()}”.` : "Nenhuma conversa aqui."}</div>
        ) : lista.map((i) => {
          const { autor, texto } = linhaDaPrevia(i);
          const nova = i.naoLidas > 0 && !i.silenciado;
          return (
            <button key={i.chave} type="button" className="cel-item" onClick={() => void abrir(i)} aria-busy={abrindo === i.id}>
              <Avatar tipo={i.tipo === "pessoal" ? "pessoa" : i.tipo} nome={i.nome} chave={i.id} foto={i.foto} />
              <span className="cel-meio">
                <span className="cel-l1">
                  <span className="cel-nome">{i.tipo === "canal" ? "#" : ""}{i.nome}</span>
                  <span className={`cel-hora${nova ? " nova" : ""}`}>{horaDaLista(i.previa?.quando ?? 0, agora)}</span>
                </span>
                <span className="cel-l2">
                  {i.pensando ? (
                    <span className="cel-prev vivo">pensando…</span>
                  ) : (
                    <span className="cel-prev">
                      {i.previa?.minha && i.tipo !== "pessoal" && <CheckCheck className="cel-mini" style={{ display: "inline", verticalAlign: "-3px", marginRight: 2 }} />}
                      {autor && <b>{autor}: </b>}
                      {texto || (i.tipo === "pessoa" && !i.canalId ? i.subtitulo : "")}
                    </span>
                  )}
                  {i.silenciado && <BellOff className="cel-mini" aria-label="Silenciada" />}
                  {i.naoLidas > 0 && <span className={`cel-badge${i.silenciado ? " mudo" : ""}`}>{i.naoLidas > 99 ? "99+" : i.naoLidas}</span>}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

const FILTROS_ATIVIDADE: Array<[TipoAtividade | "tudo", string]> = [["tudo", "Tudo"], ["mencao", "Menções"], ["thread", "Threads"], ["agente", "Agentes"]];

function Atividade({ aoAbrir }: { aoAbrir: (t: Tela) => void }) {
  const { notifications, markAsRead } = useNotificationsContext();
  const { profile } = useAuthContext();
  const { agents } = useAgents();
  const { people } = usePeople();
  const [filtro, setFiltro] = useState<TipoAtividade | "tudo">("tudo");
  const agora = new Date();
  const itens = useMemo(() => notifications
    .map((n) => ({ n, tipo: classificarAtividade(n, profile?.full_name ?? "") }))
    .filter((x): x is { n: typeof x.n; tipo: TipoAtividade } => !!x.tipo && (filtro === "tudo" || x.tipo === filtro))
    .sort((a, b) => new Date(b.n.created_at).getTime() - new Date(a.n.created_at).getTime())
    .slice(0, 80), [notifications, filtro, profile?.full_name]);

  return (
    <>
      <header className="cel-topo"><h1>Atividade</h1></header>
      <div className="cel-chips" role="group" aria-label="Filtro">
        {FILTROS_ATIVIDADE.map(([k, r]) => (
          <button key={k} type="button" className="cel-chip" aria-pressed={filtro === k} onClick={() => setFiltro(k)}>{r}</button>
        ))}
      </div>
      <div className="cel-rolar">
        {itens.length === 0 && <div className="cel-vazio">Nada por aqui ainda. Menções, respostas em thread e respostas de agente aparecem nesta aba.</div>}
        {itens.map(({ n, tipo }) => {
          const nome = nomeDoAutor(n);
          const agente = n.agent_id ? agents.find((a) => a.id === n.agent_id) : null;
          const pessoa = agente ? null : people.find((p) => p.full_name === nome);
          const frase = tipo === "agente" ? "respondeu" : tipo === "thread" ? "respondeu numa thread" : "mencionou você";
          return (
            <button
              key={n.id}
              type="button"
              className="cel-item cel-ativ"
              onClick={() => {
                if (!n.read) void markAsRead(n.id);
                if (n.agent_id) aoAbrir({ tipo: "agente", id: n.agent_id });
                else if (n.channel_id) aoAbrir({ tipo: "canal", id: n.channel_id });
              }}
            >
              <Avatar tipo={n.agent_id ? "agente" : "pessoa"} nome={agente?.name ?? nome} chave={n.agent_id ?? pessoa?.id ?? nome} foto={pessoa?.avatar_url} tam="sm" />
              <span className="cel-meio">
                <span className="cel-l1">
                  <span className="cel-nome" style={{ fontSize: 15.5 }}>{agente?.name ?? nome}</span>
                  <span className={`cel-hora${!n.read ? " nova" : ""}`}>{horaDaLista(new Date(n.created_at).getTime(), agora)}</span>
                </span>
                <span className="cel-prev">{frase}: “{textoDaAtividade(n)}”</span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

const TEMAS: Array<[string, string]> = [["system", "Sistema"], ["light", "Claro"], ["dark", "Escuro"]];

function Eu({ aoAbrir }: { aoAbrir: (t: Tela) => void }) {
  const { user, profile, role, signOut } = useAuthContext();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { ligado: resumoLigado, alterar: alterarResumo } = useResumoEmAudio();
  const [notif, setNotif] = useState(() => isEnabled() && getPermission() === "granted");
  const [ocupado, setOcupado] = useState(false);
  const nome = profile?.full_name || user?.email || "";
  const papel = role === "administrador" ? "Administrador" : "Colaborador";

  const alternarNotif = async () => {
    if (ocupado) return;
    setOcupado(true);
    try {
      if (notif) {
        await desligarNotificacoesDoAparelho();
        setNotif(false);
        toast("Notificações desligadas neste celular");
      } else {
        const r = await ligarNotificacoesDoAparelho(user?.id);
        setNotif(r.ligado);
        if (r.ligado) toast.success("Notificações ligadas neste celular");
        else if (r.permissao === "denied") toast.error("O navegador bloqueou as notificações. Libere nas configurações do aparelho.");
        else toast.error("Este navegador não mostra notificações. No iPhone, instale o app pela tela de início.");
      }
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <header className="cel-topo"><h1>Eu</h1></header>
      <div className="cel-rolar">
        <div className="cel-perfil">
          <Avatar tipo="pessoa" nome={nome} chave={user?.id ?? nome} foto={profile?.avatar_url} />
          <div style={{ minWidth: 0 }}><b>{nome}</b><span>{papel}</span></div>
        </div>
        <div className="cel-grupo">
          <h4>Notificações</h4>
          <button type="button" className="cel-op" onClick={() => void alternarNotif()} role="switch" aria-checked={notif}>
            <Bell className="cel-i" /><span className="cel-tx"><b>Notificações neste celular</b><span>Mensagens, menções e respostas de agentes</span></span>
            <span className={`cel-chave${notif ? " on" : ""}`} />
          </button>
          <button type="button" className="cel-op" onClick={() => void alterarResumo(!resumoLigado)} role="switch" aria-checked={resumoLigado}>
            <AudioLines className="cel-i" /><span className="cel-tx"><b>Resumo em áudio</b><span>O agente fala um resumo embaixo de cada resposta</span></span>
            <span className={`cel-chave${resumoLigado ? " on" : ""}`} />
          </button>
          <button type="button" className="cel-op" onClick={() => aoAbrir({ tipo: "painel", painel: "silenciados" })}>
            <BellOff className="cel-i" /><span className="cel-tx"><b>Conversas silenciadas</b><span>Sem notificação, a não ser que mencionem você</span></span>
            <ChevronRight className="cel-i" />
          </button>
        </div>
        <div className="cel-grupo">
          <h4>Aparência</h4>
          <div className="cel-op coluna">
            <span className="cel-tx"><b>Tema</b></span>
            <div className="cel-seg" role="group" aria-label="Tema">
              {TEMAS.map(([k, r]) => (
                <button key={k} type="button" aria-pressed={(theme ?? "dark") === k} onClick={() => setTheme(k)}>{r}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="cel-grupo">
          <h4>App</h4>
          <div style={{ padding: "4px 16px" }}><InstalarApp variante="entrada" /></div>
          <button type="button" className="cel-op" onClick={() => navigate("/base-de-conhecimento")}>
            <Library className="cel-i" /><span className="cel-tx"><b>Documentos</b><span>Base de conhecimento e arquivos gerados pelos agentes</span></span>
            <ChevronRight className="cel-i" />
          </button>
          <button type="button" className="cel-op" onClick={() => navigate("/settings?tab=profile")}>
            <Smartphone className="cel-i" /><span className="cel-tx"><b>Configurações</b><span>Perfil, foto e o restante do sistema</span></span>
            <ChevronRight className="cel-i" />
          </button>
          <button type="button" className="cel-op perigo" onClick={async () => { await signOut(); navigate("/login"); }}>
            <LogOut className="cel-i" /><span className="cel-tx"><b>Sair</b><span>Este celular para de receber notificações</span></span>
          </button>
        </div>
      </div>
    </>
  );
}
