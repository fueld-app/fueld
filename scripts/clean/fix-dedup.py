import csv

with open('companies_enriched.csv', 'r') as f:
    reader = csv.reader(f)
    header = next(reader)
    rows = list(reader)

# Dedup by (name, credit) — prefer row with seasearcher_id, then with country
best = {}
for row in rows:
    key = (row[0], row[1])
    if key not in best:
        best[key] = row
    else:
        existing = best[key]
        if row[2] and not existing[2]:
            best[key] = row
        elif row[3] and not existing[3] and not existing[2]:
            best[key] = row

unique = list(best.values())

# Fill empty countries from duplicate rows that had inferred data
for row in unique:
    if not row[3].strip():
        key = (row[0], row[1])
        for orig in rows:
            if (orig[0], orig[1]) == key and orig[3].strip():
                row[3] = orig[3]
                row[4] = orig[4]
                break

# Sort by country, then name
unique.sort(key=lambda r: (0, r[3].lower(), r[0].lower()) if r[3].strip() else (1, '', r[0].lower()))

with open('companies_enriched.csv', 'w', newline='') as f:
    writer = csv.writer(f, quoting=csv.QUOTE_ALL)
    writer.writerow(header)
    for row in unique:
        writer.writerow(row)

empty = sum(1 for r in unique if not r[3].strip())
print(f'Final: {len(unique)} rows, {empty} without country')
