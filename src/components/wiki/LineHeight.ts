import { Extension } from "@tiptap/core";

export type LineHeightOptions = {
  types: string[];
  defaultLineHeight: string | null;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    lineHeight: {
      setLineHeight: (value: string) => ReturnType;
      unsetLineHeight: () => ReturnType;
    };
  }
}

export const LineHeight = Extension.create<LineHeightOptions>({
  name: "lineHeight",
  addOptions() {
    return { types: ["paragraph", "heading"], defaultLineHeight: null };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: this.options.defaultLineHeight,
            parseHTML: (el) => el.style.lineHeight || null,
            renderHTML: (attrs) => (attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setLineHeight:
        (value: string) =>
        ({ commands }) =>
          this.options.types.every((type) => commands.updateAttributes(type, { lineHeight: value })),
      unsetLineHeight:
        () =>
        ({ commands }) =>
          this.options.types.every((type) => commands.resetAttributes(type, "lineHeight")),
    };
  },
});
