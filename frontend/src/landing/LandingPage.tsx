import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { FlowDiagram, type FlowStep } from './FlowDiagram';
import { ProductShot } from './ProductShot';

/**
 * ЛЕНДИНГ ПЛАТФОРМЫ — корень адреса.
 *
 * Правила, из которых он собран:
 *
 * НОЛЬ ЗАПРОСОВ К API. Страница не знает ни одного отеля и не может их
 * показать: она статична по устройству, а не по договорённости. Отсюда нет
 * ни «списка клиентов», ни живых счётчиков, ни формы заявки — форма означала
 * бы ручку на бэкенде и приём персональных данных.
 *
 * ВХОД НЕ НУЖЕН. Ни одного обращения к авторизации: человек, впервые
 * открывший адрес, видит страницу целиком.
 *
 * СНИМКИ — НАСТОЯЩИЕ. Их снимает прогон по демо-отелям (`e2e/shots`), а не
 * рисует дизайнер: нарисованный экран через месяц начинает врать, снятый
 * пересникается одной командой.
 *
 * ЦЕН НЕТ. Решение клиента: «по запросу».
 */

/** Заказ: от гостя до исполнителя и обратно. */
const ORDER_FLOW: FlowStep[] = [
  { key: 'guest', side: 'guest' },
  { key: 'platform', side: 'platform' },
  { key: 'board', side: 'hotel' },
  { key: 'work', side: 'hotel' },
  { key: 'back', side: 'guest' },
];

/** Управление номером: от кнопки на телефоне до железа в стене. */
const ROOM_FLOW: FlowStep[] = [
  { key: 'phone', side: 'guest' },
  { key: 'platform', side: 'platform' },
  { key: 'node', side: 'hotel' },
  { key: 'device', side: 'device' },
  { key: 'confirm', side: 'guest' },
];

/** Модули — ровно те, что знает платформа (`HotelModule.Code`). */
const MODULES = [
  'roomControl',
  'payment',
  'pms',
  'mobileKey',
  'multiRestaurant',
  'marketing',
  'extraLanguages',
  'nativeApp',
  'analytics',
] as const;

const SHOTS = ['guest', 'room', 'tracker', 'cms'] as const;
const AUDIENCES = ['cityHotel', 'resort', 'apartments'] as const;

