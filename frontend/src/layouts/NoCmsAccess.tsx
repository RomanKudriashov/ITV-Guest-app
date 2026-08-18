import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';

import { useAuth } from '@/auth/AuthProvider';

/**
 * Отказ по правам — с выходом, а не тупик.
 *
 * Линейный сотрудник (повар, горничная, консьерж) на любом адресе /cms получал
 * оболочку CMS без единого пункта меню, кнопку «Добавить сервис» и «Не удалось
 * загрузить заведения · Повторить». Три обмана сразу: отказ по правам показан
 * как сбой загрузки; «Повторить» предлагает то, что не сработает никогда; а
 * уйти отсюда некуда — панели нет, ссылок нет.
 *
 * Здесь сказано, что происходит, и дана дорога на его рабочее место.
 */
export function NoCmsAccess() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  return (
    <Box
      sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh', p: 3 }}
      data-testid="cms-no-access"
    >
      <Paper variant="outlined" sx={{ p: 4, maxWidth: 460, textAlign: 'center' }}>
        <Stack spacing={2} alignItems="center">
          <LockOutlinedIcon color="action" sx={{ fontSize: 40 }} />
          <Typography variant="h6">{t('access.cmsTitle')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('access.cmsBody')}
          </Typography>
          <Button
            variant="contained"
            onClick={() => navigate('/tracker')}
            data-testid="no-access-to-tracker"
          >
            {t('access.toTracker')}
          </Button>
          <Button size="small" onClick={logout} data-testid="no-access-logout">
            {t('auth.logout')}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
