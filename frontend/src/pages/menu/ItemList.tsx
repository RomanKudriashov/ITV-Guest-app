import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ImageNotSupportedOutlinedIcon from '@mui/icons-material/ImageNotSupportedOutlined';
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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import type { Bootstrap, Item } from '@/api/types';
import { formatMoney } from '@/utils/money';
import { pickTranslated } from '@/utils/translated';

export interface ItemListProps {
  items: Item[];
  bootstrap: Bootstrap;
  displayLanguage: string;
  fallbackLanguage: string;
  onOpen: (item: Item) => void;
  onDelete: (item: Item) => void;
  onToggleActive: (item: Item, isActive: boolean) => void;
  onToggleStock: (item: Item, inStock: boolean) => void;
  onReorder: (orderedIds: string[]) => void;
}

export function ItemList(props: ItemListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = props.items.map((item) => item.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(to, 0, next.splice(from, 1)[0]);
    props.onReorder(next);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext
        items={props.items.map((item) => item.id)}
        strategy={verticalListSortingStrategy}
      >
        <Stack spacing={1} data-testid="item-list">
          {props.items.map((item) => (
            <ItemRow key={item.id} item={item} {...props} />
          ))}
        </Stack>
      </SortableContext>
    </DndContext>
  );
}

function ItemRow({
  item,
  bootstrap,
  displayLanguage,
  fallbackLanguage,
  onOpen,
  onDelete,
  onToggleActive,
  onToggleStock,
}: ItemListProps & { item: Item }) {
  const { t, i18n } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const title = pickTranslated(item.title, displayLanguage, fallbackLanguage) || item.code;
  const thumb = item.images?.find((image) => image.status === 'ready');
  const price = formatMoney(
    item.price,
    bootstrap.hotel.currency,
    bootstrap.hotel.currency_minor_units,
    i18n.resolvedLanguage ?? 'ru',
  );

  const flagTitle = (code: string) => {
    const flag = bootstrap.flags.find((entry) => entry.code === code);
    return flag ? pickTranslated(flag.title, displayLanguage, fallbackLanguage) || code : code;
  };

  return (
    <Paper
      ref={setNodeRef}
      variant="outlined"
      data-testid={`item-row-${item.code}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{
        p: 1.5,
        borderColor: 'divider',
        opacity: isDragging ? 0.5 : item.is_active ? 1 : 0.6,
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Box
          {...attributes}
          {...listeners}
          sx={{ display: 'flex', color: 'text.secondary', cursor: 'grab' }}
          aria-label={t('common.reorder')}
        >
          <DragIndicatorIcon fontSize="small" />
        </Box>

        <Box
          sx={{
            width: 56,
            height: 56,
            borderRadius: 2,
            overflow: 'hidden',
            flexShrink: 0,
            bgcolor: 'brand.surfaceMuted',
            display: 'grid',
            placeItems: 'center',
            color: 'text.secondary',
          }}
        >
          {thumb ? (
            <Box
              component="img"
              src={thumb.thumb_url || thumb.url}
              alt=""
              // Hide broken media instead of showing the browser's error glyph.
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <ImageNotSupportedOutlinedIcon fontSize="small" />
          )}
        </Box>

        <Stack sx={{ flexGrow: 1, minWidth: 0 }} spacing={0.5}>
          <Typography variant="subtitle2" noWrap>
            {title}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2" color="text.secondary">
              {price}
            </Typography>
            {item.flags?.map((code) => (
              <Chip
                key={code}
                size="small"
                variant="outlined"
                label={flagTitle(code)}
                data-testid={`item-row-flag-${code}`}
              />
            ))}
            {item.allergens?.length ? (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                label={t('item.allergensCount', { count: item.allergens.length })}
              />
            ) : null}
          </Stack>
        </Stack>

        <FormControlLabel
          label={<Typography variant="caption">{t('item.active')}</Typography>}
          labelPlacement="top"
          sx={{ m: 0 }}
          control={
            <Switch
              size="small"
              checked={item.is_active}
              onChange={(event) => onToggleActive(item, event.target.checked)}
              inputProps={
                { 'data-testid': `item-active-${item.code}` } as Record<string, string>
              }
            />
          }
        />
        <FormControlLabel
          label={<Typography variant="caption">{t('item.inStock')}</Typography>}
          labelPlacement="top"
          sx={{ m: 0 }}
          control={
            <Switch
              size="small"
              color="success"
              checked={item.in_stock}
              onChange={(event) => onToggleStock(item, event.target.checked)}
              inputProps={
                { 'data-testid': `item-stock-${item.code}` } as Record<string, string>
              }
            />
          }
        />

        <Tooltip title={t('common.edit')}>
          <IconButton
            size="small"
            onClick={() => onOpen(item)}
            data-testid={`item-edit-${item.code}`}
          >
            <EditOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('common.delete')}>
          <IconButton
            size="small"
            onClick={() => onDelete(item)}
            data-testid={`item-delete-${item.code}`}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Paper>
  );
}
