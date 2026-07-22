import { forwardRef, type ReactNode, type SVGProps } from 'react';

/**
 * Redesign-v2 monochrome line-icon primitive.
 *
 * Every icon is drawn on a 24×24 grid with a single consistent stroke width,
 * `fill="none"` and `stroke="currentColor"`, so it inherits the surrounding
 * text color and recolors purely through theme tokens (never a color literal).
 * A single `size` prop drives width/height — either a number or a scale key.
 */
export const ICON_SIZES = { xs: 16, sm: 20, md: 24, lg: 32, xl: 40 } as const;
export type IconSize = keyof typeof ICON_SIZES;

/** Consistent stroke width across the whole set. */
export const ICON_STROKE = 1.75;

export interface AppIconProps extends Omit<SVGProps<SVGSVGElement>, 'ref' | 'children'> {
  /** Scale key (`xs`…`xl`) or an explicit pixel size. Defaults to 24 (`md`). */
  size?: IconSize | number;
  /** Accessible label; when omitted the icon is decorative (`aria-hidden`). */
  title?: string;
}

function resolveSize(size: AppIconProps['size']): number {
  if (typeof size === 'number') return size;
  if (size && size in ICON_SIZES) return ICON_SIZES[size];
  return ICON_SIZES.md;
}

const BaseIcon = forwardRef<SVGSVGElement, AppIconProps & { children: ReactNode }>(
  function BaseIcon({ size, title, children, ...rest }, ref) {
    const px = resolveSize(size);
    return (
      <svg
        ref={ref}
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={ICON_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        role={title ? 'img' : undefined}
        aria-hidden={title ? undefined : true}
        aria-label={title}
        focusable="false"
        {...rest}
      >
        {title ? <title>{title}</title> : null}
        {children}
      </svg>
    );
  },
);

/** Factory: turns raw SVG children into a named icon component. */
export function createIcon(displayName: string, paths: ReactNode) {
  const Comp = forwardRef<SVGSVGElement, AppIconProps>(function Icon(props, ref) {
    return (
      <BaseIcon ref={ref} {...props}>
        {paths}
      </BaseIcon>
    );
  });
  Comp.displayName = `Icon(${displayName})`;
  return Comp;
}

export type AppIconComponent = ReturnType<typeof createIcon>;
