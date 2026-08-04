import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

const GIPHY_API_KEY =
  (import.meta.env.VITE_GIPHY_API_KEY as string | undefined) || "LIVDSRZULELA"; // Giphy public SDK key (fallback for dev)
const PAGE_LIMIT = 24;

export interface GifResult {
  id: string;
  title: string;
  previewUrl: string; // small webp/gif for grid
  url: string;        // full size gif url to send
  width: number;
  height: number;
}

interface GiphyApiGif {
  id: string;
  title: string;
  images: {
    fixed_width: { url: string; webp?: string; width: string; height: string };
    original: { url: string; width: string; height: string };
    downsized_medium?: { url: string; width: string; height: string };
  };
}

function mapGif(g: GiphyApiGif): GifResult {
  const preview = g.images.fixed_width;
  const full = g.images.downsized_medium || g.images.original;
  return {
    id: g.id,
    title: g.title || "GIF",
    previewUrl: preview.webp || preview.url,
    url: full.url,
    width: Number(full.width) || 0,
    height: Number(full.height) || 0,
  };
}

async function fetchGifs(query: string, offset: number): Promise<GifResult[]> {
  const base = query.trim()
    ? `https://api.giphy.com/v1/gifs/search?q=${encodeURIComponent(query)}&`
    : `https://api.giphy.com/v1/gifs/trending?`;
  const url = `${base}api_key=${GIPHY_API_KEY}&limit=${PAGE_LIMIT}&offset=${offset}&rating=pg-13&lang=pt`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Giphy ${res.status}`);
  const data = (await res.json()) as { data: GiphyApiGif[] };
  return (data.data || []).map(mapGif);
}

export default function GifPicker({ onSelect }: { onSelect: (gif: GifResult) => void }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [gifs, setGifs] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const reqIdRef = useRef(0);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Reset on query change
  useEffect(() => {
    const myReq = ++reqIdRef.current;
    setGifs([]);
    setOffset(0);
    setHasMore(true);
    setError(null);
    setLoading(true);
    fetchGifs(debounced, 0)
      .then((list) => {
        if (myReq !== reqIdRef.current) return;
        setGifs(list);
        setOffset(list.length);
        setHasMore(list.length >= PAGE_LIMIT);
      })
      .catch((e) => {
        if (myReq !== reqIdRef.current) return;
        setError(String(e?.message || e));
      })
      .finally(() => {
        if (myReq === reqIdRef.current) setLoading(false);
      });
  }, [debounced]);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const list = await fetchGifs(debounced, offset);
      setGifs((prev) => [...prev, ...list]);
      setOffset((o) => o + list.length);
      setHasMore(list.length >= PAGE_LIMIT);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [debounced, offset, hasMore, loading]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      loadMore();
    }
  }, [loadMore]);

  return (
    <div className="flex flex-col w-[380px] sm:w-[460px] h-[460px] bg-popover">
      {/* Search */}
      <div className="flex items-center gap-2 p-2 border-b border-border/40">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar GIFs no Giphy..."
            className="w-full bg-secondary/40 rounded-md pl-8 pr-7 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/40"
            autoFocus
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-2">
        {error && (
          <div className="text-xs text-destructive p-3 text-center">Erro: {error}</div>
        )}
        {!error && gifs.length === 0 && !loading && (
          <div className="text-xs text-muted-foreground p-6 text-center">
            Nenhum GIF encontrado.
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {gifs.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onSelect(g)}
              className={cn(
                "relative overflow-hidden rounded-md bg-secondary/40 hover:ring-2 hover:ring-primary/60 transition-all",
                "aspect-square"
              )}
              title={g.title}
            >
              <img
                src={g.previewUrl}
                alt={g.title}
                loading="lazy"
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
        {loading && (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Attribution */}
      <div className="px-2 py-1 border-t border-border/40 text-[10px] text-muted-foreground text-center">
        Powered by GIPHY
      </div>
    </div>
  );
}
