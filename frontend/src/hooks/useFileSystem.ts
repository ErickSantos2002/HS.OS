import { useCallback, useEffect, useState } from "react";
import { setActiveLocalFolder } from "@/lib/file-system-state";

export type FileEntry = {
  name: string;
  kind: "file" | "directory";
  path: string;
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
};

export type FileOperation = {
  id: string;
  action: "read" | "write" | "create" | "list" | "rename" | "move" | "delete";
  path: string;
  newPath?: string;
  content?: string;
  timestamp: Date;
  status: "pending" | "done" | "error";
  error?: string;
};

const DB_NAME = "dnos-fs";
const STORE_NAME = "folder-handles";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(key: string): Promise<T | null> {
  return openDB().then(
    (db) =>
      new Promise<T | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve((req.result as T) ?? null);
        req.onerror = () => reject(req.error);
      }),
  );
}

function idbPut(key: string, value: unknown): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

function idbDelete(key: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export function useFileSystem() {
  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [isSupported] = useState(
    () => typeof window !== "undefined" && "showDirectoryPicker" in window,
  );
  const [operations, setOperations] = useState<FileOperation[]>([]);

  useEffect(() => {
    setActiveLocalFolder(folderName);
  }, [folderName]);

  // Restore handle saved in IndexedDB (PWA keeps the granted permission)
  useEffect(() => {
    if (!isSupported) return;
    void (async () => {
      try {
        const handle = await idbGet<FileSystemDirectoryHandle>("root");
        if (!handle) return;
        const perm = await (handle as any).queryPermission?.({ mode: "readwrite" });
        if (perm === "granted") {
          setRootHandle(handle);
          setFolderName(handle.name);
        }
      } catch {
        /* ignore */
      }
    })();
  }, [isSupported]);

  const addOperation = useCallback((op: Omit<FileOperation, "id" | "timestamp" | "status">) => {
    const newOp: FileOperation = {
      ...op,
      id: crypto.randomUUID(),
      timestamp: new Date(),
      status: "pending",
    };
    setOperations((prev) => [newOp, ...prev.slice(0, 49)]);
    return newOp.id;
  }, []);

  const updateOperation = useCallback((id: string, update: Partial<FileOperation>) => {
    setOperations((prev) => prev.map((op) => (op.id === id ? { ...op, ...update } : op)));
  }, []);

  const requestAccess = useCallback(async () => {
    if (!isSupported) throw new Error("File System Access API não suportada neste browser");
    const handle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
    await idbPut("root", handle);
    setRootHandle(handle);
    setFolderName(handle.name);
    return handle;
  }, [isSupported]);

  const revokeAccess = useCallback(async () => {
    setRootHandle(null);
    setFolderName(null);
    await idbDelete("root").catch(() => undefined);
  }, []);

  const resolveDir = useCallback(
    async (path: string, create = false): Promise<FileSystemDirectoryHandle> => {
      if (!rootHandle) throw new Error("Nenhuma pasta autorizada");
      const parts = path.replace(/^\//, "").split("/").filter(Boolean);
      let dir: FileSystemDirectoryHandle = rootHandle;
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create });
      }
      return dir;
    },
    [rootHandle],
  );

  const readFile = useCallback(
    async (path: string): Promise<string> => {
      const opId = addOperation({ action: "read", path });
      try {
        const parts = path.replace(/^\//, "").split("/");
        const fileName = parts.pop()!;
        const dir = await resolveDir(parts.join("/"));
        const fileHandle = await dir.getFileHandle(fileName);
        const file = await fileHandle.getFile();
        const content = await file.text();
        updateOperation(opId, { status: "done", content });
        return content;
      } catch (err) {
        updateOperation(opId, { status: "error", error: String(err) });
        throw err;
      }
    },
    [addOperation, updateOperation, resolveDir],
  );

  const writeFile = useCallback(
    async (path: string, content: string): Promise<void> => {
      const opId = addOperation({ action: "write", path, content });
      try {
        const parts = path.replace(/^\//, "").split("/");
        const fileName = parts.pop()!;
        const dir = await resolveDir(parts.join("/"), true);
        const fileHandle = await dir.getFileHandle(fileName, { create: true });
        const writable = await (fileHandle as any).createWritable();
        await writable.write(content);
        await writable.close();
        updateOperation(opId, { status: "done" });
      } catch (err) {
        updateOperation(opId, { status: "error", error: String(err) });
        throw err;
      }
    },
    [addOperation, updateOperation, resolveDir],
  );

  const listFiles = useCallback(
    async (path = ""): Promise<FileEntry[]> => {
      const opId = addOperation({ action: "list", path: path || "/" });
      try {
        const dir = await resolveDir(path);
        const entries: FileEntry[] = [];
        for await (const [name, handle] of (dir as any).entries()) {
          entries.push({
            name,
            kind: (handle as any).kind,
            path: path ? `${path}/${name}` : name,
            handle,
          });
        }
        updateOperation(opId, { status: "done" });
        return entries.sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      } catch (err) {
        updateOperation(opId, { status: "error", error: String(err) });
        throw err;
      }
    },
    [addOperation, updateOperation, resolveDir],
  );

  const deleteEntry = useCallback(
    async (path: string): Promise<void> => {
      const opId = addOperation({ action: "delete", path });
      try {
        const parts = path.replace(/^\//, "").split("/").filter(Boolean);
        if (parts.length === 0) throw new Error("Não é possível apagar a raiz");
        const name = parts.pop()!;
        const dir = await resolveDir(parts.join("/"));
        await (dir as any).removeEntry(name, { recursive: true });
        updateOperation(opId, { status: "done" });
      } catch (err) {
        updateOperation(opId, { status: "error", error: String(err) });
        throw err;
      }
    },
    [addOperation, updateOperation, resolveDir],
  );

  const renameOrMove = useCallback(
    async (path: string, newPath: string, action: "rename" | "move"): Promise<void> => {
      const opId = addOperation({ action, path, newPath });
      try {
        const srcParts = path.replace(/^\//, "").split("/").filter(Boolean);
        if (srcParts.length === 0) throw new Error("Caminho de origem inválido");
        const srcName = srcParts.pop()!;
        const srcDir = await resolveDir(srcParts.join("/"));
        const srcHandle = await srcDir.getFileHandle(srcName);

        // Try native move() (Chromium) first.
        const dstParts = newPath.replace(/^\//, "").split("/").filter(Boolean);
        if (dstParts.length === 0) throw new Error("Caminho de destino inválido");
        const dstName = dstParts.pop()!;
        const dstDir = await resolveDir(dstParts.join("/"), true);

        const nativeMove = (srcHandle as any).move;
        if (typeof nativeMove === "function") {
          await nativeMove.call(srcHandle, dstDir, dstName);
        } else {
          // Fallback: copy bytes + delete original
          const file = await srcHandle.getFile();
          const buf = await file.arrayBuffer();
          const dstHandle = await dstDir.getFileHandle(dstName, { create: true });
          const writable = await (dstHandle as any).createWritable();
          await writable.write(buf);
          await writable.close();
          await (srcDir as any).removeEntry(srcName);
        }
        updateOperation(opId, { status: "done" });
      } catch (err) {
        updateOperation(opId, { status: "error", error: String(err) });
        throw err;
      }
    },
    [addOperation, updateOperation, resolveDir],
  );

  const renameFile = useCallback(
    (path: string, newPath: string) => renameOrMove(path, newPath, "rename"),
    [renameOrMove],
  );

  const moveFile = useCallback(
    (path: string, newPath: string) => renameOrMove(path, newPath, "move"),
    [renameOrMove],
  );

  return {
    isSupported,
    isConnected: !!rootHandle,
    folderName,
    operations,
    requestAccess,
    revokeAccess,
    readFile,
    writeFile,
    listFiles,
    deleteEntry,
    renameFile,
    moveFile,
  };
}
