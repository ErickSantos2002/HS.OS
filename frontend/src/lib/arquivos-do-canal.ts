/**
 * Achata as mensagens com anexo de um canal na lista do painel "Arquivos".
 *
 * ⚠️ Anexo novo (desde 13/10/2026) vem com `url: ""` e um `id` — a URL de
 * exibição é assinada sob demanda (`urlDoAnexo`), porque o bucket é privado.
 * Filtrar por `url` fazia os anexos novos sumirem do painel sem aviso. Entra
 * quem tem `id` OU `url`; o antigo, só com `url`, segue como sempre.
 */
export interface ArquivoDoCanal {
  id?: string;
  name: string;
  url: string;
  size: number;
  mimeType: string;
  created_at: string;
  author_name: string;
  message_id: string;
}

interface AnexoBruto {
  id?: string | null;
  url?: string | null;
  name?: string | null;
  size?: number | null;
  mimeType?: string | null;
}

interface LinhaBruta {
  id: string;
  created_at: string;
  author_name?: string | null;
  attachments?: unknown;
}

export function arquivosDoCanal(linhas: readonly LinhaBruta[] | null | undefined): ArquivoDoCanal[] {
  const out: ArquivoDoCanal[] = [];
  for (const row of linhas ?? []) {
    const arr = (Array.isArray(row?.attachments) ? row.attachments : []) as (AnexoBruto | null)[];
    for (const a of arr) {
      if (!a?.id && !a?.url) continue;
      out.push({
        ...(a.id ? { id: String(a.id) } : {}),
        name: a.name || "arquivo",
        url: a.url || "",
        size: a.size ?? 0,
        mimeType: a.mimeType || "",
        created_at: row.created_at,
        author_name: row.author_name || "",
        message_id: row.id,
      });
    }
  }
  return out;
}
