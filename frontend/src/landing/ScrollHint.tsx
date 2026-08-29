import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { useTranslation } from 'react-i18next';

/**
 * Подсказка «ниже есть содержимое» — стрелка на обложке.
 *
 * Обложка занимает экран целиком, и без неё край страницы читается как её
 * конец. Движение сдержанное: стрелка опускается и возвращается за две с
 * лишним секунды — этого хватает, чтобы заметить, и мало, чтобы отвлекать.
 * Мигания нет намеренно: мигающий элемент требует внимания, а тут нужно лишь
 * обозначить направление.
 */
export function ScrollHint({ calm }: { calm: boolean }) {
  const { t } = useTranslation();
  return (
    <Box
      data-testid="landing-scroll-hint"
      sx={{
        position: 'absolute',
        insetInline: 0,
        bottom: 18,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.25,
        color: 'common.white',
        opacity: 0.72,
        pointerEvents: 'none',
        ...(calm
          ? {}
          : {
              animation: 'landing-hint 2.4s ease-in-out infinite',
              '@keyframes landing-hint': {
                '0%, 100%': { transform: 'translateY(0)' },
                '50%': { transform: 'translateY(7px)' },
              },
            }),
      }}
    >
      <Typography variant="caption">{t('landing.scrollHint')}</Typography>
      <KeyboardArrowDownIcon fontSize="small" />
    </Box>
  );
}
