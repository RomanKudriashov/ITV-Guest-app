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
import { fetchMedia, uploadMedia } from '@/api/cms';
import type { MediaKind, MediaStatus } from '@/api/types';

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
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;
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
}): EditableImage {
  return {
    id: asset.id,
    url: asset.url,
    thumb_url: asset.thumb_url,
    status: asset.status,
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
}

export function ImageUploader({
  value,
  onChange,
  kind = 'item',
  multiple = true,
  disabled = false,
  testId = 'image-uploader',
}: ImageUploaderProps) {
  const { t } = useTranslation();
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      if (!ACCEPTED.includes(file.type)) {
        setError(t('media.unsupportedType'));
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
        const asset = await uploadMedia(file, kind);
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
    [dropImage, kind, multiple, onChange, pollUntilReady, t],
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || disabled) return;
      const list = multiple ? Array.from(files) : Array.from(files).slice(0, 1);
      for (const file of list) void uploadFile(file);
    },
    [disabled, multiple, uploadFile],
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
          accept={ACCEPTED.join(',')}
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
                gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                gap: 1.5,
              }}
            >
              {value.map((image) => (
                <SortableThumb
                  key={image.id}
                  image={image}
                  sortable={multiple}
                  onRemove={() => dropImage(image.id)}
                />
              ))}
            </Box>
          </SortableContext>
        </DndContext>
      ) : null}
    </Stack>
  );
}

function SortableThumb({
  image,
  sortable,
  onRemove,
}: {
  image: EditableImage;
  sortable: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: image.id,
    disabled: !sortable,
  });

  const src = image.status === 'ready' && image.url ? image.url : (image.localPreview ?? image.url);
  const busy = image.status !== 'ready' && !image.error;

  return (
    <Box
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid={`media-thumb-${image.id}`}
      sx={{
        position: 'relative',
        aspectRatio: '1 / 1',
        borderRadius: 2,
        overflow: 'hidden',
        border: 1,
        borderColor: 'divider',
        bgcolor: 'brand.surfaceMuted',
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      {src ? (
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
        <IconButton
          size="small"
          onClick={onRemove}
          aria-label={t('common.delete')}
          data-testid={`media-remove-${image.id}`}
          sx={{ color: 'primary.contrastText' }}
        >
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Box>
  );
}
