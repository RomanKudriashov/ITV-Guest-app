import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { ICON_REGISTRY, IconServices, type AppIconComponent } from '@/icons';
import { useGuestActiveOrders, useGuestHome } from '../hooks/useGuestQueries';
import { useStorefront } from '../useStorefront';
import { roomCard, surfaceRadius } from '../storefrontTokens';

/**
 * Быстрые действия на экране номера: мост в то, что в приложении УЖЕ ЕСТЬ.
 *
 * НИ ОДНОЙ НОВОЙ СУЩНОСТИ. Каждая кнопка открывает существующий раздел
 * витрины — меню ресторана, список услуг, чат с отелем, — и дальше работает
 * тот же поток заказа и та же заявка, что и с главной. Завести здесь «заявку
 * на полотенца» отдельным типом значило бы получить вторую заявку с той же
 * ролью, которую персонал увидел бы на другой доске.
 *
 * НАБОР БЕРЁТСЯ С СЕРВЕРА. Тот же список, что и на главной: отель выбирает его
 * в CMS, а по умолчанию сервер отдаёт разделы, которые у отеля реально
 * наполнены. Нет ресторана — нет кнопки «заказать еду»; нет чата — нет чата.
 *
 * УБОРКА СЮДА НЕ ПОПАДАЕТ. Она уже есть элементом номера (MUR) в панели
 * «Сервис» — с состоянием, подтверждением и своим каналом. Второй способ
 * попросить уборку означал бы два источника правды об одном и том же.
 *
 * СТАТУСЫ ЗАЯВОК показываются здесь же и приходят готовыми: `status.title`
 * локализован сервером, и это тот же статус, который персонал двигает на
 * трекере. Придумывать свои слова для «в работе» фронт не станет.
 */

const ALIASES: Record<string, string> = {
  room_service: 'services',
  event_available: 'slots',
  restaurant_menu: 'restaurant',
  support_agent: 'chat',
  forum: 'chat',
};

function iconFor(code: string): AppIconComponent {
  return ICON_REGISTRY[code] ?? ICON_REGISTRY[ALIASES[code] ?? ''] ?? IconServices;
}

export function RoomQuickActions() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { roomControl } = useStorefront();
  const home = useGuestHome();
  const orders = useGuestActiveOrders();

  const actions = home.data?.quick_actions ?? [];
  const active = orders.data?.orders ?? [];
  if (!actions.length && !active.length) return null;

  return (
    <Stack spacing={1.5} data-testid="room-quick-actions">
      {actions.length ? (
        <Box
          sx={{
            display: 'grid',
            /*
              Колонки от места в контейнере, а не от окна. `min(100%, …)` — не
              украшение: без него дорожка остаётся заданной ширины даже там,
              где контейнер уже неё, и сетка вылезает целиком.
            */
            gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${roomCard.quickTrack}px), 1fr))`,
            gap: roomCard.block,
          }}
        >
          {actions.map((action) => {
            const Icon = iconFor(action.icon);
            return (
              <ButtonBase
                key={action.code}
                onClick={() => navigate(action.route)}
                data-testid={`room-quick-${action.code}`}
                sx={(theme) => ({
                  justifyContent: 'flex-start',
                  /*
                    ЭЛЕМЕНТ СЕТКИ УМЕЕТ СЖИМАТЬСЯ.

                    У него `min-width: auto` по умолчанию, то есть он не станет
                    уже своего содержимого. Одно длинное слово — «Бронирование»
                    — требовало 173px при дорожке в 154 и выносило карточку за
                    правый край панели. Замер: у панели появлялась собственная
                    горизонтальная прокрутка, то есть переполнялся сам блок, а
                    не только текст.
                  */
                  minWidth: 0,
                  gap: roomCard.block,
                  px: 1.5,
                  py: 1.5,
                  textAlign: 'start',
                  borderRadius: surfaceRadius.panel(theme.palette.brand.radius),
                  border: `1px solid ${roomControl.pillBorder}`,
                  background: roomControl.pillBackground,
                  color: 'text.primary',
                  transition: 'background .2s ease, border-color .2s ease, transform .12s ease',
                  '@media (hover: hover)': {
                    '&:hover': { background: roomControl.rowIcon, borderColor: roomControl.accent },
                  },
                  '&:active': { transform: 'scale(.985)' },
                  '&.Mui-focusVisible': { outline: `2px solid ${roomControl.cold}`, outlineOffset: 2 },
                })}
              >
                <Box
                  aria-hidden
                  sx={(theme) => ({
                    display: 'flex',
                    flex: 'none',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 36,
                    height: 36,
                    borderRadius: surfaceRadius.inner(theme.palette.brand.radius),
                    background: roomControl.rowIcon,
                  })}
                >
                  <Icon size={18} />
                </Box>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 600,
                    minWidth: 0,
                    /*
                      Сжаться карточке мало — надо, чтобы было ЧЕМУ переноситься.
                      Русские и немецкие подписи из одного длинного слова иначе
                      просто торчат наружу: переносить внутри слова браузер сам
                      не станет.
                    */
                    overflowWrap: 'anywhere',
                  }}
                >
                  {t(`guest.quickActions.${action.code}`, { defaultValue: action.title })}
                </Typography>
              </ButtonBase>
            );
          })}
        </Box>
      ) : null}

      {active.length ? (
        <Stack spacing={0.75} data-testid="room-request-statuses">
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
            {t('guest.roomControl.myRequests')}
          </Typography>
          {active.map((order) => (
            <ButtonBase
              key={order.id}
              onClick={() => navigate(`/orders/${order.id}`)}
              data-testid={`room-request-${order.id}`}
              sx={(theme) => ({
                justifyContent: 'space-between',
                gap: 1,
                px: 1.5,
                py: 1.25,
                borderRadius: surfaceRadius.inner(theme.palette.brand.radius),
                border: `1px solid ${roomControl.pillBorder}`,
                background: roomControl.pillBackground,
                '@media (hover: hover)': { '&:hover': { background: roomControl.rowIcon } },
              })}
            >
              <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                {/* Состав заявки готовым текстом с сервера; номер рядом. */}
                {order.summary || t('guest.roomControl.requestNumber', { number: order.number })}
              </Typography>
              {/* Слово статуса — С СЕРВЕРА и локализованное: это тот же статус,
                  что персонал двигает на трекере. */}
              <Typography variant="caption" sx={{ color: roomControl.accent, fontWeight: 700 }}>
                {order.status.title}
              </Typography>
            </ButtonBase>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}
