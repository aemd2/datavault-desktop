/**
 * BrowsePanelKit — shared primitives for every Browse Backup panel.
 *
 * Import what you need:
 *   PanelShell, PanelSidebar, PanelSidebarLabel, PanelSidebarButton,
 *   PanelContent, PanelSearchRow, PanelSkeleton, PanelEmptyState, PanelNoResults
 */

import type { ReactNode, ComponentType, SVGProps } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// ─── Layout ─────────────────────────────────────────────────────────────────

/**
 * Outer shell: sidebar + content side-by-side (stacks on small screens).
 */
export function PanelShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col lg:flex-row gap-6 min-h-0">
      {children}
    </div>
  );
}

/**
 * Left rail: fixed 224 px (w-56) sidebar, collapses to full width on mobile.
 */
export function PanelSidebar({ children }: { children: ReactNode }) {
  return (
    <aside className="w-56 shrink-0 space-y-0.5">
      {children}
    </aside>
  );
}

/**
 * Right content area that fills remaining space.
 * Pass `space` to override the default `space-y-4` gap between child sections.
 */
export function PanelContent({
  children,
  space = "space-y-4",
}: {
  children: ReactNode;
  space?: string;
}) {
  return <div className={`flex-1 min-w-0 ${space}`}>{children}</div>;
}

// ─── Sidebar pieces ──────────────────────────────────────────────────────────

/**
 * Small all-caps label above a group of sidebar items.
 *   <PanelSidebarLabel>Projects</PanelSidebarLabel>
 */
export function PanelSidebarLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
      {children}
    </p>
  );
}

type LucideIconType = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

interface PanelSidebarButtonProps {
  /** Highlight this item as currently selected. */
  active?: boolean;
  onClick: () => void;
  /** Optional Lucide icon component. */
  icon?: LucideIconType;
  /** When true: smaller text + tighter padding (for nested items, e.g. sheets under spreadsheet). */
  nested?: boolean;
  /** Extra Tailwind classes (e.g. `opacity-50` for archived items). */
  className?: string;
  children: ReactNode;
}

/**
 * A sidebar nav item — both top-level and nested.
 *
 * ```tsx
 * <PanelSidebarButton icon={FolderOpen} active={sel === p.id} onClick={() => setSel(p.id)}>
 *   {p.name}
 * </PanelSidebarButton>
 * ```
 */
export function PanelSidebarButton({
  active,
  onClick,
  icon: Icon,
  nested,
  className,
  children,
}: PanelSidebarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full text-left flex items-center gap-2 rounded-md transition-colors",
        nested ? "text-xs px-2 py-1" : "text-sm px-2 py-1.5",
        active
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {Icon && (
        <Icon
          className={nested ? "w-3 h-3 shrink-0" : "w-3.5 h-3.5 shrink-0"}
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}

// ─── Content toolbar ─────────────────────────────────────────────────────────

interface PanelSearchRowProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Total items after filtering; hides when `loading` is true. */
  count?: number;
  /** Singular noun used in the badge, e.g. "task" → "3 tasks". */
  countLabel?: string;
  loading?: boolean;
  /** Extra controls placed after the badge (buttons, links, etc.). */
  children?: ReactNode;
}

/**
 * Search input + item count badge + optional trailing controls.
 *
 * ```tsx
 * <PanelSearchRow
 *   value={query} onChange={setQuery}
 *   placeholder="Search tasks…"
 *   count={filteredTasks.length} countLabel="task" loading={loading}
 * >
 *   <button onClick={toggle}>Show completed</button>
 * </PanelSearchRow>
 * ```
 */
export function PanelSearchRow({
  value,
  onChange,
  placeholder = "Search…",
  count,
  countLabel = "item",
  loading,
  children,
}: PanelSearchRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 text-sm max-w-xs"
        aria-label={placeholder}
      />
      {!loading && count !== undefined && (
        <Badge variant="secondary" className="text-xs">
          {count}&nbsp;{countLabel}
          {count === 1 ? "" : "s"}
        </Badge>
      )}
      {children}
    </div>
  );
}

