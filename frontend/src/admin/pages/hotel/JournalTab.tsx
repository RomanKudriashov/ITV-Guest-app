import Box from '@mui/material/Box';
import { useTranslation } from 'react-i18next';

import { SupportSessionsPage } from '../SupportSessionsPage';
import { RoomControlJournal } from './RoomControlTab';
import { Help, Panel } from '../hotels/hotelsUi';

/**
 * ЖУРНАЛ ОТЕЛЯ (партия 62-B): входы поддержки в панель этого отеля и журнал
 * оборудования (бывшая «Диагностика»). Пока как есть — в новой рамке.
 */
export function JournalTab({ hotelId }: { hotelId: string }) {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'grid', gap: 2 }} data-testid="admin-journal">
      <Panel title={t('admin.card.journal.support')} aside={<Help>{t('admin.card.journal.supportHelp')}</Help>}>
        <SupportSessionsPage hotelId={hotelId} />
      </Panel>
      <Panel title={t('admin.card.journal.hardware')} aside={<Help>{t('admin.card.journal.hardwareHelp')}</Help>}>
        <RoomControlJournal hotelId={hotelId} />
      </Panel>
    </Box>
  );
}
