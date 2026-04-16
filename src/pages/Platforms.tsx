import { motion } from "framer-motion";
import {
  Database,
  Kanban,
  CheckSquare,
  LayoutDashboard,
  Table,
  Sheet,
  BarChart3,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AuthGuard } from "@/components/AuthGuard";
import { AppTopNav } from "@/components/AppTopNav";
import type { LucideIcon } from "lucide-react";
import { startNotionOAuth } from "@/lib/startNotionOAuth";

interface Platform {
  name: string;
  icon: LucideIcon;
  status: "live" | "coming-soon" | "phase-3";
  description: string;
}

/** Order matches PRD Phase 2 emphasis: Notion live, then Trello/Todoist/Asana, then Airtable/Sheets, enterprise Phase 3. */
const platforms: Platform[] = [
  {
    name: "Notion",
    icon: Database,
    status: "live",
    description: "Pages, databases, and relations synced to your local vault.",
  },
  {
    name: "Trello",
    icon: Kanban,
    status: "coming-soon",
    description: "Boards, lists, and cards with attachments and checklists.",
  },
  {
    name: "Todoist",
    icon: CheckSquare,
    status: "coming-soon",
    description: "Projects and tasks as Markdown with priority and due dates.",
  },
  {
    name: "Asana",
    icon: LayoutDashboard,
    status: "coming-soon",
    description: "Workspaces, projects, and custom fields for premium teams.",
  },
  {
    name: "Airtable",
    icon: Table,
    status: "coming-soon",
    description: "Bases, tables, and views exported as CSV and JSON.",
  },
  {
    name: "Google Sheets",
    icon: Sheet,
    status: "coming-soon",
    description: "Live sync your Notion databases to spreadsheets.",
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

function statusBadge(status: Platform["status"]) {
  switch (status) {
    case "live":
      return (
        <Badge className="bg-primary/20 text-primary border-primary/30 hover:bg-primary/20">
          Live
        </Badge>
      );
    case "coming-soon":
      return (
        <Badge variant="outline" className="text-muted-foreground border-border">
          Coming Soon
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
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <AppTopNav active="platforms" />

      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {platforms.map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
              className={`rounded-xl border bg-card/50 backdrop-blur-sm p-5 flex flex-col gap-3 transition-transform hover:-translate-y-0.5 ${
                p.status === "live"
                  ? "border-primary/30 shadow-[0_0_12px_hsl(40_80%_55%/0.08)]"
                  : "border-border/60"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                    p.status === "live"
                      ? "bg-primary/15 border border-primary/20"
                      : "bg-secondary/60 border border-border/40"
                  }`}
                >
                  <p.icon
                    className={`w-5 h-5 ${p.status === "live" ? "text-primary" : "text-muted-foreground"}`}
                  />
                </div>
                {statusBadge(p.status)}
              </div>

              <div className="flex-1 min-h-0">
                <h3 className="text-sm font-semibold text-foreground">{p.name}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed mt-1">{p.description}</p>
              </div>

              {p.name === "Notion" && p.status === "live" ? (
                <Button size="sm" className="w-full shrink-0" onClick={() => void startNotionOAuth()}>
                  Connect Notion
                </Button>
              ) : null}
            </motion.div>
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center text-sm text-muted-foreground mt-10"
        >
          More connectors are on the way. Your data, from every platform, in one vault.
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
