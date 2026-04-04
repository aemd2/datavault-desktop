import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";


import { toast } from "sonner";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  isReturningSignInEmail,
  rememberSignInEmail,
} from "@/lib/loginDevicePreference";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Email-only wait screen vs full first-time flow with OTP/code field. */
type Step = "email" | "code" | "check_email";

/**
 * Passwordless login via Supabase Email OTP / magic link.
 *
 * - First-time (this browser, this email): email → enter code (and/or use link). `shouldCreateUser: true`.
 * - Returning: email → "check your inbox" only; sign in via link. `shouldCreateUser: false`.
 *
 * See `loginDevicePreference.ts` and `AuthEmailMemory` for how we remember emails after any successful sign-in.
 */
/** Max characters we accept for OTP paste/type (covers hosted + self-hosted GoTrue lengths). */
const OTP_MAX_LEN = 12;

function normalizeOtpInput(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").slice(0, OTP_MAX_LEN);
}

/**
 * Supabase’s built-in mailer throttles OTP / magic-link sends per hour (stricter on free projects).
 * Map the raw API message to something users can act on.
 */
function friendlySendOtpError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("rate limit") || m.includes("email rate") || m.includes("too many")) {
    return (
      "Too many sign-in emails were sent recently (Supabase limit). Wait 30–60 minutes and try again, " +
      "or connect Custom SMTP in Supabase → Authentication → Emails for higher limits. " +
      "If you already have a code in your inbox, you can still use it — no new email needed."
    );
  }
  return message;
}

