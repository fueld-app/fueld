/**
 * Central country list for the whole app.
 *
 * - `code` is the ISO-3166-1 alpha-3 code (what we store in `countryIso`).
 * - `name` is the common, recognisable English short name normal people would
 *   search for (e.g. "Turkey", "United States", "DR Congo", "Czech Republic").
 *
 * Every place that needs a country MUST import from here — never define an
 * inline list. Use the helpers below to resolve either an ISO-3 code or a
 * stored name to the canonical display name + flag, so the same country is
 * never shown spelled two different ways.
 *
 * The code set is stable: codes are never removed (legacy data may reference
 * historical codes like SUN/USSR or CSK/Czechoslovakia), only names are
 * cleaned up.
 */
import { flagFromIso3, flagFromIso2, iso3ToIso2 } from '../utils/flags';

export interface Country {
  code: string;   // ISO-3166-1 alpha-3 code
  name: string;  // common English short name
}

export const COUNTRIES: Country[] = [
  { code: 'AFG', name: 'Afghanistan' },
  { code: 'ALA', name: 'Åland Islands' },
  { code: 'ALB', name: 'Albania' },
  { code: 'DZA', name: 'Algeria' },
  { code: 'UMI', name: 'U.S. Minor Outlying Islands' },
  { code: 'ASM', name: 'American Samoa' },
  { code: 'VIR', name: 'U.S. Virgin Islands' },
  { code: 'AND', name: 'Andorra' },
  { code: 'AGO', name: 'Angola' },
  { code: 'AIA', name: 'Anguilla' },
  { code: 'ATA', name: 'Antarctica' },
  { code: 'ATG', name: 'Antigua and Barbuda' },
  { code: 'ARG', name: 'Argentina' },
  { code: 'ARM', name: 'Armenia' },
  { code: 'ABW', name: 'Aruba' },
  { code: 'AUS', name: 'Australia' },
  { code: 'AUT', name: 'Austria' },
  { code: 'AZE', name: 'Azerbaijan' },
  { code: 'AZO', name: 'Azores' },
  { code: 'BHS', name: 'Bahamas' },
  { code: 'BHR', name: 'Bahrain' },
  { code: 'BGD', name: 'Bangladesh' },
  { code: 'BRB', name: 'Barbados' },
  { code: 'BLR', name: 'Belarus' },
  { code: 'BEL', name: 'Belgium' },
  { code: 'BLZ', name: 'Belize' },
  { code: 'BEN', name: 'Benin' },
  { code: 'BMU', name: 'Bermuda' },
  { code: 'BTN', name: 'Bhutan' },
  { code: 'BOL', name: 'Bolivia' },
  { code: 'BES', name: 'Bonaire, Sint Eustatius and Saba' },
  { code: 'BIH', name: 'Bosnia and Herzegovina' },
  { code: 'BWA', name: 'Botswana' },
  { code: 'BVT', name: 'Bouvet Island' },
  { code: 'BRA', name: 'Brazil' },
  { code: 'IOT', name: 'British Indian Ocean Territory' },
  { code: 'VGB', name: 'British Virgin Islands' },
  { code: 'BRN', name: 'Brunei' },
  { code: 'BGR', name: 'Bulgaria' },
  { code: 'BFA', name: 'Burkina Faso' },
  { code: 'BDI', name: 'Burundi' },
  { code: 'KHM', name: 'Cambodia' },
  { code: 'CMR', name: 'Cameroon' },
  { code: 'CAN', name: 'Canada' },
  { code: 'CNI', name: 'Canary Islands' },
  { code: 'CPV', name: 'Cape Verde' },
  { code: 'CYM', name: 'Cayman Islands' },
  { code: 'CAF', name: 'Central African Republic' },
  { code: 'TCD', name: 'Chad' },
  { code: 'CHL', name: 'Chile' },
  { code: 'CHN', name: 'China' },
  { code: 'CXR', name: 'Christmas Island' },
  { code: 'CCK', name: 'Cocos (Keeling) Islands' },
  { code: 'COL', name: 'Colombia' },
  { code: 'COM', name: 'Comoros' },
  { code: 'COG', name: 'Congo' },
  { code: 'COD', name: 'DR Congo' },
  { code: 'COK', name: 'Cook Islands' },
  { code: 'CRI', name: 'Costa Rica' },
  { code: 'HRV', name: 'Croatia' },
  { code: 'CUB', name: 'Cuba' },
  { code: 'CUW', name: 'Curaçao' },
  { code: 'CYP', name: 'Cyprus' },
  { code: 'CZE', name: 'Czech Republic' },
  { code: 'CSK', name: 'Czechoslovakia' },
  { code: 'DIS', name: 'Denmark (International Register)' },
  { code: 'DNK', name: 'Denmark' },
  { code: 'DJI', name: 'Djibouti' },
  { code: 'DMA', name: 'Dominica' },
  { code: 'DOM', name: 'Dominican Republic' },
  { code: 'TLS', name: 'East Timor' },
  { code: 'ECU', name: 'Ecuador' },
  { code: 'EGY', name: 'Egypt' },
  { code: 'SLV', name: 'El Salvador' },
  { code: 'GNQ', name: 'Equatorial Guinea' },
  { code: 'ERI', name: 'Eritrea' },
  { code: 'EST', name: 'Estonia' },
  { code: 'SWZ', name: 'Eswatini' },
  { code: 'ETH', name: 'Ethiopia' },
  { code: 'FLK', name: 'Falkland Islands' },
  { code: 'FRO', name: 'Faroe Islands' },
  { code: 'FJI', name: 'Fiji' },
  { code: 'FIN', name: 'Finland' },
  { code: 'FRA', name: 'France' },
  { code: 'GUF', name: 'French Guiana' },
  { code: 'RIF', name: 'France (International Register)' },
  { code: 'PYF', name: 'French Polynesia' },
  { code: 'ATF', name: 'French Southern Territories' },
  { code: 'GAB', name: 'Gabon' },
  { code: 'GMB', name: 'Gambia' },
  { code: 'GEO', name: 'Georgia' },
  { code: 'DDR', name: 'East Germany' },
  { code: 'DEU', name: 'Germany' },
  { code: 'GHA', name: 'Ghana' },
  { code: 'GIB', name: 'Gibraltar' },
  { code: 'GRC', name: 'Greece' },
  { code: 'GRL', name: 'Greenland' },
  { code: 'GRD', name: 'Grenada' },
  { code: 'GLP', name: 'Guadeloupe' },
  { code: 'GUM', name: 'Guam' },
  { code: 'GTM', name: 'Guatemala' },
  { code: 'GGY', name: 'Guernsey' },
  { code: 'GIN', name: 'Guinea' },
  { code: 'GNB', name: 'Guinea-Bissau' },
  { code: 'GUY', name: 'Guyana' },
  { code: 'HTI', name: 'Haiti' },
  { code: 'HMD', name: 'Heard and McDonald Islands' },
  { code: 'HND', name: 'Honduras' },
  { code: 'HKG', name: 'Hong Kong' },
  { code: 'HUN', name: 'Hungary' },
  { code: 'ISL', name: 'Iceland' },
  { code: 'IND', name: 'India' },
  { code: 'IDN', name: 'Indonesia' },
  { code: 'IRN', name: 'Iran' },
  { code: 'IRQ', name: 'Iraq' },
  { code: 'IRL', name: 'Ireland' },
  { code: 'IMN', name: 'Isle of Man' },
  { code: 'ISR', name: 'Israel' },
  { code: 'ITA', name: 'Italy' },
  { code: 'CIV', name: 'Ivory Coast' },
  { code: 'JAM', name: 'Jamaica' },
  { code: 'JPN', name: 'Japan' },
  { code: 'JEY', name: 'Jersey' },
  { code: 'JOR', name: 'Jordan' },
  { code: 'KAZ', name: 'Kazakhstan' },
  { code: 'KEN', name: 'Kenya' },
  { code: 'KIR', name: 'Kiribati' },
  { code: 'KWT', name: 'Kuwait' },
  { code: 'KGZ', name: 'Kyrgyzstan' },
  { code: 'LAO', name: 'Laos' },
  { code: 'LVA', name: 'Latvia' },
  { code: 'LBN', name: 'Lebanon' },
  { code: 'LSO', name: 'Lesotho' },
  { code: 'LBR', name: 'Liberia' },
  { code: 'LBY', name: 'Libya' },
  { code: 'LIE', name: 'Liechtenstein' },
  { code: 'LTU', name: 'Lithuania' },
  { code: 'LUX', name: 'Luxembourg' },
  { code: 'MAC', name: 'Macau' },
  { code: 'MDG', name: 'Madagascar' },
  { code: 'PMD', name: 'Madeira' },
  { code: 'MWI', name: 'Malawi' },
  { code: 'MYS', name: 'Malaysia' },
  { code: 'MDV', name: 'Maldives' },
  { code: 'MLI', name: 'Mali' },
  { code: 'MLT', name: 'Malta' },
  { code: 'MHL', name: 'Marshall Islands' },
  { code: 'MTQ', name: 'Martinique' },
  { code: 'MRT', name: 'Mauritania' },
  { code: 'MUS', name: 'Mauritius' },
  { code: 'MYT', name: 'Mayotte' },
  { code: 'MEX', name: 'Mexico' },
  { code: 'FSM', name: 'Micronesia' },
  { code: 'MDA', name: 'Moldova' },
  { code: 'MCO', name: 'Monaco' },
  { code: 'MNG', name: 'Mongolia' },
  { code: 'MNE', name: 'Montenegro' },
  { code: 'MSR', name: 'Montserrat' },
  { code: 'MAR', name: 'Morocco' },
  { code: 'MOZ', name: 'Mozambique' },
  { code: 'MMR', name: 'Myanmar' },
  { code: 'NAM', name: 'Namibia' },
  { code: 'NRU', name: 'Nauru' },
  { code: 'NPL', name: 'Nepal' },
  { code: 'NLD', name: 'Netherlands' },
  { code: 'ANT', name: 'Netherlands Antilles' },
  { code: 'NTZ', name: 'Saudi-Iraqi Neutral Zone' },
  { code: 'NCL', name: 'New Caledonia' },
  { code: 'NZL', name: 'New Zealand' },
  { code: 'NIC', name: 'Nicaragua' },
  { code: 'NER', name: 'Niger' },
  { code: 'NGA', name: 'Nigeria' },
  { code: 'NIU', name: 'Niue' },
  { code: 'NFK', name: 'Norfolk Island' },
  { code: 'PRK', name: 'North Korea' },
  { code: 'MKD', name: 'North Macedonia' },
  { code: 'MNP', name: 'Northern Mariana Islands' },
  { code: 'NOR', name: 'Norway' },
  { code: 'NIS', name: 'Norway (International Register)' },
  { code: 'OMN', name: 'Oman' },
  { code: 'PAK', name: 'Pakistan' },
  { code: 'PLW', name: 'Palau' },
  { code: 'PSE', name: 'Palestine' },
  { code: 'PAN', name: 'Panama' },
  { code: 'PNG', name: 'Papua New Guinea' },
  { code: 'PRY', name: 'Paraguay' },
  { code: 'PER', name: 'Peru' },
  { code: 'PHL', name: 'Philippines' },
  { code: 'PCN', name: 'Pitcairn' },
  { code: 'POL', name: 'Poland' },
  { code: 'PRT', name: 'Portugal' },
  { code: 'PRI', name: 'Puerto Rico' },
  { code: 'QAT', name: 'Qatar' },
  { code: 'REU', name: 'Réunion' },
  { code: 'ROU', name: 'Romania' },
  { code: 'RUS', name: 'Russia' },
  { code: 'RWA', name: 'Rwanda' },
  { code: 'WSM', name: 'Samoa' },
  { code: 'SMR', name: 'San Marino' },
  { code: 'STP', name: 'São Tomé and Príncipe' },
  { code: 'SAU', name: 'Saudi Arabia' },
  { code: 'SEN', name: 'Serbia' },
  { code: 'SYC', name: 'Seychelles' },
  { code: 'SLE', name: 'Sierra Leone' },
  { code: 'SGP', name: 'Singapore' },
  { code: 'SVK', name: 'Slovakia' },
  { code: 'SVN', name: 'Slovenia' },
  { code: 'SLB', name: 'Solomon Islands' },
  { code: 'SOM', name: 'Somalia' },
  { code: 'ZAF', name: 'South Africa' },
  { code: 'SGS', name: 'South Georgia and the South Sandwich Islands' },
  { code: 'KOR', name: 'South Korea' },
  { code: 'SSD', name: 'South Sudan' },
  { code: 'ESP', name: 'Spain' },
  { code: 'LKA', name: 'Sri Lanka' },
  { code: 'BLM', name: 'Saint Barthélemy' },
  { code: 'SHN', name: 'Saint Helena' },
  { code: 'KNA', name: 'Saint Kitts and Nevis' },
  { code: 'LCA', name: 'Saint Lucia' },
  { code: 'SXM', name: 'Sint Maarten' },
  { code: 'MAF', name: 'Saint Martin' },
  { code: 'SPM', name: 'Saint Pierre and Miquelon' },
  { code: 'VCT', name: 'Saint Vincent and the Grenadines' },
  { code: 'SDN', name: 'Sudan' },
  { code: 'SUR', name: 'Suriname' },
  { code: 'SJM', name: 'Svalbard and Jan Mayen' },
  { code: 'SWE', name: 'Sweden' },
  { code: 'CHE', name: 'Switzerland' },
  { code: 'SYR', name: 'Syria' },
  { code: 'TAH', name: 'Tahiti' },
  { code: 'TWN', name: 'Taiwan' },
  { code: 'TZA', name: 'Tanzania' },
  { code: 'THA', name: 'Thailand' },
  { code: 'TJK', name: 'Tajikistan' },
  { code: 'TGO', name: 'Togo' },
  { code: 'TKL', name: 'Tokelau' },
  { code: 'TON', name: 'Tonga' },
  { code: 'TTO', name: 'Trinidad and Tobago' },
  { code: 'TUN', name: 'Tunisia' },
  { code: 'TUR', name: 'Turkey' },
  { code: 'TKM', name: 'Turkmenistan' },
  { code: 'TCA', name: 'Turks and Caicos Islands' },
  { code: 'TUV', name: 'Tuvalu' },
  { code: 'SUN', name: 'Soviet Union' },
  { code: 'UGA', name: 'Uganda' },
  { code: 'UKR', name: 'Ukraine' },
  { code: 'ARE', name: 'United Arab Emirates' },
  { code: 'GBR', name: 'United Kingdom' },
  { code: 'USA', name: 'United States' },
  { code: 'UNK', name: 'Unknown' },
  { code: 'URY', name: 'Uruguay' },
  { code: 'UZB', name: 'Uzbekistan' },
  { code: 'VUT', name: 'Vanuatu' },
  { code: 'VAT', name: 'Vatican City' },
  { code: 'VEN', name: 'Venezuela' },
  { code: 'VNM', name: 'Vietnam' },
  { code: 'WLF', name: 'Wallis and Futuna' },
  { code: 'ESH', name: 'Western Sahara' },
  { code: 'YEM', name: 'Yemen' },
  { code: 'YUG', name: 'Yugoslavia' },
  { code: 'ZAR', name: 'Zaire' },
  { code: 'ZMB', name: 'Zambia' },
  { code: 'ZWE', name: 'Zimbabwe' },
];

