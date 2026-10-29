import qrcode from 'qrcode-generator';

// The QR generator is the largest single piece of the Emergency Kit. It lives apart so that the pages that only draw a QR code, or only copy text,
// do not carry it, and so it is loaded on demand.

export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}
