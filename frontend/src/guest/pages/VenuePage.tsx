import { useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import { useTranslation } from 'react-i18next';

import { CatalogPage } from './CatalogPage';
import { VenueHeader } from '../components/VenueHeader';
import { layout as storefrontLayout } from '../storefrontTokens';
import { useGuestCatalog } from '../hooks/useGuestQueries';
import { useGuestSession } from '../session/GuestSessionProvider';
import { errorMessage } from '../errors';

/**
 * Пространство одного заведения — главная починка R5.
 *
 * Гость тапает по плитке и попадает ВНУТРЬ заведения: его кадр, его имя, его
 * содержимое. Раньше здесь открывался общий каталог, озаглавленный именем
 * отеля, — «меню без ресторана», ровно то, что карта продукта называла главной
 * поломкой.
 *
 * Какой блок показать, решает ТИП сервиса, а не догадка по содержимому:
 *
 *   ресторан / бар / рум-сервис / мини-бар → каталог с категориями;
 *   такси / консьерж / хозслужба           → форма заявки;
 *   спа / бассейн / экскурсии              → выбор дня и слотов;
 *   инфо                                   → страница с контентом.
 *
 * Тип приходит с сервера вместе с идентичностью заведения: он же определяет вид
 * трекера у персонала (R3), и второй источник правды здесь развёл бы гостевую
 * и рабочую стороны.
 */
const CONTENT_BY_TYPE: Record<string, 'product' | 'service_request' | 'slot' | 'info'> = {
  restaurant: 'product',
  bar: 'product',
  room_service: 'product',
  minibar: 'product',
  transfer: 'service_request',
  concierge: 'service_request',
  housekeeping: 'service_request',
  spa: 'slot',
  pool: 'slot',
  excursions: 'slot',
  info: 'info',
};

export function VenuePage() {
  const { code = '' } = useParams<{ code: string }>();
  const { t } = useTranslation();
  const { canOrder } = useGuestSession();

  // Идентичность заведения читаем товарным каталогом: он отвечает всегда, даже
  // когда товаров у заведения нет, и несёт блок `venue`.
  const probe = useGuestCatalog('product', true, code);
  const venue = probe.data?.venue ?? null;

  if (probe.isLoading) {
    return (
      <Stack alignItems="center" sx={{ py: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }
  if (probe.error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{errorMessage(probe.error, t)}</Alert>
      </Box>
    );
  }
  if (!venue) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" data-testid="guest-venue-missing">
          {t('guest.venue.notFound')}
        </Alert>
      </Box>
    );
  }

  const content = CONTENT_BY_TYPE[venue.type] ?? 'product';

  return (
    <Box data-testid="guest-venue" data-venue-type={venue.type} data-content={content}>
      <VenueHeader venue={venue} />

      {/*
        Режим «только просмотр» (QR в лобби без номера). Говорим об этом СРАЗУ,
        а не на кнопке оформления: гость, собравший корзину и узнавший о запрете
        в самом конце, потратил время зря.
      */}
      {!canOrder ? (
        <Box
          sx={{
            px: { xs: 2, md: 0 },
            pt: 2,
            // Панель каталога ниже подтянута вверх на `panelOverlap` — она
            // задумана наезжать скруглением на КАДР заведения. Плашка встаёт
            // между ними и попадала под этот нахлёст: текст был на месте и
            // нужного контраста, но нижнюю половину строки закрывала панель, и
            // читалось это как «невидимое уведомление». Отдаём нахлёсту пустое
            // место, а не строку.
            pb: `${storefrontLayout.panelOverlap}px`,
          }}
        >
          <Alert severity="info" data-testid="guest-view-only-notice">
            {t('guest.venue.viewOnly')}
          </Alert>
        </Box>
      ) : null}
      {/*
        Содержимое рисует тот же экран каталога — он умеет все четыре типа
        (см. offerings). Отдельная страница на тип означала бы четыре копии
        фильтров, локализации и расписаний.
      */}
      <CatalogPage type={content} point={code} embedded />
    </Box>
  );
}