/** Alphabetically sorted country list (all codes, incl. historical/registers).
 * Use SELECTABLE_COUNTRIES for dropdowns. */
export const SORTED_COUNTRIES: Country[] = [...COUNTRIES].sort((a, b) =>
  a.name.localeCompare(b.name),
);

/**
 * Codes kept in COUNTRIES for legacy/display resolution but NOT shown in
 * dropdowns: maritime/subnational registers (DIS/NIS/RIF/Azores/Canary Is./
 * Madeira/Tahiti), dissolved/historical states (Czechoslovakia, East Germany,
 * USSR, Yugoslavia, Zaire, Netherlands Antilles, Saudi-Iraqi Neutral Zone),
 * and Unknown. Stored data with these codes still resolves to a recognisable
 * name + flag, but users can no longer pick them for new entries.
 */
const NON_SELECTABLE_CODES = new Set([
  'DIS', 'NIS', 'RIF', 'AZO', 'CNI', 'PMD', 'TAH',
  'CSK', 'DDR', 'SUN', 'YUG', 'ZAR', 'ANT', 'NTZ', 'UNK',
]);

/** Selectable, alphabetically sorted countries for dropdowns / typeaheads. */
export const SELECTABLE_COUNTRIES: Country[] = [...COUNTRIES]
  .filter((c) => !NON_SELECTABLE_CODES.has(c.code))
  .sort((a, b) => a.name.localeCompare(b.name));

