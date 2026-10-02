import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * ПЛАВАЮЩАЯ ГРУППА НЕ ЛОЖИТСЯ НА КНОПКИ ЭКРАНА (партия 29).
 *
 * В партии 25 логотип отеля встал в плавающую группу телефона (номер,
 * корзина, меню). Группа прижата к правому краю и растёт влево: у «Сиалии»
 * на 360 и 390 логотип лёг на «К сервисам» шапки заведения. А в режиме
 * просмотра на 360 туда ложился и сам чип «Войти по номеру» — без всякого
 * логотипа.
 *
 * Кнопки слева есть не на каждом экране, и ширины у каждого отеля и языка
 * свои, поэтому решение — замером, а не числом. Элементы, на которые группе
 * ложиться нельзя, помечены `data-topbar-start`. Сначала уступает знак, потом
 * текст: не хватает места — логотипа нет (имя отеля остаётся в `alt` и в
 * заголовке документа); не хватает и без логотипа — чип «Войти по номеру»
 * сжимается до значка (полный текст — в `aria-label`). Кнопки важнее знака.
 *
 * Ширина логотипа — из натурального размера картинки (вписанной в высоту
 * `LOGO_HEIGHT`, не шире `LOGO_MAX`), а не из DOM: спрятанный логотип ширины
 * не имеет, а решать, вернуть ли его, надо по той ширине, что он займёт. Так же
 * и полный чип: его ширина запоминается, пока он виден.
 */

export const LOGO_HEIGHT = 22;
export const LOGO_MAX = 88;
/** Поля логотипа (`px: 0.75` по 6 px) и промежуток группы (`spacing: 0.5`). */
const LOGO_CHROME = 12 + 4;
const GAP = 8;
/** Что считается верхней полосой: элементы, начинающиеся выше этой отметки страницы. */
const TOP_BAND = 120;

export interface TopBarFit {
  /** Показывать логотип в группе. */
  logo: boolean;
  /** Чип «Войти по номеру» — значком. */
  compact: boolean;
}

export function useTopBarFit(logo: string | null, enabled: boolean, routeKey: string): TopBarFit {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [fit, setFit] = useState<TopBarFit>({ logo: true, compact: false });
  // Сколько чип теряет, сжимаясь, — меряется на лету; до замера — оценка.
  const widths = useRef({ full: 0, compact: 0 });

  useEffect(() => {
    setNatural(null);
    if (!logo) return;
    const image = new Image();
    image.onload = () => setNatural({ w: image.naturalWidth, h: image.naturalHeight });
    image.src = logo;
  }, [logo]);

  useLayoutEffect(() => {
    if (!enabled) return;
    const want =
      logo && natural && natural.h ? Math.min(LOGO_MAX, (natural.w * LOGO_HEIGHT) / natural.h) + LOGO_CHROME : 0;

    const check = () => {
      const group = document.querySelector<HTMLElement>('[data-testid="guest-floating-group"]');
      if (!group) return;
      const rtl = getComputedStyle(group).direction === 'rtl';
      const rect = group.getBoundingClientRect();
      const shown = group.querySelector<HTMLElement>('[data-testid="guest-phone-logo"]');
      const shownWidth = shown && getComputedStyle(shown).display !== 'none' ? shown.getBoundingClientRect().width + 4 : 0;
      const chip = group.querySelector<HTMLElement>('[data-testid="guest-identify"]');
      const isCompact = chip?.dataset.compact === 'true';
      if (chip) widths.current[isCompact ? 'compact' : 'full'] = chip.getBoundingClientRect().width;
      const saving = chip
        ? Math.max(0, (widths.current.full || 0) - (widths.current.compact || 40))
        : 0;

      // Ширина группы без логотипа и с ПОЛНЫМ чипом.
      const bare = rect.width - shownWidth + (isCompact ? saving : 0);
      const start = rtl ? rect.left : rect.right;

      let room = Infinity;
      document.querySelectorAll<HTMLElement>('[data-topbar-start]').forEach((element) => {
        const box = element.getBoundingClientRect();
        if (!box.width || box.top + window.scrollY > TOP_BAND) return;
        room = Math.min(room, rtl ? box.left - start : start - box.right);
      });
      // `room` — сколько места у группы от края экрана до ближайшей кнопки.
      const compact = Boolean(chip) && bare + GAP > room;
      const width = bare - (compact ? saving : 0);
      const showLogo = Boolean(want) && width + want + GAP <= room;
      setFit((previous) =>
        previous.logo === showLogo && previous.compact === compact ? previous : { logo: showLogo, compact },
      );
    };

    check();
    const resize = new ResizeObserver(check);
    resize.observe(document.body);
    // Кнопка «назад» появляется, когда экран дорисовался, а не в момент перехода.
    const mutations = new MutationObserver(check);
    mutations.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', check);
    return () => {
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [enabled, logo, natural, routeKey]);

  return fit;
}
