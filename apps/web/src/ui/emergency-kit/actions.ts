import type { KitDetails, KitLanguage } from './kit';

export type KitSource = Omit<KitDetails, 'generatedOn'>;

// The kit module carries the QR generator, which is the largest single piece of the interface, so it is loaded when a kit is made, not with the
// screens that offer it (five of them, each of which would otherwise get its own copy).
const html = async (kit: KitSource, language: KitLanguage): Promise<string> => {
  const { buildEmergencyKitHtml } = await import('./kit');
  return buildEmergencyKitHtml({ ...kit, generatedOn: new Date().toISOString().slice(0, 10) }, location.origin, language);
};

/** Saves the kit, in the current language, as a self-contained HTML file. */
export function downloadKit(kit: KitSource, language: KitLanguage): void {
  void html(kit, language).then((page) => {
    const url = URL.createObjectURL(new Blob([page], { type: 'text/html' }));
    Object.assign(document.createElement('a'), { href: url, download: 'cashfold-emergency-kit.html' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

/** Prints the kit from a hidden frame, so nothing is opened in a new window. */
export function printKit(kit: KitSource, language: KitLanguage): void {
  void html(kit, language).then((page) => {
    const frame = Object.assign(document.createElement('iframe'), { hidden: true, srcdoc: page });
    frame.onload = () => {
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 1000);
    };
    document.body.append(frame);
  });
}
