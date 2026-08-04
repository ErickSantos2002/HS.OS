import { useEffect, useState } from "react";
import {
  Rocket,
  Server,
  Terminal,
  ClipboardCheck,
  Copy,
  Check,
  AlertTriangle,
  ExternalLink,
  ArrowRight,
  ClipboardList,
} from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Primeira etapa do assistente: prepara a VPS.
 *
 * Reescrito em sub-etapas depois do primeiro remix real. A versão anterior
 * empilhava os quatro passos numa lista única — quem já sabia o caminho lia
 * rápido, mas quem nunca contratou um servidor tinha as quatro decisões na
 * frente ao mesmo tempo e não sabia onde estava. Agora é uma sub-aba por passo:
 * a tela mostra uma coisa de cada vez, com print de onde clicar, e só avança
 * quando a pessoa confirma que fez.
 *
 * O comando é montado com a URL desta própria instalação, então não há nada
 * para o usuário editar — errar a URL era um ponto de falha real.
 */

/** Link de contratação com o cupom da dn.ia (20% de desconto). */
const HOSTINGER_URL = "https://www.hostinger.com/br?REFERRALCODE=cupomdnia";

const STORAGE_KEY = "dnos-prep-substep";

/**
 * Domínio efêmero do editor do Lovable (`id-preview--<uuid>.lovable.app` e
 * variantes com `--preview`). Quem abre o assistente de dentro do editor recebe
 * esse endereço em window.location.origin — e o comando montado com ele manda a
 * VPS baixar o instalador de um host que pode sumir ou exigir sessão. O erro é
 * silencioso: o curl falha lá no servidor, longe daqui.
 */
function isPreviewOrigin(host: string): boolean {
  return /(^|\.)id-preview--/.test(host) || /--preview\./.test(host);
}

/**
 * Print de apoio. Some sozinho se o arquivo não estiver publicado, em vez de
 * deixar um ícone de imagem quebrada no meio da instrução.
 */
