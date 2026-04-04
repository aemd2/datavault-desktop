"""CLI entry: full or incremental Notion sync, plus check-stale alert."""

from __future__ import annotations

import argparse
import logging
import os
import sys

from sync_engine.alerts.email import send_stale_alert
from sync_engine.config import load_settings
from sync_engine.db.connection import connect
from sync_engine.notion.client import NotionClient
from sync_engine.notion.sync import run_full_sync, run_incremental_sync


def main(argv: list[str] | None = None) -> int:
    """Parse args, run sync, print summary counts from last log line."""

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="DataVault Notion → Postgres sync")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_full = sub.add_parser("sync", help="Full workspace sync via /search + database queries")
    p_full.add_argument(
        "--incremental",
        action="store_true",
        help="Use last_edited_time cutoff from SYNC_SINCE env (RFC3339)",
    )

    # check-stale: queries sync_jobs for the connector and sends an alert
    # if no successful 'done' job has been recorded within STALE_HOURS.
    p_stale = sub.add_parser(
        "check-stale",
        help=(
            "Alert if last successful sync is older than STALE_HOURS "
            "(default 26). Uses ALERT_EMAIL for delivery."
        ),
    )
    p_stale.add_argument(
        "--hours",
        type=int,
        default=0,
        help="Override STALE_HOURS env var (0 = use env/default)",
    )

    args = parser.parse_args(argv)

    try:
        settings = load_settings()
    except ValueError as e:
        print(e, file=sys.stderr)
        return 1

    if args.cmd == "sync":
        notion = NotionClient(settings.notion_token)
        try:
            with connect(settings.database_url) as conn:
                if args.incremental:
                    since = os.environ.get("SYNC_SINCE", "").strip()
                    if not since:
                        print("SYNC_SINCE env required for --incremental", file=sys.stderr)
                        return 1
                    run_incremental_sync(conn, settings, notion, since)
                else:
                    run_full_sync(conn, settings, notion)
        finally:
            notion.close()
        print("Sync finished OK.")

    elif args.cmd == "check-stale":
        stale_hours = args.hours if args.hours > 0 else settings.stale_hours
        _run_check_stale(settings, stale_hours)

    return 0


def _run_check_stale(settings, stale_hours: int) -> None:
    """
    Check if the last successful sync job for this connector is older than
    stale_hours. If so, send a stale alert email.
    """
    with connect(settings.database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select finished_at
                from public.sync_jobs
                where connector_id = %s
                  and status = 'done'
                order by finished_at desc
                limit 1
                """,
                (settings.connector_id,),
            )
            row = cur.fetchone()

    if row is None:
        logging.warning(
            "check-stale: no successful sync found for connector %s — sending alert",
            settings.connector_id,
        )
        send_stale_alert(settings.connector_id, stale_hours)
        return

    finished_at = row[0]
    import datetime
    now = datetime.datetime.now(tz=datetime.timezone.utc)
    # finished_at may be naive (Postgres timestamptz becomes aware in psycopg3).
    if finished_at.tzinfo is None:
        finished_at = finished_at.replace(tzinfo=datetime.timezone.utc)

    age_hours = (now - finished_at).total_seconds() / 3600
    if age_hours > stale_hours:
        logging.warning(
            "check-stale: last sync was %.1fh ago (threshold=%dh) — sending alert",
            age_hours,
            stale_hours,
        )
        send_stale_alert(settings.connector_id, int(age_hours))
    else:
        logging.info(
            "check-stale: last sync was %.1fh ago — OK (threshold=%dh)",
            age_hours,
            stale_hours,
        )


if __name__ == "__main__":
    raise SystemExit(main())
