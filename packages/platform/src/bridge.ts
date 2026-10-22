import type { AboutInfo, UpdateState } from './schemas';

/** What the desktop shell offers the web app. Absent in the plain web build. */
export interface DesktopBridge {
  about(): Promise<AboutInfo>;
  revealDataFolder(): Promise<void>;
  readonly updates: {
    state(): Promise<UpdateState>;
    check(): Promise<UpdateState>;
    /** Only valid in `available` with mode `in-app`. */
    download(): Promise<UpdateState>;
    /** Only valid in `ready`; quits and relaunches. */
    install(): Promise<void>;
    /** `manual` mode, and the "what's new" link. */
    openReleasePage(): Promise<void>;
    /** Periodic checks on or off (default on). */
    autoCheck(): Promise<boolean>;
    setAutoCheck(on: boolean): Promise<void>;
    onChange(listener: (state: UpdateState) => void): () => void;
  };
}
