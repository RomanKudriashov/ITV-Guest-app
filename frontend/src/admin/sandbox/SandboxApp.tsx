import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import GlobalStyles from '@mui/material/GlobalStyles';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';

import { useAppTheme } from '@/theme';
import { createAppTheme } from '@/theme/createAppTheme';
import { compactTheme } from '@/theme/density';
import { DEFAULT_BRAND_TOKENS } from '@/theme/tokens';
import { adminCssVars, ink, typo } from '../adminTokens';
import { AdminLogin } from '../AdminLogin';
import { AdminShell, type AdminSection } from '../AdminShell';
import { getMe, platformSession, platformToken } from '../adminClient';
import { TilesSandbox } from './TilesSandbox';

/**
 * ПЕСОЧНИЦА NaviRoom Control — `/admin/sandbox`, только dev.
 *
 * 63-1, шаг 1: три вида плитки номерного фонда на выбор (`?s=rooms-tiles`)
 * на живых данных той же ручки `rooms/map`, что у рабочего экрана. Ничего не
 * пишет. Состояние — в адресе.
 */

const SECTIONS: AdminSection[] = [{ key: 'rooms-tiles', labelKey: 'Плитки номеров', icon: <GridViewOutlinedIcon fontSize="small" /> }];

function SandboxScope({ children }: { children: ReactNode }) {
  const { mode, direction } = useAppTheme();
  const theme = useMemo(() => compactTheme(createAppTheme(DEFAULT_BRAND_TOKENS, mode, direction)), [mode, direction]);
  const vars = useMemo(() => adminCssVars(mode), [mode]);
  return (
    <MuiThemeProvider theme={theme}>
      <GlobalStyles styles={{ ':root': vars }} />
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
  const [params, setParams] = useSearchParams();
  const section = params.get('s') || 'rooms-tiles';
  const me = useQuery({ queryKey: ['admin', 'me'], queryFn: getMe, retry: false });
  return (
    <AdminShell
      sections={SECTIONS}
      active={section}
      onNavigate={(key) => setParams({ s: key })}
      me={me.data ?? null}
      onLogout={onLogout}
      crumb={<Box sx={{ ...typo.body, color: ink.hi, fontWeight: 700 }}>{SECTIONS.find((s) => s.key === section)?.labelKey}</Box>}
    >
      <Alert severity="info" sx={{ mb: 2 }} data-testid="sandbox-notice">
        Песочница, партия 63-1: три вида плитки номера на выбор. Данные живые — та же выдача, что у вкладки «Номерной фонд». Ничего не сохраняет.
      </Alert>
      {section === 'rooms-tiles' ? <TilesSandbox /> : null}
    </AdminShell>
  );
}
