import { COUNTRIES } from './countries';

export interface FiatCurrencyMeta {
  code: string;
  symbol: string;
  name: string;
  region: string;
  referenceRatePerUsdt: number;
  decimals: number;
}

const FEATURED_CURRENCIES: FiatCurrencyMeta[] = [
  { code: 'BDT', symbol: '', name: 'Bangladeshi Taka', region: 'Bangladesh', referenceRatePerUsdt: 122.5, decimals: 2 },
  { code: 'USD', symbol: '$', name: 'US Dollar', region: 'United States', referenceRatePerUsdt: 1.0, decimals: 3 },
  { code: 'EUR', symbol: '€', name: 'Euro', region: 'Europe (EU)', referenceRatePerUsdt: 0.93, decimals: 3 },
  { code: 'GBP', symbol: '£', name: 'British Pound', region: 'United Kingdom', referenceRatePerUsdt: 0.79, decimals: 3 },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', region: 'United Arab Emirates', referenceRatePerUsdt: 3.67, decimals: 3 },
  { code: 'SAR', symbol: '﷼', name: 'Saudi Riyal', region: 'Saudi Arabia', referenceRatePerUsdt: 3.75, decimals: 3 },
  { code: 'QAR', symbol: 'ر.ق', name: 'Qatari Riyal', region: 'Qatar', referenceRatePerUsdt: 3.64, decimals: 3 },
  { code: 'KWD', symbol: 'د.ك', name: 'Kuwaiti Dinar', region: 'Kuwait', referenceRatePerUsdt: 0.307, decimals: 3 },
  { code: 'OMR', symbol: 'ر.ع.', name: 'Omani Rial', region: 'Oman', referenceRatePerUsdt: 0.385, decimals: 3 },
  { code: 'BHD', symbol: 'د.ب', name: 'Bahraini Dinar', region: 'Bahrain', referenceRatePerUsdt: 0.376, decimals: 3 },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit', region: 'Malaysia', referenceRatePerUsdt: 4.45, decimals: 3 },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', region: 'Singapore', referenceRatePerUsdt: 1.34, decimals: 3 },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', region: 'Canada', referenceRatePerUsdt: 1.39, decimals: 3 },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', region: 'Australia', referenceRatePerUsdt: 1.53, decimals: 3 },
  { code: 'CHF', symbol: 'CHF ', name: 'Swiss Franc', region: 'Switzerland', referenceRatePerUsdt: 0.88, decimals: 3 },
  { code: 'TRY', symbol: '₺', name: 'Turkish Lira', region: 'Turkey', referenceRatePerUsdt: 34.2, decimals: 2 },
];

const EXTRA_CURRENCY_SPECS: Record<
  string,
  { symbol: string; name: string; referenceRatePerUsdt: number; decimals?: number }
