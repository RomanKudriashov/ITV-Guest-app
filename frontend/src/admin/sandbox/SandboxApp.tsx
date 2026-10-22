import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import GlobalStyles from '@mui/material/GlobalStyles';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import CableOutlinedIcon from '@mui/icons-material/CableOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';

import { useAppTheme } from '@/theme';
import { createAppTheme } from '@/theme/createAppTheme';
import { compactTheme } from '@/theme/density';
import { DEFAULT_BRAND_TOKENS } from '@/theme/tokens';
import { adminCssVars, ink, typo } from '../adminTokens';
import { AdminLogin } from '../AdminLogin';
import { AdminShell, type AdminSection } from '../AdminShell';
import { getMe, platformSession, platformToken } from '../adminClient';
import { RoomsMock } from './RoomsMock';
import { ConnectMock } from './ConnectMock';
import { VariantsMock } from './VariantsMock';
import { useGo } from './ui';

/**
 * ПЕСОЧНИЦА NaviRoom Control, партия 63-М — `/admin/sandbox`, только dev.
 *
 * Три экрана на утверждение, у каждого 2–3 варианта (разные идеи, а не
 * перекраска): номерной фонд, подключение управления номером, варианты
 * номеров. Данные — живые локальные и снимок стенда; чего в данных нет —
 * с плашкой «образец». Ничего не пишет: кнопки открывают окна без запросов.
 * Всё состояние — в адресе: `s` экран, `v` вариант, `hotel`, `view`,
 * `layer`, выбор, шаг.
 */

const SECTIONS: AdminSection[] = [
  { key: 'rooms', labelKey: 'Номерной фонд', icon: <GridViewOutlinedIcon fontSize="small" /> },
  { key: 'connect', labelKey: 'Подключение', icon: <CableOutlinedIcon fontSize="small" /> },
  { key: 'variants', labelKey: 'Варианты номеров', icon: <TuneOutlinedIcon fontSize="small" /> },
];

function SandboxScope({ children }: { children: ReactNode }) {
  const { mode, direction } = useAppTheme();
  const theme = useMemo(() => compactTheme(createAppTheme(DEFAULT_BRAND_TOKENS, mode, direction)), [mode, direction]);
  const vars = useMemo(() => adminCssVars(mode), [mode]);
  return (
    <MuiThemeProvider theme={theme}>
      <GlobalStyles styles={{ ':root': vars, '[data-testid="admin-shell"] table': { backgroundColor: 'var(--adm-surface-s1)' } }} />
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
  return <SandboxScope>{authed ? <Console onLogout={() => setAuthed(false)} /> : <AdminLogin onLoggedIn={() => setAuthed(true)} />}</SandboxScope>;
}

function Console({ onLogout }: { onLogout: () => void }) {
  const [params, go] = useGo();
  const section = params.get('s') || 'rooms';
  const me = useQuery({ queryKey: ['admin', 'me'], queryFn: getMe, retry: false });
  return (
    <AdminShell
      sections={SECTIONS}
      active={section}
      onNavigate={(key) => go({ s: key, v: null, view: null, layer: null, sel: null, step: null, dialog: null, variant: null, path: null, q: null }, false)}
      me={me.data ?? null}
      onLogout={onLogout}
      crumb={<Box sx={{ ...typo.body, color: ink.hi, fontWeight: 700 }}>{SECTIONS.find((s) => s.key === section)?.labelKey}</Box>}
    >
      <Alert severity="info" sx={{ mb: 2 }} data-testid="sandbox-notice">
        Песочница, партия 63-М: макеты на утверждение. Номера — живые (локальные отели) и снимок стенда (Метрополь, Сиалия); чего нет в данных — с плашкой «образец». Кнопки открывают окна, но ничего не сохраняют.
      </Alert>
      {section === 'rooms' ? <RoomsMock /> : null}
      {section === 'connect' ? <ConnectMock /> : null}
      {section === 'variants' ? <VariantsMock /> : null}
    </AdminShell>
  );
}
