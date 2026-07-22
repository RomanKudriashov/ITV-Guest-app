import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import {
  ICON_GROUPS,
  IconAdd,
  IconSearch,
  IconDimmer,
  IconCurtain,
  IconLock,
  IconScene,
  IconOrders,
} from '@/icons';
import {
  RoomTag,
  PricePill,
  KitBadge,
  FlagChip,
  StatusIndicator,
  KitButton,
  QuantityStepper,
  StickyActionBar,
  PhotoCard,
  MosaicTile,
  CarouselItem,
  OrderLineRow,
  Sheet,
  KitToast,
  KitEmptyState,
  SkeletonRow,
  SkeletonCard,
  KitTextField,
  KitTabs,
  RingDimmer,
  PositionSlider,
  Thermostat,
  LargeToggle,
  ActionButton,
  SceneButton,
  RunningIndicator,
  OfflineIndicator,
  FlagIcon,
  type OrderStatusKind,
} from '@/kit';

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3 }}>
      <Typography variant="h6" component="h2" gutterBottom>
        {title}
      </Typography>
      {subtitle ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {subtitle}
        </Typography>
      ) : null}
      {children}
    </Paper>
  );
}

const FLAGS = [
  { code: 'vegan', label: 'Vegan' },
  { code: 'vegetarian', label: 'Vegetarian' },
  { code: 'spicy', label: 'Spicy' },
  { code: 'glutenFree', label: 'Gluten-free' },
  { code: 'lactoseFree', label: 'Lactose-free' },
  { code: 'halal', label: 'Halal' },
];
const ALLERGENS = [
  { code: 'nuts', label: 'Nuts' },
  { code: 'seafood', label: 'Seafood' },
  { code: 'egg', label: 'Egg' },
  { code: 'milk', label: 'Milk' },
];
const STATUSES: { status: OrderStatusKind; label: string }[] = [
  { status: 'new', label: 'New' },
  { status: 'accepted', label: 'Accepted' },
  { status: 'preparing', label: 'Preparing' },
  { status: 'ready', label: 'Ready' },
  { status: 'done', label: 'Done' },
  { status: 'cancelled', label: 'Cancelled' },
];

