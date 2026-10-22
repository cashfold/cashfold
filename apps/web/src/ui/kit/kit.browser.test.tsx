import axe from 'axe-core';
import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import '../../app/globals.css';
import {
  Alert, AlertActions, AlertDescription, AlertTitle, Amount, Avatar, Badge, Button, Checkbox, CheckboxField, Chip, ConfirmDialog, Description, Disclosure, Divider, Dropdown, DropdownButton,
  DropdownItem, DropdownLabel, DropdownMenu, EmptyState, ErrorMessage, Field, Heading, Input, Label, Listbox, ListboxLabel, ListboxOption, Notice, Progress, Radio, RadioField, RadioGroup, Select,
  Sheet, Stat, StatusMessage, Switch, SwitchField, Tabs, Text, Textarea, BanknotesIcon,
} from './index';

// The kit in a real browser, in both themes: no axe violations (WCAG 2.2 AA) for any component and variant, and the keyboard behaviour of the
// overlays (focus goes in, Escape closes, focus comes back) (FR-045; SC-006, SC-007).

let root: Root | undefined;
let host: HTMLElement | undefined;

function mount(node: React.ReactNode, theme: 'light' | 'dark'): HTMLElement {
  document.documentElement.dataset['theme'] = theme;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(node));
  return host;
}

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
});

async function violations(scope: Element): Promise<string[]> {
  await new Promise((r) => setTimeout(r, 250)); // transitions
  const result = await axe.run(scope, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

function Gallery() {
  const [on, setOn] = useState(true);
  const [tab, setTab] = useState('a');
  return (
    <main>
      <Heading>Gallery</Heading>
      <Text>Some text</Text>
      <div className="flex gap-2">
        <Button>Primary</Button>
        <Button color="danger">Danger</Button>
        <Button outline>Outline</Button>
        <Button plain>Plain</Button>
        <Button disabled>Disabled</Button>
      </div>
      <Badge color="primary">Primary</Badge><Badge color="red">Red</Badge><Badge color="amber">Amber</Badge><Badge color="green">Green</Badge><Badge>Zinc</Badge>
      <Avatar initials="A" />
      <Divider />
      <Field><Label>Name</Label><Input defaultValue="Alice" /><Description>Hint</Description></Field>
      <Field><Label>Broken</Label><Input invalid defaultValue="x" /><ErrorMessage>It is wrong</ErrorMessage></Field>
      <Field><Label>Kind</Label><Select defaultValue="a"><option value="a">A</option><option value="b">B</option></Select></Field>
      <Field><Label>Note</Label><Textarea defaultValue="n" /></Field>
      <CheckboxField><Checkbox defaultChecked /><Label>Check</Label></CheckboxField>
      <RadioGroup defaultValue="a" aria-label="Choice"><RadioField><Radio value="a" /><Label>One</Label></RadioField><RadioField><Radio value="b" /><Label>Two</Label></RadioField></RadioGroup>
      <SwitchField><Label>Switch</Label><Switch checked={on} onChange={setOn} /></SwitchField>
      <Field><Label>List</Label><Listbox defaultValue="a" aria-label="List"><ListboxOption value="a"><ListboxLabel>A</ListboxLabel></ListboxOption></Listbox></Field>
      <Tabs value={tab} onChange={setTab} label="Tabs" items={[{ value: 'a', label: 'A', count: 1 }, { value: 'b', label: 'B' }]}>Panel</Tabs>
      <Disclosure title="More" summary="details" defaultOpen>Inside</Disclosure>
      <Stat label="Income" value={<Amount minor={12345n} currency="USD" locale="en" />} tone="gain" />
      <Amount minor={-500n} currency="USD" locale="en" tone="auto" />
      <Progress value={50} max={100} label="Progress" statusText="Half way" />
      <Chip label="Food" removeLabel="Remove Food" onRemove={() => undefined} />
      <EmptyState icon={BanknotesIcon} title="Nothing" body="Add something" action={<Button>Add</Button>} />
      <Notice tone="warning" title="Careful">Body</Notice>
      <Notice tone="danger" title="Wrong" onDismiss={() => undefined} dismissLabel="Dismiss">Body</Notice>
      <StatusMessage message="Saved" dismissLabel="Dismiss" onDismiss={() => undefined} />
      <Dropdown><DropdownButton plain aria-label="Menu">Menu</DropdownButton><DropdownMenu><DropdownItem><DropdownLabel>Item</DropdownLabel></DropdownItem></DropdownMenu></Dropdown>
    </main>
  );
}

describe.each(['light', 'dark'] as const)('kit in the %s theme', (theme) => {
  it('has no accessibility violations across every component', async () => {
    const el = mount(<Gallery />, theme);
    expect(await violations(el)).toEqual([]);
  });

  it('a sheet has no violations, takes focus in, closes on Escape and returns focus', async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Open</Button>
          <Sheet open={open} onClose={() => setOpen(false)} title="Title" description="Description" footer={<Button onClick={() => setOpen(false)}>Done</Button>}>
            <Field><Label>Field</Label><Input /></Field>
          </Sheet>
        </>
      );
    }
    const el = mount(<Host />, theme);
    const opener = el.querySelector('button')!;
    opener.focus();
    await userEvent.keyboard('{Enter}');
    await new Promise((r) => setTimeout(r, 300));
    const dialog = document.querySelector('[role=dialog]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(await violations(document.body)).toEqual([]);
    await userEvent.keyboard('{Escape}');
    await new Promise((r) => setTimeout(r, 300));
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('an alert dialog and a confirmation have no violations and keep focus inside', async () => {
    const el = mount(
      <>
        <Alert open onClose={() => undefined}><AlertTitle>Sure?</AlertTitle><AlertDescription>It cannot be undone.</AlertDescription><AlertActions><Button plain>Cancel</Button><Button>OK</Button></AlertActions></Alert>
        <ConfirmDialog open={false} title="x" confirmLabel="Yes" cancelLabel="No" onConfirm={() => undefined} onCancel={() => undefined} />
      </>,
      theme,
    );
    void el;
    await new Promise((r) => setTimeout(r, 300));
    const dialog = document.querySelector('[role=dialog]')!;
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(await violations(document.body)).toEqual([]);
  });

  it('a menu opens with the keyboard and closes with Escape', async () => {
    const el = mount(<Dropdown><DropdownButton aria-label="Menu">Menu</DropdownButton><DropdownMenu><DropdownItem><DropdownLabel>Item</DropdownLabel></DropdownItem></DropdownMenu></Dropdown>, theme);
    const button = el.querySelector('button')!;
    button.focus();
    await userEvent.keyboard('{Enter}');
    await new Promise((r) => setTimeout(r, 250));
    expect(document.querySelector('[role=menu]')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    await new Promise((r) => setTimeout(r, 250));
    expect(document.querySelector('[role=menu]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('tabs move with the arrow keys', async () => {
    function T() {
      const [v, setV] = useState('a');
      return <Tabs value={v} onChange={setV} label="Tabs" items={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]}>Panel {v}</Tabs>;
    }
    const el = mount(<T />, theme);
    const first = el.querySelector<HTMLElement>('[role=tab]')!;
    first.focus();
    await userEvent.keyboard('{ArrowRight}');
    await new Promise((r) => setTimeout(r, 100));
    expect(el.textContent).toContain('Panel b');
  });
});
