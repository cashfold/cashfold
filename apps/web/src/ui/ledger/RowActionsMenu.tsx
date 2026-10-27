'use client';

import { Dropdown, DropdownButton, DropdownItem, DropdownLabel, DropdownMenu, EllipsisHorizontalIcon } from '../kit';
import type { RowAction } from './row-action';

/** The "actions" button of a row, drawn from its list of actions. */
export function RowActionsMenu({ label, actions }: { label: string; actions: readonly RowAction[] }) {
  return (
    <Dropdown>
      <DropdownButton plain aria-label={label}><EllipsisHorizontalIcon data-slot="icon" aria-hidden="true" /></DropdownButton>
      <DropdownMenu anchor="bottom end">
        {actions.map((action) => (
          <DropdownItem key={action.id} onClick={action.run} disabled={action.disabled === true}><DropdownLabel>{action.label}</DropdownLabel></DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
}
