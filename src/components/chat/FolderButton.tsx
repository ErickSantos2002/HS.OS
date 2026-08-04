import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { useFS } from "@/contexts/FileSystemContext";
import { FilePanelDrawer } from "./FilePanelDrawer";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  iconClassName?: string;
}

export function FolderButton({ className, iconClassName }: Props) {
  const { isSupported, isConnected, folderName, requestAccess } = useFS();
  const [panelOpen, setPanelOpen] = useState(false);

  if (!isSupported) return null;

  const handleClick = async () => {
    if (!isConnected) {
      try {
        await requestAccess();
      } catch {
        /* user cancelled */
      }
    } else {
      setPanelOpen(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title={isConnected ? `Pasta: ${folderName}` : "Conectar pasta local"}
        className={cn(
          "p-1.5 rounded-md transition-colors",
          isConnected
            ? "text-primary bg-primary/10 hover:bg-primary/20"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/40",
          className,
        )}
      >
        <FolderOpen className={cn("h-3.5 w-3.5", iconClassName)} />
      </button>
      {panelOpen && <FilePanelDrawer onClose={() => setPanelOpen(false)} />}
    </>
  );
}
