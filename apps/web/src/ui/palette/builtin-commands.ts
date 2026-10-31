import { PRIMARY_SECTIONS, SETTINGS_GROUPS } from '../shell/routes';
import { register, type Command } from './registry';

// The screens the palette can open, taken from the route table so a renamed route cannot drift (contracts/ui-contract.md §3). The actions are added in
// the same registry as the actions, which are registered by actions.ts.

const settingsGroup = (id: string) => SETTINGS_GROUPS.find((g) => g.id === id);

function screen(id: string, titleKey: string, keyword: string, href: string): Command {
  return { id: `go-${id}`, titleKey, keywordKeys: [`palette.keywords.${keyword}`], group: 'screen', run: (ctx) => ctx.navigate(href) };
}

export const SCREEN_COMMANDS: readonly Command[] = [
  ...PRIMARY_SECTIONS.map((section) => screen(section.id, section.labelKey, section.id, section.href)),
  screen('schedules', 'palette.command.schedules', 'schedules', '/plan/?view=schedules'),
  screen('devices', settingsGroup('sync')!.labelKey, 'sync', settingsGroup('sync')!.href),
  screen('data', 'palette.command.data', 'data', settingsGroup('data')!.href),
  screen('appearance', settingsGroup('appearance')!.labelKey, 'appearance', settingsGroup('appearance')!.href),
];

register(SCREEN_COMMANDS);
