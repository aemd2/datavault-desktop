import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/** One board synced from Trello — mirrors the `trello_boards` table the Edge Function populates. */
export interface TrelloBoardRow {
  id: string;
  connector_id: string;
  name: string;
  desc: string | null;
  url: string | null;
  closed: boolean;
  last_activity_date: string | null;
}

/** One card synced from Trello — mirrors the `trello_cards` table. */
export interface TrelloCardRow {
  id: string;
  connector_id: string;
  board_id: string;
  list_id: string | null;
  name: string;
  desc: string | null;
  due: string | null;
  closed: boolean;
  last_activity_date: string | null;
}

/**
 * Fetch all synced Trello boards for the current user (RLS-scoped).
 * Returns `[]` gracefully if the `trello_boards` table has not been
 * provisioned yet — so the Platforms page can still render.
 */
export function useTrelloBoards(connectorId?: string) {
  return useQuery({
    queryKey: ["trello-boards", connectorId ?? "all"],
    queryFn: async (): Promise<TrelloBoardRow[]> => {
      let q = supabase
        .from("trello_boards")
        .select("id, connector_id, name, desc, url, closed, last_activity_date")
        .order("last_activity_date", { ascending: false });
      if (connectorId) q = q.eq("connector_id", connectorId);
      const { data, error } = await q;
      if (error) {
        // Table probably not provisioned yet — don't break the UI.
        console.warn("[trello-boards]", error.message);
        return [];
      }
      return (data ?? []) as TrelloBoardRow[];
    },
  });
}

/** One list synced from Trello — mirrors `trello_lists`. */
export interface TrelloListRow {
  id: string;
  connector_id: string;
  board_id: string;
  name: string;
  closed: boolean;
  pos: string | null;
}

/** Lists for a connector (optionally filtered to one board). */
export function useTrelloLists(connectorId?: string, boardId?: string) {
  return useQuery({
    queryKey: ["trello-lists", connectorId ?? "all", boardId ?? "all"],
    queryFn: async (): Promise<TrelloListRow[]> => {
      let q = supabase
        .from("trello_lists")
        .select("id, connector_id, board_id, name, closed, pos")
        .order("board_id", { ascending: true })
        .order("pos", { ascending: true });
      if (connectorId) q = q.eq("connector_id", connectorId);
      if (boardId) q = q.eq("board_id", boardId);
      const { data, error } = await q;
      if (error) {
        console.warn("[trello-lists]", error.message);
        return [];
      }
      return (data ?? []) as TrelloListRow[];
    },
  });
}

/** Fetch cards for a board (or all boards on this connector). */
export function useTrelloCards(connectorId?: string, boardId?: string) {
  return useQuery({
    queryKey: ["trello-cards", connectorId ?? "all", boardId ?? "all"],
    queryFn: async (): Promise<TrelloCardRow[]> => {
      let q = supabase
        .from("trello_cards")
        .select("id, connector_id, board_id, list_id, name, desc, due, closed, last_activity_date")
        .order("last_activity_date", { ascending: false });
      if (connectorId) q = q.eq("connector_id", connectorId);
      if (boardId) q = q.eq("board_id", boardId);
      const { data, error } = await q;
      if (error) {
        console.warn("[trello-cards]", error.message);
        return [];
      }
      return (data ?? []) as TrelloCardRow[];
    },
  });
}
