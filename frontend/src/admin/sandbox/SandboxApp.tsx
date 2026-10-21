import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import GlobalStyles from '@mui/material/GlobalStyles';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import SpaceDashboardOutlinedIcon from '@mui/icons-material/SpaceDashboardOutlined';
import ApartmentOutlinedIcon from '@mui/icons-material/ApartmentOutlined';
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined';
import LibraryBooksOutlinedIcon from '@mui/icons-material/LibraryBooksOutlined';
import ManageAccountsOutlinedIcon from '@mui/icons-material/ManageAccountsOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';

import { useAppTheme } from '@/theme';
import { createAppTheme } from '@/theme/createAppTheme';
import { compactTheme } from '@/theme/density';
import { DEFAULT_BRAND_TOKENS } from '@/theme/tokens';
import { adminCssVars, accent, ink, typo } from '../adminTokens';
import { AdminLogin } from '../AdminLogin';
import { AdminShell, type AdminSection } from '../AdminShell';
import { getHotel, getMe, platformSession, platformToken } from '../adminClient';
import { FleetMock } from './FleetMock';
import { HotelMock } from './HotelMock';
import { ModulesCatalogMock } from './ModulesCatalogMock';
import { PreviewMock } from './PreviewMock';
import { GroupMock } from './GroupMock';
import { useGroups } from './groupsStore';
import { Panel, SandboxNotice } from './ui';

/**
 * ПЕСОЧНИЦА NaviRoom Control (партия 62) — `/admin/sandbox`, только dev.
 *
 * Макеты новой структуры на живых локальных данных, на утверждение. Рабочие
 * экраны консоли не тронуты: оболочка, словарь и ручки чтения — общие,
 * экраны — свои. Ничего не пишет: кнопки действий открывают окна, но не
 * отправляют запросов.
 *
 * Адрес несёт всё состояние: `?s=` раздел, `hotel`, `tab`, `view`, `module`,
 * `dialog` — снимок любого экрана открывается ссылкой.
 */

const SECTIONS: AdminSection[] = [
  { key: 'overview', labelKey: 'Сводка', icon: <SpaceDashboardOutlinedIcon fontSize="small" /> },
  { key: 'hotels', labelKey: 'Отели', icon: <ApartmentOutlinedIcon fontSize="small" /> },
  { key: 'modules', labelKey: 'Модули', icon: <ExtensionOutlinedIcon fontSize="small" /> },
  { key: 'dictionaries', labelKey: 'Справочники', icon: <LibraryBooksOutlinedIcon fontSize="small" />, group: 'Платформа' },
  { key: 'team', labelKey: 'Команда', icon: <ManageAccountsOutlinedIcon fontSize="small" />, group: 'Платформа' },
  { key: 'journal', labelKey: 'Журнал действий', icon: <HistoryOutlinedIcon fontSize="small" />, group: 'Платформа' },
  { key: 'security', labelKey: 'Безопасность', icon: <ShieldOutlinedIcon fontSize="small" />, group: 'Платформа' },
];

function SandboxScope({ children }: { children: ReactNode }) {
  const { mode, direction } = useAppTheme();
  const theme = useMemo(() => compactTheme(createAppTheme(DEFAULT_BRAND_TOKENS, mode, direction)), [mode, direction]);
  const vars = useMemo(() => adminCssVars(mode), [mode]);
  return (
    <MuiThemeProvider theme={theme}>
      <GlobalStyles
        styles={{ ':root': vars, '[data-testid="admin-shell"] table': { backgroundColor: 'var(--adm-surface-s1)' } }}
      />
      {children}
    </MuiThemeProvider>
  );
}

export function SandboxApp() {
  const [authed, setAuthed] = useState<boolean>(() => Boolean(platformToken.get()));
  useEffect(() => {
    platformSession.onExpired(() => setAuthed(false));
    return () => platformSession.onExpired(null);
  }, []);
  return (
    <SandboxScope>
      {authed ? <SandboxConsole onLogout={() => setAuthed(false)} /> : <AdminLogin onLoggedIn={() => setAuthed(true)} />}
    </SandboxScope>
  );
}

