import { useMemo, useState } from "react";
import { FileSpreadsheet, Sheet, ExternalLink } from "lucide-react";
import { useGoogleSpreadsheets, useGoogleSheets } from "@/hooks/useGoogleSheetsData";
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

interface SheetRowData {
  id: string;
  row_index: number;
  values_json: string[];
}

function useSheetRows(connectorId?: string, spreadsheetId?: string, sheetId?: number) {
  return useQuery({
    queryKey: ["google-sheet-rows", connectorId ?? "all", spreadsheetId ?? "none", sheetId ?? -1],
    enabled: !!spreadsheetId && sheetId !== undefined,
    queryFn: async (): Promise<SheetRowData[]> => {
      let q = supabase
        .from("google_sheet_rows")
        .select("id, row_index, values_json")
        .order("row_index", { ascending: true })
        .limit(1000);
      if (connectorId) q = q.eq("connector_id", connectorId);
      if (spreadsheetId) q = q.eq("spreadsheet_id", spreadsheetId);
      if (sheetId !== undefined) q = q.eq("sheet_id", sheetId);
      const { data, error } = await q;
      if (error) {
        console.warn("[google-sheet-rows]", error.message);
        return [];
      }
      return (data ?? []) as SheetRowData[];
    },
  });
}

export function GoogleSheetsBrowsePanel({ connectorId }: { connectorId?: string }) {
  const [selectedSpreadsheet, setSelectedSpreadsheet] = useState<string | null>(null);
  const [selectedSheetId, setSelectedSheetId] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const { data: spreadsheets = [], isLoading: loadingSpreadsheets } =
    useGoogleSpreadsheets(connectorId);
  const { data: sheets = [], isLoading: loadingSheets } = useGoogleSheets(
    connectorId,
    selectedSpreadsheet ?? undefined,
  );
  const { data: rows = [], isLoading: loadingRows } = useSheetRows(
    connectorId,
    selectedSpreadsheet ?? undefined,
    selectedSheetId ?? undefined,
  );

  function handleSelectSpreadsheet(id: string | null) {
    setSelectedSpreadsheet(id);
    setSelectedSheetId(null);
  }

  // First row is the header
  const headerRow: string[] = rows.find((r) => r.row_index === 0)?.values_json ?? [];
  const dataRows = rows.filter((r) => r.row_index > 0);

  const q = query.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    if (!q) return dataRows;
    return dataRows.filter((r) =>
      (r.values_json ?? []).some((cell) => String(cell).toLowerCase().includes(q)),
    );
  }, [dataRows, q]);

  const selectedSpreadsheetData = spreadsheets.find((s) => s.id === selectedSpreadsheet);

  // Build columns from header row
  const columns: PanelTableColumn[] = headerRow.map((col, i) => ({
    key: String(i),
    label: col || `Col ${i + 1}`,
  }));

  return (
    <PanelShell>
      {/* Left sidebar: spreadsheets → sheets */}
      <PanelSidebar>
        <PanelSidebarLabel>Spreadsheets</PanelSidebarLabel>

        {loadingSpreadsheets ? (
          <PanelSkeleton rows={3} />
        ) : spreadsheets.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1">No spreadsheets synced yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {spreadsheets.map((ss) => (
              <li key={ss.id}>
                <PanelSidebarButton
                  icon={FileSpreadsheet}
                  active={selectedSpreadsheet === ss.id}
                  onClick={() =>
                    handleSelectSpreadsheet(selectedSpreadsheet === ss.id ? null : ss.id)
                  }
                >
                  <span className="truncate">{ss.name}</span>
                </PanelSidebarButton>

                {selectedSpreadsheet === ss.id && (
                  <ul className="ml-4 mt-0.5 space-y-0.5">
                    {loadingSheets ? (
                      <li className="text-xs text-muted-foreground px-2 py-1">Loading…</li>
                    ) : sheets.length === 0 ? (
                      <li className="text-xs text-muted-foreground px-2 py-1">No sheets</li>
                    ) : (
                      sheets.map((sheet) => (
                        <li key={sheet.id}>
                          <PanelSidebarButton
                            icon={Sheet}
                            nested
                            active={selectedSheetId === sheet.sheet_id}
                            onClick={() =>
                              setSelectedSheetId(
                                selectedSheetId === sheet.sheet_id ? null : sheet.sheet_id,
                              )
                            }
                          >
                            <span className="truncate">{sheet.title}</span>
                            {sheet.row_count != null && (
                              <span className="ml-auto text-[10px] opacity-50 shrink-0">
                                {sheet.row_count}
                              </span>
                            )}
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

      {/* Right panel: rows */}
      <PanelContent>
        {!selectedSpreadsheet ? (
          <PanelEmptyState icon={FileSpreadsheet}>
            Select a spreadsheet on the left to browse its sheets and data.
          </PanelEmptyState>
        ) : !selectedSheetId ? (
          <PanelEmptyState icon={Sheet}>
            Select a sheet tab to view its rows.
            {selectedSpreadsheetData?.web_view_link && (
              <a
                href={selectedSpreadsheetData.web_view_link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <ExternalLink className="w-3.5 h-3.5" aria-hidden />
                Open in Google Sheets
              </a>
            )}
          </PanelEmptyState>
        ) : (
          <>
            <PanelSearchRow
              value={query}
              onChange={setQuery}
              placeholder="Search rows…"
              count={filteredRows.length}
              countLabel="row"
              loading={loadingRows}
            >
              {selectedSpreadsheetData?.web_view_link && (
                <a
                  href={selectedSpreadsheetData.web_view_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="w-3 h-3" aria-hidden />
                  Open in Sheets
                </a>
              )}
            </PanelSearchRow>

            {loadingRows ? (
              <PanelSkeleton rows={4} />
            ) : filteredRows.length === 0 && dataRows.length === 0 ? (
              <PanelNoResults message="No data rows in this sheet yet." />
            ) : filteredRows.length === 0 ? (
              <PanelNoResults message="No rows match your search." />
            ) : (
              <PanelDataTable
                columns={
                  columns.length > 0
                    ? columns
                    : filteredRows[0]?.values_json.map((_, i) => ({
                        key: String(i),
                        label: `Col ${i + 1}`,
                      })) ?? []
                }
                rows={filteredRows.slice(0, 500).map((row) => {
                  const cells = row.values_json ?? [];
                  const r: Record<string, unknown> & { id: string } = { id: row.id };
                  const colCount = Math.max(columns.length, cells.length);
                  for (let i = 0; i < colCount; i++) {
                    r[String(i)] = cells[i] ?? "";
                  }
                  return r;
                })}
                renderCell={(value) => {
                  const cell = String(value ?? "");
                  const isUrl = cell.startsWith("http://") || cell.startsWith("https://");
                  if (isUrl) {
                    return (
                      <a
                        href={cell}
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
                  filteredRows.length > 500
                    ? `Showing first 500 of ${filteredRows.length} rows`
                    : undefined
                }
              />
            )}
          </>
        )}
      </PanelContent>
    </PanelShell>
  );
}
