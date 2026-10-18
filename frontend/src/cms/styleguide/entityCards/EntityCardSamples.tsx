import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMediaQuery, useTheme } from '@mui/material';

import { fetchItems } from '@/api/cms';
import type { Item } from '@/api/types';
import { fetchServices, type CmsService } from '@/cms/services/api';

import { EntityCardBody } from './EntityCard';
import { itemCard, orderCard, roomCard, venueCard } from './cards';
import { DemoCmsOrders, DemoTrackerBoard, type DemoData } from './DemoScreens';

/**
 * ОБРАЗЦЫ КАРТОЧЕК ПАРТИИ 59, ЗАХОД 2 — четыре карточки и «показ в деле».
 *
 * Фото и названия заведения и позиции — настоящие, из ручек CMS отеля
 * (`/cms/services`, `/cms/items`); заказы и номера — образец полей
 * `TrackerOrder` и `GridRoom`. Рабочие экраны не тронуты.
 */

const pick = (t: Record<string, string> | undefined): string => (t ? t.ru ?? Object.values(t)[0] ?? '' : '');

function useRealPhotos() {
  const [venue, setVenue] = useState<CmsService | null>(null);
  const [item, setItem] = useState<Item | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchServices()
      .then(async (services) => {
        const bar = services.find((s) => s.code === 'bar' && s.image) ?? services.find((s) => s.image) ?? services[0];
        if (!alive || !bar) return;
        setVenue(bar);
        const items = await fetchItems({ service_id: bar.id, limit: 40 });
        if (alive) setItem(items.find((i) => i.images.length > 0) ?? items[0] ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return { venue, item };
}

export function useDemoData(): DemoData {
  const { venue, item } = useRealPhotos();
  return useMemo(() => {
    const venueTitle = venue ? pick(venue.public_name) : 'Лобби-бар';
    const itemTitle = item ? pick(item.title as unknown as Record<string, string>) : 'Негрони';
    const price = item?.price != null ? `${(item.price / 100).toLocaleString('ru-RU')} ₽` : '780 ₽';
    return {
      venue: {
        title: venueTitle,
        kindLabel: 'Бар',
        photo: venue?.image?.thumb_url ?? venue?.image?.url,
        opensAt: 16,
        closesAt: 2,
        items: venue?.item_count ?? 6,
        inWork: 3,
        overdue: 1,
      },
      item: {
        title: itemTitle,
        venue: venueTitle,
        section: 'Коктейли',
        photo: item?.images[0]?.url ?? item?.images[0]?.thumb_url,
        price,
        inStock: item ? item.in_stock : true,
        rating: '4,8',
        ordersWeek: 23,
      },
      orders: [
        { number: 1042, room: '305', venue: venueTitle, mode: 'в номер', stage: 'preparing', dueIn: 3, dueAt: '21:29', lines: `2× ${itemTitle} · 1× Оливки`, total: '2 150 ₽', assignee: 'Анна Ветрова' },
        { number: 1041, room: '212', venue: venueTitle, mode: 'в номер', stage: 'preparing', dueIn: -7, dueAt: '21:12', lines: `1× ${itemTitle} · 2× Тоник`, total: '1 480 ₽', assignee: 'Илья Громов' },
        { number: 1043, room: '118', venue: venueTitle, mode: 'на стойке', stage: 'new', dueIn: 14, dueAt: '21:40', lines: '1× Апероль шприц', total: '690 ₽' },
        { number: 1039, room: '407', venue: 'Панорама', mode: 'в номер', stage: 'ready', dueIn: 6, dueAt: '21:32', lines: '1× Цезарь · 1× Морс', total: '1 320 ₽', assignee: 'Анна Ветрова' },
        { number: 1044, room: '305', venue: venueTitle, mode: 'в номер', stage: 'accepted', dueIn: 11, dueAt: '21:37', lines: '1× Эспрессо мартини', total: '720 ₽', assignee: 'Илья Громов' },
      ],
      rooms: {
        '305': { number: '305', type: 'Делюкс', floor: '3 этаж', guestIn: true, cleaned: true, controlOnline: true, temperature: 22, openOrders: 2 },
        '212': { number: '212', type: 'Стандарт', floor: '2 этаж', guestIn: true, cleaned: false, controlOnline: false, temperature: 24, openOrders: 1 },
      },
    };
  }, [venue, item]);
}

/** Раздел песочницы: четыре карточки открытыми и два экрана с живыми именами. */
export function EntityCardSamples() {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const data = useDemoData();
  const cards = [venueCard(data.venue), itemCard(data.item), orderCard(data.orders[0]), roomCard(data.rooms['305'])];

  return (
    <Stack spacing={4} data-testid="entity-card-samples">
      <Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Наведение на подчёркнутое имя (ПК) или нажатие (телефон) — карточка того же вида на любом экране.
        </Typography>
        <Box
          data-testid="entity-card-gallery"
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(auto-fill, 320px)' },
            gap: 2.5,
            alignItems: 'start',
          }}
        >
          {cards.map((card) => (
            <EntityCardBody key={card.testId} {...card} sheet={phone} />
          ))}
        </Box>
      </Box>
      <DemoCmsOrders data={data} />
      <DemoTrackerBoard data={data} />
    </Stack>
  );
}
