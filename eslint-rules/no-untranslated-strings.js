// Keeps the interface text in the message catalogues (docs/i18n.md): a person sees every word in their own language, and a word typed straight
// into a component stays English. e2e/pseudo-walk.spec.ts already fails on such a word, but only after a full build and a walk through the
// screens; this rule says so while the file is open.
//
// What it reports, in files of the interface (see eslint.config.js):
//  - JSX text that looks like words: `<p>Save your changes</p>`, and the same text inside `{'...'}`;
//  - a string literal given to an attribute that a person reads or a screen reader speaks: aria-label, title, placeholder, alt, label,
//    description and a few like them.
// It is a heuristic, not a translator: it cannot tell English from another language, and it looks only for words of three or more letters with a
// lowercase letter in them. Acronyms (USD, CSV), numbers and punctuation pass. A text that is not interface text (a brand, a key name) goes in
// the `allow` option.

/** A word of three or more letters that is not all capitals: "Save" and "offline" count, "USD" and "OK" do not. */
const WORD = /\p{L}{3,}/gu;

/** An address is an example for the person to follow, not a sentence to translate: `https://relay.example.com`, `name@example.com`. */
const ADDRESS = /^(?:[a-z][a-z0-9+.-]*:\/\/\S*|\S+@\S+\.\S+)$/i;

export function looksLikeWords(text, allow = new Set()) {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed === '' || allow.has(trimmed) || ADDRESS.test(trimmed)) return false;
  return [...trimmed.matchAll(WORD)].some((match) => /\p{Ll}/u.test(match[0]));
}

/** Attributes whose value a person reads or hears. A `className` or an `id` is not in this list on purpose. */
const TEXT_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'aria-placeholder',
  'title',
  'placeholder',
  'alt',
  'label',
  'description',
  'caption',
  'heading',
]);

/** The text of a string literal or of a template literal without expressions; undefined for anything computed. */
function staticText(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis.map((q) => q.value.cooked ?? '').join('');
  return undefined;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Interface text comes from the message catalogues, not from the component' },
    schema: [{ type: 'object', properties: { allow: { type: 'array', items: { type: 'string' } } }, additionalProperties: false }],
    messages: {
      text: 'Text "{{text}}" is written in the component. Put it in the message catalogues (en, uk and pl) and show it with t().',
      attribute: '`{{name}}="{{text}}"` is written in the component. Put it in the message catalogues (en, uk and pl) and show it with t().',
    },
  },
  create(context) {
    const allow = new Set(context.options[0]?.allow ?? []);
    const shorten = (text) => (text.length > 40 ? `${text.slice(0, 37).trim()}...` : text.trim());
    return {
      JSXText(node) {
        if (looksLikeWords(node.value, allow)) context.report({ node, messageId: 'text', data: { text: shorten(node.value.replace(/\s+/g, ' ')) } });
      },
      // {'Save'} as a child: the same as typing it.
      JSXExpressionContainer(node) {
        if (node.parent.type === 'JSXAttribute') return;
        const text = staticText(node.expression);
        if (text !== undefined && looksLikeWords(text, allow)) context.report({ node, messageId: 'text', data: { text: shorten(text) } });
      },
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || !TEXT_ATTRIBUTES.has(node.name.name) || node.value === null) return;
        const value = node.value.type === 'JSXExpressionContainer' ? node.value.expression : node.value;
        const text = staticText(value);
        if (text !== undefined && looksLikeWords(text, allow)) context.report({ node, messageId: 'attribute', data: { name: node.name.name, text: shorten(text) } });
      },
    };
  },
};
