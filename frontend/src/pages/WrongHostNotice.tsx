import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { APP_DOMAIN } from '@/app/hostRole';

/**
 * «Вы не на адресе отеля».
 *
 * Экран для пришедшего по СТАРОЙ ссылке: раньше корень платформы показывал
 * гостевой вход с полем номера и живой кнопкой, хотя отель определить было
 * неоткуда — нажатие давало ошибку сервера, и человек считал, что сломано
 * приложение. Теперь на этом месте прямой ответ: адрес не тот, нужный адрес
 * выглядит вот так, и вот куда идти дальше.
 *
 * Списка отелей здесь НЕТ и быть не может: он тянул бы данные отелей на
 * страницу, которая обязана открываться без единого запроса, и заодно
 * показывал бы каждому посетителю, кто наши клиенты.
 */
export function WrongHostNotice() {
  const { t } = useTranslation();
  const example = APP_DOMAIN ? `hotel.${APP_DOMAIN}` : 'hotel.<домен>';

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        p: 3,
        bgcolor: 'background.default',
      }}
      data-testid="wrong-host-notice"
    >
      <Stack spacing={2} sx={{ maxWidth: 520, textAlign: 'center' }}>
        <Typography variant="h6">{t('wrongHost.title')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('wrongHost.body')}
        </Typography>
        <Box
          component="code"
          sx={{
            px: 2,
            py: 1.25,
            borderRadius: 1,
            bgcolor: 'action.hover',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '0.95rem',
          }}
          data-testid="wrong-host-example"
        >
          {example}
        </Box>
        <Typography variant="caption" color="text.secondary">
          {t('wrongHost.hint')}
        </Typography>
        <Box>
          <Button href="/" variant="outlined" size="small" data-testid="wrong-host-home">
            {t('wrongHost.toLanding')}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}
