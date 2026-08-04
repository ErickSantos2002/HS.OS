import { useCallback } from "react";
import { useFS } from "@/contexts/FileSystemContext";
import type { FileOperation } from "@/hooks/useFileSystem";

type ParsedFileOp = {
  action: FileOperation["action"];
  path: string;
  newPath?: string;
  content?: string;
};

const FILE_OP_REGEX = /<file_op>([\s\S]*?)<\/file_op>/g;

/** Strip <file_op> blocks from text without executing them. Used at render time. */
export function stripFileOps(text: string): { cleanText: string; ops: ParsedFileOp[] } {
  const ops: ParsedFileOp[] = [];
  const cleanText = text.replace(FILE_OP_REGEX, (_, body: string) => {
    try {
      const parsed = JSON.parse(body) as ParsedFileOp;
      if (parsed && parsed.action && parsed.path !== undefined) ops.push(parsed);
    } catch {
      /* ignore malformed */
    }
    return "";
  }).trim();
  return { cleanText, ops };
}

export function useFileOpParser() {
  const fs = useFS();

  const parseAndExecute = useCallback(
    async (text: string) => {
      const { cleanText, ops } = stripFileOps(text);
      const results: Array<{ op: ParsedFileOp; result: string | null; error?: string }> = [];

      for (const op of ops) {
        try {
          let result: string | null = null;
          if (op.action === "read") {
            result = await fs.readFile(op.path);
          } else if (op.action === "write" || op.action === "create") {
            await fs.writeFile(op.path, op.content || "");
            result = `${op.action === "create" ? "Criado" : "Atualizado"}: ${op.path}`;
          } else if (op.action === "list") {
            const entries = await fs.listFiles(op.path);
            result = entries
              .map((e) => `${e.kind === "directory" ? "[pasta]" : "[arquivo]"} ${e.name}`)
              .join("\n");
          } else if (op.action === "delete") {
            await fs.deleteEntry(op.path);
            result = `Apagado: ${op.path}`;
          } else if (op.action === "rename" || op.action === "move") {
            if (!op.newPath) throw new Error(`"${op.action}" requer campo "newPath"`);
            if (op.action === "rename") await fs.renameFile(op.path, op.newPath);
            else await fs.moveFile(op.path, op.newPath);
            result = `${op.action === "rename" ? "Renomeado" : "Movido"}: ${op.path} → ${op.newPath}`;
          }
          results.push({ op, result });
        } catch (err) {
          results.push({ op, result: null, error: String(err) });
        }
      }

      return { cleanText, results };
    },
    [fs],
  );

  return { parseAndExecute, stripFileOps };
}
