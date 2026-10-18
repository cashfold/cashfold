// Vendored ISO 4217 minor-unit exponents (0..8) plus supported crypto assets (FR-038).
// Codes whose ISO exponent is 2 are listed compactly below; the exceptions are explicit.

const ZERO = 'BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF';
const THREE = 'BHD IQD JOD KWD LYD OMR TND';
const FOUR = 'CLF UYW';
const EIGHT = 'BTC';
const TWO =
  'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CNY COP ' +
  'CRC CUP CVE CZK DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GTQ GYD HKD HNL HTG HUF IDR ILS INR IRR ' +
  'JMD KES KGS KHR KPW KYD KZT LAK LBP LKR LRD LSL MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN ' +
  'NIO NOK NPR NZD PAB PEN PGK PHP PKR PLN QAR RON RSD RUB SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP ' +
  'SZL THB TJS TMT TOP TRY TTD TWD TZS UAH USD UZS VES WST XCD YER ZAR ZMW ZWG';

function build(): Readonly<Record<string, number>> {
  const table: Record<string, number> = {};
  const groups: ReadonlyArray<readonly [string, number]> = [
    [ZERO, 0],
    [TWO, 2],
    [THREE, 3],
    [FOUR, 4],
    [EIGHT, 8],
  ];
  for (const [codes, exponent] of groups) {
    for (const code of codes.split(' ')) {
      if (code in table) throw new Error(`duplicate currency ${code}`);
      table[code] = exponent;
    }
  }
  return Object.freeze(table);
}

export const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = build();
