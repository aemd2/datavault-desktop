"""
Local vault writer — emits human-readable files alongside each Postgres upsert.

Layout on disk:
  vault/
    <connector_id>/
      pages/
        <page_title>.md        # Markdown with YAML frontmatter
      databases/
        <db_title>/
          schema.json          # property types and metadata
          rows.csv             # all rows as CSV
          rows.json            # all rows as JSON

Vault writes are best-effort: a write failure logs a warning but never
fails the sync job.  No external dependencies — stdlib only.
"""

from __future__ import annotations

import csv
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_name(text: str | None, fallback: str = "untitled") -> str:
    """Strip characters that are invalid in file/folder names."""
    name = (text or fallback).strip()
    # Replace / and \ with dash; collapse whitespace; trim.
    name = re.sub(r"[/\\]", "-", name)
    name = re.sub(r"\s+", " ", name)
    # Limit length so paths stay OS-compatible.
    return name[:120] or fallback


def _connector_root(vault_path: str, connector_id: str) -> Path:
    """Return and create the connector-specific vault directory."""
    root = Path(vault_path) / connector_id
    root.mkdir(parents=True, exist_ok=True)
    return root


def _blocks_to_text(blocks: list[dict[str, Any]]) -> str:
    """
    Best-effort conversion of Notion block objects to Markdown-ish text.

    Recurses into each block's ``children`` (filled by the sync client) so nested
    toggles, lists, and callouts keep document order like in Notion.
    """
    chunks: list[str] = []
    for block in blocks:
        piece = _single_block_to_text(block)
        if piece:
            chunks.append(piece)
    return "\n\n".join(chunks)


def _single_block_to_text(block: dict[str, Any]) -> str:
    """Render one block and its nested ``children`` (if any)."""

    lines: list[str] = []
    btype = block.get("type", "")
    data = block.get(btype, {}) if isinstance(block.get(btype), dict) else {}

    if btype in (
        "paragraph",
        "heading_1",
        "heading_2",
        "heading_3",
        "bulleted_list_item",
        "numbered_list_item",
        "toggle",
        "quote",
        "callout",
    ):
        rt = data.get("rich_text", [])
        text = "".join(t.get("plain_text", "") for t in rt)
        prefix = {
            "heading_1": "# ",
            "heading_2": "## ",
            "heading_3": "### ",
            "bulleted_list_item": "- ",
            "numbered_list_item": "1. ",
            "quote": "> ",
            "callout": "> 📌 ",
        }.get(btype, "")
        if text:
            lines.append(f"{prefix}{text}")

    elif btype == "to_do":
        rt = data.get("rich_text", [])
        text = "".join(t.get("plain_text", "") for t in rt)
        checked = data.get("checked", False)
        mark = "[x]" if checked else "[ ]"
        if text:
            lines.append(f"- {mark} {text}")

    elif btype == "divider":
        lines.append("---")

    elif btype in ("image", "file"):
        url = (
            data.get("external", {}).get("url") or data.get("file", {}).get("url") or ""
        )
        caption = "".join(t.get("plain_text", "") for t in data.get("caption", []))
        if url:
            lines.append(f"![{caption or btype}]({url})")

    elif btype == "code":
        rt = data.get("rich_text", [])
        text = "".join(t.get("plain_text", "") for t in rt)
        lang = data.get("language", "")
        lines.append(f"```{lang}\n{text}\n```")

    children = block.get("children") or []
    if isinstance(children, list) and children:
        nested = _blocks_to_text(children)
        if nested:
            lines.append(nested)

    return "\n\n".join(lines)