> = {
  AFN: { symbol: '؋', name: 'Afghan Afghani', referenceRatePerUsdt: 70.5, decimals: 2 },
  ALL: { symbol: 'L', name: 'Albanian Lek', referenceRatePerUsdt: 92.4, decimals: 2 },
  AMD: { symbol: '֏', name: 'Armenian Dram', referenceRatePerUsdt: 387.5, decimals: 2 },
  AOA: { symbol: 'Kz', name: 'Angolan Kwanza', referenceRatePerUsdt: 912.0, decimals: 2 },
  ARS: { symbol: 'AR$', name: 'Argentine Peso', referenceRatePerUsdt: 995.0, decimals: 2 },
  AZN: { symbol: '₼', name: 'Azerbaijani Manat', referenceRatePerUsdt: 1.7, decimals: 2 },
  BAM: { symbol: 'KM', name: 'Bosnia-Herzegovina Mark', referenceRatePerUsdt: 1.82, decimals: 2 },
  BBD: { symbol: 'Bds$', name: 'Barbadian Dollar', referenceRatePerUsdt: 2.0, decimals: 2 },
  BIF: { symbol: 'FBu', name: 'Burundian Franc', referenceRatePerUsdt: 2920.0, decimals: 0 },
  BND: { symbol: 'B$', name: 'Brunei Dollar', referenceRatePerUsdt: 1.34, decimals: 2 },
  BOB: { symbol: 'Bs', name: 'Bolivian Boliviano', referenceRatePerUsdt: 6.91, decimals: 2 },
  BRL: { symbol: 'R$', name: 'Brazilian Real', referenceRatePerUsdt: 5.75, decimals: 2 },
  BSD: { symbol: 'B$', name: 'Bahamian Dollar', referenceRatePerUsdt: 1.0, decimals: 2 },
  BTN: { symbol: 'Nu.', name: 'Bhutanese Ngultrum', referenceRatePerUsdt: 84.4, decimals: 2 },
  BWP: { symbol: 'P', name: 'Botswanan Pula', referenceRatePerUsdt: 13.5, decimals: 2 },
  BYN: { symbol: 'Br', name: 'Belarusian Ruble', referenceRatePerUsdt: 3.27, decimals: 2 },
  BZD: { symbol: 'BZ$', name: 'Belize Dollar', referenceRatePerUsdt: 2.0, decimals: 2 },
  CDF: { symbol: 'FC', name: 'Congolese Franc', referenceRatePerUsdt: 2845.0, decimals: 2 },
  CLP: { symbol: 'CLP$', name: 'Chilean Peso', referenceRatePerUsdt: 965.0, decimals: 0 },
  CNY: { symbol: '¥', name: 'Chinese Yuan', referenceRatePerUsdt: 7.24, decimals: 2 },
  COP: { symbol: 'COL$', name: 'Colombian Peso', referenceRatePerUsdt: 4380.0, decimals: 2 },
  CRC: { symbol: '₡', name: 'Costa Rican Colón', referenceRatePerUsdt: 512.0, decimals: 2 },
  CUP: { symbol: '₱', name: 'Cuban Peso', referenceRatePerUsdt: 24.0, decimals: 2 },
  CVE: { symbol: '$', name: 'Cape Verdean Escudo', referenceRatePerUsdt: 102.5, decimals: 2 },
  CZK: { symbol: 'Kč', name: 'Czech Koruna', referenceRatePerUsdt: 23.6, decimals: 2 },
  DJF: { symbol: 'Fdj', name: 'Djiboutian Franc', referenceRatePerUsdt: 177.7, decimals: 0 },
  DKK: { symbol: 'kr', name: 'Danish Krone', referenceRatePerUsdt: 6.94, decimals: 2 },
  DOP: { symbol: 'RD$', name: 'Dominican Peso', referenceRatePerUsdt: 60.2, decimals: 2 },
  DZD: { symbol: 'د.ج', name: 'Algerian Dinar', referenceRatePerUsdt: 133.8, decimals: 2 },
  EGP: { symbol: 'E£', name: 'Egyptian Pound', referenceRatePerUsdt: 49.4, decimals: 2 },
  ERN: { symbol: 'Nfk', name: 'Eritrean Nakfa', referenceRatePerUsdt: 15.0, decimals: 2 },
  ETB: { symbol: 'Br', name: 'Ethiopian Birr', referenceRatePerUsdt: 122.5, decimals: 2 },
  FJD: { symbol: 'FJ$', name: 'Fijian Dollar', referenceRatePerUsdt: 2.26, decimals: 2 },
  GEL: { symbol: '₾', name: 'Georgian Lari', referenceRatePerUsdt: 2.72, decimals: 2 },
  GHS: { symbol: '₵', name: 'Ghanaian Cedi', referenceRatePerUsdt: 15.8, decimals: 2 },
  GMD: { symbol: 'D', name: 'Gambian Dalasi', referenceRatePerUsdt: 70.5, decimals: 2 },
  GNF: { symbol: 'FG', name: 'Guinean Franc', referenceRatePerUsdt: 8620.0, decimals: 0 },
  GTQ: { symbol: 'Q', name: 'Guatemalan Quetzal', referenceRatePerUsdt: 7.72, decimals: 2 },
  GYD: { symbol: 'G$', name: 'Guyanaese Dollar', referenceRatePerUsdt: 209.0, decimals: 2 },
  HKD: { symbol: 'HK$', name: 'Hong Kong Dollar', referenceRatePerUsdt: 7.78, decimals: 2 },
  HNL: { symbol: 'L', name: 'Honduran Lempira', referenceRatePerUsdt: 25.1, decimals: 2 },
  HTG: { symbol: 'G', name: 'Haitian Gourde', referenceRatePerUsdt: 131.5, decimals: 2 },
  HUF: { symbol: 'Ft', name: 'Hungarian Forint', referenceRatePerUsdt: 382.0, decimals: 2 },
  IDR: { symbol: 'Rp', name: 'Indonesian Rupiah', referenceRatePerUsdt: 15850.0, decimals: 0 },
  ILS: { symbol: '₪', name: 'Israeli New Shekel', referenceRatePerUsdt: 3.74, decimals: 2 },
  INR: { symbol: '₹', name: 'Indian Rupee', referenceRatePerUsdt: 84.4, decimals: 2 },
  IQD: { symbol: 'ع.د', name: 'Iraqi Dinar', referenceRatePerUsdt: 1310.0, decimals: 0 },
  IRR: { symbol: '﷼', name: 'Iranian Rial', referenceRatePerUsdt: 42100.0, decimals: 0 },
  ISK: { symbol: 'kr', name: 'Icelandic Króna', referenceRatePerUsdt: 138.0, decimals: 0 },
  JMD: { symbol: 'J$', name: 'Jamaican Dollar', referenceRatePerUsdt: 157.5, decimals: 2 },
  JOD: { symbol: 'JD', name: 'Jordanian Dinar', referenceRatePerUsdt: 0.709, decimals: 3 },
  JPY: { symbol: '¥', name: 'Japanese Yen', referenceRatePerUsdt: 154.2, decimals: 0 },
  KES: { symbol: 'KSh', name: 'Kenyan Shilling', referenceRatePerUsdt: 129.0, decimals: 2 },
  KGS: { symbol: 'с', name: 'Kyrgyz Som', referenceRatePerUsdt: 86.2, decimals: 2 },
  KHR: { symbol: '៛', name: 'Cambodian Riel', referenceRatePerUsdt: 4055.0, decimals: 2 },
  KMF: { symbol: 'CF', name: 'Comorian Franc', referenceRatePerUsdt: 457.0, decimals: 0 },
  KPW: { symbol: '₩', name: 'North Korean Won', referenceRatePerUsdt: 900.0, decimals: 0 },
  KRW: { symbol: '₩', name: 'South Korean Won', referenceRatePerUsdt: 1395.0, decimals: 0 },
  KZT: { symbol: '₸', name: 'Kazakhstani Tenge', referenceRatePerUsdt: 492.0, decimals: 2 },
  LAK: { symbol: '₭', name: 'Laotian Kip', referenceRatePerUsdt: 21900.0, decimals: 0 },
  LBP: { symbol: 'ل.ل', name: 'Lebanese Pound', referenceRatePerUsdt: 89500.0, decimals: 0 },
  LKR: { symbol: 'Rs', name: 'Sri Lankan Rupee', referenceRatePerUsdt: 293.0, decimals: 2 },
  LRD: { symbol: 'L$', name: 'Liberian Dollar', referenceRatePerUsdt: 192.0, decimals: 2 },
  LSL: { symbol: 'L', name: 'Lesotho Loti', referenceRatePerUsdt: 18.1, decimals: 2 },
  LYD: { symbol: 'ل.د', name: 'Libyan Dinar', referenceRatePerUsdt: 4.86, decimals: 3 },
  MAD: { symbol: 'د.م.', name: 'Moroccan Dirham', referenceRatePerUsdt: 9.95, decimals: 2 },
  MDL: { symbol: 'L', name: 'Moldovan Leu', referenceRatePerUsdt: 18.0, decimals: 2 },
  MGA: { symbol: 'Ar', name: 'Malagasy Ariary', referenceRatePerUsdt: 4620.0, decimals: 0 },
  MKD: { symbol: 'ден', name: 'Macedonian Denar', referenceRatePerUsdt: 57.2, decimals: 2 },
  MMK: { symbol: 'K', name: 'Myanmar Kyat', referenceRatePerUsdt: 2100.0, decimals: 2 },
  MNT: { symbol: '₮', name: 'Mongolian Tugrik', referenceRatePerUsdt: 3410.0, decimals: 2 },
  MRU: { symbol: 'UM', name: 'Mauritanian Ouguiya', referenceRatePerUsdt: 39.7, decimals: 2 },
  MUR: { symbol: '₨', name: 'Mauritian Rupee', referenceRatePerUsdt: 46.5, decimals: 2 },
  MVR: { symbol: 'Rf', name: 'Maldivian Rufiyaa', referenceRatePerUsdt: 15.4, decimals: 2 },
  MWK: { symbol: 'MK', name: 'Malawian Kwacha', referenceRatePerUsdt: 1735.0, decimals: 2 },
  MXN: { symbol: 'MX$', name: 'Mexican Peso', referenceRatePerUsdt: 20.2, decimals: 2 },
  MZN: { symbol: 'MT', name: 'Mozambican Metical', referenceRatePerUsdt: 63.9, decimals: 2 },
  NAD: { symbol: 'N$', name: 'Namibian Dollar', referenceRatePerUsdt: 18.1, decimals: 2 },
  NGN: { symbol: '₦', name: 'Nigerian Naira', referenceRatePerUsdt: 1650.0, decimals: 2 },
  NIO: { symbol: 'C$', name: 'Nicaraguan Córdoba', referenceRatePerUsdt: 36.8, decimals: 2 },
  NOK: { symbol: 'kr', name: 'Norwegian Krone', referenceRatePerUsdt: 11.0, decimals: 2 },
  NPR: { symbol: 'रू', name: 'Nepalese Rupee', referenceRatePerUsdt: 135.0, decimals: 2 },
  NZD: { symbol: 'NZ$', name: 'New Zealand Dollar', referenceRatePerUsdt: 1.69, decimals: 2 },
  PAB: { symbol: 'B/.', name: 'Panamanian Balboa', referenceRatePerUsdt: 1.0, decimals: 2 },
  PGK: { symbol: 'K', name: 'Papua New Guinean Kina', referenceRatePerUsdt: 3.98, decimals: 2 },
  PEN: { symbol: 'S/', name: 'Peruvian Sol', referenceRatePerUsdt: 3.78, decimals: 2 },
  PHP: { symbol: '₱', name: 'Philippine Peso', referenceRatePerUsdt: 58.6, decimals: 2 },
  PKR: { symbol: '₨', name: 'Pakistani Rupee', referenceRatePerUsdt: 278.5, decimals: 2 },
  PLN: { symbol: 'zł', name: 'Polish Zloty', referenceRatePerUsdt: 4.08, decimals: 2 },
  PYG: { symbol: '₲', name: 'Paraguayan Guarani', referenceRatePerUsdt: 7810.0, decimals: 0 },
  RON: { symbol: 'lei', name: 'Romanian Leu', referenceRatePerUsdt: 4.62, decimals: 2 },
  RSD: { symbol: 'din', name: 'Serbian Dinar', referenceRatePerUsdt: 108.8, decimals: 2 },
  RUB: { symbol: '₽', name: 'Russian Ruble', referenceRatePerUsdt: 99.5, decimals: 2 },
  RWF: { symbol: 'RF', name: 'Rwandan Franc', referenceRatePerUsdt: 1365.0, decimals: 0 },
  SBD: { symbol: 'SI$', name: 'Solomon Islands Dollar', referenceRatePerUsdt: 8.45, decimals: 2 },
  SCR: { symbol: '₨', name: 'Seychellois Rupee', referenceRatePerUsdt: 13.7, decimals: 2 },
  SDG: { symbol: 'ج.س.', name: 'Sudanese Pound', referenceRatePerUsdt: 601.5, decimals: 2 },
  SEK: { symbol: 'kr', name: 'Swedish Krona', referenceRatePerUsdt: 10.85, decimals: 2 },
  SLE: { symbol: 'Le', name: 'Sierra Leonean Leone', referenceRatePerUsdt: 22.6, decimals: 2 },
  SOS: { symbol: 'Sh', name: 'Somali Shilling', referenceRatePerUsdt: 571.0, decimals: 2 },
  SRD: { symbol: '$', name: 'Surinamese Dollar', referenceRatePerUsdt: 35.4, decimals: 2 },
  SSP: { symbol: 'SSP', name: 'South Sudanese Pound', referenceRatePerUsdt: 3450.0, decimals: 2 },
  STN: { symbol: 'Db', name: 'São Tomé Dobra', referenceRatePerUsdt: 22.8, decimals: 2 },
  SYP: { symbol: '£S', name: 'Syrian Pound', referenceRatePerUsdt: 13000.0, decimals: 2 },
  SZL: { symbol: 'E', name: 'Swazi Lilangeni', referenceRatePerUsdt: 18.1, decimals: 2 },
  THB: { symbol: '฿', name: 'Thai Baht', referenceRatePerUsdt: 34.6, decimals: 2 },
  TJS: { symbol: 'ЅМ', name: 'Tajikistani Somoni', referenceRatePerUsdt: 10.65, decimals: 2 },
  TMT: { symbol: 'm', name: 'Turkmenistani Manat', referenceRatePerUsdt: 3.5, decimals: 2 },
  TND: { symbol: 'د.ت', name: 'Tunisian Dinar', referenceRatePerUsdt: 3.13, decimals: 3 },
  TOP: { symbol: 'T$', name: 'Tongan Paʻanga', referenceRatePerUsdt: 2.37, decimals: 2 },
  TTD: { symbol: 'TT$', name: 'Trinidad & Tobago Dollar', referenceRatePerUsdt: 6.78, decimals: 2 },
  TWD: { symbol: 'NT$', name: 'New Taiwan Dollar', referenceRatePerUsdt: 32.4, decimals: 2 },
  TZS: { symbol: 'TSh', name: 'Tanzanian Shilling', referenceRatePerUsdt: 2685.0, decimals: 2 },
  UAH: { symbol: '₴', name: 'Ukrainian Hryvnia', referenceRatePerUsdt: 41.3, decimals: 2 },
  UGX: { symbol: 'USh', name: 'Ugandan Shilling', referenceRatePerUsdt: 3675.0, decimals: 0 },
  UYU: { symbol: '$U', name: 'Uruguayan Peso', referenceRatePerUsdt: 42.1, decimals: 2 },
  UZS: { symbol: 'soʻm', name: 'Uzbekistani Som', referenceRatePerUsdt: 12800.0, decimals: 2 },
  VES: { symbol: 'Bs.S', name: 'Venezuelan Bolívar', referenceRatePerUsdt: 45.2, decimals: 2 },
  VND: { symbol: '₫', name: 'Vietnamese Dong', referenceRatePerUsdt: 25400.0, decimals: 0 },
  VUV: { symbol: 'VT', name: 'Vanuatu Vatu', referenceRatePerUsdt: 119.5, decimals: 0 },
  WST: { symbol: 'WS$', name: 'Samoan Tala', referenceRatePerUsdt: 2.75, decimals: 2 },
  XAF: { symbol: 'FCFA', name: 'Central African CFA Franc', referenceRatePerUsdt: 610.0, decimals: 0 },
  XCD: { symbol: 'EC$', name: 'East Caribbean Dollar', referenceRatePerUsdt: 2.7, decimals: 2 },
  XOF: { symbol: 'CFA', name: 'West African CFA Franc', referenceRatePerUsdt: 610.0, decimals: 0 },
  YER: { symbol: '﷼', name: 'Yemeni Rial', referenceRatePerUsdt: 250.0, decimals: 2 },
  ZAR: { symbol: 'R', name: 'South African Rand', referenceRatePerUsdt: 18.1, decimals: 2 },
  ZMW: { symbol: 'ZK', name: 'Zambian Kwacha', referenceRatePerUsdt: 27.2, decimals: 2 },
  ZWG: { symbol: 'ZiG', name: 'Zimbabwean Gold', referenceRatePerUsdt: 25.4, decimals: 2 },
};

