/* PK-01 (24/11/2026) — XSS e phishing da wiki e da prévia HTML.
 *
 * Portado da auditoria de 02/11 do DN.OS (M4, C1/C2, FD-04). O que custaria:
 *
 * - `/wiki-html-preview` é PÚBLICA. `?url=` mostrava qualquer site em tela
 *   cheia sob hsos.healthsafetytech.com — um login falso pronto — e `?key=`
 *   apagava qualquer chave do localStorage: `?key=hsos.token` deslogava quem
 *   clicasse no link.
 * - SVG/XML da wiki abriam como blob numa aba que herda a origem do app: um
 *   `<script>` no SVG lia `hsos.token` (JWT de 168 h) e levava a conta.
 * - `javascript:` no endereço de anexo/vídeo. Quem escreve esse endereço são os
 *   agentes (`documento_criar`), depois de ler e-mail de terceiros — injeção
 *   indireta virando sessão roubada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// a cadeia de imports dos nós chega na biblioteca de PDF, que pede DOMMatrix (não existe no jsdom)
vi.hoisted(() => { (globalThis as Record<string, unknown>).DOMMatrix ??= class {}; });
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Youtube from "@tiptap/extension-youtube";

import { chaveDaPrevia, enderecoDaPrevia } from "@/lib/previa-html";
import { enderecoSeguro } from "@/lib/endereco-seguro";
import { AttachmentNode } from "@/components/wiki/AttachmentNode";
import { VideoNode } from "@/components/wiki/VideoNode";
import { downloadUrl, openPreview } from "@/components/wiki/mediaActions";
import WikiHtmlPreviewPage from "@/pages/WikiHtmlPreviewPage";

const ORIGEM = "https://hsos.healthsafetytech.com";
const API = "https://hsosapi.healthsafetytech.com";

describe("prévia HTML — a chave", () => {
  it("só a de uso único que o openPreview grava", () => {
    expect(chaveDaPrevia("wiki-html-preview:1730000000000:abc123")).toBe("wiki-html-preview:1730000000000:abc123");
    expect(chaveDaPrevia("hsos.token")).toBeNull();
    expect(chaveDaPrevia("wiki-html-preview:")).toBeNull();
    expect(chaveDaPrevia("wiki-html-preview:x:y")).toBeNull();
    expect(chaveDaPrevia(null)).toBeNull();
  });
});

describe("prévia HTML — o endereço", () => {
  it("arquivo do storage da API ou da própria origem", () => {
    expect(enderecoDaPrevia(`${API}/storage/wiki-uploads/a/b.html`, ORIGEM, API)).toBe(`${API}/storage/wiki-uploads/a/b.html`);
    expect(enderecoDaPrevia("/arquivos/a.html", ORIGEM, API)).toBe(`${ORIGEM}/arquivos/a.html`);
    // em desenvolvimento a API é `/api`, na mesma origem
    expect(enderecoDaPrevia("/api/storage/agent-files/a.html", ORIGEM, "/api")).toBe(`${ORIGEM}/api/storage/agent-files/a.html`);
  });
  it("qualquer outro é recusado", () => {
    for (const v of [
      "https://evil.com/login.html",
      `${API}/p/pagina-publica`,                      // a API tem outras rotas públicas
      `${API}/storage/../p/x`,
      `${API}/storagex/a.html`,
      "https://hsosapi.healthsafetytech.com.evil.com/storage/a.html",
      "//evil.com/storage/a.html",
      "javascript:alert(1)",
      "data:text/html,<b>x</b>",
      `https://x@hsosapi.healthsafetytech.com/storage/a.html`,
    ]) {
      expect(enderecoDaPrevia(v, ORIGEM, API), v).toBeNull();
    }
    expect(enderecoDaPrevia(`${API}/storage/a.html`, ORIGEM, undefined)).toBeNull();
  });
});

describe("prévia HTML — a página", () => {
  const fetchOriginal = globalThis.fetch;
  beforeEach(() => {
    localStorage.clear();
    globalThis.fetch = vi.fn(async () => new Response("<p>ok</p>", { status: 200 })) as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    globalThis.fetch = fetchOriginal;
    window.history.replaceState(null, "", "/");
  });

  it("?url= de outro site: não busca e diz que não é permitido", async () => {
    window.history.replaceState(null, "", "/wiki-html-preview?url=" + encodeURIComponent("https://evil.com/login.html"));
    render(<WikiHtmlPreviewPage />);
    expect(await screen.findByText(/Endereço não permitido/)).toBeTruthy();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // ⚠️ O caso que existia de verdade é chave guardada em JSON. O `hsos.token` é
  // texto cru: o código antigo fazia `JSON.parse` dele ANTES do `removeItem`, o
  // parse falhava e a sessão sobrevivia por acaso — o "desloga por link" da
  // análise de 23/11 não acontecia aqui. Já `hsos:pending-long-tasks` (a fila
  // de tarefas longas do chat) parseia e sumia. Conferido rodando este teste
  // contra o código antigo, em 24/11/2026.
  it("?key= de outra coisa não apaga a chave (nem JSON, nem a sessão)", async () => {
    localStorage.setItem("hsos:pending-long-tasks", '[{"id":"t1"}]');
    localStorage.setItem("hsos.token", "jwt");
    for (const chave of ["hsos:pending-long-tasks", "hsos.token"]) {
      window.history.replaceState(null, "", `/wiki-html-preview?key=${chave}`);
      render(<WikiHtmlPreviewPage />);
      await screen.findByText(/não encontrado/i);
      cleanup();
    }
    expect(localStorage.getItem("hsos:pending-long-tasks")).toBe('[{"id":"t1"}]');
    expect(localStorage.getItem("hsos.token")).toBe("jwt");
  });

  it("a chave de verdade é lida e apagada, e o arquivo da mesma origem abre", async () => {
    const chave = "wiki-html-preview:1730000000000:abc123";
    localStorage.setItem(chave, JSON.stringify({ url: "/arquivos/a.html", filename: "a.html" }));
    window.history.replaceState(null, "", `/wiki-html-preview?key=${chave}`);
    render(<WikiHtmlPreviewPage />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(chave)).toBeNull();
  });
});

describe("enderecoSeguro", () => {
  it("aceita http(s), blob e relativo", () => {
    expect(enderecoSeguro(`${API}/storage/wiki-uploads/a/b.png`)).toBeTruthy();
    expect(enderecoSeguro("http://exemplo.com/a")).toBeTruthy();
    expect(enderecoSeguro("blob:https://hsos.healthsafetytech.com/123")).toBeTruthy();
    expect(enderecoSeguro("/wiki-html-preview?x=1")).toBeTruthy();
  });
  it("recusa esquemas que rodam código, mesmo disfarçados", () => {
    for (const v of ["javascript:alert(1)", " JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "\u0001javascript:x", "vbscript:x", "data:text/html,<b>", "data:image/svg+xml,<svg>", "//evil.com/x"]) {
      expect(enderecoSeguro(v), v).toBeNull();
    }
    expect(enderecoSeguro(null)).toBeNull();
    expect(enderecoSeguro("")).toBeNull();
  });
  it("data: só para imagem rasterizada", () => {
    expect(enderecoSeguro("data:image/png;base64,AAAA")).toBeNull();
    expect(enderecoSeguro("data:image/png;base64,AAAA", { imagem: true })).toBeTruthy();
    expect(enderecoSeguro("data:image/svg+xml;base64,AAAA", { imagem: true })).toBeNull();
  });
});

describe("nós do documento não guardam endereço que roda código", () => {
  const ler = (html: string) => {
    const ed = new Editor({ extensions: [StarterKit, Youtube.configure({ nocookie: true }), AttachmentNode, VideoNode], content: html });
    const attrs: Record<string, unknown>[] = [];
    ed.state.doc.descendants((n) => {
      if (n.attrs.src !== undefined || n.attrs.href !== undefined) attrs.push({ tipo: n.type.name, ...n.attrs });
    });
    const html2 = ed.getHTML();
    ed.destroy();
    return { attrs, html2 };
  };
  it("vídeo do YouTube com endereço que não é do YouTube não sai no HTML", () => {
    const { html2 } = ler('<div data-youtube-video><iframe src="javascript:document.title=1"></iframe></div>');
    expect(html2).not.toMatch(/javascript:/i);
  });
  it("anexo e vídeo com javascript: perdem o endereço", () => {
    const { attrs, html2 } = ler('<div data-wiki-attachment data-href="javascript:document.title=1" data-name="x.png"></div><div data-video><video src="javascript:x"></video></div>');
    expect(html2).not.toMatch(/javascript:/i);
    for (const a of attrs) {
      expect(String(a.href ?? "")).not.toMatch(/javascript:/i);
      expect(String(a.src ?? "")).not.toMatch(/javascript:/i);
    }
  });
  it("anexo e vídeo de verdade continuam", () => {
    const u = `${API}/storage/wiki-uploads/a/b/c.pdf`;
    const v = `${API}/storage/wiki-uploads/a/b/c.mp4`;
    const { html2 } = ler(`<div data-wiki-attachment data-href="${u}" data-name="c.pdf"></div><div data-video><video src="${v}"></video></div>`);
    expect(html2).toContain(u);
    expect(html2).toContain(v);
  });
});

describe("abrir e baixar", () => {
  const openOriginal = window.open;
  const fetchOriginal = globalThis.fetch;
  afterEach(() => {
    window.open = openOriginal;
    globalThis.fetch = fetchOriginal;
  });

  it("SVG e XML baixam em vez de abrir numa aba da mesma origem", async () => {
    window.open = vi.fn(() => null) as typeof window.open;
    globalThis.fetch = vi.fn(async () => new Response("<svg><script>alert(1)</script></svg>", { status: 200 })) as typeof fetch;
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    await openPreview(`${API}/storage/wiki-uploads/a.svg`, "a.svg");
    await openPreview(`${API}/storage/wiki-uploads/a.xml`, "a.xml");
    expect(window.open).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("javascript: não é aberto nem pelo caminho de reserva do download", async () => {
    window.open = vi.fn(() => null) as typeof window.open;
    globalThis.fetch = vi.fn(async () => { throw new TypeError("falhou"); }) as typeof fetch;
    await downloadUrl("javascript:document.title=1", "x.png");
    await openPreview("javascript:document.title=1", "x.png");
    expect(window.open).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
