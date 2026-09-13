import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { QueryState } from '@/components/QueryState';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';

import {
  fetchAllergenPage,
  fetchMarkerPage,
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
import { OFFERING_NOUNS, type OfferingNoun } from '@/offerings/nouns';
import type { DictEntry } from '@/api/types';
import { useToast } from '@/components/ToastProvider';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';
import { pickTranslated } from '@/utils/translated';

type Kind = 'allergens' | 'markers';

/**
 * Какие слова каталога справочник вообще допускает — близнец `KIND_SCOPE` из
 * `apps/catalog/facet_scope.py`. Нужен экрану, чтобы не предлагать настройку,
 * которой нет: «страница» у аллергена была бы обещанием, которое сервер не
 * исполнит. Расхождение ловит сторож близнецов.
 */
const KIND_WORDS: Record<Kind, OfferingNoun[]> = {
  allergens: ['dish', 'goods'],
  markers: ['dish', 'goods'],
};

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
        <Typography variant="h5" data-testid="cms-page-title" sx={{ fontWeight: 700 }}>
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

/**
 * Один справочник: список, заведение записи, применимость по типам.
 *
 * ДВА СЛОЯ РАЗВЕДЕНЫ ВИЗУАЛЬНО, а не только замком у строки. Наши записи
 * обновляем мы, отельные заводит отель — и это разные обязательства, а не
 * разный признак. Пока они лежали вперемешку, «удалить нельзя» читалось как
 * поломка экрана, а не как граница ответственности.
 */
function DictSection({ kind }: { kind: Kind }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: bootstrap } = useBootstrap();
  const languages = useContentLanguages(bootstrap);
  const api = API[kind];

  /*
    ФИЛЬТР ПО СЛОВУ — ВОПРОС «ЧТО УВИДИТ СПА», заданный экрану напрямую.

    Без него применимость настраивается вслепую: человек правит переключатели
    и идёт проверять результат в карточку позиции другого заведения. Фильтр
    отвечает здесь же и тем же правилом, что и карточка, — отбор считает
    сервер.
  */
  const [noun, setNoun] = useState<'' | OfferingNoun>('');
  const baseKey = kind === 'allergens' ? queryKeys.allergens : queryKeys.markers;
  const key = [...baseKey, noun || 'all'];

  const query = useQuery({
    queryKey: key,
    queryFn: () => (kind === 'allergens' ? fetchAllergenPage : fetchMarkerPage)(noun || undefined),
  });
  const [draftRu, setDraftRu] = useState('');
  const addRef = useRef<HTMLInputElement | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: baseKey });
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
  const scopeMut = useMutation({
    mutationFn: ({ entry, next }: { entry: DictEntry; next: OfferingNoun[] }) =>
      api.update(entry.id, { applies_to: next }),
    onSuccess: invalidate,
    onError,
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.del(id),
    onSuccess: invalidate,
    onError: () => toast.show(t('dictionaries.systemProtected'), 'error'),
  });

  const label = (entry: DictEntry) =>
    pickTranslated(entry.title, languages.displayLanguage, languages.defaultCode) || entry.code;

  const nounTitle = (value: OfferingNoun) => t(`catalog.${value}.plural`);

  /** Сузить или вернуть слово: пустой список означает «как у справочника». */
  const toggleScope = (entry: DictEntry, word: OfferingNoun) => {
    const current = entry.scope ?? [];
    const next = current.includes(word)
      ? current.filter((value) => value !== word)
      : [...current, word];
    // Сняли последнее слово — это «как у справочника», а не «нигде»: пустой
    // список сервер и читает как отсутствие сужения. Иначе человек, кликнувший
    // дважды, остался бы с записью, невидимой везде, и без способа это понять.
    scopeMut.mutate({ entry, next });
  };

  const entries = query.data?.items ?? [];
  const applicable = query.data?.kind_applies ?? true;
  const system = entries.filter((entry) => entry.is_system);
  const own = entries.filter((entry) => !entry.is_system);

  const row = (entry: DictEntry) => (
    <Stack
      key={entry.id}
      spacing={0.5}
      data-testid={`cms-dict-entry-${entry.code}`}
      sx={{ opacity: entry.is_active ? 1 : 0.55 }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Typography sx={{ flexGrow: 1 }}>{label(entry)}</Typography>
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

      {/*
        ПРИМЕНИМОСТЬ ЗАПИСИ — только внутри области справочника. Показываем
        ровно те слова, которые справочник вообще допускает: предлагать
        «страницу» у аллергена значило бы обещать настройку, которой нет.
      */}
      <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
          {t('dictionaries.appliesTo')}:
        </Typography>
        {KIND_WORDS[kind].map((word) => {
          const on = (entry.scope ?? []).includes(word);
          return (
            <Chip
              key={word}
              size="small"
              label={nounTitle(word)}
              variant={on ? 'filled' : 'outlined'}
              color={on ? 'primary' : 'default'}
              onClick={() => toggleScope(entry, word)}
              data-testid={`cms-dict-scope-${entry.code}-${word}`}
            />
          );
        })}
      </Stack>
    </Stack>
  );

  return (
    <Card variant="outlined" data-testid={`cms-dict-${kind}`}>
      <CardContent>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>
            {t(`dictionaries.${kind}`)}
          </Typography>
          <TextField
            select
            size="small"
            label={t('dictionaries.scopeLabel')}
            value={noun}
            onChange={(event) => setNoun(event.target.value as '' | OfferingNoun)}
            sx={{ minWidth: 180 }}
            SelectProps={{
              SelectDisplayProps: { 'data-testid': `cms-dict-filter-${kind}` } as never,
            }}
          >
            <MenuItem value="">{t('dictionaries.scopeAll')}</MenuItem>
            {OFFERING_NOUNS.map((word) => (
              <MenuItem key={word} value={word}>
                {nounTitle(word)}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          {t('dictionaries.narrowHint')}
        </Typography>

        {/*
          `query.data ?? []` показывал ПУСТОЙ справочник, когда запрос упал:
          ни аллергенов, ни маркеров, ни слова о том, что их не принесли.
          Оператор видел «у отеля ничего нет» вместо «не загрузилось».
        */}
        <QueryState query={query} what={t('state.what.dictionaries')}>
          {() =>
            !applicable ? (
              /*
                ПУСТОТА ОБЪЯСНЯЕТ СЕБЯ, И ОБЪЯСНЕНИЯ ДВА РАЗНЫХ. Здесь —
                «таких не бывает»: справочник неприменим этому слову по своей
                природе, и заводить нечего. Предлагать кнопку «Завести» было бы
                враньём: заведённая запись всё равно не появилась бы в карточке.
              */
              <Typography variant="body2" color="text.secondary" data-testid={`cms-dict-na-${kind}`}>
                {t('dictionaries.notApplicable', { what: noun ? nounTitle(noun) : '' })}
              </Typography>
            ) : entries.length === 0 ? (
              <Stack spacing={1} alignItems="flex-start" data-testid={`cms-dict-empty-${kind}`}>
                <Typography variant="body2" color="text.secondary">
                  {noun
                    ? t('dictionaries.emptyForType', { what: nounTitle(noun) })
                    : t('dictionaries.empty')}
                </Typography>
                <Button size="small" onClick={() => addRef.current?.focus()}>
                  {t('dictionaries.emptyForTypeAction')}
                </Button>
              </Stack>
            ) : (
              <Stack spacing={2}>
                {system.length ? (
                  <Stack spacing={1}>
                    <Typography variant="caption" color="text.secondary">
                      {t('dictionaries.systemGroup')}
                    </Typography>
                    <Stack spacing={1.5}>{system.map(row)}</Stack>
                  </Stack>
                ) : null}
                {own.length ? (
                  <Stack spacing={1}>
                    <Typography variant="caption" color="text.secondary">
                      {t('dictionaries.hotelGroup')}
                    </Typography>
                    <Stack spacing={1.5}>{own.map(row)}</Stack>
                  </Stack>
                ) : null}
              </Stack>
            )
          }
        </QueryState>

        <Stack direction="row" spacing={1} sx={{ mt: 2 }} alignItems="center">
          <TextField
            size="small"
            inputRef={addRef}
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
