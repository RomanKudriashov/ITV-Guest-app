import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import GlobalStyles from '@mui/material/GlobalStyles';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { useAppTheme } from '@/theme';
import { createAppTheme } from '@/theme/createAppTheme';
import { DEFAULT_BRAND_TOKENS } from '@/theme/tokens';
import { adminCssVars } from './adminTokens';
import { AdminLogin } from './AdminLogin';
import { AdminShell, type AdminSection } from './AdminShell';
import { ScreenBoundary } from '@/components/ScreenBoundary';
import { OverviewPage } from './pages/OverviewPage';
import { FleetPage } from './pages/FleetPage';
import { HotelPage } from './pages/HotelPage';
import { GroupsPage } from './pages/GroupsPage';
import { PublicationsPage } from './pages/PublicationsPage';
import { ModulesPage } from './pages/ModulesPage';
import { NodesPage } from './pages/NodesPage';
import { TeamPage } from './pages/TeamPage';
import { AuditPage } from './pages/AuditPage';
import { SecurityPage } from './pages/SecurityPage';
import { SupportSessionsPage } from './pages/SupportSessionsPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { accent, ink, typo } from './adminTokens';
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
  // Группы — рядом с флотом, а не в блоке платформы: это разрез ОТЕЛЕЙ, и
  // человек идёт сюда из той же задачи, из которой открывает флот.
  { key: 'groups', labelKey: 'admin.nav.groups' },
  // Публикация — тоже про отели, а не про платформу: адресуется группами.
  { key: 'publications', labelKey: 'admin.nav.publications' },
  { key: 'modules', labelKey: 'admin.nav.modules', group: 'admin.nav.platformGroup' },
  { key: 'nodes', labelKey: 'admin.nav.nodes', group: 'admin.nav.platformGroup' },
  { key: 'templates', labelKey: 'admin.nav.templates', group: 'admin.nav.platformGroup' },
  { key: 'team', labelKey: 'admin.nav.team', group: 'admin.nav.platformGroup' },
  { key: 'support', labelKey: 'admin.nav.support', group: 'admin.nav.platformGroup' },
  { key: 'security', labelKey: 'admin.nav.security', group: 'admin.nav.platformGroup' },
  { key: 'audit', labelKey: 'admin.nav.audit', group: 'admin.nav.platformGroup' },
];

/**
 * Область консоли: платформенная тема + переменные словаря на `:root`.
 *
 * ТЕМА СВОЯ, И ЭТО ГЛАВНОЕ. Общий `AppThemeProvider` держит токены ОТЕЛЯ —
 * `AuthProvider` подставляет их, как только в браузере находится живая сессия
 * CMS. Пока консоль красилась общей темой, достаточно было открыть CMS отеля в
 * соседней вкладке, чтобы уровень владельца платформы оделся в бренд одного из
 * своих клиентов. Здесь тема строится из `DEFAULT_BRAND_TOKENS` — того же
 * платформенного набора, из которого выведен словарь консоли, — и потому
 * MUI-контролы и собственные поверхности консоли согласованы по построению.
 *
 * Переменные ставятся на `:root`, а не на корень оболочки: диалоги и меню MUI
 * живут в портале у `document.body`, вне поддерева консоли.
 */
function AdminScope({ children }: { children: ReactNode }) {
  const { mode, direction } = useAppTheme();
  const theme = useMemo(
    () => createAppTheme(DEFAULT_BRAND_TOKENS, mode, direction),
    [mode, direction],
  );
  const vars = useMemo(() => adminCssVars(mode), [mode]);

  return (
    <MuiThemeProvider theme={theme}>
      <GlobalStyles styles={{ ':root': vars }} />
      {children}
    </MuiThemeProvider>
  );
}

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

  if (!authed) {
    return (
      <AdminScope>
        <AdminLogin onLoggedIn={() => setAuthed(true)} />
      </AdminScope>
    );
  }
  return (
    <AdminScope>
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
    </AdminScope>
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
  /*
    ОТКРЫТЫЙ ОТЕЛЬ — ТОЖЕ В АДРЕСЕ, и по той же причине, что раздел.

    Он оставался в `useState`, и «половина состояния» из комментария выше была
    ровно про него: раздел ссылка несла, а какой отель открыт — нет. F5 на
    карточке отеля возвращал в список, а послать коллеге «смотри лимиты вот
    этого» было нечем. Вкладка карточки живёт в том же адресе (см. HotelPage).
  */
  const hotelId = searchParams.get('hotel');
  const setSection = (next: string, keepHotel = false) => {
    const params = new URLSearchParams(searchParams);
    params.set('section', next);
    if (!keepHotel) params.delete('hotel');
    // Смена раздела сбрасывает чужие фильтры: они относились к прежнему списку
    // и в новом означали бы совсем другое.
    for (const key of ['search', 'action', 'since', 'until', 'status', 'sort']) {
      params.delete(key);
    }
    setSearchParams(params, { replace: true });
  };
  const closeHotel = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('hotel');
    // Вкладка карточки в списке отелей ничего не значит — уносим вместе с ней.
    params.delete('tab');
    setSearchParams(params, { replace: true });
  };
  const me = useQuery({ queryKey: ['admin', 'me'], queryFn: getMe, retry: false });

  const openHotel = (id: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('section', 'fleet');
    params.set('hotel', id);
    setSearchParams(params, { replace: true });
  };

  const crumb =
    hotelId && section === 'fleet' ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <ButtonBase
          onClick={closeHotel}
          data-testid="admin-crumb-fleet"
          sx={{ ...typo.body, color: accent.soft, fontWeight: 600, borderRadius: 1, px: 0.5 }}
        >
          {t('admin.nav.fleet')}
        </ButtonBase>
        <Box sx={{ color: ink.low }}>›</Box>
        <Box sx={{ ...typo.body, color: ink.hi, fontWeight: 700 }}>{t('admin.hotel.crumb')}</Box>
      </Box>
    ) : (
      <Box sx={{ ...typo.body, color: ink.hi, fontWeight: 700 }}>{t(`admin.nav.${section}`)}</Box>
    );

  return (
    <AdminShell
      sections={SECTIONS}
      active={section}
      onNavigate={(key) => setSection(key)}
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
        <HotelPage id={hotelId} onBack={closeHotel} />
      ) : null}
      {section === 'groups' ? <GroupsPage /> : null}
      {section === 'publications' ? <PublicationsPage /> : null}
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
