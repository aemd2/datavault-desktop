/**
 * ObsidianBrowsePanel — browse notes in a connected local Obsidian vault.
 *
 * Unlike every other panel, data comes from the local filesystem via the
 * Electron IPC bridge (obsidian:listNotes / obsidian:readNote) — not from
 * Supabase. The vault root path is stored in `connectors.workspace_id`.
 *
 * Layout (matches BrowsePanelKit conventions):
 *   Left sidebar  — scrollable list of notes, filterable by search
 *   Right content — raw Markdown rendered with lightweight heading styles
 */

import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, FolderOpen, AlertTriangle, HardDrive } from "lucide-react";
import {
  PanelShell,
  PanelSidebar,
  PanelSidebarLabel,
  PanelSidebarButton,
  PanelContent,
  PanelSearchRow,
  PanelSkeleton,
  PanelEmptyState,
  PanelNoResults,
} from "@/components/viewer/BrowsePanelKit";
import { useConnectors } from "@/hooks/useConnectors";

// ─── Lightweight Markdown renderer ─────────────────────────────────────────
// We don't have react-markdown installed, so we do just enough to make the
// output readable: headings, bold, italic, inline code, hr, and code fences.

function renderMarkdownLine(line: string, idx: number): React.ReactNode {
  // Headings
  const h3 = line.match(/^###\s+(.*)/);
  if (h3) return <h3 key={idx} className="text-base font-semibold text-foreground mt-4 mb-1">{h3[1]}</h3>;
  const h2 = line.match(/^##\s+(.*)/);
  if (h2) return <h2 key={idx} className="text-lg font-bold text-foreground mt-5 mb-1.5">{h2[1]}</h2>;
  const h1 = line.match(/^#\s+(.*)/);
  if (h1) return <h1 key={idx} className="text-xl font-bold text-foreground mt-6 mb-2">{h1[1]}</h1>;

  // Horizontal rule
  if (/^---+$/.test(line.trim())) return <hr key={idx} className="my-4 border-border/40" />;

  // Bullet / unordered list
  const ul = line.match(/^(\s*)[*\-+]\s+(.*)/);
  if (ul) {
    const depth = Math.floor((ul[1]?.length ?? 0) / 2);
    return (
      <li key={idx} className={`list-disc text-sm leading-relaxed text-foreground/90 ml-${4 + depth * 4}`}>
        {inlineMarkdown(ul[2])}
      </li>
    );
  }

  // Ordered list
  const ol = line.match(/^(\s*)\d+\.\s+(.*)/);
  if (ol) {
    return (
      <li key={idx} className="list-decimal text-sm leading-relaxed text-foreground/90 ml-6">
        {inlineMarkdown(ol[2])}
      </li>
    );
  }

  // Blockquote
  const bq = line.match(/^>\s*(.*)/);
  if (bq) {
    return (
      <blockquote key={idx} className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground italic my-1">
        {inlineMarkdown(bq[1])}
      </blockquote>
    );
  }

  // Empty line → spacer
  if (line.trim() === "") return <div key={idx} className="h-2" />;

  // Normal paragraph
  return (
    <p key={idx} className="text-sm leading-relaxed text-foreground/90">
      {inlineMarkdown(line)}
    </p>
  );
}

/** Apply bold, italic, inline-code, and wikilink styles within a line. */
function inlineMarkdown(text: string): React.ReactNode {
  // Split on bold (**x**), italic (*x*), inline code (`x`), or wikilinks ([[x]])
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[\[[^\]]+\]\])/);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    if (/^\*[^*]+\*$/.test(part)) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    if (/^`[^`]+`$/.test(part)) {
      return (
        <code key={i} className="bg-muted/60 text-primary px-1 py-0.5 rounded text-[0.8em] font-mono">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (/^\[\[[^\]]+\]\]$/.test(part)) {
      // Wikilink — show as a styled span (no navigation in this viewer)
      return (
        <span key={i} className="text-primary/80 underline underline-offset-2 decoration-dotted cursor-default">
          {part.slice(2, -2)}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function MarkdownViewer({ content }: { content: string }) {
  // Handle fenced code blocks as a unit before splitting into lines
  const blocks: React.ReactNode[] = [];
  const codeBlockRe = /```[\s\S]*?```/g;
  let lastIndex = 0;
  let match;
  let blockKey = 0;

  while ((match = codeBlockRe.exec(content)) !== null) {
    // Render everything before this block
    const before = content.slice(lastIndex, match.index);
    if (before) {
      before.split("\n").forEach((line, i) => {
        blocks.push(renderMarkdownLine(line, blockKey++));
      });
    }
    // Render the code block
    const codeContent = match[0].replace(/^```[^\n]*\n?/, "").replace(/```$/, "");
    blocks.push(
      <pre key={blockKey++} className="bg-muted/40 border border-border/40 rounded-lg p-3 my-3 overflow-x-auto text-xs font-mono leading-relaxed text-foreground/80">
        {codeContent}
      </pre>
    );
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last code block
  const remaining = content.slice(lastIndex);
  if (remaining) {
    remaining.split("\n").forEach((line, i) => {
      blocks.push(renderMarkdownLine(line, blockKey++));
    });
  }

  return <div className="space-y-0.5">{blocks}</div>;
}

// ─── Note content hook ──────────────────────────────────────────────────────

function useNoteContent(vaultRoot: string, relativePath: string | null) {
  return useQuery({
    queryKey: ["obsidian-note", vaultRoot, relativePath],
    queryFn: async () => {
      if (!relativePath) return null;
      if (!window.electronAPI?.obsidian?.readNote) {
        throw new Error("obsidian:readNote not available");
      }
      return window.electronAPI.obsidian.readNote(vaultRoot, relativePath);
    },
    enabled: !!relativePath,
    staleTime: 30_000,
  });
}

// ─── Note list hook ─────────────────────────────────────────────────────────

function useNoteList(vaultRoot: string) {
  return useQuery({
    queryKey: ["obsidian-notes", vaultRoot],
    queryFn: async () => {
      if (!window.electronAPI?.obsidian?.listNotes) {
        throw new Error("obsidian:listNotes not available — is this the desktop app?");
      }
      return window.electronAPI.obsidian.listNotes(vaultRoot);
    },
    staleTime: 60_000,
  });
}

// ─── Main component ─────────────────────────────────────────────────────────

interface ObsidianBrowsePanelProps {
  connectorId: string | null;
}

export function ObsidianBrowsePanel({ connectorId }: ObsidianBrowsePanelProps) {
  const { data: connectors = [] } = useConnectors();
  const connector = connectors.find((c) => c.id === connectorId);
  const vaultRoot = connector?.workspace_id ?? null;

  const [search, setSearch] = useState("");
  const [selectedNote, setSelectedNote] = useState<string | null>(null);

  // Reset selection when vault changes
  useEffect(() => {
    setSelectedNote(null);
    setSearch("");
  }, [vaultRoot]);

  const { data: notes = [], isLoading: notesLoading, error: notesError } = useNoteList(vaultRoot ?? "");
  const { data: noteContent, isLoading: contentLoading } = useNoteContent(vaultRoot ?? "", selectedNote);

  const filteredNotes = search.trim()
    ? notes.filter(
        (n) =>
          n.name.toLowerCase().includes(search.toLowerCase()) ||
          n.relativePath.toLowerCase().includes(search.toLowerCase()),
      )
    : notes;

  // Auto-select first note when list loads
  useEffect(() => {
    if (!selectedNote && filteredNotes.length > 0) {
      setSelectedNote(filteredNotes[0].relativePath);
    }
  }, [filteredNotes.length, selectedNote]);

  if (!vaultRoot) {
    return (
      <PanelEmptyState
        icon={HardDrive}
        title="No vault path"
        description="This Obsidian connector has no saved folder path. Disconnect and re-add it from Platforms."
      />
    );
  }

  if (!window.electronAPI?.obsidian) {
    return (
      <PanelEmptyState
        icon={AlertTriangle}
        title="Desktop app required"
        description="Browsing Obsidian notes only works in the DataVault desktop app."
      />
    );
  }

  if (notesLoading) {
    return (
      <PanelShell>
        <PanelSidebar>
          <PanelSkeleton rows={8} />
        </PanelSidebar>
        <PanelContent>
          <PanelSkeleton rows={12} />
        </PanelContent>
      </PanelShell>
    );
  }

  if (notesError) {
    const msg = notesError instanceof Error ? notesError.message : "Couldn't read the vault.";
    return (
      <PanelEmptyState
        icon={AlertTriangle}
        title="Couldn't open vault"
        description={msg}
      />
    );
  }

  if (notes.length === 0) {
    return (
      <PanelEmptyState
        icon={FolderOpen}
        title="No notes found"
        description="Your vault folder is empty — add some .md files in Obsidian then click Rescan vault."
      />
    );
  }

  const selectedNoteName = selectedNote
    ? (notes.find((n) => n.relativePath === selectedNote)?.name ?? selectedNote)
    : null;

  // Derive folder structure for display
  const folderOf = (relPath: string) => {
    const parts = relPath.split("/");
    return parts.length > 1 ? parts.slice(0, -1).join("/") : null;
  };

  return (
    <PanelShell>
      {/* Sidebar: note list */}
      <PanelSidebar>
        <div className="mb-2 px-1">
          <input
            type="search"
            placeholder="Search notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-8 rounded-md border border-border/60 bg-background/60 px-2.5 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>

        {filteredNotes.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 mt-3">No notes match.</p>
        ) : (
          <div className="space-y-0.5 max-h-[calc(100vh-22rem)] overflow-y-auto pr-0.5">
            <PanelSidebarLabel>
              {search ? `${filteredNotes.length} result${filteredNotes.length !== 1 ? "s" : ""}` : `${notes.length} note${notes.length !== 1 ? "s" : ""}`}
            </PanelSidebarLabel>
            {filteredNotes.map((note) => {
              const folder = folderOf(note.relativePath);
              return (
                <PanelSidebarButton
                  key={note.relativePath}
                  active={selectedNote === note.relativePath}
                  onClick={() => setSelectedNote(note.relativePath)}
                  icon={FileText}
                >
                  <span className="flex flex-col min-w-0">
                    <span className="truncate leading-tight">{note.name}</span>
                    {folder && (
                      <span className="text-[10px] text-muted-foreground/60 truncate">{folder}</span>
                    )}
                  </span>
                </PanelSidebarButton>
              );
            })}
          </div>
        )}
      </PanelSidebar>

      {/* Content: note reader */}
      <PanelContent space="space-y-0">
        {!selectedNote ? (
          <PanelEmptyState
            icon={FileText}
            title="Select a note"
            description="Choose a note from the list on the left to read it here."
          />
        ) : contentLoading ? (
          <PanelSkeleton rows={14} />
        ) : noteContent == null ? (
          <PanelEmptyState
            icon={AlertTriangle}
            title="Couldn't read note"
            description="The file may have been moved or deleted."
          />
        ) : (
          <div className="rounded-xl border border-border/60 bg-card/30 p-6">
            {/* Note header */}
            <div className="flex items-start gap-3 mb-5 pb-4 border-b border-border/40">
              <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                <FileText className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-foreground leading-tight truncate">
                  {selectedNoteName}
                </h2>
                <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                  <HardDrive className="w-3 h-3 shrink-0" />
                  <span className="truncate">{selectedNote}</span>
                </p>
              </div>
            </div>

            {/* Note body */}
            <div className="max-h-[calc(100vh-24rem)] overflow-y-auto pr-1">
              {noteContent.trim() === "" ? (
                <p className="text-sm text-muted-foreground italic">This note is empty.</p>
              ) : (
                <MarkdownViewer content={noteContent} />
              )}
            </div>
          </div>
        )}
      </PanelContent>
    </PanelShell>
  );
}
