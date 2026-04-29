import { useMemo, useState } from "react";
import { CheckCircle2, Circle, FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTodoistProjects, useTodoistTasks } from "@/hooks/useTodoistData";
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

/** Strip common Markdown syntax for plain-text display. */
function stripMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/gs, "$2")
    .replace(/(\*|_)(.*?)\1/gs, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

const PRIORITY_LABEL: Record<number, { label: string; className: string }> = {
  4: { label: "P1", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  3: { label: "P2", className: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  2: { label: "P3", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  1: { label: "P4", className: "bg-muted text-muted-foreground border-border/40" },
};

export function TodoistBrowsePanel({ connectorId }: { connectorId?: string }) {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const { data: projects = [], isLoading: loadingProjects } = useTodoistProjects(connectorId);
  const { data: tasks = [], isLoading: loadingTasks } = useTodoistTasks(
    connectorId,
    selectedProject ?? undefined,
  );

  const q = query.trim().toLowerCase();
  const filteredTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (t.content ?? "").toLowerCase().includes(q) ||
          (t.description ?? "").toLowerCase().includes(q),
      ),
    [tasks, q],
  );

  const loading = loadingProjects || loadingTasks;

  if (!connectorId) {
    return (
      <PanelEmptyState icon={FolderOpen}>
        Choose <strong className="text-foreground">Todoist</strong> in{" "}
        <strong className="text-foreground">Show data from</strong> above.
      </PanelEmptyState>
    );
  }

  if (!loading && projects.length === 0) {
    return (
      <PanelEmptyState icon={FolderOpen} size="compact">
        Your Todoist account is connected but no projects have been backed up yet. Open the{" "}
        <strong className="text-foreground">Dashboard</strong> and press{" "}
        <strong className="text-foreground">Sync Now</strong> on the Todoist card.
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

        {projects.map((p) => (
          <PanelSidebarButton
            key={p.id}
            active={selectedProject === p.id}
            onClick={() => setSelectedProject(p.id)}
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0 border border-current/30"
              style={{ background: p.color ?? "currentColor", opacity: 0.7 }}
              aria-hidden
            />
            <span className="truncate">{p.name}</span>
            {p.is_favorite && (
              <span className="ml-auto text-[10px] text-amber-400" aria-hidden>
                ★
              </span>
            )}
          </PanelSidebarButton>
        ))}
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
        />

        {loading && <PanelSkeleton rows={5} height="h-10" />}

        {!loading && filteredTasks.length === 0 && (
          <PanelNoResults
            message={q ? "No tasks match your search." : "No tasks in this project yet."}
          />
        )}

        {!loading && filteredTasks.length > 0 && (
          <div className="space-y-1.5">
            {filteredTasks.map((t) => {
              const pri = PRIORITY_LABEL[t.priority] ?? PRIORITY_LABEL[1];
              const isCompleted = !!t.completed_at;
              return (
                <div
                  key={t.id}
                  className={[
                    "flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors",
                    isCompleted
                      ? "border-border/40 bg-card/20 opacity-60"
                      : "border-border/60 bg-card/40 hover:bg-card/70",
                  ].join(" ")}
                >
                  {isCompleted ? (
                    <CheckCircle2
                      className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400"
                      aria-hidden
                    />
                  ) : (
                    <Circle
                      className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground/50"
                      aria-hidden
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p
                      className={[
                        "text-sm font-medium leading-snug",
                        isCompleted ? "line-through text-muted-foreground" : "",
                      ].join(" ")}
                    >
                      {stripMarkdown(t.content ?? "")}
                    </p>
                    {t.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {stripMarkdown(t.description)}
                      </p>
                    )}
                    {t.due && (
                      <p className="text-[11px] text-muted-foreground/70 mt-1">
                        Due {new Date(t.due).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  {t.priority > 1 && (
                    <Badge
                      variant="outline"
                      className={`text-[10px] shrink-0 ${pri.className}`}
                    >
                      {pri.label}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </PanelContent>
    </PanelShell>
  );
}
