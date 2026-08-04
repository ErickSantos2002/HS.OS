export const CHAT_COMPOSER_MIN_HEIGHT = 40;
export const CHAT_COMPOSER_MAX_HEIGHT = 120;

let resizeRafId: number | null = null;

export function resizeComposerTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return;

  if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);

  resizeRafId = requestAnimationFrame(() => {
    resizeRafId = null;
    element.style.height = "auto";
    const nextHeight = Math.min(
      Math.max(element.scrollHeight, CHAT_COMPOSER_MIN_HEIGHT),
      CHAT_COMPOSER_MAX_HEIGHT,
    );

    element.style.height = `${nextHeight}px`;
    element.style.overflowY = element.scrollHeight > CHAT_COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
  });
}

export function resetComposerTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return;
  if (resizeRafId !== null) {
    cancelAnimationFrame(resizeRafId);
    resizeRafId = null;
  }
  element.style.height = `${CHAT_COMPOSER_MIN_HEIGHT}px`;
  element.style.overflowY = "hidden";
}
