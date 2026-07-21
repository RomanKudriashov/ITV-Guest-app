import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createOrder } from '../api/guest';
import { guestKeys } from '../api/queryKeys';
import { useGuestLanguage } from './useGuestQueries';
import { useIdempotencyKey } from './useIdempotencyKey';
import type { CreateOrderPayload, GuestOrder } from '../api/types';

export interface OrderSubmitOptions {
  /** Runs after the order is created, before navigation (the cart clears here). */
  onPlaced?: (order: GuestOrder) => void;
}

/**
 * THE checkout of the storefront — used by the cart and by the request form
 * alike. There is deliberately no second submit path: both types post the same
 * `POST /api/guest/order` with the same `Idempotency-Key` discipline and land on
 * the same confirmation → live status → history.
 *
 * What differs between types is the payload the caller builds (cart lines vs a
 * single line plus `field_values`), and that difference lives in the screen that
 * collects it, not here.
 */
export function useOrderSubmit(payload: CreateOrderPayload | null, options: OrderSubmitOptions = {}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const language = useGuestLanguage();

  // One key per attempt; a changed body mints a new one (else the server 409s).
  const [idempotencyKey, rotateKey] = useIdempotencyKey(JSON.stringify(payload));
  const [failure, setFailure] = useState<unknown>(null);

  const mutation = useMutation<GuestOrder, unknown, void>({
    mutationFn: () => createOrder(payload as CreateOrderPayload, idempotencyKey, language),
    onSuccess: (order) => {
      setFailure(null);
      queryClient.setQueryData(guestKeys.order(order.id), order);
      void queryClient.invalidateQueries({ queryKey: ['guest', 'orders'] });
      options.onPlaced?.(order);
      rotateKey();
      navigate(`/orders/${order.id}?placed=1`, { replace: true });
    },
    onError: (error) => setFailure(error),
  });

  return {
    submit: () => {
      if (payload) mutation.mutate();
    },
    isPending: mutation.isPending,
    failure,
  };
}
