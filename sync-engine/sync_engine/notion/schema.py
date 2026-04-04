"""Map Notion API JSON to flat fields for Postgres."""

from __future__ import annotations

from typing import Any


def _plain_from_rich(rich: list[dict[str, Any]] | None) -> str | None:
    if not rich:
        return None
    text = "".join(p.get("plain_text", "") for p in rich)
    return text or None


def page_title(page: dict[str, Any]) -> str | None:
    """Best-effort title: first non-empty property with type ``title`` (Notion key varies by locale/template)."""

    props = page.get("properties") or {}
    if not isinstance(props, dict):
        return None
    for p in props.values():
        if not isinstance(p, dict):
            continue
        if p.get("type") == "title":
            text = _plain_from_rich(p.get("title"))
            if text and text.strip():
                return text
    return None


def parent_id(page: dict[str, Any]) -> str | None:
    """Return parent Notion id when parent is page/database/block; else None."""

    parent = page.get("parent") or {}
    ptype = parent.get("type")
    if ptype == "page_id":
        return parent.get("page_id")
    if ptype == "database_id":
        return parent.get("database_id")
    if ptype == "block_id":
        return parent.get("block_id")
    return None


def database_title(db: dict[str, Any]) -> str | None:
    title = db.get("title")
    if isinstance(title, list):
        return _plain_from_rich(title)
    return None
