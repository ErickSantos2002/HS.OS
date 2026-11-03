import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      // "Sistema" existe para o tema do app do celular (Eu → Tema). Quem
      // nunca escolheu continua no escuro de sempre (`defaultTheme`).
      enableSystem
      storageKey="hsos-theme"
    >
      {children}
    </NextThemesProvider>
  );
}