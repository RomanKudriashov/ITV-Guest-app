import { Outlet } from 'react-router-dom';

import { GuestSessionProvider } from './session/GuestSessionProvider';
import { CartProvider } from './state/cart';

/**
 * Root of the guest storefront. Mounted at `/` — the CMS lives under `/cms/*`
 * and `/login` and is deliberately outside this subtree so that neither the
 * guest session nor the cart is created for a member of staff.
 */
export function GuestRoot() {
  return (
    <GuestSessionProvider>
      <CartProvider>
        <Outlet />
      </CartProvider>
    </GuestSessionProvider>
  );
}
