import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';

import {
  createAllergen,
  createMarker,
  deleteAllergen,
  deleteMarker,
  fetchAllergens,
  fetchMarkers,
  updateAllergen,
  updateMarker,
} from '@/api/cms';
import { queryKeys } from '@/api/queryKeys';
import type { DictEntry } from '@/api/types';
import { useToast } from '@/components/ToastProvider';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';
import { pickTranslated } from '@/utils/translated';

type Kind = 'allergens' | 'markers';

const API = {
  allergens: { fetch: fetchAllergens, create: createAllergen, update: updateAllergen, del: deleteAllergen },
  markers: { fetch: fetchMarkers, create: createMarker, update: updateMarker, del: deleteMarker },
} as const;

/**
 * CMS dictionaries for item-card facets: allergens («contains») and dietary
 * markers («suitable»). The 14 system allergens / markers are seeded and can be
 * deactivated but not deleted; a hotel adds its own. Populating goes mostly
 * through the API — this screen sits on top of it.
 */
export function DictionariesPage() {
  const { t } = useTranslation();
  return (
    <Box sx={{ maxWidth: 820, mx: 'auto', p: { xs: 2, md: 3 } }} data-testid="cms-dictionaries">
      <Stack spacing={0.5} sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          {t('dictionaries.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('dictionaries.subtitle')}
        </Typography>
      </Stack>
      <Stack spacing={3}>
        <DictSection kind="allergens" />
        <DictSection kind="markers" />
      </Stack>
    </Box>
  );
}

function DictSection({ kind }: { kind: Kind }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: bootstrap } = useBootstrap();
  const languages = useContentLanguages(bootstrap);
  const key = kind === 'allergens' ? queryKeys.allergens : queryKeys.markers;
  const api = API[kind];

  const query = useQuery({ queryKey: key, queryFn: api.fetch });
  const [draftRu, setDraftRu] = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const onError = () => toast.show(t('errors.generic'), 'error');

  const createMut = useMutation({
    mutationFn: () => api.create({ title: { [languages.defaultCode]: draftRu.trim() } }),
    onSuccess: () => {
      setDraftRu('');
      invalidate();
    },
    onError,
  });
  const toggleMut = useMutation({
    mutationFn: (entry: DictEntry) => api.update(entry.id, { is_active: !entry.is_active }),
    onSuccess: invalidate,
    onError,
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.del(id),
    onSuccess: invalidate,
    onError: () => toast.show(t('dictionaries.systemProtected'), 'error'),
  });

  const entries = query.data ?? [];

  return (
    <Card variant="outlined" data-testid={`cms-dict-${kind}`}>
      <CardContent>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>
          {t(`dictionaries.${kind}`)}
        </Typography>

        <Stack spacing={1}>
          {entries.map((entry) => (
            <Stack
              key={entry.id}
              direction="row"
              spacing={1.5}
              alignItems="center"
              data-testid={`cms-dict-entry-${entry.code}`}
              sx={{ opacity: entry.is_active ? 1 : 0.55 }}
            >
              <Typography sx={{ flexGrow: 1 }}>
                {pickTranslated(entry.title, languages.displayLanguage, languages.defaultCode) || entry.code}
              </Typography>
              {entry.is_system ? (
                <Chip size="small" icon={<LockOutlinedIcon />} label={t('dictionaries.system')} variant="outlined" />
              ) : null}
              <Switch
                size="small"
                checked={entry.is_active}
                onChange={() => toggleMut.mutate(entry)}
                inputProps={{ 'aria-label': t('common.on'), 'data-testid': `cms-dict-toggle-${entry.code}` } as never}
              />
              <IconButton
                size="small"
                disabled={entry.is_system}
                onClick={() => deleteMut.mutate(entry.id)}
                aria-label={t('common.delete')}
                data-testid={`cms-dict-delete-${entry.code}`}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
        </Stack>

        <Stack direction="row" spacing={1} sx={{ mt: 2 }} alignItems="center">
          <TextField
            size="small"
            placeholder={t('dictionaries.addPlaceholder')}
            value={draftRu}
            onChange={(e) => setDraftRu(e.target.value)}
            inputProps={{ 'data-testid': `cms-dict-new-${kind}` }}
            sx={{ flexGrow: 1 }}
          />
          <Button
            startIcon={<AddIcon />}
            disabled={!draftRu.trim() || createMut.isPending}
            onClick={() => createMut.mutate()}
            data-testid={`cms-dict-add-${kind}`}
          >
            {t('common.add')}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
