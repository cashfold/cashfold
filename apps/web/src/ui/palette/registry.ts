// The commands the palette can run. A feature contributes by calling `register` once; the palette never has to change (spec 015, contracts/ui-contract.md §2).
// A command is plain data: it is handed a context when it runs, so it can be registered at module load, before any component exists.

export type PaletteGroup = 'screen' | 'action';

/** What a command may use. `PaletteHost` builds it from the page's existing hooks, so a command calls the same function as the normal control. */
export interface PaletteContext {
  navigate(href: string): void;
  openAdd(): void;
  lock(): void;
  toggleTheme(): void;
  openSignOut(): void;
  openHelp(): void;
  /** Whether Privacy mode is on, and a way to flip it (spec 016). */
  readonly privacy: boolean;
  togglePrivacy(): void;
  /** How many accounts the viewed Fold has, for `enabled` rules. */
  readonly accounts: number;
  readonly foldId: string | undefined;
}

export interface Command {
  readonly id: string;
  readonly titleKey: string;
  readonly keywordKeys?: readonly string[];
  readonly group: PaletteGroup;
  /** Whether it is offered now. Absent means always. */
  enabled?(ctx: PaletteContext): boolean;
  run(ctx: PaletteContext): void;
}

export interface Registry {
  /** Adds commands. Returns the function that removes exactly these. A command whose id is already taken is not added. */
  register(commands: readonly Command[]): () => void;
  /** The commands that are available now, in the order they were registered. */
  list(ctx: PaletteContext): Command[];
}

export function createRegistry(): Registry {
  const all: Command[] = [];
  return {
    register(commands) {
      const added: Command[] = [];
      for (const command of commands) {
        if (all.some((existing) => existing.id === command.id)) {
          if (process.env.NODE_ENV !== 'production') throw new Error(`The palette already has a command "${command.id}"`);
          continue;
        }
        all.push(command);
        added.push(command);
      }
      return () => {
        for (const command of added) {
          const at = all.indexOf(command);
          if (at >= 0) all.splice(at, 1);
        }
      };
    },
    list(ctx) {
      return all.filter((command) => command.enabled?.(ctx) !== false);
    },
  };
}

/** The app's registry. */
export const registry: Registry = createRegistry();
export const register = registry.register;
