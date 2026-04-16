import { toast } from "sonner";

/**
 * Public marketing site origin (no trailing slash).
 * Used to open the interactive demo and updates pages in the system browser (Electron) or a new tab (web).
 *
 * Example: `http://localhost:8080` while the website dev server runs (see website `vite.config.ts` port).
 */
export function marketingSiteOrigin(): string | null {
  const raw = (import.meta.env.VITE_MARKETING_SITE_URL as string | undefined)?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

export function marketingDemoUrl(): string | null {
  const o = marketingSiteOrigin();
  return o ? `${o}/#demo` : null;
}

/** Opens the home-page demo (`/#demo`) on the marketing site, or shows a toast if `VITE_MARKETING_SITE_URL` is unset. */
export async function openMarketingDemo(): Promise<void> {
  const url = marketingDemoUrl();
  if (!url) {
    toast.error(
      "Add VITE_MARKETING_SITE_URL in .env (your marketing site origin, no trailing slash) to open the interactive demo in the browser.",
      { duration: 12_000 },
    );
    return;
  }
  await openExternalUrl(url);
}

/** Open a full URL in the system browser (Electron) or a new tab (web). */
export async function openExternalUrl(url: string): Promise<void> {
  const isElectron = typeof window !== "undefined" && "electronAPI" in window;
  if (isElectron && window.electronAPI?.openExternal) {
    await window.electronAPI.openExternal(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
