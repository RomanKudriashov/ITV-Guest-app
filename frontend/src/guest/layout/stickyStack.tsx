import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

/**
 * ОДИН СТЕК ЛИПКИХ СЛОЁВ НА ВСЮ ВИТРИНУ.
 *
 * Зачем он появился. Липких слоёв у гостя несколько — плавающая группа с
 * номером, верхняя строка десктопа, плита плана, полоса вкладок, строка
 * категорий заведения, — и каждый считал свою позицию САМ: один публиковал
 * край переменной CSS, другой брал число из словаря, третий складывал в своём
 * файле «высота группы + отступ + высота плиты × масштаб». Пока чисел было
 * два, они совпадали. Дальше они начали расходиться на каждой новой ширине и
 * позиции прокрутки, и мы трижды чинили последствия: плашка над планом,
 * вкладки под плитой, «всё наезжает друг на друга».
 *
 * Правило стека одно: КАЖДЫЙ СЛОЙ ЗНАЕТ ИЗМЕРЕННУЮ ВЫСОТУ ПРЕДЫДУЩИХ. Слой
 * публикует полосу, которую занимает сверху, и получает свой `top` — сумму
 * полос всех слоёв выше. Ни одного числа в компонентах, ни одной догадки о
 * чужом размере, ни одной добавки на вырез: вырез уже внутри измерения.
 *
 * ИЗМЕРЯЕТСЯ ВИДИМАЯ ГЕОМЕТРИЯ, а не layout-высота. Плита при скролле
 * сжимается трансформом: место под неё зарезервировано постоянным (иначе
 * менялась бы высота документа и экран трясло бы — G5d), а видимый размер
 * меняется. `getBoundingClientRect()` возвращает именно видимый, и полоса
 * вкладок поднимается вслед за сжатием — освободившееся место действительно
 * освобождается.
 *
 * `ResizeObserver` на трансформ не срабатывает — поэтому у слоя есть и ручная
 * публикация: тот, кто меняет свой видимый размер сам (плита), сам же и
 * сообщает его в том же кадре, где считает масштаб.
 */

type Listener = () => void;

class StickyStackStore {
  private readonly strips = new Map<number, number>();
  private readonly listeners = new Set<Listener>();
  /** Кэш ответов `top(order)`: `useSyncExternalStore` требует стабильного значения. */
  private readonly tops = new Map<number, number>();

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(order: number, px: number): void {
    const rounded = Math.round(px);
    if (this.strips.get(order) === rounded) return;
    this.strips.set(order, rounded);
    this.recompute();
  }

  forget(order: number): void {
    if (!this.strips.has(order)) return;
    this.strips.delete(order);
    this.recompute();
  }

  top(order: number): number {
    return this.tops.get(order) ?? this.computeTop(order);
  }

  private computeTop(order: number): number {
    let sum = 0;
    for (const [candidate, strip] of this.strips) {
      if (candidate < order) sum += strip;
    }
    return sum;
  }

  private recompute(): void {
    let changed = false;
    // Пересчитываем ВСЕ известные позиции разом: слой ниже обязан узнать о
    // чужом изменении в том же кадре, иначе на один кадр они перекрываются.
    for (const order of [...this.strips.keys(), ...this.tops.keys()]) {
      const next = this.computeTop(order);
      if (this.tops.get(order) !== next) {
        this.tops.set(order, next);
        changed = true;
      }
    }
    if (changed) this.listeners.forEach((listener) => listener());
  }

  /** Регистрация читателя: без неё `top()` не попал бы в пересчёт. */
  track(order: number): void {
    if (!this.tops.has(order)) this.tops.set(order, this.computeTop(order));
  }
}

const StickyStackContext = createContext<StickyStackStore | null>(null);

export function StickyStackProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => new StickyStackStore(), []);
  return <StickyStackContext.Provider value={store}>{children}</StickyStackContext.Provider>;
}