/** ISO-3 code → Country (uppercase keys). */
export const COUNTRIES_BY_CODE: ReadonlyMap<string, Country> = new Map(
  COUNTRIES.map((c) => [c.code.toUpperCase(), c]),
);

/** Lowercase canonical name → Country (for resolving stored free-text names). */
export const COUNTRIES_BY_NAME: ReadonlyMap<string, Country> = new Map(
  COUNTRIES.map((c) => [c.name.toLowerCase(), c]),
);

// Common alternative spellings / variants → canonical ISO-3 code. Add freely;
// this is what makes "same country spelled different ways" always resolve to
// one canonical name everywhere it is displayed.
const NAME_ALIASES: ReadonlyMap<string, string> = new Map<string, string>([
  // Turkey
  ['turkiye', 'TUR'], ['türkiye', 'TUR'], ['turkey (türkiye)', 'TUR'],
  // United States
  ['united states of america', 'USA'], ['usa', 'USA'], ['u.s.a.', 'USA'], ['us', 'USA'],
  // United Kingdom
  ['uk', 'GBR'], ['u.k.', 'GBR'], ['great britain', 'GBR'], ['britain', 'GBR'],
  // Korea
  ['korea, republic of', 'KOR'], ['republic of korea', 'KOR'], ['korea (south)', 'KOR'],
  ['korea (north)', 'PRK'], ["democratic people's republic of korea", 'PRK'],
  // Congo
  ['republic of the congo', 'COG'], ['congo (brazzaville)', 'COG'], ['congo, republic of the', 'COG'],
  ['democratic republic of the congo', 'COD'], ['congo (kinshasa)', 'COD'], ['congo, democratic republic of the', 'COD'], ['dr congo', 'COD'], ['drc', 'COD'], ['congo (drc)', 'COD'], ['congo, dr', 'COD'],
  // Czechia
  ['czechia', 'CZE'],
  // Cape Verde
  ['cabo verde', 'CPV'],
  // East Timor
  ['timor-leste', 'TLS'], ['timor leste', 'TLS'],
  // Myanmar
  ['burma', 'MMR'],
  // Eswatini
  ['swaziland', 'SWZ'],
  // North Macedonia
  ['macedonia', 'MKD'], ['fyrom', 'MKD'],
  // Ivory Coast
  ["côte d'ivoire", 'CIV'], ["cote d'ivoire", 'CIV'], ["ivory coast (côte d'ivoire)", 'CIV'],
  // Russia
  ['russian federation', 'RUS'],
  // Iran
  ['iran (islamic republic of)', 'IRN'],
  // Syria
  ['syrian arab republic', 'SYR'],
  // Tanzania
  ['united republic of tanzania', 'TZA'],
  // Venezuela
  ['venezuela (bolivarian republic of)', 'VEN'],
  // Bolivia
  ['bolivia (plurinational state of)', 'BOL'],
  // Vietnam
  ['viet nam', 'VNM'], ['socialist republic of viet nam', 'VNM'],
  // Laos
  ["lao people's democratic republic", 'LAO'],
  // Brunei
  ['brunei darussalam', 'BRN'],
  // Moldova
  ['republic of moldova', 'MDA'],
  // Palestine
  ['state of palestine', 'PSE'],
  // Micronesia
  ['micronesia (federated states of)', 'FSM'],
  // Sudan / South Sudan
  ['republic of sudan', 'SDN'],
  // Bahamas
  ['bahamas (commonwealth of the)', 'BHS'],
  // Netherlands
  ['the netherlands', 'NLD'], ['kingdom of the netherlands', 'NLD'],
  // Philippines
  ['republic of the philippines', 'PHL'],
  // Saudi-Iraqi Neutral Zone legacy spellings
  ['neutral zone', 'NTZ'], ['neutral zone (saudi arabia & iraq)', 'NTZ'], ['neutral zone (saudi arabia and iraq)', 'NTZ'],
  // USSR legacy
  ['u.s.s.r.', 'SUN'], ['union of soviet socialist republics', 'SUN'], ['soviet union (historical)', 'SUN'],
  // Historical
  ['east germany (gdr)', 'DDR'], ['german democratic republic', 'DDR'],
]);

