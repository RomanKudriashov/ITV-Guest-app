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
/**
 * `carry` — what of the guest's input survives a re-seed (партия 62-F).
 *
 * Several forms build `identity` from server data that arrives LATER for the
 * SAME thing: the dish's full card, the request's fields, the delivery points.
 * Re-seeding on that wiped what the guest had already typed — on a slow
 * network the comment field came back empty. `carry(previous, fresh, from, to)`
 * returns the new draft; without it the re-seed is a clean slate, as before.
 */
/** Same thing, more data: identities `"<id>:…"` share the leading `<id>`. */
export const sameItem = (from: string, to: string): boolean => from.split(':')[0] === to.split(':')[0];

export type DraftCarry<T> = (previous: T, fresh: T, fromIdentity: string, toIdentity: string) => T;

export function useDraftState<T>(
  seed: () => T,
  identity: string,
  carry?: DraftCarry<T>,
): [T, Dispatch<SetStateAction<T>>, () => void] {
  const seedRef = useRef(seed);
  seedRef.current = seed;
  const carryRef = useRef(carry);
  carryRef.current = carry;

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
    const fresh = seedRef.current();
    current = carryRef.current ? carryRef.current(state.value, fresh, state.id, identity) : fresh;
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