export interface StickyLayerOptions {
  /**
   * Что считать занятой полосой.
   *
   * `height` — собственная высота: так ведёт себя слой, стоящий В ПОТОКЕ друг
   * за другом (верхняя строка десктопа, вкладки).
   * `bottom` — нижний край в координатах окна: так ведёт себя слой,
   * прикреплённый к окну (`fixed`) — плавающая группа телефона. Её отступ
   * сверху и безопасная зона уже внутри измерения.
   */
  measure?: 'height' | 'bottom';
  /** Воздух под слоем. Часть полосы: следующий слой отступает вместе с ним. */
  gap?: number;
  /** Слой выключен (нет на этой ширине) — полосы он не занимает. */
  enabled?: boolean;
  /**
   * Масштаб, которым слой сжат трансформом.
   *
   * `getBoundingClientRect()` родителя трансформ ребёнка не уменьшает, а
   * `ResizeObserver` его не видит вовсе — поэтому видимую полосу считаем сами:
   * измеренная высота × масштаб. Так плита плана отдаёт освободившееся место
   * вкладкам, не меняя при этом высоту документа.
   */
  scale?: number;
}

export interface StickyLayer<T extends HTMLElement = HTMLDivElement> {
  /** Повесить на сам липкий элемент — он и будет измерен. */
  ref: (node: T | null) => void;
  /** Куда пинить: `top` в пикселях, уже с учётом всех слоёв выше. */
  top: number;
  /**
   * Сообщить ВИДИМУЮ высоту вручную. Нужно там, где размер меняется
   * трансформом: `ResizeObserver` таких изменений не видит.
   */
  publish: (px: number) => void;
}

/**
 * Слой стека. `order` — порядок сверху вниз; слои с меньшим номером выше.
 */
export function useStickyLayer<T extends HTMLElement = HTMLDivElement>(
  order: number,
  { measure = 'height', gap = 0, enabled = true, scale = 1 }: StickyLayerOptions = {},
): StickyLayer<T> {
  const store = useContext(StickyStackContext);
  const nodeRef = useRef<T | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  if (store) store.track(order);

  const top = useSyncExternalStore(
    store ? store.subscribe : () => () => {},
    () => (store ? store.top(order) : 0),
    () => 0,
  );

  const publish = useCallback(
    (px: number) => {
      if (store && enabled) store.set(order, px + gap);
    },
    [store, order, gap, enabled],
  );

  const measureNode = useCallback(() => {
    const node = nodeRef.current;
    if (!node || !store) return;
    if (!enabled) {
      store.forget(order);
      return;
    }
    const rect = node.getBoundingClientRect();
    const strip = measure === 'bottom' ? rect.bottom : rect.height * scale;
    store.set(order, strip + gap);
  }, [store, order, measure, gap, enabled, scale]);

  const ref = useCallback(
    (node: T | null) => {
      observerRef.current?.disconnect();
      nodeRef.current = node;
      if (!node) {
        store?.forget(order);
        return;
      }
      measureNode();
      const observer = new ResizeObserver(measureNode);
      observer.observe(node);
      observerRef.current = observer;
    },
    [measureNode, store, order],
  );

  // Смена ширины окна и безопасной зоны меняет и полосу: `ResizeObserver`
  // ловит не всё (у `fixed`-слоя меняется только положение).
  useLayoutEffect(() => {
    measureNode();
    window.addEventListener('resize', measureNode);
    window.addEventListener('orientationchange', measureNode);
    return () => {
      window.removeEventListener('resize', measureNode);
      window.removeEventListener('orientationchange', measureNode);
    };
  }, [measureNode]);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      store?.forget(order);
    },
    [store, order],
  );

  return { ref, top, publish };
}

/**
 * Порядок слоёв — ОДИН НА ВСЮ ВИТРИНУ, а не свой у каждого экрана.
 *
 * Номера здесь и есть тот самый «один источник правды»: чтобы понять, что под
 * чем лежит, достаточно прочитать этот список, а не собирать арифметику по
 * четырём файлам.
 */
export const STICKY = {
  /** Плавающая группа телефона и верхняя строка десктопа: они не сосуществуют. */
  shell: 0,
  /** Плита плана номера. */
  plate: 1,
  /** Полоса вкладок номера и строка категорий заведения. */
  bar: 2,
} as const;
