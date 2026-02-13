import csv

def normalize(name):
    return name.replace(',', '.').replace('  ', ' ').strip().lower()

# Load enriched
with open('companies_enriched.csv', 'r') as f:
    reader = csv.reader(f)
    header = next(reader)
    rows = list(reader)

print(f"Input: {len(rows)} rows")

# Dedup by normalized (name, credit)
# Prefer: 1) has seasearcher_id, 2) has country, 3) name with periods (cleaned version)
best = {}
for row in rows:
    key = (normalize(row[0]), row[1])
    if key not in best:
        best[key] = row
    else:
        existing = best[key]
        # Prefer row with seasearcher_id
        if row[2] and not existing[2]:
            best[key] = row
        # If neither has SS id, prefer row with country
        elif not existing[2] and not row[2] and row[3] and not existing[3]:
            best[key] = row
        # If tied on data, prefer the period version (cleaned name)
        elif row[2] == existing[2] and row[3] == existing[3]:
            if ',' not in row[0] and ',' in existing[0]:
                best[key] = row

unique = list(best.values())

# Now for the 72 entries with empty country, try to infer from the name
# Using suffix rules from infer-countries.ts
SUFFIX_RULES = {
    'A/S': ('Denmark', 'DNK'),
    'ApS': ('Denmark', 'DNK'),
    'I/S': ('Denmark', 'DNK'),
    'GmbH': ('Germany', 'DEU'),
    'KG': ('Germany', 'DEU'),
    'AG': ('Germany', 'DEU'),
    'e.V.': ('Germany', 'DEU'),
    'OHG': ('Germany', 'DEU'),
    'Denizcilik': ('Turkiye', 'TUR'),
    'Ticaret': ('Turkiye', 'TUR'),
    'Sanayi': ('Turkiye', 'TUR'),
    'A.S': ('Turkiye', 'TUR'),
    'OOO': ('Russia', 'RUS'),
    'OAO': ('Russia', 'RUS'),
    'ZAO': ('Russia', 'RUS'),
    'PAO': ('Russia', 'RUS'),
    'AO': ('Russia', 'RUS'),
    'Pte Ltd': ('Republic of Singapore', 'SGP'),
    'Pte. Ltd': ('Republic of Singapore', 'SGP'),
    'PTE LTD': ('Republic of Singapore', 'SGP'),
    'PTE. LTD': ('Republic of Singapore', 'SGP'),
    'PTE. LIMITED': ('Republic of Singapore', 'SGP'),
    'PTE. LTD.': ('Republic of Singapore', 'SGP'),
    'DMCC': ('United Arab Emirates', 'ARE'),
    'FZE': ('United Arab Emirates', 'ARE'),
    'FZC': ('United Arab Emirates', 'ARE'),
    'FZCO': ('United Arab Emirates', 'ARE'),
    'LLC': ('United Arab Emirates', 'ARE'),
    'S.L': ('Spain', 'ESP'),
    'SL': ('Spain', 'ESP'),
    'S.L.': ('Spain', 'ESP'),
    'S.A.U': ('Spain', 'ESP'),
    'OY': ('Finland', 'FIN'),
    'OYJ': ('Finland', 'FIN'),
    'S.p.A': ('Italy', 'ITA'),
    'S.p.A.': ('Italy', 'ITA'),
    'S.R.L': ('Italy', 'ITA'),
    'SDN BHD': ('Malaysia', 'MYS'),
    'SDN. BHD': ('Malaysia', 'MYS'),
    'SDN. BHD.': ('Malaysia', 'MYS'),
    'BHD': ('Malaysia', 'MYS'),
    'SARL': ('France', 'FRA'),
    'SAS': ('France', 'FRA'),
    'B.V.': ('Netherlands', 'NLD'),
    'BV': ('Netherlands', 'NLD'),
    'N.V.': ('Netherlands', 'NLD'),
    'CV': ('Netherlands', 'NLD'),
    'AS': ('Norway', 'NOR'),
    'ASA': ('Norway', 'NOR'),
    'AB': ('Sweden', 'SWE'),
    'PT': ('Indonesia', 'IDN'),
    'PT.': ('Indonesia', 'IDN'),
    'SA': ('Greece', 'GRC'),
    'S.A': ('Greece', 'GRC'),
    'S.A.': ('Greece', 'GRC'),
    'EPE': ('Greece', 'GRC'),
    'JSC': ('Russia', 'RUS'),
    'EOOD': ('Bulgaria', 'BGR'),
    'AD': ('Bulgaria', 'BGR'),
    'd.o.o': ('Croatia', 'HRV'),
    'Sp. z o.o.': ('Poland', 'POL'),
}

