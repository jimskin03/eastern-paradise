#!/usr/bin/env python3
"""
Eastern Paradise — off-box weekly snapshot puller.

Pulls a consistent SQLite snapshot of the live world from
GET /api/admin/snapshot (Bearer SNAPSHOT_TOKEN), validates it, stores it with
a timestamped name, and prunes old backups (keep last 8 + first of each month).

Usage:
  python3 scripts/snapshot_pull.py                  # normal run (cron-friendly)
  SNAPSHOT_TOKEN=xxx python3 scripts/snapshot_pull.py
  python3 scripts/snapshot_pull.py --base-url http://localhost:3000   # local

Token resolution order: --token arg > $SNAPSHOT_TOKEN > ~/.hermes/eastern-paradise.env

Restore story (no upload endpoint by design):
  - Inspect: sqlite3 paradise-YYYYMMDD-HHMMSS.db
  - Resurrect: run the server anywhere with DATA_DIR pointing at a dir that
    contains the snapshot file named paradise.db.
"""
import argparse
import datetime as dt
import os
import sqlite3
import sys
import tempfile
import urllib.request

DEFAULT_BASE = "https://eastern-paradise.onrender.com"
BACKUP_DIR = os.path.expanduser("~/.hermes/backups/eastern-paradise")
ENV_FILE = os.path.expanduser("~/.hermes/eastern-paradise.env")
KEEP_WEEKLY = 8


def load_token():
    if os.environ.get("SNAPSHOT_TOKEN"):
        return os.environ["SNAPSHOT_TOKEN"]
    try:
        with open(ENV_FILE) as f:
            for line in f:
                if line.startswith("PROD_TOKEN="):
                    return line.strip().split("=", 1)[1]
    except FileNotFoundError:
        pass
    return None


def pull_snapshot(base_url, token):
    url = base_url.rstrip("/") + "/api/admin/snapshot"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    # generous timeout: free tier may cold-start (~60s)
    with urllib.request.urlopen(req, timeout=180) as resp:
        if resp.status != 200:
            raise RuntimeError(f"HTTP {resp.status}: {resp.read()[:200]}")
        return resp.read()


def validate_db(path):
    """Must be a real SQLite file that passes integrity_check and has core tables."""
    with open(path, "rb") as f:
        if f.read(16) != b"SQLite format 3\x00":
            raise RuntimeError("downloaded file is not a SQLite database")
    conn = sqlite3.connect(path)
    try:
        result = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if result != "ok":
            raise RuntimeError(f"integrity_check failed: {result}")
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required = {"accounts", "profiles", "board_messages", "transactions"}
        missing = required - tables
        if missing:
            raise RuntimeError(f"missing core tables: {missing}")
        counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in sorted(required)}
        return counts
    finally:
        conn.close()


def prune(backup_dir):
    files = sorted(f for f in os.listdir(backup_dir) if f.startswith("paradise-") and f.endswith(".db"))
    if len(files) <= KEEP_WEEKLY:
        return []
    # always keep the oldest snapshot of each month (monthly anchor)
    month_anchors = {}
    for name in files:
        month = name[9:15]  # paradise-YYYYMMDD-...
        month_anchors.setdefault(month, name)
    keep = set(month_anchors.values())
    recent = set(files[-KEEP_WEEKLY:])
    victims = [f for f in files if f not in keep and f not in recent]
    for name in victims:
        os.unlink(os.path.join(backup_dir, name))
    return victims


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=os.environ.get("EP_BASE_URL", DEFAULT_BASE))
    ap.add_argument("--token", default=None)
    args = ap.parse_args()

    token = args.token or load_token()
    if not token:
        print(f"FAIL: no SNAPSHOT_TOKEN (arg, env, or {ENV_FILE})", file=sys.stderr)
        return 2

    os.makedirs(BACKUP_DIR, exist_ok=True)
    data = pull_snapshot(args.base_url, token)

    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    out_path = os.path.join(BACKUP_DIR, f"paradise-{stamp}.db")
    with tempfile.NamedTemporaryFile(dir=BACKUP_DIR, suffix=".tmp", delete=False) as tf:
        tf.write(data)
        tmp_name = tf.name
    os.rename(tmp_name, out_path)

    counts = validate_db(out_path)
    size_kb = os.path.getsize(out_path) // 1024
    print(f"OK snapshot saved: {out_path} ({size_kb} KB)")
    print(f"   rows: {counts}")

    victims = prune(BACKUP_DIR)
    if victims:
        print(f"   pruned: {', '.join(victims)}")
    total = len([f for f in os.listdir(BACKUP_DIR) if f.endswith('.db')])
    print(f"   backups on disk: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
