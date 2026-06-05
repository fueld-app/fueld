#!/usr/bin/env python3
"""
Import vessels from CSV into channeltx production DB.

Usage:
  python3 import_vessels.py < csv_file.csv | ssh root@74.208.245.215 "sudo -u postgres psql -d fueld"

Or save output to a file and run:
  cat import.sql | ssh root@74.208.245.215 "sudo -u postgres psql -d fueld"
"""

import csv
import sys
import uuid
from collections import defaultdict

TENANT_ID = "d04892e6-2777-4d70-9207-1d409fb64cc8"

# Read CSV from stdin
csv_data = sys.stdin.read()
reader = csv.DictReader(csv_data.strip().splitlines())
# Strip BOM from column names
reader.fieldnames = [f.lstrip('\ufeff') for f in reader.fieldnames or []]
rows = list(reader)

# Collect unique companies
companies = {}
for row in rows:
    company_name = row.get("Company", "").strip()
    if company_name and company_name not in companies:
        companies[company_name] = str(uuid.uuid4())

# Generate SQL
sql_lines = []
sql_lines.append("BEGIN;")
sql_lines.append("")
sql_lines.append("-- Insert companies as counterparties (SUPPLIER type)")
for name, cid in companies.items():
    phone = ""
    for row in rows:
        if row.get("Company", "").strip() == name:
            phone = row.get("Business Phone", "").strip()
            break
    sql_lines.append(
        f"INSERT INTO counterparties (id, tenant_id, name, type, head_office_phone, created_at, updated_at) "
        f"VALUES ('{cid}', '{TENANT_ID}', '{name.replace(chr(39), chr(39)+chr(39))}', 'SUPPLIER', '{phone}', NOW(), NOW());"
    )

sql_lines.append("")
sql_lines.append("-- Insert vessels")
vessel_ids = {}
for row in rows:
    vessel_name = row.get("Vessel Name", "").strip()
    flag = row.get("Flag", "").strip()
    vtype = row.get("Type", "").strip()
    company_name = row.get("Company", "").strip()
    
    if not vessel_name:
        continue
    
    vid = str(uuid.uuid4())
    vessel_ids[vessel_name] = vid
    
    sql_lines.append(
        f"INSERT INTO vessels (id, name, flag, type, phone, created_at, updated_at) "
        f"VALUES ('{vid}', '{vessel_name.replace(chr(39), chr(39)+chr(39))}', '{flag}', '{vtype}', '{phone}', NOW(), NOW());"
    )

sql_lines.append("")
sql_lines.append("-- Link vessels to companies")
for row in rows:
    vessel_name = row.get("Vessel Name", "").strip()
    company_name = row.get("Company", "").strip()
    
    if not vessel_name or not company_name:
        continue
    
    vid = vessel_ids.get(vessel_name)
    cid = companies.get(company_name)
    
    if vid and cid:
        sql_lines.append(
            f"INSERT INTO vessel_companies (id, vessel_id, company_id, role, source, created_at, updated_at) "
            f"VALUES ('{str(uuid.uuid4())}', '{vid}', '{cid}', 'OWNER', 'manual', NOW(), NOW()) "
            f"ON CONFLICT DO NOTHING;"
        )

sql_lines.append("")
sql_lines.append("COMMIT;")

print("\n".join(sql_lines))