export function LandingPage() {
  const { t } = useTranslation();
  // Контакты держим в одном месте: они повторяются в шапке и в последнем блоке.
  const [contactOpen, setContactOpen] = useState(false);

  return (
    <Box sx={{ bgcolor: 'background.default', minHeight: '100dvh' }} data-testid="landing">
      <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 } }}>
        {/* --- Первый экран ------------------------------------------------ */}
        <Stack spacing={2} sx={{ maxWidth: 760 }}>
          <Chip
            label={t('landing.hero.badge')}
            size="small"
            variant="outlined"
            sx={{ alignSelf: 'flex-start' }}
          />
          <Typography variant="h3" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
            {t('landing.hero.title')}
          </Typography>
          <Typography variant="h6" color="text.secondary" sx={{ fontWeight: 400 }}>
            {t('landing.hero.subtitle')}
          </Typography>
          <Stack direction="row" spacing={1.5} sx={{ pt: 1 }} flexWrap="wrap" useFlexGap>
            <Button
              variant="contained"
              size="large"
              onClick={() => setContactOpen(true)}
              href="#contact"
              data-testid="landing-cta"
            >
              {t('landing.hero.cta')}
            </Button>
            <Button variant="outlined" size="large" href="#how" data-testid="landing-how">
              {t('landing.hero.secondary')}
            </Button>
          </Stack>
        </Stack>

        {/* --- Экраны продукта --------------------------------------------- */}
        <Box sx={{ mt: { xs: 6, md: 9 } }}>
          <Typography variant="h5" sx={{ fontWeight: 600, mb: 2 }}>
            {t('landing.shots.title')}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
            }}
          >
            {SHOTS.map((shot) => (
              <ProductShot
                key={shot}
                name={shot}
                title={t(`landing.shots.${shot}.title`)}
                caption={t(`landing.shots.${shot}.caption`)}
              />
            ))}
          </Box>
        </Box>

        {/* --- Как это устроено: две схемы ---------------------------------- */}
        <Box sx={{ mt: { xs: 6, md: 9 } }} id="how">
          <Typography variant="h5" sx={{ fontWeight: 600 }}>
            {t('landing.flows.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 720 }}>
            {t('landing.flows.subtitle')}
          </Typography>

          <Stack spacing={4}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
                  {t('landing.flows.order.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
                  {t('landing.flows.order.lead')}
                </Typography>
                <FlowDiagram flow="order" steps={ORDER_FLOW} testId="flow-order" />
              </CardContent>
            </Card>

            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
                  {t('landing.flows.room.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
                  {t('landing.flows.room.lead')}
                </Typography>
                <FlowDiagram flow="room" steps={ROOM_FLOW} testId="flow-room" />
              </CardContent>
            </Card>
          </Stack>
        </Box>

        {/* --- Возможности --------------------------------------------------- */}
        <Box sx={{ mt: { xs: 6, md: 9 } }}>
          <Typography variant="h5" sx={{ fontWeight: 600, mb: 0.5 }}>
            {t('landing.modules.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5, maxWidth: 720 }}>
            {t('landing.modules.subtitle')}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gap: 1.5,
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
            }}
            data-testid="landing-modules"
          >
            {MODULES.map((code) => (
              <Card key={code} variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    {t(`landing.modules.items.${code}.title`)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t(`landing.modules.items.${code}.body`)}
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </Box>
        </Box>

        {/* --- Для кого ------------------------------------------------------ */}
        <Box sx={{ mt: { xs: 6, md: 9 } }}>
          <Typography variant="h5" sx={{ fontWeight: 600, mb: 2 }}>
            {t('landing.audience.title')}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
            }}
          >
            {AUDIENCES.map((who) => (
              <Card key={who} variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {t(`landing.audience.items.${who}.title`)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t(`landing.audience.items.${who}.body`)}
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </Box>
        </Box>

        {/* --- Как подключиться ---------------------------------------------- */}
        <Box sx={{ mt: { xs: 6, md: 9 } }} id="contact">
          <Card variant="outlined" sx={{ borderColor: 'primary.main' }}>
            <CardContent sx={{ py: 4 }}>
              <Stack spacing={1.5} sx={{ maxWidth: 720 }}>
                <Typography variant="h5" sx={{ fontWeight: 600 }}>
                  {t('landing.contact.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('landing.contact.body')}
                </Typography>
                {/*
                  ФОРМЫ ЗДЕСЬ НЕТ НАМЕРЕННО. Форма — это ручка на бэкенде, приём
                  персональных данных и защита от ботов; лендинг обязан
                  открываться без единого запроса. Почта и телефон работают без
                  всего этого и в любом почтовом клиенте.
                */}
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ pt: 1 }}>
                  <Button
                    variant="contained"
                    href={`mailto:${t('landing.contact.email')}`}
                    data-testid="landing-email"
                  >
                    {t('landing.contact.email')}
                  </Button>
                  <Button
                    variant="outlined"
                    href={`tel:${t('landing.contact.phoneHref')}`}
                    data-testid="landing-phone"
                  >
                    {t('landing.contact.phone')}
                  </Button>
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ pt: 1 }}>
                  {t('landing.contact.pricing')}
                </Typography>
                {contactOpen ? (
                  <Typography variant="caption" color="text.secondary" data-testid="landing-contact-hint">
                    {t('landing.contact.hint')}
                  </Typography>
                ) : null}
              </Stack>
            </CardContent>
          </Card>
        </Box>

        <Divider sx={{ mt: 6, mb: 2 }} />
        <Stack direction="row" justifyContent="space-between" flexWrap="wrap" useFlexGap>
          <Typography variant="caption" color="text.secondary">
            {t('landing.footer.copy')}
          </Typography>
          {/* Вход в консоль — маленькой ссылкой в подвале: это наш служебный
              адрес, а не призыв к посетителю. */}
          <Typography variant="caption">
            <Box component="a" href="/admin" sx={{ color: 'text.secondary' }} data-testid="landing-console-link">
              {t('landing.footer.console')}
            </Box>
          </Typography>
        </Stack>
      </Container>
    </Box>
  );
}