const ISO3_RE = /^[A-Z]{3}$/;
const ISO2_RE = /^[A-Z]{2}$/;

/**
 * Resolve an arbitrary stored value to a Country.
 * Accepts an ISO-3 code, an ISO-2 code, or a country name (canonical or a
 * common variant). Returns null if nothing matches.
 */
export function findCountry(value: string | null | undefined): Country | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();

  // ISO-3 code
  if (ISO3_RE.test(upper)) {
    const byCode = COUNTRIES_BY_CODE.get(upper);
    if (byCode) return byCode;
  }
  // ISO-2 code (resolve via flag map path → need code lookup; map ISO-2 back)
  if (ISO2_RE.test(upper)) {
    const byIso2 = ISO2_TO_COUNTRY.get(upper);
    if (byIso2) return byIso2;
  }

  // Canonical name (case-insensitive)
  const lower = trimmed.toLowerCase();
  const byName = COUNTRIES_BY_NAME.get(lower);
  if (byName) return byName;

  // Alias
  const aliasCode = NAME_ALIASES.get(lower);
  if (aliasCode) return COUNTRIES_BY_CODE.get(aliasCode) ?? null;

  // Fuzzy: name starts-with / contains (handles "Republic of Singapore", etc.)
  for (const c of COUNTRIES) {
    if (c.name.toLowerCase() === lower) return c;
  }
  const startsWith = COUNTRIES.find((c) => c.name.toLowerCase().startsWith(lower));
  if (startsWith) return startsWith;

  return null;
}

