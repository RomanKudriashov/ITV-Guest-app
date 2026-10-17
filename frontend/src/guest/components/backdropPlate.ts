import { useTheme } from '@mui/material/styles';

import { useAppTheme } from '@/theme';
import { pagePlate } from '../storefrontTokens';

/**
 * ПОДЛОЖКА ПОД ТЕКСТОМ, ЛЕЖАЩИМ ПРЯМО НА ФОТО ФОНА (партия 58б).
 *
 * Вуаль на весь экран снята: фото фона бренда видно. Заголовки страниц и
 * пустые состояния лежат прямо на нём — им подложка цветом страницы ровно под
 * текстом. Плотность — из контраста (`pagePlate`): основной и вторичный текст
 * держат 4,5 на любом пикселе кадра. Края мягкие (тень того же цвета), чтобы
 * плашка не читалась отдельной карточкой.
 *
 * Фон не фото (цвет, градиент, фактура) — подложки нет: там прежняя вуаль.
 */
export function useBackdropPlateSx() {
  const { tokens } = useAppTheme();
  const palette = useTheme().palette;
  const bg = tokens.brand?.background;
  if (!(bg?.kind === 'image' && bg.imageUrl)) return {};
  const color = pagePlate(palette.background.default, [palette.text.primary, palette.text.secondary]);
  return {
    backgroundColor: color,
    boxShadow: `0 0 18px 10px ${color}`,
    borderRadius: '14px',
  } as const;
}
