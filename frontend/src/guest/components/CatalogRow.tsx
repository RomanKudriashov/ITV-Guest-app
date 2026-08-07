import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { AppIconComponent } from '@/icons';
import { KitImage } from '@/kit';
import type { ItemDetail, ItemFacet, MenuBadge } from '../api/types';
import { MarkerChips, NutritionInline } from './ItemMeta';
import { ItemBadges, PrepMinutesChip } from './ItemBadges';
import { cardSubtitleColor, storefrontTokens, surfaceRadius } from '../storefrontTokens';

export interface CatalogRowViewProps {
  testId: string;
  title: string;
  description?: string;
  imageSrc?: string | null;
  /** Icon on the designed fallback when the row has no photo. */
  fallbackIcon?: AppIconComponent;
  /** Dietary markers («suitable») — green chips on the card. */
  markers?: ItemFacet[];
  /** Marketing badges — shown as small filled chips over the media. */
  badges?: MenuBadge[];
  /** Prep-time chip ("~{n} мин") — shown only when the item carries it. */
  prepMinutes?: number | null;
  /** КБЖУ line — shown only when the item carries nutrition data. */
  nutrition?: ItemDetail['nutrition'];
  /** Already-formatted price, or `null` to hide it (an unpriced service). */
  priceLabel: string | null;
  unavailableNote?: string | null;
  available: boolean;
  onOpen?: () => void;
  /** Trailing action (add button, stepper …) — supplied by the cart-aware caller. */
  action?: ReactNode;
}

/**
 * The presentational body of one catalog card (the `.card` block): a
 * photo on top that dissolves nowhere — a fixed 146px image — then the body with
 * title, a two-line description, the КБЖУ line, flag chips and a row that carries
 * the price and the on-card action button. Unavailable cards dim to `.card.off`.
 *
 * It owns no cart or session state, so the storefront (`CatalogPage`) and the CMS
 * brand preview render identical cards from it — the markup lives here once.
 */
