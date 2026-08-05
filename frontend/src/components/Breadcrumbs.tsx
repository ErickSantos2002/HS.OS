import { useLocation, Link } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";

const routeLabels: Record<string, string> = {
  "": "Dashboard",
  dnos: "HS.OS",
  chat: "Chat",
  results: "Resultados",
  agents: "Super agentes",
  teams: "Times",
  files: "Arquivos",
  sessions: "Sessões",
  settings: "Settings",
  skills: "Skills",
};

export function Breadcrumbs() {
  const location = useLocation();
  const segments = location.pathname.split("/").filter(Boolean);

  if (segments.length === 0) return null;

  return (
    <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Link to="/" className="hover:text-foreground transition-colors duration-150">
        <Home className="h-3.5 w-3.5" />
      </Link>
      {segments.map((seg, i) => {
        const path = "/" + segments.slice(0, i + 1).join("/");
        const label = routeLabels[seg] || decodeURIComponent(seg);
        const isLast = i === segments.length - 1;

        return (
          <span key={path} className="flex items-center gap-1.5">
            <ChevronRight className="h-3 w-3" />
            {isLast ? (
              <span className="text-foreground font-medium">{label}</span>
            ) : (
              <Link to={path} className="hover:text-foreground transition-colors duration-150">
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
