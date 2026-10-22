// Keeps the interface on its component kit (R-UX-03, contracts/ui-kit.md §6). Three rules, applied by eslint.config.js to apps/web/src/ui
// outside apps/web/src/ui/kit:
//  - no-headless-outside-kit: Headless UI is imported only by the kit, so it can be swapped by changing one directory;
//  - no-raw-controls: screens use the kit's Button, Input, Select and Textarea, not the bare elements (file and hidden inputs are allowed);
//  - no-name-on-headless: a `name` prop on a Headless-based control makes Headless UI render a hidden input, which breaks the strict
//    Content-Security-Policy and the Trusted Types rules; state is held in React and submitted by the screen.

const HEADLESS = '@headlessui/react';
const RAW = new Set(['button', 'input', 'select', 'textarea']);
const NAME_FORBIDDEN = new Set(['Switch', 'Checkbox', 'Radio', 'Listbox', 'Combobox']);
const ALLOWED_INPUT_TYPES = new Set(['file', 'hidden']);

const isHeadless = (source) => typeof source === 'string' && (source === HEADLESS || source.startsWith(`${HEADLESS}/`));

/** @type {import('eslint').Rule.RuleModule} */
const noHeadlessOutsideKit = {
  meta: {
    type: 'problem',
    docs: { description: 'Import Headless UI only inside apps/web/src/ui/kit' },
    schema: [],
    messages: { headless: 'Import from the kit (`@/ui/kit`), not from Headless UI: only apps/web/src/ui/kit may depend on it.' },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (isHeadless(node.source.value)) context.report({ node, messageId: 'headless' });
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal' && isHeadless(node.source.value)) context.report({ node, messageId: 'headless' });
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments[0]?.type === 'Literal' && isHeadless(node.arguments[0].value)) {
          context.report({ node, messageId: 'headless' });
        }
      },
    };
  },
};

/** @type {import('eslint').Rule.RuleModule} */
const noRawControls = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Use the kit controls instead of bare <button>, <input>, <select> and <textarea>' },
    schema: [],
    messages: { raw: 'Use the kit component instead of a bare <{{tag}}> (file and hidden inputs are the only exceptions).' },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier' || !RAW.has(node.name.name)) return;
        const tag = node.name.name;
        if (tag === 'input') {
          const type = node.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === 'type');
          if (type?.value?.type === 'Literal' && ALLOWED_INPUT_TYPES.has(String(type.value.value))) return;
        }
        context.report({ node, messageId: 'raw', data: { tag } });
      },
    };
  },
};

/** @type {import('eslint').Rule.RuleModule} */
const noNameOnHeadless = {
  meta: {
    type: 'problem',
    docs: { description: 'Do not pass `name` to Headless-based kit controls (it renders a hidden input)' },
    schema: [],
    messages: { name: '`name` on <{{tag}}> makes Headless UI render a hidden input; keep the value in React state instead.' },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier' || !NAME_FORBIDDEN.has(node.name.name)) return;
        if (node.attributes.some((a) => a.type === 'JSXAttribute' && a.name.name === 'name')) context.report({ node, messageId: 'name', data: { tag: node.name.name } });
      },
    };
  },
};

export default { 'no-headless-outside-kit': noHeadlessOutsideKit, 'no-raw-controls': noRawControls, 'no-name-on-headless': noNameOnHeadless };
