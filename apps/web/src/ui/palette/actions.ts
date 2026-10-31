import { register, type Command } from './registry';

// The actions the palette can run. Each calls the same function as the control it stands for, through the context the host builds, so a confirmation the
// normal control asks for is asked here too (FR-005). "Sign out" is also how a person uses a different account: the app holds one account per device.

export const ACTION_COMMANDS: readonly Command[] = [
  {
    id: 'add-transaction',
    titleKey: 'palette.command.add',
    keywordKeys: ['palette.keywords.add'],
    group: 'action',
    enabled: (ctx) => ctx.accounts > 0,
    run: (ctx) => ctx.openAdd(),
  },
  { id: 'lock-now', titleKey: 'palette.command.lock', keywordKeys: ['palette.keywords.lock'], group: 'action', run: (ctx) => ctx.lock() },
  { id: 'switch-theme', titleKey: 'palette.command.theme', keywordKeys: ['palette.keywords.theme'], group: 'action', run: (ctx) => ctx.toggleTheme() },
  { id: 'sign-out', titleKey: 'palette.command.signOut', keywordKeys: ['palette.keywords.signOut'], group: 'action', run: (ctx) => ctx.openSignOut() },
  { id: 'help', titleKey: 'palette.command.help', keywordKeys: ['palette.keywords.help'], group: 'action', run: (ctx) => ctx.openHelp() },
];

register(ACTION_COMMANDS);
