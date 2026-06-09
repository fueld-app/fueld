#!/usr/bin/env python3
"""
Auto-merge ambiguous suppliers using region-based matching.

Reads merge_ambiguous.sql, queries DB for coverage data,
applies smart matching, generates and optionally executes SQL.

Logic per coverage country:
1. Exact country match → assign to office that already covers that country
2. Same region match → assign to office in same region (pick the one covering most countries = regional hub)
3. Fallback → assign to first available office

Usage:
  python3 scripts/merge_ambiguous_auto.py --dry-run   # preview
  python3 scripts/merge_ambiguous_auto.py              # generate + execute
"""

import argparse
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

TENANT_ID = "09692138-3ec3-4312-9f3d-0227c4e859f5"
SSH_HOST = "root@139.162.157.31"

# Country → region mapping
COUNTRY_REGION = {
    # Europe
    "ALB": "Europe", "AND": "Europe", "AUT": "Europe", "BEL": "Europe",
    "BIH": "Europe", "BGR": "Europe", "HRV": "Europe", "CYP": "Europe",
    "CZE": "Europe", "DNK": "Europe", "EST": "Europe", "FIN": "Europe",
    "FRA": "Europe", "DEU": "Europe", "GIB": "Europe", "GRC": "Europe",
    "HUN": "Europe", "ISL": "Europe", "IRL": "Europe", "ITA": "Europe",
    "LVA": "Europe", "LIE": "Europe", "LTU": "Europe", "LUX": "Europe",
    "MLT": "Europe", "MDA": "Europe", "MCO": "Europe", "MNE": "Europe",
    "NLD": "Europe", "MKD": "Europe", "NOR": "Europe", "POL": "Europe",
    "PRT": "Europe", "ROU": "Europe", "SMR": "Europe", "SRB": "Europe",
    "SVK": "Europe", "SVN": "Europe", "ESP": "Europe", "SWE": "Europe",
    "CHE": "Europe", "UKR": "Europe", "GBR": "Europe", "VAT": "Europe",
    "RUS": "Europe", "BLR": "Europe", "FRO": "Europe", "GRL": "Europe",
    "IMN": "Europe", "JEY": "Europe", "GGY": "Europe", "ENG": "Europe",
    # Middle East
    "ARE": "Middle East", "BHR": "Middle East", "IRN": "Middle East",
    "IRQ": "Middle East", "ISR": "Middle East", "JOR": "Middle East",
    "KWT": "Middle East", "LBN": "Middle East", "OMN": "Middle East",
    "QAT": "Middle East", "SAU": "Middle East", "SYR": "Middle East",
    "TUR": "Middle East", "YEM": "Middle East", "PSE": "Middle East",
    # Africa
    "DZA": "Africa", "AGO": "Africa", "BEN": "Africa", "BWA": "Africa",
    "BFA": "Africa", "BDI": "Africa", "CMR": "Africa", "CPV": "Africa",
    "CAF": "Africa", "TCD": "Africa", "COM": "Africa", "COG": "Africa",
    "COD": "Africa", "CIV": "Africa", "DJI": "Africa", "EGY": "Africa",
    "GNQ": "Africa", "ERI": "Africa", "SWZ": "Africa", "ETH": "Africa",
    "GAB": "Africa", "GMB": "Africa", "GHA": "Africa", "GIN": "Africa",
    "GNB": "Africa", "KEN": "Africa", "LSO": "Africa", "LBR": "Africa",
    "LBY": "Africa", "MDG": "Africa", "MWI": "Africa", "MLI": "Africa",
    "MRT": "Africa", "MUS": "Africa", "MAR": "Africa", "MOZ": "Africa",
    "NAM": "Africa", "NER": "Africa", "NGA": "Africa", "RWA": "Africa",
    "STP": "Africa", "SEN": "Africa", "SYC": "Africa", "SLE": "Africa",
    "SOM": "Africa", "ZAF": "Africa", "SSD": "Africa", "SDN": "Africa",
    "TZA": "Africa", "TGO": "Africa", "TUN": "Africa", "UGA": "Africa",
    "ZMB": "Africa", "ZWE": "Africa", "REU": "Africa", "ESH": "Africa",
    "WAF": "West Africa",
    # Asia
    "AFG": "Asia", "BGD": "Asia", "BTN": "Asia", "BRN": "Asia",
    "KHM": "Asia", "CHN": "Asia", "IND": "Asia", "IDN": "Asia",
    "JPN": "Asia", "KAZ": "Asia", "KGZ": "Asia", "LAO": "Asia",
    "MYS": "Asia", "MDV": "Asia", "MNG": "Asia", "MMR": "Asia",
    "NPL": "Asia", "PRK": "Asia", "PAK": "Asia", "PHL": "Asia",
    "SGP": "Asia", "KOR": "Asia", "LKA": "Asia", "TJK": "Asia",
    "THA": "Asia", "TLS": "Asia", "TKM": "Asia", "UZB": "Asia",
    "VNM": "Asia", "TWN": "Asia", "HKG": "Asia", "MAC": "Asia",
    # Americas
    "ARG": "Americas", "BHS": "Americas", "BRB": "Americas", "BLZ": "Americas",
    "BOL": "Americas", "BRA": "Americas", "CAN": "Americas", "CHL": "Americas",
    "COL": "Americas", "CRI": "Americas", "CUB": "Americas", "DOM": "Americas",
    "ECU": "Americas", "SLV": "Americas", "GTM": "Americas", "GUY": "Americas",
    "HTI": "Americas", "HND": "Americas", "JAM": "Americas", "MEX": "Americas",
    "NIC": "Americas", "PAN": "Americas", "PRY": "Americas", "PER": "Americas",
    "SUR": "Americas", "TTO": "Americas", "USA": "Americas", "URY": "Americas",
    "VEN": "Americas", "GUF": "Americas", "GLP": "Americas", "MTQ": "Americas",
    "AIA": "Americas", "ATG": "Americas", "ABW": "Americas", "BES": "Americas",
    "CUW": "Americas", "DMA": "Americas", "GRD": "Americas", "KNA": "Americas",
    "LCA": "Americas", "MAF": "Americas", "SXM": "Americas", "VCT": "Americas",
    "TCA": "Americas", "VGB": "Americas", "VIR": "Americas", "CYM": "Americas",
    "BMU": "Americas", "PRI": "Americas", "CAR": "Caribbean",
    # Oceania
    "AUS": "Oceania", "FJI": "Oceania", "KIR": "Oceania", "MHL": "Oceania",
    "FSM": "Oceania", "NRU": "Oceania", "NZL": "Oceania", "PLW": "Oceania",
    "PNG": "Oceania", "WSM": "Oceania", "SLB": "Oceania", "TON": "Oceania",
    "TUV": "Oceania", "VUT": "Oceania", "COK": "Oceania", "NIU": "Oceania",
    "TKL": "Oceania", "PYF": "Oceania", "NCL": "Oceania", "WLF": "Oceania",
    "ASM": "Oceania", "GUM": "Oceania", "MNP": "Oceania",
}


