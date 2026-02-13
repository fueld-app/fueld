import csv
from collections import Counter

with open('companies_enriched.csv', 'r') as f:
    reader = csv.reader(f)
    header = next(reader)
    rows = list(reader)

# Check duplicates by name only
name_counts = Counter(r[0] for r in rows)
dups = {name: count for name, count in name_counts.items() if count > 1}
print(f"Total rows: {len(rows)}")
print(f"Unique names: {len(name_counts)}")
print(f"Duplicate names: {len(dups)}")
print()
for name, count in sorted(dups.items()):
    matching = [r for r in rows if r[0] == name]
    print(f"  {name} ({count}x):")
    for m in matching:
        print(f"    credit={m[1]} ss={m[2]} country={m[3]} code={m[4]}")
