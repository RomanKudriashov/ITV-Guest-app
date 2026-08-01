import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { ThemeModeToggle } from '@/components/ThemeModeToggle';
import { GuestLanguageMenu } from '../components/GuestLanguageMenu';
import { RoomMenu } from '../components/RoomMenu';
import { glass, goldCta, layout } from '../storefrontTokens';

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

  return (
    <Box
      component="header"
      data-testid="guest-topbar"
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
        sx={{ display: 'flex', alignItems: 'center', gap: 1.1, borderRadius: 1 }}
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
            color: '#fff',
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
            sx={{
              fontSize: 13,
              fontWeight: 600,
              px: 1.6,
              py: 1,
              borderRadius: '9px',
              color: active === tab.value ? 'primary.light' : 'rgba(166,182,201,1)',
              bgcolor: active === tab.value ? 'rgba(119,173,224,.16)' : 'transparent',
              '&:hover': { bgcolor: 'rgba(255,255,255,.06)' },
            }}
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
        {room ? <RoomMenu room={room} /> : null}

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
              borderRadius: 999,
              fontSize: 12,
              ...goldCta,
            }}
          >
            {t('guest.nav.cart')}
            <Box sx={{ bgcolor: 'rgba(0,0,0,.22)', borderRadius: 999, px: 0.75, fontSize: 11 }}>
              {cartCount}
            </Box>
          </ButtonBase>
        ) : null}
      </Box>
    </Box>
  );
}
