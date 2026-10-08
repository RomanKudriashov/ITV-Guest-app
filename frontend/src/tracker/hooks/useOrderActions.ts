import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  acceptTrackerOrder,
  assignTrackerOrder,
  cancelTrackerOrder,
  changeTrackerOrderStatus,
  moveTrackerOrderPosition,
} from '../api/tracker';
import { useTrackerLanguage } from './useTrackerQueries';
import type { TrackerOrder } from '../api/types';
import type { CancelReasonCode } from '../cancelReasons';

type ActionKind = 'accept' | 'status' | 'cancel' | 'position' | 'assign';

interface ActionVariables {
  kind: ActionKind;
  orderId: string;
  status?: string;
  /** Уточнение к смене статуса — у возврата закрытого обязательно (партия 47). */
  comment?: string;
  /** Кого назначить исполнителем. */
  assignee?: string;
  reason?: string;
  cancelReason?: CancelReasonCode;
  /** Соседи по колонке для перестановки: между кем встала карточка. */
  after?: string | null;
  before?: string | null;
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
            { status: variables.status as string, comment: variables.comment ?? '' },
            language,
          );
        case 'assign':
          return assignTrackerOrder(variables.orderId, variables.assignee as string, language);
        case 'position':
          return moveTrackerOrderPosition(
            variables.orderId,
            { after: variables.after ?? null, before: variables.before ?? null },
            language,
          );
        case 'cancel':
        default:
          return cancelTrackerOrder(
            variables.orderId,
            variables.cancelReason ?? 'other',
            variables.reason ?? '',
            language,
          );
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

  /**
   * Смена статуса. Отказ по-прежнему не всплывает наружу — его показывает
   * карточка, — но вызывающий может УЗНАТЬ причину: `onFailure` получает сам
   * отказ, а не факт неудачи.
   *
   * Ref за состоянием тут не годится: `actionError` обновляется рендером, и
   * обработчик, читающий его сразу после ответа, взял бы значение прошлого.
   */
  const changeStatus = useCallback(
    (orderId: string, status: string, onFailure?: (error: unknown) => void, comment?: string) =>
      mutation.mutateAsync({ kind: 'status', orderId, status, comment }).catch((error: unknown) => {
        onFailure?.(error);
        return undefined;
      }),
    [mutation],
  );

  /** Назначить исполнителя — отказ показывает карточка, как у остальных действий. */
  const assign = useCallback(
    (orderId: string, assignee: string) =>
      mutation.mutateAsync({ kind: 'assign', orderId, assignee }).catch(() => undefined),
    [mutation],
  );

  /**
   * Перестановка внутри колонки. Отказ ведёт себя как у смены статуса:
   * карточка показывает его сама, а вызывающий может узнать причину.
   */
  const moveTo = useCallback(
    (
      orderId: string,
      neighbours: { after: string | null; before: string | null },
      onFailure?: (error: unknown) => void,
    ) =>
      mutation
        .mutateAsync({ kind: 'position', orderId, ...neighbours })
        .catch((error: unknown) => {
          onFailure?.(error);
          return undefined;
        }),
    [mutation],
  );

  const cancel = useCallback(
    (orderId: string, cancelReason: CancelReasonCode, reason: string) =>
      mutation.mutateAsync({ kind: 'cancel', orderId, cancelReason, reason }).catch(() => undefined),
    [mutation],
  );

  const clearError = useCallback(() => setActionError(null), []);

  return { pendingOrderId, actionError, clearError, accept, assign, changeStatus, moveTo, cancel };
}
