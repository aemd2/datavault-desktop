"""
Load environment for the CLI.

We read DATABASE_URL (Postgres URI), NOTION_TOKEN (integration secret),
and CONNECTOR_ID (UUID of public.connectors row).

Reason: all notion_* rows are keyed by connector_id for RLS and multi-tenant safety.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

# Load .env from cwd or sync-engine folder when running locally.
load_dotenv()


@dataclass(frozen=True)
class Settings:
    """Runtime configuration for one sync run."""

    database_url: str
    notion_token: str
    connector_id: str
    # VAULT_PATH: local directory to write Markdown/CSV/JSON files.
    # Defaults to ./vault relative to cwd if not set.
    vault_path: str = "./vault"
    # STALE_HOURS: hours before a connector is considered stale for alerts.
    stale_hours: int = 26


def load_settings() -> Settings:
    """Read required env vars; raise if any are missing."""

    db = os.environ.get("DATABASE_URL", "").strip()
    token = os.environ.get("NOTION_TOKEN", "").strip()
    connector = os.environ.get("CONNECTOR_ID", "").strip()

    missing = [n for n, v in [
        ("DATABASE_URL", db),
        ("NOTION_TOKEN", token),
        ("CONNECTOR_ID", connector),
    ] if not v]

    if missing:
        msg = f"Missing env: {', '.join(missing)}. See README.md."
        raise ValueError(msg)

    vault_path = os.environ.get("VAULT_PATH", "./vault").strip() or "./vault"
    stale_hours_raw = os.environ.get("STALE_HOURS", "26").strip()
    try:
        stale_hours = int(stale_hours_raw)
    except ValueError:
        stale_hours = 26

    return Settings(
        database_url=db,
        notion_token=token,
        connector_id=connector,
        vault_path=vault_path,
        stale_hours=stale_hours,
    )