KNOWN_COMPANIES = {
    'efshipping co. s.a. panama': ('Panama', 'PAN'),
    'leo ocean pte. ltd.': ('Republic of Singapore', 'SGP'),
    'norden shipping (singapore) pte. ltd': ('Republic of Singapore', 'SGP'),
    'cosco shipping (singapore) petroleum pte. ltd': ('Republic of Singapore', 'SGP'),
    'sea consortium pte ltd': ('Republic of Singapore', 'SGP'),
    'agriculture & energy carriers. ltd. bahamas': ('Bahamas', 'BHS'),
    'capital world maritime ltd.': ('Hong Kong, S.A.R., China', 'HKG'),
    'dead sea works ltd. supply': ('Israel', 'ISR'),
    'jiangshu shagang group co. ltd': ('People\'s Republic of China', 'CHN'),
    'gts global trading pte.': ('Republic of Singapore', 'SGP'),
    'agunsa europa s.a.': ('Spain', 'ESP'),
    'enel global trading s.p.a.': ('Italy', 'ITA'),
    'enel produzione s.p.a.': ('Italy', 'ITA'),
    'asia maritime pacific (shanghai) limited': ('People\'s Republic of China', 'CHN'),
    'associated maritime co (hk) ltd': ('Hong Kong, S.A.R., China', 'HKG'),
    'hyproc shipping company spa': ('Algeria', 'DZA'),
    'nova petroleum (hk) ltd': ('Hong Kong, S.A.R., China', 'HKG'),
    'oman shipping company': ('Oman', 'OMN'),
    'reachy international (hk) co ltd': ('Hong Kong, S.A.R., China', 'HKG'),
    'rederi ab nathalie': ('Sweden', 'SWE'),
    'star cruises (hk) ltd': ('Hong Kong, S.A.R., China', 'HKG'),
    'tongli shipping pte.ltd': ('Republic of Singapore', 'SGP'),
}

def infer_country(name):
    lower = name.lower().strip()
    # Check known companies first
    for known, (country, code) in KNOWN_COMPANIES.items():
        if lower == known or lower.rstrip('.') == known.rstrip('.'):
            return country, code
    
    # Check suffix rules (longer suffixes first)
    sorted_suffixes = sorted(SUFFIX_RULES.keys(), key=len, reverse=True)
    for suffix in sorted_suffixes:
        if name.upper().endswith(suffix.upper()) or name.upper().endswith(suffix.upper() + '.'):
            return SUFFIX_RULES[suffix]
    
    # Country name mentions
    COUNTRY_MENTIONS = {
        'PANAMA': ('Panama', 'PAN'),
        'BAHAMAS': ('Bahamas', 'BHS'),
        'CYPRUS': ('Cyprus', 'CYP'),
        'BERMUDA': ('Bermuda', 'BMU'),
        'CHINA': ('People\'s Republic of China', 'CHN'),
        'SINGAPORE': ('Republic of Singapore', 'SGP'),
        'HONG KONG': ('Hong Kong, S.A.R., China', 'HKG'),
        'USA': ('United States of America', 'USA'),
        'JAPAN': ('Japan', 'JPN'),
        'KOREA': ('Republic of Korea', 'KOR'),
        'INDIA': ('India', 'IND'),
    }
    for mention, (country, code) in COUNTRY_MENTIONS.items():
        if mention in name.upper():
            return country, code
    
    return None, None

filled = 0
still_empty = 0
for row in unique:
    if not row[3].strip():
        country, code = infer_country(row[0])
        if country:
            row[3] = country
            row[4] = code
            filled += 1
        else:
            still_empty += 1

# Sort by country (empty last), then name
unique.sort(key=lambda r: (0, r[3].lower(), r[0].lower()) if r[3].strip() else (1, '', r[0].lower()))

with open('companies_enriched.csv', 'w', newline='') as f:
    writer = csv.writer(f, quoting=csv.QUOTE_ALL)
    writer.writerow(header)
    for row in unique:
        writer.writerow(row)

empty_count = sum(1 for r in unique if not r[3].strip())
print(f"Final: {len(unique)} rows")
print(f"Filled {filled} empty countries via inference")
print(f"Still empty: {empty_count}")
if empty_count > 0:
    for r in unique:
        if not r[3].strip():
            print(f"  {r[0]} | credit={r[1]}")
