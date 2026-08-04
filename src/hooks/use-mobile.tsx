import * as React from "react";

const MOBILE_BREAKPOINT = 768;

function detectMobile(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < MOBILE_BREAKPOINT;
}

export function useIsMobile() {
  // Initialize synchronously so the very first render already knows the form factor.
  // Avoids a race where consumers (e.g. ChatPage restore effect) run with the wrong
  // value and end up navigating mobile users into a restored conversation.
  const [isMobile, setIsMobile] = React.useState<boolean>(detectMobile);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