function Figure({ src, alt, caption }: { src: string; alt: string; caption?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <figure className="space-y-1.5">
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onError={() => setFailed(true)}
        className="w-full rounded-lg border border-border bg-secondary/20"
      />
      {caption ? (
        <figcaption className="text-[11px] text-muted-foreground text-center">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

const SUBSTEPS = [
  { key: 0, tab: "Servidor", title: "A casa dos super agentes", icon: Rocket },
  { key: 1, tab: "Terminal", title: "Abra o terminal do servidor", icon: Terminal },
  { key: 2, tab: "Instalar", title: "Cole o comando e aguarde", icon: ClipboardCheck },
  { key: 3, tab: "Bloco final", title: "Copie o bloco final", icon: ClipboardList },
] as const;

interface Step0PrepGatewayProps {
  /** Chamado quando a última sub-etapa é concluída — avança o assistente. */
  onComplete?: () => void;
}

export function Step0PrepGateway({ onComplete }: Step0PrepGatewayProps) {
  const [copied, setCopied] = useState(false);
  const [active, setActive] = useState(0);
  const [done, setDone] = useState<number[]>([]);

  // O passo 3 pede para sair da tela e ir mexer no servidor. Voltar e encontrar
  // tudo zerado faria a pessoa refazer o que já fez.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { active?: number; done?: number[] };
      if (Array.isArray(saved.done)) setDone(saved.done);
      if (typeof saved.active === "number") setActive(saved.active);
    } catch {
      /* estado de conveniência — se não der para ler, começa do zero */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ active, done }));
    } catch {
      /* ignore */
    }
  }, [active, done]);

  const origin = window.location.origin;
  const onPreview = isPreviewOrigin(window.location.hostname);
  // O endereço vai também como argumento: o instalador precisa dele para baixar
  // as skills, e `curl | bash` não tem como descobrir de onde veio. O `-s --`
  // repassa o que vem depois para o script.
  const installCommand = `curl -sL ${origin}/setup.sh | bash -s -- ${origin}`;

  async function handleCopy() {
    const ok = await copyToClipboard(installCommand);
    if (!ok) {
      toast({
        title: "Não foi possível copiar",
        description: "Selecione o comando e copie manualmente.",
        variant: "destructive",
      });
      return;
    }
    setCopied(true);
    toast({ title: "Comando copiado" });
    setTimeout(() => setCopied(false), 2000);
  }

  function concluir() {
    setDone((prev) => (prev.includes(active) ? prev : [...prev, active]));
    if (active < SUBSTEPS.length - 1) {
      setActive(active + 1);
      return;
    }
    onComplete?.();
  }

  const isLast = active === SUBSTEPS.length - 1;

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Server className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-display font-semibold">Preparar o servidor</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Seus agentes rodam em um servidor seu. São quatro passos — o instalador
          cuida de toda a parte técnica.
        </p>
      </div>

      {/* Aviso do Publish. Fica no topo porque é contraintuitivo: o projeto já
          aparece na tela do Lovable, e não é óbvio que sem publicar não existe
          URL pública — e sem URL o comando de instalação não funciona. */}
      <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3">
        <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <p className="font-semibold text-foreground">Publique antes de continuar</p>
          <p className="text-muted-foreground">
            Se ainda não publicou esta dn.os em sua conta Lovable (botão azul{" "}
            <span className="font-semibold">Publicar</span>), faça isso primeiro. O comando
            do passo 3 (Instalar) depende deste endereço público.
          </p>
        </div>
      </div>

      {/* Sub-abas. Passos já concluídos continuam clicáveis: a pessoa pode
          voltar para reler o print sem perder o progresso. */}
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-secondary/30 p-1.5">
        {SUBSTEPS.map((s, i) => {
          const Icon = s.icon;
          const isDone = done.includes(i);
          const isActive = i === active;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setActive(i)}
              className={cn(
                "flex-1 min-w-[7rem] inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : isDone
                    ? "text-foreground hover:bg-secondary/60"
                    : "text-muted-foreground hover:bg-secondary/60",
              )}
            >
              {isDone && !isActive ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Icon className="h-3.5 w-3.5" />
              )}
              <span>
                {i + 1}. {s.tab}
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-border bg-card/40 p-5 md:p-6 space-y-4">
        <h3 className="text-base font-display font-semibold">{SUBSTEPS[active].title}</h3>

        <div className="space-y-4 text-sm text-muted-foreground">
          {active === 0 ? (
            <>
              <p>
                Seus super agentes precisam de um computador que fique ligado o tempo todo,
                mesmo com o seu desligado. É isso que um <strong>VPS</strong> é: um servidor
                só seu, alugado por mês.
              </p>

              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
                <p className="text-foreground text-sm">
                  Contrate pelo link abaixo — ele já aplica o cupom da dn.ia com{" "}
                  <strong>20% de desconto</strong>.
                </p>
                <a href={HOSTINGER_URL} target="_blank" rel="noopener noreferrer">
                  <Button type="button" className="w-full sm:w-auto">
                    Contratar na Hostinger
                    <ExternalLink className="h-4 w-4 ml-1.5" />
                  </Button>
                </a>
              </div>

              <p>
                Escolha o plano <strong className="text-foreground">KVM 2</strong> — 2 núcleos
                de vCPU e 8 GB de memória. É o menor plano que roda o time inteiro com folga.
              </p>

              <Figure
                src="/setup-hostinger-planos.png"
                alt="Planos KVM da Hostinger, com o KVM 2 destacado"
                caption="Escolha o KVM 2 — o segundo da esquerda para a direita."
              />

              <p>
                Quando o painel perguntar o sistema operacional, escolha{" "}
                <strong className="text-foreground">Ubuntu 22.04</strong> ou superior.
              </p>

              <div className="rounded-lg border border-border bg-secondary/30 p-3 text-xs">
                <p className="text-foreground font-medium mb-1">Guarde estes dois dados</p>
                <p>
                  Ao final da contratação a Hostinger mostra (e manda por e-mail) o{" "}
                  <strong className="text-foreground">endereço IP</strong> do servidor e a{" "}
                  <strong className="text-foreground">senha de root</strong>. Você vai precisar
                  dos dois no próximo passo.
                </p>
              </div>
            </>
          ) : null}

          {active === 1 ? (
            <>
              <p>
                O terminal é a janela onde você digita comandos no servidor. A Hostinger tem
                um embutido no painel — é o caminho mais simples, não precisa instalar nada
                no seu computador.
              </p>

              <p>
                No painel do seu VPS, na tela <strong className="text-foreground">Visão geral</strong>,
                o botão <strong className="text-foreground">Terminal</strong> fica no canto
                superior direito.
              </p>

              <Figure
                src="/setup-hostinger-terminal.png"
                alt="Painel da Hostinger com o botão Terminal destacado no canto superior direito"
                caption="O botão Terminal, no canto superior direito da Visão geral."
              />

              <p>
                Ele abre uma janela preta com um cursor piscando. É ali que o comando do
                próximo passo vai ser colado. Se pedir senha, use a{" "}
                <strong className="text-foreground">senha de root</strong> que você guardou.
              </p>

              <div className="rounded-lg border border-border bg-secondary/30 p-3 text-xs space-y-1">
                <p className="text-foreground font-medium">Prefere usar seu próprio terminal?</p>
                <p>
                  Funciona igual. Conecte com{" "}
                  <code className="rounded bg-secondary/60 px-1.5 py-0.5">ssh root@SEU_IP</code>{" "}
                  e informe a senha de root.
                </p>
              </div>
            </>
          ) : null}

          {active === 2 ? (
            <>
              <p>
                Este é o único comando que você precisa rodar. Ele instala tudo, configura o
                servidor, cria a orquestradora e prepara o time.
              </p>

              <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    <Terminal className="h-3 w-3" />
                    terminal do servidor
                  </span>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-secondary/60 transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3 w-3 text-success" /> Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" /> Copiar
                      </>
                    )}
                  </button>
                </div>
                <pre className="overflow-x-auto text-[11px] font-mono text-foreground">
                  {installCommand}
                </pre>
              </div>

              {onPreview && (
                <div className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
                  <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <div className="text-xs space-y-1">
                    <p className="font-semibold text-destructive">Não use este comando ainda</p>
                    <p className="text-muted-foreground">
                      Você está vendo o assistente pelo endereço de pré-visualização do editor,
                      não pelo endereço publicado. O comando acima aponta para um domínio
                      temporário — o servidor pode não conseguir baixar o instalador.
                    </p>
                    <p className="text-muted-foreground">
                      Abra sua dn.os pelo endereço publicado e refaça esta etapa por lá.
                    </p>
                  </div>
                </div>
              )}

              <ol className="space-y-2.5 text-sm">
                <li className="flex gap-2.5">
                  <span className="shrink-0 font-mono text-xs text-primary mt-0.5">1.</span>
                  <span>
                    Clique em <strong className="text-foreground">Copiar</strong> acima.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="shrink-0 font-mono text-xs text-primary mt-0.5">2.</span>
                  <span>
                    Clique dentro da janela preta do terminal para que ela receba o que você
                    digitar.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="shrink-0 font-mono text-xs text-primary mt-0.5">3.</span>
                  <span>
                    Cole com <strong className="text-foreground">Ctrl+V</strong> (ou{" "}
                    <strong className="text-foreground">Cmd+V</strong> no Mac). Se não colar,
                    clique com o botão direito dentro do terminal e escolha{" "}
                    <em>Colar</em> — alguns terminais só aceitam assim.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="shrink-0 font-mono text-xs text-primary mt-0.5">4.</span>
                  <span>
                    Aperte <strong className="text-foreground">Enter</strong> e deixe rodar.
                  </span>
                </li>
              </ol>

              <div className="rounded-lg border border-border bg-secondary/30 p-3 text-xs space-y-1">
                <p className="text-foreground font-medium">No meio da instalação ele pergunta</p>
                <p>
                  Qual modelo de IA os agentes vão usar. Escolha uma opção pelo número e cole a
                  chave de API do provedor. Se ainda não tiver chave nenhuma, a opção
                  recomendada é a mais barata para começar.
                </p>
              </div>

              <p className="text-xs">
                A instalação leva alguns minutos e escreve bastante coisa na tela — é normal.
                Não feche o terminal antes de terminar.
              </p>
            </>
          ) : null}

          {active === 3 ? (
            <>
              <p>
                Quando terminar, o instalador imprime um bloco de texto com o endereço do seu
                servidor e as chaves que a dn.os precisa para conversar com ele.
              </p>

              <div className="rounded-lg border border-border bg-secondary/40 p-3">
                <pre className="overflow-x-auto text-[11px] font-mono text-muted-foreground">
                  {`╔═══════════════════════════════════════════╗
║   COPIE O BLOCO ABAIXO E COLE NA SUA dn.os ║
╚═══════════════════════════════════════════╝

GATEWAY_URL=http://123.45.67.89:18789
OPENCLAW_ADMIN_TOKEN=...
BROADCAST_API_KEY=...
...`}
                </pre>
              </div>

              <p>
                Selecione com o mouse{" "}
                <strong className="text-foreground">da primeira à última linha</strong> e copie.
                Não precisa limpar nada — o que não for reconhecido é ignorado.
              </p>

              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
                <p className="text-foreground font-medium mb-1">O que fazer com ele</p>
                <p>
                  Cole na <strong className="text-foreground">próxima etapa</strong> deste
                  assistente, no campo <em>Bloco do instalador</em>. A conexão é testada na
                  hora.
                </p>
              </div>

              <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
                <p className="text-foreground font-medium mb-1">Guarde em lugar seguro</p>
                <p>
                  Esse bloco contém credenciais do seu servidor. Não mande por WhatsApp nem
                  cole em grupo.
                </p>
              </div>
            </>
          ) : null}
        </div>

        <div className="pt-2 flex justify-end">
          <Button type="button" onClick={concluir}>
            {isLast ? "Concluir preparação" : "Feito. Avançar"}
            <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
