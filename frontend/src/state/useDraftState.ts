import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * ============================================================================
 * THE ONE STATE RULE OF THE APP (guest storefront, CMS, tracker)
 * ============================================================================
 *
 * There are exactly two kinds of state in this app, and they never mix:
 *
 *  1. SERVER DATA — owned by react-query. Menu, item details, locations, orders.
 *     Read it with `useQuery`, never copy it into `useState` "so it is handy".
 *
 *  2. UNFINISHED USER INPUT — cart lines, chosen modifiers, comments, the
 *     checkout form. It is owned by the client and is NEVER overwritten by a
 *     background refetch. A guest typing "no onions" while react-query silently
 *     revalidates the menu must not lose that text.
 *
 * `useDraftState` is the single primitive for kind 2. It seeds itself once and
 * re-seeds ONLY when `identity` changes — i.e. when the draft is genuinely about
 * a different thing (another dish opened in the sheet, another session). New
 * server data for the SAME identity leaves the draft untouched, on purpose.
 *
 *  3. LIVE STATUS — reconciliation only. A WebSocket snapshot is written straight
 *     into the query cache (`queryClient.setQueryData(key, snapshot)`); deltas are
 *     never applied on top of local state. See `guest/hooks/useOrderLive` and `tracker/hooks/useBoardLive`.
 *
 * Do not introduce a third mechanism. If a screen needs local input, it uses
 * this hook (or the cart store, which is built on the same principle).
 */
export function useDraftState<T>(
  seed: () => T,
  identity: string,
): [T, Dispatch<SetStateAction<T>>, () => void] {
  const seedRef = useRef(seed);
  seedRef.current = seed;

  // The previous identity is kept in STATE, not in a ref: this is React's
  // "adjusting state during render" pattern, and it is the only variant that
  // survives StrictMode's double render (a ref mutated during render would not
  // be rolled back and the re-seed would be skipped).
  const [state, setState] = useState<{ id: string; value: T }>(() => ({
    id: identity,
    value: seed(),
  }));

  let current = state.value;
  if (state.id !== identity) {
    // Re-seed synchronously during render — no frame of stale input.
    current = seedRef.current();
    setState({ id: identity, value: current });
  }

  const setValue = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    setState((prev) => ({
      ...prev,
      value:
        typeof action === 'function' ? (action as (previous: T) => T)(prev.value) : action,
    }));
  }, []);

  const reset = useCallback(() => {
    setState((prev) => ({ ...prev, value: seedRef.current() }));
  }, []);

  return [current, setValue, reset];
}
