import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useGuestSession } from '../session/GuestSessionProvider';
import type { ItemDetail, MenuItem, ModifierOption, OrderLinePayload } from '../api/types';

/**
 * Корзина — НА СЕРВИС, а не одна на отель.
 *
 * У каждого заведения своя коммерция (сбор, минимум, доставка, чаевые), и одна
 * общая корзина не могла бы честно ответить, по чьим правилам считать. Стейк в
 * «Панораме» и коктейль в баре — два заказа; заказ в рум-сервисе один, а
 * разъезжается уже на исполнении (fan-out R2/R3).
 *
 * Отсюда же берётся `service_code` при оформлении. До R5 клиент его не слал,
 * и реальные заказы оставались плоскими — это было записано отклонением R2.
 * Посервисная корзина честна ровно потому, что витрина R5 не даёт добавить
 * позицию вне заведения: плоского каталога больше нет.
 *
 * Состояние 2-го рода («незавершённый ввод»): НИКОГДА не выводится из ответа
 * сервера и не перетирается им — фоновое обновление меню не должно ронять то,
 * что гость уже выбрал. Цены здесь — снятые на момент добавления; итог считает
 * сервер при оформлении, поэтому устаревшая цена тут косметика, а не ошибка.
 *
 * Переживает перезагрузку (localStorage по сессии) и чистится после оформления.
 */

const CART_STORAGE_PREFIX = 'itv.guest.cart.';

export interface CartModifier {
  id: string;
  code: string;
  title: string;
  price_delta: number;
  group_code: string;
}

export interface CartLine {
  /** Local identity of the line — several lines can share an item_id. */
  uid: string;
  item_id: string;
  item_code: string;
  category_id: string;
  title: string;
  image_url: string | null;
  base_price: number;
  /** base_price + sum of modifier deltas. */
  unit_price: number;
  quantity: number;
  comment: string;
  modifiers: CartModifier[];
}

/** Строки всех заведений: код сервиса → его корзина. */
export type CartsByService = Record<string, CartLine[]>;

interface CartContextValue {
  /** Строки АКТИВНОГО заведения (того, в чьём пространстве находится гость). */
  lines: CartLine[];
  /** Код активного заведения; null — гость вне заведения (главная, история). */
  serviceCode: string | null;
  /** Заведения с непустой корзиной — для значка «ещё есть заказ в баре». */
  serviceCodesWithLines: string[];
  count: number;
  total: number;
  isEmpty: boolean;
  /** Quantity of an item added with no modifiers and no comment (inline stepper). */
  simpleQuantity: (itemId: string) => number;
  addLine: (line: Omit<CartLine, 'uid'>) => void;
  addSimple: (item: MenuItem | ItemDetail) => void;
  decrementSimple: (itemId: string) => void;
  setQuantity: (uid: string, quantity: number) => void;
  removeLine: (uid: string) => void;
  /** Чистит корзину активного заведения; остальные не трогает. */
  clear: () => void;
  toPayloadLines: () => OrderLinePayload[];
}

const CartContext = createContext<CartContextValue | null>(null);

function storageKey(sessionId: string | null): string {
  return `${CART_STORAGE_PREFIX}${sessionId ?? 'anonymous'}`;
}

