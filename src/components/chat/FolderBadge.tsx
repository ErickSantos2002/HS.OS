import { useState } from "react";
import { FolderOpen, X } from "lucide-react";
import { useFS } from "@/contexts/FileSystemContext";
import { FilePanelDrawer } from "./FilePanelDrawer";

export function FolderBadge() {
  const { isConnected, folderName, revokeAccess } = useFS();
  const [panelOpen, setPanelOpen] = useState(false);

  if (!isConnected || !folderName) return null;

  return (
    <>
      <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 pl-2 pr-1 py-0.5 text-[11px] text-primary">
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="inline-flex items-center gap-1.5 hover:opacity-80"
          title="Abrir explorador da pasta"
        >
          <FolderOpen className="h-3 w-3" />
          <span className="font-medium truncate max-w-[140px]">{folderName}</span>
        </button>
        <button
          type="button"
          onClick={() => void revokeAccess()}
          className="rounded-full p-0.5 hover:bg-primary/20"
          title="Desconectar pasta"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {panelOpen && <FilePanelDrawer onClose={() => setPanelOpen(false)} />}
    </>
  );
}
