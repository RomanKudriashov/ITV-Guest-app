import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { QueryState } from '@/components/QueryState';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { ApiError } from '@/api/client';
import { fetchGrmsTypes } from '@/api/grms';
import { useGrmsScope } from './scope';
import { queryKeys } from '@/api/queryKeys';
import { EmptyState } from '@/components/EmptyState';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';
import { pickTranslated } from '@/utils/translated';
import { AccessTab } from './AccessTab';
import { CheckTab } from './CheckTab';
import { DiagnosticsTab } from './DiagnosticsTab';

/**
 * Раздел «Управление номером» в CMS.
 *
 * Порядок вкладок — это порядок работы на объекте: импорт переменных →
 * конструктор экрана → план номера → проверка на живой комнате → публикация.
 * Доступ стоит последним и один на отель, а не на тип: PIN и демо-вход
 * относятся к номеру целиком.
 *
 * Тип выбирается ОДИН РАЗ сверху и держится на всех вкладках. Разложить выбор
 * по вкладкам значило бы дать администратору размечать план одного типа, а
 * публиковать другой, — и узнать об этом в номере.
 *
 * Раздел закрыт модулем `room_control` на каждом эндпоинте: без модуля здесь
 * честная заглушка, а не пустые формы, которые всё равно ответят 403.
 */
type TabKey = 'access' | 'check' | 'diagnostics';

/**
 * КОНФИГУРАЦИЯ ЖИВЁТ В КОНСОЛИ ПЛАТФОРМЫ, А НЕ ЗДЕСЬ.
 *
 * Импорт ПНР, конструктор, план и версии уехали: это наша пусконаладка, а не
 * работа отеля — администратор не открывает Excel с картой каналов и не
 * размечает зоны. Отелю осталось то, чем он занимается каждый день: доступ
 * гостя (PIN и демо-вход), прогон элемента и связь.
 *
 * Старые адреса вкладок сюда приходят и не ведут в никуда: неизвестная вкладка
 * открывает «Доступ» и объясняет, куда делось остальное.
 */
const MOVED_TABS = new Set(['import', 'builder', 'plan', 'versions']);

// Диагностика стоит ПОСЛЕ проверки: сначала прогоняют элемент, потом идут
// смотреть, что из этого записалось и почему не получилось.
const TABS: TabKey[] = ['access', 'check', 'diagnostics'];

export function RoomControlPage() {
  const { t } = useTranslation();
  // База API — из области: CMS отеля или консоль платформы.
  const { transport } = useGrmsScope();
  const base = transport.base;
  const navigate = useNavigate();
  const { data: bootstrap } = useBootstrap();
  const languages = useContentLanguages(bootstrap);
  const [params] = useSearchParams();
  const [tab, setTab] = useState<TabKey>('access');
  // Пришли по старой ссылке на переехавшую вкладку — говорим об этом, а не
  // молча показываем другую: человек искал конкретный экран.
  const askedMoved = MOVED_TABS.has(params.get('tab') ?? '');
  /*
    ТИП МОЖНО ПРИНЕСТИ АДРЕСОМ.

    Из списка номеров ведёт ссылка «тип управления» — она обязана открыть
    конфигурацию ИМЕННО этого типа, а не первого попавшегося. Иначе переход
    отвечает не на тот вопрос, ради которого по нему пошли.
  */
  const [typeCode, setTypeCode] = useState(params.get('type') ?? '');

  const types = useQuery({ queryKey: queryKeys.grmsTypes(base), queryFn: () => fetchGrmsTypes(transport) });

  useEffect(() => {
    const list = types.data?.types ?? [];
    if (list.length && !list.some((type) => type.code === typeCode)) setTypeCode(list[0].code);
  }, [types.data, typeCode]);

  if (types.isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton variant="rounded" height={64} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={360} />
      </Box>
    );
  }

  // 403 здесь означает ровно одно: модуль не подключён. Показать вместо этого
  // формы — обещать работу, которой не будет.
  if (types.isError && types.error instanceof ApiError && types.error.status === 403) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info" data-testid="grms-module-off">
          {types.error.detail}
        </Alert>
      </Box>
    );
  }
  if (types.isError || !types.data) {
    return (
      <Box sx={{ p: 3 }}>
        <QueryState query={types} what={t('state.what.roomTypes')}>
          {() => null}
        </QueryState>
      </Box>
    );
  }

  const list = types.data.types;
  const current = list.find((type) => type.code === typeCode) ?? null;

  return (
    <Box sx={{ p: 3, pb: 10 }} data-testid="cms-room-control">
      <Stack
        direction="row"
        spacing={2}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ mb: 2 }}
      >
        <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h5">{t('roomControl.title')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('roomControl.subtitle')}
          </Typography>
        </Stack>
        {/*
          Сколько номеров на этом типе — обратная сторона колонки в списке
          номеров. Настраивается тип один раз, а не двести раз по числу комнат,
          и цена ошибки здесь ровно в этом числе.
        */}
        {current && current.rooms.length > 0 && (
          <Chip
            size="small"
            variant="outlined"
            data-testid="grms-type-rooms"
            label={t('roomControl.roomsOnType', { count: current.rooms.length })}
            onClick={() => navigate('/cms/rooms')}
          />
        )}
        {list.length > 0 && (
          <TextField
            select
            size="small"
            sx={{ minWidth: 220 }}
            label={t('roomControl.type')}
            value={typeCode}
            onChange={(e) => setTypeCode(e.target.value)}
            data-testid="grms-type-select"
          >
            {list.map((type) => (
              <MenuItem key={type.code} value={type.code}>
                {pickTranslated(type.title, languages.displayLanguage, languages.defaultCode) ||
                  type.code}
              </MenuItem>
            ))}
          </TextField>
        )}
      </Stack>

      <Tabs
        value={tab}
        onChange={(_, value: TabKey) => setTab(value)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        {TABS.map((key) => (
          <Tab key={key} value={key} label={t(`roomControl.tabs.${key}`)} data-testid={`grms-tab-${key}`} />
        ))}
      </Tabs>

      {/*
        Строка о переезде — ВСЕГДА, а не только по старой ссылке: у
        администратора пропали четыре вкладки, и пустое место на их месте
        читается как поломка. Здесь сказано, что произошло и к кому идти.
      */}
      <Alert
        severity="info"
        sx={{ mb: 2 }}
        data-testid="grms-config-moved"
      >
        {t(askedMoved ? 'roomControl.movedFromTab' : 'roomControl.moved')}
      </Alert>

      {tab === 'access' && <AccessTab />}

      {tab !== 'access' && !current && (
        <EmptyState
          testId="grms-no-types"
          title={t('roomControl.noTypes')}
          description={t('roomControl.noTypesHint')}
        />
      )}

      {current && tab === 'check' && <CheckTab type={current} />}
      {current && tab === 'diagnostics' && <DiagnosticsTab type={current} />}
    </Box>
  );
}
