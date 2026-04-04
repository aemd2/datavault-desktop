"""Unit tests for small Notion → field mappers."""

from sync_engine.notion.schema import page_title, parent_id


def test_parent_id_page() -> None:
    page = {"parent": {"type": "page_id", "page_id": "abc"}}
    assert parent_id(page) == "abc"


def test_page_title_from_name() -> None:
    page = {
        "properties": {
            "Name": {
                "type": "title",
                "title": [{"plain_text": "Hello", "type": "text"}],
            }
        }
    }
    assert page_title(page) == "Hello"


def test_page_title_any_property_key() -> None:
    """Notion uses different keys (locale, templates); type ``title`` is what matters."""
    page = {
        "properties": {
            "Nom": {
                "type": "title",
                "title": [{"plain_text": "Bonjour", "type": "text"}],
            }
        }
    }
    assert page_title(page) == "Bonjour"
