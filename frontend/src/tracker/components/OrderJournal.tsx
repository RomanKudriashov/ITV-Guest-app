import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import UndoIcon from '@mui/icons-material/Undo';
import { useTranslation } from 'react-i18next';

import type { TrackerJournalEntry } from '../api/types';

function formatTime(iso: string, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

/**
 * ЖУРНАЛ ПЕРЕХОДОВ — ЧТО ДЕЛАЛИ СО ЗАКАЗОМ РУКАМИ.
 *
 * Рядом стоит гостевой таймлайн, и это НЕ ОДНО И ТО ЖЕ. Таймлайн показывает
 * путь по потоку: где заказ сейчас и что пройдено. Он не умеет сказать, что
 * заказ возвращали, кто это сделал и откуда вернули, — а разбор смены
 * начинается ровно с этих вопросов.
 *
 * ОТКАТ ПОМЕЧЕН ОТДЕЛЬНО И ВИДЕН КАК ОТКАТ. Строка «14:40 Готовится» среди
 * прочих читается как обычный шаг вперёд, хотя это возврат из «Доставлено».
 * Поэтому у возврата свой значок, своя подпись и названо, ОТКУДА вернули.
 *
 * «СИСТЕМА» ОТЛИЧАЕТСЯ ОТ ЧЕЛОВЕКА. Заказ-агрегат пересчитывается сам, когда
 * повар вернул свою часть; назвать в этой строке имя того, кто трогал соседнюю
 * карточку, значило бы обвинить невиновного.
 */
export function OrderJournal({ entries }: { entries: TrackerJournalEntry[] }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en';

  if (!entries.length) return null;

  return (
    <Stack spacing={1} data-testid="tracker-order-journal" role="list">
      {entries
        .slice()
        .reverse()
        .map((entry, index) => (
          <Stack
            key={`${entry.to}-${entry.at}-${index}`}
            direction="row"
            spacing={1}
            alignItems="flex-start"
            role="listitem"
            data-testid={`tracker-journal-entry-${entries.length - 1 - index}`}
            data-rollback={entry.is_rollback ? 'true' : 'false'}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ minWidth: 44, pt: 0.25, fontVariantNumeric: 'tabular-nums' }}
            >
              {formatTime(entry.at, language)}
            </Typography>
            <Stack spacing={0.25} sx={{ minWidth: 0, flexGrow: 1 }}>
              <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
                <Typography variant="body2">{entry.title}</Typography>
                {entry.is_rollback ? (
                  <Chip
                    size="small"
                    color="warning"
                    variant="outlined"
                    icon={<UndoIcon fontSize="small" />}
                    label={t('tracker.journal.rollback')}
                    data-testid="tracker-journal-rollback"
                  />
                ) : null}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {entry.is_rollback && entry.from
                  ? t('tracker.journal.backFrom', { from: entry.from })
                  : null}
                {entry.is_rollback && entry.from ? ' · ' : ''}
                {entry.actor_type === 'system'
                  ? t('tracker.journal.bySystem')
                  : entry.actor_name
                    ? t('tracker.journal.byPerson', { name: entry.actor_name })
                    : t('tracker.journal.byGuest')}
              </Typography>
            </Stack>
          </Stack>
        ))}
    </Stack>
  );
}
