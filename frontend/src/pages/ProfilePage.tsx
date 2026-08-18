import { useTranslation } from 'react-i18next';
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
import { useAuth } from '@/auth';
import { SessionsPanel } from '@/components/SessionsPanel';
import { dropAllDrafts } from '@/hooks/useFormDraft';

/**
 * Профиль сотрудника. Пока здесь одно: его собственные входы.
 *
 * Отдельным экраном, а не разделом настроек отеля: настройки — про отель и
 * открыты администратору, а сессии принадлежат ЧЕЛОВЕКУ, и смотреть их вправе
 * каждый, кто вошёл, включая управляющего сервисом.
 */
export function ProfilePage() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();

  return (
    <Box sx={{ p: 3 }} data-testid="cms-profile">
      <Typography variant="h5">{t('profile.title')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {user?.email}
      </Typography>

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
