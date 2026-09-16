/**
 * СЕТКА НОМЕРНОГО ФОНДА.
 *
 * Строка на этаж, кубики по порядку, корпуса блоками. Смысл сетки — в том, что
 * этажи читаются ОДИН ПОД ДРУГИМ; из этого следуют два правила, которые здесь
 * важнее удобства кода:
 *
 *   1. ПРОПУСКИ В НУМЕРАЦИИ — ПУСТЫЕ ЯЧЕЙКИ. Если на третьем этаже нет 303, а
 *      на четвёртом 403 есть, ряды обязаны сойтись по колонке. Иначе сетка
 *      превращается в обычный список, только мельче.
 *   2. ОТФИЛЬТРОВАННОЕ ГАСНЕТ, А НЕ ИСЧЕЗАЕТ. Убрав кубики, мы порвём ряды —
 *      и человек потеряет то самое, ради чего открыл сетку.
 *
 * ЦВЕТ ЗДЕСЬ ЗНАЧИТ ЗАНЯТОСТЬ, И ТОЛЬКО ЕЁ. Занятости у нас нет и не будет до
 * появления PMS, поэтому все кубики серые, а легенда объясняет, почему.
 * Красить ими уборку или «вне продажи» нельзя: цвет — самый громкий сигнал на
 * экране, и, отдав его другому вопросу, мы не сможем забрать его назад, когда
 * появится настоящая занятость. Уборка и «вне продажи» — значками.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import CleaningServicesOutlinedIcon from '@mui/icons-material/CleaningServicesOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';

import { fetchRoomsGrid } from '@/api/hotelAdmin';
import type { GridRoom, RoomCategory, RoomFilters } from '@/api/hotelAdminTypes';
import { queryKeys } from '@/api/queryKeys';
import { EmptyState } from '@/components/EmptyState';

/** Как часто сетка перечитывает себя. Живое обновление без своего канала. */
const REFRESH_MS = 15_000;
/** Задержка хинта. Полсекунды: мышь, проходящая мимо, хинтов не открывает. */
const HINT_DELAY_MS = 500;

export interface GridSelection {
  picked: Set<string>;
  allMatching: boolean;
  toggle: (id: string) => void;
  /** Выделение рамкой отдаёт сразу пачку — по одному было бы N перерисовок. */
  pickMany: (ids: string[]) => void;
}

