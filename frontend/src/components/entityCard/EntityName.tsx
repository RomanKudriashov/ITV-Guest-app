import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Popper from '@mui/material/Popper';
import Portal from '@mui/material/Portal';
import { useMediaQuery, useTheme } from '@mui/material';
import { alpha, type SxProps, type Theme } from '@mui/material/styles';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';

import { ApiError, api } from '@/api/client';
import { useAuth } from '@/auth';
import { formatMoney } from '@/utils/money';

import { CARD_STALE_MS, cardKeys, fetchCard, type EntityType, type OrderCardData } from './api';
import { EntityCardNotice, EntityCardSkeleton, EntityCardView } from './EntityCardView';
import { cardModel } from './registry';
import { isSuspended, onSuspend } from './suspend';

/**
 * ИМЯ СУЩНОСТИ С КАРТОЧКОЙ (партия 59а) — одно на все экраны CMS и трекера.
 *
 *     <EntityName type="order" id={order.id} to={`/tracker/order/${order.id}`}>№ {n}</EntityName>
 *
 * МЕХАНИКА (РАЗВЕДКА-59, Б3; замеры v2):
 *   — ПК: намерение (150 мс наведения или фокус) — запрос; 350 мс — карточка;
 *     уход и с имени, и с карточки — закрыть через 200 мс. Мышь можно увести
 *     на карточку и нажать действие. Открыта одна карточка.
 *   — КЛИК ПО ИМЕНИ НА ПК — ТО ЖЕ, ЧТО БЫЛО: с адресом (`to`) — переход
 *     (средняя кнопка — вкладка); без адреса клик уходит строке, как раньше
 *     (раскрыть строку списка, открыть шторку заказа на доске). Карточка на ПК
 *     — только наведение и фокус: она не отнимает у экрана его клик.
 *   — Клавиатура: фокус с клавиатуры открывает сразу, Esc закрывает и
 *     возвращает фокус на имя.
 *   — Телефон (`hover: none`): первое нажатие — карточка листом снизу, переход
 *     — кнопкой «Открыть». Лист — в ПОРТАЛЕ: стеклянный предок с
 *     `backdrop-filter` становится опорой для `fixed`, и без портала лист
 *     рисовался внутри строки (замер v2).
 *   — Имя с адресом внутри кликабельной строки клик НЕ отдаёт строке: иначе
 *     вместе с переходом раскрылась бы и строка. На телефоне нажатие на имя
 *     строке не уходит никогда — оно открывает лист.
 *   — `bare` — обёртка готового элемента (кубик номера — сам кнопка): без
 *     подчёркивания и своей кнопки, только наведение и фокус.
 *   — Перетаскивание на доске: на время перетаскивания карточки гаснут
 *     (`suspendEntityCards`), внутри `DragOverlay` — `EntityCardsOff`.
 *   — Кэш 60 с, сокет и действия сбрасывают его (`cardKeys.all`).
 */

export const INTENT_MS = 150;
export const HOVER_OPEN_MS = 350;
export const HOVER_CLOSE_MS = 200;

/** Внутри — имена без карточек: `DragOverlay` доски, печать, превью. */
const CardsOffContext = createContext(false);

export function EntityCardsOff({ children }: { children: ReactNode }) {
  return <CardsOffContext.Provider value>{children}</CardsOffContext.Provider>;
}

// Открыта одна карточка: новая закрывает прежнюю.
let closeCurrent: (() => void) | null = null;

interface EntityNameProps {
  type: EntityType;
  /** Ключ ручки: id, а у номера — можно номер, у заведения — код точки. */
  id: string;
  /** Куда ведёт клик по имени (как раньше). Нет — клик открывает карточку. */
  to?: string;
  children: ReactNode;
  testId?: string;
  sx?: SxProps<Theme>;
  /** Обернуть готовый кликабельный элемент: без подчёркивания и своей кнопки. */
  bare?: boolean;
}

export function EntityName({ type, id, to, children, testId, sx, bare }: EntityNameProps) {
  const off = useContext(CardsOffContext);
  if (off || !id) {
    return <>{children}</>;
  }
  return (
    <EntityNameLive type={type} id={id} to={to} testId={testId} sx={sx} bare={bare}>
      {children}
    </EntityNameLive>
  );
}

