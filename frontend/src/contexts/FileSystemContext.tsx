import { createContext, useContext, type ReactNode } from "react";
import { useFileSystem } from "@/hooks/useFileSystem";

type FileSystemContextType = ReturnType<typeof useFileSystem>;

const FileSystemContext = createContext<FileSystemContextType | null>(null);

export function FileSystemProvider({ children }: { children: ReactNode }) {
  const fs = useFileSystem();
  return <FileSystemContext.Provider value={fs}>{children}</FileSystemContext.Provider>;
}

export function useFS(): FileSystemContextType {
  const ctx = useContext(FileSystemContext);
  if (!ctx) throw new Error("useFS deve ser usado dentro de FileSystemProvider");
  return ctx;
}
