import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ConstructionOutlinedIcon from '@mui/icons-material/ConstructionOutlined';
import { cmsPath } from '@/app/hostRole';

/**
 * Модуль подключён, экрана ещё нет.
 *
 * Навигация обещала три таких раздела (PMS, оплата, мобильный ключ), а
 * маршрутов под них в роутере не было: адрес не совпадал ни с чем в ветке
 * /cms, проваливался в корневую и уезжал по `*` на гостевую главную. Админ
 * отеля из своей панели попадал к гостю — и решал, что сломалась панель.
 *
 * Прятать пункт нельзя: модуль оплачен и включён, исчезнувший раздел читался
 * бы как «пропало то, за что заплатили». Поэтому пункт остаётся, а экран
 * честно говорит, в каком он состоянии.
 */
export function ModulePendingPage({ moduleKey }: { moduleKey: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Box sx={{ p: 3 }} data-testid={`module-pending-${moduleKey}`}>
      <Paper variant="outlined" sx={{ p: 4, maxWidth: 560 }}>
        <Stack spacing={2} alignItems="flex-start">
          <ConstructionOutlinedIcon color="action" sx={{ fontSize: 36 }} />
          <Typography variant="h6">{t(`nav.${moduleKey}`)}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('modulePending.body')}
          </Typography>
          <Button variant="outlined" size="small" onClick={() => navigate(cmsPath('/dashboard'))}>
            {t('modulePending.toDashboard')}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
