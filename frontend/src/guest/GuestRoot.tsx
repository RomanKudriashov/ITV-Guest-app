import { Outlet, useMatch } from 'react-router-dom';
import type { ReactNode } from 'react';

import { StickyStackProvider } from './layout/stickyStack';
import { GuestSessionProvider } from './session/GuestSessionProvider';
import { CartProvider } from './state/cart';

/**
 * Обвязка витрины НИЖЕ сессии: корзина и стек липких слоёв.
 *
 * Вынесена отдельно, потому что потребителей у неё двое. Гость получает её под
 * настоящей сессией (`GuestRoot` ниже). Показ витрины в настройке оформления —
 * под сессией показа: там гостя нет, и заводить его ради картинки нельзя.
 *
 * Делить пришлось ровно по этой границе: всё, что ниже сессии, у показа и у
 * гостя ОДИНАКОВО, и дублировать это значило бы завести показу свою корзину,
 * которая однажды разойдётся с настоящей.
 */
export function GuestShellProviders({ children }: { children?: ReactNode }) {
  // Какое заведение «активно», решает АДРЕС, а не порядок кликов: гость
  // находится в пространстве заведения — значит, добавляет в его корзину.
  // Корзина/оформление лежат вне /venue, поэтому берут заведение из своего
  // адреса (?service=) — иначе, уйдя в корзину, гость терял бы контекст.
  const inVenue = useMatch('/venue/:code');
  const params = new URLSearchParams(window.location.search);
  const serviceCode = inVenue?.params.code ?? params.get('service');

  return (
    <CartProvider serviceCode={serviceCode}>
      {/* Стек липких слоёв — ОДИН на всю витрину: шелл и экраны кладут свои
          полосы в него, а не считают чужие высоты у себя. */}
      <StickyStackProvider>{children ?? <Outlet />}</StickyStackProvider>
    </CartProvider>
  );
}

/**
 * Root of the guest storefront. Mounted at `/` — the CMS lives under `/cms/*`
 * and `/login` and is deliberately outside this subtree so that neither the
 * guest session nor the cart is created for a member of staff.
 */
export function GuestRoot() {
  return (
    <GuestSessionProvider>
      <GuestShellProviders />
    </GuestSessionProvider>
  );
}
