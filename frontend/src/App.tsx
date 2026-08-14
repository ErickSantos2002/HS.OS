import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";

import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import { AuthProvider } from "@/components/AuthGuard";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ThemeProvider } from "@/components/theme-provider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FileSystemProvider } from "@/contexts/FileSystemContext";
import { setQueryClientForSender } from "@/lib/chat-sender";
import { useVersionCheck } from "@/hooks/use-version-check";

import ChatPage from "./pages/ChatPage";
import AgentsPage from "./pages/AgentsPage";
import AgentDetailPage from "./pages/AgentDetailPage";
import TeamsPage from "./pages/TeamsPage";

import SessionsPage from "./pages/SessionsPage";
import SettingsPage from "./pages/SettingsPage";
import SkillsPage from "./pages/SkillsPage";
import ClawHubPage from "./pages/ClawHubPage";
// ⚠️ Arena pausada em 10/08/2026. As três telas estão em `src/_legado/arena/`,
// fora da compilação, e as rotas caem no aviso de "em construção". Para voltar:
// mover os arquivos de volta e trocar os `<ArenaPausada />` pelas páginas
// originais. Ver `docs/EM-CONSTRUCAO.md`.
import EmConstrucao from "./components/EmConstrucao";
import { Swords, MonitorPlay } from "lucide-react";

// ⚠️ Parede de TV pausada em 10/08/2026. A tela está em
// `src/_legado/warroom/WarRoomPage.tsx` e a `warroom-feed` em
// `functions/_pausado/`. Ver `docs/EM-CONSTRUCAO.md`.
const WarRoomPausada = () => (
  <EmConstrucao
    icone={MonitorPlay}
    titulo="War room"
    resumo="O painel de parede está pausado enquanto o resto da plataforma vai ao ar. A ideia continua de pé e o trabalho já feito está guardado."
    oQueEra="Uma tela cheia para espelhar numa TV, mostrando os agentes trabalhando ao vivo: entregas, ações autônomas e conversas conforme aconteciam."
  />
);

const ArenaPausada = () => (
  <EmConstrucao
    icone={Swords}
    titulo="Arena"
    resumo="A sala de debate entre agentes está pausada enquanto o resto da plataforma vai ao ar. A ideia continua de pé e o trabalho já feito está guardado."
    oQueEra="Vários agentes com papéis atribuídos respondendo à mesma pergunta em rodadas, cada um lendo e reagindo ao que os anteriores disseram."
  />
);
import LoginPage from "./pages/LoginPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import ResultsPage from "./pages/ResultsPage";
import KnowledgeBasePage from "./pages/KnowledgeBasePage";
import DashboardPage from "./pages/DashboardPage";
import TasksPage from "./pages/TasksPage";
import AutomacoesPage from "./pages/AutomacoesPage";
import { useIsMobile } from "@/hooks/use-mobile";
import WikiHtmlPreviewPage from "./pages/WikiHtmlPreviewPage";
import MonitoringPage from "./pages/MonitoringPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import PublicArtifactPage from "./pages/PublicArtifactPage";
import ArtifactsPage from "./pages/ArtifactsPage";
import PublicLiveArtifactPage from "./pages/PublicLiveArtifactPage";

// ProfilePage removed – merged into SettingsPage
// ChannelsPage merged into ChatPage
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();
setQueryClientForSender(queryClient);

// Home: redirect everyone to /chat as the default entry point
function HomePage() {
  return <Navigate to="/chat" replace />;
}