def get_region(iso: str) -> str:
    return COUNTRY_REGION.get(iso, "Unknown")


def run_psql(sql: str):
    """Run psql query via SSH and return lines of output."""
    cmd = ['ssh', SSH_HOST, f"sudo -u postgres psql -d fueld -t -A -F'|' -c \"{sql}\""]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"DB Error: {result.stderr}", file=sys.stderr)
        return []
    lines = []
    for line in result.stdout.strip().split('\n'):
        line = line.strip()
        if line:
            lines.append(line)
    return lines


def parse_merge_ambiguous_sql(filepath: Path):
    """Parse merge_ambiguous.sql to extract cases."""
    with open(filepath) as f:
        content = f.read()

    cases = []
    # Pattern: -- === Name (UUID) ===
    case_pattern = r'-- ===\s+(.+?)\s+\(([0-9a-f-]{36})\)\s+==='
    # Pattern: --   → Name (UUID)
    option_pattern = r'--\s+→\s+(.+?)\s+\(([0-9a-f-]{36})\)'

    parts = re.split(case_pattern, content)
    i = 1
    while i < len(parts):
        new_name = parts[i].strip()
        new_id = parts[i + 1]
        body = parts[i + 2] if i + 2 < len(parts) else ""

        options = []
        for match in re.finditer(option_pattern, body):
            opt_name = match.group(1).strip()
            opt_id = match.group(2)
            options.append((opt_name, opt_id))

        if options:
            cases.append({
                'new_name': new_name,
                'new_id': new_id,
                'options': options
            })

        i += 3

    return cases


