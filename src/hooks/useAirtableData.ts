import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface AirtableBaseRow {
  id: string;
  connector_id: string;
  name: string;
  permission_level: string | null;
  last_synced_at: string | null;
}

export interface AirtableTableRow {
  id: string;
  connector_id: string;
  base_id: string;
  name: string;
  /** JSON array of field schemas {id, name, type, options} */
  fields_json: unknown;
  last_synced_at: string | null;
}

export interface AirtableRecordRow {
  id: string;
  connector_id: string;
  base_id: string;
  table_id: string;
  /** JSON map of {fieldId -> value} — structure is table-specific. */
  fields_json: unknown;
  created_time: string | null;
  last_modified_time: string | null;
}

export function useAirtableBases(connectorId?: string) {
  return useQuery({
    queryKey: ["airtable-bases", connectorId ?? "all"],
    queryFn: async (): Promise<AirtableBaseRow[]> => {
      let q = supabase
        .from("airtable_bases")
        .select("id, connector_id, name, permission_level, last_synced_at")
        .order("name");
      if (connectorId) q = q.eq("connector_id", connectorId);
      const { data, error } = await q;
      if (error) {
        console.warn("[airtable-bases]", error.message);
        return [];
      }
      return (data ?? []) as AirtableBaseRow[];
    },
  });
}

export function useAirtableTables(connectorId?: string, baseId?: string) {
  return useQuery({
    queryKey: ["airtable-tables", connectorId ?? "all", baseId ?? "all"],
    queryFn: async (): Promise<AirtableTableRow[]> => {
      let q = supabase
        .from("airtable_tables")
        .select("id, connector_id, base_id, name, fields_json, last_synced_at")
        .order("name");
      if (connectorId) q = q.eq("connector_id", connectorId);
      if (baseId) q = q.eq("base_id", baseId);
      const { data, error } = await q;
      if (error) {
        console.warn("[airtable-tables]", error.message);
        return [];
      }
      return (data ?? []) as AirtableTableRow[];
    },
  });
}