const Login = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  /** User chose "first time on this device" so we always use the full code flow for this attempt. */
  const [forceFirstTime, setForceFirstTime] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) navigate("/dashboard", { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const trimmedEmail = email.trim().toLowerCase();

  /** True → only magic-link style (no code step). False → show code step after send. */
  const useReturningFlow = !forceFirstTime && isReturningSignInEmail(trimmedEmail);

  /** Shared by the email form submit and the “Resend” action on the link-only step. */
  const sendSignInEmail = async () => {
    if (!trimmedEmail) {
      toast.error("Please enter your email.");
      return;
    }
    if (!isSupabaseConfigured()) {
      toast.error("Supabase is not configured. Add VITE_SUPABASE_* to .env.");
      return;
    }

    setLoading(true);
    // In Electron the app is loaded from file:// so we use a custom protocol URL
    // for the magic-link redirect. The DeepLinkHandler in App.tsx processes it.
    
    const redirectTo = true // always Electron in this repo
      ? "datavault://auth/callback"
      : `${window.location.origin}/dashboard`;

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        // Returning users must already exist; avoids accidental new accounts on typos.
        shouldCreateUser: !useReturningFlow,
        emailRedirectTo: redirectTo,
      },
    });
    setLoading(false);

    if (error) {
      console.error("[Login] signInWithOtp", error.message);
      const msg = friendlySendOtpError(error.message);
      toast.error(msg, { duration: 12_000 });
      if (useReturningFlow) {
        toast.message(
          "New here? Tap “First time on this device?” under the email field, then send again.",
          { duration: 10_000 },
        );
      }
      return;
    }

    if (useReturningFlow) {
      toast.success("Check your email — open the sign-in link to continue.");
      setStep("check_email");
    } else {
      toast.success("Check your email — use the link, or enter the code if your template shows one.");
      setStep("code");
    }
    setCode("");
  };

  const onEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendSignInEmail();
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = normalizeOtpInput(code);
    if (token.length < 6) {
      toast.error("Enter the full code from your email — include every digit (often 8, not 6).");
      return;
    }
    if (!isSupabaseConfigured()) {
      toast.error("Supabase is not configured.");
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.verifyOtp({
      email: trimmedEmail,
      token,
      type: "email",
    });
    setLoading(false);

    if (error) {
      console.error("[Login] verifyOtp", error.message);
      toast.error(
        "That code didn’t work. Try again, or use the sign-in link in the same email if you see one.",
      );
      return;
    }

    if (data.session) {
      rememberSignInEmail(trimmedEmail);
      toast.success("You’re signed in.");
      navigate("/dashboard", { replace: true });
    }
  };

  const resetToEmail = () => {
    setStep("email");
    setCode("");
    setForceFirstTime(false);
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          {true ? (
            <span className="font-display text-2xl font-bold inline-block">
              <span className="text-foreground">Data</span>
              <span className="text-gradient-gold">Vault</span>
            </span>
          ) : (
            <Link to="/" className="font-display text-2xl font-bold inline-block">
              <span className="text-foreground">Data</span>
              <span className="text-gradient-gold">Vault</span>
            </Link>
          )}
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            {step === "email" && (
              <>
                {useReturningFlow
                  ? "We’ll email you a link. Open it on this device to sign in — no code to type."
                  : "First time here? We’ll email you a link and you can enter a code if your email shows one."}
              </>
            )}
            {step === "code" && `Email sent to ${trimmedEmail}.`}
            {step === "check_email" && `We emailed ${trimmedEmail}.`}
          </p>
        </div>

        {step === "email" ? (
          <form onSubmit={onEmailSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                className="bg-card border-border"
              />
            </div>

            {forceFirstTime ? (
              <p className="text-xs text-muted-foreground rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                Next step: enter the code from your email (or tap the link in the same message).
              </p>
            ) : null}

            <Button
              type="submit"
              className="w-full bg-gradient-gold hover:bg-gradient-gold-hover text-primary-foreground font-semibold"
              disabled={loading}
            >
              {loading ? "Sending…" : useReturningFlow ? "Email me a sign-in link" : "Send sign-in email"}
            </Button>

            {!forceFirstTime ? (
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                onClick={() => {
                  setForceFirstTime(true);
                  toast.message(
                    "We’ll use the full sign-in flow with a code field after you send the email.",
                    { duration: 6000 },
                  );
                }}
              >
                First time on this device?
              </button>
            ) : (
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                onClick={() => setForceFirstTime(false)}
              >
                I’ve signed in here before
              </button>
            )}
          </form>
        ) : null}

        {step === "check_email" ? (
          <div className="space-y-4">
            <div
              className="rounded-lg border border-border/80 bg-muted/20 px-4 py-3 text-sm text-muted-foreground space-y-2"
              role="status"
            >
              <p className="text-foreground font-medium">Open the link we sent</p>
              <p>
                Click <strong className="text-foreground">Log in</strong> (or the magic link) in that email. This page
                will stay here until you open the link — usually you land on your dashboard.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={loading}
              onClick={() => void sendSignInEmail()}
            >
              {loading ? "Sending…" : "Resend sign-in email"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full text-muted-foreground"
              disabled={loading}
              onClick={() => {
                setStep("code");
                setCode("");
                toast.message("Paste the code from the same email, or request a new email with Resend.", {
                  duration: 7000,
                });
              }}
            >
              I have a code instead
            </Button>
            <Button type="button" variant="ghost" className="w-full text-muted-foreground" onClick={resetToEmail}>
              Use a different email
            </Button>
          </div>
        ) : null}

        {step === "code" ? (
          <form onSubmit={verifyCode} className="space-y-4">
            <div
              className="rounded-lg border border-border/80 bg-muted/20 px-4 py-3 text-sm text-muted-foreground space-y-2"
              role="note"
            >
              <p className="text-foreground font-medium">Only see “Magic Link” and Log In?</p>
              <p>
                That’s the normal Supabase default — <strong className="text-foreground">not</strong> because you’re
                on the free plan. Click <strong className="text-foreground">Log In</strong> in the email; you should
                open the app signed in.
              </p>
              <p>
                To also show a code from <code className="text-xs text-foreground bg-muted px-1 rounded">{"{{ .Token }}"}</code>{" "}
                in that email, edit the Magic Link template (Authentication → Email Templates). Details:{" "}
                <code className="text-xs text-foreground">docs/supabase-login-email-template.md</code>
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="code">Code from your email</Label>
              <Input
                id="code"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                placeholder="Paste full code"
                maxLength={OTP_MAX_LEN}
                value={code}
                onChange={(e) => setCode(normalizeOtpInput(e.target.value))}
                disabled={loading}
                className="bg-card border-border text-center text-xl sm:text-2xl tracking-widest font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Type or paste <strong className="text-foreground">every character</strong> — Supabase often sends{" "}
                <strong className="text-foreground">8 digits</strong>, not 6. Or use the Log In link in the email.
              </p>
            </div>
            <Button
              type="submit"
              className="w-full bg-gradient-gold hover:bg-gradient-gold-hover text-primary-foreground font-semibold"
              disabled={loading || normalizeOtpInput(code).length < 6}
            >
              {loading ? "Checking…" : "Verify & sign in"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full text-muted-foreground"
              disabled={loading}
              onClick={resetToEmail}
            >
              Use a different email
            </Button>
          </form>
        ) : null}

        {false && (
          <p className="text-center text-sm text-muted-foreground">
            <Link to="/" className="text-primary hover:underline">
              Back to home
            </Link>
          </p>
        )}
      </div>
    </div>
  );
};

export default Login;