/**
 * Redesign-v2 component kit — built entirely on the theme tokens
 * (`theme.palette.*` incl. `theme.palette.brand.*`), never a color literal.
 * The styleguide gallery (`/cms/styleguide`) renders everything here live.
 */

// Signature
export { RoomTag, type RoomTagProps } from './RoomTag';

// Chips / badges / status
export {
  PricePill,
  KitBadge,
  FlagChip,
  ChipOption,
  StatusIndicator,
  statusTokenColor,
  type PricePillProps,
  type KitBadgeProps,
  type KitBadgeKind,
  type FlagChipProps,
  type ChipOptionProps,
  type StatusIndicatorProps,
  type OrderStatusKind,
} from './chips';

// Buttons / steppers / bars
export {
  KitButton,
  QuantityStepper,
  StickyActionBar,
  ctaGradientSx,
  type KitButtonProps,
  type KitButtonVariant,
  type QuantityStepperProps,
  type StickyActionBarProps,
} from './buttons';

// Cards / tiles / rows
export {
  PhotoCard,
  MosaicTile,
  CarouselItem,
  OrderLineRow,
  type PhotoCardProps,
  type MosaicTileProps,
  type CarouselItemProps,
  type OrderLineRowProps,
} from './cards';

// Feedback / overlays
export {
  Sheet,
  KitToast,
  KitEmptyState,
  SkeletonLine,
  SkeletonRow,
  SkeletonCard,
  type SheetProps,
  type KitToastProps,
  type ToastSeverity,
  type KitEmptyStateProps,
} from './feedback';

// Forms
export { KitTextField, KitTabs, type KitTabsProps } from './forms';

// Media
export { KitImage, mediaFallbackSx, type KitImageProps } from './KitImage';

// Vector flags (language switcher — block 8)
export { FlagIcon, FLAG_FOR_LANGUAGE, type FlagIconProps, type FlagCode } from './FlagIcon';

// Motion (reduced-motion honored in one place)
export {
  MOTION,
  usePrefersReducedMotion,
  useSheetTransition,
  revealSx,
  fadeInSx,
  pressableSx,
  type RevealOptions,
} from './motion';

// Room controls (visual only)
export {
  RingDimmer,
  PositionSlider,
  Thermostat,
  LargeToggle,
  ActionButton,
  SceneButton,
  RunningIndicator,
  OfflineIndicator,
  type RingDimmerProps,
  type PositionSliderProps,
  type ThermostatProps,
  type LargeToggleProps,
  type RoomTileButtonProps,
  type RoomStatusProps,
} from './room';
