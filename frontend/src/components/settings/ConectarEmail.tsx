/**
 * Conectar a conta Microsoft ao bot pessoal (spec 2026-11-05-bot-email-piloto).
 * Só aparece para quem tem bot com e-mail liberado pelo admin.
 *
 * "Conectar" é um POST que devolve a URL da Microsoft: o JWT mora no
 * localStorage e uma navegação direta não o levaria.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ErroApi } from "@/lib/api";
import { conectarEmail, desconectarEmail, estadoEmail, mensagemDaConexao, type EstadoEmail } from "@/lib/email";

export default function ConectarEmail() {
  const [estado, setEstado] = useState<EstadoEmail | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    estadoEmail().then(setEstado).catch(() => setEstado(null));
    const params = new URLSearchParams(window.location.search);
    const msg = mensagemDaConexao(params.get("email"));
    if (msg) {
      (msg.tipo === "ok" ? toast.success : toast.error)(msg.texto);
      params.delete("email");
      const q = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
    }
  }, []);

  if (!estado?.liberado) return null;

  const conectar = async () => {
    setOcupado(true);
    try {
      const { url } = await conectarEmail();
      window.location.assign(url);
    } catch (e) {
      toast.error(e instanceof ErroApi ? e.message : "Não consegui iniciar a conexão.");
      setOcupado(false);
    }
  };

  const desconectar = async () => {
    setOcupado(true);
    try {
      await desconectarEmail();
      setEstado({ ...estado, conectado: false, conta: null });
      // Apaga o token daqui; o consentimento na Microsoft continua até a pessoa
      // removê-lo em myapps.microsoft.com — dito na tela para não enganar.
      toast.success("E-mail desconectado. O HS.OS apagou o acesso guardado.");
    } catch (e) {
      toast.error(e instanceof ErroApi ? e.message : "Não consegui desconectar.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/30 bg-secondary/20 px-4 py-3">
      <div className="min-w-0">
        <h3 className="text-sm font-display font-semibold text-foreground">E-mail do {estado.bot_nome ?? estado.bot ?? "seu Guardi"}</h3>
        {estado.conectado ? (
          <p className="mt-1 text-xs text-muted-foreground break-words">
            Conectado como <span className="text-foreground">{estado.conta}</span>
            {estado.caixas.length > 0 && <> · caixas: {estado.caixas.join(", ")}</>}
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            Conecte sua conta Microsoft para o seu Guardi ler seus e-mails e preparar respostas — nada sai para outras pessoas sem você aprovar.
          </p>
        )}
      </div>
      {estado.conectado ? (
        <button disabled={ocupado} onClick={() => void desconectar()} className="shrink-0 rounded-full border border-border/40 px-3 py-1 text-xs hover:bg-secondary/50">Desconectar</button>
      ) : (
        <button disabled={ocupado} onClick={() => void conectar()} className="shrink-0 rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground">Conectar e-mail Microsoft</button>
      )}
    </div>
  );
}