export function StyleguidePage() {
  const [qty, setQty] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tab, setTab] = useState('all');
  const [light, setLight] = useState(true);
  const [scene, setScene] = useState('evening');

  return (
    <Box data-testid="styleguide" sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
      <Stack spacing={0.5} sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1">
          Design system
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Redesign v2 foundation — icons, component kit and room controls, rendered on the live
          theme. Follows the CMS light/dark toggle.
        </Typography>
      </Stack>

      <Stack spacing={3}>
        {/* Signature */}
        <Section title="Signature — enamel room tag" subtitle="One bright object; everything else restrained.">
          <Stack direction="row" spacing={3} alignItems="flex-end" flexWrap="wrap" useFlexGap>
            <RoomTag label="Номер" room="305" size="lg" />
            <RoomTag label="Номер" room="1204" size="md" />
            <RoomTag room="7" size="sm" />
          </Stack>
        </Section>

        {/* Icons */}
        <Section title="Icons" subtitle="Monochrome line set, single stroke width, recolor via currentColor.">
          <Stack spacing={2.5}>
            {ICON_GROUPS.map((grp) => (
              <Box key={grp.group}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  {grp.group}
                </Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))',
                    gap: 1,
                  }}
                >
                  {grp.icons.map(({ name, Icon }) => (
                    <Stack
                      key={`${grp.group}-${name}`}
                      spacing={0.5}
                      alignItems="center"
                      sx={{
                        p: 1,
                        borderRadius: 2,
                        border: 1,
                        borderColor: 'divider',
                        bgcolor: 'brand.surfaceMuted',
                      }}
                    >
                      <Icon size={24} />
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: '100%' }}>
                        {name}
                      </Typography>
                    </Stack>
                  ))}
                </Box>
              </Box>
            ))}
          </Stack>
        </Section>

        {/* Buttons */}
        <Section title="Buttons" subtitle="Variants and states: default / hover / active / disabled / loading.">
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              <KitButton kitVariant="primary" startIcon={<IconAdd size={18} />}>Primary</KitButton>
              <KitButton kitVariant="secondary">Secondary</KitButton>
              <KitButton kitVariant="ghost">Ghost</KitButton>
              <KitButton kitVariant="danger">Danger</KitButton>
            </Stack>
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              <KitButton kitVariant="primary" disabled>Disabled</KitButton>
              <KitButton kitVariant="primary" loading>Loading</KitButton>
              <KitButton kitVariant="secondary" loading>Saving</KitButton>
            </Stack>
          </Stack>
        </Section>

        {/* Forms */}
        <Section title="Text fields & tabs">
          <Stack spacing={2} sx={{ maxWidth: 420 }}>
            <KitTextField label="Guest name" placeholder="e.g. Anna" />
            <KitTextField
              label="Search"
              placeholder="Find a dish"
              InputProps={{ startAdornment: <Box sx={{ mr: 1, display: 'flex' }}><IconSearch size={18} /></Box> }}
            />
            <KitTextField label="Notes" placeholder="Optional" multiline minRows={2} />
          </Stack>
          <Divider sx={{ my: 2 }} />
          <KitTabs
            value={tab}
            onChange={(_e, v: string) => setTab(v)}
            tabs={[
              { value: 'all', label: 'All' },
              { value: 'food', label: 'Food' },
              { value: 'drinks', label: 'Drinks' },
              { value: 'services', label: 'Services' },
            ]}
          />
        </Section>

        {/* Chips, badges, price */}
        <Section title="Chips, badges & price">
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>Dietary flags</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {FLAGS.map((f) => <FlagChip key={f.code} code={f.code} label={f.label} />)}
              </Stack>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>Allergens</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {ALLERGENS.map((a) => <FlagChip key={a.code} code={a.code} label={a.label} tone="allergen" />)}
              </Stack>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>Badges & price</Typography>
              <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                <KitBadge kind="hit" label="Хит" />
                <KitBadge kind="new" label="Новинка" />
                <KitBadge kind="chef" label="Выбор шефа" />
                <PricePill price="2 490 ₽" />
                <PricePill price="2 490 ₽" emphasis />
              </Stack>
            </Box>
          </Stack>
        </Section>

        {/* Language flags */}
        <Section
          title="Language flags"
          subtitle="Vector SVG flags for the language switcher (block 8) — no emoji flags."
        >
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
            {([
              { code: 'gb', label: 'English' },
              { code: 'ru', label: 'Русский' },
              { code: 'sa', label: 'العربية' },
              { code: 'cn', label: '中文' },
            ] as const).map((f) => (
              <Stack key={f.code} direction="row" spacing={1} alignItems="center">
                <FlagIcon code={f.code} width={28} />
                <Typography variant="body2">{f.label}</Typography>
              </Stack>
            ))}
          </Stack>
        </Section>

        {/* Status + stepper */}
        <Section title="Statuses & quantity stepper">
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              {STATUSES.map((s) => <StatusIndicator key={s.status} status={s.status} label={s.label} />)}
            </Stack>
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              {STATUSES.map((s) => (
                <StatusIndicator key={s.status} status={s.status} label={s.label} variant="dot" />
              ))}
            </Stack>
            <QuantityStepper value={qty} onChange={setQty} />
          </Stack>
        </Section>

        {/* Cards */}
        <Section title="Cards, tiles & rows" subtitle="Photo card with overlaid caption, mosaic, carousel and order lines.">
          <Stack spacing={2}>
            <Box
              sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}
            >
              <PhotoCard title="Chef's table" subtitle="Tasting menu" overlay={<KitBadge kind="chef" label="Выбор шефа" />} />
              <PhotoCard title="Spa & wellness" subtitle="Book a slot" />
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.5 }}>
              <MosaicTile title="Restaurant" span={2} />
              <MosaicTile title="Bar" />
              <MosaicTile title="Room service" />
              <MosaicTile title="Concierge" span={2} />
            </Box>
            <Stack direction="row" spacing={1.5} sx={{ overflowX: 'auto', pb: 1 }}>
              <CarouselItem title="Ribeye steak" caption={<PricePill price="2 490 ₽" />} />
              <CarouselItem title="Caesar salad" caption={<PricePill price="890 ₽" />} />
              <CarouselItem title="Pavlova" caption={<PricePill price="640 ₽" />} />
            </Stack>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
              <OrderLineRow title="Ribeye steak" qty={1} price="2 490 ₽" note="Medium rare" />
              <Divider />
              <OrderLineRow title="Caesar salad" qty={2} price="1 780 ₽" />
            </Paper>
          </Stack>
        </Section>

        {/* Overlays & feedback */}
        <Section title="Sheet, toasts, empty & loading states">
          <Stack spacing={2}>
            <KitButton kitVariant="secondary" onClick={() => setSheetOpen(true)}>Open sheet</KitButton>
            <Stack spacing={1.5}>
              <KitToast severity="success" message="Order accepted" />
              <KitToast severity="info" message="New message from the kitchen" />
              <KitToast severity="warning" message="Low stock on this item" />
              <KitToast severity="error" message="Payment failed" />
            </Stack>
            <Divider />
            <KitEmptyState
              icon={<IconOrders size={28} />}
              title="No orders yet"
              description="When a guest places an order it will appear here."
              action={<KitButton kitVariant="primary">Refresh</KitButton>}
            />
            <Divider />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <Stack spacing={1}>
                <SkeletonRow />
                <SkeletonRow />
              </Stack>
              <SkeletonCard />
            </Box>
          </Stack>
        </Section>

        {/* Room controls */}
        <Section title="Room controls" subtitle="Visual language only — no logic. Locks the future room-control phase.">
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap alignItems="flex-start">
            <RingDimmer value={68} label="Bedside lamp" center={<IconDimmer size={26} />} />
            <PositionSlider value={40} label="Curtains — 40% open" />
            <Thermostat current={22} target={24} label="Climate" />
            <LargeToggle on={light} onChange={setLight} label="Ceiling light" ariaLabel="Ceiling light" />
          </Stack>
          <Divider sx={{ my: 2 }} />
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
            <ActionButton icon={<IconLock size={24} />} label="Do not disturb" active />
            <ActionButton icon={<IconCurtain size={24} />} label="Curtains" />
            <SceneButton icon={<IconScene size={24} />} label="Evening" active={scene === 'evening'} onClick={() => setScene('evening')} />
            <SceneButton icon={<IconScene size={24} />} label="Bright" active={scene === 'bright'} onClick={() => setScene('bright')} />
          </Stack>
          <Divider sx={{ my: 2 }} />
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
            <RunningIndicator label="Applying…" />
            <OfflineIndicator label="Device offline" />
          </Stack>
        </Section>
      </Stack>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Ribeye steak"
        footer={
          <StickyActionBar>
            <KitButton kitVariant="primary" fullWidth>Add to cart</KitButton>
          </StickyActionBar>
        }
      >
        <Stack spacing={1.5}>
          <PhotoCard title="Ribeye steak" subtitle="Dry-aged, grilled to your liking" height={180} />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <FlagChip code="spicy" label="Spicy" />
            <FlagChip code="glutenFree" label="Gluten-free" />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            A generous dry-aged ribeye with roasted seasonal vegetables and a red-wine jus.
          </Typography>
          <QuantityStepper value={qty} onChange={setQty} />
        </Stack>
      </Sheet>
    </Box>
  );
}
