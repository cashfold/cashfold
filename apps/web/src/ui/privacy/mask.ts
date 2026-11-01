// What a masked amount looks like (spec 018, contracts/ui-contract.md §1): the real amount's text with every digit a zero, blurred. The sign, the language's
// marks, the number of decimals and the currency code stay, so the figure keeps the shape it has when it is shown. The digits are never real: this is a
// string replace on text already formatted, never a parse of the number.

/** Every digit becomes "0"; nothing else changes ("−1,234.56" → "−0,000.00"). */
export const zeroed = (text: string): string => text.replace(/\d/g, '0');

/** "−0,000.00 USD", for the places that can only hold plain text: pass the formatted money (with its currency code). */
export const maskedMoney = (formatted: string): string => zeroed(formatted);

/**
 * How the zeros are drawn: as generated content from the `data-zeros` attribute, blurred, so they read as a hidden figure and not as a balance of nothing.
 * The blur is a fraction of the text size (0.4em), so it hides large figures as well as small ones. They are not a text node, so the zeros are not in the page text for a reader, a copy or a search to find, and the visible text matches the button's name
 * (WCAG 2.5.3). A class, because the strict CSP forbids inline styles.
 */
export const MASK_FIGURE_CLASS = 'inline-block blur-[0.4em] select-none before:content-[attr(data-zeros)]';