def get_coverage_batch(company_ids):
    """Get coverage for multiple companies in one query."""
    if not company_ids:
        return {}
    ids_str = "','".join(company_ids)
    sql = f"""
    SELECT company_id, country_iso, id
    FROM company_place_supply_rules
    WHERE company_id IN ('{ids_str}')
    ORDER BY company_id, country_iso;
    """
    lines = run_psql(sql)
    coverage = defaultdict(list)
    for line in lines:
        parts = line.split('|')
        if len(parts) >= 3:
            cid, country_iso, rule_id = parts[0], parts[1], parts[2]
            coverage[cid].append((country_iso, rule_id))
    return coverage


def infer_office_region_from_name(name: str) -> str:
    """Infer office region from its name using country/jurisdiction hints."""
    name_lower = name.lower()

    country_hints = {
        # Africa
        'cabo verde': 'Africa', 'cape verde': 'Africa',
        "cote d'ivoire": 'Africa', 'ivory coast': 'Africa',
        'gabon': 'Africa', 'ghana': 'Africa', 'guinea': 'Africa',
        'kenya': 'Africa', 'madagascar': 'Africa', 'maroc': 'Africa',
        'morocco': 'Africa', 'mozambique': 'Africa', 'namibia': 'Africa',
        'reunion': 'Africa', 'senegal': 'Africa', 'south africa': 'Africa',
        'mauritius': 'Africa', 'seychelles': 'Africa', 'tanzania': 'Africa',
        'togo': 'Africa', 'benin': 'Africa', 'cameroon': 'Africa',
        'angola': 'Africa', 'nigeria': 'Africa', 'egypt': 'Africa',
        'algeria': 'Africa', 'libya': 'Africa', 'tunisia': 'Africa',
        'congo': 'Africa', 'equatorial guinea': 'Africa',
        'sao tome': 'Africa', 'burkina': 'Africa', 'mali': 'Africa',
        'niger': 'Africa', 'chad': 'Africa', 'central african': 'Africa',
        'gambia': 'Africa', 'sierra leone': 'Africa', 'liberia': 'Africa',
        'guinea-bissau': 'Africa', 'rwanda': 'Africa', 'burundi': 'Africa',
        'uganda': 'Africa', 'zambia': 'Africa', 'zimbabwe': 'Africa',
        'botswana': 'Africa', 'lesotho': 'Africa', 'eswatini': 'Africa',
        'malawi': 'Africa', 'djibouti': 'Africa', 'somalia': 'Africa',
        'eritrea': 'Africa', 'ethiopia': 'Africa', 'sudan': 'Africa',
        'south sudan': 'Africa', 'comoros': 'Africa', 'mayotte': 'Africa',
        'saint helena': 'Africa', 'ascension': 'Africa', 'tristan': 'Africa',
        'western sahara': 'Africa', 'west africa': 'West Africa',
        # Asia
        'malaysia': 'Asia', 'singapore': 'Asia', 'india': 'Asia',
        'china': 'Asia', 'japan': 'Asia', 'korea': 'Asia',
        'thailand': 'Asia', 'vietnam': 'Asia', 'indonesia': 'Asia',
        'philippines': 'Asia', 'myanmar': 'Asia', 'cambodia': 'Asia',
        'laos': 'Asia', 'brunei': 'Asia', 'timor': 'Asia',
        'macau': 'Asia', 'hong kong': 'Asia', 'taiwan': 'Asia',
        'mongolia': 'Asia', 'north korea': 'Asia', 'south korea': 'Asia',
        'srilanka': 'Asia', 'bangladesh': 'Asia', 'nepal': 'Asia',
        'bhutan': 'Asia', 'maldives': 'Asia', 'pakistan': 'Asia',
        'afghanistan': 'Asia', 'kazakhstan': 'Asia', 'uzbekistan': 'Asia',
        'turkmenistan': 'Asia', 'kyrgyzstan': 'Asia', 'tajikistan': 'Asia',
        # Oceania
        'papua': 'Oceania', 'fiji': 'Oceania', 'solomon': 'Oceania',
        'vanuatu': 'Oceania', 'samoa': 'Oceania', 'tonga': 'Oceania',
        'kiribati': 'Oceania', 'tuvalu': 'Oceania', 'nauru': 'Oceania',
        'palau': 'Oceania', 'marshall': 'Oceania', 'micronesia': 'Oceania',
        'guam': 'Oceania', 'northern mariana': 'Oceania',
        'american samoa': 'Oceania', 'cook': 'Oceania', 'niue': 'Oceania',
        'tokelau': 'Oceania', 'pitcairn': 'Oceania',
        'french polynesia': 'Oceania', 'new caledonia': 'Oceania',
        'wallis': 'Oceania', 'futuna': 'Oceania',
        'australia': 'Oceania', 'new zealand': 'Oceania',
        'norfolk': 'Oceania', 'christmas': 'Oceania', 'cocos': 'Oceania',
        # Americas
        'usa': 'Americas', 'united states': 'Americas', 'america': 'Americas',
        'canada': 'Americas', 'brazil': 'Americas', 'argentina': 'Americas',
        'chile': 'Americas', 'peru': 'Americas', 'colombia': 'Americas',
        'venezuela': 'Americas', 'ecuador': 'Americas', 'uruguay': 'Americas',
        'paraguay': 'Americas', 'bolivia': 'Americas', 'guyana': 'Americas',
        'suriname': 'Americas', 'trinidad': 'Americas', 'jamaica': 'Americas',
        'dominican': 'Americas', 'haiti': 'Americas', 'cuba': 'Americas',
        'panama': 'Americas', 'mexico': 'Americas', 'barbados': 'Americas',
        'bahamas': 'Americas', 'antigua': 'Americas', 'dominica': 'Americas',
        'grenada': 'Americas', 'st lucia': 'Americas', 'st vincent': 'Americas',
        'st kitts': 'Americas', 'aruba': 'Americas', 'curacao': 'Americas',
        'bonaire': 'Americas', 'sint maarten': 'Americas', 'belize': 'Americas',
        'costa rica': 'Americas', 'guatemala': 'Americas', 'honduras': 'Americas',
        'el salvador': 'Americas', 'nicaragua': 'Americas',
        'caribbean': 'Caribbean', 'martinique': 'Americas', 'guadeloupe': 'Americas',
        'french guiana': 'Americas', 'saint barthelemy': 'Americas',
        'saint martin': 'Americas', 'saint pierre': 'Americas',
        'miquelon': 'Americas', 'anguilla': 'Americas', 'montserrat': 'Americas',
        'bermuda': 'Americas', 'cayman': 'Americas', 'turks': 'Americas',
        'caicos': 'Americas', 'british virgin': 'Americas',
        'us virgin': 'Americas', 'puerto rico': 'Americas',
        # Europe
        'france': 'Europe', 'germany': 'Europe', 'spain': 'Europe',
        'italy': 'Europe', 'netherlands': 'Europe', 'belgium': 'Europe',
        'portugal': 'Europe', 'norway': 'Europe', 'sweden': 'Europe',
        'denmark': 'Europe', 'finland': 'Europe', 'iceland': 'Europe',
        'estonia': 'Europe', 'latvia': 'Europe', 'lithuania': 'Europe',
        'poland': 'Europe', 'czech': 'Europe', 'slovakia': 'Europe',
        'hungary': 'Europe', 'romania': 'Europe', 'bulgaria': 'Europe',
        'croatia': 'Europe', 'slovenia': 'Europe', 'serbia': 'Europe',
        'bosnia': 'Europe', 'montenegro': 'Europe', 'albania': 'Europe',
        'greece': 'Europe', 'cyprus': 'Europe', 'malta': 'Europe',
        'turkey': 'Europe', 'turkiye': 'Europe', 'russia': 'Europe',
        'ukraine': 'Europe', 'belarus': 'Europe', 'moldova': 'Europe',
        'georgia': 'Europe', 'armenia': 'Europe', 'azerbaijan': 'Europe',
        'uk': 'Europe', 'britain': 'Europe', 'england': 'Europe',
        'ireland': 'Europe', 'scotland': 'Europe', 'wales': 'Europe',
        'switzerland': 'Europe', 'austria': 'Europe',
        'luxembourg': 'Europe', 'liechtenstein': 'Europe', 'monaco': 'Europe',
        'san marino': 'Europe', 'andorra': 'Europe', 'vatican': 'Europe',
        'kosovo': 'Europe', 'faroe': 'Europe', 'greenland': 'Europe',
        'svalbard': 'Europe', 'jan mayen': 'Europe', 'aland': 'Europe',
        'isle of man': 'Europe', 'jersey': 'Europe', 'guernsey': 'Europe',
        'gibraltar': 'Europe', 'bouvet': 'Europe',
        # Middle East
        'uae': 'Middle East', 'dubai': 'Middle East', 'saudi': 'Middle East',
        'qatar': 'Middle East', 'kuwait': 'Middle East', 'oman': 'Middle East',
        'bahrain': 'Middle East', 'iraq': 'Middle East', 'syria': 'Middle East',
        'lebanon': 'Middle East', 'jordan': 'Middle East', 'israel': 'Middle East',
        'palestine': 'Middle East', 'yemen': 'Middle East', 'iran': 'Middle East',
        'middle east': 'Middle East', 'mena': 'Middle East',
    }

    for hint, region in country_hints.items():
        if hint in name_lower:
            return region

    # Legal form / jurisdiction hints
    if 'dmcc' in name_lower or 'fzco' in name_lower or 'f.z.e' in name_lower:
        return 'Middle East'
    if 'pte. ltd.' in name_lower or 'pte ltd' in name_lower or 'private limited' in name_lower:
        return 'Asia'
    if 'llc' in name_lower:
        return 'Americas'
    if 'sia' in name_lower:
        return 'Europe'
    if 'a/b' in name_lower or 'a/s' in name_lower or 'hf' in name_lower:
        return 'Europe'
    if 'sp zoo' in name_lower or 'sp. z o.o.' in name_lower:
        return 'Europe'
    if 'lda' in name_lower:
        return 'Europe'
    if 's.a.s' in name_lower or 'sas' in name_lower:
        return 'Europe'
    if 'limited' in name_lower and 'private limited' not in name_lower:
        return 'Europe'
    if 'inc.' in name_lower or 'incorporated' in name_lower or 'corp.' in name_lower:
        return 'Americas'
    if 'gmbh' in name_lower or 'ag ' in name_lower or ' kg ' in name_lower:
        return 'Europe'
    if 'bv' in name_lower or 'b.v.' in name_lower:
        return 'Europe'
    if 'nv' in name_lower or 'n.v.' in name_lower:
        return 'Europe'
    if 'ab' in name_lower:
        return 'Europe'
    if 'oy' in name_lower:
        return 'Europe'
    if 'as ' in name_lower:
        return 'Europe'

    return 'Unknown'


