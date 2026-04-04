"""Open a psycopg connection from DATABASE_URL."""

from __future__ import annotations

import psycopg


def connect(database_url: str):
    """
    Return a new connection.

    Use Supabase direct Postgres URI (database password) so RLS can be bypassed
    for the sync worker when using the postgres role — see README.
    """

    return psycopg.connect(database_url, autocommit=False)