def _property_value_to_str(prop: dict[str, Any]) -> str:
    """
    Flatten a single Notion property value dict to a plain string.
    Handles the most common property types.
    """
    ptype = prop.get("type", "")
    data = prop.get(ptype)

    if data is None:
        return ""

    # Rich-text types.
    if isinstance(data, list) and ptype in (
        "rich_text", "title", "email", "phone_number"
    ):
        return "".join(t.get("plain_text", "") for t in data)

    if ptype == "number":
        return str(data) if data is not None else ""

    if ptype == "select":
        return (data or {}).get("name", "") if isinstance(data, dict) else ""

    if ptype == "multi_select":
        return ", ".join(s.get("name", "") for s in (data or []))

    if ptype == "status":
        return (data or {}).get("name", "") if isinstance(data, dict) else ""

    if ptype == "checkbox":
        return "true" if data else "false"

    if ptype in ("date",):
        return (data or {}).get("start", "") if isinstance(data, dict) else ""

    if ptype in ("created_time", "last_edited_time"):
        return str(data)

    if ptype == "url":
        return str(data) if data else ""

    if ptype in ("relation",):
        return ", ".join(r.get("id", "") for r in (data or []))

    if ptype == "people":
        return ", ".join(
            (p.get("name") or p.get("id", "")) for p in (data or [])
        )

    if ptype == "files":
        return ", ".join(
            (f.get("name") or f.get("external", {}).get("url", ""))
            for f in (data or [])
        )

    # Formula / rollup: return string representation of inner value.
    if ptype == "formula":
        inner = data if isinstance(data, dict) else {}
        ftype = inner.get("type", "")
        return str(inner.get(ftype, ""))

    return ""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def write_page(
    vault_path: str,
    connector_id: str,
    title: str | None,
    raw_json: dict[str, Any],
) -> None:
    """
    Write a Notion page as a Markdown file with YAML frontmatter.

    vault/<connector_id>/pages/<safe_title>.md
    """
    try:
        root = _connector_root(vault_path, connector_id)
        pages_dir = root / "pages"
        pages_dir.mkdir(exist_ok=True)

        safe_title = _safe_name(title)
        filepath = pages_dir / f"{safe_title}.md"

        # Build YAML frontmatter.
        page_id = raw_json.get("id", "")
        url = raw_json.get("url", "")
        created = raw_json.get("created_time", "")
        edited = raw_json.get("last_edited_time", "")

        frontmatter = (
            f"---\n"
            f"title: \"{safe_title}\"\n"
            f"notion_id: \"{page_id}\"\n"
            f"url: \"{url}\"\n"
            f"created_time: \"{created}\"\n"
            f"last_edited_time: \"{edited}\"\n"
            f"---\n\n"
        )

        # Convert content blocks if present in raw_json.
        blocks: list[dict] = raw_json.get("blocks", [])
        body = _blocks_to_text(blocks) if blocks else ""

        filepath.write_text(frontmatter + f"# {safe_title}\n\n" + body, encoding="utf-8")
        logger.debug("Vault: wrote page %s", filepath)

    except Exception:
        logger.warning("Vault write_page failed for '%s' — skipping", title, exc_info=True)


def write_database(
    vault_path: str,
    connector_id: str,
    db_title: str | None,
    schema: dict[str, Any] | None,
    rows: list[dict[str, Any]],
) -> None:
    """
    Write a Notion database as schema.json, rows.csv, and rows.json.

    vault/<connector_id>/databases/<safe_title>/
    """
    try:
        root = _connector_root(vault_path, connector_id)
        db_dir = root / "databases" / _safe_name(db_title)
        db_dir.mkdir(parents=True, exist_ok=True)

        # schema.json — raw property metadata from Notion API.
        schema_path = db_dir / "schema.json"
        schema_path.write_text(
            json.dumps(schema or {}, indent=2, ensure_ascii=False), encoding="utf-8"
        )

        # Derive column order from schema keys (stable alphabetical order).
        prop_names: list[str] = sorted(schema.keys()) if schema else []

        # Flatten each row's properties into a dict.
        flat_rows: list[dict[str, str]] = []
        for row in rows:
            props = row.get("properties") or {}
            flat: dict[str, str] = {"notion_id": row.get("id", "")}
            for pname in prop_names:
                prop_data = props.get(pname, {})
                flat[pname] = _property_value_to_str(prop_data) if isinstance(prop_data, dict) else ""
            flat_rows.append(flat)

        # rows.json
        json_path = db_dir / "rows.json"
        json_path.write_text(
            json.dumps(flat_rows, indent=2, ensure_ascii=False), encoding="utf-8"
        )

        # rows.csv
        csv_path = db_dir / "rows.csv"
        fieldnames = ["notion_id"] + prop_names
        with csv_path.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(flat_rows)

        logger.debug("Vault: wrote database %s (%d rows)", db_dir, len(flat_rows))

    except Exception:
        logger.warning("Vault write_database failed for '%s' — skipping", db_title, exc_info=True)