/** ISO-2 code → Country, derived from the flag map (for ISO-2 resolution). */
const ISO2_TO_COUNTRY: ReadonlyMap<string, Country> = (() => {
  // Subnational/maritime register aliases map to a parent country's ISO-2; they
  // must NOT "own" that ISO-2 when resolving a bare 2-letter code (e.g. "DK"
  // should be Denmark, not the Danish International Register).
  const ISO2_ALIAS_CODES = new Set(['DIS', 'NIS', 'RIF', 'AZO', 'CNI', 'PMD', 'TAH']);
  const map = new Map<string, Country>();
  for (const c of COUNTRIES) {
    if (ISO2_ALIAS_CODES.has(c.code)) continue;
    const iso2 = iso3ToIso2(c.code);
    if (iso2 && !map.has(iso2)) map.set(iso2, c);
  }
  return map;
})();

// Re-export the flag helpers so callers can resolve a flag from any country
// value through this single module.
export { flagFromIso3, flagFromIso2 };

/**
 * Canonical display name for any stored country value.
 * Falls back to the raw value when it cannot be resolved (so we never show
 * nothing), which means legacy free-text still displays but NEW data always
 * resolves to the canonical name.
 */
export function countryLabel(value: string | null | undefined): string {
  if (!value) return '';
  const country = findCountry(value);
  return country?.name ?? value;
}

