const KEY = "wiki:recent-docs";
const MAX = 5;

export interface WikiRecent {
  id: string;
  title: string;
  spaceId: string;
  openedAt: number;
}

export function getWikiRecents(): WikiRecent[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as WikiRecent[];
    return Array.isArray(list) ? list.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function pushWikiRecent(entry: Omit<WikiRecent, "openedAt">) {
  if (!entry.id) return;
  const list = getWikiRecents().filter((r) => r.id !== entry.id);
  list.unshift({ ...entry, openedAt: Date.now() });
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    window.dispatchEvent(new CustomEvent("wiki:recents-changed"));
  } catch {
    // ignore
  }
}

export function removeWikiRecent(id: string) {
  const list = getWikiRecents().filter((r) => r.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent("wiki:recents-changed"));
  } catch {
    // ignore
  }
}
