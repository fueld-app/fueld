#!/usr/bin/env python3
"""
Link newly imported suppliers to Seasearcher.

1. Reads LLI credentials from DB (decrypts them)
2. Authenticates with Seasearcher
3. Looks up each new supplier by name + country
4. Updates counterparties with seasearcher_id, company_imo, fleet_size, etc.

Usage (run on the VPS):
  python3 /tmp/link_seasearcher.py
"""

import hashlib
import json
import os
import re
import sys
import time
import uuid
from collections import defaultdict
from pathlib import Path

import psycopg2
import requests

# ── Config ────────────────────────────────────────────────────────────
DB_URL = os.environ.get("DATABASE_URL", "postgres://fueld:+oFKZt0Qv5KPCHNsG651N68WCIZJDcAx@localhost:5432/fueld")
TENANT_ID = "09692138-3ec3-4312-9f3d-0227c4e859f5"

SEASEARCHER_BASE = "https://www.seasearcher.com/api"
LLI_BASE = "https://api.lloydslistintelligence.com/v1"

# Rate limiting
REQUEST_DELAY = 0.3  # seconds between Seasearcher requests

# ── AES-256-GCM Decryption (matches apps/api/src/lib/crypto.ts) ─────

def derive_key():
    """Derive AES-256 key from DATABASE_URL (same as app fallback)."""
    db_url = DB_URL
    return hashlib.sha256(f"fueld-creds:{db_url}".encode()).digest()


def decrypt_aes_gcm(encrypted_hex: str, iv_hex: str, auth_tag_hex: str) -> str:
    """Decrypt AES-256-GCM ciphertext."""
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:
        print("ERROR: cryptography library required. Install with: pip3 install cryptography")
        sys.exit(1)

    key = derive_key()
    iv = bytes.fromhex(iv_hex)
    auth_tag = bytes.fromhex(auth_tag_hex)
    ciphertext = bytes.fromhex(encrypted_hex)

    # AESGCM expects ciphertext + tag concatenated
    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(iv, ciphertext + auth_tag, None)
    return plaintext.decode("utf-8")


# ── DB Helpers ──────────────────────────────────────────────────────────

def get_db_connection():
    import urllib.parse
    parsed = urllib.parse.urlparse(DB_URL)
    return psycopg2.connect(
        host=parsed.hostname or "localhost",
        port=parsed.port or 5432,
        database=parsed.path.lstrip("/"),
        user=parsed.username,
        password=parsed.password,
    )


def get_lli_credentials(conn):
    """Read and decrypt LLI credentials from integration_credentials table."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT key, encrypted_value, iv, auth_tag
            FROM integration_credentials
            WHERE tenant_id = %s AND provider = 'LLI'
        """, (TENANT_ID,))
        rows = cur.fetchall()

    username = password = None
    for key, enc, iv, tag in rows:
        decrypted = decrypt_aes_gcm(enc, iv, tag)
        if key == "username":
            username = decrypted
        elif key == "password":
            password = decrypted

    if not username or not password:
        raise RuntimeError("LLI credentials not found in DB")

    return username, password


def get_new_suppliers(conn):
    """Get all newly imported suppliers without seasearcher_id."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, name, country, country_iso
            FROM counterparties
            WHERE tenant_id = %s
              AND type = 'SUPPLIER'
              AND created_at > '2026-06-05'
              AND seasearcher_id IS NULL
            ORDER BY name
        """, (TENANT_ID,))
        return cur.fetchall()


# ── Seasearcher API ───────────────────────────────────────────────────

