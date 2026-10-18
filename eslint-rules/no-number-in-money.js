// Bans floating-point arithmetic and `number`-typed values that carry money.
// Counts, indices and durations stay allowed: only identifiers/types whose names
// suggest money (amount, balance, rate, total, minor) are checked.
const MONEY_NAME = /(amount|balance|rate|total|minor)/i;
const BANNED_MATH = 'Math';

function isMoneyName(name) {
  return typeof name === 'string' && MONEY_NAME.test(name);
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow number/floating point in money paths (Constitution VI, FR-037)' },
    schema: [],
    messages: {
      floatLiteral: 'Floating-point literal {{raw}} is not allowed in money code; use bigint.',
      parseFloat: 'parseFloat is not allowed in money code; use exact decimal parsing.',
      math: 'Math.* is not allowed in money code; use bigint arithmetic.',
      moneyNumber: '`{{name}}` carries money and must be bigint/Money, not number.',
    },
  },
  create(context) {
    /** @param {any} node */
    function isNumberAnnotation(annotation) {
      return annotation?.typeAnnotation?.type === 'TSNumberKeyword';
    }
    return {
      Literal(node) {
        if (typeof node.value === 'number' && !Number.isInteger(node.value)) {
          context.report({ node, messageId: 'floatLiteral', data: { raw: node.raw } });
        } else if (typeof node.value === 'number' && /[.eE]/.test(node.raw) && !/^0[xXbBoO]/.test(node.raw)) {
          context.report({ node, messageId: 'floatLiteral', data: { raw: node.raw } });
        }
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'parseFloat') {
          context.report({ node, messageId: 'parseFloat' });
        }
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'Number' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'parseFloat'
        ) {
          context.report({ node, messageId: 'parseFloat' });
        }
      },
      MemberExpression(node) {
        if (node.object.type === 'Identifier' && node.object.name === BANNED_MATH) {
          context.report({ node, messageId: 'math' });
        }
      },
      Identifier(node) {
        if (isNumberAnnotation(node.typeAnnotation) && isMoneyName(node.name)) {
          context.report({ node, messageId: 'moneyNumber', data: { name: node.name } });
        }
      },
      TSPropertySignature(node) {
        if (node.key.type === 'Identifier' && isMoneyName(node.key.name) && isNumberAnnotation(node.typeAnnotation)) {
          context.report({ node, messageId: 'moneyNumber', data: { name: node.key.name } });
        }
      },
      PropertyDefinition(node) {
        if (node.key.type === 'Identifier' && isMoneyName(node.key.name) && isNumberAnnotation(node.typeAnnotation)) {
          context.report({ node, messageId: 'moneyNumber', data: { name: node.key.name } });
        }
      },
      VariableDeclarator(node) {
        if (node.id.type === 'Identifier' && isMoneyName(node.id.name)) {
          const init = node.init;
          if (init?.type === 'Literal' && typeof init.value === 'number') {
            context.report({ node, messageId: 'moneyNumber', data: { name: node.id.name } });
          }
        }
      },
    };
  },
};
