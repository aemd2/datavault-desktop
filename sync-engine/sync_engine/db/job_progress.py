"""
Push sync progress to Postgres so the web dashboard can poll sync_jobs.

Uses a separate autocommit connection so progress is visible while the main
sync transaction is still open (large upserts stay in one transaction).
"""

from __future__ import annotations

import logging
import time

import psycopg

logger = logging.getLogger(__name__)


def update_job_progress(database_url: str, job_id: str, pct: int, step: str) -> None:
    """
    Best-effort UPDATE of progress_pct / progress_step. Never raises to caller.

    Clamps pct to 0–100 and truncates step so we do not store huge strings.
    """
    pct = max(0, min(100, pct))
    step_clean = (step or "").strip()[:500] or None
    try:
        with psycopg.connect(database_url, autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    update public.sync_jobs
                    set progress_pct = %s, progress_step = %s
                    where id = %s::uuid
                    """,
                    (pct, step_clean, job_id),
                )
    except Exception:
        logger.warning("Could not update job progress (non-fatal)", exc_info=True)


class ThrottledProgressReporter:
    """
    Rate-limit progress writes: every N items or every few seconds, whichever
    comes first, unless force=True (use at phase boundaries).
    """

    def __init__(self, database_url: str, job_id: str, *, every_n_items: int = 8, min_interval_s: float = 2.0):
        self._database_url = database_url
        self._job_id = job_id
        self._every_n = every_n_items
        self._min_interval_s = min_interval_s
        self._item_count = 0
        self._last_mono = 0.0

    def pulse(self, pct: int, step: str, *, force: bool = False) -> None:
        self._item_count += 1
        now = time.monotonic()
        if not force and self._item_count % self._every_n != 0 and (now - self._last_mono) < self._min_interval_s:
            return
        self._last_mono = now
        update_job_progress(self._database_url, self._job_id, pct, step)
