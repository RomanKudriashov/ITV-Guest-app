import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { HomeBlocksSection } from './HomeBlocksSection';
import { SearchSection } from './SearchSection';

import { CommerceSettingsPage } from '@/cms/commerce/CommerceSettingsPage';
import { LocationsPage } from '@/pages/hotel/LocationsPage';

/**
 * Настройки отеля — новый дом для того, что раньше жило отдельными пунктами.
 *
 * Сюда переехали:
 *
 * * **валюта, налог и сбор отеля** — бывший standalone-раздел «Коммерция».
 *   Он растворён не «ради чистки меню»: почти вся коммерция посервисная с R1,
 *   и отдельный пункт создавал впечатление, что цены настраиваются в одном
 *   месте, тогда как сбор и минимум у каждого заведения свои;
 * * **справочник локаций подачи** — общий для отеля список (номер, лобби,
 *   бассейн, пляж). Каждое заведение выбирает из него свои и ставит свою цену
 *   доставки на вкладке «Доставка и локации».
 *
 * Ни одна настройка при растворении не потерялась — это условие, при котором
 * растворение вообще имело право состояться.
 */
export function SettingsPage() {
  const { t } = useTranslation();

  return (
    <Box sx={{ p: 3 }} data-testid="cms-settings">
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        {t('settings.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('settings.subtitle')}
      </Typography>

      <Stack spacing={4}>
        {/* Главная витрины: погода, координаты, строка состояния номера. Стоит
            первой — это то, что гость видит раньше всего остального. */}
        <Box data-testid="settings-home-blocks">
          <HomeBlocksSection />
        </Box>

        <Divider />

        <Box data-testid="settings-search">
          <SearchSection />
        </Box>

        <Divider />

        <Box data-testid="settings-commerce">
          <Typography variant="h6" sx={{ mb: 1 }}>
            {t('settings.commerce')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('settings.commerceHint')}
          </Typography>
          <CommerceSettingsPage embedded />
        </Box>

        <Divider />

        <Box id="locations" data-testid="settings-locations">
          <Typography variant="h6" sx={{ mb: 1 }}>
            {t('settings.locations')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('settings.locationsHint')}
          </Typography>
          <LocationsPage embedded />
        </Box>
      </Stack>
    </Box>
  );
}
