import { Link } from "react-router-dom";
import { LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotionDatabases, type NotionDatabaseRow } from "@/hooks/useNotionDatabases";
import { PanelSkeleton } from "./BrowsePanelKit";

function DatabaseCard({ db }: { db: NotionDatabaseRow }) {
  return (
    <li className="glass-card rounded-xl border border-border/60 p-4 flex items-start gap-3">
      <div className="w-10 h-10 rounded-lg bg-gradient-gold/10 border border-primary/15 flex items-center justify-center shrink-0">
        <LayoutGrid className="w-5 h-5 text-primary" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm text-foreground leading-snug">
          {db.title || "Untitled table"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">Copied from your Notion workspace</p>
      </div>
    </li>
  );
}

interface DatabaseListProps {
  connectorId?: string;
}

export function DatabaseList({ connectorId }: DatabaseListProps) {
  const { data: databases = [], isLoading, error } = useNotionDatabases(connectorId);

  if (isLoading) {
    return <PanelSkeleton rows={4} height="h-12" />;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-2">
        <p className="text-sm text-foreground font-medium">We couldn&apos;t load your tables</p>
        <p className="text-sm text-muted-foreground">
          Try refreshing. If you haven&apos;t synced yet, open the dashboard and run{" "}
          <strong className="text-foreground">Sync Now</strong>.
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/dashboard">Open dashboard</Link>
        </Button>
      </div>
    );
  }

  if (databases.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-muted/10 p-6 space-y-3 text-center sm:text-left">
        <p className="text-sm text-foreground font-medium">No tables in your backup yet</p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Notion &quot;databases&quot; (tables, boards, calendars) appear here after a sync. If you only use pages,
          stay on the Pages tab.
        </p>
        <Button variant="secondary" size="sm" asChild>
          <Link to="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        These are your Notion databases we&apos;ve copied. Row-level data lives in your full backup (files or
        database); here you can see which tables synced.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {databases.map((db) => (
          <DatabaseCard key={db.id} db={db} />
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {databases.length} table{databases.length !== 1 ? "s" : ""} in this backup.
      </p>
    </div>
  );
}
