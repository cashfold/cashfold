import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';
import rule, { looksLikeWords } from './no-untranslated-strings.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } } });

tester.run('no-untranslated-strings', rule, {
  valid: [
    // text comes from the catalogue
    "<p>{t('settings.title')}</p>",
    "<Button aria-label={t('common.close')} />",
    '<input placeholder={hint} />',
    // nothing a person reads as words
    '<span>USD</span>',
    '<span>CSV</span>',
    '<span>12.50</span>',
    '<span>·</span>',
    '<span>/</span>',
    '<span>{" "}</span>',
    '<span>&nbsp;</span>',
    '<span>→</span>',
    // attributes that are not read
    '<div className="flex gap-2" id="main" data-testid="tx-row" />',
    '<a href="/overview/" />',
    '<svg viewBox="0 0 20 20" aria-hidden />',
    // computed strings are not judged
    '<Button aria-label={`${count}`} />',
    '<Button aria-label={name} />',
    // a text on the allow list
    { code: '<h1>Cashfold</h1>', options: [{ allow: ['Cashfold'] }] },
    { code: '<title title="Cashfold" />', options: [{ allow: ['Cashfold'] }] },
    // an address is an example to follow, not a sentence
    '<input placeholder="https://relay.example.com" />',
    '<input placeholder="https://" />',
    '<input placeholder="name@example.com" />',
    // two letters are not a word
    '<span>OK</span>',
    '<span>Ok</span>',
  ],
  invalid: [
    { code: '<p>Save your changes</p>', errors: [{ messageId: 'text', data: { text: 'Save your changes' } }] },
    { code: '<Button>Cancel</Button>', errors: [{ messageId: 'text', data: { text: 'Cancel' } }] },
    { code: "<p>{'Save your changes'}</p>", errors: [{ messageId: 'text' }] },
    { code: '<p>{`Nothing here yet`}</p>', errors: [{ messageId: 'text' }] },
    { code: '<Button aria-label="Close" />', errors: [{ messageId: 'attribute', data: { name: 'aria-label', text: 'Close' } }] },
    { code: '<input placeholder="Search" />', errors: [{ messageId: 'attribute', data: { name: 'placeholder', text: 'Search' } }] },
    { code: '<img alt="A chart of spending" />', errors: [{ messageId: 'attribute' }] },
    { code: '<Field label="Name" />', errors: [{ messageId: 'attribute', data: { name: 'label', text: 'Name' } }] },
    { code: "<Button title={'Close'} />", errors: [{ messageId: 'attribute' }] },
    { code: '<Field description="Shown on the overview" />', errors: [{ messageId: 'attribute' }] },
    // another language is still a word that did not come from the catalogue
    { code: '<p>Збережіть зміни</p>', errors: [{ messageId: 'text' }] },
    // both a text and an attribute in one element
    { code: '<Button aria-label="Close">Close</Button>', errors: [{ messageId: 'attribute' }, { messageId: 'text' }] },
    // a long text is shortened in the message
    { code: '<p>This sentence is far too long to print in full in a lint message</p>', errors: [{ messageId: 'text', data: { text: 'This sentence is far too long to prin...' } }] },
  ],
});

describe('looksLikeWords', () => {
  it('needs a word of three letters or more with a lowercase letter', () => {
    expect(looksLikeWords('Save')).toBe(true);
    expect(looksLikeWords('offline')).toBe(true);
    expect(looksLikeWords('Збережіть')).toBe(true);
    expect(looksLikeWords('USD')).toBe(false);
    expect(looksLikeWords('OK')).toBe(false);
    expect(looksLikeWords('42')).toBe(false);
    expect(looksLikeWords('   ')).toBe(false);
    expect(looksLikeWords('→ ·')).toBe(false);
  });

  it('lets an address through but not a sentence that mentions one', () => {
    expect(looksLikeWords('https://relay.example.com')).toBe(false);
    expect(looksLikeWords('name@example.com')).toBe(false);
    expect(looksLikeWords('Visit https://relay.example.com')).toBe(true);
  });

  it('honours the allow list after trimming and collapsing spaces', () => {
    expect(looksLikeWords('  Cashfold \n', new Set(['Cashfold']))).toBe(false);
    expect(looksLikeWords('Cashfold Pro', new Set(['Cashfold']))).toBe(true);
  });
});
