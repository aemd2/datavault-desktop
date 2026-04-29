import { lazy, Suspense, useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import NotFound from "./pages/NotFound.tsx";

const Login = lazy(() => import("./pages/Login.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const Billing = lazy(() => import("./pages/Billing.tsx"));
const Viewer = lazy(() => import("./pages/Viewer.tsx"));
const Platforms = lazy(() => import("./pages/Platforms.tsx"));

const PageFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
    Loading…
  </div>
);

/**
 * Listens for datavault:// deep links from the main process.
 * Handles auth callbacks and post-OAuth navigation.
 */
function DeepLinkHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!window.electronAPI?.onDeepLink) return;

    const unsubscribe = window.electronAPI.onDeepLink(async (url: string) => {
      try {
        const parsed = new URL(url);

        if (parsed.hostname === "auth" && parsed.pathname === "/callback") {
          const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
          const params = new URLSearchParams(hash);
          const accessToken = params.get("access_token");
          const refreshToken = params.get("refresh_token");

          if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (!error) {
              navigate("/dashboard", { replace: true });
              return;
            }
          }
          navigate("/login", { replace: true });
          return;
        }

        if (parsed.hostname === "dashboard") {
          // Invalidate connectors so a newly-linked platform shows up immediately
          // without the user needing to reload. This fires after system-browser OAuth
          // (Todoist, Asana, etc.) redirect back via datavault://dashboard.
          void queryClient.invalidateQueries({ queryKey: ["connectors"] });
          navigate("/dashboard", { replace: true });
          return;
        }
      } catch {
        // Malformed URL — ignore
      }
    });

    return unsubscribe;
  }, [navigate]);

  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DeepLinkHandler />
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/viewer/*" element={<Viewer />} />
            <Route path="/platforms" element={<Platforms />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </HashRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;