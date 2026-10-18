import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import CenterFocusStrongOutlinedIcon from '@mui/icons-material/CenterFocusStrongOutlined';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { ApiError } from '@/api/client';
import { fetchMedia, setMediaFocus, uploadMedia } from '@/api/cms';
import type { FocusPoint, MediaKind, MediaStatus } from '@/api/types';
import { FocusEditor } from '@/media/FocusEditor';
import { SurfacePreview } from '@/media/SurfacePreview';
import { ROLE_PLACES, roleNeedWidth, roleThumbRatio, type MediaRole } from '@/media/places';
import type { ImageRef } from '@/kit/imageRef';

/** Media as held by an editor: a server asset plus an optional local preview. */
export interface EditableImage {
  /** Media id, or `tmp:*` while the upload request is in flight. */
  id: string;
  url: string;
  thumb_url?: string;
  status: MediaStatus;
  /** `URL.createObjectURL` preview shown until the backend reports `ready`. */
  localPreview?: string;
  /** Upload/processing failure message. */
  error?: string;
  /** Исходник — то, по чему ставится точка главного. */
  original_url?: string;
  /** Объект картинки (партия 58а) — превью рисует его, как витрина. */
  ref?: ImageRef | null;
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
/**
 * SVG — только бренду (партия 25): логотип из брендбука живёт в векторе.
 * Сервер его чистит и не режет на варианты, поэтому и кадрировать нечего.
 */
const ACCEPTED_BRAND = [...ACCEPTED, 'image/svg+xml'];

function isVector(image: EditableImage): boolean {
  return /\.svg(\?|$)/i.test(image.original_url ?? image.url ?? '');
}
const MAX_BYTES = 10 * 1024 * 1024;
/**
 * Логотип уходит гостю КАК ЕСТЬ, без пережатия (партия 58а), — предел свой и
 * проверяется до загрузки, с понятной причиной (партия 58б). Сервер держит тот
 * же предел (`LOGO_MAX_BYTES`): скрипт по API мимо панели его не обойдёт.
 */
const LOGO_MAX_BYTES = 1024 * 1024;
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 20;

export function isTempImage(image: EditableImage): boolean {
  return image.id.startsWith('tmp:');
}

/** Ids ready to be persisted via `PUT /cms/items/{id}/images`. */
export function persistableImageIds(images: EditableImage[]): string[] {
  return images.filter((image) => !isTempImage(image) && !image.error).map((image) => image.id);
}

export function mediaToEditable(asset: {
  id: string;
  url: string;
  thumb_url?: string;
  status: MediaStatus;
  original_url?: string;
  ref?: ImageRef | null;
}): EditableImage {
  return {
    id: asset.id,
    url: asset.url,
    thumb_url: asset.thumb_url,
    status: asset.status,
    original_url: asset.original_url,
    ref: asset.ref ?? null,
  };
}

export interface ImageUploaderProps {
  value: EditableImage[];
  onChange: Dispatch<SetStateAction<EditableImage[]>>;
  kind?: MediaKind;
  /** Single-image mode (categories) replaces instead of appending. */
  multiple?: boolean;
  disabled?: boolean;
  testId?: string;
  /**
   * РОЛЬ ФОТО — ГДЕ ЕГО УВИДИТ ГОСТЬ (партия 58в, `media/places.ts`). Задаёт
   * форму миниатюры, места в редакторе точки главного и порог «слабого
   * оригинала». Необязательна только ради плана номера: там кадры парные.
   */
  role?: MediaRole;
}

export function ImageUploader({
  value,
  onChange,
  kind = 'item',
  multiple = true,
  disabled = false,
  testId = 'image-uploader',
  role,
}: ImageUploaderProps) {
  const { t } = useTranslation();
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Картинка, у которой сейчас ставят точку главного. */
  const [focusing, setFocusing] = useState<EditableImage | null>(null);
  const [focusBusy, setFocusBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const objectUrls = useRef<string[]>([]);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
      objectUrls.current = [];
    };
  }, []);

  const patchImage = useCallback(
    (id: string, patch: Partial<EditableImage> & { id?: string }) => {
      onChange((prev) =>
        prev.map((image) => (image.id === id ? { ...image, ...patch } : image)),
      );
    },
    [onChange],
  );

  const dropImage = useCallback(
    (id: string) => {
      onChange((prev) => prev.filter((image) => image.id !== id));
    },
    [onChange],
  );

  /** Polls `GET /cms/media/{id}` until the asset is ready (or we give up). */
  const pollUntilReady = useCallback(
    async (mediaId: string) => {
      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (!mounted.current) return;
        try {
          const asset = await fetchMedia(mediaId);
          if (!mounted.current) return;
          patchImage(mediaId, {
            url: asset.url,
            thumb_url: asset.thumb_url,
            status: asset.status,
            original_url: asset.original_url,
                    ref: asset.ref ?? null,
          });
          if (asset.status === 'ready') return;
          if (asset.status === 'failed') {
            patchImage(mediaId, { error: t('media.processingFailed') });
            return;
          }
        } catch {
          /* transient — keep polling */
        }
      }
      if (mounted.current) patchImage(mediaId, { error: t('media.processingTimeout') });
    },
    [patchImage, t],
  );

  const uploadFile = useCallback(
    async (file: File) => {
      if (!(kind === 'brand' ? ACCEPTED_BRAND : ACCEPTED).includes(file.type)) {
        setError(t(kind === 'brand' ? 'media.unsupportedTypeBrand' : 'media.unsupportedType'));
        return;
      }
      if (role === 'logo' && file.size > LOGO_MAX_BYTES) {
        setError(t('media.logoTooLarge'));
        return;
      }
      if (file.size > MAX_BYTES) {
        setError(t('media.tooLarge'));
        return;
      }
      setError(null);

      const tempId = `tmp:${Math.random().toString(36).slice(2)}`;
      const localPreview = URL.createObjectURL(file);
      objectUrls.current.push(localPreview);

      const placeholder: EditableImage = {
        id: tempId,
        url: '',
        status: 'pending',
        localPreview,
      };
      onChange((prev) => (multiple ? [...prev, placeholder] : [placeholder]));

      try {
        const asset = await uploadMedia(file, kind, role === 'logo' ? 'logo' : undefined);
        if (!mounted.current) return;
        // Swap the temp entry for the real media id, keeping the local preview.
        onChange((prev) =>
          prev.map((image) =>
            image.id === tempId
              ? {
                  id: asset.id,
                  url: asset.url,
                  thumb_url: asset.thumb_url,
                  status: asset.status,
                  original_url: asset.original_url,
                                ref: asset.ref ?? null,
                  localPreview,
                }
              : image,
          ),
        );
        if (asset.status !== 'ready') await pollUntilReady(asset.id);
      } catch (uploadError) {
        if (!mounted.current) return;
        const message =
          uploadError instanceof ApiError ? uploadError.detail : t('media.uploadFailed');
        setError(message);
        dropImage(tempId);
      }
    },
    [dropImage, kind, multiple, onChange, pollUntilReady, role, t],
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || disabled) return;
      const list = multiple ? Array.from(files) : Array.from(files).slice(0, 1);
      for (const file of list) void uploadFile(file);
    },
    [disabled, multiple, uploadFile],
  );

  /*
    СОХРАНИТЬ ТОЧКУ ГЛАВНОГО (партия 58в). Нарезка не перезапускается — ассет
    приходит `ready` с новым фокусом в объекте картинки, превью сдвигается сразу.
  */
  const applyFocus = useCallback(
    async (image: EditableImage, focus: FocusPoint) => {
      setFocusBusy(true);
      try {
        const asset = await setMediaFocus(image.id, focus);
        if (!mounted.current) return;
        patchImage(image.id, { status: asset.status, ref: asset.ref ?? image.ref ?? null });
        setFocusing(null);
      } catch (focusError) {
        if (!mounted.current) return;
        setError(focusError instanceof ApiError ? focusError.detail : t('errors.generic'));
      } finally {
        if (mounted.current) setFocusBusy(false);
      }
    },
    [patchImage, t],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onChange((prev) => {
      const from = prev.findIndex((image) => image.id === active.id);
      const to = prev.findIndex((image) => image.id === over.id);
      if (from < 0 || to < 0) return prev;
      return arrayMove(prev, from, to);
    });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    handleFiles(event.dataTransfer.files);
  };

  return (
    <Stack spacing={1.5} data-testid={testId}>
      <Box
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        data-testid={`${testId}-dropzone`}
        sx={{
          border: 1,
          borderStyle: 'dashed',
          borderColor: dragActive ? 'primary.main' : 'divider',
          bgcolor: dragActive ? 'brand.dropActive' : 'brand.surfaceMuted',
          borderRadius: 2,
          p: 3,
          textAlign: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          transition: 'background-color .15s, border-color .15s',
        }}
      >
        <CloudUploadOutlinedIcon sx={{ color: 'text.secondary' }} />
        <Typography variant="body2" color="text.secondary">
          {t('media.dropHere')}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t('media.constraints')}
        </Typography>
        <Box sx={{ mt: 1 }}>
          <Button size="small" variant="outlined" disabled={disabled} component="span">
            {t('media.choose')}
          </Button>
        </Box>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept={(kind === 'brand' ? ACCEPTED_BRAND : ACCEPTED).join(',')}
          multiple={multiple}
          data-testid={`${testId}-input`}
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </Box>

      {error ? (
        <Typography variant="caption" color="error" data-testid={`${testId}-error`}>
          {error}
        </Typography>
      ) : null}

      {value.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={value.map((image) => image.id)} strategy={rectSortingStrategy}>
            <Box
              sx={{
                display: 'grid',
                // Под поверхность, а не под квадрат: превью показывает кадр
                // гостя, и 120×120 в него не помещается по смыслу.
                gridTemplateColumns: role
                  ? 'repeat(auto-fill, minmax(240px, 1fr))'
                  : 'repeat(auto-fill, minmax(120px, 1fr))',
                gap: 1.5,
              }}
            >
              {value.map((image) => (
                <SortableThumb
                  key={image.id}
                  image={image}
                  sortable={multiple}
                  role={role}
                  onRemove={() => dropImage(image.id)}
                  onFocus={() => setFocusing(image)}
                />
              ))}
            </Box>
          </SortableContext>
        </DndContext>
      ) : null}

      {/*
        СЛАБЫЙ ОРИГИНАЛ (партия 58в). Ширины не хватает самому крупному месту
        роли при DPR 2 — предупреждаем словами и числом из мест, но не
        запрещаем: лучше мягкое фото, чем никакого.
      */}
      {role
        ? value.map((image) => {
            const w = image.ref?.w ?? 0;
            const h = image.ref?.h ?? 0;
            if (!w || !h || isTempImage(image) || isVector(image)) return null;
            const need = roleNeedWidth(role, w, h);
            if (!need || w >= need) return null;
            return (
              <Alert key={`weak-${image.id}`} severity="warning" data-testid={`media-weak-${image.id}`}>
                {t('media.weakOriginal', { have: w, need })}
              </Alert>
            );
          })
        : null}

      {/* Редактор монтируется открытым: точка берётся из объекта картинки один раз. */}
      {focusing && role && focusing.original_url && focusing.ref ? (
        <FocusEditor
          open
          src={focusing.original_url}
          image={focusing.ref}
          role={role}
          busy={focusBusy}
          onCancel={() => setFocusing(null)}
          onSave={(focus) => void applyFocus(focusing, focus)}
        />
      ) : null}
    </Stack>
  );
}

