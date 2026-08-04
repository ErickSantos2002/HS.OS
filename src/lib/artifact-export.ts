import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import DOMPurify from "dompurify";

/**
 * Export artifact HTML content as PDF using html2pdf.js.
 * Renders the HTML into a sanitized off-screen container (no script execution)
 * to avoid the need for a same-origin iframe.
 */
export async function exportArtifactAsPdf(htmlContent: string, filename = "artifact") {
  if (!htmlContent) {
    throw new Error("No content to export");
  }

  const html2pdf = (await import("html2pdf.js")).default;

  // Parse the full HTML document to extract body + styles
  const parser = new DOMParser();
  const parsed = parser.parseFromString(htmlContent, "text/html");

  // Sanitize body content — strip scripts, event handlers, etc.
  const safeBody = DOMPurify.sanitize(parsed.body?.innerHTML || htmlContent, {
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
  });

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.style.width = "794px";
  container.style.background = "#fff";
  container.style.color = "#000";

  // Copy <style> tags from the parsed document (these are safe — no script execution)
  parsed.querySelectorAll("style").forEach((s) => {
    container.appendChild(s.cloneNode(true));
  });

  const overrideStyle = document.createElement("style");
  overrideStyle.textContent = `
    body, div, section, main, article, header, footer { 
      background: #fff !important; 
      color: #000 !important; 
    }
  `;
  container.appendChild(overrideStyle);

  const content = document.createElement("div");
  content.innerHTML = safeBody;
  container.appendChild(content);
  document.body.appendChild(container);

  try {
    await html2pdf()
      .set({
        margin: [10, 10, 10, 10],
        filename: `${filename}.pdf`,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .from(content)
      .save();
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * Parse basic HTML structure into docx paragraphs
 */
function htmlToDocxParagraphs(html: string): Paragraph[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const paragraphs: Paragraph[] = [];

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) {
        paragraphs.push(new Paragraph({ children: [new TextRun(text)] }));
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === "h1") {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: el.textContent || "", bold: true })],
        })
      );
      return;
    }
    if (tag === "h2") {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: el.textContent || "", bold: true })],
        })
      );
      return;
    }
    if (tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [new TextRun({ text: el.textContent || "", bold: true })],
        })
      );
      return;
    }
    if (tag === "p") {
      const runs: TextRun[] = [];
      el.childNodes.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          const t = child.textContent || "";
          if (t.trim()) runs.push(new TextRun(t));
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const childEl = child as HTMLElement;
          const childTag = childEl.tagName.toLowerCase();
          runs.push(
            new TextRun({
              text: childEl.textContent || "",
              bold: childTag === "strong" || childTag === "b",
              italics: childTag === "em" || childTag === "i",
              underline: childTag === "u" ? {} : undefined,
            })
          );
        }
      });
      if (runs.length > 0) {
        paragraphs.push(new Paragraph({ children: runs }));
      }
      return;
    }
    if (tag === "li") {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: `• ${el.textContent || ""}` })],
          spacing: { before: 40, after: 40 },
        })
      );
      return;
    }
    if (tag === "br") {
      paragraphs.push(new Paragraph({ children: [] }));
      return;
    }
    if (tag === "pre" || tag === "code") {
      const text = el.textContent || "";
      text.split("\n").forEach((line) => {
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: line, font: "Courier New", size: 20 })],
          })
        );
      });
      return;
    }

    // Recurse into children for other elements
    el.childNodes.forEach((child) => walk(child));
  }

  doc.body.childNodes.forEach((child) => walk(child));

  if (paragraphs.length === 0) {
    // Fallback: just use all text content
    const text = doc.body.textContent || "";
    text.split("\n").filter(Boolean).forEach((line) => {
      paragraphs.push(new Paragraph({ children: [new TextRun(line.trim())] }));
    });
  }

  return paragraphs;
}

/**
 * Export artifact code/html content as DOCX
 */
export async function exportArtifactAsDocx(code: string, filename = "artifact") {
  const paragraphs = htmlToDocxParagraphs(code);

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children: paragraphs,
      },
    ],
  });

  const buffer = await Packer.toBlob(doc);
  const url = URL.createObjectURL(buffer);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}
