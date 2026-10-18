// Web-standard text codecs exist in every runtime core runs in (browsers, workers, Node) but not in the lib set core
// is compiled with on purpose (no DOM). Only these two are declared.
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: Uint8Array): string;
}