export function CatalogRowView({
  testId,
  title,
  description,
  imageSrc,
  fallbackIcon,
  markers,
  badges,
  prepMinutes,
  nutrition,
  priceLabel,
  unavailableNote,
  available,
  onOpen,
  action,
}: CatalogRowViewProps) {
  return (
    <Box
      data-testid={testId}
      sx={(theme) => ({
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: surfaceRadius.panel(theme.palette.brand.radius),
        overflow: 'hidden',
        opacity: available ? 1 : 0.5,
        transition: 'transform .22s cubic-bezier(.2,.7,.2,1), box-shadow .22s',
        '&:hover': available
          ? { transform: 'translateY(-4px)', boxShadow: theme.palette.brand.elevation.lg }
          : undefined,
        '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
      })}
    >
      {/* Photo — the whole media + headline opens the sheet. */}
      <ButtonBase
        onClick={onOpen}
        disabled={!available}
        aria-label={title}
        sx={{ display: 'block', textAlign: 'start', width: '100%' }}
      >
        <Box sx={{ position: 'relative', height: 146 }}>
          <KitImage src={imageSrc} alt={title} fill fallbackIcon={fallbackIcon} fallbackIconSize={44} />
          {badges?.length ? (
            <Box sx={{ position: 'absolute', top: 8, insetInlineStart: 8, maxWidth: 'calc(100% - 16px)' }}>
              <ItemBadges badges={badges} size="sm" />
            </Box>
          ) : null}
        </Box>
        <Box sx={{ px: '14px', pt: '13px' }}>
          <Typography
            variant="subtitle2"
            sx={(theme) => ({
              fontFamily: theme.typography.h1.fontFamily,
              fontWeight: 800,
              fontSize: '0.9375rem',
              letterSpacing: '-0.01em',
              lineHeight: 1.25,
            })}
          >
            {title}
          </Typography>
          {description ? (
            /*
              ПОДЛОЖКА ОПИСАНИЯ — СТЕКЛО ИЗ СЛОВАРЯ, а не свой набор значений.

              Тот же `glass.panel`, которым сделаны верхняя панель и полоса
              активного заказа: полупрозрачная поверхность с размытием, тёмная
              в тёмной теме и светлая в светлой. Заводить здесь второй рецепт
              значило бы получить два стекла, которые разойдутся на первой же
              правке одного из них.

              Набор берётся по режиму ТЕМЫ, а не из хука витрины: карточка
              рисуется ещё и в превью бренда CMS, где тема своя.

              Нет описания — нет и подложки: пустой стеклянный прямоугольник
              под названием читался бы как оборванная загрузка.
            */
            <Box
              sx={(theme) => ({
                ...storefrontTokens(theme.palette.mode).glass.panel,
                /*
                  ПОД СТЕКЛОМ — НЕПРОЗРАЧНАЯ ОСНОВА, И ЭТО НЕ УКРАШЕНИЕ.

                  Стекло само по себе показывает то, что под ним. В карточке
                  это поверхность страницы, а в шторке — РАЗМЫТОЕ ФОТО БЛЮДА, и
                  фон под подписью там оказывался заметно светлее: по замеру
                  пикселей 35/43/56 против 17/25/40 на карточке. Цвет подписи
                  считается под фон карточки, и на светлом он проваливал
                  контраст — 3.93:1 при пороге 4.5, отчего синий читался серым.

                  Основа делает фон под текстом ПРЕДСКАЗУЕМЫМ: тем самым, под
                  который цвет и посчитан. Стекло остаётся стеклом — тем же
                  рецептом из словаря, — но лежит на своей поверхности, а не на
                  случайной фотографии.
                */
                backgroundColor: theme.palette.background.paper,
                backgroundImage: `linear-gradient(${
                  storefrontTokens(theme.palette.mode).glass.panel.background
                }, ${storefrontTokens(theme.palette.mode).glass.panel.background})`,
                // Радиус — ВНУТРЕННИЙ: блок лежит внутри карточки, у которой
                // свой, панельный. Совпади они, угол подложки лёг бы ровно на
                // угол карточки и съел бы её кант.
                borderRadius: surfaceRadius.inner(theme.palette.brand.radius),
                mt: 0.75,
                /*
                  ПОЛЯ ПОДЛОЖКИ НЕ ОТНИМАЮТ ШИРИНУ У ТЕКСТА.

                  Описание обрезается по второй строке, и ширина строки решает,
                  что в эти две строки поместится. Подложка с полями по 8px
                  забрала у колонки 16 пикселей из 155 на телефоне — и
                  «Гуанчале, пекорино, яичный желток» стало «яичны…», а всего
                  оборвалось два описания из восемнадцати. Поэтому поле внутрь
                  ровно настолько, насколько блок выпущен наружу: текст стоит
                  там же, где стоял, а стекло дышит.
                */
                mx: '-6px',
                px: '6px',
                py: 0.75,
              })}
            >
              <Typography
                variant="body2"
                /*
                  Подпись — В ЦВЕТ, тем же приёмом, что липкая строка категорий:
                  акцент отеля, уведённый в стеклянный подтон и приглушённый
                  прозрачностью. Ни цвета, ни его рецепта здесь нет — компонент
                  называет цвет, считает его словарь, и у отеля с другим брендом
                  подпись будет своего цвета.

                  Режим берётся из ТЕМЫ, а не из хука витрины: эта карточка
                  рисуется ещё и в превью бренда CMS, где тема своя — та, которую
                  оператор прямо сейчас правит, — и хук приложения показал бы там
                  чужой режим.
                */
                sx={(theme) => ({
                  color: cardSubtitleColor(
                    theme.palette.primary.main,
                    theme.palette.background.paper,
                    theme.palette.mode,
                  ),
                  fontSize: '0.75rem',
                  lineHeight: 1.4,
                  minHeight: 32,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                })}
              >
                {description}
              </Typography>
            </Box>
          ) : null}
        </Box>
      </ButtonBase>

      {/* Body — nutrition, markers, then the price / action row pinned to the bottom.
          Markers stay on the catalog card (chips); allergens live inside the item. */}
      <Box sx={{ px: '14px', pb: '14px', pt: description ? 1 : '13px', display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
        {nutrition ? (
          <Box sx={{ mb: 1 }}>
            <NutritionInline nutrition={nutrition} />
          </Box>
        ) : null}
        {markers?.length || prepMinutes != null ? (
          <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" alignItems="center" sx={{ mb: 1.25 }}>
            <PrepMinutesChip minutes={prepMinutes} />
            <MarkerChips markers={markers} />
          </Stack>
        ) : null}
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1.25}
          sx={{ mt: 'auto', minHeight: 40 }}
        >
          {/* "No price" is a normal state for a service — never print "0 ₽". */}
          <Stack spacing={0} sx={{ minWidth: 0 }}>
            {priceLabel ? (
              <Typography
                sx={(theme) => ({
                  fontFamily: theme.typography.h1.fontFamily,
                  fontWeight: 800,
                  fontSize: '1.1875rem',
                  letterSpacing: '-0.02em',
                })}
              >
                {priceLabel}
              </Typography>
            ) : null}
            {unavailableNote ? (
              <Typography variant="caption" color="text.secondary">
                {unavailableNote}
              </Typography>
            ) : null}
          </Stack>
          {action ? <Box sx={{ flexShrink: 0 }}>{action}</Box> : null}
        </Stack>
      </Box>
    </Box>
  );
}