const App = () => {
  useVersionCheck();
  return (
  <QueryClientProvider client={queryClient}>
    <ErrorBoundary>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthProvider>
              <FileSystemProvider>
              <Routes>
                {/* Public routes */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/artifact/:id" element={<PublicArtifactPage />} />
                <Route path="/p/:slug" element={<PublicLiveArtifactPage />} />
                <Route path="/wiki-html-preview" element={<WikiHtmlPreviewPage />} />

                {/* War room — exige login como qualquer tela, mas sem
                    AppLayout: é uma tela cheia para espelhar na TV. */}
                <Route
                  path="/warroom"
                  element={
                    <ProtectedRoute>
                      <WarRoomPausada />
                    </ProtectedRoute>
                  }
                />

                {/* O wizard de /setup foi aposentado — ver src/_legado/setup/.
                    Ele era o onboarding do cliente da dn.ia (contratar VPS na
                    Hostinger com cupom, publicar no Lovable, rodar instalador);
                    nada disso se aplica aqui. Sem ele e sem o OnboardingGate,
                    o login cai direto no /chat. */}

                {/* Protected routes inside layout */}
                <Route
                  path="/*"
                  element={
                    <ProtectedRoute>
                        <AppLayout>
                        <Routes>
                          <Route path="/" element={<HomePage />} />
                          <Route path="/chat" element={<ChatPage />} />
                          <Route path="/tasks" element={<TasksPage />} />
                          <Route
                            path="/agents"
                            element={
                              // Administração de agente é do administrador. O
                              // colaborador chega aos agentes dele pelo /chat,
                              // que é o ponto: aqui se edita, se lê os sete
                              // arquivos (o prompt de sistema) e se vê custo.
                              <ProtectedRoute allowedRoles={["administrador"]}>
                                <AgentsPage />
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/agents/:agentId"
                            element={
                              <ProtectedRoute allowedRoles={["administrador"]}>
                                <AgentDetailPage />
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/teams"
                            element={
                              <ProtectedRoute allowedRoles={["administrador", "colaborador"]}>
                                <TeamsPage />
                              </ProtectedRoute>
                            }
                          />
                          
                          <Route
                            path="/sessions"
                            element={
                              <ProtectedRoute allowedRoles={["administrador", "colaborador"]}>
                                <SessionsPage />
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/skills"
                            element={
                              <ProtectedRoute allowedRoles={["administrador", "colaborador"]}>
                                <SkillsPage />
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/skills/clawhub"
                            element={
                              <ProtectedRoute allowedRoles={["administrador", "colaborador"]}>
                                <ClawHubPage />
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/arenas"
                            element={
                              <ProtectedRoute allowedRoles={["administrador", "colaborador"]}>
                                <ArenaPausada />
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/arenas/new"
                            element={
                              <ProtectedRoute allowedRoles={["administrador", "colaborador"]}>
                                <ArenaPausada />
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/arenas/:arenaId"
                            element={
                              <ProtectedRoute allowedRoles={["administrador", "colaborador"]}>
                                <ArenaPausada />
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/settings"
                            element={
                              <ProtectedRoute>
                                <SettingsPage />
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/results"
                            element={
                              <ProtectedRoute>
                                <ResultsPage />
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/base-de-conhecimento"
                            element={
                              <ProtectedRoute>
                                <KnowledgeBasePage />
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/automacoes"
                            element={
                              <ProtectedRoute>
                                <AutomacoesPage />
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/artefatos"
                            element={
                              <ProtectedRoute>
                                <ArtifactsPage />
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/artefatos/:id"
                            element={
                              <ProtectedRoute>
                                <ArtifactsPage />
                              </ProtectedRoute>
                            }
                          />
                          <Route path="/dnos" element={<Navigate to="/settings?tab=hsos" replace />} />

                          <Route
                            path="/monitoring"
                            element={
                              <ProtectedRoute allowedRoles={["administrador"]}>
                                <MonitoringPage />
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/analytics"
                            element={
                              <ProtectedRoute allowedRoles={["administrador"]}>
                                <AnalyticsPage />
                              </ProtectedRoute>
                            }
                          />
                          <Route path="/documentation" element={<Navigate to="/settings?tab=documentation" replace />} />
                          <Route path="/mission-control" element={<Navigate to="/settings?tab=hsos" replace />} />
                          <Route path="/users" element={<Navigate to="/settings?tab=users" replace />} />
                          <Route path="/profile" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
                          <Route path="*" element={<NotFound />} />
                        </Routes>
                        </AppLayout>
                    </ProtectedRoute>
                  }
                />
              </Routes>
              </FileSystemProvider>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </QueryClientProvider>
  );
};

export default App;
