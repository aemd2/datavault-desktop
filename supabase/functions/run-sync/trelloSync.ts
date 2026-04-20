/**
 * Chunked Trello backup for run-sync (same 35s budget as Notion chunks).
 * Uses TRELLO_API_KEY + member OAuth token from connectors.access_token.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Admin = ReturnType<typeof createClient>;

const TRELLO_API = "https://api.trello.com/1";
const CHUNK_TIME_MS = 35_000;

export type TrelloChunkState = {
  phase: "boards" | "lists" | "cards";
  board_ids: string[];
  list_board_idx: number;
  card_board_idx: number;
  /** Pagination within one board's card stream. */
  card_before: string | null;
  boards_done: number;
  lists_done: number;
  cards_done: number;
};

function initialTrelloState(): TrelloChunkState {
  return {
    phase: "boards",
    board_ids: [],
    list_board_idx: 0,
    card_board_idx: 0,
    card_before: null,
    boards_done: 0,
    lists_done: 0,
    cards_done: 0,
  };
}

function mergeState(raw: unknown): TrelloChunkState {
  const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const phase = s.phase === "lists" || s.phase === "cards" || s.phase === "boards" ? s.phase : "boards";
  return {
    phase,
    board_ids: Array.isArray(s.board_ids) ? (s.board_ids as string[]).filter(Boolean) : [],
    list_board_idx: typeof s.list_board_idx === "number" ? s.list_board_idx : 0,
    card_board_idx: typeof s.card_board_idx === "number" ? s.card_board_idx : 0,
    card_before: typeof s.card_before === "string" ? s.card_before : null,
    boards_done: typeof s.boards_done === "number" ? s.boards_done : 0,
    lists_done: typeof s.lists_done === "number" ? s.lists_done : 0,
    cards_done: typeof s.cards_done === "number" ? s.cards_done : 0,
  };
}

async function trelloGet(
  apiKey: string,
  token: string,
  path: string,
  params: Record<string, string> = {},
): Promise<unknown> {
  const u = new URL(`${TRELLO_API}/${path.replace(/^\//, "")}`);
  u.searchParams.set("key", apiKey);
  u.searchParams.set("token", token);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, v);
  }
  const r = await fetch(u.toString());
  const text = await r.text();
  if (r.status === 401 || r.status === 403) {
    throw new Error(
      r.status === 401
        ? "Trello access was revoked or expired — disconnect this workspace and reconnect Trello from Platforms."
        : "Trello blocked this request — check board permissions.",
    );
  }
  if (!r.ok) throw new Error(`Trello API error (${r.status}): ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Trello returned non-JSON: ${text.slice(0, 120)}`);
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version, prefer",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function jsonResp(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function jobIsCancelled(admin: Admin, jobId: string): Promise<boolean> {
  const { data } = await admin.from("sync_jobs").select("status").eq("id", jobId).maybeSingle();
  return data?.status === "cancelled";
}

