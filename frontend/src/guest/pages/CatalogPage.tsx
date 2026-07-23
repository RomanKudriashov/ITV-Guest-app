import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/EmptyState';
import { SkeletonCard, revealSx } from '@/kit';
import { behaviourFor, type OfferingType } from '@/offerings/behaviour';
import { CatalogRowView } from '../components/CatalogRow';
import { fallbackIconFor } from '../components/typeFallbackIcon';
import { ItemSheet } from '../components/ItemSheet';
import { QuantityStepper } from '../components/QuantityStepper';
import { StickyFooter } from '../components/StickyFooter';
import { errorMessage } from '../errors';
import { useGuestCatalog } from '../hooks/useGuestQueries';
import { useMoney } from '../hooks/useMoney';
import { BOTTOM_NAV_HEIGHT } from '../layout/GuestLayout';
import { useCart } from '../state/cart';
import type { MenuItem } from '../api/types';

const HEADER_OFFSET = 56;
const TABS_HEIGHT = 48;

export interface CatalogPageProps {
  /** Which catalog to show. Everything else on this screen is type-agnostic. */
  type: OfferingType;
}

/**
 * ONE storefront catalog screen. `/menu` renders the `product` catalog,
 * `/services` renders the `service_request` one — same request, same layout,
 * same sheet. The type decides only the testid prefix, the wording and whether a
 * row can be dropped into the cart, and all three come from the behaviour
 * registry rather than from conditions spread over the markup.
 */
