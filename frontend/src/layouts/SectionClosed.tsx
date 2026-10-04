import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';

import { cmsPath } from '@/app/hostRole';

/**
 * Раздел есть, но не для этой роли (партия 31, DEV-07). Одно состояние
 * вместо экрана, который грузит закрытые секции и показывает «Не удалось
 * загрузить» там, где на самом деле «нельзя». Меню остаётся — уйти есть куда.
 */
export function SectionClosed() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Stack sx={{ p: 3 }} alignItems="center" data-testid="cms-section-closed">
      <Paper variant="outlined" sx={{ p: 4, maxWidth: 460, textAlign: 'center' }}>
        <Stack spacing={2} alignItems="center">
          <LockOutlinedIcon color="action" sx={{ fontSize: 40 }} />
          <Typography variant="h6">{t('access.sectionClosedTitle')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('access.sectionClosedBody')}
          </Typography>
          <Button variant="contained" onClick={() => navigate(cmsPath('/dashboard'))} data-testid="section-closed-home">
            {t('access.sectionClosedHome')}
          </Button>
        </Stack>
      </Paper>
    </Stack>
  );
}
