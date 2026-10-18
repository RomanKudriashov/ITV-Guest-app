import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMediaQuery, useTheme } from '@mui/material';

import { fetchItems } from '@/api/cms';
import type { Item } from '@/api/types';
import { fetchServices, type CmsService } from '@/cms/services/api';
import { IconOrders } from '@/icons';
import { KitImage, StatusIndicator } from '@/kit';

import { EntityCardBody, EntityName, type EntityCardProps } from './EntityCard';

/**
 * ОБРАЗЦЫ КАРТОЧЕК ПАРТИИ 59 — заведение, позиция, заказ, номер.
 *
 * Фото и названия заведения и позиции — настоящие, из ручек CMS отеля
 * (`/cms/services`, `/cms/items`); заказ и номер — образец с полями тех типов,
 * что уже приходят в трекер (`TrackerOrder`) и в CMS (`serialize_room`).
 * Числа «за 7 дней», «гость сейчас» — поля, которых в ручках ещё нет: в отчёте
 * разведки они помечены как новые.
 */

const pick = (t: Record<string, string> | undefined): string => (t ? t.ru ?? Object.values(t)[0] ?? '' : '');

function Thumb({ src, alt }: { src?: string | null; alt: string }) {
  return <KitImage src={src ?? null} fit="fill" alt={alt} sizes="56px" fill />;
}

function IconTile({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        width: 56,
        height: 56,
        display: 'grid',
        placeItems: 'center',
        bgcolor: (t) => t.palette.brand.primarySoft,
        color: 'primary.main',
        borderRadius: 2,
        typography: 'h6',
        fontWeight: 700,
      }}
    >
      {children}
    </Box>
  );
}

const soft = (label: string, color: 'success' | 'warning' | 'error' | 'default' = 'default') => (
  <Chip size="small" label={label} color={color} variant={color === 'default' ? 'outlined' : 'filled'} />
);

