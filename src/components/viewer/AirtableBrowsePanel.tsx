import { useMemo, useState } from "react";
import { Database, Table2, ExternalLink } from "lucide-react";
import { useAirtableBases, useAirtableTables } from "@/hooks/useAirtableData";
import { supabase } from "@/lib/supabase";
import { useQuery } from "@tanstack/react-query";
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
  PanelDataTable,
  type PanelTableColumn,
} from "./BrowsePanelKit";

interface AirtableRecord {
  id: string;
  table_id: string;
  base_id: string;
  fields_json: Record<string, unknown>;
  created_time: string | null;
}

function useAirtableRecords(connectorId?: string, tableId?: string) {
  return useQuery({
    queryKey: ["airtable-records", connectorId ?? "all", tableId ?? "all"],
    queryFn: async (): Promise<AirtableRecord[]> => {
      let q = supabase
        .from("airtable_records")
        .select("id, table_id, base_id, fields_json, created_time")
        .order("created_time", { ascending: false })
        .limit(500);
      if (connectorId) q = q.eq("connector_id", connectorId);
      if (tableId) q = q.eq("table_id", tableId);
      const { data, error } = await q;
      if (error) {
        console.warn("[airtable-records]", error.message);
        return [];
      }
      return (data ?? []) as AirtableRecord[];
    },
  });
}

/** Render a single cell value from Airtable fields_json. */
function renderAirtableCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (typeof v === "string") return v;
        if (v && typeof v === "object") {
          const obj = v as Record<string, unknown>;
          return (obj.name ?? obj.text ?? obj.email ?? obj.url ?? JSON.stringify(v)) as string;
        }
        return String(v);
      })
      .join(", ");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return (obj.name ?? obj.text ?? obj.email ?? obj.url ?? JSON.stringify(value)) as string;
  }
  return String(value);
}

export function AirtableBrowsePanel({ connectorId }: { connectorId?: string }) {
  const [selectedBase, setSelectedBase] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const { data: bases = [], isLoading: loadingBases } = useAirtableBases(connectorId);
  const { data: tables = [], isLoading: loadingTables } = useAirtableTables(
    connectorId,
    selectedBase ?? undefined,
  );
  const { data: records = [], isLoading: loadingRecords } = useAirtableRecords(
    connectorId,
    selectedTable ?? undefined,
  );

  // Derive column names from selected table's fields_json schema
  const selectedTableData = tables.find((t) => t.id === selectedTable);
  const columns: PanelTableColumn[] = useMemo(() => {
    if (!selectedTableData?.fields_json) return [];
    const fields = selectedTableData.fields_json as Array<{ id: string; name: string }>;
    return Array.isArray(fields)
      ? fields.slice(0, 8).map((f) => ({ key: f.id, label: f.name }))
      : [];
  }, [selectedTableData]);

  const q = query.trim().toLowerCase();
  const filteredRecords = useMemo(() => {
    if (!q) return records;
    return records.filter((r) => {
      const fields = (r.fields_json ?? {}) as Record<string, unknown>;
      return Object.values(fields).some((v) => renderAirtableCell(v).toLowerCase().includes(q));
    });
  }, [records, q]);

  function handleSelectBase(baseId: string | null) {
    setSelectedBase(baseId);
    setSelectedTable(null);
  }

  return (
    <PanelShell>
      {/* Left panel: bases + nested tables */}
      <PanelSidebar>
        <PanelSidebarLabel>Bases</PanelSidebarLabel>

        {loadingBases ? (
          <PanelSkeleton rows={3} />
        ) : bases.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1">No bases synced yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {bases.map((base) => (
              <li key={base.id}>
                <PanelSidebarButton
                  icon={Database}
                  active={selectedBase === base.id}
                  onClick={() => handleSelectBase(selectedBase === base.id ? null : base.id)}
                >
                  <span className="truncate">{base.name}</span>
                </PanelSidebarButton>

                {selectedBase === base.id && (
                  <ul className="ml-4 mt-0.5 space-y-0.5">
                    {loadingTables ? (
                      <li className="text-xs text-muted-foreground px-2 py-1">Loading…</li>
                    ) : tables.length === 0 ? (
                      <li className="text-xs text-muted-foreground px-2 py-1">No tables</li>
                    ) : (
                      tables.map((table) => (
                        <li key={table.id}>
                          <PanelSidebarButton
                            icon={Table2}
                            nested
                            active={selectedTable === table.id}
                            onClick={() =>
                              setSelectedTable(selectedTable === table.id ? null : table.id)
                            }
                          >
                            <span className="truncate">{table.name}</span>
                          </PanelSidebarButton>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </PanelSidebar>

      {/* Right panel: records */}
      <PanelContent>
        {!selectedBase ? (
          <PanelEmptyState icon={Database}>
            Select a base on the left to browse its tables and records.
          </PanelEmptyState>
        ) : !selectedTable ? (
          <PanelEmptyState icon={Table2}>
            Select a table to view its records.
          </PanelEmptyState>
        ) : (
          <>
            <PanelSearchRow
              value={query}
              onChange={setQuery}
              placeholder="Search records…"
              count={filteredRecords.length}
              countLabel="record"
              loading={loadingRecords}
            />

            {loadingRecords ? (
              <PanelSkeleton rows={4} />
            ) : filteredRecords.length === 0 ? (
              <PanelNoResults
                message={q ? "No records match your search." : "No records in this table yet."}
              />
            ) : columns.length > 0 ? (
              /* Table view when we have field schema */
              <PanelDataTable
                columns={columns}
                rows={filteredRecords.slice(0, 200).map((rec) => {
                  const fields = (rec.fields_json ?? {}) as Record<string, unknown>;
                  // Map each column key (field id) to the raw value
                  const row: Record<string, unknown> & { id: string } = { id: rec.id };
                  for (const col of columns) {
                    row[col.key] = fields[col.key];
                  }
                  return row;
                })}
                renderCell={(value, colKey) => {
                  // Also try matching by field name as fallback
                  const raw = value;
                  const cell = renderAirtableCell(raw);
                  const isUrl =
                    typeof raw === "string" &&
                    (raw.startsWith("http://") || raw.startsWith("https://"));
                  if (isUrl) {
                    return (
                      <a
                        href={raw}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3 shrink-0" aria-hidden />
                        <span className="truncate">{cell}</span>
                      </a>
                    );
                  }
                  return cell || <span className="text-muted-foreground/40">—</span>;
                }}
                overflowNote={
                  filteredRecords.length > 200
                    ? `Showing first 200 of ${filteredRecords.length} records`
                    : undefined
                }
              />
            ) : (
              /* Fallback card list when no field schema */
              <div className="space-y-2">
                {filteredRecords.slice(0, 100).map((rec) => {
                  const fields = (rec.fields_json ?? {}) as Record<string, unknown>;
                  const entries = Object.entries(fields).slice(0, 6);
                  return (
                    <div
                      key={rec.id}
                      className="rounded-lg border border-border/60 bg-card/40 px-4 py-3 space-y-1"
                    >
                      {entries.map(([k, v]) => (
                        <div key={k} className="flex gap-2 text-xs">
                          <span className="text-muted-foreground min-w-[6rem] shrink-0 truncate">
                            {k}
                          </span>
                          <span className="text-foreground truncate">{renderAirtableCell(v)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </PanelContent>
    </PanelShell>
  );
}