def determine_office_region(company_id, coverage_data, office_name=None):
    """Determine which region an office primarily serves."""
    # First try name-based inference
    if office_name:
        name_region = infer_office_region_from_name(office_name)
        if name_region != 'Unknown':
            return name_region

    # Fallback to coverage-based inference
    countries = [c for c, _ in coverage_data.get(company_id, [])]
    if not countries:
        return "Unknown"

    regions = defaultdict(int)
    for c in countries:
        regions[get_region(c)] += 1

    if regions:
        return max(regions, key=regions.get)
    return "Unknown"


def country_name_in_office_name(country_iso: str, office_name: str) -> bool:
    """Check if country name/alias appears in the office name."""
    name_lower = office_name.lower()

    # ISO → common name hints
    iso_hints = {
        'CIV': ["cote d'ivoire", "ivory coast", "côte d'ivoire"],
        'CPV': ["cabo verde", "cape verde"],
        'GAB': ["gabon"],
        'GHA': ["ghana"],
        'GIN': ["guinea"],
        'KEN': ["kenya"],
        'MDG': ["madagascar"],
        'MAR': ["maroc", "morocco"],
        'MOZ': ["mozambique"],
        'NAM': ["namibia"],
        'REU': ["reunion", "réunion"],
        'SEN': ["senegal"],
        'ZAF': ["south africa"],
        'MUS': ["mauritius"],
        'ARE': ["uae", "dubai"],
        'SAU': ["saudi"],
        'QAT': ["qatar"],
        'KWT': ["kuwait"],
        'OMN': ["oman"],
        'BHR': ["bahrain"],
        'SGP': ["singapore"],
        'MYS': ["malaysia"],
        'USA': ["usa", "united states", "america"],
        'GBR': ["uk", "britain", "england"],
        'FRA': ["france"],
        'DEU': ["germany"],
        'ESP': ["spain"],
        'ITA': ["italy"],
        'NLD': ["netherlands"],
        'BEL': ["belgium"],
        'PRT': ["portugal"],
        'NOR': ["norway"],
        'SWE': ["sweden"],
        'DNK': ["denmark"],
        'FIN': ["finland"],
        'ISL': ["iceland"],
        'EST': ["estonia"],
        'LVA': ["latvia"],
        'LTU': ["lithuania"],
        'POL': ["poland"],
        'CZE': ["czech"],
        'SVK': ["slovakia"],
        'HUN': ["hungary"],
        'ROU': ["romania"],
        'BGR': ["bulgaria"],
        'HRV': ["croatia"],
        'SVN': ["slovenia"],
        'SRB': ["serbia"],
        'BIH': ["bosnia"],
        'MNE': ["montenegro"],
        'ALB': ["albania"],
        'GRC': ["greece"],
        'CYP': ["cyprus"],
        'MLT': ["malta"],
        'TUR': ["turkey", "turkiye"],
        'RUS': ["russia"],
        'UKR': ["ukraine"],
        'IND': ["india"],
        'CHN': ["china"],
        'JPN': ["japan"],
        'KOR': ["korea"],
        'AUS': ["australia"],
        'NZL': ["new zealand"],
        'CAN': ["canada"],
        'BRA': ["brazil"],
        'ARG': ["argentina"],
        'CHL': ["chile"],
        'PER': ["peru"],
        'COL': ["colombia"],
        'VEN': ["venezuela"],
        'ECU': ["ecuador"],
        'URY': ["uruguay"],
        'PRY': ["paraguay"],
        'BOL': ["bolivia"],
        'GUY': ["guyana"],
        'SUR': ["suriname"],
        'TTO': ["trinidad"],
        'JAM': ["jamaica"],
        'DOM': ["dominican"],
        'HTI': ["haiti"],
        'CUB': ["cuba"],
        'PAN': ["panama"],
        'MEX': ["mexico"],
        'BRB': ["barbados"],
        'BHS': ["bahamas"],
        'ATG': ["antigua"],
        'DMA': ["dominica"],
        'GRD': ["grenada"],
        'LCA': ["st lucia", "saint lucia"],
        'VCT': ["st vincent", "saint vincent"],
        'KNA': ["st kitts", "saint kitts"],
        'ABW': ["aruba"],
        'CUW': ["curacao", "curaçao"],
        'BES': ["bonaire"],
        'SXM': ["sint maarten"],
        'BLZ': ["belize"],
        'CRI': ["costa rica"],
        'GTM': ["guatemala"],
        'HND': ["honduras"],
        'SLV': ["el salvador"],
        'NIC': ["nicaragua"],
        'DZA': ["algeria"],
        'EGY': ["egypt"],
        'LBY': ["libya"],
        'TUN': ["tunisia"],
        'CMR': ["cameroon"],
        'AGO': ["angola"],
        'TZA': ["tanzania"],
        'TGO': ["togo"],
        'BEN': ["benin"],
        'COG': ["congo"],
        'GNQ': ["equatorial guinea"],
        'STP': ["sao tome"],
        'SYC': ["seychelles"],
        'SLE': ["sierra leone"],
        'LBR': ["liberia"],
        'GNB': ["guinea-bissau"],
        'BFA': ["burkina"],
        'MLI': ["mali"],
        'NER': ["niger"],
        'TCD': ["chad"],
        'CAF': ["central african"],
        'RWA': ["rwanda"],
        'BDI': ["burundi"],
        'UGA': ["uganda"],
        'ZMB': ["zambia"],
        'ZWE': ["zimbabwe"],
        'BWA': ["botswana"],
        'LSO': ["lesotho"],
        'SWZ': ["eswatini", "swaziland"],
        'MWI': ["malawi"],
        'DJI': ["djibouti"],
        'SOM': ["somalia"],
        'ERI': ["eritrea"],
        'ETH': ["ethiopia"],
        'SDN': ["sudan"],
        'SSD': ["south sudan"],
        'COM': ["comoros"],
        'MYT': ["mayotte"],
        'SHN': ["saint helena"],
        'FLK': ["falkland"],
        'SGS': ["south georgia"],
        'IOT': ["british indian"],
        'PCN': ["pitcairn"],
        'AIA': ["anguilla"],
        'MSR': ["montserrat"],
        'BMU': ["bermuda"],
        'CYM': ["cayman"],
        'TCA': ["turks", "caicos"],
        'VGB': ["british virgin"],
        'VIR': ["us virgin"],
        'PRI': ["puerto rico"],
        'BLM': ["saint barthelemy"],
        'MAF': ["saint martin"],
        'SPM': ["saint pierre", "miquelon"],
        'CPT': ["clipperton"],
        'GRL': ["greenland"],
        'FRO': ["faroe"],
        'ALA': ["aland"],
        'SJM': ["svalbard", "jan mayen"],
        'IMN': ["isle of man"],
        'JEY': ["jersey"],
        'GGY': ["guernsey"],
        'GIB': ["gibraltar"],
        'MCO': ["monaco"],
        'LIE': ["liechtenstein"],
        'SMR': ["san marino"],
        'AND': ["andorra"],
        'VAT': ["vatican"],
        'XKX': ["kosovo"],
        'PSE': ["palestine"],
        'ESH': ["western sahara"],
        'AFG': ["afghanistan"],
        'BGD': ["bangladesh"],
        'BTN': ["bhutan"],
        'BRN': ["brunei"],
        'KHM': ["cambodia"],
        'KAZ': ["kazakhstan"],
        'KGZ': ["kyrgyzstan"],
        'LAO': ["laos"],
        'MDV': ["maldives"],
        'MNG': ["mongolia"],
        'MMR': ["myanmar"],
        'NPL': ["nepal"],
        'PAK': ["pakistan"],
        'PHL': ["philippines"],
        'LKA': ["sri lanka"],
        'TJK': ["tajikistan"],
        'THA': ["thailand"],
        'TLS': ["timor"],
        'TKM': ["turkmenistan"],
        'VNM': ["vietnam"],
        'TWN': ["taiwan"],
        'HKG': ["hong kong"],
        'MAC': ["macau"],
        'PNG': ["papua"],
        'WSM': ["samoa"],
        'SLB': ["solomon"],
        'TON': ["tonga"],
        'PLW': ["palau"],
        'MHL': ["marshall"],
        'FSM': ["micronesia"],
        'NRU': ["nauru"],
        'COK': ["cook"],
        'NIU': ["niue"],
        'TKL': ["tokelau"],
        'PYF': ["french polynesia"],
        'NCL': ["new caledonia"],
        'WLF': ["wallis", "futuna"],
        'ASM': ["american samoa"],
        'GUM': ["guam"],
        'MNP': ["northern mariana"],
        'NFK': ["norfolk"],
        'CXR': ["christmas"],
        'CCK': ["cocos", "keeling"],
        'BVT': ["bouvet"],
        'HMD': ["heard", "mcdonald"],
        'WAF': ["west africa"],
        'CAR': ["caribbean"],
    }

    hints = iso_hints.get(country_iso, [])
    for hint in hints:
        if hint in name_lower:
            return True
    return False


