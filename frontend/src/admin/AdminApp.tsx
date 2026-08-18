import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import { useTranslation } from 'react-i18next';

import { AdminLogin } from './AdminLogin';
import { AdminShell, type AdminSection } from './AdminShell';
import { ScreenBoundary } from '@/components/ScreenBoundary';
import { OverviewPage } from './pages/OverviewPage';
import { FleetPage } from './pages/FleetPage';
import { HotelPage } from './pages/HotelPage';
import { ModulesPage } from './pages/ModulesPage';
import { NodesPage } from './pages/NodesPage';
import { TeamPage } from './pages/TeamPage';
import { AuditPage } from './pages/AuditPage';
import { SecurityPage } from './pages/SecurityPage';
import { SupportSessionsPage } from './pages/SupportSessionsPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { accent, ink } from './adminTokens';
import { getMe, platformLogoutHere, platformSession, platformToken } from './adminClient';

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
  // Ниже — то, что относится к самой платформе, а не к отелям. Группировка та
  // же, что в CMS (R4): плоская простыня одинаковых пунктов не даёт понять,
  // где кончаются отели и начинается платформа.
  { key: 'modules', labelKey: 'admin.nav.modules', group: 'admin.nav.platformGroup' },
  { key: 'nodes', labelKey: 'admin.nav.nodes', group: 'admin.nav.platformGroup' },
  { key: 'templates', labelKey: 'admin.nav.templates', group: 'admin.nav.platformGroup' },
  { key: 'team', labelKey: 'admin.nav.team', group: 'admin.nav.platformGroup' },
  { key: 'support', labelKey: 'admin.nav.support', group: 'admin.nav.platformGroup' },
  { key: 'security', labelKey: 'admin.nav.security', group: 'admin.nav.platformGroup' },
  { key: 'audit', labelKey: 'admin.nav.audit', group: 'admin.nav.platformGroup' },
];

export function AdminApp() {
  const [authed, setAuthed] = useState<boolean>(() => Boolean(platformToken.get()));

  /*
    СМЕРТЬ СЕССИИ ПОКАЗЫВАЕТ ВХОД.

    Общий механизм умеет уводить жёстким переходом, но консоли этого мало:
    у неё приложение и форма входа живут по ОДНОМУ адресу `/admin`, и защита
    «не редиректить, если уже на входе» глушила переход целиком — токены
    вычищались, а на экране оставалась оболочка, продолжавшая получать 401.
    Поэтому здесь, как и в CMS, свой обработчик: он просто показывает вход.
  */
  useEffect(() => {
    platformSession.onExpired(() => setAuthed(false));
    return () => platformSession.onExpired(null);
  }, []);

  if (!authed) return <AdminLogin onLoggedIn={() => setAuthed(true)} />;
  return (
    <Console
      onLogout={() => {
        // Сессию рвём НА СЕРВЕРЕ, иначе «выйти» — это только забыть токены в
        // этом браузере, а снятая заранее копия refresh живёт ещё неделю.
        // Ответа не ждём: выйти человек должен и без сети.
        void platformLogoutHere().catch(() => undefined);
        platformToken.clear();
        setAuthed(false);
      }}
    />
  );
}

function Console({ onLogout }: { onLogout: () => void }) {
  const { t } = useTranslation();
  /*
    РАЗДЕЛ КОНСОЛИ ЖИВЁТ В АДРЕСЕ.

    Он лежал в `useState`, и ссылка на выборку — «журнал, отель crystal» —
    открывалась у коллеги на «Сводке»: фильтры в адресе были, а раздела, к
    которому они относятся, не было. Половина состояния в адресе бесполезна:
    поделиться можно только целым.
  */
  const [searchParams, setSearchParams] = useSearchParams();
  const section = searchParams.get('section') || 'overview';
  const setSection = (next: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('section', next);
    // Смена раздела сбрасывает чужие фильтры: они относились к прежнему списку
    // и в новом означали бы совсем другое.
    for (const key of ['search', 'action', 'since', 'until', 'status', 'sort']) {
      params.delete(key);
    }
    setSearchParams(params, { replace: true });
  };
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
      <ScreenBoundary
        key={section}
        message={t('state.crashed')}
        actionLabel={t('state.reload')}
      >
      {section === 'overview' ? <OverviewPage /> : null}
      {section === 'fleet' && !hotelId ? <FleetPage onOpenHotel={openHotel} /> : null}
      {section === 'fleet' && hotelId ? (
        <HotelPage id={hotelId} onBack={() => setHotelId(null)} />
      ) : null}
      {section === 'modules' ? <ModulesPage /> : null}
      {section === 'nodes' ? <NodesPage /> : null}
      {section === 'templates' ? <TemplatesPage /> : null}
      {section === 'team' ? <TeamPage /> : null}
      {section === 'audit' ? <AuditPage /> : null}
      {section === 'support' ? <SupportSessionsPage /> : null}
      {section === 'security' ? <SecurityPage /> : null}
      </ScreenBoundary>
    </AdminShell>
  );
}
