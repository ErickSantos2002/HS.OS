import { useEffect, useState } from "react";

import { useIsMobile } from "@/hooks/use-mobile";

// Ignore tiny visual viewport fluctuations on mobile (URL bar show/hide on iOS Safari
// triggers sub-pixel scroll deltas that previously caused the layout to "jitter").
const NOISE_THRESHOLD_PX = 24;
// Anything above this means the keyboard is open (or a large overlay is present).
const KEYBOARD_THRESHOLD_PX = 96;

export function useMobileChatViewport() {
  const isMobile = useIsMobile();
  const [bottomOffset, setBottomOffset] = useState(0);

  useEffect(() => {
    if (!isMobile || typeof window === "undefined" || !window.visualViewport) {
      setBottomOffset(0);
      return;
    }

    const viewport = window.visualViewport;
    let frame = 0;

    const updateOffset = () => {
      frame = 0;
      const nextOffset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
      setBottomOffset((current) => {
        // Snap small values to 0 and ignore noise unless we cross the keyboard threshold.
        const normalized = nextOffset < NOISE_THRESHOLD_PX ? 0 : nextOffset;
        const wasKeyboardOpen = current > KEYBOARD_THRESHOLD_PX;
        const isKeyboardOpen = normalized > KEYBOARD_THRESHOLD_PX;
        // Only commit small changes when the keyboard state actually flips —
        // this kills the jitter caused by iOS Safari's URL bar.
        if (wasKeyboardOpen === isKeyboardOpen && Math.abs(normalized - current) < NOISE_THRESHOLD_PX) {
          return current;
        }
        return normalized;
      });
    };

    const scheduleUpdate = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateOffset);
    };

    scheduleUpdate();
    viewport.addEventListener("resize", scheduleUpdate);
    // Intentionally NOT listening to visualViewport "scroll" — on iOS that fires
    // continuously while the user scrolls content, which previously made the
    // chat container shake as offsets bounced around by a few pixels.
    window.addEventListener("orientationchange", scheduleUpdate);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("orientationchange", scheduleUpdate);
    };
  }, [isMobile]);

  return {
    bottomOffset,
    isKeyboardOpen: bottomOffset > KEYBOARD_THRESHOLD_PX,
  };
}
