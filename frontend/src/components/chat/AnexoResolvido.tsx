/**
 * Resolve a URL de exibição de um anexo e a entrega ao JSX que já existia.
 *
 * Envoltório e não componente de exibição novo, de propósito: as três telas
 * (canal, thread, chat com agente) já desenham imagem, áudio e cartão de
 * arquivo cada uma a seu modo; trocar tudo por um componente só seria mexer
 * em layout para resolver um problema que é só de URL.
 *
 * Sem `id` (anexo de antes de 13/10/2026), devolve a `url` como veio.
 */
import { ReactNode, useCallback, useEffect, useState } from "react";
import { esquecerUrl, urlDoAnexo } from "@/lib/anexos";

interface Props {
  id?: string;
  url?: string;
  /** `urlAgora` entrega uma URL válida NA HORA do clique (abrir, baixar, preview). */
  children: (url: string, renovar: () => void, urlAgora: () => Promise<string>) => ReactNode;
}

export default function AnexoResolvido({ id, url, children }: Props) {
  const [resolvida, setResolvida] = useState<string | null>(id ? null : url ?? "");
  const [erro, setErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!id) return;
    let vivo = true;
    urlDoAnexo(id)
      .then((u) => vivo && setResolvida(u))
      .catch(() => vivo && setErro(true));
    return () => {
      vivo = false;
    };
  }, [id, tentativa]);

  // Uma renovação só: URL vencida em aba aberta há horas. Se falhar de novo,
  // o problema não é a validade e repetir só faria laço.
  const renovar = useCallback(() => {
    if (!id || tentativa > 0) return;
    esquecerUrl(id);
    setTentativa(1);
  }, [id, tentativa]);

  // A URL do mount vale 5 min; clique depois disso abriria AccessDenied do R2.
  // `urlDoAnexo` tem cache, então enquanto vale não vai à rede.
  const urlAgora = useCallback(
    () => (id ? urlDoAnexo(id) : Promise.resolve(url ?? "")),
    [id, url],
  );

  if (erro) return <p className="text-[11px] text-muted-foreground">Anexo indisponível.</p>;
  if (resolvida === null) return <div className="h-9 w-40 animate-pulse rounded-lg bg-secondary/50" />;
  return <>{children(resolvida, renovar, urlAgora)}</>;
}
