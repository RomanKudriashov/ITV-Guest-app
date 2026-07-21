import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import InputAdornment from '@mui/material/InputAdornment';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import CreateNewFolderOutlinedIcon from '@mui/icons-material/CreateNewFolderOutlined';
import SearchIcon from '@mui/icons-material/Search';

import { ApiError } from '@/api/client';
import {
  deleteCategory,
  deleteItem,
  fetchCategories,
  fetchItems,
  reorderCategories,
  reorderItems,
  setItemStock,
  toggleCategory,
  toggleItem,
} from '@/api/cms';
import { queryKeys } from '@/api/queryKeys';
import type { Category, CategoryReorderEntry, Item } from '@/api/types';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { useToast } from '@/components/ToastProvider';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';
import { findCategory, flattenCategories, replaceSiblings } from '@/utils/categories';
import { pickTranslated } from '@/utils/translated';
import { CategoryTree } from './CategoryTree';
import { ItemList } from './ItemList';

export function MenuPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: bootstrap } = useBootstrap();
  const languages = useContentLanguages(bootstrap);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null);
  const [cascade, setCascade] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<Item | null>(null);

  const categoriesQuery = useQuery({
    queryKey: queryKeys.categories,
    queryFn: fetchCategories,
  });

  const tree = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);

  // Select the first category once the tree arrives.
  useEffect(() => {
    if (selectedId && findCategory(tree, selectedId)) return;
    const flat = flattenCategories(tree);
    setSelectedId(flat.length ? flat[0].category.id : null);
  }, [tree, selectedId]);

  const selectedCategory = selectedId ? findCategory(tree, selectedId) : null;

  const itemsQuery = useQuery({
    queryKey: queryKeys.items(selectedId ?? undefined, search),
    queryFn: () => fetchItems({ category_id: selectedId ?? undefined, search: search || undefined }),
    enabled: Boolean(selectedId),
  });

  const showError = (error: unknown, fallbackKey = 'errors.generic') => {
    const message = error instanceof ApiError ? error.detail : t(fallbackKey);
    toast.show(message, 'error');
  };

  /* ── Category mutations ─────────────────────────────────────────────── */

  const toggleCategoryMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      toggleCategory(id, isActive),
    onMutate: async ({ id, isActive }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.categories });
      const previous = queryClient.getQueryData<Category[]>(queryKeys.categories);
      queryClient.setQueryData<Category[]>(queryKeys.categories, (current) =>
        current ? patchCategory(current, id, { is_active: isActive }) : current,
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.categories, context.previous);
      showError(error);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.categories }),
  });

  const reorderCategoriesMutation = useMutation({
    mutationFn: (entries: CategoryReorderEntry[]) => reorderCategories(entries),
    onError: (error, _vars, context: { previous?: Category[] } | undefined) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.categories, context.previous);
      showError(error, 'errors.reorderFailed');
    },
    onSuccess: (updated) => {
      if (Array.isArray(updated) && updated.length) {
        queryClient.setQueryData(queryKeys.categories, updated);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.categories }),
  });

  const handleCategoryReorder = (parentId: string | null, orderedIds: string[]) => {
    const previous = queryClient.getQueryData<Category[]>(queryKeys.categories);
    if (!previous) return;

    const siblings = parentId
      ? (findCategory(previous, parentId)?.children ?? [])
      : previous;
    const byId = new Map(siblings.map((node) => [node.id, node]));
    const nextSiblings = orderedIds
      .map((id, index) => {
        const node = byId.get(id);
        return node ? { ...node, sort_order: index } : null;
      })
      .filter((node): node is Category => node !== null);

    // Optimistic tree, rolled back by onError.
    queryClient.setQueryData<Category[]>(
      queryKeys.categories,
      replaceSiblings(previous, parentId, nextSiblings),
    );

    const entries: CategoryReorderEntry[] = nextSiblings.map((node, index) => ({
      id: node.id,
      parent_id: parentId,
      sort_order: index,
    }));

    reorderCategoriesMutation.mutate(entries, {
      onError: () => queryClient.setQueryData(queryKeys.categories, previous),
    });
  };

  const deleteCategoryMutation = useMutation({
    mutationFn: ({ id, withItems }: { id: string; withItems: boolean }) =>
      deleteCategory(id, withItems),
    onSuccess: () => {
      toast.show(t('category.deleted'), 'success');
      setPendingDelete(null);
      setCascade(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'category_not_empty') {
        // Ask again, this time offering the cascade checkbox.
        setCascade(false);
        toast.show(t('category.notEmpty'), 'warning');
        return;
      }
      showError(error);
    },
  });

  /* ── Item mutations ─────────────────────────────────────────────────── */

  const itemsKey = queryKeys.items(selectedId ?? undefined, search);

  const patchItemsCache = (id: string, patch: Partial<Item>) => {
    queryClient.setQueryData<Item[]>(itemsKey, (current) =>
      current?.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  };

  const toggleItemMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => toggleItem(id, isActive),
    onMutate: async ({ id, isActive }) => {
      await queryClient.cancelQueries({ queryKey: itemsKey });
      const previous = queryClient.getQueryData<Item[]>(itemsKey);
      patchItemsCache(id, { is_active: isActive });
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(itemsKey, context.previous);
      showError(error);
    },
  });

  const stockMutation = useMutation({
    mutationFn: ({ id, inStock }: { id: string; inStock: boolean }) => setItemStock(id, inStock),
    onMutate: async ({ id, inStock }) => {
      await queryClient.cancelQueries({ queryKey: itemsKey });
      const previous = queryClient.getQueryData<Item[]>(itemsKey);
      patchItemsCache(id, { in_stock: inStock });
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(itemsKey, context.previous);
      showError(error);
    },
  });

  const reorderItemsMutation = useMutation({
    mutationFn: ({ categoryId, ids }: { categoryId: string; ids: string[] }) =>
      reorderItems(
        categoryId,
        ids.map((id, index) => ({ id, sort_order: index })),
      ),
    onMutate: async ({ ids }) => {
      await queryClient.cancelQueries({ queryKey: itemsKey });
      const previous = queryClient.getQueryData<Item[]>(itemsKey);
      if (previous) {
        const byId = new Map(previous.map((item) => [item.id, item]));
        const next = ids
          .map((id, index) => {
            const item = byId.get(id);
            return item ? { ...item, sort_order: index } : null;
          })
          .filter((item): item is Item => item !== null);
        queryClient.setQueryData(itemsKey, next);
      }
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(itemsKey, context.previous);
      showError(error, 'errors.reorderFailed');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: itemsKey }),
  });

  const deleteItemMutation = useMutation({
    mutationFn: (id: string) => deleteItem(id),
    onSuccess: () => {
      toast.show(t('item.deleted'), 'success');
      setItemToDelete(null);
      void queryClient.invalidateQueries({ queryKey: itemsKey });
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
    },
    onError: (error) => showError(error),
  });

  /* ── Render ─────────────────────────────────────────────────────────── */

  const items = itemsQuery.data ?? [];
  const selectedTitle = selectedCategory
    ? pickTranslated(selectedCategory.title, languages.displayLanguage, languages.defaultCode) ||
      selectedCategory.code
    : '';

  return (
    <Box sx={{ p: 3, display: 'flex', gap: 3, alignItems: 'flex-start' }}>
      {/* Categories */}
      <Card variant="outlined" sx={{ width: 360, flexShrink: 0, borderColor: 'divider' }}>
        <CardContent sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="h6">{t('menu.categories')}</Typography>
            <Button
              size="small"
              startIcon={<CreateNewFolderOutlinedIcon />}
              onClick={() => navigate('/cms/menu/categories/new')}
              data-testid="add-category-button"
            >
              {t('menu.addCategory')}
            </Button>
          </Stack>
          <Divider sx={{ mb: 1 }} />

          {categoriesQuery.isLoading ? (
            <Stack spacing={1} data-testid="category-skeleton">
              {[0, 1, 2, 3, 4].map((key) => (
                <Skeleton key={key} variant="rounded" height={36} />
              ))}
            </Stack>
          ) : categoriesQuery.isError ? (
            <Alert severity="error">{t('errors.loadCategories')}</Alert>
          ) : tree.length === 0 ? (
            <EmptyState
              testId="categories-empty"
              title={t('menu.noCategories')}
              description={t('menu.noCategoriesHint')}
              action={
                <Button
                  variant="contained"
                  size="small"
                  onClick={() => navigate('/cms/menu/categories/new')}
                >
                  {t('menu.addCategory')}
                </Button>
              }
            />
          ) : (
            <CategoryTree
              tree={tree}
              selectedId={selectedId}
              displayLanguage={languages.displayLanguage}
              fallbackLanguage={languages.defaultCode}
              onSelect={(category) => setSelectedId(category.id)}
              onToggle={(category, isActive) =>
                toggleCategoryMutation.mutate({ id: category.id, isActive })
              }
              onEdit={(category) => navigate(`/cms/menu/categories/${category.id}`)}
              onDelete={(category) => {
                setPendingDelete(category);
                setCascade(false);
              }}
              onReorder={handleCategoryReorder}
            />
          )}
        </CardContent>
      </Card>

      {/* Items */}
      <Card variant="outlined" sx={{ flexGrow: 1, minWidth: 0, borderColor: 'divider' }}>
        <CardContent sx={{ p: 2 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={2}
            sx={{ mb: 1 }}
          >
            <Stack sx={{ minWidth: 0 }}>
              <Typography variant="h6" noWrap>
                {selectedTitle || t('menu.items')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('menu.itemsCount', { count: items.length })}
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                size="small"
                value={search}
                placeholder={t('menu.searchPlaceholder')}
                onChange={(event) => setSearch(event.target.value)}
                inputProps={{ 'data-testid': 'item-search' }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                }}
              />
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                disabled={!selectedId}
                data-testid="add-item-button"
                onClick={() => navigate(`/cms/menu/items/new?category_id=${selectedId ?? ''}`)}
              >
                {t('menu.addItem')}
              </Button>
            </Stack>
          </Stack>
          <Divider sx={{ mb: 2 }} />

          {!selectedId ? (
            <EmptyState title={t('menu.selectCategory')} testId="items-no-category" />
          ) : itemsQuery.isLoading ? (
            <Stack spacing={1} data-testid="item-skeleton">
              {[0, 1, 2, 3].map((key) => (
                <Skeleton key={key} variant="rounded" height={80} />
              ))}
            </Stack>
          ) : itemsQuery.isError ? (
            <Alert severity="error">{t('errors.loadItems')}</Alert>
          ) : items.length === 0 ? (
            <EmptyState
              testId="items-empty"
              title={t('menu.noItems')}
              description={t('menu.noItemsHint')}
              action={
                <Button
                  variant="contained"
                  size="small"
                  onClick={() => navigate(`/cms/menu/items/new?category_id=${selectedId}`)}
                >
                  {t('menu.addItem')}
                </Button>
              }
            />
          ) : bootstrap ? (
            <ItemList
              items={items}
              bootstrap={bootstrap}
              displayLanguage={languages.displayLanguage}
              fallbackLanguage={languages.defaultCode}
              onOpen={(item) => navigate(`/cms/menu/items/${item.id}`)}
              onDelete={(item) => setItemToDelete(item)}
              onToggleActive={(item, isActive) =>
                toggleItemMutation.mutate({ id: item.id, isActive })
              }
              onToggleStock={(item, inStock) => stockMutation.mutate({ id: item.id, inStock })}
              onReorder={(ids) =>
                selectedId && reorderItemsMutation.mutate({ categoryId: selectedId, ids })
              }
            />
          ) : null}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        testId="category-delete-dialog"
        destructive
        busy={deleteCategoryMutation.isPending}
        title={t('category.deleteTitle')}
        description={t('category.deleteBody', {
          name: pendingDelete
            ? pickTranslated(pendingDelete.title, languages.displayLanguage, languages.defaultCode)
            : '',
          count: pendingDelete?.items_count ?? 0,
        })}
        confirmLabel={t('common.delete')}
        onClose={() => setPendingDelete(null)}
        onConfirm={() =>
          pendingDelete &&
          deleteCategoryMutation.mutate({ id: pendingDelete.id, withItems: cascade })
        }
      >
        <FormControlLabel
          control={
            <Checkbox
              checked={cascade}
              onChange={(event) => setCascade(event.target.checked)}
              inputProps={{ 'data-testid': 'category-delete-cascade' } as Record<string, string>}
            />
          }
          label={t('category.deleteCascade')}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(itemToDelete)}
        testId="item-delete-dialog"
        destructive
        busy={deleteItemMutation.isPending}
        title={t('item.deleteTitle')}
        description={t('item.deleteBody', {
          name: itemToDelete
            ? pickTranslated(itemToDelete.title, languages.displayLanguage, languages.defaultCode)
            : '',
        })}
        confirmLabel={t('common.delete')}
        onClose={() => setItemToDelete(null)}
        onConfirm={() => itemToDelete && deleteItemMutation.mutate(itemToDelete.id)}
      />
    </Box>
  );
}

/** Immutable patch of one node anywhere in the tree. */
function patchCategory(
  tree: Category[],
  id: string,
  patch: Partial<Category>,
): Category[] {
  return tree.map((category) => {
    if (category.id === id) return { ...category, ...patch };
    if (category.children?.length) {
      return { ...category, children: patchCategory(category.children, id, patch) };
    }
    return category;
  });
}
