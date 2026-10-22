import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { describe, it } from 'vitest';
import rules from './ui-kit-boundaries.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } } });

tester.run('no-headless-outside-kit', rules['no-headless-outside-kit'], {
  valid: ["import { Button } from '@/ui/kit';", "import clsx from 'clsx';", "import { useState } from 'react';"],
  invalid: [
    { code: "import { Dialog } from '@headlessui/react';", errors: [{ messageId: 'headless' }] },
    { code: "import * as Headless from '@headlessui/react';", errors: [{ messageId: 'headless' }] },
    { code: "import { Transition } from '@headlessui/react/dist/components/transition/transition';", errors: [{ messageId: 'headless' }] },
    { code: "const m = require('@headlessui/react');", errors: [{ messageId: 'headless' }] },
  ],
});

tester.run('no-raw-controls', rules['no-raw-controls'], {
  valid: [
    '<Button>Save</Button>',
    '<input type="file" />',
    '<input type="hidden" name="x" />',
    '<div role="button" />',
    '<Input />',
  ],
  invalid: [
    { code: '<button>Save</button>', errors: [{ messageId: 'raw', data: { tag: 'button' } }] },
    { code: '<input />', errors: [{ messageId: 'raw', data: { tag: 'input' } }] },
    { code: '<input type="text" />', errors: [{ messageId: 'raw', data: { tag: 'input' } }] },
    { code: '<input type={kind} />', errors: [{ messageId: 'raw', data: { tag: 'input' } }] },
    { code: '<select><option /></select>', errors: [{ messageId: 'raw', data: { tag: 'select' } }] },
    { code: '<textarea />', errors: [{ messageId: 'raw', data: { tag: 'textarea' } }] },
  ],
});

tester.run('no-name-on-headless', rules['no-name-on-headless'], {
  valid: ['<Switch checked={on} onChange={set} />', '<Input name="email" />', '<Select name="kind" />', '<Checkbox checked onChange={f} />'],
  invalid: [
    { code: '<Switch name="x" />', errors: [{ messageId: 'name', data: { tag: 'Switch' } }] },
    { code: '<Checkbox name="x" />', errors: [{ messageId: 'name', data: { tag: 'Checkbox' } }] },
    { code: '<Radio name="x" value="a" />', errors: [{ messageId: 'name', data: { tag: 'Radio' } }] },
    { code: '<Listbox name="x" />', errors: [{ messageId: 'name', data: { tag: 'Listbox' } }] },
    { code: '<Combobox name="x" />', errors: [{ messageId: 'name', data: { tag: 'Combobox' } }] },
  ],
});
