import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface TodoistProjectRow {
  id: string;
  connector_id: string;
  name: string;
  color: string | null;
  parent_id: string | null;
  is_favorite: boolean;
  last_seen_at: string | null;
}

export interface TodoistTaskRow {
  id: string;
  connector_id: string;
  project_id: string;
  content: string;
  description: string | null;
  priority: number;
  due: string | null;
  completed_at: string | null;
  last_seen_at: string | null;
}

export function useTodoistProjects(connectorId?: string) {
  return useQuery({
    queryKey: ["todoist-projects", connectorId ?? "all"],
    queryFn: async (): Promise<TodoistProjectRow[]> => {
      let q = supabase
        .from("todoist_projects")
        .select("id, connector_id, name, color, parent_id, is_favorite, last_seen_at")
        .order("name");
      if (connectorId) q = q.eq("connector_id", connectorId);
      const { data, error } = await q;
      if (error) {
        console.warn("[todoist-projects]", error.message);
        return [];
      }
      return (data ?? []) as TodoistProjectRow[];
    },
  });
}

export function useTodoistTasks(connectorId?: string, projectId?: string) {
  return useQuery({
    queryKey: ["todoist-tasks", connectorId ?? "all", projectId ?? "all"],
    queryFn: async (): Promise<TodoistTaskRow[]> => {
      let q = supabase
        .from("todoist_tasks")
        .select("id, connector_id, project_id, content, description, priority, due, completed_at, last_seen_at")
        .order("last_seen_at", { ascending: false });
      if (connectorId) q = q.eq("connector_id", connectorId);
      if (projectId) q = q.eq("project_id", projectId);
      const { data, error } = await q;
      if (error) {
        console.warn("[todoist-tasks]", error.message);
        return [];
      }
      return (data ?? []) as TodoistTaskRow[];
    },
  });
}
