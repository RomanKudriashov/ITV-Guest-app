import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import MoreVertIcon from '@mui/icons-material/MoreVert';
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

import type { Category } from '@/api/types';
import { pickTranslated } from '@/utils/translated';

export interface CategoryTreeProps {
  tree: Category[];
  selectedId: string | null;
  onSelect: (category: Category) => void;
  onToggle: (category: Category, isActive: boolean) => void;
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
  /** Fired with the reordered sibling list of one level. */
  onReorder: (parentId: string | null, orderedIds: string[]) => void;
  displayLanguage: string;
  fallbackLanguage: string;
}

/**
 * Category tree with drag-and-drop sorting **within one level**. Moving a node
 * to another parent is done from the category editor ("parent" select), which
 * keeps the drag interaction unambiguous.
 */
export function CategoryTree(props: CategoryTreeProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const source = findNode(props.tree, String(active.id));
    const target = findNode(props.tree, String(over.id));
    // Cross-level drags are ignored on purpose — re-parenting lives in the editor.
    if (!source || !target || source.parentId !== target.parentId) return;

    const ids = source.siblings.map((node) => node.id);
    const from = ids.indexOf(source.node.id);
    const to = ids.indexOf(target.node.id);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(to, 0, next.splice(from, 1)[0]);
    props.onReorder(source.parentId, next);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <Box data-testid="menu-category-list">
        <Level {...props} nodes={props.tree} depth={0} />
      </Box>
    </DndContext>
  );
}

interface NodeLookup {
  node: Category;
  parentId: string | null;
  siblings: Category[];
}

function findNode(
  nodes: Category[],
  id: string,
  parentId: string | null = null,
): NodeLookup | null {
  for (const node of nodes) {
    if (node.id === id) return { node, parentId, siblings: nodes };
    if (node.children?.length) {
      const found = findNode(node.children, id, node.id);
      if (found) return found;
    }
  }
  return null;
}

function Level({
  nodes,
  depth,
  ...props
}: CategoryTreeProps & { nodes: Category[]; depth: number }) {
  return (
    <SortableContext items={nodes.map((node) => node.id)} strategy={verticalListSortingStrategy}>
      <Stack spacing={0.25}>
        {nodes.map((node) => (
          <Box key={node.id}>
            <CategoryRow {...props} category={node} depth={depth} />
            {node.children?.length ? (
              <Level {...props} nodes={node.children} depth={depth + 1} />
            ) : null}
          </Box>
        ))}
      </Stack>
    </SortableContext>
  );
}

function CategoryRow({
  category,
  depth,
  selectedId,
  onSelect,
  onToggle,
  onEdit,
  onDelete,
  displayLanguage,
  fallbackLanguage,
}: CategoryTreeProps & { category: Category; depth: number }) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
  });

  const selected = selectedId === category.id;
  const title =
    pickTranslated(category.title, displayLanguage, fallbackLanguage) || category.code;

  return (
    <Stack
      ref={setNodeRef}
      direction="row"
      alignItems="center"
      spacing={0.5}
      data-testid={`category-item-${category.code}`}
      onClick={() => onSelect(category)}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{
        pl: 1 + depth * 2,
        pr: 1,
        py: 0.75,
        borderRadius: 2,
        cursor: 'pointer',
        opacity: isDragging ? 0.5 : category.is_active ? 1 : 0.55,
        bgcolor: selected ? 'brand.surfaceSelected' : 'transparent',
        '&:hover': { bgcolor: selected ? 'brand.surfaceSelected' : 'brand.surfaceHover' },
      }}
    >
      <Box
        {...attributes}
        {...listeners}
        onClick={(event) => event.stopPropagation()}
        sx={{ display: 'flex', color: 'text.secondary', cursor: 'grab' }}
        aria-label={t('common.reorder')}
        data-testid={`category-drag-${category.code}`}
      >
        <DragIndicatorIcon fontSize="small" />
      </Box>

      <Typography
        variant="body2"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontWeight: selected ? 'fontWeightMedium' : 'fontWeightRegular',
        }}
      >
        {title}
      </Typography>

      <Chip
        size="small"
        variant="outlined"
        label={category.items_count ?? 0}
        data-testid={`category-count-${category.code}`}
      />

      <Switch
        size="small"
        checked={category.is_active}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onToggle(category, event.target.checked)}
        inputProps={
          { 'data-testid': `category-toggle-${category.code}` } as Record<string, string>
        }
      />

      <IconButton
        size="small"
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(event.currentTarget);
        }}
        data-testid={`category-menu-${category.code}`}
        aria-label={t('common.actions')}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>

      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        onClick={(event) => event.stopPropagation()}
      >
        <MenuItem
          onClick={() => {
            setAnchor(null);
            onEdit(category);
          }}
          data-testid={`category-edit-${category.code}`}
        >
          {t('common.edit')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            onDelete(category);
          }}
          data-testid={`category-delete-${category.code}`}
        >
          {t('common.delete')}
        </MenuItem>
      </Menu>
    </Stack>
  );
}
