import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '../i18n/i18n';
import { GroupDeleteView, GroupFormView } from './GroupDialogs';

const t = createTranslator('en');
const noop = () => undefined;
const form = (over: Partial<Parameters<typeof GroupFormView>[0]> = {}) =>
  renderToStaticMarkup(<GroupFormView t={t} mode="create" name="" error={undefined} onChange={noop} onSubmit={noop} onCancel={noop} {...over} />);
const del = (over: Partial<Parameters<typeof GroupDeleteView>[0]> = {}) =>
  renderToStaticMarkup(<GroupDeleteView t={t} name="Household" accountCount={2} budgets={[]} onConfirm={noop} onCancel={noop} {...over} />);

describe('the add and rename group form', () => {
  it('has a required name field of at most 80 characters, and confirm and cancel buttons', () => {
    const html = form();
    expect(html).toMatch(/<input[^>]*required/);
    expect(html).toContain('maxLength="80"');
    expect(html).toContain('Group name');
    expect(html).toContain('Add group');
    expect(html).toContain('Cancel');
  });

  it('says Save when renaming', () => {
    expect(form({ mode: 'rename', name: 'Old' })).toContain('Save');
  });

  it('shows its error in an alert, and none otherwise', () => {
    expect(form({ error: 'A group with this name already exists.' })).toMatch(/role="alert"[^>]*>A group with this name already exists\./);
    expect(form()).not.toContain('role="alert"');
  });
});

describe('the delete group confirmation', () => {
  it('says how many accounts are in the group and that they are kept as ungrouped', () => {
    expect(del({ accountCount: 2 })).toContain('2 accounts are in this group. They are kept and shown as ungrouped.');
    expect(del({ accountCount: 1 })).toContain('1 account is in this group.');
  });

  it('says so when the group is empty', () => {
    expect(del({ accountCount: 0 })).toContain('No account is in this group.');
  });

  it('lists the budgets that keep some scope, and those that would count nothing apart, each only when it has entries', () => {
    const none = del();
    expect(none).not.toContain('Budgets limited to this group');
    expect(none).not.toContain('will count nothing');
    const html = del({ budgets: [{ name: 'Food', countsNothing: true }, { name: 'Fun', countsNothing: false }] });
    expect(html).toMatch(/Budgets limited to this group: Fun\./);
    expect(html).toMatch(/will count nothing afterwards: Food\./);
    expect(del({ budgets: [{ name: 'Food', countsNothing: true }] })).not.toContain('Budgets limited to this group');
  });

  it('names the group in its title and gives Cancel the focus', () => {
    const html = del();
    expect(html).toContain('Delete the group “Household”?');
    expect(html).toMatch(/<button[^>]*data-autofocus=""[^>]*>(?:(?!<button)[\s\S])*?Cancel/);
    expect(html).toContain('Delete group');
  });
});
