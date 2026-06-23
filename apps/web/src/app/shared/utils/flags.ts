//  Country flag emoji utility
//  Converts ISO-3 or ISO-2 country codes to flag emoji.
//
//  This map is the single source of truth for ISO-3 -> ISO-2 conversion and is
//  kept complete for every current ISO-3166-1 country/territory code used in
//  `shared/data/countries.ts`. Subnational/maritime registers (Azores, Canary
//  Islands, Madeira, DIS/NIS/RIF international registers, Tahiti) map to their
//  parent country so they still show a recognisable flag. Historical codes
//  (USSR, Yugoslavia, Czechoslovakia, Zaire, East Germany, Netherlands
//  Antilles, Neutral Zone, Unknown) intentionally have NO mapping: there is no
//  valid regional-indicator flag for them, so `flagFromIso3` returns ''.

/** ISO-3 -> ISO-2 mapping for flag emoji conversion. */
const ISO3_TO_ISO2: Record<string, string> = {
  AFG: 'AF', AGO: 'AO', AIA: 'AI', ALA: 'AX', ALB: 'AL', AND: 'AD', ARE: 'AE',
  ARG: 'AR', ARM: 'AM', ASM: 'AS', ATA: 'AQ', ATF: 'TF', ATG: 'AG', AUS: 'AU',
  AUT: 'AT', ABW: 'AW', AZE: 'AZ', AZO: 'PT',

  BDI: 'BI', BEL: 'BE', BEN: 'BJ', BES: 'BQ', BFA: 'BF', BGD: 'BD', BGR: 'BG',
  BHR: 'BH', BHS: 'BS', BIH: 'BA', BLM: 'BL', BLR: 'BY', BLZ: 'BZ', BMU: 'BM',
  BOL: 'BO', BRA: 'BR', BRB: 'BB', BRN: 'BN', BTN: 'BT', BVT: 'BV', BWA: 'BW',

  CHE: 'CH', CHL: 'CL', CAF: 'CF', CAN: 'CA', CCK: 'CC', CIV: 'CI', CMR: 'CM', CHN: 'CN', CNI: 'ES',
  COD: 'CD', COG: 'CG', COK: 'CK', COL: 'CO', COM: 'KM', CPV: 'CV', CRI: 'CR',
  CUB: 'CU', CUW: 'CW', CXR: 'CX', CYM: 'KY', CYP: 'CY', CZE: 'CZ',

  DEU: 'DE', DIS: 'DK', DJI: 'DJ', DMA: 'DM', DNK: 'DK', DOM: 'DO', DZA: 'DZ',

  ECU: 'EC', EGY: 'EG', ERI: 'ER', ESH: 'EH', ESP: 'ES', EST: 'EE', ETH: 'ET',

  FIN: 'FI', FJI: 'FJ', FLK: 'FK', FSM: 'FM', FRA: 'FR', FRO: 'FO',

  GAB: 'GA', GBR: 'GB', GEO: 'GE', GGY: 'GG', GHA: 'GH', GIB: 'GI', GIN: 'GN',
  GLP: 'GP', GMB: 'GM', GNB: 'GW', GNQ: 'GQ', GRC: 'GR', GRD: 'GD', GRL: 'GL',
  GTM: 'GT', GUF: 'GF', GUM: 'GU', GUY: 'GY',

  HKG: 'HK', HMD: 'HM', HND: 'HN', HRV: 'HR', HTI: 'HT', HUN: 'HU',

  IDN: 'ID', IMN: 'IM', IND: 'IN', IOT: 'IO', IRL: 'IE', IRN: 'IR', IRQ: 'IQ',
  ISL: 'IS', ISR: 'IL', ITA: 'IT',

  JAM: 'JM', JEY: 'JE', JOR: 'JO', JPN: 'JP',

  KAZ: 'KZ', KEN: 'KE', KGZ: 'KG', KHM: 'KH', KIR: 'KI', KNA: 'KN', KOR: 'KR',
  KWT: 'KW',

  LAO: 'LA', LBN: 'LB', LBR: 'LR', LBY: 'LY', LCA: 'LC', LIE: 'LI', LKA: 'LK',
  LSO: 'LS', LTU: 'LT', LUX: 'LU', LVA: 'LV',

  MAC: 'MO', MAF: 'MF', MAR: 'MA', MCO: 'MC', MDA: 'MD', MDG: 'MG', MDV: 'MV', MEX: 'MX',
  MHL: 'MH', MKD: 'MK', MLI: 'ML', MLT: 'MT', MMR: 'MM', MNE: 'ME', MNG: 'MN',
  MNP: 'MP', MOZ: 'MZ', MRT: 'MR', MSR: 'MS', MTQ: 'MQ', MUS: 'MU', MWI: 'MW',
  MYT: 'YT', MYS: 'MY',

  NAM: 'NA', NCL: 'NC', NER: 'NE', NFK: 'NF', NGA: 'NG', NIC: 'NI', NIU: 'NU',
  NLD: 'NL', NIS: 'NO', NOR: 'NO', NPL: 'NP', NRU: 'NR', NZL: 'NZ',

  OMN: 'OM',

  PAK: 'PK', PAN: 'PA', PCN: 'PN', PER: 'PE', PHL: 'PH', PLW: 'PW', PNG: 'PG',
  PMD: 'PT', POL: 'PL', PRI: 'PR', PRK: 'KP', PRT: 'PT', PRY: 'PY', PSE: 'PS',
  PYF: 'PF',

  QAT: 'QA',

  REU: 'RE', ROU: 'RO', RUS: 'RU', RWA: 'RW',

  SAU: 'SA', SDN: 'SD', SEN: 'SN', SGP: 'SG', SGS: 'GS', SHN: 'SH', SLB: 'SB',
  SLE: 'SL', SLV: 'SV', SMR: 'SM', SOM: 'SO', SPM: 'PM', SRB: 'RS', SSD: 'SS', STP: 'ST', SUR: 'SR',
  SVK: 'SK', SVN: 'SI', SWE: 'SE', SWZ: 'SZ', SXM: 'SX', SJM: 'SJ', SYC: 'SC',
  SYR: 'SY',

  TAH: 'PF', TCA: 'TC', TCD: 'TD', TGO: 'TG', THA: 'TH', TJK: 'TJ', TKL: 'TK',
  TKM: 'TM', TLS: 'TL', TON: 'TO', TTO: 'TT', TUN: 'TN', TUR: 'TR', TUV: 'TV',
  TWN: 'TW', TZA: 'TZ',

  UGA: 'UG', UKR: 'UA', UMI: 'UM', URY: 'UY', USA: 'US', UZB: 'UZ',

  VAT: 'VA', VCT: 'VC', VEN: 'VE', VGB: 'VG', VIR: 'VI', VNM: 'VN', VUT: 'VU',

  WLF: 'WF', WSM: 'WS',

  YEM: 'YE',

  ZAF: 'ZA', ZMB: 'ZM', ZWE: 'ZW',

  // Extra Seasearcher vessel-flag aliases not in the country list.
  MJL: 'MH',
};

/** Convert an ISO-3 country code to its ISO-2 code, or '' if unknown. */
export function iso3ToIso2(iso3: string | null | undefined): string {
  if (!iso3) return '';
  const iso2 = ISO3_TO_ISO2[iso3.toUpperCase()];
  return iso2 && iso2.length === 2 ? iso2 : '';
}

/**
 * Convert an ISO-3 country code to a flag emoji.
 * Returns empty string for unknown / historical codes.
 */
export function flagFromIso3(iso3: string | null | undefined): string {
  const iso2 = iso3ToIso2(iso3);
  if (!iso2) return '';
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