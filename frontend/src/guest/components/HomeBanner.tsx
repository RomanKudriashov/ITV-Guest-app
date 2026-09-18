import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';

import { closeBanner, reportBannerClick } from '../api/guest';
import type { GuestBanner } from '../api/types';
import { useStorefront } from '../useStorefront';

/**
 * Рекламная полоса витрины.
 *
 * ЧТО ЗДЕСЬ ВАЖНО И ЛЕГКО ПОТЕРЯТЬ:
 *
 * * баннер приезжает СВОИМ запросом — витрина его не ждёт. Нет данных —
 *   компонент не рисует ничего и не занимает места: ни заглушки, ни
 *   зарезервированной полосы, которая прыгнет, когда реклама догрузится;
 * * ЗАКРЫТИЕ — состояние СЕРВЕРА, а не памяти вкладки. Иначе перезагрузка
 *   страницы возвращала бы закрытый баннер, и гость закрывал бы его снова и
 *   снова. Локально мы прячем сразу, не дожидаясь ответа: это отзывчивость,
 *   а не источник правды;
 * * показ считает СЕРВЕР, один раз на сессию. Витрина не шлёт «я показал» —
 *   иначе каждый переход по меню добавлял бы показ, и CTR стал бы ложью.
 */
const HEIGHTS: Record<GuestBanner['size'], { xs: number; md: number }> = {
  s: { xs: 96, md: 120 },
  m: { xs: 150, md: 200 },
  l: { xs: 220, md: 300 },
};

const CAROUSEL_MS = 5000;

interface Props {
  banner: GuestBanner | null | undefined;
  placement: GuestBanner['placement'];
}

export function HomeBanner({ banner, placement }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Цвета — ТОЛЬКО из словаря витрины: вуаль и подписи те же, что у плиток
  // главной. Литерал здесь сделал бы полосу тёмной и в светлой теме.
  const { tile: tileTokens } = useStorefront();
  const [closed, setClosed] = useState(false);
  const [frame, setFrame] = useState(0);
  const [page, setPage] = useState<{ title: string; body: string } | null>(null);
  const shownId = useRef<string | null>(null);

  // Сменился баннер — прежнее «закрыт» к нему не относится.
  useEffect(() => {
    if (banner && shownId.current !== banner.id) {
      shownId.current = banner.id;
      setClosed(false);
      setFrame(0);
    }
  }, [banner]);

  const images = banner?.images ?? [];
  useEffect(() => {
    if (images.length < 2) return undefined;
    const timer = window.setInterval(
      () => setFrame((current) => (current + 1) % images.length),
      CAROUSEL_MS,
    );
    return () => window.clearInterval(timer);
  }, [images.length]);

  if (!banner || banner.placement !== placement || closed) return null;

  const height = HEIGHTS[banner.size] ?? HEIGHTS.m;

  const act = () => {
    // Нажатие отмечаем и идём дальше, не дожидаясь ответа: статистика не
    // должна стоять между гостем и тем, ради чего он нажал.
    void reportBannerClick(banner.id).catch(() => undefined);
    const action = banner.action;
    if (action.kind === 'link') {
      window.open(action.url, '_blank', 'noopener,noreferrer');
    } else if (action.kind === 'venue') {
      navigate(`/venue/${action.venue_code}`);
    } else if (action.kind === 'page') {
      setPage(action.page);
    }
  };

  const dismiss = (event: React.MouseEvent) => {
    event.stopPropagation();
    setClosed(true);
    void closeBanner(banner.id).catch(() => undefined);
  };

  return (
    <>
      <Box
        data-testid="guest-banner"
        data-banner-id={banner.id}
        data-banner-size={banner.size}
        onClick={banner.action.kind === 'none' ? undefined : act}
        sx={{
          position: 'relative',
          borderRadius: 3,
          overflow: 'hidden',
          height,
          cursor: banner.action.kind === 'none' ? 'default' : 'pointer',
          bgcolor: 'action.hover',
        }}
      >
        {images[frame] && (
          <Box
            component="img"
            src={images[frame]}
            alt=""
            sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        )}
        {(banner.title || banner.subtitle) && (
          <Stack
            spacing={0.25}
            sx={{
              position: 'absolute',
              inset: 'auto 0 0 0',
              p: 2,
              // Вуаль под текстом: на светлом кадре белые буквы иначе
              // исчезают. Градиент — тот же, что под подписью плитки.
              background: tileTokens.scrim,
              color: 'common.white',
            }}
          >
            {banner.title && (
              <Typography
                variant="h6"
                data-testid="guest-banner-title"
                sx={{ textShadow: tileTokens.titleShadow }}
              >
                {banner.title}
              </Typography>
            )}
            {banner.subtitle && (
              <Typography variant="body2" sx={{ textShadow: tileTokens.metaShadow }}>
                {banner.subtitle}
              </Typography>
            )}
          </Stack>
        )}
        <IconButton
          size="small"
          aria-label={t('guest.banner.close')}
          onClick={dismiss}
          data-testid="guest-banner-close"
          sx={{
            position: 'absolute',
            top: 8,
            insetInlineEnd: 8,
            bgcolor: tileTokens.fallbackColor,
            color: 'common.white',
            opacity: 0.72,
            '&:hover': { opacity: 1, bgcolor: tileTokens.fallbackColor },
          }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
        {images.length > 1 && (
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ position: 'absolute', bottom: 8, insetInlineStart: 8 }}
          >
            {images.map((src, index) => (
              <Box
                key={src}
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  bgcolor: 'common.white',
                  opacity: index === frame ? 1 : 0.45,
                }}
              />
            ))}
          </Stack>
        )}
      </Box>

      {page && <BannerPage page={page} onClose={() => setPage(null)} />}
    </>
  );
}

/** Страница с описанием — лист поверх витрины, без ухода с главной. */
function BannerPage({
  page,
  onClose,
}: {
  page: { title: string; body: string };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Box
      data-testid="guest-banner-page"
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        bgcolor: 'background.paper',
        overflowY: 'auto',
        p: 3,
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
        <Typography variant="h5">{page.title}</Typography>
        <IconButton onClick={onClose} aria-label={t('guest.banner.close')} data-testid="guest-banner-page-close">
          <CloseIcon />
        </IconButton>
      </Stack>
      <Typography variant="body1" sx={{ mt: 2, whiteSpace: 'pre-line' }}>
        {page.body}
      </Typography>
    </Box>
  );
}
