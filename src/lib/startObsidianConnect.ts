import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/queryClient";

/**
 * Obsidian "connect" flow — fundamentally different from every other connector.
 *
 * Obsidian has no cloud API and no OAuth. A vault is just a folder of Markdown
 * files on the user's disk. So instead of opening a browser, we open a native
 * folder picker, validate the chosen folder looks like an Obsidian vault (has
 * a `.obsidian/` subfolder), then insert a `connectors` row so the vault shows
 * up on the dashboard alongside cloud connectors.
 *
 * Because there's no cloud secret to protect we insert from the browser using
 * the signed-in user's JWT. RLS policy `connectors_insert_own` must allow
 * `auth.uid() = user_id` for this to work.
 *
 * Fields we store:
 *   type              "obsidian"
 *   workspace_name    folder basename (e.g. "My Vault")
 *   workspace_id      absolute path on disk — we need it later for rescans
 *   access_token      empty string (schema likely requires NOT NULL)
 *   status            "active"
 */
export async function startObsidianConnect(): Promise<void> {
  const isElectron = typeof window !== "undefined" && !!window.electronAPI?.obsidian;
  if (!isElectron) {
    toast.error(
      "Obsidian vaults live on your disk, so this only works in the DataVault desktop app.",
      { duration: 8_000 },
    );
    return;
  }

  // Require a signed-in user before opening the picker — otherwise the insert
  // at the end will fail and we'd have wasted the user's click.
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) {
    toast.error("Please sign in first.");
    return;
  }

  const pick = await window.electronAPI!.obsidian!.pickVault();

  if (pick.cancelled) return; // Silent — user changed their mind.
  if (!pick.success || !pick.absolutePath || !pick.vaultName) {
    toast.error(pick.error ?? "Couldn't read that folder. Try another one.", { duration: 8_000 });
    return;
  }

  // Prevent duplicate entries for the same folder path. Two rows pointing at
  // the same vault would just confuse the user — nothing useful comes of it.
  const { data: existing, error: existingErr } = await supabase
    .from("connectors")
    .select("id")
    .eq("type", "obsidian")
    .eq("workspace_id", pick.absolutePath)
    .maybeSingle();

  if (existingErr) {
    toast.error("Couldn't check for existing vaults. Try again.", { duration: 6_000 });
    return;
  }
  if (existing) {
    toast.message("That vault is already connected.", { duration: 6_000 });
    return;
  }

  const { error: insertErr } = await supabase.from("connectors").insert({
    user_id: userId,
    type: "obsidian",
    access_token: "", // no token — schema likely NOT NULL
    workspace_name: pick.vaultName,
    workspace_id: pick.absolutePath,
    status: "active",
    last_synced_at: new Date().toISOString(), // the folder is the data, so it's "synced" by definition
  });

  if (insertErr) {
    // Most likely cause: RLS policy doesn't allow insert. Surface a friendly message.
    toast.error(
      `Couldn't save this vault: ${insertErr.message}. If this keeps happening, the server may need an Obsidian permission update.`,
      { duration: 10_000 },
    );
    return;
  }

  void queryClient.invalidateQueries({ queryKey: ["connectors"] });

  const fileCountHint =
    pick.markdownFileCount != null
      ? ` — ${pick.markdownFileCount} note${pick.markdownFileCount === 1 ? "" : "s"} found`
      : "";

  toast.success(`Connected "${pick.vaultName}"${fileCountHint}.`, { duration: 6_000 });
}
