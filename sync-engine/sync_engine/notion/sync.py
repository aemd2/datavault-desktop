"""Orchestrate a full Notion pull into Postgres for one connector.

After each successful Postgres upsert we also write to the local vault
(Markdown for pages, CSV+JSON for databases). Vault writes are best-effort:
a failure logs a warning but never aborts the sync job.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from sync_engine.db.job_progress import ThrottledProgressReporter, update_job_progress
from sync_engine.db.upsert import upsert_database, upsert_database_row, upsert_page
from sync_engine.notion.schema import database_title, page_title, parent_id
from sync_engine.vault.writer import write_database, write_page
from sync_engine.alerts.email import send_sync_failure_alert

if TYPE_CHECKING:
    import psycopg

    from sync_engine.config import Settings
    from sync_engine.notion.client import NotionClient

logger = logging.getLogger(__name__)


def _begin_sync_job(conn: psycopg.Connection, connector_id: str, initial_log: str) -> str:
    """
    Prefer claiming the oldest pending row (created by the web app \"Sync Now\").
    If none, insert a fresh running job (CLI / cron without a prior pending row).
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            WITH next_job AS (
              SELECT id FROM public.sync_jobs
              WHERE connector_id = %s AND status = 'pending'
              ORDER BY created_at ASC
              LIMIT 1
              FOR UPDATE SKIP LOCKED
            )
            UPDATE public.sync_jobs AS sj
            SET
              status = 'running',
              started_at = now(),
              progress_pct = 5,
              progress_step = 'Starting backup…'
            FROM next_job
            WHERE sj.id = next_job.id
            RETURNING sj.id
            """,
            (connector_id,),
        )
        row = cur.fetchone()
        job_id: str | None = str(row[0]) if row else None
        if not job_id:
            cur.execute(
                """
                insert into public.sync_jobs (
                  connector_id, status, started_at, progress_pct, progress_step
                )
                values (%s, 'running', now(), 5, 'Starting backup…')
                returning id
                """,
                (connector_id,),
            )
            row2 = cur.fetchone()
            job_id = str(row2[0]) if row2 else None
        if job_id:
            cur.execute(
                """
                insert into public.sync_logs (sync_job_id, level, message)
                values (%s::uuid, 'info', %s)
                """,
                (job_id, initial_log),
            )
    if not job_id:
        raise RuntimeError("Could not create sync_jobs row")
    return job_id


# ---------------------------------------------------------------------------
# Helpers to collect in-memory rows before writing to vault.
# We accumulate rows per database_id within a sync run so we can write a
# single CSV/JSON file per database rather than one file per row.
# ---------------------------------------------------------------------------


def run_full_sync(conn: psycopg.Connection, settings: Settings, notion: NotionClient) -> None:
    """
    Walk /search, persist pages and databases, then query each database for rows.

    Commits the sync_jobs row first so a failure still leaves a failed job record.
    After a successful commit, writes the vault files (best-effort).
    """

    page_count = 0
    database_count = 0
    row_count = 0

    # Accumulate vault data in memory to write after Postgres commit.
    # vault_pages: list of (title, raw_json)
    # vault_databases: dict of db_id → {title, schema, rows: [raw row json]}
    vault_pages: list[tuple[str | None, dict]] = []
    vault_databases: dict[str, dict] = {}

    # Phase 1: claim pending \"Sync Now\" job or insert a running row; then commit.
    job_id = _begin_sync_job(conn, settings.connector_id, "Starting Notion search crawl")
    conn.commit()

    # Throttled progress writes use a second connection so the UI can poll while we upsert.
    pulse = ThrottledProgressReporter(settings.database_url, job_id)
    pulse.pulse(8, "Reading your Notion workspace…", force=True)

    try:
        with conn.cursor() as cur:
            for item in notion.iter_search_results():
                obj = item.get("object")
                iid = item.get("id")
                if not iid:
                    continue

                progressed = False
                if obj == "page":
                    full = notion.retrieve_page(iid)
                    if full.get("archived"):
                        continue
                    try:
                        full = {**full, "blocks": notion.fetch_page_block_tree(iid)}
                    except Exception:
                        logger.warning(
                            "Could not load blocks for page %s — saving metadata only",
                            iid,
                            exc_info=True,
                        )
                        full = {**full, "blocks": []}
                    upsert_page(
                        cur,
                        settings.connector_id,
                        iid,
                        parent_id(full),
                        page_title(full),
                        full.get("url"),
                        full.get("last_edited_time"),
                        full,
                    )
                    page_count += 1
                    # Collect for vault writing after commit.
                    vault_pages.append((page_title(full), full))
                    progressed = True

                elif obj == "database":
                    full_db = notion.retrieve_database(iid)
                    db_name = database_title(full_db)
                    upsert_database(
                        cur,
                        settings.connector_id,
                        iid,
                        db_name,
                        full_db.get("properties"),
                        full_db,
                    )
                    database_count += 1
                    # Start collecting rows for this database.
                    vault_databases[iid] = {
                        "title": db_name,
                        "schema": full_db.get("properties"),
                        "rows": [],
                    }

                    for row in notion.iter_database_rows(iid):
                        rid = row.get("id")
                        if not rid or row.get("archived"):
                            continue
                        upsert_database_row(
                            cur,
                            settings.connector_id,
                            rid,
                            iid,
                            row.get("properties"),
                            row.get("last_edited_time"),
                            row,
                        )
                        row_count += 1
                        vault_databases[iid]["rows"].append(row)
                    progressed = True

                if progressed:
                    pct = min(92, 10 + page_count + database_count * 3 + min(row_count // 15, 35))
                    step = f"{page_count} pages · {database_count} tables · {row_count} rows"
                    pulse.pulse(pct, step)

            update_job_progress(settings.database_url, job_id, 95, "Saving your backup…")

            cur.execute(
                """
                insert into public.sync_logs (sync_job_id, level, message)
                values (%s::uuid, 'info', %s)
                """,
                (
                    job_id,
                    f"Done: pages={page_count}, databases={database_count}, db_rows={row_count}",
                ),
            )
            cur.execute(
                """
                update public.sync_jobs
                set status = 'done',
                    pages_synced = %s,
                    finished_at = now(),
                    progress_pct = 100,
                    progress_step = 'Complete'
                where id = %s::uuid
                """,
                (page_count + row_count, job_id),
            )
        conn.commit()

        # Vault writes — best-effort after a successful Postgres commit.
        _write_vault(settings, vault_pages, vault_databases)

    except Exception as e:
        logger.exception("Sync failed")
        conn.rollback()
        with conn.cursor() as cur:
            cur.execute(
                """
                update public.sync_jobs
                set status = 'failed',
                    finished_at = now(),
                    progress_step = %s
                where id = %s::uuid
                """,
                ("Backup failed — see details below", job_id),
            )
            cur.execute(
                """
                insert into public.sync_logs (sync_job_id, level, message)
                values (%s::uuid, 'error', %s)
                """,
                (job_id, str(e)[:2000]),
            )
        conn.commit()
        # Send failure alert — best-effort.
        send_sync_failure_alert(settings.connector_id, str(e))
        raise


def run_incremental_sync(
    conn: psycopg.Connection,
    settings: Settings,
    notion: NotionClient,
    since_iso: str,
) -> None:
    """
    Incremental pass: process /search sorted by last_edited_time desc until items
    are older than ``since_iso`` (RFC3339 string compare works for Notion timestamps).
    After a successful commit, writes updated items to the local vault.
    """

    page_count = 0
    row_count = 0
    database_touch = 0

    vault_pages: list[tuple[str | None, dict]] = []
    vault_databases: dict[str, dict] = {}

    job_id = _begin_sync_job(conn, settings.connector_id, f"Incremental sync since {since_iso}")
    conn.commit()

    pulse = ThrottledProgressReporter(settings.database_url, job_id)
    pulse.pulse(8, "Checking recent Notion changes…", force=True)

    try:
        with conn.cursor() as cur:
            cursor: str | None = None
            stopped = False
            while not stopped:
                data = notion.search_sorted_by_last_edited(cursor)
                for item in data.get("results", []):
                    edited = item.get("last_edited_time") or ""
                    if edited < since_iso:
                        stopped = True
                        break
                    obj = item.get("object")
                    iid = item.get("id")
                    if not iid:
                        continue
                    progressed = False
                    if obj == "page":
                        full = notion.retrieve_page(iid)
                        if full.get("archived"):
                            continue
                        try:
                            full = {**full, "blocks": notion.fetch_page_block_tree(iid)}
                        except Exception:
                            logger.warning(
                                "Could not load blocks for page %s — saving metadata only",
                                iid,
                                exc_info=True,
                            )
                            full = {**full, "blocks": []}
                        upsert_page(
                            cur,
                            settings.connector_id,
                            iid,
                            parent_id(full),
                            page_title(full),
                            full.get("url"),
                            full.get("last_edited_time"),
                            full,
                        )
                        page_count += 1
                        vault_pages.append((page_title(full), full))
                        progressed = True
                    elif obj == "database":
                        full_db = notion.retrieve_database(iid)
                        db_name = database_title(full_db)
                        upsert_database(
                            cur,
                            settings.connector_id,
                            iid,
                            db_name,
                            full_db.get("properties"),
                            full_db,
                        )
                        database_touch += 1
                        vault_databases[iid] = {
                            "title": db_name,
                            "schema": full_db.get("properties"),
                            "rows": [],
                        }
                        for row in notion.iter_database_rows(iid):
                            rid = row.get("id")
                            if not rid or row.get("archived"):
                                continue
                            r_edited = row.get("last_edited_time") or ""
                            if r_edited < since_iso:
                                continue
                            upsert_database_row(
                                cur,
                                settings.connector_id,
                                rid,
                                iid,
                                row.get("properties"),
                                row.get("last_edited_time"),
                                row,
                            )
                            row_count += 1
                            vault_databases[iid]["rows"].append(row)
                        progressed = True

                    if progressed:
                        pct = min(92, 10 + page_count + database_touch * 3 + min(row_count // 15, 35))
                        step = f"{page_count} pages · {database_touch} tables · {row_count} rows"
                        pulse.pulse(pct, step)
                if not data.get("has_more"):
                    break
                cursor = data.get("next_cursor")
                if not cursor:
                    break

            update_job_progress(settings.database_url, job_id, 95, "Saving your backup…")

            cur.execute(
                """
                update public.sync_jobs
                set status = 'done',
                    pages_synced = %s,
                    finished_at = now(),
                    progress_pct = 100,
                    progress_step = 'Complete'
                where id = %s::uuid
                """,
                (page_count + row_count, job_id),
            )
            cur.execute(
                """
                insert into public.sync_logs (sync_job_id, level, message)
                values (%s::uuid, 'info', %s)
                """,
                (
                    job_id,
                    f"Incremental done: pages={page_count}, db_rows={row_count}, "
                    f"databases_touched={database_touch}",
                ),
            )
        conn.commit()

        # Vault writes — best-effort after a successful Postgres commit.
        _write_vault(settings, vault_pages, vault_databases)

    except Exception as e:
        logger.exception("Incremental sync failed")
        conn.rollback()
        with conn.cursor() as cur:
            cur.execute(
                """
                update public.sync_jobs
                set status = 'failed',
                    finished_at = now(),
                    progress_step = %s
                where id = %s::uuid
                """,
                ("Backup failed — see details below", job_id),
            )
            cur.execute(
                """
                insert into public.sync_logs (sync_job_id, level, message)
                values (%s::uuid, 'error', %s)
                """,
                (job_id, str(e)[:2000]),
            )
        conn.commit()
        # Send failure alert — best-effort.
        send_sync_failure_alert(settings.connector_id, str(e))
        raise


# ---------------------------------------------------------------------------
# Vault helper
# ---------------------------------------------------------------------------

def _write_vault(
    settings: Settings,
    vault_pages: list[tuple[str | None, dict]],
    vault_databases: dict[str, dict],
) -> None:
    """
    Write all collected pages and databases to the local vault.
    Wrapped in a try/except so a failure never propagates to the caller.
    """
    try:
        for title, raw_json in vault_pages:
            write_page(settings.vault_path, settings.connector_id, title, raw_json)

        for db_info in vault_databases.values():
            write_database(
                settings.vault_path,
                settings.connector_id,
                db_info["title"],
                db_info["schema"],
                db_info["rows"],
            )
        logger.info(
            "Vault: wrote %d pages and %d databases",
            len(vault_pages),
            len(vault_databases),
        )
    except Exception:
        logger.warning("Vault write partially failed — sync result is unaffected", exc_info=True)
