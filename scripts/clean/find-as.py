import csv
import re

with open('companies_enriched.csv', 'r') as f:
    reader = csv.reader(f)
    header = next(reader)
    rows = list(reader)

# Find companies where name ends with " AS" (not "A/S", not part of longer word)
as_companies = []
for i, row in enumerate(rows):
    name = row[0].strip()
    # Ends with " AS" (space + AS) — these are likely A/S companies
    if re.search(r'\bAS$', name):
        as_companies.append((i, row))

print(f"Companies ending with 'AS': {len(as_companies)}")
for i, row in as_companies:
    print(f"  [{i}] {row[0]} | ss={row[2]} | country={row[3]} | code={row[4]}")
