import csv

with open('companies_enriched.csv', 'r') as f:
    reader = csv.reader(f)
    header = next(reader)
    rows = list(reader)

# The script renamed ALL "AS" → "A/S" even when not found on Seasearcher.
# Norwegian companies should stay "AS" (that's the Norwegian form).
# Turkish companies should stay "A.S" or "AS" (Turkish form is A.Ş.).
# Danish companies should be "A/S" (that's the Danish form).

# Companies that are Danish (by country_code or known) → keep A/S
# Companies that are Norwegian → revert to AS
# Companies that are Turkish → revert to AS (they use A.Ş. but AS is acceptable)
# Others → case by case

fixes = 0
for row in rows:
    name = row[0]
    code = row[4]
    
    if name.endswith(' A/S'):
        if code == 'NOR':
            # Norwegian: revert to AS
            row[0] = name[:-4] + ' AS'
            fixes += 1
        elif code == 'TUR':
            # Turkish: revert to AS
            row[0] = name[:-4] + ' AS'
            fixes += 1
        elif code == 'GBR':
            # SIEM CAR CARRIERS - Norwegian company misclassified? Revert to AS
            row[0] = name[:-4] + ' AS'
            fixes += 1
        elif code == 'ESP':
            # North Sea Giant - Norwegian company. Revert to AS
            row[0] = name[:-4] + ' AS'
            fixes += 1
        elif code == 'SWE':
            # Polar Explorer - Swedish, revert to AS  
            row[0] = name[:-4] + ' AS'
            fixes += 1
    
    # Fix Color Line: API returned null country, it's Norwegian
    if row[0] == 'Color Line A/S' and not row[3]:
        row[3] = 'Norway'
        row[4] = 'NOR'
        # Actually Color Line is Norwegian, so revert to AS
        row[0] = 'Color Line AS'
        print(f'  Fixed Color Line: country=Norway, name=Color Line AS')

# Re-sort
rows.sort(key=lambda r: (0, r[3].lower(), r[0].lower()) if r[3].strip() else (1, '', r[0].lower()))

with open('companies_enriched.csv', 'w', newline='') as f:
    writer = csv.writer(f, quoting=csv.QUOTE_ALL)
    writer.writerow(header)
    for row in rows:
        writer.writerow(row)

# Summary: which companies now have A/S?
as_slash = [r for r in rows if r[0].endswith(' A/S')]
print(f'\nReverted {fixes} non-Danish companies back to AS')
print(f'Companies with A/S ({len(as_slash)}):')
for r in as_slash:
    print(f'  {r[0]} | ss={r[2]} | {r[3]} ({r[4]})')
