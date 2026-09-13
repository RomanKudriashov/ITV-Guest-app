import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { useTranslation } from 'react-i18next';

export interface OverdueBelowProps {
  /** Колонка, в которой считаем, — её код совпадает с `data-testid`. */
  columnCode: string;
  /** Состав колонки; изменился — пересчитываем, не дожидаясь прокрутки. */
  signature: string;
}

/**
 * «НИЖЕ ЕСТЬ N ПРОСРОЧЕННЫХ».
 *
 * Ручной порядок дал смене право решать, что делать раньше, — и вместе с ним
 * возможность НЕ УВИДЕТЬ просроченное: карточка, отодвинутая вниз, уезжает за
 * край экрана вместе со своим красным. Автоматически поднимать её наверх
 * нельзя: это отменяло бы решение смены ровно под нагрузкой, когда оно важнее
 * всего. Поэтому доска не переставляет, а ГОВОРИТ.
 *
 * Считается по разметке, а не по данным: «ниже экрана» — это факт о том, что
 * человек видит, и вычислить его из списка заказов нельзя. Пересчёт идёт на
 * прокрутке, на изменении размера окна и при смене состава колонки.
 */
export function OverdueBelow({ columnCode, signature }: OverdueBelowProps) {
  const { t } = useTranslation();
  const [count, setCount] = useState(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const recount = () => {
      const column = document.querySelector(`[data-testid="tracker-column-${columnCode}"]`);
      if (!column) {
        setCount(0);
        return;
      }
      const hidden = Array.from(
        column.querySelectorAll('[data-overdue="true"]'),
      ).filter((card) => card.getBoundingClientRect().top >= window.innerHeight);
      setCount(hidden.length);
    };

    // Прокрутка сыплет событиями чаще, чем браузер рисует кадры; считать на
    // каждое — значит мерить прямоугольники вхолостую десятки раз за кадр.
    const schedule = () => {
      if (frame.current !== null) return;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        recount();
      });
    };

    recount();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
  }, [columnCode, signature]);

  if (!count) return null;

  return (
    <Box
      data-testid={`tracker-overdue-below-${columnCode}`}
      sx={{
        position: 'sticky',
        bottom: 8,
        zIndex: 2,
        mt: 1,
        px: 1.5,
        py: 1,
        borderRadius: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        bgcolor: 'error.main',
        color: 'error.contrastText',
        boxShadow: 3,
      }}
    >
      <AccessTimeIcon fontSize="small" />
      <Typography variant="caption" sx={{ fontWeight: 600 }}>
        {t('tracker.board.overdueBelow', { count })}
      </Typography>
    </Box>
  );
}
