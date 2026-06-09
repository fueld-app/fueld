#!/usr/bin/env python3
"""
Smart merge ambiguous suppliers into regional offices.

Logic:
1. For each new ambiguous supplier, get its coverage rules (country_iso)
2. For each existing match, get its office country
3. Match coverage rules to the closest regional office:
   a. Exact country match → assign to that office
   b. Same region match → assign to office in same region
   c. Multiple offices in same region → pick first one (or closest by geography)
4. Delete the new generic supplier after all rules are reassigned

Usage:
  python3 scripts/merge_ambiguous_smart.py --dry-run
  python3 scripts/merge_ambiguous_smart.py | ssh root@139.162.157.31 "sudo -u postgres psql -d fueld"
"""

import argparse
import sys
from pathlib import Path

# Country → region mapping (from LLI places table + manual additions)
COUNTRY_REGION = {
    # Europe
    "ALB": "Europe", "BGR": "Europe", "HRV": "Europe", "CYP": "Europe",
    "CZE": "Europe", "DNK": "Europe", "EST": "Europe", "FIN": "Europe",
    "FRA": "Europe", "DEU": "Europe", "GRC": "Europe", "HUN": "Europe",
    "ISL": "Europe", "IRL": "Europe", "ITA": "Europe", "LVA": "Europe",
    "LTU": "Europe", "MLT": "Europe", "MNE": "Europe", "NLD": "Europe",
    "NOR": "Europe", "POL": "Europe", "PRT": "Europe", "ROU": "Europe",
    "SVK": "Europe", "SVN": "Europe", "ESP": "Europe", "SWE": "Europe",
    "CHE": "Europe", "GBR": "Europe", "UKR": "Europe", "RUS": "Europe",
    "BEL": "Europe", "AUT": "Europe",
    # Middle East / Persian Gulf
    "ARE": "Middle East", "BHR": "Middle East", "IRN": "Middle East",
    "IRQ": "Middle East", "ISR": "Middle East", "JOR": "Middle East",
    "KWT": "Middle East", "LBN": "Middle East", "OMN": "Middle East",
    "QAT": "Middle East", "SAU": "Middle East", "SYR": "Middle East",
    "TUR": "Middle East", "YEM": "Middle East",
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
    "ZMB": "Africa", "ZWE": "Africa", "REU": "Africa",
    # Asia
    "AFG": "Asia", "BGD": "Asia", "BTN": "Asia", "BRN": "Asia",
    "KHM": "Asia", "CHN": "Asia", "IND": "Asia", "IDN": "Asia",
    "JPN": "Asia", "KAZ": "Asia", "KGZ": "Asia", "LAO": "Asia",
    "MYS": "Asia", "MDV": "Asia", "MNG": "Asia", "MMR": "Asia",
    "NPL": "Asia", "PRK": "Asia", "PAK": "Asia", "PHL": "Asia",
    "SGP": "Asia", "KOR": "Asia", "LKA": "Asia", "TJK": "Asia",
    "THA": "Asia", "TLS": "Asia", "TKM": "Asia", "UZB": "Asia",
    "VNM": "Asia", "TWN": "Asia", "HKG": "Asia",
    # Americas
    "ARG": "Americas", "BHS": "Americas", "BRB": "Americas", "BLZ": "Americas",
    "BOL": "Americas", "BRA": "Americas", "CAN": "Americas", "CHL": "Americas",
    "COL": "Americas", "CRI": "Americas", "CUB": "Americas", "DOM": "Americas",
    "ECU": "Americas", "SLV": "Americas", "GTM": "Americas", "GUY": "Americas",
    "HTI": "Americas", "HND": "Americas", "JAM": "Americas", "MEX": "Americas",
    "NIC": "Americas", "PAN": "Americas", "PRY": "Americas", "PER": "Americas",
    "SUR": "Americas", "TTO": "Americas", "USA": "Americas", "URY": "Americas",
    "VEN": "Americas", "GUF": "Americas", "GLP": "Americas", "MTQ": "Americas",
    # Oceania
    "AUS": "Oceania", "FJI": "Oceania", "KIR": "Oceania", "MHL": "Oceania",
    "FSM": "Oceania", "NRU": "Oceania", "NZL": "Oceania", "PLW": "Oceania",
    "PNG": "Oceania", "WSM": "Oceania", "SLB": "Oceania", "TON": "Oceania",
    "TUV": "Oceania", "VUT": "Oceania",
    # Special / Regional
    "CAR": "Caribbean", "WAF": "West Africa", "ENG": "Europe",
}


def get_region(country_iso: str) -> str:
    return COUNTRY_REGION.get(country_iso, "Unknown")


def main():
    parser = argparse.ArgumentParser(description="Smart merge ambiguous suppliers")
    parser.add_argument("--dry-run", action="store_true", help="Print summary only")
    args = parser.parse_args()

    # This script is designed to be run on the server where we can query the DB
    # For now, print the logic and expected behavior
    print("-- Smart Merge Logic:")
    print("-- 1. For each ambiguous new supplier, get its coverage rules")
    print("-- 2. For each existing match, get its office country")
    print("-- 3. Match coverage country to closest regional office:")
    print("--    a. Exact country match → assign to that office")
    print("--    b. Same region match → assign to office in same region")
    print("--    c. Multiple offices in same region → pick first one")
    print("-- 4. Delete new generic supplier after all rules reassigned")
    print()
    print("-- Example: 'Vivo' has coverage in CIV, CPV, GAB, GHA, MDG, MUS, NAM")
    print("--   Existing offices:")
    print("--     - Vivo Energy Côte d'Ivoire (CIV)")
    print("--     - Vivo Energy Gabon (GAB)")
    print("--     - Vivo Energy Ghana (GHA)")
    print("--     - Vivo Energy Madagascar (MDG)")
    print("--     - Vivo Energy Maroc (MAR)")
    print("--     - Vivo Energy Mozambique (MOZ)")
    print("--     - Vivo Energy Namibia (NAM)")
    print("--     - Vivo Energy Réunion (REU)")
    print("--     - Vivo Energy Senegal (SEN)")
    print("--   Assignment:")
    print("--     CIV → Vivo Energy Côte d'Ivoire (exact)")
    print("--     CPV → Vivo Energy Senegal (same region: Africa)")
    print("--     GAB → Vivo Energy Gabon (exact)")
    print("--     GHA → Vivo Energy Ghana (exact)")
    print("--     MDG → Vivo Energy Madagascar (exact)")
    print("--     MUS → Vivo Energy Réunion (same region: Africa)")
    print("--     NAM → Vivo Energy Namibia (exact)")
    print()
    print("-- To execute this, we need to run a script on the server that:")
    print("--   1. Queries the DB for all ambiguous cases")
    print("--   2. Applies the matching logic")
    print("--   3. Generates and executes UPDATE/DELETE SQL")
    print()
    print("-- This requires a Python script with psycopg2 or similar on the server.")
    print("-- Alternatively, we can generate the SQL here and execute it remotely.")


if __name__ == "__main__":
    main()
