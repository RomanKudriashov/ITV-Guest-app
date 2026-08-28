import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { formatAge } from '../orderAge';
import type { TrackerShift } from '../api/types';
import { density, touchTarget } from '@/theme/density';

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
 * Сужают три: «новых», «в работе» и «просрочено». «Сделано» и «скорость» —
 * про закрытую работу, показать её на активной доске нельзя, а кнопка, которая
 * ничего не покажет, хуже её отсутствия.
 *
 * «Просрочено» ведёт ТОТ ЖЕ параметр, что галка «только просроченные» в панели
 * фильтров: два ответа на один вопрос однажды разойдутся. Ответ один, входа
 * два, и они видимо согласованы.
 */

export type ShiftFocus = '' | 'new' | 'in_work';

export interface ShiftTilesProps {
  shift: TrackerShift;
  focus: ShiftFocus;
  /** Включён ли фильтр просрочки — им же управляет галка в панели фильтров. */
  overdueOn: boolean;
  onFocus: (next: ShiftFocus) => void;
  onOverdue: (on: boolean) => void;
}

export function ShiftTiles({ shift, focus, overdueOn, onFocus, onOverdue }: ShiftTilesProps) {
  const { t, i18n } = useTranslation();
  const language = (i18n.resolvedLanguage ?? i18n.language ?? 'en').split('-')[0];

  // Ступени: невзятое и взятое. Взаимоисключающие — заказ либо ждёт, либо уже
  // у кого-то в руках.
  const tiles = [
    { key: 'new' as const, label: t('tracker.shift.new'), value: shift.new, tone: 'info' as const },
    {
      key: 'in_work' as const,
      label: t('tracker.shift.inWork'),
      value: shift.in_work,
      tone: 'primary' as const,
    },
  ];

  return (
    <Box
      data-testid="tracker-shift"
      /*
        СТРОКА, А НЕ БЛОКИ. Сводка занимала сеткой полосу в половину экрана, а
        отвечает она на два коротких вопроса: сколько ждёт и сколько в работе.
        Плитки встают в ряд и растягиваются только по содержимому — место
        остаётся карточкам, ради которых доска и открыта.
      */
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 0.75,
        px: { xs: 1, md: 1.5 },
        pt: { xs: 1, md: 1.5 },
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
      {/*
        Просрочка — отдельный параметр, а не третья ступень: она бывает и у
        новых, и у взятых в работу, и один переключатель на двоих заставлял бы
        выбирать между двумя разными вопросами.

        ПОЯВЛЯЕТСЯ ТОЛЬКО ПРИ ЗНАЧЕНИИ БОЛЬШЕ НУЛЯ: постоянный красный ноль —
        это тревога, включённая всегда, а значит, её перестают замечать.
      */}
      {shift.overdue > 0 ? (
        <Tile
          label={t('tracker.shift.overdue')}
          value={String(shift.overdue)}
          tone="error"
          testId="tracker-tile-overdue"
          active={overdueOn}
          onClick={() => onOverdue(!overdueOn)}
        />
      ) : null}
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
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 0.75,
        textAlign: 'start',
        font: 'inherit',
        px: 1,
        py: 0.5,
        borderRadius: 1.5,
        /*
          ВИД СЖАТ, ЦЕЛЬ НАЖАТИЯ — НЕТ. Высота плитки больше не 44px: столько
          места ради двух цифр на доске не нужно. Площадь под пальцем добирает
          прозрачный слой (`touchTarget`) — он выходит за границы плитки и
          ничего не сдвигает в раскладке.
        */
        ...touchTarget(),
        cursor: clickable ? 'pointer' : 'default',
        bgcolor: active ? alpha(theme.palette[tone].main, 0.14) : 'background.paper',
        border: 1,
        borderColor: active ? `${tone}.main` : 'divider',
        transition: 'border-color .15s, background-color .15s',
      })}
    >
      <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
        {label}
      </Typography>
      <Typography
        color={`${tone}.main`}
        sx={{
          fontSize: density.font.strong,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.2,
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}
