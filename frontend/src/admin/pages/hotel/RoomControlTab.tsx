import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { EmptyState } from '@/components/EmptyState';
import { SelectField } from '@/components/SelectField';
import { BuilderTab } from '@/cms/roomControl/BuilderTab';
import { DiagnosticsTab } from '@/cms/roomControl/DiagnosticsTab';
import { ImportTab } from '@/cms/roomControl/ImportTab';
import { PlanEditor } from '@/cms/roomControl/PlanEditor';
import { VersionsTab } from '@/cms/roomControl/VersionsTab';
import { GrmsScopeProvider, useGrms } from '@/cms/roomControl/scope';
import { useRights } from '../../useRights';
import { contentLanguagesFrom } from '@/hooks/useBootstrap';
import { getHotel } from '@/admin/adminClient';

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
      <Inner />
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
      <Alert severity="info" data-testid="admin-grms-module-off">
        {types.error.detail}
      </Alert>
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

type Section = 'import' | 'builder' | 'plan' | 'versions' | 'diagnostics';
/*
  Диагностика стоит в консоли ПОСЛЕДНЕЙ и остаётся у отеля тоже — но глубина у
  двух вкладок разная, и решает её сервер. Здесь инженер видит сырой ответ
  оборудования, устройство и канал; в CMS отеля тот же экран показывает «когда,
  что и чем закончилось». Экран один, ветвление одно — по `depth` из ответа.
*/
const SECTIONS: Section[] = ['import', 'builder', 'plan', 'versions', 'diagnostics'];

// Роль «только чтение» (партия 60): импорт, конструктор и план — редакторы, и
// каждое их нажатие сервер отвергал 403. Ей остаются история версий (без
// публикации и отката) и диагностика.
const READ_ONLY_SECTIONS: Section[] = ['versions', 'diagnostics'];

function Inner() {
  const { t } = useTranslation();
  const grms = useGrms();
  const { canWrite } = useRights();
  const sections = canWrite ? SECTIONS : READ_ONLY_SECTIONS;
  /*
    ПОДВКЛАДКА — В АДРЕСЕ (`sub`, партия 62-B): F5 и ссылка открывают ту же,
    как и вкладку карточки. Неизвестное значение — первая доступная.
  */
  const [params, setParams] = useSearchParams();
  const chosen = params.get('sub') as Section | null;
  const section = chosen && sections.includes(chosen) ? chosen : sections[0];
  const setSection = (next: Section) => {
    const out = new URLSearchParams(params);
    out.set('sub', next);
    setParams(out, { replace: true });
  };
  const [typeCode, setTypeCode] = useState('');

  const types = useQuery({ queryKey: queryKeys.grmsTypes(grms.base), queryFn: grms.types });

  useEffect(() => {
    const list = types.data?.types ?? [];
    if (list.length && !list.some((type) => type.code === typeCode)) setTypeCode(list[0].code);
  }, [types.data, typeCode]);

  if (types.isLoading) return <Skeleton variant="rounded" height={320} />;

  // 403 здесь значит ровно одно: модуль отелю не подключён. Показывать вместо
  // этого формы — обещать работу, которой не будет.
  if (types.isError && types.error instanceof ApiError && types.error.status === 403) {
    return (
      <Alert severity="info" data-testid="admin-grms-module-off">
        {types.error.detail}
      </Alert>
    );
  }
  if (types.isError || !types.data) {
    return <Alert severity="error">{t('errors.generic')}</Alert>;
  }

  const list = types.data.types;
  const current = list.find((type) => type.code === typeCode) ?? null;

  return (
    <Box data-testid="admin-hotel-room-control">
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <Tabs
          value={section}
          onChange={(_, value: Section) => setSection(value)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ flexGrow: 1 }}
        >
          {sections.map((key) => (
            <Tab
              key={key}
              value={key}
              label={t(`roomControl.tabs.${key}`)}
              data-testid={`admin-grms-tab-${key}`}
            />
          ))}
        </Tabs>
        {list.length > 0 && (
          <SelectField
            size="small"
            fullWidth={false}
            sx={{ minWidth: 200 }}
            label={t('roomControl.type')}
            value={typeCode}
            onChange={setTypeCode}
            testId="admin-grms-type-select"
            options={list.map((type) => ({ value: type.code, label: type.title?.ru ?? type.code }))}
          />
        )}
      </Stack>

      {section === 'import' && <ImportTab onImported={() => void types.refetch()} />}

      {section !== 'import' && !current && (
        <EmptyState
          testId="admin-grms-no-types"
          title={t('roomControl.noTypes')}
          description={t('roomControl.noTypesHint')}
        />
      )}

      {current && section === 'builder' && <BuilderTab type={current} />}
      {current && section === 'plan' && <PlanEditor code={current.code} types={list} />}
      {current && section === 'versions' && <VersionsTab type={current} readOnly={!canWrite} />}
      {current && section === 'diagnostics' && <DiagnosticsTab type={current} />}
    </Box>
  );
}
