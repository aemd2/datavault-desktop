"""
Email alert helpers for the DataVault sync engine.

Two sending paths, in priority order:
  1. Resend API (managed cloud) — used when RESEND_API_KEY is set.
  2. SMTP via Python stdlib smtplib — used when SMTP_HOST is set.

If neither is configured, the alert is logged as a warning only.
All failures are best-effort: they log a warning and never crash the sync.

Required env vars (at least one path must be configured for real delivery):
  ALERT_EMAIL    — recipient address
  RESEND_API_KEY — Resend.com API key (managed path)
  SMTP_HOST      — SMTP server hostname
  SMTP_PORT      — SMTP port (default 587)
  SMTP_USER      — SMTP login username
  SMTP_PASSWORD  — SMTP login password
"""

from __future__ import annotations

import logging
import os
import smtplib
import ssl
from email.message import EmailMessage

logger = logging.getLogger(__name__)


def _send_via_resend(api_key: str, to: str, subject: str, body: str) -> None:
    """
    Send email via the Resend HTTP API (no extra library — stdlib urllib only).
    Raises on HTTP errors so the caller can decide whether to fall back.
    """
    import json
    import urllib.request

    payload = json.dumps({
        "from": "DataVault Alerts <alerts@datavault.app>",
        "to": [to],
        "subject": subject,
        "text": body,
    }).encode()

    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        if resp.status >= 400:
            raise RuntimeError(f"Resend API error {resp.status}")
    logger.info("Alert email sent via Resend to %s", to)


def _send_via_smtp(
    host: str,
    port: int,
    user: str,
    password: str,
    to: str,
    subject: str,
    body: str,
) -> None:
    """Send email via STARTTLS SMTP using stdlib smtplib."""
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = user
    msg["To"] = to
    msg.set_content(body)

    context = ssl.create_default_context()
    with smtplib.SMTP(host, port, timeout=10) as smtp:
        smtp.ehlo()
        smtp.starttls(context=context)
        smtp.login(user, password)
        smtp.send_message(msg)
    logger.info("Alert email sent via SMTP to %s", to)


def send_alert(subject: str, body: str) -> None:
    """
    Send an alert email using the configured delivery path.
    Best-effort — logs a warning on any failure.
    """
    to = os.environ.get("ALERT_EMAIL", "").strip()
    if not to:
        logger.warning("ALERT_EMAIL not set — skipping email alert: %s", subject)
        return

    # Path 1: Resend API.
    resend_key = os.environ.get("RESEND_API_KEY", "").strip()
    if resend_key:
        try:
            _send_via_resend(resend_key, to, subject, body)
            return
        except Exception:
            logger.warning("Resend delivery failed; falling back to SMTP", exc_info=True)

    # Path 2: SMTP.
    smtp_host = os.environ.get("SMTP_HOST", "").strip()
    if smtp_host:
        try:
            smtp_port = int(os.environ.get("SMTP_PORT", "587"))
            smtp_user = os.environ.get("SMTP_USER", "").strip()
            smtp_pass = os.environ.get("SMTP_PASSWORD", "").strip()
            _send_via_smtp(smtp_host, smtp_port, smtp_user, smtp_pass, to, subject, body)
            return
        except Exception:
            logger.warning("SMTP delivery failed", exc_info=True)

    logger.warning(
        "No email delivery configured (set RESEND_API_KEY or SMTP_HOST). "
        "Alert not sent: %s",
        subject,
    )


def send_sync_failure_alert(connector_id: str, error: str) -> None:
    """Convenience wrapper: notify on sync job failure."""
    subject = f"[DataVault] Sync failed — connector {connector_id[:8]}"
    body = (
        f"A DataVault sync job failed.\n\n"
        f"Connector ID: {connector_id}\n"
        f"Error:\n{error}\n\n"
        f"Check the sync logs in your DataVault dashboard for details.\n"
    )
    send_alert(subject, body)


def send_stale_alert(connector_id: str, hours_stale: int) -> None:
    """Convenience wrapper: notify when last successful sync is too old."""
    subject = f"[DataVault] Sync is stale — connector {connector_id[:8]}"
    body = (
        f"No successful sync has been recorded in the last {hours_stale} hours.\n\n"
        f"Connector ID: {connector_id}\n\n"
        f"Please check that the sync engine is running and the connector is active.\n"
    )
    send_alert(subject, body)
