import { useState } from 'react';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { useTranslation } from 'react-i18next';

import { BadgesPage } from '@/cms/badges/BadgesPage';
import { BannersPage } from '@/cms/banners/BannersPage';

/**
 * «Маркетинг» — две вкладки одного раздела: метки и баннеры.
 *
 * Баннеру не дан отдельный пункт меню, хотя соблазн был. Он закрыт ТЕМ ЖЕ
 * модулем, что и метки, и живёт в той же голове оператора: «что мы обещаем
 * гостю на витрине». Два пункта за одним модулем дробили бы навигацию ради
 * технической разницы между таблицами.
 */
export function MarketingPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'badges' | 'banners'>('badges');

  return (
    <Box data-testid="cms-marketing">
      <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ px: 3, pt: 2 }}>
        <Tab value="badges" label={t('badges.title')} data-testid="cms-marketing-tab-badges" />
        <Tab value="banners" label={t('banners.title')} data-testid="cms-marketing-tab-banners" />
      </Tabs>
      {tab === 'badges' ? (
        <BadgesPage />
      ) : (
        <Box sx={{ p: 3 }}>
          <BannersPage />
        </Box>
      )}
    </Box>
  );
}
