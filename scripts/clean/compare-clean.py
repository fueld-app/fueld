import csv

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

clean_keys = set((r[0], r[1]) for r in clean_rows)
enr_keys = set((r[0], r[1]) for r in enr_rows)

print(f"Clean rows: {len(clean_rows)}, unique keys: {len(clean_keys)}")
print(f"Enriched rows: {len(enr_rows)}, unique keys: {len(enr_keys)}")
print(f"In enriched but NOT in clean: {len(enr_keys - clean_keys)}")
print(f"In clean but NOT in enriched: {len(clean_keys - enr_keys)}")

# Show extra entries
extras = enr_keys - clean_keys
if extras:
    print("\nExtra entries in enriched (not in clean):")
    for name, credit in sorted(extras)[:50]:
        matching = [r for r in enr_rows if r[0] == name and r[1] == credit]
        for m in matching:
            print(f"  {name} | credit={credit} | ss={m[2]} | country={m[3]}")
