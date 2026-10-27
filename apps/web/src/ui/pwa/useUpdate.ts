'use client';

import { useCallback, useEffect, useReducer } from 'react';
import { applyUpdate, onUpdateEvent } from '../../sw/register';
import { updateReducer, type UpdateState } from '../../sw/update-state';
import { hasUnsavedInput } from './unsaved-input';

const RECHECK_MS = 1_000;

/**
 * What the page knows about a new version of the app, and the two things a person can do about it (spec 009). Updating is refused while anything typed is
 * unsaved; a window that another window switched under restarts by itself the moment nothing is unsaved.
 */
export function useUpdate(): { readonly state: UpdateState; update(): void; dismiss(): void } {
  const [state, dispatch] = useReducer(updateReducer, { kind: 'idle' } as UpdateState);
  useEffect(() => onUpdateEvent(dispatch), []);

  useEffect(() => {
    if (state.kind !== 'blocked' && state.kind !== 'restarting-elsewhere') return;
    const look = (): boolean => {
      if (hasUnsavedInput()) return false;
      if (state.kind === 'blocked') dispatch({ type: 'unsaved-cleared' });
      else location.reload();
      return true;
    };
    if (look()) return;
    const timer = setInterval(() => { if (look()) clearInterval(timer); }, RECHECK_MS);
    return () => clearInterval(timer);
  }, [state.kind]);

  const update = useCallback(() => {
    const unsaved = hasUnsavedInput();
    dispatch({ type: 'apply', unsaved });
    if (!unsaved) applyUpdate();
  }, []);
  const dismiss = useCallback(() => dispatch({ type: 'dismiss' }), []);
  return { state, update, dismiss };
}
