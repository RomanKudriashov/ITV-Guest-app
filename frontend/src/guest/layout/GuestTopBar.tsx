import { alpha } from '@mui/material/styles';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { ThemeModeToggle } from '@/components/ThemeModeToggle';
import { GuestLanguageMenu } from '../components/GuestLanguageMenu';
import { RoomMenu } from '../components/RoomMenu';
import { layout, surfaceRadius } from '../storefrontTokens';
import { useStorefront } from '../useStorefront';
import { STICKY, useStickyLayer } from './stickyStack';

export interface TopBarTab {
  value: string;
  labelKey: string;
}

/**
 * Верхняя стеклянная строка — навигация планшета и десктопа.
 *
 * Заменила левый рельс. Рельс съедал 240px ширины на экране, где главная
 * ценность — фотографии заведений во всю ширину: витрина отеля не каталог
 * товаров, и постоянное меню сбоку здесь работало против содержимого.
 *
 * Строка липкая и полупрозрачная: под ней продолжается кадр, а не пустая
 * полоса, и гость видит, что страница длиннее экрана.
 */
export function GuestTopBar({
  hotelName,
  logo,
  tabs,
  active,
  room,
  cartCount,
  unreadChat,
  onNavigate,
  onOpenCart,
}: {
  hotelName: string;
  logo: string | null;
  tabs: TopBarTab[];
  active: string | false;
  room: string | null;
  cartCount: number;
  unreadChat: number;
  onNavigate: (to: string) => void;
  onOpenCart: () => void;
}) {
  const { t } = useTranslation();
  const { glass, goldCta } = useStorefront();
  // Тот же нулевой слой стека, что и плавающая группа телефона: на одной
  // ширине существует ровно один из них.
  const layer = useStickyLayer<HTMLDivElement>(STICKY.shell);

  return (
    <Box
      component="header"
      data-testid="guest-topbar"
      ref={layer.ref}
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 2.75,
        px: 3.5,
        height: layout.topBar,
        ...glass.bar,
      }}
    >
      <ButtonBase
        onClick={() => onNavigate('/home')}
        sx={(theme) => ({
          display: 'flex',
          alignItems: 'center',
          gap: 1.1,
          borderRadius: surfaceRadius.chip(theme.palette.brand.radius),
        })}
        data-testid="guest-topbar-brand"
      >
        {logo ? (
          <Box component="img" src={logo} alt="" sx={{ height: 22, width: 'auto' }} />
        ) : null}
        <Typography
          sx={(th) => ({
            fontFamily: th.typography.h1.fontFamily,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '.28em',
            textTransform: 'uppercase',
            // Строка стеклянная и лежит над страницей, а не над кадром: имя
            // отеля обязано читаться в обеих темах, поэтому цвет текстовый, а
            // не белый. Белым он был всегда — и на светлой пропадал.
            color: th.palette.text.primary,
          })}
        >
          {hotelName}
        </Typography>
      </ButtonBase>

      <Box component="nav" sx={{ display: 'flex', gap: 0.5, ml: 0.75 }}>
        {tabs.map((tab) => (
          <ButtonBase
            key={tab.value}
            onClick={() => onNavigate(tab.value)}
            data-testid={`guest-nav-${tab.value.replace('/', '')}`}
            sx={(th) => ({
              fontSize: 13,
              fontWeight: 600,
              px: 1.6,
              py: 1,
              borderRadius: (theme) => surfaceRadius.chip(theme.palette.brand.radius),
              color: active === tab.value ? th.palette.primary.main : th.palette.text.secondary,
              // Активная вкладка держится подложкой из акцента, а не готовым
              // светлым прямоугольником: прежняя `rgba(119,173,224,.16)` поверх
              // тёмного читалась как отдельная светлая плашка (Г22), а на
              // светлой теме не читалась вовсе.
              bgcolor:
                active === tab.value ? alpha(th.palette.primary.main, 0.14) : 'transparent',
              '&:hover': { bgcolor: alpha(th.palette.text.primary, 0.06) },
            })}
          >
            <Badge
              color="primary"
              variant="dot"
              invisible={tab.value !== '/chat' || unreadChat === 0}
            >
              {t(tab.labelKey)}
            </Badge>
          </ButtonBase>
        ))}
      </Box>

      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
        {/* Без номера — кнопка «войти по номеру», см. RoomMenu. */}
        <RoomMenu room={room} />

        <GuestLanguageMenu />
        <ThemeModeToggle />

        {/*
          Кнопка заказа золотая, а не акцентная: золото на витрине означает
          «ведёт к заказу», акцент — «переводит». Гость различает их, не читая.
        */}
        {cartCount > 0 ? (
          <ButtonBase
            onClick={onOpenCart}
            data-testid="guest-topbar-cart"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.9,
              height: 34,
              px: 1.75,
              borderRadius: (theme) => surfaceRadius.pill(theme.palette.brand.radius),
              fontSize: 12,
              ...goldCta,
            }}
          >
            {t('guest.nav.cart')}
            {/* Счётчик — затемнение поверх золота, поэтому берётся от цвета
                надписи на кнопке, а не отдельным чёрным литералом. */}
            <Box
              sx={{
                bgcolor: alpha(goldCta.color, 0.18),
                borderRadius: (theme) => surfaceRadius.pill(theme.palette.brand.radius),
                px: 0.75,
                fontSize: 11,
              }}
            >
              {cartCount}
            </Box>
          </ButtonBase>
        ) : null}
      </Box>
    </Box>
  );
}