// ─── Loading state ────────────────────────────────────────────────────────────

interface PanelSkeletonProps {
  /** Number of skeleton rows to render. */
  rows?: number;
  /** Tailwind height class for each row. */
  height?: string;
}

/**
 * Animated pulse skeleton used while data is loading.
 */
export function PanelSkeleton({ rows = 4, height = "h-8" }: PanelSkeletonProps) {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`${height} rounded-lg bg-muted/30 animate-pulse`} />
      ))}
    </div>
  );
}

// ─── Empty / zero-state ───────────────────────────────────────────────────────

interface PanelEmptyStateProps {
  /** Lucide icon component to render large + faded. */
  icon: LucideIconType;
  /** Short message shown beneath the icon. May include JSX (e.g. bold text or links). */
  children: ReactNode;
  /**
   * Vertical padding variant:
   * - `"loose"` (default) — `py-16`, used when nothing is selected yet.
   * - `"compact"` — `py-12`, used for "no data synced yet" states.
   */
  size?: "loose" | "compact";
}

/**
 * Centred icon + message — used for both "select something" and "no data yet" states.
 *
 * ```tsx
 * // Nothing selected
 * <PanelEmptyState icon={Database}>
 *   Select a base on the left to browse its tables.
 * </PanelEmptyState>
 *
 * // No data synced
 * <PanelEmptyState icon={Database} size="compact">
 *   No bases backed up yet.{" "}
 *   <Link to="/dashboard" className="text-primary font-medium">Go to Dashboard</Link>.
 * </PanelEmptyState>
 * ```
 */
export function PanelEmptyState({
  icon: Icon,
  children,
  size = "loose",
}: PanelEmptyStateProps) {
  return (
    <div
      className={`text-center text-muted-foreground ${
        size === "compact" ? "py-12" : "py-16"
      }`}
    >
      <Icon className="w-10 h-10 mx-auto mb-3 opacity-30" aria-hidden />
      <p className="text-sm leading-relaxed max-w-xs mx-auto">{children}</p>
    </div>
  );
}

/**
 * Inline "no results" message when a search query returns nothing.
 */
export function PanelNoResults({ message }: { message: string }) {
  return (
    <p className="text-sm text-muted-foreground py-8 text-center">{message}</p>
  );
}

// ─── Data table ───────────────────────────────────────────────────────────────

export interface PanelTableColumn {
  key: string;
  label: string;
}

interface PanelDataTableProps {
  columns: PanelTableColumn[];
  /** Each row must have a unique `id` field plus data keyed by column key. */
  rows: Array<Record<string, unknown> & { id: string }>;
  /** Called to render a single cell value — defaults to `String(value)`. */
  renderCell?: (value: unknown, colKey: string) => ReactNode;
  /** Message shown below the table when rows are capped. */
  overflowNote?: string;
}

/**
 * Generic responsive data table used by Airtable and Google Sheets panels.
 *
 * Columns scroll horizontally on small screens; cells truncate with `max-w-[14rem]`.
 */
export function PanelDataTable({
  columns,
  rows,
  renderCell: renderCellProp,
  overflowNote,
}: PanelDataTableProps) {
  const defaultRender = (v: unknown) =>
    v !== null && v !== undefined && v !== "" ? (
      String(v)
    ) : (
      <span className="text-muted-foreground/40">—</span>
    );

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/60 bg-muted/30">
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-3 py-2 text-left font-medium text-muted-foreground truncate max-w-[12rem]"
              >
                {col.label || `Col ${col.key}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-border/40 hover:bg-muted/10 transition-colors"
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className="px-3 py-2 text-foreground max-w-[14rem] truncate"
                >
                  {renderCellProp
                    ? renderCellProp(row[col.key], col.key)
                    : defaultRender(row[col.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {overflowNote && (
        <p className="text-xs text-muted-foreground text-center py-2 border-t border-border/40">
          {overflowNote}
        </p>
      )}
    </div>
  );
}
