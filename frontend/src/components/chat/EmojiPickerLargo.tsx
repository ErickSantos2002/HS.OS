/**
 * Seletor de emoji de largura total, para folhas de baixo no celular.
 *
 * O `EmojiPicker` de 320px do `ChannelChat`/`ThreadPanel` vive num popover e
 * ficava no limite de uma tela de 360px (spec 2026-11-03, Frente C6). Aqui a
 * largura é a da folha.
 */
import EmojiPickerReact, { Theme as EmojiTheme } from "emoji-picker-react";
import { useTheme } from "next-themes";

export default function EmojiPickerLargo({ onSelect, altura = 360 }: { onSelect: (emoji: string) => void; altura?: number }) {
  const { resolvedTheme } = useTheme();
  return (
    <div className="w-full" data-vaul-no-drag onWheel={(e) => e.stopPropagation()}>
      <EmojiPickerReact
        onEmojiClick={(emojiData) => onSelect(emojiData.emoji)}
        width="100%"
        height={altura}
        skinTonesDisabled
        previewConfig={{ showPreview: false }}
        theme={resolvedTheme === "light" ? EmojiTheme.LIGHT : EmojiTheme.DARK}
      />
    </div>
  );
}
