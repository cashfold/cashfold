export interface DataLocationDeps {
  /** The data folder, as Electron reports it: the only thing ever opened. */
  readonly userData: string;
  /** `shell.openPath`: resolves to an empty string on success, otherwise to an error message. */
  readonly openPath: (path: string) => Promise<string>;
}

/** Shows the data folder in the system's file manager. The page cannot choose the folder; the system's message is kept out of the page's reach. */
export async function revealDataFolder({ userData, openPath }: DataLocationDeps): Promise<void> {
  const problem = await openPath(userData);
  if (problem !== '') throw new Error('could not open the data folder');
}
