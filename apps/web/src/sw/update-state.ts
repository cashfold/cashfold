// The update state of the web app (spec 009, data-model "UpdateState"): what the page knows about a new version, as a pure reducer so the rules test
// without a browser. A state is per page: a dismissal lasts until the app is next opened.

export type UpdateState =
  | { readonly kind: 'idle' }
  /** A new version is installed and waiting. */
  | { readonly kind: 'ready'; readonly version: string }
  /** The person dismissed this version. */
  | { readonly kind: 'dismissed'; readonly version: string }
  /** Update was pressed with unsaved input: it waits until that is saved or discarded. */
  | { readonly kind: 'blocked'; readonly version: string }
  | { readonly kind: 'applying'; readonly version: string }
  /** Another window switched to the new version: this one must leave the old one. */
  | { readonly kind: 'restarting-elsewhere' }
  /** A new version could not be installed; the current one keeps working. */
  | { readonly kind: 'failed' };

export type UpdateEvent =
  | { readonly type: 'waiting-found'; readonly version: string }
  | { readonly type: 'dismiss' }
  | { readonly type: 'apply'; readonly unsaved: boolean }
  | { readonly type: 'unsaved-cleared' }
  | { readonly type: 'controller-changed'; readonly own: boolean }
  | { readonly type: 'install-failed' };

export function updateReducer(state: UpdateState, event: UpdateEvent): UpdateState {
  // Once another window has switched, this window only has to restart.
  if (state.kind === 'restarting-elsewhere') return state;
  switch (event.type) {
    case 'waiting-found':
      if (state.kind === 'dismissed' && state.version === event.version) return state;
      if ((state.kind === 'applying' || state.kind === 'blocked') && state.version === event.version) return state;
      return { kind: 'ready', version: event.version };
    case 'dismiss':
      return state.kind === 'ready' || state.kind === 'blocked' ? { kind: 'dismissed', version: state.version } : state;
    case 'apply':
      if (state.kind !== 'ready' && state.kind !== 'blocked') return state;
      return event.unsaved ? { kind: 'blocked', version: state.version } : { kind: 'applying', version: state.version };
    case 'unsaved-cleared':
      return state.kind === 'blocked' ? { kind: 'ready', version: state.version } : state;
    case 'controller-changed':
      return event.own ? state : { kind: 'restarting-elsewhere' };
    case 'install-failed':
      return state.kind === 'idle' || state.kind === 'failed' ? { kind: 'failed' } : state;
  }
}
