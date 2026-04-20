import { useMemo } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Database,
  Kanban,
  CheckSquare,
  LayoutDashboard,
  Table,
  Sheet,
  BarChart3,
  Users,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AuthGuard } from "@/components/AuthGuard";
import { AppTopNav } from "@/components/AppTopNav";
import { useConnectors } from "@/hooks/useConnectors";
import type { LucideIcon } from "lucide-react";
import { startNotionOAuth } from "@/lib/startNotionOAuth";
import { startTrelloOAuth } from "@/lib/startTrelloOAuth";
import { startTodoistOAuth } from "@/lib/startTodoistOAuth";
import { startAsanaOAuth } from "@/lib/startAsanaOAuth";
import { startAirtableOAuth } from "@/lib/startAirtableOAuth";
import { startGoogleSheetsOAuth } from "@/lib/startGoogleSheetsOAuth";

type PlatformStatus = "live" | "beta" | "phase-3";

interface Platform {
  name: string;
  icon: LucideIcon;
  status: PlatformStatus;
  description: string;
  /** Matches `connectors.type` when this card can show linked state. */
  connectorType?: string;
  /** Button handler — opens the platform's OAuth flow in the system browser. */
  onConnect?: () => void | Promise<void>;
}

/**
 * Order matches PRD Phase 2 emphasis: Notion live, then the productivity
 * connectors we're rolling out together (Trello/Todoist/Asana/Airtable/Sheets),
 * then Phase 3 enterprise CRM.
 *
 * The five new connectors are marked "beta" until their Edge Functions and
 * developer credentials are live — see `docs/CONNECTOR_SETUP.md`.
 */
const platforms: Platform[] = [
  {
    name: "Notion",
    icon: Database,
    status: "live",
    connectorType: "notion",
    description: "Pages, databases, and relations synced to your local vault — with edits pushed back.",
    onConnect: () => void startNotionOAuth(),
  },
  {
    name: "Trello",
    icon: Kanban,
    status: "beta",
    connectorType: "trello",
    description: "Boards, lists, cards, checklists, and attachments. Push card edits back to Trello.",
    onConnect: () => void startTrelloOAuth(),
  },
  {
    name: "Todoist",
    icon: CheckSquare,
    status: "beta",
    connectorType: "todoist",
    description: "Projects, sections, tasks, labels. Edit locally, push back to Todoist.",
    onConnect: () => void startTodoistOAuth(),
  },
  {
    name: "Asana",
    icon: LayoutDashboard,
    status: "beta",
    connectorType: "asana",
    description: "Workspaces, projects, tasks, and custom fields. Two-way sync with Asana.",
    onConnect: () => void startAsanaOAuth(),
  },
  {
    name: "Airtable",
    icon: Table,
    status: "beta",
    connectorType: "airtable",
    description: "Bases, tables, and records with schema. Edit records locally, push back to Airtable.",
    onConnect: () => void startAirtableOAuth(),
  },
  {
    name: "Google Sheets",
    icon: Sheet,
    status: "beta",
    connectorType: "google-sheets",
    description: "All spreadsheets and sheets with cell values. Edits push back as Sheets updates.",
    onConnect: () => void startGoogleSheetsOAuth(),
  },
  {
    name: "Salesforce",
    icon: BarChart3,
    status: "phase-3",
    description: "Enterprise CRM data synced to your vault and Postgres.",
  },
  {
    name: "HubSpot",
    icon: Users,
    status: "phase-3",
    description: "Contacts, deals, and pipelines backed up locally.",
  },
];

function statusBadge(status: PlatformStatus) {
  switch (status) {
    case "live":
      return (
        <Badge className="bg-primary/20 text-primary border-primary/30 hover:bg-primary/20">
          Live
        </Badge>
      );
    case "beta":
      return (
        <Badge variant="outline" className="text-foreground border-primary/40">
          Beta
        </Badge>
      );
    case "phase-3":
      return (
        <Badge variant="outline" className="text-muted-foreground/60 border-border/60">
          Phase 3
        </Badge>
      );
  }
}

const PlatformsInner = () => {
  const navigate = useNavigate();
  const { data: connectors = [] } = useConnectors();

  const linkedByType = useMemo(() => {
    const m = new Map<string, (typeof connectors)[0]>();
    for (const c of connectors) {
      m.set(c.type.toLowerCase(), c);
    }
    return m;
  }, [connectors]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <AppTopNav active="platforms" />

      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {platforms.map((p, i) => {
            const isConnectable = (p.status === "live" || p.status === "beta") && !!p.onConnect;
            const linked =
              p.connectorType != null ? linkedByType.get(p.connectorType.toLowerCase()) : undefined;
            return (
              <motion.div
                key={p.name}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: i * 0.06 }}
                className={`rounded-xl border bg-card/50 backdrop-blur-sm p-5 flex flex-col gap-3 transition-transform hover:-translate-y-0.5 ${
                  linked
                    ? "border-emerald-500/35 shadow-[0_0_12px_hsl(142_76%_36%/0.12)]"
                    : p.status === "live"
                      ? "border-primary/30 shadow-[0_0_12px_hsl(40_80%_55%/0.08)]"
                      : "border-border/60"
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                      linked
                        ? "bg-emerald-500/15 border border-emerald-500/25"
                        : p.status === "live"
                          ? "bg-primary/15 border border-primary/20"
                          : "bg-secondary/60 border border-border/40"
                    }`}
                  >
                    <p.icon
                      className={`w-5 h-5 ${
                        linked ? "text-emerald-400" : p.status === "live" ? "text-primary" : "text-muted-foreground"
                      }`}
                    />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    {statusBadge(p.status)}
                    {linked ? (
                      <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15 shrink-0">
                        <Check className="w-3 h-3 mr-0.5" aria-hidden />
                        Connected
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <div className="flex-1 min-h-0">
                  <h3 className="text-sm font-semibold text-foreground">{p.name}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-1">{p.description}</p>
                </div>

                {isConnectable ? (
                  linked ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full shrink-0 border-emerald-500/25 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15 hover:text-emerald-50"
                      onClick={() => navigate("/dashboard")}
                    >
                      Open Dashboard for backup
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant={p.status === "live" ? "default" : "outline"}
                      className="w-full shrink-0"
                      onClick={() => void p.onConnect?.()}
                    >
                      Connect {p.name}
                    </Button>
                  )
                ) : null}
              </motion.div>
            );
          })}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center text-sm text-muted-foreground mt-10"
        >
          Beta connectors back up everything their APIs expose, and push your local edits back.
          Your data, from every platform, in one vault.
        </motion.p>
      </main>
    </div>
  );
};

const Platforms = () => (
  <AuthGuard>
    <PlatformsInner />
  </AuthGuard>
);

export default Platforms;