export function CatalogPage({ type }: CatalogPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const { format, formatOptional } = useMoney();
  const cart = useCart();
  const behaviour = behaviourFor(type);
  const ns = behaviour.guestCatalogNamespace;
  const { data, isLoading, error, refetch } = useGuestCatalog(type);

  const [searchParams, setSearchParams] = useSearchParams();
  const openItemId = searchParams.get('item');

  const categories = useMemo(() => data?.categories ?? [], [data]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const suppressSpy = useRef(false);

  const allItems = useMemo(() => {
    const map = new Map<string, MenuItem>();
    for (const category of categories) {
      for (const item of category.items) map.set(item.id, item);
    }
    return map;
  }, [categories]);

  useEffect(() => {
    if (!activeCategory && categories.length) setActiveCategory(categories[0].code);
  }, [categories, activeCategory]);

  // Scroll-spy: the category whose section crosses just under the sticky tabs wins.
  useEffect(() => {
    if (!categories.length) return;
    const onScroll = () => {
      if (suppressSpy.current) return;
      const line = HEADER_OFFSET + TABS_HEIGHT + 8;
      let current = categories[0].code;
      for (const category of categories) {
        const node = sectionRefs.current[category.code];
        if (!node) continue;
        if (node.getBoundingClientRect().top <= line) current = category.code;
      }
      setActiveCategory((prev) => (prev === current ? prev : current));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [categories]);

  const scrollToCategory = useCallback((code: string) => {
    const node = sectionRefs.current[code];
    if (!node) return;
    suppressSpy.current = true;
    setActiveCategory(code);
    const top = node.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET - TABS_HEIGHT;
    window.scrollTo({ top, behavior: 'smooth' });
    window.setTimeout(() => {
      suppressSpy.current = false;
    }, 600);
  }, []);

  const openItem = (item: MenuItem) => {
    setSearchParams({ item: item.id }, { replace: false });
  };

  const closeSheet = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('item');
    setSearchParams(next, { replace: true });
  };

  if (isLoading) {
    return (
      <Container maxWidth={isDesktop ? 'lg' : 'sm'} sx={{ py: 3 }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
            gap: '16px',
          }}
        >
          {Array.from({ length: isDesktop ? 8 : 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </Box>
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="sm" sx={{ py: 4 }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void refetch()}>
              {t('guest.common.retry')}
            </Button>
          }
        >
          {errorMessage(error, t)}
        </Alert>
      </Container>
    );
  }

  if (!categories.length) {
    return (
      <EmptyState
        title={t(`${ns}.emptyTitle`)}
        description={t(`${ns}.emptyHint`)}
        testId={`${behaviour.guestTestIdPrefix}-catalog-empty`}
      />
    );
  }

  const showCartBar = behaviour.usesCart && !cart.isEmpty;

  return (
    <Box data-testid={behaviour.guestCatalogTestId}>
      <Box
        sx={{
          position: 'sticky',
          top: HEADER_OFFSET,
          zIndex: (theme) => theme.zIndex.appBar - 1,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Tabs
          value={activeCategory ?? categories[0].code}
          onChange={(_event, value: string) => scrollToCategory(value)}
          variant="scrollable"
          scrollButtons={false}
          allowScrollButtonsMobile
          aria-label={t(`${ns}.categories`)}
          sx={{ minHeight: TABS_HEIGHT }}
        >
          {categories.map((category) => (
            <Tab
              key={category.id}
              value={category.code}
              label={category.title}
              data-testid={`guest-category-tab-${category.code}`}
              sx={{ minHeight: TABS_HEIGHT, minWidth: 44 }}
            />
          ))}
        </Tabs>
      </Box>

      <Container maxWidth={isDesktop ? 'lg' : 'sm'} sx={{ py: { xs: 2, md: 3 }, pb: showCartBar ? 12 : 3 }}>
        <Stack spacing={{ xs: 3, md: 5 }}>
          {categories.map((category) => (
            <Box
              key={category.id}
              component="section"
              ref={(node: HTMLElement | null) => {
                sectionRefs.current[category.code] = node;
              }}
              aria-label={category.title}
            >
              {/* Reference `.secttl` — title, a flex hairline, then an aside note. */}
              <Stack direction="row" alignItems="baseline" spacing={1.5} sx={{ mb: { xs: 1.25, md: 1.75 } }}>
                <Typography variant="h5" component="h2">
                  {category.title}
                </Typography>
                <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
                {!category.is_available && category.available_from ? (
                  <Typography variant="caption" color="text.secondary">
                    {t('guest.menu.availableFrom', { time: category.available_from })}
                  </Typography>
                ) : null}
              </Stack>

              {/* Dense card grid — 4 columns on desktop, 2 under 1100px (reference `.grid`). */}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
                  gap: '16px',
                }}
              >
                {category.items.map((item, i) => (
                  <Box key={item.id} sx={revealSx({ index: i })}>
                    <CatalogRow
                      item={item}
                      fallbackType={type}
                      categoryAvailable={category.is_available}
                      onOpen={() => openItem(item)}
                      formatPrice={formatOptional}
                    />
                  </Box>
                ))}
              </Box>
            </Box>
          ))}
        </Stack>
      </Container>

      {showCartBar ? (
        <StickyFooter offset={BOTTOM_NAV_HEIGHT}>
          <Button
            fullWidth
            size="large"
            variant="contained"
            onClick={() => navigate('/cart')}
            data-testid="guest-cart-bar"
            sx={{ minHeight: 52, justifyContent: 'space-between', px: 2 }}
          >
            <Box component="span">
              {t('guest.cart.barItems', { count: cart.count })} · {format(cart.total)}
            </Box>
            <Box component="span">{t('guest.cart.barGo')}</Box>
          </Button>
        </StickyFooter>
      ) : null}

      <ItemSheet
        itemId={openItemId}
        listItem={openItemId ? (allItems.get(openItemId) ?? null) : null}
        onClose={closeSheet}
      />
    </Box>
  );
}

interface CatalogRowProps {
  item: MenuItem;
  /** Type of the catalog being shown — used when a row omits its own `type`. */
  fallbackType: OfferingType;
  categoryAvailable: boolean;
  onOpen: () => void;
  formatPrice: (minor: number | null | undefined) => string | null;
}

function CatalogRow({
  item,
  fallbackType,
  categoryAvailable,
  onOpen,
  formatPrice,
}: CatalogRowProps) {
  const { t } = useTranslation();
  const cart = useCart();
  const behaviour = behaviourFor(item.type ?? fallbackType);
  const usesFields = item.has_fields ?? behaviour.usesFields;
  const available = item.is_available && categoryAvailable;
  // A form-filled offering, a booking or a dish with required modifiers always
  // opens the sheet; a plain dish only when it must be configured. Either way the
  // guest ends up in the same sheet.
  const needsSheet =
    usesFields ||
    behaviour.usesSlots ||
    (item.has_required_modifiers ?? Boolean(item.modifier_groups?.some((g) => g.is_required)));
  const quantity = cart.simpleQuantity(item.id);
  // An `info` page has no price; a booking may or may not, like a service.
  const price = behaviour.usesContent ? null : formatPrice(item.price);

  const unavailableNote = !available
    ? item.available_from
      ? t('guest.menu.availableFrom', { time: item.available_from })
      : item.unavailable_reason === 'out_of_stock'
        ? t('guest.menu.outOfStock')
        : t('guest.menu.unavailable')
    : null;

  // An `info` row is a pure read link — the whole row opens the page, there is
  // no order control at all (`behaviour.createsOrder === false`).
  const action = !available || behaviour.usesContent ? null : (
    needsSheet ? (
      <Button
        variant="outlined"
        size="small"
        onClick={onOpen}
        data-testid={`guest-qty-plus-${item.code}`}
        sx={{ minHeight: 44, minWidth: 44, flexShrink: 0 }}
      >
        {behaviour.usesSlots
          ? t('guest.slot.choose')
          : usesFields
            ? t('guest.services.order')
            : t('guest.menu.choose')}
      </Button>
    ) : quantity > 0 ? (
      <QuantityStepper
        size="small"
        code={item.code}
        value={quantity}
        removeAtZero
        onIncrement={() => cart.addSimple(item)}
        onDecrement={() => cart.decrementSimple(item.id)}
      />
    ) : (
      <Button
        variant="contained"
        size="small"
        onClick={() => cart.addSimple(item)}
        data-testid={`guest-qty-plus-${item.code}`}
        aria-label={t('guest.menu.addAria', { title: item.title })}
        sx={{ minHeight: 44, minWidth: 44, flexShrink: 0 }}
      >
        +
      </Button>
    )
  );

  return (
    <CatalogRowView
      testId={`${behaviour.guestTestIdPrefix}-${item.code}`}
      title={item.title}
      description={item.description}
      imageSrc={item.images?.[0]}
      fallbackIcon={fallbackIconFor(item.type ?? fallbackType)}
      flags={item.flags ?? []}
      badges={item.badges}
      prepMinutes={item.prep_minutes}
      nutrition={item.nutrition}
      priceLabel={price}
      unavailableNote={unavailableNote}
      available={available}
      onOpen={onOpen}
      action={action}
    />
  );
}
