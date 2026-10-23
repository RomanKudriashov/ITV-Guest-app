import { useEffect, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { EmptyState } from '@/components/EmptyState';
import { DiagnosticsTab } from '@/cms/roomControl/DiagnosticsTab';
import { GrmsScopeProvider, useGrms } from '@/cms/roomControl/scope';
import { contentLanguagesFrom } from '@/hooks/useBootstrap';
import { getHotel } from '@/admin/adminClient';
import { LEGACY_SUB, VariantsScreen } from './variants';

/**
 * КОНФИГУРАЦИЯ УПРАВЛЕНИЯ НОМЕРОМ — В НАШЕЙ КОНСОЛИ.
 *
 * Импорт ПНР, конструктор экрана, план и публикация переехали из CMS отеля:
 * услуга платная, оказываем её мы, и администратор отеля не открывает Excel с
 * картой каналов и не размечает зоны.
 *
 * ЭКРАНЫ ТЕ ЖЕ, а не скопированные. Различается ровно одно — база API, и её
 * даёт `GrmsScopeProvider`. Вторая копия означала бы вторую копию каждой
 * ошибки в них: правку пришлось бы вносить дважды, и однажды забыли бы.
 *
 * Отель приходит из карточки: в консоли «текущего отеля» нет, он выбран
 * оператором, и все запросы адресуют его id.
 */
export function RoomControlTab({ hotelId }: { hotelId: string }) {
  return (
    <HotelGrmsScope hotelId={hotelId}>
      <Inner hotelId={hotelId} />
    </HotelGrmsScope>
  );
}

/**
 * Журнал оборудования отеля для вкладки «Журнал» карточки (партия 62-B) —
 * та же диагностика, что последней подвкладкой здесь, без редакторов.
 */
export function RoomControlJournal({ hotelId }: { hotelId: string }) {
  return (
    <HotelGrmsScope hotelId={hotelId}>
      <JournalInner />
    </HotelGrmsScope>
  );
}

function HotelGrmsScope({ hotelId, children }: { hotelId: string; children: ReactNode }) {
  const { i18n } = useTranslation();
  /*
    Языки контента отеля — из его карточки, а не из бутстрапа CMS: под
    платформенным токеном той ручки нет вовсе, и запрос к ней уводил оператора
    на вход отеля. Карточка отеля их и так знает.
  */
  const hotel = useQuery({
    queryKey: ['admin', 'hotel', hotelId],
    queryFn: () => getHotel(hotelId),
  });
  const languages = contentLanguagesFrom(
    hotel.data?.languages,
    hotel.data?.default_language,
    (i18n.resolvedLanguage ?? i18n.language ?? 'ru').split('-')[0],
  );

  return (
    <GrmsScopeProvider hotelId={hotelId} languages={languages}>
      {children}
    </GrmsScopeProvider>
  );
}

function JournalInner() {
  const { t } = useTranslation();
  const grms = useGrms();
  const types = useQuery({ queryKey: queryKeys.grmsTypes(grms.base), queryFn: grms.types });
  if (types.isLoading) return <Skeleton variant="rounded" height={240} />;
  if (types.isError && types.error instanceof ApiError && types.error.status === 403) {
    return (
      <ModuleOff />
    );
  }
  if (types.isError || !types.data) return <Alert severity="error">{t('errors.generic')}</Alert>;
  const first = types.data.types[0];
  // Журнал общий на отель; вариант нужен только кнопке «перечитать».
  if (!first) {
    return (
      <EmptyState testId="admin-grms-no-types" title={t('roomControl.noTypes')} description={t('roomControl.noTypesHint')} />
    );
  }
  return <DiagnosticsTab type={first} />;
}

/*
  ВАРИАНТЫ ВМЕСТО ПОДВКЛАДОК (партия 63-4). Четыре вкладки по видам работы
  (импорт, конструктор, план, версии) сменил список вариантов с шагами внутри
  каждого. Прежние адреса `sub=` ведут на нужный шаг первого варианта;
  диагностика — во вкладку «Журнал» карточки, где журнал оборудования и живёт.
*/
function Inner({ hotelId }: { hotelId: string }) {
  const { t } = useTranslation();
  const grms = useGrms();
  const [params, setParams] = useSearchParams();
  const types = useQuery({ queryKey: queryKeys.grmsTypes(grms.base), queryFn: grms.types });

  const legacy = params.get('sub');
  const first = types.data?.types[0]?.code;
  useEffect(() => {
    if (!legacy || !types.data) return;
    const out = new URLSearchParams(params);
    out.delete('sub');
    const target = LEGACY_SUB[legacy];
    if (target === 'journal') out.set('tab', 'journal');
    else if (target && first) {
      out.set('variant', out.get('variant') || first);
      out.set('step', target);
    }
    setParams(out, { replace: true });
  }, [legacy, types.data, first, params, setParams]);

  if (types.isLoading) return <Skeleton variant="rounded" height={320} />;

  // 403 здесь значит ровно одно: модуль отелю не подключён. Показывать вместо
  // этого формы — обещать работу, которой не будет.
  if (types.isError && types.error instanceof ApiError && types.error.status === 403) {
    return (
      <ModuleOff />
    );
  }
  if (types.isError || !types.data) {
    return <Alert severity="error">{t('errors.generic')}</Alert>;
  }

  return (
    <Box data-testid="admin-hotel-room-control">
      <VariantsScreen hotelId={hotelId} types={types.data.types} onTypesChanged={() => void types.refetch()} />
      <Box sx={{ mt: 2 }}>
        <Button size="small" onClick={() => setParams((prev) => { const out = new URLSearchParams(prev); out.set('tab', 'journal'); out.delete('variant'); out.delete('step'); return out; })} data-testid="admin-variants-journal">
          {t('admin.variants.journalLink')}
        </Button>
      </Box>
    </Box>
  );
}

/**
 * Модуль выключен (партия 62-F): не просто «не подключён», а что здесь будет и
 * как это получить — переход во вкладку «Модули».
 */
function ModuleOff() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const toModules = () => {
    const next = new URLSearchParams(params);
    next.set('tab', 'modules');
    next.delete('sub');
    setParams(next, { replace: true });
  };
  return (
    <Alert
      severity="info"
      data-testid="admin-grms-module-off"
      action={
        <Button size="small" onClick={toModules} data-testid="admin-grms-module-off-open">
          {t('admin.card.roomControl.toModules')}
        </Button>
      }
    >
      {t('admin.card.roomControl.moduleOff')}
    </Alert>
  );
}
