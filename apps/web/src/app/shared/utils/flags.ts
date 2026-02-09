// ═══════════════════════════════════════════════════════════════════════
//  Country flag emoji utility
//  Converts ISO-3 or ISO-2 country codes to flag emoji.
// ═══════════════════════════════════════════════════════════════════════

/** ISO-3 → ISO-2 mapping for flag emoji conversion */
const ISO3_TO_ISO2: Record<string, string> = {
  AFG:'AF',AGO:'AO',ALB:'AL',AND:'AD',ARE:'AE',ARG:'AR',ARM:'AM',ATG:'AG',
  AUS:'AU',AUT:'AT',AZE:'AZ',BDI:'BI',BEL:'BE',BEN:'BJ',BFA:'BF',BGD:'BD',
  BGR:'BG',BHR:'BH',BHS:'BS',BIH:'BA',BLR:'BY',BLZ:'BZ',BMU:'BM',BOL:'BO',
  BRA:'BR',BRB:'BB',BRN:'BN',BTN:'BT',BWA:'BW',CAF:'CF',CAN:'CA',CHE:'CH',
  CHL:'CL',CHN:'CN',CIV:'CI',CMR:'CM',COD:'CD',COG:'CG',COL:'CO',COM:'KM',
  CPV:'CV',CRI:'CR',CUB:'CU',CUW:'CW',CYM:'KY',CYP:'CY',CZE:'CZ',DEU:'DE',
  DJI:'DJ',DMA:'DM',DNK:'DK',DOM:'DO',DZA:'DZ',ECU:'EC',EGY:'EG',ERI:'ER',
  ESP:'ES',EST:'EE',ETH:'ET',FIN:'FI',FJI:'FJ',FRA:'FR',GAB:'GA',GBR:'GB',
  GEO:'GE',GHA:'GH',GIB:'GI',GIN:'GN',GMB:'GM',GNB:'GW',GNQ:'GQ',GRC:'GR',
  GRD:'GD',GTM:'GT',GUY:'GY',HKG:'HK',HND:'HN',HRV:'HR',HTI:'HT',HUN:'HU',
  IDN:'ID',IND:'IN',IRL:'IE',IRN:'IR',IRQ:'IQ',ISL:'IS',ISR:'IL',ITA:'IT',
  JAM:'JA',JOR:'JO',JPN:'JP',KAZ:'KZ',KEN:'KE',KGZ:'KG',KHM:'KH',KIR:'KI',
  KNA:'KN',KOR:'KR',KWT:'KW',LAO:'LA',LBN:'LB',LBR:'LR',LBY:'LY',LCA:'LC',
  LIE:'LI',LKA:'LK',LSO:'LS',LTU:'LT',LUX:'LU',LVA:'LV',MAR:'MA',MCO:'MC',
  MDA:'MD',MDG:'MG',MDV:'MV',MEX:'MX',MHL:'MH',MKD:'MK',MLI:'ML',MLT:'MT',
  MMR:'MM',MNE:'ME',MNG:'MN',MOZ:'MZ',MRT:'MR',MUS:'MU',MWI:'MW',MYS:'MY',
  NAM:'NA',NER:'NE',NGA:'NG',NIC:'NI',NLD:'NL',NOR:'NO',NPL:'NP',NRU:'NR',
  NZL:'NZ',OMN:'OM',PAK:'PK',PAN:'PA',PER:'PE',PHL:'PH',PLW:'PW',PNG:'PG',
  POL:'PL',PRI:'PR',PRK:'KP',PRT:'PT',PRY:'PY',QAT:'QA',ROU:'RO',RUS:'RU',
  RWA:'RW',SAU:'SA',SDN:'SD',SEN:'SN',SGP:'SG',SLB:'SB',SLE:'SL',SLV:'SV',
  SMR:'SM',SOM:'SO',SRB:'RS',SSD:'SS',STP:'ST',SUR:'SR',SVK:'SK',SVN:'SI',
  SWE:'SE',SWZ:'SZ',SYC:'SC',SYR:'SY',TCA:'TC',TCD:'TD',TGO:'TG',THA:'TH',
  TJK:'TJ',TKM:'TM',TLS:'TL',TON:'TO',TTO:'TT',TUN:'TN',TUR:'TR',TUV:'TV',
  TWN:'TW',TZA:'TZ',UGA:'UG',UKR:'UA',URY:'UY',USA:'US',UZB:'UZ',VCT:'VC',
  VEN:'VE',VGB:'VG',VIR:'VI',VNM:'VN',VUT:'VU',WSM:'WS',YEM:'YE',ZAF:'ZA',
  ZMB:'ZM',ZWE:'ZW',
  // Seasearcher-specific flag codes (e.g. DIS = Denmark Int. Register)
  DIS:'DK',MJL:'MH',PMD:'PA',IOT:'IO',
};

/**
 * Convert an ISO-3 country code to a flag emoji.
 * Returns empty string for unknown codes.
 */
export function flagFromIso3(iso3: string | null | undefined): string {
  if (!iso3) return '';
  const iso2 = ISO3_TO_ISO2[iso3.toUpperCase()];
  if (!iso2 || iso2.length !== 2) return '';
  const [a, b] = [...iso2].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65);
  return String.fromCodePoint(a, b);
}

/**
 * Convert an ISO-2 country code to a flag emoji.
 */
export function flagFromIso2(iso2: string | null | undefined): string {
  if (!iso2 || iso2.length !== 2) return '';
  const upper = iso2.toUpperCase();
  const [a, b] = [...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65);
  return String.fromCodePoint(a, b);
}

/**
 * Convert a UNLOCODE (first 2 chars = ISO-2 country) to a flag emoji.
 */
export function flagFromUnlocode(unlocode: string | null | undefined): string {
  if (!unlocode) return '';
  return flagFromIso2(unlocode.replace(/\s/g, '').substring(0, 2));
}
