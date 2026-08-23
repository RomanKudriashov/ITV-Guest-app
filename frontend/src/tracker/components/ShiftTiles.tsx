import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { formatAge } from '../orderAge';
import type { TrackerShift } from '../api/types';

/**
 * СВОДКА СМЕНЫ ПЛИТКАМИ.
 *
 * Пять чисел, которые отвечают на вопросы смены: сколько ждёт, сколько в
 * работе, сколько горит, сколько сделано и как быстро. Раньше первые три
 * приходилось считать глазами по колонкам, а последних двух не было вовсе.
 *
 * ПЛИТКА — ЭТО И ЧИСЛО, И ФИЛЬТР. «Просрочено 3» без возможности нажать
 * заставляет искать эти три карточки по всем колонкам; с нажатием доска
 * показывает ровно их. Сужает СЕРВЕР — отсев уже полученной доски соврал бы
 * на первом же заказе, который не приехал.
 *
 * Сужаются первые три. «Сделано» и «скорость» — про закрытую работу, их нельзя
 * показать на активной доске, и кнопка, которая ничего не покажет, хуже её
 * отсутствия.
 */

export type ShiftFocus = '' | 'new' | 'in_work' | 'overdue';

export interface ShiftTilesProps {
  shift: TrackerShift;
  focus: ShiftFocus;
  onFocus: (next: ShiftFocus) => void;
}

export function ShiftTiles({ shift, focus, onFocus }: ShiftTilesProps) {
  const { t, i18n } = useTranslation();
  const language = (i18n.resolvedLanguage ?? i18n.language ?? 'en').split('-')[0];

  /*
    «Просрочено» ПОЯВЛЯЕТСЯ ТОЛЬКО ПРИ ЗНАЧЕНИИ БОЛЬШЕ НУЛЯ.

    Постоянный красный ноль — это тревога, которая всегда включена, а значит,
    её перестают замечать. Плитка должна означать «смотри сюда»; если она висит
    всю смену, она не означает ничего.
  */
  const tiles = [
    { key: 'new' as const, label: t('tracker.shift.new'), value: shift.new, tone: 'info' as const },
    {
      key: 'in_work' as const,
      label: t('tracker.shift.inWork'),
      value: shift.in_work,
      tone: 'primary' as const,
    },
    ...(shift.overdue > 0
      ? [
          {
            key: 'overdue' as const,
            label: t('tracker.shift.overdue'),
            value: shift.overdue,
            tone: 'error' as const,
          },
        ]
      : []),
  ];

  return (
    <Box
      data-testid="tracker-shift"
      sx={{
        display: 'grid',
        gap: 1,
        px: { xs: 1.5, md: 2 },
        pt: { xs: 1.5, md: 2 },
        gridTemplateColumns: {
          xs: 'repeat(2, 1fr)',
          sm: `repeat(${tiles.length + 2}, 1fr)`,
        },
      }}
    >
      {tiles.map((tile) => (
        <Tile
          key={tile.key}
          label={tile.label}
          value={String(tile.value)}
          tone={tile.tone}
          testId={`tracker-tile-${tile.key}`}
          active={focus === tile.key}
          // Повторное нажатие снимает срез: иначе выйти из него можно было бы
          // только правкой адреса.
          onClick={() => onFocus(focus === tile.key ? '' : tile.key)}
        />
      ))}
      <Tile
        label={t('tracker.shift.done')}
        value={String(shift.done)}
        tone="success"
        testId="tracker-tile-done"
      />
      <Tile
        label={t('tracker.shift.speed')}
        /*
          Медиана, а не среднее: один заказ, забытый на двое суток, утаскивает
          среднее в бессмыслицу, и смена справедливо перестаёт верить цифре.
          Нечего мерить — говорим прочерком, а не нулём: «0 минут» читалось бы
          как «мгновенно».
        */
        value={
          shift.median_minutes === null
            ? '—'
            : formatAge(shift.median_minutes, null, t, language)
        }
        tone="success"
        testId="tracker-tile-speed"
      />
    </Box>
  );
}

function Tile({
  label,
  value,
  tone,
  testId,
  active,
  onClick,
}: {
  label: string;
  value: string;
  tone: 'info' | 'primary' | 'error' | 'success';
  testId: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const clickable = Boolean(onClick);
  return (
    <Box
      component={clickable ? 'button' : 'div'}
      type={clickable ? 'button' : undefined}
      onClick={onClick}
      aria-pressed={clickable ? Boolean(active) : undefined}
      data-testid={testId}
      sx={(theme) => ({
        textAlign: 'start',
        font: 'inherit',
        p: 1.25,
        borderRadius: 2,
        minHeight: 44,
        cursor: clickable ? 'pointer' : 'default',
        bgcolor: active ? alpha(theme.palette[tone].main, 0.14) : 'background.paper',
        border: 1,
        borderColor: active ? `${tone}.main` : 'divider',
        transition: 'border-color .15s, background-color .15s',
      })}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', lineHeight: 1.2 }}
      >
        {label}
      </Typography>
      <Typography
        variant="h6"
        color={`${tone}.main`}
        sx={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}
      >
        {value}
      </Typography>
    </Box>
  );
}
