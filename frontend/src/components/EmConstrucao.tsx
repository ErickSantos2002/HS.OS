import type { LucideIcon } from "lucide-react";
import { Hammer } from "lucide-react";

/**
 * Aviso de funcionalidade pausada.
 *
 * Existe porque há um meio-termo real entre "está no ar" e "foi apagado": ideias
 * que não entram nesta entrega mas que a empresa não quer perder. Apagar seria
 * decisão de produto que não é nossa; deixar meio funcionando seria pior — a
 * pessoa clica, nada acontece, e ninguém sabe se é bug.
 *
 * O padrão é sempre o mesmo: a rota continua existindo, a tela diz o que a
 * funcionalidade **era** e que o trabalho está guardado, e o código real fica em
 * `src/_legado/`, fora da compilação mas dentro do repositório.
 *
 * Em uso hoje: Arena. Previstos: parede de TV (warroom) e a integração de voz
 * (ElevenLabs). Ver `docs/EM-CONSTRUCAO.md`.
 */
export default function EmConstrucao({
  titulo,
  resumo,
  oQueEra,
  icone: Icone = Hammer,
}: {
  /** Nome da funcionalidade, como a pessoa a conhece. */
  titulo: string;
  /** Uma frase sobre o estado — por que não está no ar agora. */
  resumo: string;
  /** O que a funcionalidade fazia. Sem isto o aviso não ensina nada a quem nunca viu. */
  oQueEra: string;
  icone?: LucideIcon;
}) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6 py-16">
      <div className="glass-card w-full max-w-lg rounded-2xl p-8 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <Icone className="h-7 w-7 text-primary" aria-hidden="true" />
        </div>

        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Em construção
        </p>

        <h1 className="mt-2 font-display text-2xl font-bold text-foreground">
          {titulo}
        </h1>

        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {resumo}
        </p>

        <div className="mt-6 rounded-xl border border-border/60 bg-secondary/40 px-4 py-3 text-left">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            O que era
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground/80">
            {oQueEra}
          </p>
        </div>
      </div>
    </div>
  );
}
