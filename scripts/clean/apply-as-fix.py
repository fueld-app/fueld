import csv

# Changes from the A/S search:
# J. Lauritzen AS → J. Lauritzen A/S, ss=8903, DNK
# Torm AS → Torm A/S, ss=16932, DNK
# COLOR LINE AS → Color Line A/S, ss=297675, NOR (null country from API, but it's Norwegian)
# Weco Bulk AS → Weco Bulk A/S, ss=520527, DNK
# Several others: just rename AS→A/S (same SS match)
# Many Norwegian/Turkish ones: not found with A/S, keep AS

UPDATES = {
    # (old_name) → (new_name, ss_id, country, code) or just rename
}

# These got improved matches
IMPROVED = {
    'J. Lauritzen AS': ('J. Lauritzen A/S', '8903', 'Denmark', 'DNK'),
    'Torm AS': ('Torm A/S', '16932', 'Denmark', 'DNK'),
    'COLOR LINE AS': ('Color Line A/S', '297675', 'Norway', 'NOR'),  # API returned null country, but Color Line is Norwegian
    'Weco Bulk AS': ('Weco Bulk A/S', '520527', 'Denmark', 'DNK'),
}

# These had same SS match, just rename to A/S
SAME_MATCH_RENAME = {
    'Nct Offshore AS': 'Nct Offshore A/S',
    'Thorco Shipping AS': 'Thorco Shipping A/S',
    'Bergen Bunkers AS': 'Bergen Bunkers A/S',
}

# Danish companies without SS match - still rename to A/S
DANISH_RENAME = {
    'Equinor Refining Denmark AS': 'Equinor Refining Denmark A/S',
    'Thornico AS': 'Thornico A/S',
}

ALL_RENAMES = {}
ALL_RENAMES.update(SAME_MATCH_RENAME)
ALL_RENAMES.update(DANISH_RENAME)

with open('companies_enriched.csv', 'r') as f:
    reader = csv.reader(f)
    header = next(reader)
    rows = list(reader)

updated = 0
renamed = 0

for row in rows:
    name = row[0]
    if name in IMPROVED:
        new_name, ss_id, country, code = IMPROVED[name]
        row[0] = new_name
        row[2] = ss_id
        row[3] = country
        row[4] = code
        updated += 1
        print(f'  UPDATED: {name} → {new_name} (ss={ss_id}, {country})')
    elif name in ALL_RENAMES:
        old = name
        row[0] = ALL_RENAMES[name]
        renamed += 1
        print(f'  RENAMED: {old} → {row[0]}')

# Re-sort by country, empty last
rows.sort(key=lambda r: (0, r[3].lower(), r[0].lower()) if r[3].strip() else (1, '', r[0].lower()))

with open('companies_enriched.csv', 'w', newline='') as f:
    writer = csv.writer(f, quoting=csv.QUOTE_ALL)
    writer.writerow(header)
    for row in rows:
        writer.writerow(row)

print(f'\nDone: {updated} updated, {renamed} renamed, {len(rows)} total rows')
