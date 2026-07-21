import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';

import { fetchNotificationChannels } from '@/api/notifications';
import { queryKeys } from '@/api/queryKeys';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';
import { ChannelsTab } from './ChannelsTab';
import { EscalationTab } from './EscalationTab';
import { LogTab } from './LogTab';

type Section = 'channels' | 'escalation' | 'log';

const SECTIONS: Section[] = ['channels', 'escalation', 'log'];

/**
 * `/cms/notifications` — the three halves of one subject: where a request can
 * be sent, when it gets raised, and what actually happened.
 */
export function NotificationsPage() {
  const { t } = useTranslation();
  const [section, setSection] = useState<Section>('channels');

  const { data: bootstrap } = useBootstrap();
  const languages = useContentLanguages(bootstrap);

  // Shared by every section: the escalation steps point at channels and the
  // journal names them.
  const channelsQuery = useQuery({
    queryKey: queryKeys.notificationChannels,
    queryFn: fetchNotificationChannels,
  });

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Stack>
          <Typography variant="h5">{t('notifications.title')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('notifications.subtitle')}
          </Typography>
        </Stack>

        <Tabs
          value={section}
          onChange={(_event, value: Section) => setSection(value)}
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          {SECTIONS.map((key) => (
            <Tab
              key={key}
              value={key}
              label={t(`notifications.tabs.${key}`)}
              data-testid={`cms-notifications-tab-${key}`}
            />
          ))}
        </Tabs>

        {section === 'channels' ? (
          <ChannelsTab bootstrap={bootstrap} languages={languages} />
        ) : null}
        {section === 'escalation' ? (
          <EscalationTab bootstrap={bootstrap} languages={languages} />
        ) : null}
        {/* Mounted only while chosen — that is what stops the 10-second poll. */}
        {section === 'log' ? <LogTab channels={channelsQuery.data ?? []} /> : null}
      </Stack>
    </Box>
  );
}
