import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cmsPath } from '@/app/hostRole';

import { QueryState } from '@/components/QueryState';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import { PageContainer } from '@/components/PageContainer';
import Chip from '@mui/material/Chip';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';

import { ApiError } from '@/api/client';
import { fetchGrmsTypes } from '@/api/grms';
import { GrmsScopeProvider, useGrmsScope } from './scope';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';
import { queryKeys } from '@/api/queryKeys';
import { EmptyState } from '@/components/EmptyState';
import { SelectField } from '@/components/SelectField';
import { pickTranslated } from '@/utils/translated';
import { AccessTab } from './AccessTab';
import { CheckTab } from './CheckTab';
import { DiagnosticsTab } from './DiagnosticsTab';
import { QuickActionsPanel } from '@/cms/quickActions/QuickActionsPanel';

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
type TabKey = 'access' | 'tiles' | 'check' | 'diagnostics';

/**
 * КОНФИГУРАЦИЯ ЖИВЁТ В NAVIROOM CONTROL, А НЕ ЗДЕСЬ.
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
//
// «Плитки экрана номера» (бывший раздел «Быстрые действия», партия 57) — рядом
// с доступом: обе вкладки про то, что гость видит в номере, и обе — на отель,
// а не на тип управления.
const TABS: TabKey[] = ['access', 'tiles', 'check', 'diagnostics'];
const isTabKey = (value: string | null): value is TabKey =>
  value !== null && (TABS as string[]).includes(value);

export function RoomControlPage() {
  /*
    Языки контента приносит ХОЗЯИН ЭКРАНА, а не сам экран.

    В CMS это бутстрап отеля, в консоли — карточка отеля. Внутри компоненты
    берут их из области и не знают, кто именно принёс: раньше они звали
    `useBootstrap()` напрямую, и в консоли это давало 401 и увод оператора на
    вход отеля.
  */
  const { data: bootstrap } = useBootstrap();
  const languages = useContentLanguages(bootstrap);
  return (
    <GrmsScopeProvider languages={languages}>
      <RoomControlSection />
    </GrmsScopeProvider>
  );
}

function RoomControlSection() {
  const { t } = useTranslation();
  // База API — из области: CMS отеля или NaviRoom Control.
  const { transport, languages } = useGrmsScope();
  const base = transport.base;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  /*
    ВКЛАДКА — В АДРЕСЕ (?tab=, партия 57): на «Плитки экрана номера» ведёт
    старый адрес /cms/quick-actions, и ссылку на вкладку можно переслать.
  */
  const askedTab = params.get('tab');
  const tab: TabKey = isTabKey(askedTab) ? askedTab : 'access';
  const setTab = (next: TabKey) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.set('tab', next);
        return out;
      },
      { replace: true },
    );
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
      <PageContainer>
        <Skeleton variant="rounded" height={64} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={360} />
      </PageContainer>
    );
  }

  // 403 здесь означает ровно одно: модуль не подключён. Показать вместо этого
  // формы — обещать работу, которой не будет.
  if (types.isError && types.error instanceof ApiError && types.error.status === 403) {
    return (
      <PageContainer>
        <Alert severity="info" data-testid="grms-module-off">
          {types.error.detail}
        </Alert>
      </PageContainer>
    );
  }
  if (types.isError || !types.data) {
    return (
      <PageContainer>
        <QueryState query={types} what={t('state.what.roomTypes')}>
          {() => null}
        </QueryState>
      </PageContainer>
    );
  }

  const list = types.data.types;
  const current = list.find((type) => type.code === typeCode) ?? null;

  return (
    <PageContainer testId="cms-room-control" sx={{ pb: 10 }}>
      <Stack
        direction="row"
        spacing={2}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ mb: 2 }}
      >
        <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h5" data-testid="cms-page-title">{t('roomControl.title')}</Typography>
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
            onClick={() => navigate(cmsPath('/rooms'))}
          />
        )}
        {list.length > 0 && (
          <SelectField
            size="small"
            fullWidth={false}
            sx={{ minWidth: 220 }}
            label={t('roomControl.type')}
            value={typeCode}
            onChange={setTypeCode}
            testId="grms-type-select"
            options={list.map((type) => ({
              value: type.code,
              label: pickTranslated(type.title, languages.displayLanguage, languages.defaultCode) || type.code,
            }))}
          />
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
      {tab === 'tiles' && <QuickActionsPanel />}

      {tab !== 'access' && tab !== 'tiles' && !current && (
        <EmptyState
          testId="grms-no-types"
          title={t('roomControl.noTypes')}
          description={t('roomControl.noTypesHint')}
        />
      )}

      {current && tab === 'check' && <CheckTab type={current} />}
      {current && tab === 'diagnostics' && <DiagnosticsTab type={current} />}
    </PageContainer>
  );
}