const countryRegionsByCurrency = new Map<string, string[]>();
for (const country of COUNTRIES) {
  const list = countryRegionsByCurrency.get(country.shortCode) || [];
  list.push(country.name);
  countryRegionsByCurrency.set(country.shortCode, list);
}

const formatRegionLabel = (code: string): string => {
  const countries = countryRegionsByCurrency.get(code) || [];
  if (countries.length === 0) return code;
  if (countries.length === 1) return countries[0];
  if (countries.length === 2) return `${countries[0]} & ${countries[1]}`;
  return `${countries[0]} (+${countries.length - 1} countries)`;
};

const featuredCodes = new Set(FEATURED_CURRENCIES.map((c) => c.code));
const remainingCodes = [...countryRegionsByCurrency.keys()]
  .filter((code) => !featuredCodes.has(code))
  .sort((a, b) => a.localeCompare(b));

const ALL_COUNTRY_CURRENCIES: FiatCurrencyMeta[] = remainingCodes.map((code) => {
  const spec = EXTRA_CURRENCY_SPECS[code];
  const rate = spec?.referenceRatePerUsdt ?? 1.0;
  return {
    code,
    symbol: spec?.symbol ?? code,
    name: spec?.name ?? code,
    region: formatRegionLabel(code),
    referenceRatePerUsdt: rate,
    decimals: spec?.decimals ?? (rate < 10 ? 3 : 2),
  };
});

