import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { ThemeProvider as MuiThemeProvider, alpha } from '@mui/material/styles';

import { createAppTheme, resolveBackground, useAppTheme } from '@/theme';
import { mergeBrandTokens, pickLogo, type PartialBrandTokens } from '@/theme/tokens';
import { ink, secondaryButtonSx, typo } from '../adminTokens';
import { getHotel } from '../adminClient';
import type { Go } from './SandboxApp';
import { PageHead, Panel, ViewSwitch } from './ui';

/**
 * ЧТО УВИДЯТ ГОСТЬ И СОТРУДНИК ОТКЛЮЧЁННОГО ОТЕЛЯ (партия 62, второй заход).
 *
 * Оба экрана — в настоящем бренде отеля: тема берётся той же публичной
 * ручкой, что у экрана входа гостя (`/api/guest/hotel`). Причина отключения
 * не показывается нигде — её видит только Control.
 */

interface PublicHotel {
  name: string;
  theme?: PartialBrandTokens;
}

async function publicHotel(subdomain: string): Promise<PublicHotel> {
  const res = await fetch('/api/guest/hotel', { headers: { 'X-Hotel-Subdomain': subdomain } });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export function PreviewMock({ go }: { go: Go }) {
  const [params] = useSearchParams();
  const hotelId = params.get('hotel') ?? '';
  const screen = params.get('screen') === 'staff' ? 'staff' : 'guest';
  const { mode } = useAppTheme();
  const profile = useQuery({ queryKey: ['sandbox', 'hotel', hotelId], queryFn: () => getHotel(hotelId), enabled: Boolean(hotelId) });
  const pub = useQuery({
    queryKey: ['sandbox', 'public-hotel', profile.data?.subdomain],
    queryFn: () => publicHotel(profile.data!.subdomain),
    enabled: Boolean(profile.data),
  });
  const tokens = useMemo(() => mergeBrandTokens(pub.data?.theme), [pub.data]);
  const theme = useMemo(() => createAppTheme(tokens, mode, 'ltr'), [tokens, mode]);
  const bg = resolveBackground(tokens, mode);
  const logo = pickLogo(tokens, mode);
  const name = pub.data?.name ?? profile.data?.name ?? '';

  return (
    <Box>
      <Button size="small" sx={{ color: ink.mid, mb: 1, px: 0.5 }} onClick={() => go({ s: 'hotels', screen: null, tab: 'overview' })}>
        ← К отелю
      </Button>
      <PageHead
        title="Если отель отключён"
        subtitle="Так выглядят экраны гостя и сотрудника, пока отель отключён. Причину отключения они не видят — она есть только в Control."
        actions={
          <ViewSwitch
            label="Чей экран"
            value={screen}
            onChange={(v) => go({ screen: v }, true)}
            options={[
              ['guest', 'Гость'],
              ['staff', 'Сотрудник'],
            ]}
          />
        }
      />
      {!pub.data ? (
        <Panel><Box sx={{ ...typo.body, color: ink.mid }}>Загружаем бренд отеля…</Box></Panel>
      ) : (
        <MuiThemeProvider theme={theme}>
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            {screen === 'guest' ? <GuestStub name={name} logo={logo} bg={bg} /> : <StaffLogin name={name} logo={logo} bg={bg} />}
          </Box>
        </MuiThemeProvider>
      )}
      <Typography sx={{ ...typo.caption, color: ink.mid, mt: 2, textAlign: 'center' }}>
        {screen === 'guest'
          ? 'Гость открыл ссылку или QR-код номера. Заказать, написать в чат или управлять номером нельзя.'
          : 'Сотрудник ввёл почту и пароль. Открытые входы уже завершены; новый вход не пускаем, причину не называем.'}
      </Typography>
      <Box sx={{ textAlign: 'center', mt: 1 }}>
        <Button size="small" sx={secondaryButtonSx} onClick={() => go({ screen: screen === 'guest' ? 'staff' : 'guest' }, true)}>
          {screen === 'guest' ? 'Показать вход сотрудника →' : 'Показать экран гостя →'}
        </Button>
      </Box>
    </Box>
  );
}

type Bg = ReturnType<typeof resolveBackground>;

function Backdrop({ bg }: { bg: Bg }) {
  return (
    <>
      <Box aria-hidden sx={{ position: 'absolute', inset: 0, ...bg.css, backgroundSize: 'cover', backgroundPosition: 'center' }} />
      <Box
        aria-hidden
        sx={(t) => ({
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(180deg, ${alpha(t.palette.common.black, 0.25 + bg.dim)} 0%, ${alpha(t.palette.common.black, 0.72)} 100%)`,
        })}
      />
    </>
  );
}

function Mark({ name, logo }: { name: string; logo?: string }) {
  return logo ? (
    <Box component="img" src={logo} alt={name} sx={{ height: 44, maxWidth: 200, objectFit: 'contain' }} />
  ) : (
    <Typography sx={(t) => ({ fontFamily: t.typography.h1.fontFamily, fontWeight: 700, fontSize: 20, color: t.palette.common.white })}>{name}</Typography>
  );
}

function GuestStub({ name, logo, bg }: { name: string; logo?: string; bg: Bg }) {
  return (
    <Box
      data-testid="sandbox-guest-stub"
      sx={(t) => ({
        position: 'relative',
        width: { xs: '100%', sm: 390 },
        height: 760,
        borderRadius: `${t.palette.brand.radius.lg + 8}px`,
        overflow: 'hidden',
        border: `1px solid ${t.palette.divider}`,
        boxShadow: `0 30px 80px -40px ${t.palette.brand.scrim}`,
      })}
    >
      <Backdrop bg={bg} />
      <Box sx={{ position: 'absolute', top: 28, left: 24, right: 24 }}>
        <Mark name={name} logo={logo} />
      </Box>
      <Box sx={(t) => ({ position: 'absolute', left: 24, right: 24, bottom: 40, color: t.palette.common.white })}>
        <Typography sx={(t) => ({ fontFamily: t.typography.h1.fontFamily, fontWeight: 700, fontSize: 30, lineHeight: 1.15, letterSpacing: '-.01em' })}>
          Отель временно не принимает заказы
        </Typography>
        <Typography sx={(t) => ({ mt: 1.5, fontSize: 15, lineHeight: 1.5, color: alpha(t.palette.common.white, 0.86) })}>
          Меню, заказы, чат и управление номером сейчас недоступны. Если нужна помощь — позвоните на ресепшен.
        </Typography>
        <Box sx={(t) => ({ mt: 3, height: 1, bgcolor: alpha(t.palette.common.white, 0.24) })} />
        <Typography sx={(t) => ({ mt: 1.5, fontSize: 13, color: alpha(t.palette.common.white, 0.7) })}>{name}</Typography>
      </Box>
    </Box>
  );
}

function StaffLogin({ name, logo, bg }: { name: string; logo?: string; bg: Bg }) {
  return (
    <Box
      data-testid="sandbox-staff-login"
      sx={(t) => ({
        position: 'relative',
        width: '100%',
        maxWidth: 1040,
        height: { xs: 720, md: 600 },
        borderRadius: `${t.palette.brand.radius.lg}px`,
        overflow: 'hidden',
        border: `1px solid ${t.palette.divider}`,
        boxShadow: `0 30px 80px -40px ${t.palette.brand.scrim}`,
      })}
    >
      <Backdrop bg={bg} />
      <Box sx={{ position: 'absolute', top: 28, left: { xs: 24, md: 48 } }}>
        <Mark name={name} logo={logo} />
      </Box>
      <Box sx={(t) => ({ position: 'absolute', left: { xs: 24, md: 48 }, right: { xs: 24, md: 'auto' }, bottom: { xs: 32, md: 48 }, width: { md: 420 }, color: t.palette.common.white })}>
        <Typography sx={(t) => ({ fontFamily: t.typography.h1.fontFamily, fontWeight: 700, fontSize: 30, lineHeight: 1.15 })}>Вход для сотрудников</Typography>
        <Typography sx={(t) => ({ mt: 1, fontSize: 14, color: alpha(t.palette.common.white, 0.8) })}>Панель отеля · {name}</Typography>
        <Box
          sx={(t) => ({
            mt: 3,
            p: 2,
            borderRadius: `${t.palette.brand.radius.md}px`,
            bgcolor: alpha(t.palette.background.paper, 0.94),
            color: t.palette.text.primary,
            display: 'grid',
            gap: 1.5,
          })}
        >
          <TextField size="small" label="Почта" defaultValue="admin@crystal.local" fullWidth />
          <TextField size="small" label="Пароль" type="password" defaultValue="••••••••••" fullWidth />
          <Button variant="contained" fullWidth>Войти</Button>
          <Box
            role="alert"
            sx={(t) => ({
              p: 1.25,
              borderRadius: `${t.palette.brand.radius.sm}px`,
              bgcolor: alpha(t.palette.text.primary, 0.06),
              border: `1px solid ${t.palette.divider}`,
            })}
          >
            <Typography sx={{ fontWeight: 700, fontSize: 14 }}>Вход недоступен</Typography>
            <Typography sx={(t) => ({ fontSize: 13, color: t.palette.text.secondary, mt: 0.25 })}>
              Сейчас войти в панель нельзя. Если это неожиданно — обратитесь к руководителю.
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
