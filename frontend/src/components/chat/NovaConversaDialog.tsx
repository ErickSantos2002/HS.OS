import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Person } from "@/hooks/use-people";

interface Props {
  aberto: boolean;
  onFechar: () => void;
  pessoas: Person[];
  /** Chamado com quem foi escolhido. Quem abre o DM é o `ChatPage`. */
  onEscolher: (pessoa: Person) => void;
}

/** Escolher com quem começar uma conversa.
 *
 * Existe porque a lista lateral só mostra quem já tem conversa: com 26 pessoas
 * na empresa, listar todas na barra empurraria os agentes para baixo da dobra.
 * Aqui a busca casa nome, e-mail e **setor** — "quem é do comercial mesmo?" é a
 * pergunta real de quem acabou de entrar no sistema.
 */
export default function NovaConversaDialog({ aberto, onFechar, pessoas, onEscolher }: Props) {
  const [busca, setBusca] = useState("");

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const lista = termo
      ? pessoas.filter((p) =>
          [p.full_name, p.email, p.departamento, p.cargo]
            .some((campo) => (campo || "").toLowerCase().includes(termo)),
        )
      : pessoas;
    return [...lista].sort((a, b) =>
      (a.full_name || a.email).localeCompare(b.full_name || b.email),
    );
  }, [pessoas, busca]);

  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) { setBusca(""); onFechar(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nova conversa</DialogTitle>
        </DialogHeader>

        <Input
          autoFocus
          placeholder="Buscar por nome, e-mail ou setor"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />

        <ScrollArea className="h-80 -mx-2">
          {filtradas.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Ninguém com esse nome.
            </p>
          ) : (
            filtradas.map((pessoa) => (
              <button
                key={pessoa.id}
                onClick={() => { setBusca(""); onEscolher(pessoa); }}
                className="w-full text-left px-4 py-2.5 hover:bg-secondary/50 transition-colors"
              >
                <div className="text-sm font-medium text-foreground truncate">
                  {pessoa.full_name || pessoa.email}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {[pessoa.cargo, pessoa.departamento].filter(Boolean).join(" · ") || pessoa.email}
                </div>
              </button>
            ))
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
