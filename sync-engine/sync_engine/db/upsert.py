"""Upsert helpers for mirrored Notion tables (composite PK connector_id + id)."""

from __future__ import annotations

import json
from typing import Any

import psycopg


def upsert_page(
    cur: psycopg.Cursor,
    connector_id: str,
    page_id: str,
    parent_id: str | None,
    title: str | None,
    url: str | None,
    last_edited_time: str | None,
    raw: dict[str, Any],
) -> None:
    """Insert or update one notion_pages row."""

    cur.execute(
        """
        insert into public.notion_pages (
          connector_id, id, parent_id, title, url, last_edited_time, raw_json
        ) values (%s, %s, %s, %s, %s, %s, %s::jsonb)
        on conflict (connector_id, id) do update set
          parent_id = excluded.parent_id,
          title = excluded.title,
          url = excluded.url,
          last_edited_time = excluded.last_edited_time,
          raw_json = excluded.raw_json,
          synced_at = now()
        """,
        (
            connector_id,
            page_id,
            parent_id,
            title,
            url,
            last_edited_time,
            json.dumps(raw),
        ),
    )


def upsert_database(
    cur: psycopg.Cursor,
    connector_id: str,
    db_id: str,
    title: str | None,
    properties: dict[str, Any] | None,
    raw: dict[str, Any],
) -> None:
    """Insert or update one notion_databases row."""

    cur.execute(
        """
        insert into public.notion_databases (
          connector_id, id, title, properties, raw_json
        ) values (%s, %s, %s, %s::jsonb, %s::jsonb)
        on conflict (connector_id, id) do update set
          title = excluded.title,
          properties = excluded.properties,
          raw_json = excluded.raw_json,
          synced_at = now()
        """,
        (
            connector_id,
            db_id,
            title,
            json.dumps(properties or {}),
            json.dumps(raw),
        ),
    )


def upsert_database_row(
    cur: psycopg.Cursor,
    connector_id: str,
    row_id: str,
    database_id: str,
    properties: dict[str, Any] | None,
    last_edited_time: str | None,
    raw: dict[str, Any],
) -> None:
    """Insert or update one notion_database_rows row."""

    cur.execute(
        """
        insert into public.notion_database_rows (
          connector_id, id, database_id, properties, last_edited_time, raw_json
        ) values (%s, %s, %s, %s::jsonb, %s, %s::jsonb)
        on conflict (connector_id, id) do update set
          database_id = excluded.database_id,
          properties = excluded.properties,
          last_edited_time = excluded.last_edited_time,
          raw_json = excluded.raw_json,
          synced_at = now()
        """,
        (
            connector_id,
            row_id,
            database_id,
            json.dumps(properties or {}),
            last_edited_time,
            json.dumps(raw),
        ),
    )
