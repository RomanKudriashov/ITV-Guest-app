import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';

export interface UnsavedChangesGuard {
  isBlocked: boolean;
  /** Leave anyway. */
  proceed: () => void;
  /** Stay on the page. */
  reset: () => void;
}

/**
 * Blocks in-app navigation (data router `useBlocker`) and full page unloads
 * while the editor holds unsaved changes.
 */
export function useUnsavedChangesGuard(when: boolean): UnsavedChangesGuard {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      when && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!when) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [when]);

  return {
    isBlocked: blocker.state === 'blocked',
    proceed: () => blocker.proceed?.(),
    reset: () => blocker.reset?.(),
  };
}
