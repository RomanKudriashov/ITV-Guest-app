import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  acceptTrackerOrder,
  cancelTrackerOrder,
  changeTrackerOrderStatus,
} from '../api/tracker';
import { useTrackerLanguage } from './useTrackerQueries';
import type { TrackerOrder } from '../api/types';

type ActionKind = 'accept' | 'status' | 'cancel';

interface ActionVariables {
  kind: ActionKind;
  orderId: string;
  status?: string;
  reason?: string;
}

export interface ActionError {
  orderId: string;
  error: unknown;
}

/**
 * Board actions.
 *
 * NO OPTIMISTIC UPDATE ON PURPOSE: the REST call is the request, the WS snapshot
 * is the truth. What the UI does owe the cook is honesty while waiting — the
 * buttons of the order in flight are disabled and failures are shown verbatim
 * (`409 already_accepted` names whoever got there first).
 *
 * The board is still invalidated on success: when the socket is down the REST
 * response is the only thing that will move the board.
 */
export function useOrderActions() {
  const queryClient = useQueryClient();
  const language = useTrackerLanguage();
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ActionError | null>(null);

  const mutation = useMutation<TrackerOrder, unknown, ActionVariables>({
    mutationFn: (variables) => {
      switch (variables.kind) {
        case 'accept':
          return acceptTrackerOrder(variables.orderId, language);
        case 'status':
          return changeTrackerOrderStatus(
            variables.orderId,
            { status: variables.status as string, comment: '' },
            language,
          );
        case 'cancel':
        default:
          return cancelTrackerOrder(variables.orderId, variables.reason ?? '', language);
      }
    },
    onMutate: (variables) => {
      setPendingOrderId(variables.orderId);
      setActionError(null);
    },
    onError: (error, variables) => setActionError({ orderId: variables.orderId, error }),
    onSettled: () => {
      setPendingOrderId(null);
      void queryClient.invalidateQueries({ queryKey: ['tracker', 'board'] });
      void queryClient.invalidateQueries({ queryKey: ['tracker', 'points'] });
    },
  });

  const accept = useCallback(
    (orderId: string) => mutation.mutateAsync({ kind: 'accept', orderId }).catch(() => undefined),
    [mutation],
  );

  const changeStatus = useCallback(
    (orderId: string, status: string) =>
      mutation.mutateAsync({ kind: 'status', orderId, status }).catch(() => undefined),
    [mutation],
  );

  const cancel = useCallback(
    (orderId: string, reason: string) =>
      mutation.mutateAsync({ kind: 'cancel', orderId, reason }).catch(() => undefined),
    [mutation],
  );

  const clearError = useCallback(() => setActionError(null), []);

  return { pendingOrderId, actionError, clearError, accept, changeStatus, cancel };
}