function useSampleData() {
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

function venueCard(venue: CmsService | null): EntityCardProps {
  const title = venue ? pick(venue.public_name) : 'Lobby bar';
  return {
    kind: 'Заведение',
    title,
    subtitle: 'Бар · витрина гостя',
    media: <Thumb src={venue?.image?.thumb_url ?? venue?.image?.url} alt={title} />,
    status: soft('Откроется в 16:00', 'warning'),
    fields: [
      { label: 'Часы', value: '16:00–02:00, сегодня' },
      { label: 'Меню', value: `${venue?.category_count ?? 2} раздела · ${venue?.item_count ?? 9} позиций` },
      { label: 'Трекер', value: 'Бар · SLA 15 мин' },
      { label: 'Персонал', value: `${venue?.staff_count ?? 3} человека на точке` },
      { label: 'Сейчас', value: '2 заказа в работе, 0 просрочено' },
    ],
    actions: [{ label: 'Меню' }, { label: 'Трекер точки' }],
    testId: 'entity-card-venue',
  };
}

function itemCard(item: Item | null): EntityCardProps {
  const title = item ? pick(item.title as unknown as Record<string, string>) : 'Негрони';
  const price = item?.price != null ? `${(item.price / 100).toLocaleString('ru-RU')} ₽` : '850 ₽';
  return {
    kind: 'Позиция',
    title,
    subtitle: 'Lobby bar · Коктейли',
    media: <Thumb src={item?.images[0]?.thumb_url ?? item?.images[0]?.url} alt={title} />,
    status: soft(item && !item.in_stock ? 'Стоп-лист' : 'В наличии', item && !item.in_stock ? 'error' : 'success'),
    fields: [
      { label: 'Цена', value: price },
      { label: 'Готовится', value: `${item?.prep_minutes ?? 7} мин` },
      { label: 'Метки', value: 'Хит · 18+' },
      { label: 'Модификаторы', value: '2 группы' },
      { label: 'За 7 дней', value: '23 заказа · 4,8 ★' },
    ],
    actions: [{ label: 'В стоп-лист', tone: 'danger' }, { label: 'Изменить' }],
    testId: 'entity-card-item',
  };
}

const ORDER_CARD: EntityCardProps = {
  kind: 'Заказ',
  title: '№ 1042 · номер 305',
  subtitle: 'Lobby bar · доставка в номер',
  media: (
    <IconTile>
      <IconOrders size={26} />
    </IconTile>
  ),
  status: <StatusIndicator status="preparing" label="Готовится" variant="pill" />,
  fields: [
    { label: 'Состав', value: '2× Негрони · 1× Оливки' },
    { label: 'Сумма', value: '2 150 ₽' },
    { label: 'Создан', value: '21:14, 12 мин назад' },
    { label: 'Срок', value: 'до 21:29 · осталось 3 мин' },
    { label: 'Исполнитель', value: 'Анна Ветрова' },
    { label: 'Комментарий', value: 'Без льда' },
  ],
  actions: [{ label: 'Готов', tone: 'primary' }, { label: 'Назначить' }],
  openLabel: 'В трекере',
  testId: 'entity-card-order',
};

const ROOM_CARD: EntityCardProps = {
  kind: 'Номер',
  title: '305',
  subtitle: 'Делюкс · корпус А, 3 этаж',
  media: <IconTile>305</IconTile>,
  status: soft('Гость в номере', 'success'),
  fields: [
    { label: 'Гость', value: 'с 16 окт · язык EN · номер подтверждён' },
    { label: 'Заказы', value: '1 в работе · 6 за проживание' },
    { label: 'Уборка', value: 'Убран · 10:40' },
    { label: 'Управление', value: 'Свет и климат на связи · 22 °C' },
    { label: 'Отзывы', value: 'Низких нет' },
  ],
  actions: [{ label: 'Заказ за гостя' }, { label: 'Чат' }],
  testId: 'entity-card-room',
};

/** Раздел песочницы: четыре карточки открытыми (для снимков) и живые имена. */
export function EntityCardSamples() {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const { venue, item } = useSampleData();
  const cards = [venueCard(venue), itemCard(item), ORDER_CARD, ROOM_CARD];

  return (
    <Stack spacing={2.5} data-testid="entity-card-samples">
      <Typography variant="body2" color="text.secondary">
        Наведение на подчёркнутое имя (ПК) или нажатие (телефон) — карточка того же вида на любом экране.
        Клик по имени на ПК остаётся переходом.
      </Typography>
      <Typography variant="body1" data-testid="entity-card-live">
        Заказ <EntityName card={ORDER_CARD} testId="entity-name-order">№ 1042</EntityName> из{' '}
        <EntityName card={venueCard(venue)} testId="entity-name-venue">
          {venue ? pick(venue.public_name) : 'Lobby bar'}
        </EntityName>{' '}
        в номер <EntityName card={ROOM_CARD} testId="entity-name-room">305</EntityName>:{' '}
        <EntityName card={itemCard(item)} testId="entity-name-item">
          {item ? pick(item.title as unknown as Record<string, string>) : 'Негрони'}
        </EntityName>
        .
      </Typography>
      <Box
        sx={{
          // Под стеклом — «экран»: полоса цвета и текст, чтобы было видно, что
          // карточка стеклянная, а не плоская.
          position: 'relative',
          borderRadius: 3,
          p: { xs: 0, sm: 2 },
          backgroundImage: phone
            ? 'none'
            : `linear-gradient(120deg, ${theme.palette.primary.main}33 0%, transparent 45%), repeating-linear-gradient(0deg, ${theme.palette.divider} 0 1px, transparent 1px 28px)`,
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, 340px)' },
          gap: 2.5,
          justifyContent: 'start',
        }}
      >
        {cards.map((card) => (
          <EntityCardBody key={card.testId} {...card} sheet={phone} />
        ))}
      </Box>
    </Stack>
  );
}
