"""Thin Notion REST client (search, retrieve, database query)."""

from __future__ import annotations

from typing import Any, Iterator

import httpx

NOTION_VERSION = "2022-06-28"
BASE = "https://api.notion.com/v1"


class NotionClient:
    """Small wrapper with version header and simple pagination."""

    def __init__(self, token: str, timeout: float = 60.0) -> None:
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        }
        self._client = httpx.Client(base_url=BASE, headers=self._headers, timeout=timeout)

    def close(self) -> None:
        self._client.close()

    def search_page(self, start_cursor: str | None = None) -> dict[str, Any]:
        """POST /search — returns { results, has_more, next_cursor }."""

        body: dict[str, Any] = {"page_size": 100}
        if start_cursor:
            body["start_cursor"] = start_cursor
        r = self._client.post("/search", json=body)
        r.raise_for_status()
        return r.json()

    def search_sorted_by_last_edited(
        self, start_cursor: str | None = None
    ) -> dict[str, Any]:
        """POST /search with sort by last_edited_time descending (incremental sync)."""

        body: dict[str, Any] = {
            "page_size": 100,
            "sort": {"direction": "descending", "timestamp": "last_edited_time"},
        }
        if start_cursor:
            body["start_cursor"] = start_cursor
        r = self._client.post("/search", json=body)
        r.raise_for_status()
        return r.json()

    def iter_search_results(self) -> Iterator[dict[str, Any]]:
        """Yield every object from /search across pages."""

        cursor: str | None = None
        while True:
            data = self.search_page(cursor)
            for item in data.get("results", []):
                yield item
            if not data.get("has_more"):
                break
            cursor = data.get("next_cursor")
            if not cursor:
                break

    def retrieve_page(self, page_id: str) -> dict[str, Any]:
        r = self._client.get(f"/pages/{page_id}")
        r.raise_for_status()
        return r.json()

    def list_block_children(
        self, block_id: str, start_cursor: str | None = None
    ) -> dict[str, Any]:
        """GET /blocks/{id}/children — one page of child blocks."""

        params: dict[str, Any] = {"page_size": 100}
        if start_cursor:
            params["start_cursor"] = start_cursor
        r = self._client.get(f"/blocks/{block_id}/children", params=params)
        r.raise_for_status()
        return r.json()

    def fetch_page_block_tree(self, page_id: str) -> list[dict[str, Any]]:
        """
        Recursively load all block children for a page (depth-first order).

        Each block may include a ``children`` list of nested blocks so exports
        and the web viewer can preserve Notion structure (headings, lists, toggles).
        """

        out: list[dict[str, Any]] = []
        cursor: str | None = None
        while True:
            data = self.list_block_children(page_id, cursor)
            for block in data.get("results", []):
                b = dict(block)
                nested: list[dict[str, Any]] = []
                if b.get("has_children") and b.get("id"):
                    nested = self.fetch_page_block_tree(str(b["id"]))
                b["children"] = nested
                out.append(b)
            if not data.get("has_more"):
                break
            cursor = data.get("next_cursor")
            if not cursor:
                break
        return out

    def retrieve_database(self, database_id: str) -> dict[str, Any]:
        r = self._client.get(f"/databases/{database_id}")
        r.raise_for_status()
        return r.json()

    def query_database(
        self, database_id: str, start_cursor: str | None = None
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"page_size": 100}
        if start_cursor:
            body["start_cursor"] = start_cursor
        r = self._client.post(f"/databases/{database_id}/query", json=body)
        r.raise_for_status()
        return r.json()

    def iter_database_rows(self, database_id: str) -> Iterator[dict[str, Any]]:
        """Yield all rows (pages) for a database."""

        cursor: str | None = None
        while True:
            data = self.query_database(database_id, cursor)
            for row in data.get("results", []):
                yield row
            if not data.get("has_more"):
                break
            cursor = data.get("next_cursor")
            if not cursor:
                break