def authenticate_seasearcher(username: str, password: str):
    """Get JWT token from LLI / Seasearcher."""
    url = f"{LLI_BASE}/tokenprovider"
    resp = requests.post(
        url,
        headers={"Content-Type": "application/json"},
        json={"username": username, "password": password},
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("Message") != "Success" or not data.get("Payload"):
        raise RuntimeError(f"Token response invalid: {data}")
    return data["Payload"]


def search_company(token: str, name: str, country_hint: str = None):
    """Search Seasearcher for a company by name."""
    query_obj = {
        "SearchPhrase": name,
        "SearchFields": {"companyName": 1, "companyImo": 1},
        "PageSize": 5,
    }

    url = f"{SEASEARCHER_BASE}/company/query?query={requests.utils.quote(json.dumps(query_obj))}"
    headers = {"Authorization": f"Bearer {token}"}

    try:
        resp = requests.get(url, headers=headers, timeout=15)
        if resp.status_code == 401:
            # Token expired — caller should refresh
            raise RuntimeError("Token expired")
        resp.raise_for_status()
        data = resp.json()
        results = data.get("results", [])
        if not results:
            return None
        return find_best_match(name, results)
    except requests.exceptions.RequestException as e:
        print(f"    Seasearcher error: {e}")
        return None


def normalize(s: str) -> str:
    """Normalize string for comparison."""
    return re.sub(r"[^a-z0-9]", " ", s.lower()).strip()


def find_best_match(query: str, results: list):
    """Find the best matching result from Seasearcher."""
    if not results:
        return None

    query_norm = normalize(query)
    query_words = set(query_norm.split())

    best = None
    best_score = -1

    for r in results:
        name = r.get("companyName", "").strip()
        name_norm = normalize(name)

        # Exact match
        if name_norm == query_norm:
            return r

        # Starts with query
        if name_norm.startswith(query_norm):
            score = 100 - len(name_norm) + len(query_norm)
            if score > best_score:
                best_score = score
                best = r
            continue

        # Contains query
        if query_norm in name_norm:
            score = 50 - len(name_norm) + len(query_norm)
            if score > best_score:
                best_score = score
                best = r
            continue

        # Word-level overlap
        name_words = set(name_norm.split())
        overlap = len(query_words & name_words)
        if overlap > 0:
            score = overlap * 10 - len(name_norm) + len(query_norm)
            if score > best_score:
                best_score = score
                best = r

    return best


# ── Update DB ─────────────────────────────────────────────────────────

def update_supplier(conn, supplier_id: str, match: dict) -> bool:
    """Update counterparties with Seasearcher data. Returns True on success."""
    seasearcher_id = match.get("id")
    company_imo = match.get("companyImo")
    country = match.get("countryCode") or match.get("location", {}).get("country")
    year_formed = match.get("yearFormed")
    fleet_size = match.get("boFleetSize", 0) + match.get("coFleetSize", 0) + match.get("tmFleetSize", 0) + match.get("tpFleetSize", 0)
    is_sanctioned = match.get("isSanctioned", False)
    head_office = match.get("headOfficeAddress")
    head_office_address = None
    if head_office:
        parts = [head_office.get("streetLine1", ""), head_office.get("city", ""), head_office.get("country", "")]
        head_office_address = ", ".join(p for p in parts if p)

    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE counterparties
                SET seasearcher_id = %s,
                    company_imo = %s,
                    country_iso = COALESCE(%s, country_iso),
                    year_formed = %s,
                    fleet_size = %s,
                    is_sanctioned = %s,
                    head_office_address = COALESCE(%s, head_office_address),
                    updated_at = NOW()
                WHERE id = %s
            """, (
                seasearcher_id,
                company_imo,
                country,
                year_formed,
                fleet_size if fleet_size > 0 else None,
                is_sanctioned,
                head_office_address,
                supplier_id,
            ))
        conn.commit()
        return True
    except psycopg2.errors.UniqueViolation as e:
        conn.rollback()
        # Duplicate seasearcher_id — another supplier already has this ID
        return False
    except Exception as e:
        conn.rollback()
        raise e


# ── Main ──────────────────────────────────────────────────────────────

def main():
    print("═ Linking new suppliers to Seasearcher ═")
    print()

    # Connect to DB
    print("Connecting to DB...")
    conn = get_db_connection()

    # Get LLI credentials
    print("Reading LLI credentials from DB...")
    username, password = get_lli_credentials(conn)
    print(f"  ✓ Username: {username[:3]}***")

    # Authenticate with Seasearcher
    print("Authenticating with Seasearcher...")
    token = authenticate_seasearcher(username, password)
    print("  ✓ Authenticated")

    # Get new suppliers
    print("Fetching new suppliers...")
    suppliers = get_new_suppliers(conn)
    print(f"  ✓ {len(suppliers)} suppliers to link")
    print()

    # Link each supplier
    found = 0
    not_found = 0
    errors = 0

    for i, (sid, name, country, country_iso) in enumerate(suppliers, 1):
        print(f"[{i}/{len(suppliers)}] {name} ...", end=" ", flush=True)

        try:
            # Try with country hint first
            match = search_company(token, name, country_iso)

            # If no match, try without country hint
            if not match:
                match = search_company(token, name)

            if match:
                success = update_supplier(conn, sid, match)
                if success:
                    seasearcher_name = match.get("companyName", "")
                    print(f"✓ {seasearcher_name} ({match.get('id')})")
                    found += 1
                else:
                    print(f"✗ Duplicate seasearcher_id ({match.get('id')})")
                    not_found += 1
            else:
                print("✗ Not found")
                not_found += 1
        except RuntimeError as e:
            if "Token expired" in str(e):
                print("Token expired, refreshing...")
                token = authenticate_seasearcher(username, password)
                # Retry this supplier
                match = search_company(token, name, country_iso)
                if not match:
                    match = search_company(token, name)
                if match:
                    success = update_supplier(conn, sid, match)
                    if success:
                        seasearcher_name = match.get("companyName", "")
                        print(f"✓ {seasearcher_name} ({match.get('id')})")
                        found += 1
                    else:
                        print(f"✗ Duplicate seasearcher_id ({match.get('id')})")
                        not_found += 1
                else:
                    print("✗ Not found")
                    not_found += 1
            else:
                print(f"✗ Error: {e}")
                errors += 1
        except Exception as e:
            print(f"✗ Error: {e}")
            errors += 1

        time.sleep(REQUEST_DELAY)

    print()
    print("═ Results ═")
    print(f"  Found & linked: {found}")
    print(f"  Not found:      {not_found}")
    print(f"  Errors:         {errors}")
    print()

    # Summary query
    with conn.cursor() as cur:
        cur.execute("""
            SELECT COUNT(*) FILTER (WHERE seasearcher_id IS NOT NULL) as linked,
                   COUNT(*) FILTER (WHERE seasearcher_id IS NULL) as unlinked,
                   COUNT(*) as total
            FROM counterparties
            WHERE tenant_id = %s AND type = 'SUPPLIER' AND created_at > '2026-06-05'
        """, (TENANT_ID,))
        linked, unlinked, total = cur.fetchone()
        print(f"Final state: {linked}/{total} new suppliers linked to Seasearcher")

    conn.close()
    print("Done!")


if __name__ == "__main__":
    main()
