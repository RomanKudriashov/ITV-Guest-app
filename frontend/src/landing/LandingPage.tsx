import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { FlowDiagram, type FlowStep } from './FlowDiagram';
import { ProductShot } from './ProductShot';
import { PhotoHero, Reveal, Screen, SplitBlock, useCalm } from './sections';
import { Particles } from './Particles';
import { GuestLanguageMenu } from '@/guest/components/GuestLanguageMenu';
import { ThemeModeToggle } from '@/components/ThemeModeToggle';
import { alpha } from '@mui/material/styles';

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

/*
  Возможности сверх реестра модулей: они не переключатели тарифа, а свойства
  продукта, и держать их в списке модулей значило бы обещать, что их можно
  «включить».
*/
const EXTRAS = ['devices', 'languages'] as const;

const AUDIENCES = ['cityHotel', 'resort', 'apartments'] as const;

/**
 * Цифры первого разговора — ТОЛЬКО ТЕ, ЧТО У НАС ЕСТЬ.
 *
 * Ни выручки, ни числа клиентов, ни роста: их неоткуда взять, а выдуманная
 * цифра на витрине — это первое, что проверяют и последнее, что прощают.
 *
 * Значения не вписаны словами: языки и модули считаются из тех же перечислений,
 * которыми живёт система, поэтому разойтись с ней не могут.
 */
/**
 * Три утверждения вместо трёх чисел.
 *
 * Числа сюда не годятся: счётчик модулей привязывает витрину к нашему реестру
 * и стареет от первой же правки, а «4 языка» и «0 установок» обещали потолок,
 * которого план не предполагает. Утверждение живёт дольше числа.
 */
const CLAIMS = ['forms', 'chain', 'pay'] as const;


const PHOTO = {
  hero: '/landing/photo-hero.jpg',
  guest: '/landing/photo-guest-room.jpg',
  staff: '/landing/photo-staff-hall.jpg',
  room: '/landing/photo-room-evening.jpg',
} as const;

