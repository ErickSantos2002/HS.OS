import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const DISMISS_KEY = "dnos:company-onboarding-banner-dismissed";

export function CompanyOnboardingBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem(DISMISS_KEY) === "1") return;
    (async () => {
      const { data } = await supabase
        .from("company_profile")
        .select("company_name")
        .limit(1)
        .maybeSingle();
      if (!data?.company_name) setShow(true);
    })();
  }, []);

  if (!show) return null;

  return (
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2.5">
      <Building2 className="h-4 w-4 text-amber-400 shrink-0" />
      <p className="text-xs text-foreground flex-1">
        Complete o perfil da empresa para que seus agentes conheçam o negócio.
      </p>
      <Link
        to="/settings?tab=empresa"
        className="text-xs font-medium text-primary hover:underline whitespace-nowrap"
      >
        Configurar
      </Link>
      <button
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, "1");
          setShow(false);
        }}
        className="text-muted-foreground hover:text-foreground"
        aria-label="Dispensar"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
