import { useMemo, useState } from "react";
import { CheckCircle2, Circle, FolderOpen, FolderArchive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAsanaProjects, useAsanaTasks } from "@/hooks/useAsanaData";
import {
  PanelShell,
  PanelSidebar,
  PanelSidebarLabel,
  PanelSidebarButton,
  PanelContent,
  PanelSearchRow,
  PanelSkeleton,
  PanelEmptyState,
  PanelNoResults,
} from "./BrowsePanelKit";

export function AsanaBrowsePanel({ connectorId }: { connectorId?: string }) {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);

  const { data: projects = [], isLoading: loadingProjects } = useAsanaProjects(connectorId);
  const { data: tasks = [], isLoading: loadingTasks } = useAsanaTasks(
    connectorId,
    selectedProject ?? undefined,
  );

  const q = query.trim().toLowerCase();
  const filteredTasks = useMemo(
    () =>
      tasks.filter((t) => {
        if (!showCompleted && t.completed) return false;
        return (
          (t.name ?? "").toLowerCase().includes(q) ||
          (t.notes ?? "").toLowerCase().includes(q)
        );
      }),
    [tasks, q, showCompleted],
  );

  const loading = loadingProjects || loadingTasks;
  const activeProjects = projects.filter((p) => !p.archived);
  const archivedProjects = projects.filter((p) => p.archived);

  if (!connectorId) {
    return (
      <PanelEmptyState icon={FolderOpen}>
        Choose <strong className="text-foreground">Asana</strong> in{" "}
        <strong className="text-foreground">Show data from</strong> above.
      </PanelEmptyState>
    );
  }

  if (!loading && projects.length === 0) {
    return (
      <PanelEmptyState icon={FolderOpen} size="compact">
        Your Asana account is connected but no projects have been backed up yet. Open the{" "}
        <strong className="text-foreground">Dashboard</strong> and press{" "}
        <strong className="text-foreground">Sync Now</strong> on the Asana card.
      </PanelEmptyState>
    );
  }

  return (
    <PanelShell>
      {/* Sidebar — projects */}
      <PanelSidebar>
        <PanelSidebarLabel>Projects</PanelSidebarLabel>

        <PanelSidebarButton
          icon={FolderOpen}
          active={selectedProject === null}
          onClick={() => setSelectedProject(null)}
        >
          All projects
        </PanelSidebarButton>

        {activeProjects.map((p) => (
          <PanelSidebarButton
            key={p.id}
            active={selectedProject === p.id}
            onClick={() => setSelectedProject(p.id)}
          >
            <span className="w-2 h-2 rounded-full shrink-0 bg-primary/60" aria-hidden />
            <span className="truncate">{p.name}</span>
          </PanelSidebarButton>
        ))}

        {archivedProjects.length > 0 && (
          <>
            <PanelSidebarLabel>Archived</PanelSidebarLabel>
            {archivedProjects.map((p) => (
              <PanelSidebarButton
                key={p.id}
                active={selectedProject === p.id}
                onClick={() => setSelectedProject(p.id)}
                icon={FolderArchive}
                className="opacity-50 [&.bg-primary\\/10]:!opacity-100"
              >
                <span className="truncate">{p.name}</span>
              </PanelSidebarButton>
            ))}
          </>
        )}
      </PanelSidebar>

      {/* Main — tasks */}
      <PanelContent space="space-y-3">
        <PanelSearchRow
          value={query}
          onChange={setQuery}
          placeholder="Search tasks…"
          count={filteredTasks.length}
          countLabel="task"
          loading={loading}
        >
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            className={[
              "ml-auto shrink-0 text-xs px-2.5 py-1.5 rounded-md border transition-colors",
              showCompleted
                ? "bg-primary/10 text-primary border-primary/30"
                : "text-muted-foreground border-border/60 hover:text-foreground hover:bg-muted/30",
            ].join(" ")}
          >
            {showCompleted ? "Hide completed" : "Show completed"}
          </button>
        </PanelSearchRow>

        {loading && <PanelSkeleton rows={5} height="h-10" />}

        {!loading && filteredTasks.length === 0 && (
          <PanelNoResults
            message={q ? "No tasks match your search." : "No tasks in this project yet."}
          />
        )}

        {!loading && filteredTasks.length > 0 && (
          <div className="space-y-1.5">
            {filteredTasks.map((t) => (
              <div
                key={t.id}
                className={[
                  "flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors",
                  t.completed
                    ? "border-border/40 bg-card/20 opacity-60"
                    : "border-border/60 bg-card/40 hover:bg-card/70",
                ].join(" ")}
              >
                {t.completed ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" aria-hidden />
                ) : (
                  <Circle className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground/50" aria-hidden />
                )}
                <div className="flex-1 min-w-0">
                  <p
                    className={[
                      "text-sm font-medium leading-snug",
                      t.completed ? "line-through text-muted-foreground" : "",
                    ].join(" ")}
                  >
                    {t.name}
                  </p>
                  {t.notes && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.notes}</p>
                  )}
                </div>
                {t.due_on && (
                  <Badge
                    variant="outline"
                    className="text-[10px] shrink-0 text-muted-foreground border-border/50"
                  >
                    {new Date(t.due_on).toLocaleDateString()}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}

        {!loading && !showCompleted && tasks.filter((t) => t.completed).length > 0 && (
          <p className="text-[11px] text-muted-foreground text-right">
            {tasks.filter((t) => t.completed).length} completed hidden
          </p>
        )}
      </PanelContent>
    </PanelShell>
  );
}
