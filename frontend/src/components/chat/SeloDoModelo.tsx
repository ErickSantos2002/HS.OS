/**
 * O modelo dos agentes, só para mostrar: todos usam DeepSeek (decisão do
 * Erick, 10/11/2026), e ninguém troca.
 *
 * ⚠️ Até 10/11 aqui havia um seletor ("ModelSelector") que gravava a escolha
 * no navegador — e o envio nunca a mandava ao gateway: o turno rodava DeepSeek
 * (226 de 226 no `usage_events` da semana) enquanto a tela dizia "Claude".
 * Trocar o modelo de um agente é do administrador, em Super agentes.
 */
import { connectorLogoUrl, getConnectorTemplate } from "@/lib/connector-templates";

export function SeloDoModelo() {
  const template = getConnectorTemplate("deepseek");
  const logo = template ? connectorLogoUrl(template) : null;
  return (
    <span
      title="Os agentes usam o DeepSeek."
      className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-secondary/30 px-2.5 py-0.5 text-[10px] font-mono text-muted-foreground"
    >
      {logo && <img src={logo} alt="" aria-hidden className="h-3.5 w-3.5 shrink-0 rounded-sm object-contain" />}
      DeepSeek
    </span>
  );
}
