import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { QueryState } from '@/components/QueryState';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { SvgIconComponent } from '@mui/icons-material';
import AddIcon from '@mui/icons-material/Add';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import CloseIcon from '@mui/icons-material/Close';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import RoomServiceIcon from '@mui/icons-material/RoomService';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import WidgetsOutlinedIcon from '@mui/icons-material/WidgetsOutlined';

import { ApiError } from '@/api/client';
import { fetchQuickActions, putQuickActions } from '@/api/cms';
import { queryKeys } from '@/api/queryKeys';
import type { QuickActionOption } from '@/api/types';
import { EmptyState } from '@/components/EmptyState';
import { useToast } from '@/components/ToastProvider';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';
import { pickTranslated } from '@/utils/translated';

/** Server icon names (Material Symbols) → MUI icon components, presentation only. */
const ICON_BY_NAME: Record<string, SvgIconComponent> = {
  restaurant: RestaurantIcon,
  room_service: RoomServiceIcon,
  event_available: EventAvailableIcon,
  info: InfoOutlinedIcon,
  chat: ChatBubbleOutlineIcon,
};

function ActionIcon({ name }: { name: string }) {
  const Icon = ICON_BY_NAME[name] ?? WidgetsOutlinedIcon;
  return <Icon fontSize="small" />;
}

/**
 * Плитки экрана номера — вкладка «Управление номером» (партия 57).
 *
 * Было отдельным разделом «Быстрые действия» по адресу /cms/quick-actions:
 * эти плитки гость видит на экране номера, и искать их администратор шёл
 * туда же, где PIN и проверка элементов, а не в отдельный пункт. Старый
 * адрес уводит на вкладку (router.tsx). Заголовок раздела рисует хозяин —
 * здесь только пояснение и кнопка сохранения.
 */
export function QuickActionsPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: bootstrap } = useBootstrap();
  const languages = useContentLanguages(bootstrap);

  const query = useQuery({ queryKey: queryKeys.quickActions, queryFn: fetchQuickActions });

  const [selected, setSelected] = useState<string[]>([]);
  const [baseline, setBaseline] = useState<string>('');

  useEffect(() => {
    if (query.data) {
      setSelected(query.data.selected);
      setBaseline(JSON.stringify(query.data.selected));
    }
  }, [query.data]);

  const byCode = useMemo(() => {
    const map = new Map<string, QuickActionOption>();
    for (const action of query.data?.available ?? []) map.set(action.code, action);
    return map;
  }, [query.data]);

  const availableCodes = useMemo(
    () => (query.data?.available ?? []).map((a) => a.code).filter((code) => !selected.includes(code)),
    [query.data, selected],
  );

  const isDirty = baseline !== '' && JSON.stringify(selected) !== baseline;

  const label = (code: string) => {
    const action = byCode.get(code);
    return action
      ? pickTranslated(action.title, languages.displayLanguage, languages.defaultCode) || code
      : code;
  };

  const move = (index: number, delta: number) => {
    setSelected((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const add = (code: string) => setSelected((prev) => [...prev, code]);
  const remove = (code: string) => setSelected((prev) => prev.filter((c) => c !== code));

  const saveMutation = useMutation({
    mutationFn: () => putQuickActions(selected),
    onSuccess: (saved) => {
      setSelected(saved.selected);
      setBaseline(JSON.stringify(saved.selected));
      queryClient.setQueryData(queryKeys.quickActions, saved);
      toast.show(t('quickActions.saved'), 'success');
    },
    onError: (error) => {
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');
    },
  });

  if (query.isLoading) {
    return (
      <Box>
        <Skeleton variant="rounded" height={64} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={360} />
      </Box>
    );
  }

  if (query.isError || !query.data) {
    return (
      <QueryState query={query} what={t('state.what.quickActions')}>
        {() => null}
      </QueryState>
    );
  }

  return (
    <Box data-testid="cms-quick-actions">
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1, minWidth: 0 }}>
          {t('quickActions.subtitle')}
        </Typography>
        <Button
          variant="contained"
          disabled={!isDirty || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
          data-testid="cms-quick-actions-save"
          startIcon={
            saveMutation.isPending ? <CircularProgress size={16} color="inherit" /> : undefined
          }
        >
          {t('common.save')}
        </Button>
      </Stack>

      <Stack direction="row" spacing={3} alignItems="flex-start" flexWrap="wrap" useFlexGap>
        <Card variant="outlined" sx={{ flexGrow: 1, minWidth: 320, borderColor: 'divider' }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
              {t('quickActions.selectedSection')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('quickActions.selectedHint')}
            </Typography>
            <Divider sx={{ my: 1.5 }} />
            {selected.length === 0 ? (
              <EmptyState
                testId="cms-quick-actions-selected-empty"
                title={t('quickActions.noneSelected')}
                description={t('quickActions.noneSelectedHint')}
              />
            ) : (
              <Stack spacing={1}>
                {selected.map((code, index) => (
                  <Stack
                    key={code}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    data-testid={`cms-quick-action-${code}`}
                    sx={{ p: 1, borderRadius: 2, bgcolor: 'brand.surfaceMuted' }}
                  >
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <ActionIcon name={byCode.get(code)?.icon ?? ''} />
                    </ListItemIcon>
                    <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
                      {label(code)}
                    </Typography>
                    <IconButton
                      size="small"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      aria-label={t('quickActions.moveUp')}
                      data-testid={`cms-quick-action-up-${code}`}
                    >
                      <ArrowUpwardIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      disabled={index === selected.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label={t('quickActions.moveDown')}
                      data-testid={`cms-quick-action-down-${code}`}
                    >
                      <ArrowDownwardIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => remove(code)}
                      aria-label={t('quickActions.remove')}
                      data-testid={`cms-quick-action-remove-${code}`}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ width: 340, flexShrink: 0, borderColor: 'divider' }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
              {t('quickActions.availableSection')}
            </Typography>
            <Divider sx={{ my: 1.5 }} />
            {availableCodes.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                {t('quickActions.allSelected')}
              </Typography>
            ) : (
              <Stack spacing={1}>
                {availableCodes.map((code) => (
                  <Stack
                    key={code}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={{ p: 1, borderRadius: 2, bgcolor: 'brand.surfaceMuted' }}
                  >
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <ActionIcon name={byCode.get(code)?.icon ?? ''} />
                    </ListItemIcon>
                    <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
                      {label(code)}
                    </Typography>
                    <IconButton
                      size="small"
                      onClick={() => add(code)}
                      aria-label={t('quickActions.add')}
                      data-testid={`cms-quick-action-add-${code}`}
                    >
                      <AddIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}