function SortableThumb({
  image,
  sortable,
  role,
  onRemove,
  onFocus,
}: {
  image: EditableImage;
  sortable: boolean;
  role?: MediaRole;
  onRemove: () => void;
  onFocus: () => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: image.id,
    disabled: !sortable,
  });

  const src = image.status === 'ready' && image.url ? image.url : (image.localPreview ?? image.url);
  const busy = image.status !== 'ready' && !image.error;
  // Объект — только у готовой картинки: до этого на экране локальное превью
  // (`blob:`) или прежний кадр, пока режется новый.
  const ref = image.status === 'ready' && image.url ? (image.ref ?? null) : null;

  return (
    <Box
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid={`media-thumb-${image.id}`}
      sx={{
        position: 'relative',
        // Кадр гостя, а не квадрат файла: человек одобряет то, что увидят.
        aspectRatio: role ? String(roleThumbRatio(role)) : '1 / 1',
        borderRadius: 2,
        overflow: 'hidden',
        border: 1,
        borderColor: 'divider',
        bgcolor: 'brand.surfaceMuted',
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      {/*
        Картинку рисует НАСТОЯЩИЙ примитив витрины, а не свой `<img>`: похожая
        вёрстка расходится с гостевой на первой же правке дизайна, и превью
        начинает врать — правдоподобно и потому незаметно.
      */}
      {role ? (
        <SurfacePreview
          src={src}
          image={ref}
          role={role}
          caption={false}
          fill
          // Плитка сетки minmax(240px, 1fr): ~316 px на широком окне, во всю
          // ширину колонки на телефоне.
          sizes="(max-width: 599px) calc(100vw - 32px), 340px"
        />
      ) : src ? (
        <Box
          component="img"
          src={src}
          alt=""
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : null}

      {busy ? (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'brand.scrim',
          }}
        >
          <CircularProgress size={22} color="inherit" sx={{ color: 'primary.contrastText' }} />
        </Box>
      ) : null}

      {image.error ? (
        <Tooltip title={image.error}>
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              bgcolor: 'brand.scrim',
              color: 'error.main',
            }}
          >
            <ErrorOutlineIcon />
          </Box>
        </Tooltip>
      ) : null}

      <Stack
        direction="row"
        justifyContent="space-between"
        sx={{
          position: 'absolute',
          insetInline: 0,
          bottom: 0,
          bgcolor: 'brand.scrim',
          px: 0.5,
        }}
      >
        {sortable ? (
          <IconButton
            size="small"
            {...attributes}
            {...listeners}
            aria-label={t('common.reorder')}
            sx={{ color: 'primary.contrastText', cursor: 'grab' }}
          >
            <DragIndicatorIcon fontSize="small" />
          </IconButton>
        ) : (
          <span />
        )}
        <Box sx={{ display: 'flex' }}>
          {/*
            Точка главного — у фото с местами показа и исходником. У вектора
            и логотипа её нет: они показываются целиком.
          */}
          {role &&
          ROLE_PLACES[role].length &&
          image.status === 'ready' &&
          image.original_url &&
          image.ref?.w &&
          !isVector(image) ? (
            <IconButton
              size="small"
              onClick={onFocus}
              aria-label={t('media.focus.open')}
              data-testid={`media-focus-${image.id}`}
              sx={{ color: 'primary.contrastText' }}
            >
              <CenterFocusStrongOutlinedIcon fontSize="small" />
            </IconButton>
          ) : null}
          <IconButton
            size="small"
            onClick={onRemove}
            aria-label={t('common.delete')}
            data-testid={`media-remove-${image.id}`}
            sx={{ color: 'primary.contrastText' }}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Box>
      </Stack>
    </Box>
  );
}
