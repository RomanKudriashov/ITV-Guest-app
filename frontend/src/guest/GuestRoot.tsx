import { Outlet, useMatch } from 'react-router-dom';

import { StickyStackProvider } from './layout/stickyStack';
import { GuestSessionProvider } from './session/GuestSessionProvider';
import { CartProvider } from './state/cart';

/**
 * Root of the guest storefront. Mounted at `/` — the CMS lives under `/cms/*`
 * and `/login` and is deliberately outside this subtree so that neither the
 * guest session nor the cart is created for a member of staff.
 */
export function GuestRoot() {
  // Какое заведение «активно», решает АДРЕС, а не порядок кликов: гость
  // находится в пространстве заведения — значит, добавляет в его корзину.
  // Корзина/оформление лежат вне /venue, поэтому берут заведение из своего
  // адреса (?service=) — иначе, уйдя в корзину, гость терял бы контекст.
  const inVenue = useMatch('/venue/:code');
  const params = new URLSearchParams(window.location.search);
  const serviceCode = inVenue?.params.code ?? params.get('service');

  return (
    <GuestSessionProvider>
      <CartProvider serviceCode={serviceCode}>
        {/* Стек липких слоёв — ОДИН на всю витрину: шелл и экраны кладут свои
            полосы в него, а не считают чужие высоты у себя. */}
        <StickyStackProvider>
          <Outlet />
        </StickyStackProvider>
      </CartProvider>
    </GuestSessionProvider>
  );
}