/**
 * Flag emoji for any stored country value (ISO-3 code, ISO-2 code, or name).
 * Returns '' for unknown / historical codes that have no flag.
 */
export function countryFlagFromValue(value: string | null | undefined): string {
  if (!value) return '';
  const country = findCountry(value);
  if (country) return flagFromIso3(country.code);
  // Last resort: maybe it's a raw ISO-2 or ISO-3 we don't have in the list.
  const upper = value.trim().toUpperCase();
  if (ISO2_RE.test(upper)) return flagFromIso2(upper);
  if (ISO3_RE.test(upper)) return flagFromIso3(upper);
  return '';
}

/**
 * Flag emoji for an ISO-3 code known to be in the list (fast path used by
 * components that already hold `countryIso`). Accepts ISO-3 or ISO-2 codes.
 */
export function countryFlagByIso3(iso3: string | null | undefined): string {
  if (!iso3) return '';
  const country = COUNTRIES_BY_CODE.get(iso3.toUpperCase());
  if (country) return flagFromIso3(country.code);
  return countryFlagFromValue(iso3);
}

/**
 * Canonical display name for an ISO-3 code (fast path). Accepts ISO-3 or
 * ISO-2 codes. Falls back to the raw value when unknown so the UI never goes
 * blank.
 */
export function countryNameByIso3(iso3: string | null | undefined): string {
  if (!iso3) return '';
  const country = COUNTRIES_BY_CODE.get(iso3.toUpperCase());
  if (country) return country.name;
  const found = findCountry(iso3);
  return found ? found.name : iso3;
}