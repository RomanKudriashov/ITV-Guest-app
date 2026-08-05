import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { ApiError } from '@/api/client';
import { fetchGrmsTypes } from '@/api/grms';
import { queryKeys } from '@/api/queryKeys';
import { EmptyState } from '@/components/EmptyState';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';
import { pickTranslated } from '@/utils/translated';
import { AccessTab } from './AccessTab';
import { BuilderTab } from './BuilderTab';
import { CheckTab } from './CheckTab';
import { ImportTab } from './ImportTab';
import { PlanEditor } from './PlanEditor';
import { VersionsTab } from './VersionsTab';

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
type TabKey = 'import' | 'builder' | 'plan' | 'check' | 'versions' | 'access';

const TABS: TabKey[] = ['import', 'builder', 'plan', 'check', 'versions', 'access'];

export function RoomControlPage() {
  const { t } = useTranslation();
  const { data: bootstrap } = useBootstrap();
  const languages = useContentLanguages(bootstrap);
  const [tab, setTab] = useState<TabKey>('import');
  const [typeCode, setTypeCode] = useState('');

  const types = useQuery({ queryKey: queryKeys.grmsTypes, queryFn: fetchGrmsTypes });

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
        <Alert severity="error">{t('roomControl.loadError')}</Alert>
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

      {tab === 'import' && <ImportTab onImported={() => void types.refetch()} />}
      {tab === 'access' && <AccessTab />}

      {tab !== 'import' && tab !== 'access' && !current && (
        <EmptyState
          testId="grms-no-types"
          title={t('roomControl.noTypes')}
          description={t('roomControl.noTypesHint')}
        />
      )}

      {current && tab === 'builder' && <BuilderTab type={current} />}
      {current && tab === 'plan' && <PlanEditor code={current.code} types={list} />}
      {current && tab === 'check' && <CheckTab type={current} />}
      {current && tab === 'versions' && <VersionsTab type={current} />}
    </Box>
  );
}
