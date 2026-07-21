import { useEffect, useRef, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { ImageUploader, type EditableImage } from '@/components/ImageUploader';
import type { BackgroundKind, SurfaceStyle, ThemeMode } from '@/theme/tokens';
import type { BrandDraft } from './useBrandDraft';

/* ── Small building blocks ─────────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" gutterBottom>
        {title}
      </Typography>
      <Stack spacing={2}>{children}</Stack>
    </Paper>
  );
}

/** input[type=color] needs a 7-char hex; anything else falls back gracefully. */
function toHex(value: string | undefined): string {
  if (value && /^#[0-9a-fA-F]{6}$/.test(value)) return value;
  if (value && /^#[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  return '#000000';
}

function ColorField({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  testId: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // A NATIVE input listener (not React's synthetic onChange): a programmatic
  // `el.value = ...; dispatchEvent('input')` updates React's value tracker and so
  // gets deduped away by synthetic onChange — the native event always lands.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = () => onChangeRef.current(el.value);
    el.addEventListener('input', handler);
    return () => el.removeEventListener('input', handler);
  }, []);

  // Keep the (uncontrolled) DOM value in sync with the token value.
  useEffect(() => {
    if (ref.current && ref.current.value !== toHex(value)) {
      ref.current.value = toHex(value);
    }
  }, [value]);

  return (
    <Stack direction="row" spacing={1.5} alignItems="center">
      <Box
        component="input"
        ref={ref}
        type="color"
        defaultValue={toHex(value)}
        data-testid={testId}
        sx={{
          width: 44,
          height: 36,
          p: 0,
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: 'transparent',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      />
      <Stack sx={{ minWidth: 0 }}>
        <Typography variant="body2">{label}</Typography>
        <Typography variant="caption" color="text.secondary">
          {value ?? '—'}
        </Typography>
      </Stack>
    </Stack>
  );
}

/**
 * Bridges the array-based `ImageUploader` to a single token URL. External token
 * changes (reset / apply preset) re-seed the thumbnail; our own uploads flow out.
 */
function LogoField({
  url,
  onChangeUrl,
  testId,
}: {
  url: string | undefined;
  onChangeUrl: (url: string | undefined) => void;
  testId: string;
}) {
  // An empty string from the server means "no logo" — treat it and `undefined`
  // as the same value so seeding never looks like a real edit.
  const norm = (v: string | undefined): string => v ?? '';
  const seed = (u: string | undefined): EditableImage[] =>
    u ? [{ id: u, url: u, status: 'ready' }] : [];
  const [images, setImages] = useState<EditableImage[]>(() => seed(url));
  const lastEmitted = useRef<string | undefined>(url);

  useEffect(() => {
    if (norm(url) !== norm(lastEmitted.current)) {
      lastEmitted.current = url;
      setImages(seed(url));
    }
  }, [url]);

  useEffect(() => {
    const ready = images.find((i) => i.url && !i.error && !i.id.startsWith('tmp:'));
    const next = ready?.url;
    if (norm(next) !== norm(lastEmitted.current)) {
      lastEmitted.current = next;
      onChangeUrl(next);
    }
  }, [images, onChangeUrl]);

  return (
    <ImageUploader
      value={images}
      onChange={setImages}
      kind="brand"
      multiple={false}
      testId={testId}
    />
  );
}

const SURFACE_STYLES: SurfaceStyle[] = ['flat', 'soft', 'glass'];
const BACKGROUND_KINDS: BackgroundKind[] = ['solid', 'gradient', 'image', 'abstraction'];
const DEFAULT_MODES = ['light', 'dark', 'system'] as const;

/* ── The editor ─────────────────────────────────────────────────────────── */

export interface BrandEditorProps {
  brand: BrandDraft;
  /** Preview mode — the accent picker edits the palette of this mode. */
  mode: ThemeMode;
}

export function BrandEditor({ brand, mode }: BrandEditorProps) {
  const { t } = useTranslation();
  const {
    merged,
    presets,
    fonts,
    abstractions,
    setColor,
    setAccent,
    setTypography,
    setShape,
    setBrandExtras,
    setBackground,
    applyPreset,
  } = brand;

  const activePreset = merged.preset ?? 'custom';
  const bg = merged.brand?.background;
  const bgKind = bg?.kind ?? 'solid';

  return (
    <Stack spacing={2} data-testid="brand-editor">
      {/* Presets */}
      <Section title={t('brand.sections.presets')}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 1.5,
          }}
        >
          {presets.map((preset) => {
            const selected = activePreset === preset.code;
            return (
              <ButtonBase
                key={preset.code}
                onClick={() => applyPreset(preset)}
                data-testid={`brand-preset-${preset.code}`}
                sx={{
                  display: 'block',
                  textAlign: 'start',
                  p: 1.25,
                  borderRadius: 2,
                  border: 2,
                  borderColor: selected ? 'primary.main' : 'divider',
                  bgcolor: selected ? 'brand.surfaceSelected' : 'background.paper',
                }}
              >
                <Stack direction="row" spacing={0.5} sx={{ mb: 0.75 }}>
                  {preset.swatch.map((color, i) => (
                    <Box
                      key={i}
                      sx={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        bgcolor: color,
                        border: 1,
                        borderColor: 'divider',
                      }}
                    />
                  ))}
                </Stack>
                <Typography variant="body2" noWrap>
                  {preset.name}
                </Typography>
                {preset.description ? (
                  <Typography variant="caption" color="text.secondary" noWrap display="block">
                    {preset.description}
                  </Typography>
                ) : null}
              </ButtonBase>
            );
          })}
          {presets.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('brand.presetsEmpty')}
            </Typography>
          ) : null}
        </Box>
      </Section>

      {/* Palette */}
      <Section title={t('brand.sections.palette')}>
        <ColorField
          label={t('brand.primaryLight')}
          value={merged.palette.light.primary}
          onChange={(v) => setColor('light', 'primary', v)}
          testId="brand-primary-light"
        />
        <ColorField
          label={t('brand.primaryDark')}
          value={merged.palette.dark.primary}
          onChange={(v) => setColor('dark', 'primary', v)}
          testId="brand-primary-dark"
        />
        <ColorField
          label={t('brand.accent', { mode: t(`brand.preview.${mode}`) })}
          value={merged.palette[mode].secondary}
          onChange={setAccent}
          testId="brand-accent"
        />
      </Section>

      {/* Fonts */}
      <Section title={t('brand.sections.fonts')}>
        <FormControl size="small" fullWidth>
          <InputLabel id="brand-font-body-label">{t('brand.fontBody')}</InputLabel>
          <Select
            labelId="brand-font-body-label"
            label={t('brand.fontBody')}
            value={fonts.some((f) => f.family === merged.typography.fontFamily)
              ? merged.typography.fontFamily
              : ''}
            onChange={(e) => setTypography({ fontFamily: e.target.value })}
            data-testid="brand-font-body"
          >
            {fonts.map((font) => (
              <MenuItem key={font.family} value={font.family} sx={{ fontFamily: font.family }}>
                {font.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" fullWidth>
          <InputLabel id="brand-font-heading-label">{t('brand.fontHeading')}</InputLabel>
          <Select
            labelId="brand-font-heading-label"
            label={t('brand.fontHeading')}
            value={fonts.some((f) => f.family === merged.typography.headingFontFamily)
              ? merged.typography.headingFontFamily
              : ''}
            onChange={(e) => setTypography({ headingFontFamily: e.target.value })}
            data-testid="brand-font-heading"
          >
            {fonts.map((font) => (
              <MenuItem key={font.family} value={font.family} sx={{ fontFamily: font.family }}>
                {font.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Section>

      {/* Radii */}
      <Section title={t('brand.sections.radius')}>
        <Box>
          <Typography variant="body2" gutterBottom>
            {t('brand.radius')}: {merged.shape.borderRadius}px
          </Typography>
          <Slider
            value={merged.shape.borderRadius}
            min={0}
            max={28}
            step={1}
            valueLabelDisplay="auto"
            onChange={(_e, v) => setShape({ borderRadius: v as number })}
            data-testid="brand-radius"
          />
        </Box>
        <Box>
          <Typography variant="body2" gutterBottom>
            {t('brand.radiusLarge')}: {merged.shape.borderRadiusLarge}px
          </Typography>
          <Slider
            value={merged.shape.borderRadiusLarge}
            min={0}
            max={40}
            step={1}
            valueLabelDisplay="auto"
            onChange={(_e, v) => setShape({ borderRadiusLarge: v as number })}
            data-testid="brand-radius-large"
          />
        </Box>
      </Section>

      {/* Surface style */}
      <Section title={t('brand.sections.surface')}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={merged.brand?.surfaceStyle ?? 'flat'}
          onChange={(_e, v: SurfaceStyle | null) => v && setBrandExtras({ surfaceStyle: v })}
          data-testid="brand-surface-style"
        >
          {SURFACE_STYLES.map((style) => (
            <ToggleButton key={style} value={style}>
              {t(`brand.surface.${style}`)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Section>

      {/* Background */}
      <Section title={t('brand.sections.background')}>
        <FormControl size="small" fullWidth>
          <InputLabel id="brand-bg-kind-label">{t('brand.bgKind')}</InputLabel>
          <Select
            labelId="brand-bg-kind-label"
            label={t('brand.bgKind')}
            value={bgKind}
            onChange={(e) => setBackground({ kind: e.target.value as BackgroundKind })}
            data-testid="brand-bg-kind"
          >
            {BACKGROUND_KINDS.map((kind) => (
              <MenuItem key={kind} value={kind}>
                {t(`brand.bg.${kind}`)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {bgKind === 'solid' ? (
          <ColorField
            label={t('brand.bgColor')}
            value={bg?.color ?? merged.palette[mode].background}
            onChange={(v) => setBackground({ color: v })}
            testId="brand-bg-color"
          />
        ) : null}

        {bgKind === 'gradient' ? (
          <>
            <ColorField
              label={t('brand.gradientFrom')}
              value={bg?.gradient?.from}
              onChange={(v) =>
                setBackground({
                  gradient: {
                    from: v,
                    to: bg?.gradient?.to ?? v,
                    angle: bg?.gradient?.angle ?? 160,
                  },
                })
              }
              testId="brand-gradient-from"
            />
            <ColorField
              label={t('brand.gradientTo')}
              value={bg?.gradient?.to}
              onChange={(v) =>
                setBackground({
                  gradient: {
                    from: bg?.gradient?.from ?? v,
                    to: v,
                    angle: bg?.gradient?.angle ?? 160,
                  },
                })
              }
              testId="brand-gradient-to"
            />
            <Box>
              <Typography variant="body2" gutterBottom>
                {t('brand.gradientAngle')}: {bg?.gradient?.angle ?? 160}°
              </Typography>
              <Slider
                value={bg?.gradient?.angle ?? 160}
                min={0}
                max={360}
                step={5}
                valueLabelDisplay="auto"
                onChange={(_e, v) =>
                  setBackground({
                    gradient: {
                      from: bg?.gradient?.from ?? '#000000',
                      to: bg?.gradient?.to ?? '#000000',
                      angle: v as number,
                    },
                  })
                }
                data-testid="brand-gradient-angle"
              />
            </Box>
          </>
        ) : null}

        {bgKind === 'image' ? (
          <>
            <LogoField
              url={bg?.imageUrl}
              onChangeUrl={(u) => setBackground({ imageUrl: u })}
              testId="brand-bg-image-upload"
            />
            <Box>
              <Typography variant="body2" gutterBottom>
                {t('brand.dim')}: {Math.round((bg?.dim ?? 0) * 100)}%
              </Typography>
              <Slider
                value={bg?.dim ?? 0}
                min={0}
                max={1}
                step={0.05}
                valueLabelDisplay="auto"
                onChange={(_e, v) => setBackground({ dim: v as number })}
                data-testid="brand-bg-dim"
              />
            </Box>
          </>
        ) : null}

        {bgKind === 'abstraction' ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
              gap: 1,
            }}
          >
            {abstractions.map((a) => {
              const selected = bg?.abstraction === a.code;
              return (
                <ButtonBase
                  key={a.code}
                  onClick={() => setBackground({ abstraction: a.code })}
                  data-testid={`brand-abstraction-${a.code}`}
                  sx={{
                    display: 'block',
                    borderRadius: 2,
                    border: 2,
                    borderColor: selected ? 'primary.main' : 'divider',
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      height: 56,
                      backgroundImage: `url(${a.preview_url})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      bgcolor: 'brand.surfaceMuted',
                    }}
                  />
                  <Typography variant="caption" noWrap display="block" sx={{ px: 0.5, py: 0.25 }}>
                    {a.name}
                  </Typography>
                </ButtonBase>
              );
            })}
            {abstractions.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t('brand.abstractionsEmpty')}
              </Typography>
            ) : null}
          </Box>
        ) : null}
      </Section>

      {/* Logos */}
      <Section title={t('brand.sections.logos')}>
        <Typography variant="body2">{t('brand.logoLight')}</Typography>
        <LogoField
          url={merged.brand?.logoLight}
          onChangeUrl={(u) => setBrandExtras({ logoLight: u })}
          testId="brand-logo-light-upload"
        />
        <Typography variant="body2">{t('brand.logoDark')}</Typography>
        <LogoField
          url={merged.brand?.logoDark}
          onChangeUrl={(u) => setBrandExtras({ logoDark: u })}
          testId="brand-logo-dark-upload"
        />
      </Section>

      {/* Default mode */}
      <Section title={t('brand.sections.defaultMode')}>
        <FormControl size="small" fullWidth>
          <InputLabel id="brand-default-mode-label">{t('brand.defaultMode')}</InputLabel>
          <Select
            labelId="brand-default-mode-label"
            label={t('brand.defaultMode')}
            value={merged.brand?.defaultMode ?? 'light'}
            onChange={(e) => setBrandExtras({ defaultMode: e.target.value as 'light' | 'dark' | 'system' })}
            data-testid="brand-default-mode"
          >
            {DEFAULT_MODES.map((m) => (
              <MenuItem key={m} value={m}>
                {t(`brand.mode.${m}`)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Section>
    </Stack>
  );
}
