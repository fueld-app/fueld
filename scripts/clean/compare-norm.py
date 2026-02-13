import csv

def normalize(name):
    return name.replace(',', '.').replace('  ', ' ').strip().lower()

# Load clean (ground truth)
with open('companies_clean.csv', 'r') as f:
    reader = csv.reader(f)
    clean_header = next(reader)
    clean_rows = list(reader)

# Load enriched
with open('companies_enriched.csv', 'r') as f:
    reader = csv.reader(f)
    enr_header = next(reader)
    enr_rows = list(reader)

clean_keys = set((normalize(r[0]), r[1]) for r in clean_rows)
enr_keys = set((normalize(r[0]), r[1]) for r in enr_rows)

print(f"Clean rows: {len(clean_rows)}, unique norm keys: {len(clean_keys)}")
print(f"Enriched rows: {len(enr_rows)}, unique norm keys: {len(enr_keys)}")
print(f"In enriched but NOT in clean: {len(enr_keys - clean_keys)}")
print(f"In clean but NOT in enriched: {len(clean_keys - enr_keys)}")

extras = enr_keys - clean_keys
if extras:
    print(f"\nExtra entries in enriched ({len(extras)}):")
    for nname, credit in sorted(extras):
        matching = [r for r in enr_rows if normalize(r[0]) == nname and r[1] == credit]
        for m in matching:
            print(f"  {m[0]} | credit={m[1]} | country={m[3]}")

missing = clean_keys - enr_keys
if missing:
    print(f"\nMissing from enriched ({len(missing)}):")
    for nname, credit in sorted(missing):
        matching = [r for r in clean_rows if normalize(r[0]) == nname and r[1] == credit]
        for m in matching:
            print(f"  {m[0]} | credit={m[1]}")
