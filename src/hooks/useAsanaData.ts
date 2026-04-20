import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface AsanaProjectRow {
  id: string;
  connector_id: string;
  workspace_gid: string;
  name: string;
  notes: string | null;
  archived: boolean;
  modified_at: string | null;
}

export interface AsanaTaskRow {
  id: string;
  connector_id: string;
  project_gid: string;
  name: string;
  notes: string | null;
  completed: boolean;
  due_on: string | null;
  modified_at: string | null;
}

export function useAsanaProjects(connectorId?: string) {
  return useQuery({
    queryKey: ["asana-projects", connectorId ?? "all"],
    queryFn: async (): Promise<AsanaProjectRow[]> => {
      let q = supabase
        .from("asana_projects")
        .select("id, connector_id, workspace_gid, name, notes, archived, modified_at")
        .order("modified_at", { ascending: false });
      if (connectorId) q = q.eq("connector_id", connectorId);
      const { data, error } = await q;
      if (error) {
        console.warn("[asana-projects]", error.message);
        return [];
      }
      return (data ?? []) as AsanaProjectRow[];
    },
  });
}

export function useAsanaTasks(connectorId?: string, projectGid?: string) {
  return useQuery({
    queryKey: ["asana-tasks", connectorId ?? "all", projectGid ?? "all"],
    queryFn: async (): Promise<AsanaTaskRow[]> => {
      let q = supabase
        .from("asana_tasks")
        .select("id, connector_id, project_gid, name, notes, completed, due_on, modified_at")
        .order("modified_at", { ascending: false });
      if (connectorId) q = q.eq("connector_id", connectorId);
      if (projectGid) q = q.eq("project_gid", projectGid);
      const { data, error } = await q;
      if (error) {
        console.warn("[asana-tasks]", error.message);
        return [];
      }
      return (data ?? []) as AsanaTaskRow[];
    },
  });
}
