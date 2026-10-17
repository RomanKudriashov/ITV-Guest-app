import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import {
  closeSession,
  fetchSessions,
  logoutEverywhere,
} from '@/api/cms';
import { session } from '@/api/client';
import { parentOf } from '@/app/backMap';
import { useAuth } from '@/auth';
import { homePathFor } from '@/auth/home';
import { BackLink } from '@/kit/BackLink';
import { ContactsPanel } from '@/components/ContactsPanel';
import { SessionsPanel } from '@/components/SessionsPanel';
import { dropAllDrafts } from '@/hooks/useFormDraft';

/**
 * Профиль сотрудника: его контакты и его входы.
 *
 * Отдельным экраном, а не разделом настроек отеля: настройки — про отель и
 * открыты администратору, а контакты и сессии принадлежат ЧЕЛОВЕКУ, и
 * смотреть их вправе каждый, кто вошёл, — включая повара и горничную, у
 * которых разделов CMS нет вовсе.
 */
export function ProfilePage() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  // Профиль открывают из меню человека в шапке — с любого экрана. Возврат —
  // домой по правам (дашборд, «Мои точки» или доска), а не «куда-то назад»
  // (партия 56).
  const location = useLocation();
  const back = parentOf(location.pathname, { home: homePathFor(user) }, t);

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }} data-testid="cms-profile">
      {back ? <BackLink to={back.to} label={back.label} testId="profile-back" sx={{ mb: 1 }} /> : null}
      <Typography variant="h5">{t('profile.title')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {user?.email}
      </Typography>

      <Card variant="outlined" sx={{ maxWidth: 640, borderColor: 'divider', mb: 2 }}>
        <CardContent>
          <ContactsPanel />
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ maxWidth: 640, borderColor: 'divider' }}>
        <CardContent>
          <Stack spacing={2}>
            <SessionsPanel
              queryKey={['cms', 'sessions']}
              fetchSessions={fetchSessions}
              closeSession={closeSession}
              logoutEverywhere={logoutEverywhere}
              onLoggedOutEverywhere={() => {
                // Текущую закрыли тоже — уходим на вход, как при любой смерти
                // сессии, и тем же путём.
                dropAllDrafts('cms');
                logout();
                session.expire();
              }}
            />
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
