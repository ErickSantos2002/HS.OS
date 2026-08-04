import TaskLoopPanel from "@/components/dashboard/TaskLoopPanel";
import { ListChecks } from "lucide-react";

export default function TasksPage() {
  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="aurora-glow rounded-2xl px-5 py-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-[hsl(260,70%,55%)] flex items-center justify-center shadow-lg shadow-primary/20">
          <ListChecks className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-lg font-display font-bold text-foreground">Tasks</h1>
          <p className="text-[11px] text-muted-foreground">
            Loop Architecture — acompanhamento de tarefas autônomas em execução
          </p>
        </div>
      </div>
      <TaskLoopPanel />
    </div>
  );
}