export function RoomGrid({
  search,
  filters,
  categories,
  selection,
  onOpenRoom,
}: {
  search: string;
  filters: RoomFilters & { has_orders?: boolean; has_control?: boolean };
  categories: RoomCategory[];
  selection: GridSelection;
  onOpenRoom: (room: GridRoom) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));

  const gridQuery = useQuery({
    queryKey: [...queryKeys.rooms, 'grid'],
    queryFn: fetchRoomsGrid,
    // Живое обновление — перечитыванием, а не своим каналом: у фонда нет
    // потока событий, а заводить его ради подсветки кубика дороже, чем
    // спрашивать раз в пятнадцать секунд. Что это опрос, видно и в сети.
    refetchInterval: REFRESH_MS,
  });

  const grid = gridQuery.data;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  /*
    ВЫДЕЛЕНИЕ РАМКОЙ. Тот же механизм выборки, что в списке, — просто другой
    жест: в сетке естественно обвести угол этажа, а не щёлкать двадцать
    кубиков подряд. Рамка начинается ТОЛЬКО с пустого места: начавшись на
    кубике, она отбирала бы у него клик, то есть открытие панели.
  */
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(
    null,
  );

  const marqueeRect = marquee
    ? {
        left: Math.min(marquee.x1, marquee.x2),
        top: Math.min(marquee.y1, marquee.y2),
        width: Math.abs(marquee.x2 - marquee.x1),
        height: Math.abs(marquee.y2 - marquee.y1),
      }
    : null;
  const [flashing, setFlashing] = useState<Set<string>>(new Set());
  const previous = useRef<Map<string, string>>(new Map());

  /*
    ПОДСВЕТКА ИЗМЕНИВШЕГОСЯ. Сравниваем не объекты, а слепок того, что видно на
    кубике: иначе любой ответ сервера (новое время ответа, другой порядок
    ключей) читался бы как изменение и сетка мигала бы вся целиком.
  */
  useEffect(() => {
    if (!grid) return;
    const snapshot = new Map<string, string>();
    const changed: string[] = [];
    for (const building of grid.buildings) {
      for (const floor of building.floors) {
        for (const room of floor.rooms) {
          const mark = [
            room.active_orders,
            room.overdue_orders,
            room.housekeeping,
            room.out_of_service,
            room.category_id ?? '',
            room.device ?? '',
          ].join('|');
          snapshot.set(room.id, mark);
          const before = previous.current.get(room.id);
          if (before !== undefined && before !== mark) changed.push(room.id);
        }
      }
    }
    previous.current = snapshot;
    if (changed.length === 0) return;

    setFlashing(new Set(changed));
    const timer = window.setTimeout(() => setFlashing(new Set()), 1000);
    return () => window.clearTimeout(timer);
  }, [grid]);

  /** Проходит ли кубик текущую выборку. Не проходит — гаснет, но остаётся. */
  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (room: GridRoom): boolean => {
      if (term && !room.number.toLowerCase().includes(term)) return false;
      if (filters.floor && room.floor !== filters.floor) return false;
      if (filters.category === 'none' && room.category_id) return false;
      if (filters.category && filters.category !== 'none' && room.category_id !== filters.category)
        return false;
      if (filters.housekeeping && room.housekeeping !== filters.housekeeping) return false;
      if (filters.out_of_service !== undefined && room.out_of_service !== filters.out_of_service)
        return false;
      if (filters.has_orders && room.active_orders === 0) return false;
      if (filters.has_control && !room.control_type) return false;
      return true;
    };
  }, [search, filters]);

  const allRooms = useMemo(
    () =>
      (grid?.buildings ?? []).flatMap((building) =>
        building.floors.flatMap((floor) => floor.rooms),
      ),
    [grid],
  );
  const shown = allRooms.filter(matches).length;

  /*
    ПОИСК ДОВОДИТ ДО КУБИКА. Ввёл 305 — сетка прокрутилась к нему; без этого на
    фонде в три сотни «подсветился» означает «где-то подсветился».
  */
  const foundRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!search.trim()) return;
    foundRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [search, grid]);

  /* На телефоне открыт первый этаж, остальные свёрнуты: иначе экран — лента. */
  const firstFloorKey = useRef<string | null>(null);
  useEffect(() => {
    if (!grid || !isPhone || firstFloorKey.current !== null) return;
    const keys: string[] = [];
    for (const building of grid.buildings) {
      for (const floor of building.floors) keys.push(`${building.zone}:${floor.floor}`);
    }
    firstFloorKey.current = keys[0] ?? '';
    setCollapsed(new Set(keys.slice(1)));
  }, [grid, isPhone]);

  const finishMarquee = () => {
    if (!marqueeRect || !surfaceRef.current) {
      setMarquee(null);
      return;
    }
    // Рамка меньше пальца — это промах, а не выделение: считать его выбором
    // значило бы выделять по случайному клику мимо кубика.
    if (marqueeRect.width < 8 && marqueeRect.height < 8) {
      setMarquee(null);
      return;
    }
    const surface = surfaceRef.current.getBoundingClientRect();
    const box = {
      left: surface.left + marqueeRect.left,
      top: surface.top + marqueeRect.top,
      right: surface.left + marqueeRect.left + marqueeRect.width,
      bottom: surface.top + marqueeRect.top + marqueeRect.height,
    };

    const caught: string[] = [];
    surfaceRef.current
      .querySelectorAll<HTMLElement>('[data-room-id]')
      .forEach((node) => {
        // Погашенные рамкой не ловятся: человек обводит то, что видит.
        if (node.dataset.dimmed === 'yes') return;
        const rect = node.getBoundingClientRect();
        const hit =
          rect.left < box.right &&
          rect.right > box.left &&
          rect.top < box.bottom &&
          rect.bottom > box.top;
        if (hit && node.dataset.roomId) caught.push(node.dataset.roomId);
      });

    if (caught.length) selection.pickMany(caught);
    setMarquee(null);
  };

  if (gridQuery.isLoading) {
    return (
      <Stack spacing={1} data-testid="rooms-grid-loading">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} variant="rounded" height={64} />
        ))}
      </Stack>
    );
  }

  if (gridQuery.isError) {
    return <Alert severity="error">{t('hotel.rooms.loadError')}</Alert>;
  }

  if (!grid || grid.total === 0) {
    return (
      <EmptyState
        testId="rooms-grid-empty"
        title={t('hotel.rooms.empty')}
        description={t('hotel.rooms.gridEmptyHint')}
      />
    );
  }

  const singleBuilding = grid.buildings.length <= 1;

  return (
    <Box
      data-testid="rooms-grid"
      ref={surfaceRef}
      sx={{ position: 'relative' }}
      onPointerDown={(event) => {
        // Только пустое место и только основная кнопка.
        if (event.button !== 0) return;
        if ((event.target as HTMLElement).closest('[data-room-id]')) return;
        if ((event.target as HTMLElement).closest('[data-no-marquee]')) return;
        const surface = surfaceRef.current?.getBoundingClientRect();
        if (!surface) return;
        /*
          ЗАХВАТ УКАЗАТЕЛЯ. Первая версия завершала рамку, как только указатель
          покидал сетку, — а последний кубик ряда стоит вплотную к её краю.
          Человек, дотянувший рамку до конца ряда, терял её посреди жеста.
          С захватом движение и отпускание доходят до сетки и за её краем, а
          рамка просто упирается в границу.
        */
        event.currentTarget.setPointerCapture(event.pointerId);
        const x = event.clientX - surface.left;
        const y = event.clientY - surface.top;
        setMarquee({ x1: x, y1: y, x2: x, y2: y });
      }}
      onPointerMove={(event) => {
        if (!marquee) return;
        const surface = surfaceRef.current?.getBoundingClientRect();
        if (!surface) return;
        const clamp = (value: number, limit: number) => Math.min(Math.max(value, 0), limit);
        setMarquee((prev) =>
          prev
            ? {
                ...prev,
                x2: clamp(event.clientX - surface.left, surface.width),
                y2: clamp(event.clientY - surface.top, surface.height),
              }
            : prev,
        );
      }}
      onPointerUp={finishMarquee}
      // Отмена жеста системой (свернули окно, пришёл звонок) — не выделение.
      onPointerCancel={() => setMarquee(null)}
    >
      {marqueeRect ? (
        <Box
          data-testid="rooms-grid-marquee"
          sx={{
            position: 'absolute',
            left: marqueeRect.left,
            top: marqueeRect.top,
            width: marqueeRect.width,
            height: marqueeRect.height,
            border: 1,
            borderColor: 'primary.main',
            bgcolor: 'primary.main',
            opacity: 0.12,
            pointerEvents: 'none',
            zIndex: 2,
          }}
        />
      ) : null}
      {/*
        ЛЕГЕНДА ОБЯЗАТЕЛЬНА. Серые кубики без объяснения читаются как «данные не
        доехали»; на самом деле это «занятости у нас нет», и сказать это должен
        экран, а не человек, который однажды спросит.
      */}
      <Alert severity="info" sx={{ mb: 1 }} data-no-marquee data-testid="rooms-grid-legend">
        <Stack spacing={0.5}>
          <Typography variant="body2">{t('hotel.rooms.legendOccupancy')}</Typography>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <LegendItem icon={<BuildOutlinedIcon fontSize="inherit" color="warning" />}
              label={t('hotel.rooms.outOfService')} />
            <LegendItem icon={<CleaningServicesOutlinedIcon fontSize="inherit" />}
              label={t('hotel.rooms.legendHousekeeping')} />
            <LegendItem icon={<Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main' }} />}
              label={t('hotel.rooms.legendOrders')} />
            <LegendItem icon={<PowerSettingsNewIcon fontSize="inherit" color="disabled" />}
              label={t('hotel.rooms.legendDevice')} />
          </Stack>
        </Stack>
      </Alert>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="body2" color="text.secondary" data-testid="rooms-grid-counter">
          {t('hotel.rooms.gridShown', { shown, total: grid.total })}
        </Typography>
        {grid.truncated ? (
          <Chip size="small" color="warning" label={t('hotel.rooms.gridTruncated')} />
        ) : null}
      </Stack>

      {grid.buildings.map((building) => (
        <Box key={building.zone || 'single'} sx={{ mb: 2 }}>
          {/* Корпус один — заголовка нет вовсе: подписывать нечего. */}
          {!singleBuilding ? (
            <Typography
              variant="subtitle2"
              sx={{ mb: 0.5 }}
              data-testid={`rooms-grid-building-${building.zone || 'none'}`}
            >
              {building.zone || t('hotel.rooms.buildingNone')}
            </Typography>
          ) : null}

          {building.floors.map((floor) => {
            const key = `${building.zone}:${floor.floor}`;
            const isCollapsed = collapsed.has(key);
            const visible = floor.rooms.filter(matches).length;

            return (
              <Box key={key} sx={{ mb: 1 }}>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                  sx={{ cursor: 'pointer', userSelect: 'none' }}
                  data-testid={`rooms-grid-floor-${floor.floor || 'none'}`}
                >
                  <ExpandMoreIcon
                    fontSize="small"
                    sx={{
                      transform: isCollapsed ? 'rotate(-90deg)' : 'none',
                      transition: 'transform .15s',
                    }}
                  />
                  <Typography variant="body2" fontWeight={500}>
                    {floor.floor
                      ? t('hotel.rooms.floorTitle', { floor: floor.floor })
                      : t('hotel.rooms.floorNone')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {visible === floor.rooms.length
                      ? t('hotel.rooms.floorCount', { count: floor.rooms.length })
                      : t('hotel.rooms.floorCountFiltered', {
                          shown: visible,
                          total: floor.rooms.length,
                        })}
                  </Typography>
                </Stack>
                <Collapse in={!isCollapsed} unmountOnExit>
                  <Box
                    sx={{
                      display: 'grid',
                      // Колонка фиксированной ширины — чтобы этажи сходились
                      // друг под другом, а пропуски читались как пропуски.
                      gridTemplateColumns: `repeat(auto-fill, minmax(${isPhone ? 56 : 84}px, 1fr))`,
                      gap: 0.75,
                      mt: 0.5,
                    }}
                  >
                    {withGaps(floor.rooms).map((cell, index) =>
                      cell === null ? (
                        <Box
                          key={`gap-${index}`}
                          sx={{ height: isPhone ? 52 : 68 }}
                          data-testid="rooms-grid-gap"
                        />
                      ) : (
                        <RoomCube
                          key={cell.id}
                          room={cell}
                          categories={categories}
                          dimmed={!matches(cell)}
                          found={Boolean(
                            search.trim() &&
                              cell.number.toLowerCase().includes(search.trim().toLowerCase()),
                          )}
                          flashing={flashing.has(cell.id)}
                          picked={selection.allMatching || selection.picked.has(cell.id)}
                          compact={isPhone}
                          withHint={!isPhone}
                          innerRef={
                            search.trim() &&
                            cell.number.toLowerCase().includes(search.trim().toLowerCase())
                              ? foundRef
                              : undefined
                          }
                          onOpen={() => onOpenRoom(cell)}
                          onPick={() => selection.toggle(cell.id)}
                        />
                      ),
                    )}
                  </Box>
                </Collapse>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

function LegendItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      {icon}
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  );
}

/**
 * Пропуски в нумерации — пустыми ячейками.
 *
 * Разрыв определяется по числовой части номера: 301, 302, 305 → два пустых
 * места перед 305. Нечисловые номера («Люкс-1») разрывов не образуют — у них
 * нет позиции в ряду, и выдумывать её нельзя.
 */
function withGaps(rooms: GridRoom[]): (GridRoom | null)[] {
  const MAX_GAP = 8; // дыра шире — это не пропуск, а другой корпус нумерации
  const cells: (GridRoom | null)[] = [];
  let previousNumber: number | null = null;

  for (const room of rooms) {
    const match = room.number.match(/(\d+)\s*$/);
    const value = match ? Number(match[1]) : null;
    if (value !== null && previousNumber !== null) {
      const gap = value - previousNumber - 1;
      if (gap > 0 && gap <= MAX_GAP) {
        for (let index = 0; index < gap; index += 1) cells.push(null);
      }
    }
    cells.push(room);
    previousNumber = value;
  }
  return cells;
}

function RoomCube({
  room,
  categories,
  dimmed,
  found,
  flashing,
  picked,
  compact,
  withHint,
  innerRef,
  onOpen,
  onPick,
}: {
  room: GridRoom;
  categories: RoomCategory[];
  dimmed: boolean;
  found: boolean;
  flashing: boolean;
  picked: boolean;
  compact: boolean;
  withHint: boolean;
  innerRef?: React.RefObject<HTMLDivElement | null>;
  onOpen: () => void;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  const category = categories.find((item) => item.id === room.category_id);
  const short = (category?.title_i18n || category?.code || '').slice(0, 10);

  const cube = (
    <Box
      ref={innerRef}
      onClick={(event) => {
        // Выделение — тем же жестом, что и в списке: с клавишей. Без неё клик
        // открывает панель, иначе выделение и открытие подрались бы.
        if (event.metaKey || event.ctrlKey || event.shiftKey) onPick();
        else onOpen();
      }}
      data-testid={`room-cube-${room.number}`}
      data-room-id={room.id}
      data-dimmed={dimmed ? 'yes' : 'no'}
      sx={{
        height: compact ? 52 : 68,
        borderRadius: 1,
        px: 0.5,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        position: 'relative',
        // СЕРЫЙ — ЭТО И ЕСТЬ ОТВЕТ: занятость неизвестна. Цвет откроется, когда
        // появится PMS, и не раньше.
        bgcolor: 'action.hover',
        border: 1,
        borderColor: picked ? 'primary.main' : 'divider',
        outline: found ? 2 : 0,
        outlineColor: 'warning.main',
        opacity: dimmed ? 0.28 : 1,
        transition: 'opacity .15s, box-shadow .3s',
        boxShadow: flashing ? 4 : 0,
      }}
    >
      <Typography variant={compact ? 'body2' : 'subtitle2'} fontWeight={600}>
        {room.number}
      </Typography>
      {short && !compact ? (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: '100%' }}>
          {short}
        </Typography>
      ) : null}

      <Stack direction="row" spacing={0.25} alignItems="center" sx={{ position: 'absolute', top: 2, right: 4 }}>
        {room.out_of_service ? <BuildOutlinedIcon sx={{ fontSize: 12 }} color="warning" /> : null}
        {room.housekeeping === 'dirty' || room.housekeeping === 'in_progress' ? (
          <CleaningServicesOutlinedIcon sx={{ fontSize: 12 }} color="action" />
        ) : null}
        {room.device === 'offline' ? (
          <PowerSettingsNewIcon sx={{ fontSize: 12 }} color="error" />
        ) : room.device === 'online' ? (
          <PowerSettingsNewIcon sx={{ fontSize: 12 }} color="success" />
        ) : null}
      </Stack>

      {/* Точка — активные заказы; цифра, когда их больше одного. */}
      {room.active_orders > 0 ? (
        <Box
          data-testid={`room-cube-orders-${room.number}`}
          sx={{
            position: 'absolute',
            bottom: 2,
            minWidth: 14,
            height: 14,
            px: 0.25,
            borderRadius: 7,
            bgcolor: room.overdue_orders > 0 ? 'error.main' : 'primary.main',
            color: 'primary.contrastText',
            fontSize: 10,
            lineHeight: '14px',
            textAlign: 'center',
          }}
        >
          {room.active_orders > 1 ? room.active_orders : ''}
        </Box>
      ) : null}
    </Box>
  );

  if (!withHint) return cube;

  return (
    <Tooltip
      enterDelay={HINT_DELAY_MS}
      enterNextDelay={HINT_DELAY_MS}
      /* ИЗ ХИНТА НИЧЕГО НЕ НАЖИМАЕТСЯ: он подсказка, а не второй интерфейс.
         Поэтому в нём только текст и он не перехватывает мышь. */
      disableInteractive
      title={
        <Stack spacing={0.25}>
          <Typography variant="caption" fontWeight={600}>
            {t('hotel.rooms.floorTitle', { floor: room.floor || '—' })} · {room.number}
          </Typography>
          <Typography variant="caption">
            {t('hotel.rooms.category')}: {category?.title_i18n || category?.code || t('hotel.rooms.categoryNone')}
          </Typography>
          <Typography variant="caption">
            {t('hotel.rooms.controlType')}: {room.control_type || '—'}
          </Typography>
          <Typography variant="caption">
            {t('hotel.rooms.hintOrders', {
              count: room.active_orders,
              overdue: room.overdue_orders,
            })}
          </Typography>
          <Typography variant="caption">
            {t('hotel.rooms.hintDevice')}: {t(`hotel.rooms.device_${room.device ?? 'none'}`)}
          </Typography>
          <Typography variant="caption">
            {t('hotel.rooms.housekeeping')}: {t(`hotel.rooms.housekeeping_${room.housekeeping}`)}
            {room.out_of_service ? ` · ${t('hotel.rooms.outOfService')}` : ''}
          </Typography>
        </Stack>
      }
    >
      {cube}
    </Tooltip>
  );
}

export { withGaps };
export default RoomGrid;
