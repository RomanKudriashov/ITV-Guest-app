import { useState } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { PhoneFrame } from './PhoneFrame';

/**
 * Снимок экрана продукта.
 *
 * Файлы кладёт ПРОГОН (`e2e/shots/product-shots.spec.ts`) в `public/landing/`,
 * поэтому в сборку они не попадают и бандл не растят — их отдаёт статикой тот
 * же nginx.
 *
 * ЕСЛИ СНИМКА НЕТ — не битая картинка, а честная рамка с подписью. Съёмку
 * гоняют отдельно от сборки, и первый деплой лендинга легко обгонит её; страница
 * с крестами вместо экранов выглядит как поломка, а не как «снимки ещё не
 * сняли».
 */
export function ProductShot({
  name,
  title,
  caption,
  device = 'desktop',
}: {
  name: string;
  title: string;
  caption: string;
  /**
   * Чем это снято у гостя, тем и показываем.
   *
   * Витрину гость держит в руке — снимок в рамке телефона читается как
   * телефон, а не как окно браузера. Доска исполнителя и панель отеля живут
   * на большом экране: рамка телефона врала бы о том, как ими пользуются.
   */
  device?: 'phone' | 'desktop';
}) {
  const { t } = useTranslation();
  const [missing, setMissing] = useState(false);

  const shot = missing ? (
    <Typography variant="caption" color="text.secondary" data-testid={`landing-shot-${name}-missing`}>
      {t('landing.shots.missing')}
    </Typography>
  ) : (
    <Box
      component="img"
      src={`/landing/${name}.jpg`}
      alt={title}
      loading="lazy"
      onError={() => setMissing(true)}
      sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  );

  /*
    Телефон показываем В КОРПУСЕ, без карточки вокруг: аппарат сам себе рамка,
    и обводка поверх него читалась бы как рамка внутри рамки.
  */
  if (device === 'phone') {
    return (
      <Box data-testid={`landing-shot-${name}`}>
        <PhoneFrame testId={`landing-phone-${name}`}>{shot}</PhoneFrame>
        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {caption}
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Card variant="outlined" sx={{ overflow: 'hidden', height: '100%' }} data-testid={`landing-shot-${name}`}>
      <Box
        sx={{
          aspectRatio: '16 / 10',
          bgcolor: 'action.hover',
          display: 'grid',
          placeItems: 'center',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        {shot}
      </Box>
      <CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {caption}
        </Typography>
      </CardContent>
    </Card>
  );
}
