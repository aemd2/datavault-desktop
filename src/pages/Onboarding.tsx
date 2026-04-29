/**
 * Onboarding — shown to new users after their first login.
 *
 * Step 1: Choose where to save vault files (local folder picker)
 * Step 2: Add your first connection (pick a platform)
 *
 * New users default to the Free plan. Plan upgrades happen later from the
 * Billing page — this flow keeps onboarding focused on the two questions
 * a fresh user actually needs answered: "where do my files live?" and
 * "which app do I want to back up first?".
 *
 * Completion is tracked in localStorage ("onboarding_done").
 * App.tsx redirects here when: user is logged in + no connectors + not done.
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  FolderOpen,
  ChevronRight,
  Database,
  Kanban,
  CheckSquare,
  LayoutDashboard,
  Table,
  Sheet,
  FileText,
  Loader2,
  HardDrive,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { startNotionOAuth } from "@/lib/startNotionOAuth";
import { startTrelloOAuth } from "@/lib/startTrelloOAuth";
import { startTodoistOAuth } from "@/lib/startTodoistOAuth";
import { startAsanaOAuth } from "@/lib/startAsanaOAuth";
import { startAirtableOAuth } from "@/lib/startAirtableOAuth";
import { startGoogleSheetsOAuth } from "@/lib/startGoogleSheetsOAuth";
import { startObsidianConnect } from "@/lib/startObsidianConnect";
import { useConnectors } from "@/hooks/useConnectors";
import { useSubscription } from "@/hooks/useSubscription";
import { ConnectorLimitDialog } from "@/components/ConnectorLimitDialog";
import { friendlyConnectorLabel } from "@/lib/connectorDisplay";

// ─── Platform definitions ─────────────────────────────────────────────────────

const PLATFORMS = [
  { id: "notion", name: "Notion", icon: Database, localOnly: false, onConnect: () => void startNotionOAuth() },
  { id: "trello", name: "Trello", icon: Kanban, localOnly: false, onConnect: () => void startTrelloOAuth() },
  { id: "todoist", name: "Todoist", icon: CheckSquare, localOnly: false, onConnect: () => void startTodoistOAuth() },
  { id: "asana", name: "Asana", icon: LayoutDashboard, localOnly: false, onConnect: () => void startAsanaOAuth() },
  { id: "airtable", name: "Airtable", icon: Table, localOnly: false, onConnect: () => void startAirtableOAuth() },
  { id: "google-sheets", name: "Google Sheets", icon: Sheet, localOnly: false, onConnect: () => void startGoogleSheetsOAuth() },
  { id: "obsidian", name: "Obsidian", icon: FileText, localOnly: true, onConnect: () => void startObsidianConnect() },
] as const;

const PLAN_LIMITS: Record<string, number> = { free: 1, managed: 3, enterprise: 9999 };

// ─── Step indicator ──────────────────────────────────────────────────────────

function StepDot({ step, current, done }: { step: number; current: number; done: boolean }) {
  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all
      ${done ? "bg-primary text-primary-foreground" : step === current ? "bg-primary/20 border-2 border-primary text-primary" : "bg-muted/40 text-muted-foreground"}`}>
      {done ? <Check className="w-4 h-4" /> : step}
    </div>
  );
}

function StepBar({ current }: { current: number }) {
  const labels = ["Vault folder", "First connection"];
  return (
    <div className="flex items-center gap-0 justify-center mb-10">
      {labels.map((label, i) => (
        <div key={label} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <StepDot step={i + 1} current={current} done={i + 1 < current} />
            <span className={`text-[10px] font-medium ${i + 1 === current ? "text-primary" : "text-muted-foreground/60"}`}>
              {label}
            </span>
          </div>
          {i < labels.length - 1 && (
            <div className={`w-16 h-0.5 mb-4 mx-1 ${i + 1 < current ? "bg-primary" : "bg-border/60"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Step 1: Vault folder ────────────────────────────────────────────────────

function VaultStep({ onNext }: { onNext: (vaultPath: string) => void }) {
  const [chosenPath, setChosenPath] = useState<string | null>(null);
  const [defaultPath, setDefaultPath] = useState<string>("Documents/DataVault");
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    // Pre-fill with default suggestion
    window.electronAPI?.vault?.getDefaultPath?.().then((p) => {
      setDefaultPath(p);
    });
    // If already set (e.g. user went back), show existing
    window.electronAPI?.vault?.getStoredPath?.().then((p) => {
      if (p) setChosenPath(p);
    });
  }, []);

  const handleChoose = async () => {
    setPicking(true);
    try {
      const picked = await window.electronAPI?.vault?.choosePath?.();
      if (picked) setChosenPath(picked);
    } finally {
      setPicking(false);
    }
  };

  const displayPath = chosenPath ?? defaultPath;
  const isElectron = !!window.electronAPI?.vault?.choosePath;

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-foreground">Where should we save your data?</h1>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          DataVault saves copies of your data as plain files on your computer — like Obsidian.
          Choose where to put them.
        </p>
      </div>

      <div className="rounded-xl border border-border/60 bg-card/40 p-6 space-y-4">
        {/* Current path display */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
            <FolderOpen className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">
              {chosenPath ? "Vault folder" : "Default location"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate" title={displayPath}>
              {displayPath}
            </p>
          </div>
          {chosenPath && <Check className="w-5 h-5 text-emerald-400 shrink-0 mt-2.5" />}
        </div>

        {/* Explainer */}
        <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
          <HardDrive className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
          Your backed-up notes, tasks, and databases are saved here as Markdown and JSON files.
          You can open them in any editor, Obsidian, or VS Code — even without DataVault.
        </div>

        {isElectron ? (
          <Button variant="outline" size="sm" onClick={handleChoose} disabled={picking} className="w-full">
            {picking ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FolderOpen className="w-4 h-4 mr-2" />}
            {chosenPath ? "Change folder" : "Choose folder"}
          </Button>
        ) : (
          <p className="text-xs text-amber-400/80 text-center">
            Folder selection is only available in the desktop app.
          </p>
        )}
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" size="sm" onClick={() => onNext(displayPath)} className="text-muted-foreground">
          Skip for now
        </Button>
        <Button
          size="lg"
          onClick={() => onNext(displayPath)}
          className="gap-2"
        >
          {chosenPath ? "Use this folder" : "Use default location"}
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Step 2: First connection ─────────────────────────────────────────────────

function ConnectStep({ onSkip }: { onSkip: () => void }) {
  const navigate = useNavigate();
  const { data: connectors = [] } = useConnectors();
  const { data: subscription } = useSubscription();
  const [limitOpen, setLimitOpen] = useState(false);

  const plan = subscription?.plan ?? "free";
  const limit = PLAN_LIMITS[plan] ?? 1;
  // Cloud connectors only — Obsidian is local-only and always free.
  const cloudConnectors = connectors.filter((c) => c.type !== "obsidian");
  const cloudCount = cloudConnectors.length;
  const atLimit = cloudCount >= limit;
  const existingCloudName = cloudConnectors[0]
    ? friendlyConnectorLabel(cloudConnectors[0].type)
    : undefined;

  const handlePlatformClick = (platform: typeof PLATFORMS[number]) => {
    // Obsidian is always free — never gated.
    if (platform.localOnly) {
      platform.onConnect();
      setTimeout(() => navigate("/dashboard"), 500);
      return;
    }
    // Block cloud connectors when the user already has one on Free.
    if (atLimit) {
      setLimitOpen(true);
      return;
    }
    platform.onConnect();
    setTimeout(() => navigate("/dashboard"), 500);
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-foreground">Pick your first app</h1>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          You're on the <span className="font-medium text-foreground">Free plan</span> — connect{" "}
          <span className="font-medium text-foreground">1 cloud app</span>.{" "}
          <span className="text-emerald-400/90">Obsidian is always free</span> on top of any plan.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {PLATFORMS.map((platform) => {
          const Icon = platform.icon;
          return (
            <button
              key={platform.id}
              type="button"
              onClick={() => handlePlatformClick(platform)}
              className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 hover:bg-card/80 hover:border-primary/30 transition-all px-4 py-4 text-left group"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-foreground">{platform.name}</span>
                {platform.localOnly && (
                  <p className="text-[10px] text-emerald-400/80 leading-tight mt-0.5">
                    Always free · local only
                  </p>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
            </button>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Cloud services count toward your plan limit.{" "}
        <span className="text-emerald-400/90">Obsidian is always free</span> — it reads files locally, no API needed.
      </p>

      <div className="flex justify-center">
        <Button variant="ghost" size="sm" onClick={onSkip} className="text-muted-foreground text-xs">
          I'll add a connection later → go to dashboard
        </Button>
      </div>

      <ConnectorLimitDialog
        open={limitOpen}
        onOpenChange={setLimitOpen}
        currentConnectorName={existingCloudName}
        planName={plan === "managed" ? "Managed" : plan === "enterprise" ? "Enterprise" : "Free"}
        limit={limit}
      />
    </div>
  );
}

// ─── Main Onboarding component ────────────────────────────────────────────────

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  const finish = () => {
    localStorage.setItem("onboarding_done", "1");
    navigate("/dashboard", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <span className="text-sm font-semibold text-foreground">DataVault</span>
        </div>
        <span className="text-xs text-muted-foreground">Setup</span>
      </div>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-2xl">
          <StepBar current={step} />

          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
            >
              {step === 1 && (
                <VaultStep
                  onNext={(_path) => setStep(2)}
                />
              )}
              {step === 2 && (
                <ConnectStep onSkip={finish} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