const PARKED: Record<string, string> = {
  overview: 'Сводка остаётся как есть; правка — отдельной партией (цифры по области, подписи).',
  dictionaries: 'Справочники — нынешние «Шаблоны и справочники» без изменений структуры.',
  team: 'Команда — нынешние «Пользователи»; сюда же переедет область доступа.',
  journal:
    'Журнал действий — нынешний «Аудит» плюс записи сессий поддержки (вход в отель, обрыв); раздел «Сессии поддержки» убран из меню.',
  security: 'Безопасность — без изменений.',
};

function SandboxConsole({ onLogout }: { onLogout: () => void }) {
  const [params, setParams] = useSearchParams();
  const section = params.get('s') || 'hotels';
  const hotelId = params.get('hotel');
  const groupId = params.get('group');
  const groupTitle = useGroups().find((g) => g.id === groupId)?.title;
  const me = useQuery({ queryKey: ['admin', 'me'], queryFn: getMe, retry: false });
  const hotel = useQuery({ queryKey: ['sandbox', 'hotel', hotelId], queryFn: () => getHotel(hotelId ?? ''), enabled: Boolean(hotelId) });

  const go = (next: Record<string, string | null>, replace = false) => {
    const out = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value == null) out.delete(key);
      else out.set(key, value);
    }
    setParams(out, { replace });
  };

  const crumb =
    section === 'hotels' && groupId && !hotelId ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        <ButtonBase onClick={() => go({ group: null, gtab: null, dialog: null })} sx={{ ...typo.body, color: accent.soft, fontWeight: 600, px: 0.5 }}>
          Отели
        </ButtonBase>
        <Box sx={{ color: ink.low }}>›</Box>
        <Box sx={{ ...typo.body, color: ink.hi, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Группа «{groupTitle ?? '…'}»</Box>
      </Box>
    ) : section === 'hotels' && hotelId ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        <ButtonBase onClick={() => go({ hotel: null, tab: null, dialog: null })} sx={{ ...typo.body, color: accent.soft, fontWeight: 600, px: 0.5 }}>
          Отели
        </ButtonBase>
        <Box sx={{ color: ink.low }}>›</Box>
        <Box sx={{ ...typo.body, color: ink.hi, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {hotel.data?.name ?? '…'}
        </Box>
      </Box>
    ) : (
      <Box sx={{ ...typo.body, color: ink.hi, fontWeight: 700 }}>{section === 'preview' ? 'Если отель отключён' : SECTIONS.find((s) => s.key === section)?.labelKey}</Box>
    );

  return (
    <AdminShell
      sections={SECTIONS}
      active={section === 'preview' ? 'hotels' : section}
      onNavigate={(key) => go(Object.fromEntries(['hotel', 'tab', 'view', 'module', 'dialog', 'sel', 'q', 'state', 'link', 'group', 'layout', 'closed', 'screen', 'mstate', 'who', 'what', 'period', 'need', 'demo', 'hq', 'on', 'group', 'gtab'].map((k) => [k, null]).concat([['s', key]])))}
      me={me.data ?? null}
      onLogout={onLogout}
      crumb={crumb}
    >
      <SandboxNotice>
        Песочница: макет новой структуры Control на утверждение. Данные — живые локальные; кнопки действий открывают окна, но ничего не сохраняют.
      </SandboxNotice>
      {section === 'hotels' && !hotelId && !groupId ? <FleetMock go={go} /> : null}
      {section === 'hotels' && groupId && !hotelId ? <GroupMock id={groupId} go={go} /> : null}
      {section === 'hotels' && hotelId ? <HotelMock id={hotelId} go={go} /> : null}
      {section === 'modules' ? <ModulesCatalogMock go={go} /> : null}
      {section === 'preview' ? <PreviewMock go={go} /> : null}
      {PARKED[section] ? (
        <Panel title={SECTIONS.find((s) => s.key === section)?.labelKey}>
          <Box sx={{ ...typo.body, color: ink.mid }}>{PARKED[section]}</Box>
        </Panel>
      ) : null}
    </AdminShell>
  );
}

export type Go = (next: Record<string, string | null>, replace?: boolean) => void;
