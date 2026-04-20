import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface GoogleSpreadsheetRow {
  id: string;
  connector_id: string;
  /** Google Drive file ID for the spreadsheet. */
  drive_file_id: string;
  name: string;
  last_modified_time: string | null;
  web_view_link: string | null;
}

export interface GoogleSheetRow {
  id: string;
  connector_id: string;
  spreadsheet_id: string;
  /** Sheet (tab) ID within the spreadsheet. */
  sheet_id: number;
  title: string;
  row_count: number | null;
  column_count: number | null;
  last_synced_at: string | null;
}

export function useGoogleSpreadsheets(connectorId?: string) {
  return useQuery({
    queryKey: ["google-spreadsheets", connectorId ?? "all"],
    queryFn: async (): Promise<GoogleSpreadsheetRow[]> => {
      let q = supabase
        .from("google_spreadsheets")
        .select("id, connector_id, drive_file_id, name, last_modified_time, web_view_link")
        .order("last_modified_time", { ascending: false });
      if (connectorId) q = q.eq("connector_id", connectorId);
      const { data, error } = await q;
      if (error) {
        console.warn("[google-spreadsheets]", error.message);
        return [];
      }
      return (data ?? []) as GoogleSpreadsheetRow[];
    },
  });
}

export function useGoogleSheets(connectorId?: string, spreadsheetId?: string) {
  return useQuery({
    queryKey: ["google-sheets", connectorId ?? "all", spreadsheetId ?? "all"],
    queryFn: async (): Promise<GoogleSheetRow[]> => {
      let q = supabase
        .from("google_sheets")
        .select("id, connector_id, spreadsheet_id, sheet_id, title, row_count, column_count, last_synced_at")
        .order("title");
      if (connectorId) q = q.eq("connector_id", connectorId);
      if (spreadsheetId) q = q.eq("spreadsheet_id", spreadsheetId);
      const { data, error } = await q;
      if (error) {
        console.warn("[google-sheets]", error.message);
        return [];
      }
      return (data ?? []) as GoogleSheetRow[];
    },
  });
}