def find_best_office(country_iso, options, coverage_data):
    """
    Find the best existing office for a coverage country.

    1. Exact country match (office already covers this country in DB)
    2. Name-based country match (office name contains the country)
    3. Same region match (office primarily serves same region, pick the one covering most countries)
    4. Fallback (first option)
    """
    # 1. Exact match from DB coverage
    for opt_name, opt_id in options:
        opt_countries = [c for c, _ in coverage_data.get(opt_id, [])]
        if country_iso in opt_countries:
            return opt_id, opt_name, 'exact'

    # 2. Name-based country match
    for opt_name, opt_id in options:
        if country_name_in_office_name(country_iso, opt_name):
            return opt_id, opt_name, 'name'

    # 3. Region match
    target_region = get_region(country_iso)
    region_matches = []
    for opt_name, opt_id in options:
        opt_region = determine_office_region(opt_id, coverage_data, opt_name)
        if opt_region == target_region:
            score = len(coverage_data.get(opt_id, []))
            region_matches.append((score, opt_id, opt_name))

    if region_matches:
        region_matches.sort(reverse=True)
        _, best_id, best_name = region_matches[0]
        return best_id, best_name, 'region'

    # 4. Fallback
    return options[0][1], options[0][0], 'fallback'


def main():
    parser = argparse.ArgumentParser(description="Smart merge ambiguous suppliers")
    parser.add_argument('--dry-run', action='store_true', help='Preview only, do not execute')
    parser.add_argument('--sql-file', default='/tmp/merge_auto.sql', help='Output SQL file path')
    args = parser.parse_args()

    # Parse cases from merge_ambiguous.sql
    sql_path = Path(__file__).parent / 'merge_ambiguous.sql'
    if not sql_path.exists():
        print(f"Error: {sql_path} not found", file=sys.stderr)
        sys.exit(1)

    cases = parse_merge_ambiguous_sql(sql_path)
    print(f"Parsed {len(cases)} ambiguous cases from merge_ambiguous.sql")

    # Collect all company IDs
    all_ids = []
    for case in cases:
        all_ids.append(case['new_id'])
        for _, opt_id in case['options']:
            all_ids.append(opt_id)

    # Get coverage for all
    print(f"Querying DB for coverage of {len(all_ids)} companies...")
    coverage_data = get_coverage_batch(all_ids)

    # Generate SQL
    sql_lines = ['BEGIN;', '']
    total_moves = 0

    for case in cases:
        new_id = case['new_id']
        new_name = case['new_name']
        options = case['options']

        new_coverage = coverage_data.get(new_id, [])
        if not new_coverage:
            print(f"  WARNING: {new_name} ({new_id}) has no coverage rules — skipping")
            continue

        sql_lines.append(f"-- === {new_name} ({new_id}) ===")

        assignments = defaultdict(list)

        for country_iso, rule_id in new_coverage:
            target_id, target_name, match_type = find_best_office(country_iso, options, coverage_data)
            assignments[target_id].append((country_iso, rule_id, match_type, target_name))

        for target_id, items in assignments.items():
            for country_iso, rule_id, match_type, target_name in items:
                sql_lines.append(
                    f"UPDATE company_place_supply_rules SET company_id = '{target_id}' WHERE id = '{rule_id}';  -- {country_iso} → {target_name} ({match_type})"
                )
                total_moves += 1

        sql_lines.append(f"DELETE FROM counterparties WHERE id = '{new_id}';")
        sql_lines.append('')

    sql_lines.append('COMMIT;')

    # Write SQL
    sql_content = '\n'.join(sql_lines)
    with open(args.sql_file, 'w') as f:
        f.write(sql_content)

    print(f"\nGenerated {args.sql_file}")
    print(f"Total coverage rule moves: {total_moves}")

    # Show summary
    print("\n--- Assignment Summary ---")
    for case in cases:
        new_id = case['new_id']
        new_name = case['new_name']
        new_coverage = coverage_data.get(new_id, [])
        if not new_coverage:
            continue

        assignments = defaultdict(list)
        for country_iso, rule_id in new_coverage:
            target_id, target_name, match_type = find_best_office(country_iso, case['options'], coverage_data)
            assignments[target_name].append((country_iso, match_type))

        print(f"\n{new_name}:")
        for target_name, items in assignments.items():
            countries = [c for c, _ in items]
            types = set(t for _, t in items)
            type_str = '/'.join(sorted(types))
            print(f"  → {target_name}: {', '.join(countries)} ({type_str})")

    if args.dry_run:
        print("\n-- DRY RUN — SQL not executed --")
        return

    # Execute SQL via SSH pipe
    print(f"\nExecuting SQL on {SSH_HOST}...")
    cmd = f"cat {args.sql_file} | ssh {SSH_HOST} 'sudo -u postgres psql -d fueld'"
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    print(result.stdout)
    if result.returncode != 0:
        print(f"Error: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    print("Done!")


if __name__ == '__main__':
    main()
