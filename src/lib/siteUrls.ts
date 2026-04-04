/**
 * Public GitHub URL for landing CTAs (navbar icon, Trust section).
 *
 * Set VITE_GITHUB_REPO_URL in .env — no trailing slash.
 * Example: https://github.com/acme/datavault
 * Users can open Releases from the repo’s Releases tab to download builds.
 */

const base = (import.meta.env.VITE_GITHUB_REPO_URL ?? "").trim().replace(/\/$/, "");

const configured = base.length > 0;

/** Repository root (browse code, Releases, clone). */
export function githubRepoUrl(): string {
  return configured ? base : "https://github.com";
}