export async function handleTrelloSyncChunk(
  admin: Admin,
  ctx: {
    userId: string;
    connectorId: string;
    jobId: string;
    trelloToken: string;
    chunkStart: number;
    body: Record<string, unknown>;
  },
): Promise<Response> {
  const apiKey = Deno.env.get("TRELLO_API_KEY") ?? "";
  if (!apiKey) {
    const msg = "Server missing TRELLO_API_KEY — add it in Edge Function secrets.";
    await admin.from("sync_jobs").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      progress_step: msg,
      chunk_state: null,
    }).eq("id", ctx.jobId);
    return jsonResp({ status: "failed", error: msg, connector_kind: "trello" });
  }

  const timeLeft = () => CHUNK_TIME_MS - (Date.now() - ctx.chunkStart);

  const { data: jobRow } = await admin.from("sync_jobs").select("chunk_state").eq("id", ctx.jobId).maybeSingle();
  const cs = (jobRow?.chunk_state ?? {}) as Record<string, unknown>;
  const fromBody = ctx.body["kind_state"] as Record<string, unknown> | undefined;
  const fromDb = cs["trello"] as Record<string, unknown> | undefined;
  let st = mergeState(fromBody ?? fromDb ?? initialTrelloState());

  const saveState = async (pct: number, step: string) => {
    await admin.from("sync_jobs").update({
      progress_pct: pct,
      progress_step: step.slice(0, 500),
      chunk_state: { trello: JSON.parse(JSON.stringify(st)) as Record<string, unknown> },
    }).eq("id", ctx.jobId);
  };

  try {
    // ── Phase: boards ───────────────────────────────────────────────────────
    if (st.phase === "boards") {
      if (await jobIsCancelled(admin, ctx.jobId)) return jsonResp({ status: "cancelled" });
      const boards = await trelloGet(apiKey, ctx.trelloToken, "members/me/boards", {
        fields: "id,name,desc,closed,url,dateLastActivity",
        filter: "all",
      }) as Record<string, unknown>[];
      for (const b of boards) {
        const id = String(b.id ?? "");
        if (!id) continue;
        await admin.from("trello_boards").upsert({
          connector_id: ctx.connectorId,
          id,
          name: String(b.name ?? ""),
          desc: b.desc != null ? String(b.desc) : null,
          url: b.url != null ? String(b.url) : null,
          closed: Boolean(b.closed),
          last_activity_date: b.dateLastActivity != null ? String(b.dateLastActivity) : null,
          raw_json: b,
        }, { onConflict: "connector_id,id" });
      }
      st.boards_done = boards.length;
      st.board_ids = boards.map((b) => String(b.id ?? "")).filter(Boolean);
      st.phase = "lists";
      st.list_board_idx = 0;
      await saveState(15, `Found ${st.board_ids.length} boards — syncing lists…`);
      if (timeLeft() < 4_000) {
        return jsonResp({
          status: "needs_more",
          job_id: ctx.jobId,
          connector_id: ctx.connectorId,
          connector_kind: "trello",
          kind_state: st,
        });
      }
    }

    // ── Phase: lists ────────────────────────────────────────────────────────
    while (st.phase === "lists" && st.list_board_idx < st.board_ids.length && timeLeft() > 2_500) {
      if (await jobIsCancelled(admin, ctx.jobId)) return jsonResp({ status: "cancelled" });
      const bid = st.board_ids[st.list_board_idx];
      const lists = await trelloGet(apiKey, ctx.trelloToken, `boards/${bid}/lists`, {
        fields: "id,name,idBoard,closed,pos",
      }) as Record<string, unknown>[];
      for (const L of lists) {
        const id = String(L.id ?? "");
        if (!id) continue;
        await admin.from("trello_lists").upsert({
          connector_id: ctx.connectorId,
          id,
          board_id: String(L.idBoard ?? bid),
          name: String(L.name ?? ""),
          closed: Boolean(L.closed),
          pos: L.pos != null ? String(L.pos) : null,
          raw_json: L,
        }, { onConflict: "connector_id,id" });
        st.lists_done++;
      }
      st.list_board_idx++;
      const pct = 15 + Math.min(40, Math.round((st.list_board_idx / Math.max(1, st.board_ids.length)) * 40));
      await saveState(pct, `Lists for board ${st.list_board_idx}/${st.board_ids.length}…`);
    }

    if (st.phase === "lists" && st.list_board_idx < st.board_ids.length) {
      return jsonResp({
        status: "needs_more",
        job_id: ctx.jobId,
        connector_id: ctx.connectorId,
        connector_kind: "trello",
        kind_state: st,
      });
    }

    if (st.phase === "lists") {
      st.phase = "cards";
      st.card_board_idx = 0;
      st.card_before = null;
      await saveState(55, "Now downloading rich card data (checklists, attachments, members, labels)…");
    }

    // ── Phase: cards ─────────────────────────────────────────────────────────
    while (st.phase === "cards" && st.card_board_idx < st.board_ids.length && timeLeft() > 3_000) {
      if (await jobIsCancelled(admin, ctx.jobId)) return jsonResp({ status: "cancelled" });
      const bid = st.board_ids[st.card_board_idx];

      // Detailed research on what we are downloading (Trello API reference 2026):
      // - Boards: basic metadata + raw_json (name, desc, url, activity, closed)
      // - Lists: per-board with pos, closed, raw_json
      // - Cards: now expanded with checklists=all (full items with state), attachments (urls, sizes,
      //   mime types, previews), members (full profiles), labels (colors, names). See trelloGet params.
      // This maximizes information: checklists become Markdown tasks in future vault export,
      // attachments can be downloaded to vault, labels/members enrich card views.
      // Matches PRD Phase 2 Trello spec: "checklists synced (Markdown task lists)", "Attachments downloaded to local vault".
      // raw_json now holds the full payload for viewer or export.
      const q: Record<string, string> = {
        fields: "id,idBoard,idList,name,desc,due,closed,dateLastActivity,idLabels,idMembers,idChecklists",
        checklists: "all",
        attachments: "true",
        members: "true",
        labels: "true",
        limit: "50",  // Smaller to keep chunk under time limit with rich nested data
      };
      if (st.card_before) q.before = st.card_before;
      const cards = await trelloGet(apiKey, ctx.trelloToken, `boards/${bid}/cards`, q) as Record<string, unknown>[];

      if (!cards.length) {
        st.card_board_idx++;
        st.card_before = null;
        continue;
      }

      let checklistsInBatch = 0;
      let attachmentsInBatch = 0;

      for (const c of cards) {
        const id = String(c.id ?? "");
        if (!id) continue;

        // Count rich nested data for very detailed progress reporting
        const cardAny = c as any;
        if (Array.isArray(cardAny.checklists)) checklistsInBatch += cardAny.checklists.length;
        if (Array.isArray(cardAny.attachments)) attachmentsInBatch += cardAny.attachments.length;

        await admin.from("trello_cards").upsert({
          connector_id: ctx.connectorId,
          id,
          board_id: String(c.idBoard ?? bid),
          list_id: c.idList != null ? String(c.idList) : null,
          name: String(c.name ?? ""),
          desc: c.desc != null ? String(c.desc) : null,
          due: c.due != null ? String(c.due) : null,
          closed: Boolean(c.closed),
          last_activity_date: c.dateLastActivity != null ? String(c.dateLastActivity) : null,
          raw_json: c,  // Now VERY rich — contains checklists, attachments, members, labels
        }, { onConflict: "connector_id,id" });
        st.cards_done++;
      }

      if (cards.length < 50) {
        st.card_board_idx++;
        st.card_before = null;
      } else {
        st.card_before = String(cards[cards.length - 1].id ?? "");
      }

      const pct = 55 + Math.min(40, Math.round((st.card_board_idx / Math.max(1, st.board_ids.length)) * 40));
      const boardMsg = `board ${st.card_board_idx}/${st.board_ids.length}`;
      await saveState(
        pct,
        `Downloaded ${cards.length} cards for ${boardMsg} (${checklistsInBatch} checklists, ${attachmentsInBatch} attachments)…`
      );
    }

    if (st.phase === "cards" && st.card_board_idx < st.board_ids.length) {
      return jsonResp({
        status: "needs_more",
        job_id: ctx.jobId,
        connector_id: ctx.connectorId,
        connector_kind: "trello",
        kind_state: st,
      });
    }

    const total = st.boards_done + st.lists_done + st.cards_done;
    await admin.from("sync_jobs").update({
      status: "done",
      finished_at: new Date().toISOString(),
      progress_pct: 100,
      // Very detailed final message now reflects the rich data we downloaded
      progress_step: `Complete — ${st.boards_done} boards, ${st.lists_done} lists, ${st.cards_done} cards with checklists & attachments.`,
      pages_synced: total,
      chunk_state: null,
    }).eq("id", ctx.jobId);

    await admin.from("connectors").update({ last_synced_at: new Date().toISOString() }).eq("id", ctx.connectorId);

    return jsonResp({
      status: "done",
      job_id: ctx.jobId,
      connector_kind: "trello",
      pages: st.cards_done,
      databases: st.lists_done,
      rows: st.boards_done,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("sync_jobs").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      progress_step: msg.slice(0, 500),
      chunk_state: { trello: JSON.parse(JSON.stringify(st)) as Record<string, unknown> },
    }).eq("id", ctx.jobId);
    return jsonResp({ status: "failed", error: msg.slice(0, 500), connector_kind: "trello" });
  }
}
