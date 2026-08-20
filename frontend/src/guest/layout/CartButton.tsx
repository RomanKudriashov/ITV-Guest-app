import Badge from '@mui/material/Badge';
import IconButton from '@mui/material/IconButton';
import { useTranslation } from 'react-i18next';

import { IconBag } from '@/icons';

/**
 * ПОСТОЯННЫЙ ВХОД В КОРЗИНУ.
 *
 * Раньше единственным входом на телефоне была нижняя полоса «в корзине N
 * позиций». Она висела на каждом экране каталога всё время, пока в корзине
 * что-то есть, — 52 пикселя высоты плюс отступ под ней, — и при этом ничего не
 * сообщала: сумма не меняется, пока гость не тронет корзину.
 *
 * Кнопка занимает место одной иконки в уже существующей плавающей группе и
 * видна ВСЕГДА, а не только при непустой корзине: постоянный вход тем и
 * ценен, что его не нужно искать. Пустую корзину показываем без числа — «0» в
 * кружке это не сообщение, а шум.
 */
export function CartButton({ count, onOpen }: { count: number; onOpen: () => void }) {
  const { t } = useTranslation();

  return (
    <IconButton
      onClick={onOpen}
      data-testid="guest-cart-button"
      aria-label={count > 0 ? t('guest.cart.openWithCount', { count }) : t('guest.cart.open')}
      sx={{ color: 'inherit' }}
    >
      <Badge
        // При нуле MUI не убирает кружок из разметки, а гасит его классом
        // `MuiBadge-invisible` — глазами числа нет, в DOM элемент остаётся.
        // Тесты поэтому проверяют видимость, а не отсутствие узла.
        badgeContent={count}
        color="primary"
        data-testid="guest-cart-count"
        sx={{ '& .MuiBadge-badge': { fontSize: 10, height: 16, minWidth: 16 } }}
      >
        <IconBag />
      </Badge>
    </IconButton>
  );
}
