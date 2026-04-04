"""Allow ``python -m sync_engine`` from the sync-engine directory."""

from sync_engine.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