export function LandingPage() {
  const { t } = useTranslation();
  const calm = useCalm();

  return (
    <Box sx={{ bgcolor: 'background.default', position: 'relative' }} data-testid="landing">
      {/* --- 1. Первый экран: фотография во всю ширину -------------------- */}
      {/*
        Язык и тема — те же переключатели, что у гостя и в панели. Лендинг
        переведён на четыре языка и умеет обе темы, но доступа к этому не было
        вовсе: возможность есть, а дотянуться нечем.

        Поверх первого экрана, а не в шапке: шапки у страницы нет, и заводить
        её ради двух кнопок значит менять устройство страницы.
      */}
      <Box
        data-testid="landing-controls"
        sx={{
          position: 'absolute',
          top: { xs: 12, md: 20 },
          insetInlineEnd: { xs: 12, md: 24 },
          zIndex: 2,
          display: 'flex',
          gap: 0.5,
          /*
            Белым — И САМИМ КНОПКАМ ТОЖЕ. Цвет на контейнере наследуется не
            всегда: кнопка берёт свой из палитры, и в СВЕТЛОЙ теме иконка
            выходила тёмной — на тёмной фотографии её не было видно вовсе.
            Поймано на снимке: в тёмной теме два значка, в светлой один.
          */
          color: 'common.white',
          '& .MuiIconButton-root': { color: 'common.white' },
          '& .MuiSvgIcon-root': { color: 'inherit' },
        }}
      >
        <GuestLanguageMenu />
        <ThemeModeToggle />
      </Box>

      <PhotoHero src={PHOTO.hero} calm={calm} testId="landing-hero" overlay={<Particles calm={calm} />}>
        <Stack spacing={2.5} sx={{ maxWidth: 820 }}>
          <Typography
            variant="h2"
            component="h1"
            sx={{ fontWeight: 700, lineHeight: 1.05, color: 'inherit' }}
          >
            {t('landing.hero.title')}
          </Typography>
          <Typography sx={{ fontSize: { xs: 18, md: 22 }, opacity: 0.92, maxWidth: 680 }}>
            {t('landing.hero.subtitle')}
          </Typography>
          <Box>
            <Button variant="contained" size="large" href="#contact" data-testid="landing-cta">
              {t('landing.hero.cta')}
            </Button>
          </Box>
        </Stack>
      </PhotoHero>

      {/* --- 2. Цифры ---------------------------------------------------- */}
      <Screen tone="muted" testId="landing-claims" full={false}>
        <Box
          sx={{
            display: 'grid',
            gap: { xs: 4, md: 6 },
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
          }}
        >
          {CLAIMS.map((claim) => (
            <Reveal key={claim} calm={calm}>
              <Typography
                variant="h4"
                component="p"
                sx={{ fontWeight: 700, lineHeight: 1.15 }}
                data-testid={`landing-claim-${claim}`}
              >
                {t(`landing.claims.${claim}.title`)}
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 1.5, fontSize: 17 }}>
                {t(`landing.claims.${claim}.body`)}
              </Typography>
            </Reveal>
          ))}
        </Box>
      </Screen>

      {/* --- 3. Гость ----------------------------------------------------- */}
      <Screen testId="landing-guest">
        <SplitBlock
          photo={PHOTO.guest}
          eyebrow={t('landing.blocks.guest.eyebrow')}
          title={t('landing.blocks.guest.title')}
          body={t('landing.blocks.guest.body')}
          calm={calm}
        >
          <ProductShot
            name="guest"
            device="phone"
            title={t('landing.shots.guest.title')}
            caption={t('landing.shots.guest.caption')}
          />
        </SplitBlock>
      </Screen>

      {/* --- 4. Персонал -------------------------------------------------- */}
      <Screen tone="accent" testId="landing-staff">
        <SplitBlock
          photo={PHOTO.staff}
          eyebrow={t('landing.blocks.staff.eyebrow')}
          title={t('landing.blocks.staff.title')}
          body={t('landing.blocks.staff.body')}
          flip
          calm={calm}
        >
          <ProductShot
            name="tracker"
            title={t('landing.shots.tracker.title')}
            caption={t('landing.shots.tracker.caption')}
          />
        </SplitBlock>
      </Screen>

      {/* --- 5. Управление номером ---------------------------------------- */}
      <Screen testId="landing-room">
        <SplitBlock
          photo={PHOTO.room}
          eyebrow={t('landing.blocks.room.eyebrow')}
          title={t('landing.blocks.room.title')}
          body={t('landing.blocks.room.body')}
          calm={calm}
        >
          <ProductShot
            name="room"
            device="phone"
            title={t('landing.shots.room.title')}
            caption={t('landing.shots.room.caption')}
          />
        </SplitBlock>
      </Screen>

      {/* --- Один продукт на трёх устройствах ----------------------------- */}
      <Screen tone="muted" testId="landing-devices">
        <Reveal calm={calm}>
          <Typography variant="h3" component="h2" sx={{ fontWeight: 700 }}>
            {t('landing.devices.title')}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1, mb: 4, maxWidth: 760, fontSize: 18 }}>
            {t('landing.devices.body')}
          </Typography>
        </Reveal>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1.3fr 1.6fr' },
            gap: { xs: 3, md: 4 },
            alignItems: 'end',
          }}
        >
          {(['phone', 'tablet', 'desktop'] as const).map((kind) => (
            <Reveal key={kind} calm={calm}>
              <Box
                component="img"
                src={`/landing/device-${kind}.jpg`}
                alt=""
                loading="lazy"
                data-testid={`landing-device-${kind}`}
                sx={{
                  width: '100%',
                  display: 'block',
                  borderRadius: kind === 'phone' ? '26px' : '12px',
                  border: '2px solid',
                  borderColor: 'text.primary',
                  boxShadow: (theme) => `0 16px 40px -24px ${alpha(theme.palette.common.black, 0.5)}`,
                }}
              />
              <Typography variant="subtitle2" sx={{ mt: 1.5 }}>
                {t(`landing.devices.${kind}`)}
              </Typography>
            </Reveal>
          ))}
        </Box>
      </Screen>

      {/* --- 6. Схемы движения данных — сохранены целиком ------------------ */}
      <Screen tone="muted" id="how" testId="landing-flows">
        <Reveal calm={calm}>
          <Typography variant="h3" component="h2" sx={{ fontWeight: 700 }}>
            {t('landing.flows.title')}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1, mb: 4, maxWidth: 760, fontSize: 18 }}>
            {t('landing.flows.subtitle')}
          </Typography>
        </Reveal>
        <Stack spacing={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                {t('landing.flows.order.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('landing.flows.order.lead')}
              </Typography>
              <FlowDiagram flow="order" steps={ORDER_FLOW} testId="flow-order" />
            </CardContent>
          </Card>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                {t('landing.flows.room.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('landing.flows.room.lead')}
              </Typography>
              <FlowDiagram flow="room" steps={ROOM_FLOW} testId="flow-room" />
            </CardContent>
          </Card>
        </Stack>
      </Screen>

      {/* --- 7. Модули, для кого, контакты -------------------------------- */}
      <Screen testId="landing-modules-screen" full={false}>
        <Reveal calm={calm}>
          <Typography variant="h3" component="h2" sx={{ fontWeight: 700, mb: 1 }}>
            {t('landing.modules.title')}
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 4, maxWidth: 760, fontSize: 18 }}>
            {t('landing.modules.subtitle')}
          </Typography>
        </Reveal>
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
          }}
          data-testid="landing-modules"
        >
          {EXTRAS.map((code) => (
            <Reveal key={code} calm={calm}>
              <Card variant="outlined" sx={{ height: '100%', borderColor: 'primary.main' }}>
                <CardContent>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {t(`landing.extras.${code}.title`)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t(`landing.extras.${code}.body`)}
                  </Typography>
                </CardContent>
              </Card>
            </Reveal>
          ))}
          {MODULES.map((code) => (
            <Reveal key={code} calm={calm}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {t(`landing.modules.items.${code}.title`)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t(`landing.modules.items.${code}.body`)}
                  </Typography>
                </CardContent>
              </Card>
            </Reveal>
          ))}
        </Box>

        <Box sx={{ mt: { xs: 7, md: 10 } }}>
          <Typography variant="h3" component="h2" sx={{ fontWeight: 700, mb: 3 }}>
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
              <Reveal key={who} calm={calm}>
                <Card variant="outlined" sx={{ height: '100%' }}>
                  <CardContent>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      {t(`landing.audience.items.${who}.title`)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t(`landing.audience.items.${who}.body`)}
                    </Typography>
                  </CardContent>
                </Card>
              </Reveal>
            ))}
          </Box>
        </Box>
      </Screen>

      <Screen tone="accent" id="contact" testId="landing-contact" full={false}>
        <Stack spacing={2} sx={{ maxWidth: 760 }}>
          <Typography variant="h3" component="h2" sx={{ fontWeight: 700 }}>
            {t('landing.contact.title')}
          </Typography>
          <Typography color="text.secondary" sx={{ fontSize: 18 }}>
            {t('landing.contact.body')}
          </Typography>
          {/*
            ФОРМЫ ЗДЕСЬ НЕТ НАМЕРЕННО. Форма — это ручка на бэкенде, приём
            персональных данных и защита от ботов; лендинг обязан открываться
            без единого запроса. Почта и телефон работают без всего этого.
          */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ pt: 1 }}>
            <Button
              variant="contained"
              size="large"
              href={`mailto:${t('landing.contact.email')}`}
              data-testid="landing-email"
            >
              {t('landing.contact.email')}
            </Button>
            <Button
              variant="outlined"
              size="large"
              href={`tel:${t('landing.contact.phoneHref')}`}
              data-testid="landing-phone"
            >
              {t('landing.contact.phone')}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ pt: 1 }}>
            {t('landing.contact.pricing')}
          </Typography>
        </Stack>

        <Divider sx={{ mt: 6, mb: 2 }} />
        <Stack direction="row" justifyContent="space-between" flexWrap="wrap" useFlexGap>
          <Stack direction="row" spacing={1.25} alignItems="center">
            {/*
              Знак компании — вектором и в обеих темах. Надпись из растрового
              логотипа сюда не идёт намеренно: она светло-серая и на светлой
              теме пропадает, а варианта под светлый фон у компании нет.
            */}
            <Box
              component="img"
              src="/landing/pwv-mark.svg"
              alt=""
              width={20}
              height={20}
              data-testid="landing-company-mark"
            />
            <Typography variant="caption" color="text.secondary">
              {t('landing.footer.copy')}
            </Typography>
          </Stack>
          <Typography variant="caption">
            {/* Вход в консоль — маленькой ссылкой в подвале: наш служебный
                адрес, а не призыв к посетителю. */}
            <Box component="a" href="/admin" sx={{ color: 'text.secondary' }} data-testid="landing-console-link">
              {t('landing.footer.console')}
            </Box>
          </Typography>
        </Stack>
      </Screen>
    </Box>
  );
}
