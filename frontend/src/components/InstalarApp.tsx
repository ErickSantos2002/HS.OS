import { useState } from "react";
import { Download, Share, Smartphone, SquarePlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useInstalacaoApp } from "@/hooks/use-instalacao-app";
import { cartaoDispensadoVale, gravarDispensa, lerDispensa } from "@/lib/instalacao-app";

/**
 * Convite para instalar o HS.OS como app.
 *
 * - `cartao`: dispensável, para o topo da lista de conversas no celular. Some
 *   por 14 dias quando a pessoa toca em "Agora não". Só aparece quando há o
 *   que fazer (botão do navegador ou passo a passo do iPhone).
 * - `entrada`: fixa, em Configurações → Perfil. Ignora a dispensa do cartão e
 *   sempre explica alguma coisa, inclusive quando o navegador não ofereceu o
 *   botão.
 *
 * Instalado (standalone) → nenhuma das duas aparece.
 */
export function InstalarApp({ variante }: { variante: "cartao" | "entrada" }) {
  const { instalado, ios, podeInstalar, instalar } = useInstalacaoApp();
  const [dispensado, setDispensado] = useState(() =>
    cartaoDispensadoVale(lerDispensa(), Date.now()),
  );

  if (instalado) return null;
  const cartao = variante === "cartao";
  if (cartao && (dispensado || (!podeInstalar && !ios))) return null;

  const dispensar = () => {
    gravarDispensa(Date.now());
    setDispensado(true);
  };

  const aoInstalar = async () => {
    const r = await instalar();
    if (r === "aceito") toast.success("HS.OS instalado. Abra pelo ícone na tela de início.");
  };

  return (
    <div className="relative rounded-xl border border-border/30 bg-secondary/20 px-4 py-3">
      {cartao && (
        <button
          type="button"
          onClick={dispensar}
          aria-label="Agora não"
          className="absolute right-1 top-1 inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      <h3 className="flex items-center gap-2 pr-10 text-sm font-display font-semibold text-foreground">
        <Smartphone className="h-4 w-4 text-primary" /> Instalar o HS.OS no celular
      </h3>

      {podeInstalar ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            Abre em tela cheia, com o ícone da HS, como um app.
          </p>
          <Button size="sm" className="mt-3 min-h-11" onClick={() => void aoInstalar()}>
            <Download className="mr-2 h-4 w-4" /> Instalar o app
          </Button>
        </>
      ) : ios ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            No iPhone, é instalando que as notificações passam a funcionar.
          </p>
          <ol className="mt-3 space-y-2 text-sm text-foreground">
            <li className="flex items-center gap-2">
              <span className="text-muted-foreground">1.</span> Toque em
              <Share className="h-4 w-4 text-primary" aria-label="Compartilhar" />
              <span className="font-medium">Compartilhar</span>, na barra do Safari
            </li>
            <li className="flex items-center gap-2">
              <span className="text-muted-foreground">2.</span> Escolha
              <SquarePlus className="h-4 w-4 text-primary" aria-hidden />
              <span className="font-medium">Adicionar à Tela de Início</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-muted-foreground">3.</span> Abra o HS.OS pelo ícone novo
            </li>
          </ol>
        </>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          Abra o menu do navegador e escolha "Instalar app" (no Chrome do Android: ⋮ → Instalar app).
          Se a opção não aparecer, este navegador não instala apps da web.
        </p>
      )}
    </div>
  );
}
