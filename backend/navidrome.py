"""Déclenchement du scan de bibliothèque Navidrome via l'API Subsonic."""

import hashlib
import os
import secrets

import requests

NAVIDROME_URL = os.environ.get("NAVIDROME_URL", "").rstrip("/")
NAVIDROME_USER = os.environ.get("NAVIDROME_USER", "")
NAVIDROME_PASS = os.environ.get("NAVIDROME_PASS", "")


def enabled() -> bool:
    return bool(NAVIDROME_URL and NAVIDROME_USER and NAVIDROME_PASS)


def trigger_scan() -> None:
    """Lance un scan de la bibliothèque. Lève une exception en cas d'échec."""
    if not enabled():
        raise RuntimeError(
            "Navidrome non configuré (NAVIDROME_URL, NAVIDROME_USER, NAVIDROME_PASS)"
        )
    salt = secrets.token_hex(8)
    token = hashlib.md5((NAVIDROME_PASS + salt).encode()).hexdigest()
    resp = requests.get(
        f"{NAVIDROME_URL}/rest/startScan",
        params={
            "u": NAVIDROME_USER,
            "t": token,
            "s": salt,
            "v": "1.16.1",
            "c": "tunedig",
            "f": "json",
        },
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json().get("subsonic-response", {})
    if data.get("status") != "ok":
        message = data.get("error", {}).get("message", "réponse inattendue")
        raise RuntimeError(f"Navidrome : {message}")
