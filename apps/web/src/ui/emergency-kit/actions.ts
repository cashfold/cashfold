import { buildEmergencyKitHtml, type KitDetails } from './kit';

export type KitSource = Omit<KitDetails, 'generatedOn'>;

const html = (kit: KitSource) => buildEmergencyKitHtml({ ...kit, generatedOn: new Date().toISOString().slice(0, 10) }, location.origin);

/** Saves the kit as a self-contained HTML file. */
export function downloadKit(kit: KitSource): void {
  const url = URL.createObjectURL(new Blob([html(kit)], { type: 'text/html' }));
  Object.assign(document.createElement('a'), { href: url, download: 'cashfold-emergency-kit.html' }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Prints the kit from a hidden frame, so nothing is opened in a new window. */
export function printKit(kit: KitSource): void {
  const frame = Object.assign(document.createElement('iframe'), { hidden: true, srcdoc: html(kit) });
  frame.onload = () => {
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  };
  document.body.append(frame);
}
