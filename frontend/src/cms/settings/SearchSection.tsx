import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';

import { QueryState } from '@/components/QueryState';

import { ApiError } from '@/api/client';
import { fetchSearchSettings, putSearchSettings, type SearchSettings } from '@/api/cms';
import { queryKeys } from '@/api/queryKeys';
import { useToast } from '@/components/ToastProvider';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';
import { pickTranslated } from '@/utils/translated';

/**
 * Настройки поиска: что участвует в выдаче, что из неё исключено и какие
 * подсказки видит гость в пустом поле.
 *
 * ПОДСКАЗКА — ПЕРЕВОД, А НЕ СТРОКА. «Завтрак» по-арабски пишет отель, а не мы;
 * поле заводится на каждый язык контента, как и всё остальное в CMS.
 *
 * ИСКЛЮЧИТЬ МОЖНО ТОЛЬКО ГОСТЕВОЕ заведение: прятать от поиска то, чего гость
 * и так не видит, незачем — список приходит с сервера уже отфильтрованным.
 */
export function SearchSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: bootstrap } = useBootstrap();
  const languages = useContentLanguages(bootstrap);

  const query = useQuery({ queryKey: queryKeys.searchSettings, queryFn: fetchSearchSettings });
  const [draft, setDraft] = useState<Omit<SearchSettings, 'available_services'> | null>(null);

  useEffect(() => {
    if (!query.data) return;
    const { available_services: _services, ...rest } = query.data;
    setDraft(rest);
  }, [query.data]);

  const save = useMutation({
    mutationFn: () => putSearchSettings(draft!),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.searchSettings, data);
      toast.show(t('cms.search.saved'), 'success');
    },
    onError: (error) =>
      toast.show(error instanceof ApiError ? error.message : t('cms.search.saveFailed'), 'error'),
  });

  if (query.isPending || !draft) return <Skeleton variant="rounded" height={260} />;
  if (query.isError)
    return (
      <QueryState query={query} what={t('state.what.search')}>
        {() => null}
      </QueryState>
    );

  const toggle = (key: 'services' | 'items' | 'info') => setDraft({ ...draft, [key]: !draft[key] });

  const toggleService = (code: string) =>
    setDraft({
      ...draft,
      excluded_services: draft.excluded_services.includes(code)
        ? draft.excluded_services.filter((item) => item !== code)
        : [...draft.excluded_services, code],
    });

  return (
    <Card data-testid="cms-search-settings">
      <CardContent>
        <Stack spacing={2}>
          <Stack spacing={0.5}>
            <Typography variant="h6">{t('cms.search.title')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t('cms.search.hint')}
            </Typography>
          </Stack>

          <Stack>
            {(['services', 'items', 'info'] as const).map((layer) => (
              <FormControlLabel
                key={layer}
                control={
                  <Switch
                    checked={draft[layer]}
                    onChange={() => toggle(layer)}
                    data-testid={`cms-search-layer-${layer}`}
                  />
                }
                label={t(`cms.search.${layer}`)}
              />
            ))}
          </Stack>

          <Stack spacing={1}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t('cms.search.excluded')}
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              {query.data.available_services.map((service) => {
                const off = draft.excluded_services.includes(service.code);
                return (
                  <Chip
                    key={service.code}
                    label={
                      pickTranslated(service.title, languages.displayLanguage, languages.defaultCode) ||
                      service.code
                    }
                    color={off ? 'default' : 'primary'}
                    variant={off ? 'outlined' : 'filled'}
                    onClick={() => toggleService(service.code)}
                    data-testid={`cms-search-service-${service.code}`}
                  />
                );
              })}
            </Stack>
          </Stack>

          <Stack spacing={1}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t('cms.search.suggestions')}
            </Typography>
            {draft.suggestions.map((entry, index) => (
              <Stack key={index} direction="row" spacing={1} alignItems="center">
                {languages.codes.map((language) => (
                  <TextField
                    key={language}
                    size="small"
                    label={language.toUpperCase()}
                    value={entry[language] ?? ''}
                    onChange={(event) => {
                      const next = [...draft.suggestions];
                      next[index] = { ...next[index], [language]: event.target.value };
                      setDraft({ ...draft, suggestions: next });
                    }}
                    inputProps={{ 'data-testid': `cms-search-suggestion-${index}-${language}` }}
                  />
                ))}
                <IconButton
                  size="small"
                  aria-label={t('common.delete')}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      suggestions: draft.suggestions.filter((_, i) => i !== index),
                    })
                  }
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
            <Stack direction="row">
              <Button
                size="small"
                onClick={() => setDraft({ ...draft, suggestions: [...draft.suggestions, {}] })}
                data-testid="cms-search-suggestion-add"
              >
                {t('cms.search.addSuggestion')}
              </Button>
            </Stack>
          </Stack>

          <Stack direction="row" justifyContent="flex-end">
            <Button
              variant="contained"
              onClick={() => save.mutate()}
              disabled={save.isPending}
              data-testid="cms-search-save"
            >
              {t('common.save')}
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
