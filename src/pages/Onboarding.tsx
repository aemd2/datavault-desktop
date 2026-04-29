/**
 * Onboarding — shown to new users after their first login.
 *
 * Step 1: Choose a plan (Free / Managed / Enterprise)
 * Step 2: Choose where to save vault files (local folder picker)
 * Step 3: Add your first connection (pick a platform)
 *
 * Completion is tracked in localStorage ("onboarding_done").
 * App.tsx redirects here when: user is logged in + no connectors + not done.
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/badge";
import { supabase, SUPABASE_URL } from "@/lib/supabase";
import { openExternalUrl } from "@/lib/marketingWeb";
import { startNotionOAuth } from "@/lib/startNotionOAuth";
import { startTrelloOAuth } from "@/lib/startTrelloOAuth";
import { startTodoistOAuth } from "@/lib/startTodoistOAuth";
import { startAsanaOAuth } from "@/lib/startAsanaOAuth";
import { startAirtableOAuth } from "@/lib/startAirtableOAuth";
import { startGoogleSheetsOAuth } from "@/lib/startGoogleSheetsOAuth";
import { startObsidianConnect } from "@/lib/startObsidianConnect";

const FN_BASE = `${SUPABASE_URL}/functions/v1`;

async function callFn(path: string, body: object) {
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token ?? "";
  const res = await fetch(`${FN_BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "Request failed");
  }
  return res.json();
}

// ─── Plan definitions ────────────────────────────────────────────────────────

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "€0",
    period: "forever",
    highlight: false,
    features: ["1 connected service", "Manual sync", "Browse & search your backups", "Open-source"],
  },
  {
    id: "managed",
    name: "Managed",
    price: "€20",
    period: "/ month",
    highlight: true,
    features: ["Up to 3 connected services", "Weekly auto-backup", "Everything in Free"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "€80",
    period: "/ month",
    highlight: false,
    features: ["Unlimited connections", "Priority support", "Everything in Managed"],
  },
] as const;

// ─── Platform definitions ─────────────────────────────────────────────────────

const PLATFORMS = [
  { id: "notion", name: "Notion", icon: Database, onConnect: () => void startNotionOAuth() },
  { id: "trello", name: "Trello", icon: Kanban, onConnect: () => void startTrelloOAuth() },
  { id: "todoist", name: "Todoist", icon: CheckSquare, onConnect: () => void startTodoistOAuth() },
  { id: "asana", name: "Asana", icon: LayoutDashboard, onConnect: () => void startAsanaOAuth() },
  { id: "airtable", name: "Airtable", icon: Table, onConnect: () => void startAirtableOAuth() },
  { id: "google-sheets", name: "Google Sheets", icon: Sheet, onConnect: () => void startGoogleSheetsOAuth() },
  { id: "obsidian", name: "Obsidian", icon: FileText, onConnect: () => void startObsidianConnect() },
] as const;

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
  const labels = ["Choose plan", "Vault folder", "First connection"];
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

// ─── Step 1: Plan selection ──────────────────────────────────────────────────

function PlanStep({ onNext }: { onNext: (plan: string) => void }) {
  const [selected, setSelected] = useState<string>("free");
  const [loading, setLoading] = useState(false);

  const handleContinue = async () => {
    if (selected === "free") {
      onNext("free");
      return;
    }
    // Paid plan → open Stripe checkout
    setLoading(true);
    try {
      const { url } = await callFn("create-checkout-session", { plan: selected });
      await openExternalUrl(url);
      // User will complete checkout in browser; we still advance them to step 2
      // The webhook will update their plan. Onboarding continues optimistically.
      onNext(selected);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start checkout.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-foreground">Choose your plan</h1>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Start free and upgrade anytime. You can change your plan from the Billing page.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {PLANS.map((plan) => (
          <button
            key={plan.id}
            type="button"
            onClick={() => setSelected(plan.id)}
            className={`text-left rounded-xl border p-5 transition-all space-y-3
              ${selected === plan.id
                ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                : "border-border/60 bg-card/40 hover:border-primary/30 hover:bg-card/70"
              }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-foreground">{plan.name}</p>
                <p className="text-xl font-bold text-foreground mt-0.5">
                  {plan.price}
                  <span className="text-xs font-normal text-muted-foreground"> {plan.period}</span>
                </p>
              </div>
              {plan.highlight && (
                <Badge className="text-[10px] shrink-0 bg-primary/15 text-primary border-primary/25">
                  Popular
                </Badge>
              )}
            </div>
            <ul className="space-y-1">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Check className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                  {f}
                </li>
              ))}
            </ul>
            {selected === plan.id && (
              <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                <Check className="w-3.5 h-3.5" /> Selected
              </div>
            )}
          </button>
        ))}
      </div>

      <div className="flex justify-end">
        <Button onClick={handleContinue} disabled={loading} size="lg" className="gap-2">
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {selected === "free" ? "Continue with Free" : `Continue to checkout`}
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Step 2: Vault folder ────────────────────────────────────────────────────

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

  const handleUseDefault = async () => {
    // Save the default path so future reads use it
    const picked = await window.electronAPI?.vault?.choosePath?.();
    if (picked) {
      setChosenPath(picked);
    } else {
      // Confirm with default suggestion
      onNext(defaultPath);
    }
  };

  const displayPath = chosenPath ?? defaultPath;
  const isElectron = !!window.electronAPI?.vault?.choosePath;

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-foreground">Choose your vault folder</h1>
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

// ─── Step 3: First connection ─────────────────────────────────────────────────

function ConnectStep({ plan, onSkip }: { plan: string; onSkip: () => void }) {
  const navigate = useNavigate();
  const limit = plan === "enterprise" ? 99 : plan === "managed" ? 3 : 1;
  const limitLabel = limit === 1 ? "1 connection on your plan" : `Up to ${limit} connections on your plan`;

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-foreground">Add your first connection</h1>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Connect a service and DataVault will back it up to your vault folder. {limitLabel}.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {PLATFORMS.map((platform) => {
          const Icon = platform.icon;
          return (
            <button
              key={platform.id}
              type="button"
              onClick={() => {
                platform.onConnect();
                // After a short delay, navigate to dashboard (OAuth will redirect back)
                setTimeout(() => navigate("/dashboard"), 500);
              }}
              className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 hover:bg-card/80 hover:border-primary/30 transition-all px-4 py-4 text-left group"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <span className="text-sm font-medium text-foreground flex-1">{platform.name}</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
            </button>
          );
        })}
      </div>

      <div className="flex justify-center">
        <Button variant="ghost" size="sm" onClick={onSkip} className="text-muted-foreground text-xs">
          I'll add a connection later → go to dashboard
        </Button>
      </div>
    </div>
  );
}

// ─── Main Onboarding component ────────────────────────────────────────────────

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [chosenPlan, setChosenPlan] = useState("free");

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
                <PlanStep
                  onNext={(plan) => {
                    setChosenPlan(plan);
                    setStep(2);
                  }}
                />
              )}
              {step === 2 && (
                <VaultStep
                  onNext={(_path) => setStep(3)}
                />
              )}
              {step === 3 && (
                <ConnectStep plan={chosenPlan} onSkip={finish} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
