import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import { useTranslation } from 'react-i18next';

import { AdminLogin } from './AdminLogin';
import { AdminShell, type AdminSection } from './AdminShell';
import { OverviewPage } from './pages/OverviewPage';
import { FleetPage } from './pages/FleetPage';
import { HotelPage } from './pages/HotelPage';
import { accent, ink } from './adminTokens';
import { getMe, platformToken } from './adminClient';

/**
 * Корневая админка `/admin` — уровень владельца платформы.
 *
 * Раздел держится в состоянии, а не в маршруте: админка — это одно рабочее
 * место с реестрами, а не набор страниц, на которые ссылаются извне. Ссылка
 * нужна ровно одна — на саму админку, и она есть.
 */
const SECTIONS: AdminSection[] = [
  { key: 'overview', labelKey: 'admin.nav.overview' },
  { key: 'fleet', labelKey: 'admin.nav.fleet' },
];

export function AdminApp() {
  const [authed, setAuthed] = useState<boolean>(() => Boolean(platformToken.get()));
  if (!authed) return <AdminLogin onLoggedIn={() => setAuthed(true)} />;
  return (
    <Console
      onLogout={() => {
        platformToken.clear();
        setAuthed(false);
      }}
    />
  );
}

function Console({ onLogout }: { onLogout: () => void }) {
  const { t } = useTranslation();
  const [section, setSection] = useState('overview');
  const [hotelId, setHotelId] = useState<string | null>(null);
  const me = useQuery({ queryKey: ['admin', 'me'], queryFn: getMe, retry: false });

  const openHotel = (id: string) => {
    setHotelId(id);
    setSection('fleet');
  };

  const crumb =
    hotelId && section === 'fleet' ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <ButtonBase
          onClick={() => setHotelId(null)}
          data-testid="admin-crumb-fleet"
          sx={{ color: accent.soft, fontSize: 13, fontWeight: 600 }}
        >
          {t('admin.nav.fleet')}
        </ButtonBase>
        <Box sx={{ color: ink.low }}>›</Box>
        <Box sx={{ color: ink.hi, fontWeight: 700 }}>{t('admin.hotel.crumb')}</Box>
      </Box>
    ) : (
      <Box sx={{ color: ink.hi, fontWeight: 700 }}>{t(`admin.nav.${section}`)}</Box>
    );

  return (
    <AdminShell
      sections={SECTIONS}
      active={section}
      onNavigate={(key) => {
        setSection(key);
        setHotelId(null);
      }}
      me={me.data ?? null}
      onLogout={onLogout}
      crumb={crumb}
    >
      {section === 'overview' ? <OverviewPage /> : null}
      {section === 'fleet' && !hotelId ? <FleetPage onOpenHotel={openHotel} /> : null}
      {section === 'fleet' && hotelId ? (
        <HotelPage id={hotelId} onBack={() => setHotelId(null)} />
      ) : null}
    </AdminShell>
  );
}