function EntityNameLive({ type, id, to, children, testId, sx, bare }: EntityNameProps) {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const { user, hotel } = useAuth();
  const queryClient = useQueryClient();
  const touch = useMediaQuery('(hover: none)');
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const sheet = touch || phone;

  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [wanted, setWanted] = useState(false);
  const openTimer = useRef<number | undefined>(undefined);
  const intentTimer = useRef<number | undefined>(undefined);
  // Esc возвращает фокус на имя — и этот фокус «с клавиатуры» не должен
  // открыть карточку обратно.
  const refocusing = useRef(false);

  const close = useCallback(() => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(intentTimer.current);
    setOpen(false);
  }, []);

  const show = useCallback(() => {
    if (isSuspended()) return;
    if (closeCurrent && closeCurrent !== close) closeCurrent();
    closeCurrent = close;
    setWanted(true);
    setOpen(true);
  }, [close]);

  const schedule = useCallback(
    (next: boolean, ms: number) => {
      window.clearTimeout(openTimer.current);
      openTimer.current = window.setTimeout(() => (next ? show() : close()), ms);
    },
    [close, show],
  );

  useEffect(
    () => () => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(intentTimer.current);
      if (closeCurrent === close) closeCurrent = null;
    },
    [close],
  );

  // Перетаскивание началось — карточка гаснет и не открывается до конца.
  useEffect(() => onSuspend((suspended) => suspended && close()), [close]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        refocusing.current = true;
        anchor?.focus();
        refocusing.current = false;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, anchor]);

  const query = useQuery({
    queryKey: cardKeys.one(type, id),
    queryFn: () => fetchCard(type, id),
    enabled: wanted,
    staleTime: CARD_STALE_MS,
    retry: false,
  });

  const advance = useMutation({
    mutationFn: ({ order, code }: { order: OrderCardData; code: string }) =>
      api.post(`/tracker/order/${order.id}/status`, { status: code }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: cardKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['tracker'] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  const intent = () => {
    window.clearTimeout(intentTimer.current);
    intentTimer.current = window.setTimeout(() => setWanted(true), INTENT_MS);
  };

  const money = (minor: number, currency: string) =>
    formatMoney(minor, currency || hotel?.currency || 'RUB', hotel?.currency_minor_units ?? 2, i18n.language, {
      trimZeroFraction: true,
    });

  let body: ReactNode;
  if (query.data) {
    body = (
      <EntityCardView
        sheet={sheet}
        testId={`entity-card-${type}`}
        model={cardModel(query.data, {
          t,
          user,
          money,
          advance: (order, code) => advance.mutate({ order, code }),
          busy: advance.isPending,
        })}
      />
    );
  } else if (query.error) {
    const status = query.error instanceof ApiError ? query.error.status : 0;
    const text =
      status === 403 ? t('entityCard.noAccess') : status === 404 ? t('entityCard.notFound') : t('entityCard.failed');
    body = <EntityCardNotice name={children} text={text} sheet={sheet} />;
  } else {
    body = <EntityCardSkeleton name={children} sheet={sheet} />;
  }

  const triggerSx: SxProps<Theme> = [
    {
      color: 'inherit',
      font: 'inherit',
      textDecorationLine: 'underline',
      textDecorationStyle: 'dotted',
      textDecorationThickness: '1.5px',
      textUnderlineOffset: '3px',
      textDecorationColor: (th: Theme) => alpha(th.palette.text.primary, 0.45),
      cursor: 'pointer',
      bgcolor: 'transparent',
      border: 0,
      p: 0,
      m: 0,
      '&:hover, &:focus-visible, &[aria-expanded="true"]': {
        textDecorationStyle: 'solid',
        textDecorationColor: (th: Theme) => th.palette.primary.main,
      },
    },
    ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
  ];

  const handlers = {
    // У `bare` (display: contents) своей рамки нет — карточку ставим к
    // обёрнутому элементу, иначе Popper увёл бы её в угол экрана.
    ref: (el: HTMLElement | null) => setAnchor(bare && el?.firstElementChild instanceof HTMLElement ? el.firstElementChild : el),
    'data-testid': testId,
    'data-entity-name': type,
    'aria-haspopup': 'dialog' as const,
    'aria-expanded': open,
    onMouseEnter: () => {
      if (sheet) return;
      intent();
      schedule(true, HOVER_OPEN_MS);
    },
    onMouseLeave: () => {
      if (sheet) return;
      window.clearTimeout(intentTimer.current);
      schedule(false, HOVER_CLOSE_MS);
    },
    onFocus: (event: React.FocusEvent<HTMLElement>) => {
      // Только фокус с клавиатуры: клик мышью тоже ставит фокус, и карточка
      // открывалась бы под курсором ещё до задержки.
      if (sheet || refocusing.current || !event.currentTarget.matches(':focus-visible')) return;
      show();
    },
    onBlur: () => {
      if (!sheet) schedule(false, HOVER_CLOSE_MS);
    },
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      if (sheet) {
        // Телефон: первое нажатие — карточка, переход — «Открыть» в ней.
        event.preventDefault();
        event.stopPropagation();
        if (open) close();
        else show();
        return;
      }
      close();
      // С адресом — переход, и строка под именем не «нажимается».
      if (to) event.stopPropagation();
    },
  };

  return (
    <>
      {bare ? (
        <Box component="span" sx={[{ display: 'contents' }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]} {...handlers}>
          {children}
        </Box>
      ) : to ? (
        <Box component={RouterLink} to={to} sx={triggerSx} {...handlers}>
          {children}
        </Box>
      ) : (
        // Без адреса — span с ролью кнопки, а не <button>: имя часто стоит
        // внутри кнопки (строка списка, карточка доски), а кнопка в кнопке —
        // невалидная разметка.
        <Box component="span" role="button" tabIndex={0} sx={triggerSx} {...handlers}>
          {children}
        </Box>
      )}
      {sheet ? (
        open ? (
          <Portal>
            <Box
              data-testid="entity-sheet"
              onClick={(event) => {
                event.stopPropagation();
                close();
              }}
              sx={{
                position: 'fixed',
                inset: 0,
                zIndex: (th) => th.zIndex.modal,
                bgcolor: (th) => alpha(th.palette.brand.scrim, 0.45),
                display: 'flex',
                alignItems: 'flex-end',
              }}
            >
              <Box sx={{ width: '100%' }} onClick={(event) => event.stopPropagation()}>
                {body}
              </Box>
            </Box>
          </Portal>
        ) : null
      ) : (
        <Popper
          open={open && Boolean(anchor)}
          anchorEl={anchor}
          placement="bottom-start"
          modifiers={[
            { name: 'offset', options: { offset: [0, 8] } },
            { name: 'flip', enabled: true },
            { name: 'preventOverflow', options: { padding: 8 } },
          ]}
          sx={{ zIndex: (th) => th.zIndex.tooltip }}
        >
          <Box
            onMouseEnter={() => schedule(true, 0)}
            onMouseLeave={() => schedule(false, HOVER_CLOSE_MS)}
            onClick={(event) => event.stopPropagation()}
          >
            {body}
          </Box>
        </Popper>
      )}
    </>
  );
}
