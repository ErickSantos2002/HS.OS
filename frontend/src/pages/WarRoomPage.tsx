/**
 * War room — o painel de parede, para uma TV do escritório.
 *
 * ⚠️ **Não é a tela original restaurada.** A de `_legado/warroom/` tem 990
 * linhas e foi escrita para dados que este sistema não produz: metade dela é
 * layout arrastável, watchdog de sessão e frases de rotina, alimentadas por
 * tabelas medidas em zero linha em 01/09/2026. Esta lê o que a HS de fato
 * gera — briefings publicados, conversas, consumo e o estado dos agentes.
 *
 * ⚠️ **Polling, não realtime, e de propósito.** O `/ws` exige JWT de usuário
 * (`routers/ws.py`) e a TV não faz login — ela nunca conectaria. Para um
 * display sem operador, uma busca a cada 15s também falha melhor: uma conexão
 * que cai e não volta deixa a parede congelada mostrando ontem, sem avisar.
 *
 * Roda fora do `AppLayout`: sem menu, sem navegação. É para olhar, não usar.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { api } from "@/lib/api";

const INTERVALO_MS = 15_000;

// `online` é tri-estado: ligado, parado, ou desconhecido (nunca rodou).
interface Agente { agente: string; online: boolean | null; ocupacao: number | null }
interface Publicado { hora: string | null; agente: string; titulo: string }
interface Fala { de: string; para: string; texto: string; hora: string | null }
interface Consumo { tokens: number; custo: number }
interface Feed {
  agentes: Agente[];
  publicado: Publicado[];
  agora: Fala[];
  consumo: Consumo;
}

const horaAgora = () =>
  new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit", minute: "2-digit", timeZone: "America/Recife",
  });

export default function WarRoomPage() {
  const [params] = useSearchParams();
  const token = params.get("t");

  const [feed, setFeed] = useState<Feed | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizado, setAtualizado] = useState<string | null>(null);
  const [relogio, setRelogio] = useState(horaAgora);

  useEffect(() => {
    const id = setInterval(() => setRelogio(horaAgora()), 20_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let vivo = true;
    const buscar = async () => {
      try {
        const dados = await api<Feed>(
          `/warroom/feed${token ? `?t=${encodeURIComponent(token)}` : ""}`,
        );
        if (!vivo) return;
        setFeed(dados);
        setErro(null);
        setAtualizado(horaAgora());
      } catch (e) {
        // Mantém o último feed na tela e marca que envelheceu: parede em branco
        // não diz nada, parede com "desde 09:14" diz que algo parou.
        if (vivo) setErro(e instanceof Error ? e.message : "Sem resposta do servidor.");
      }
    };
    void buscar();
    const id = setInterval(buscar, INTERVALO_MS);
    return () => { vivo = false; clearInterval(id); };
  }, [token]);

  if (!feed && erro) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-8 text-center">
        <div>
          <p className="text-2xl font-semibold text-foreground">Painel indisponível</p>
          <p className="mt-2 text-base text-muted-foreground">{erro}</p>
          <p className="mt-6 text-sm text-muted-foreground">
            A TV entra por <code>/warroom?t=&lt;token&gt;</code>. Sem token, é
            preciso estar logado.
          </p>
        </div>
      </div>
    );
  }

  if (!feed) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-xl text-muted-foreground">Carregando o painel…</p>
      </div>
    );
  }

  const desatualizado = erro !== null;

  return (
    <div className="flex h-screen flex-col gap-6 overflow-hidden bg-background p-8">
      <header className="flex items-baseline justify-between border-b border-border pb-4">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          HS.OS <span className="text-muted-foreground">· War room</span>
        </h1>
        <div className="text-right">
          <p className="font-mono text-3xl text-foreground">{relogio}</p>
          {desatualizado && atualizado && (
            <p className="text-sm text-amber-500">sem atualizar desde {atualizado}</p>
          )}
        </div>
      </header>

      <section className="flex flex-wrap gap-8">
        {feed.agentes.map((a) => (
          <div key={a.agente} className="min-w-32">
            <p className="flex items-center gap-2 text-2xl font-medium uppercase text-foreground">
              {/* Três estados: ● trabalhando, ○ parado, · nunca rodou. Agente
                  que nunca rodou não é agente parado, e a parede não deve
                  afirmar que está fora. */}
              <span className={a.online ? "text-emerald-500" : "text-muted-foreground"}>
                {a.online === null ? "·" : a.online ? "●" : "○"}
              </span>
              {a.agente}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {/* `—` e não `0%`: sem a janela conhecida ninguém mediu a ocupação. */}
              {a.ocupacao === null ? "contexto —" : `contexto ${a.ocupacao}%`}
            </p>
          </div>
        ))}
      </section>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-8">
        <section className="flex min-h-0 flex-col">
          <h2 className="mb-3 text-sm uppercase tracking-widest text-muted-foreground">
            Publicado hoje
          </h2>
          {feed.publicado.length === 0 ? (
            <p className="text-lg text-muted-foreground">nada publicado ainda</p>
          ) : (
            <ul className="space-y-2 overflow-hidden">
              {feed.publicado.map((p, i) => (
                <li key={i} className="flex gap-4 text-xl text-foreground">
                  <span className="font-mono text-muted-foreground">{p.hora}</span>
                  <span className="uppercase text-muted-foreground">{p.agente}</span>
                  <span className="truncate">{p.titulo}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex min-h-0 flex-col">
          <h2 className="mb-3 text-sm uppercase tracking-widest text-muted-foreground">
            Agora
          </h2>
          <ul className="space-y-3 overflow-hidden">
            {feed.agora.map((f, i) => (
              <li key={i} className="text-lg leading-snug text-foreground">
                <span className="text-muted-foreground">
                  {f.de} → {f.para}:{" "}
                </span>
                {f.texto}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="border-t border-border pt-4 text-lg text-muted-foreground">
        hoje: {feed.consumo.tokens.toLocaleString("pt-BR")} tokens ·{" "}
        {feed.consumo.custo.toLocaleString("pt-BR", {
          style: "currency", currency: "USD",
        })}
      </footer>
    </div>
  );
}
