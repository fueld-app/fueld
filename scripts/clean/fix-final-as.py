import csv

with open('companies_enriched.csv', 'r') as f:
    reader = csv.reader(f)
    header = next(reader)
    rows = list(reader)

changes = 0
for row in rows:
    # Bergen Bunkers is Norwegian → revert to AS
    if row[0] == 'Bergen Bunkers A/S':
        row[0] = 'Bergen Bunkers AS'
        changes += 1
        print(f'  Reverted: Bergen Bunkers A/S → Bergen Bunkers AS')
    
    # Color Line is Norwegian → revert to AS, fix empty country
    if row[0] == 'COLOR LINE A/S' or row[0] == 'Color Line A/S':
        row[0] = 'Color Line AS'
        row[3] = 'Norway'
        row[4] = 'NOR'
        changes += 1
        print(f'  Fixed: Color Line → AS, country=Norway')

    # WECO BULK A/S duplicate of Weco Bulk A/S - normalize casing
    if row[0] == 'WECO BULK A/S':
        row[0] = 'Weco Bulk A/S'
        changes += 1
        print(f'  Normalized: WECO BULK A/S → Weco Bulk A/S')

# Dedup again (WECO BULK / Weco Bulk)
seen = {}
unique = []
for row in rows:
    key = (row[0].lower(), row[1])
    if key not in seen:
        seen[key] = True
        unique.append(row)
    else:
        print(f'  Removed duplicate: {row[0]} (credit={row[1]})')

# Re-sort
unique.sort(key=lambda r: (0, r[3].lower(), r[0].lower()) if r[3].strip() else (1, '', r[0].lower()))

with open('companies_enriched.csv', 'w', newline='') as f:
    writer = csv.writer(f, quoting=csv.QUOTE_ALL)
    writer.writerow(header)
    for row in unique:
        writer.writerow(row)

print(f'\n{changes} changes, {len(rows) - len(unique)} duplicates removed, {len(unique)} total rows')