function readStored(sessionId: string | null): CartsByService {
  try {
    const raw = window.localStorage.getItem(storageKey(sessionId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    // Корзина, сохранённая до R5, была плоским массивом. Восстанавливать её
    // некуда — заведение неизвестно, — поэтому просто начинаем с пустой:
    // молча приписать чужие строки первому попавшемуся сервису хуже.
    if (Array.isArray(parsed)) return {};
    return parsed as CartsByService;
  } catch {
    return {};
  }
}

function newUid(): string {
  return `l-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Two lines merge only when the item, the modifiers and the comment all match. */
function sameConfiguration(a: Omit<CartLine, 'uid'>, b: CartLine): boolean {
  if (a.item_id !== b.item_id) return false;
  if ((a.comment || '') !== (b.comment || '')) return false;
  const left = a.modifiers.map((m) => m.id).sort().join('|');
  const right = b.modifiers.map((m) => m.id).sort().join('|');
  return left === right;
}

export function unitPriceOf(basePrice: number, modifiers: { price_delta: number }[]): number {
  return modifiers.reduce((sum, m) => sum + (m.price_delta || 0), basePrice);
}

export function toCartModifier(
  option: ModifierOption,
  groupCode: string,
): CartModifier {
  return {
    id: option.id,
    code: option.code,
    title: option.title,
    price_delta: option.price_delta ?? 0,
    group_code: groupCode,
  };
}

export function CartProvider({
  children,
  serviceCode,
}: {
  children: ReactNode;
  /**
   * Заведение, в чьём пространстве находится гость. Приходит из маршрута —
   * корзина сама его не выбирает: «какая это корзина» решает то, где гость
   * стоит, а не порядок кликов.
   */
  serviceCode?: string | null;
}) {
  const { session } = useGuestSession();
  const sessionId = session?.session_id ?? null;
  const active = serviceCode ?? null;

  // Корзина привязана к сессии: новая сессия начинается с пустой, перезагрузка
  // той же — восстанавливается из localStorage.
  const [state, setState] = useState<{ sid: string | null; carts: CartsByService }>(() => ({
    sid: sessionId,
    carts: readStored(sessionId),
  }));

  let carts = state.carts;
  if (state.sid !== sessionId) {
    carts = readStored(sessionId);
    setState({ sid: sessionId, carts });
  }

  const lines = active ? (carts[active] ?? []) : [];

  const setLines = useCallback(
    (updater: (prev: CartLine[]) => CartLine[]) =>
      setState((prev) => {
        if (!active) return prev;   // вне заведения добавлять некуда
        const next = updater(prev.carts[active] ?? []);
        const carts = { ...prev.carts };
        if (next.length) carts[active] = next;
        else delete carts[active];  // пустую корзину не храним
        return { ...prev, carts };
      }),
    [active],
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey(state.sid), JSON.stringify(state.carts));
    } catch {
      /* storage unavailable — cart lives in memory for this visit */
    }
  }, [state]);

  const addLine = useCallback((line: Omit<CartLine, 'uid'>) => {
    setLines((prev) => {
      const index = prev.findIndex((existing) => sameConfiguration(line, existing));
      if (index >= 0) {
        const next = [...prev];
        next[index] = {
          ...next[index],
          quantity: next[index].quantity + line.quantity,
        };
        return next;
      }
      return [...prev, { ...line, uid: newUid() }];
    });
  }, [setLines]);

  const addSimple = useCallback(
    (item: MenuItem | ItemDetail) => {
      addLine({
        item_id: item.id,
        item_code: item.code,
        category_id: item.category_id,
        title: item.title,
        image_url: item.images?.[0] ?? null,
        // An unpriced item cannot reach the cart (it is filled in with a form),
        // so the fallback here is a type guard, not a pricing decision.
        base_price: item.price ?? 0,
        unit_price: item.price ?? 0,
        quantity: 1,
        comment: '',
        modifiers: [],
      });
    },
    [addLine],
  );

  const decrementSimple = useCallback((itemId: string) => {
    setLines((prev) => {
      const index = prev.findIndex(
        (line) => line.item_id === itemId && line.modifiers.length === 0 && !line.comment,
      );
      if (index < 0) return prev;
      const next = [...prev];
      if (next[index].quantity <= 1) {
        next.splice(index, 1);
        return next;
      }
      next[index] = { ...next[index], quantity: next[index].quantity - 1 };
      return next;
    });
  }, [setLines]);

  const setQuantity = useCallback((uid: string, quantity: number) => {
    setLines((prev) => {
      if (quantity <= 0) return prev.filter((line) => line.uid !== uid);
      return prev.map((line) => (line.uid === uid ? { ...line, quantity } : line));
    });
  }, [setLines]);

  const removeLine = useCallback((uid: string) => {
    setLines((prev) => prev.filter((line) => line.uid !== uid));
  }, [setLines]);

  const clear = useCallback(() => setLines(() => []), [setLines]);

  const value = useMemo<CartContextValue>(() => {
    const count = lines.reduce((sum, line) => sum + line.quantity, 0);
    const total = lines.reduce((sum, line) => sum + line.unit_price * line.quantity, 0);
    return {
      lines,
      serviceCode: active,
      serviceCodesWithLines: Object.keys(carts).filter((code) => carts[code].length > 0),
      count,
      total,
      isEmpty: lines.length === 0,
      simpleQuantity: (itemId: string) =>
        lines
          .filter(
            (line) => line.item_id === itemId && line.modifiers.length === 0 && !line.comment,
          )
          .reduce((sum, line) => sum + line.quantity, 0),
      addLine,
      addSimple,
      decrementSimple,
      setQuantity,
      removeLine,
      clear,
      toPayloadLines: () =>
        lines.map((line) => ({
          item_id: line.item_id,
          quantity: line.quantity,
          modifier_option_ids: line.modifiers.map((m) => m.id),
          comment: line.comment,
        })),
    };
  }, [lines, carts, active, addLine, addSimple, decrementSimple, setQuantity, removeLine, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
