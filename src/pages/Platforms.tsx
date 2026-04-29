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
  ArrowLeft,
  FileText,
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
import { startObsidianConnect } from "@/lib/startObsidianConnect";

type PlatformStatus = "live" | "beta" | "phase-3";

interface Platform {
  name: string;
  icon: LucideIcon;
  status: PlatformStatus;
  description: string;
  connectorType?: string;
  onConnect?: () => void | Promise<void>;
  note?: string;
}

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
    note: 'Google may show an "unverified app" screen. Click Advanced → Go to DataVault to continue — this is expected while our app awaits Google verification.',
    onConnect: () => void startGoogleSheetsOAuth(),
  },
  {
    name: "Obsidian",
    icon: FileText,
    status: "beta",
    connectorType: "obsidian",
    description: "Point at your local Obsidian vault folder — DataVault reads your notes right off disk. No cloud, no sync, no plugin.",
    note: "Obsidian has no cloud API, so this uses a native folder picker instead of an online login. Desktop app only.",
    onConnect: () => void startObsidianConnect(),
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

function StatusBadge({ status }: { status: PlatformStatus }) {
  if (status === "live") {
    return (
      <Badge className="bg-primary/20 text-primary border-primary/30 hover:bg-primary/20 text-xs">
        Live
      </Badge>
    );
  }
  if (status === "beta") {
    return (
      <Badge variant="outline" className="text-foreground border-primary/40 text-xs">
        Beta
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground/50 border-border/40 text-xs">
      Coming soon
    </Badge>
  );
}

const PlatformsInner = () => {
  const navigate = useNavigate();
  const { data: connectors = [] } = useConnectors();

  const linkedByType = useMemo(() => {
    const m = new Map<string, (typeof connectors)[0]>();
    for (const c of connectors) m.set(c.type.toLowerCase(), c);
    return m;
  }, [connectors]);

  const available = platforms.filter((p) => p.status !== "phase-3");
  const comingSoon = platforms.filter((p) => p.status === "phase-3");

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <AppTopNav active="platforms" />

      <main className="max-w-4xl mx-auto w-full px-4 sm:px-6 py-8 space-y-10">

        {/* Page header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Connect platforms</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Link your SaaS tools. DataVault backs them up to your local vault automatically.
            </p>
          </div>
          <Button variant="outline" size="sm" className="shrink-0 self-start sm:self-auto" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Back to vault
          </Button>
        </div>

        {/* Available connectors */}
        <section className="space-y-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            Available now
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {available.map((p, i) => {
              const linked = p.connectorType != null
                ? linkedByType.get(p.connectorType.toLowerCase())
                : undefined;

              return (
                <motion.div
                  key={p.name}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: i * 0.05 }}
                  className={`rounded-xl border bg-card/50 backdrop-blur-sm p-5 flex flex-col gap-4 transition-transform hover:-translate-y-0.5 ${
                    linked
                      ? "border-emerald-500/35 shadow-[0_0_12px_hsl(142_76%_36%/0.12)]"
                      : p.status === "live"
                        ? "border-primary/30 shadow-[0_0_12px_hsl(40_80%_55%/0.08)]"
                        : "border-border/60"
                  }`}
                >
                  {/* Card header */}
                  <div className="flex items-center justify-between gap-2">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
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
                      <StatusBadge status={p.status} />
                      {linked && (
                        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15 text-xs shrink-0">
                          <Check className="w-3 h-3 mr-0.5" aria-hidden />
                          Connected
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Name + description */}
                  <div className="flex-1 space-y-1">
                    <h3 className="text-sm font-semibold">{p.name}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{p.description}</p>
                    {p.note && (
                      <p className="text-xs text-amber-400/80 leading-relaxed mt-2 border-t border-amber-500/20 pt-2">
                        {p.note}
                      </p>
                    )}
                  </div>

                  {/* Action button */}
                  {linked ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full border-emerald-500/25 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15 hover:text-emerald-50"
                      onClick={() => navigate("/dashboard")}
                    >
                      Open vault
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant={p.status === "live" ? "default" : "outline"}
                      className="w-full"
                      onClick={() => void p.onConnect?.()}
                    >
                      Connect {p.name}
                    </Button>
                  )}
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* Coming soon */}
        <section className="space-y-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            Coming in Phase 3
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {comingSoon.map((p, i) => (
              <motion.div
                key={p.name}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: i * 0.05 }}
                className="rounded-xl border border-border/40 bg-card/30 p-5 flex flex-col gap-4 opacity-60"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="w-10 h-10 rounded-xl bg-secondary/40 border border-border/30 flex items-center justify-center shrink-0">
                    <p.icon className="w-5 h-5 text-muted-foreground/60" />
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                <div className="flex-1 space-y-1">
                  <h3 className="text-sm font-semibold text-muted-foreground">{p.name}</h3>
                  <p className="text-xs text-muted-foreground/70 leading-relaxed">{p.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

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
