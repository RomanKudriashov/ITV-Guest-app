import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { EmptyState } from '@/components/EmptyState';
import { BuilderTab } from '@/cms/roomControl/BuilderTab';
import { ImportTab } from '@/cms/roomControl/ImportTab';
import { PlanEditor } from '@/cms/roomControl/PlanEditor';
import { VersionsTab } from '@/cms/roomControl/VersionsTab';
import { GrmsScopeProvider, useGrms } from '@/cms/roomControl/scope';
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
      <Inner />
    </GrmsScopeProvider>
  );
}

type Section = 'import' | 'builder' | 'plan' | 'versions';
const SECTIONS: Section[] = ['import', 'builder', 'plan', 'versions'];

function Inner() {
  const { t } = useTranslation();
  const grms = useGrms();
  const [section, setSection] = useState<Section>('import');
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
          {SECTIONS.map((key) => (
            <Tab
              key={key}
              value={key}
              label={t(`roomControl.tabs.${key}`)}
              data-testid={`admin-grms-tab-${key}`}
            />
          ))}
        </Tabs>
        {list.length > 0 && (
          <TextField
            select
            size="small"
            sx={{ minWidth: 200 }}
            label={t('roomControl.type')}
            value={typeCode}
            onChange={(event) => setTypeCode(event.target.value)}
            SelectProps={{
              SelectDisplayProps: { 'data-testid': 'admin-grms-type-select' } as never,
            }}
          >
            {list.map((type) => (
              <MenuItem key={type.code} value={type.code}>
                {type.title?.ru ?? type.code}
              </MenuItem>
            ))}
          </TextField>
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
      {current && section === 'versions' && <VersionsTab type={current} />}
    </Box>
  );
}
