import { useEffect, useState } from "react";
import { ChevronLeft, File as FileIcon, Folder, FolderOpen, Loader2, Unplug } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFS } from "@/contexts/FileSystemContext";
import type { FileEntry } from "@/hooks/useFileSystem";

interface Props {
  onClose: () => void;
}

export function FilePanelDrawer({ onClose }: Props) {
  const { listFiles, folderName, revokeAccess } = useFS();
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    listFiles(currentPath)
      .then(setEntries)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [currentPath, listFiles]);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-[360px] sm:w-[420px] p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b border-border/40">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <FolderOpen className="h-4 w-4 text-primary" />
            <span className="truncate">{folderName ?? "Pasta local"}</span>
          </SheetTitle>
          <SheetDescription className="text-[11px] font-mono text-muted-foreground truncate">
            /{currentPath}
          </SheetDescription>
        </SheetHeader>

        {currentPath && (
          <button
            type="button"
            onClick={() => setCurrentPath(currentPath.split("/").slice(0, -1).join("/"))}
            className="flex items-center gap-1.5 px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/30 border-b border-border/30 text-left"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Voltar
          </button>
        )}

        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="p-4 text-xs text-destructive">{error}</div>
          ) : entries.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">Pasta vazia</div>
          ) : (
            <div className="divide-y divide-border/30">
              {entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => entry.kind === "directory" && setCurrentPath(entry.path)}
                  className="w-full flex items-center gap-2 px-4 py-2 text-left text-xs hover:bg-secondary/40 transition-colors"
                  disabled={entry.kind === "file"}
                >
                  {entry.kind === "directory" ? (
                    <Folder className="h-3.5 w-3.5 text-primary shrink-0" />
                  ) : (
                    <FileIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  <span className="truncate font-mono">{entry.name}</span>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="border-t border-border/40 p-3">
          <button
            type="button"
            onClick={async () => {
              await revokeAccess();
              onClose();
            }}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors"
          >
            <Unplug className="h-3.5 w-3.5" />
            Desconectar pasta
          </button>
        </div>
      </SheetContent>

    </Sheet>
  );
}