export const SUPPORTED_FIAT_CURRENCIES: FiatCurrencyMeta[] = [
  ...FEATURED_CURRENCIES,
  ...ALL_COUNTRY_CURRENCIES,
];

export const SUPPORTED_FIAT_CODES = SUPPORTED_FIAT_CURRENCIES.map((c) => c.code);

export function getCurrencyCountries(code?: string | null): string[] {
  const upper = String(code || '').toUpperCase();
  return countryRegionsByCurrency.get(upper) || [];
}

const CURRENCY_MAP = new Map<string, FiatCurrencyMeta>(
  SUPPORTED_FIAT_CURRENCIES.map((c) => [c.code, c])
);

export function getCurrencyMeta(code?: string | null): FiatCurrencyMeta {
  const upper = String(code || 'USD').toUpperCase();
  return CURRENCY_MAP.get(upper) || CURRENCY_MAP.get('USD')!;
}

export function formatFiatRate(rate: number, code?: string | null): string {
  const meta = getCurrencyMeta(code);
  const decimals = rate >= 10 ? (meta.decimals === 0 ? 0 : 2) : meta.decimals;
  return Number(rate || 0).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatFiatAmount(amount: number, code?: string | null): string {
  const meta = getCurrencyMeta(code);
  const dec = meta.decimals === 0 ? 0 : 2;
  const sym = meta.symbol.trim();
  const formatted = Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
  return sym ? `${sym} ${formatted}`.replace(/^([\$€£₹¥₩₦₫₱฿₴₪])\s+/, '$1') : formatted;
}
