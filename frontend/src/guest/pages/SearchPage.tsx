import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTranslation } from 'react-i18next';

import { IconClose, IconForward, IconSearch } from '@/icons';
import { KitImage } from '@/kit';
import { guestApi } from '../api/client';
import { guestKeys } from '../api/queryKeys';
import type { GuestSearchResult, GuestSearchRow } from '../api/types';
import { useGuestLanguage } from '../hooks/useGuestQueries';
import { STICKY, useStickyLayer } from '../layout/stickyStack';
import { useGuestSession } from '../session/GuestSessionProvider';
import { storefrontTokens, surfaceRadius } from '../storefrontTokens';

/**
 * Глобальный поиск: заведения, позиции меню и информационные страницы.
 *
 * ЗАПРОС УХОДИТ, КОГДА ГОСТЬ ПЕРЕСТАЛ ПЕЧАТАТЬ, а не на каждый символ. «Стейк»
 * — это пять запросов вместо одного, и четыре из них уже неактуальны в момент
 * ответа. Пауза короткая (250 мс): длиннее — и поиск кажется задумчивым.
 *
 * НЕДАВНИЕ ЗАПРОСЫ ЖИВУТ НА УСТРОЙСТВЕ. На сервер они не уезжают: это история
 * человека в номере, а не данные отеля, и хранить её у себя мы не просили.
 *
 * СВОЕГО ЛИПКОГО СЛОЯ ЗДЕСЬ НЕТ. Поле поиска встроено в ОБЩИЙ стек липких
 * слоёв витрины (`stickyStack`) — тот же, которым живут строка категорий и
 * плита номера. Отдельный слой означал бы четвёртое место, где складывают
 * отступы, и перекрытия вернулись бы на первом же экране с вырезом.
 */

/** Пауза после последнего нажатия, по истечении которой уходит запрос. */
const SETTLE_MS = 250;
/** Сколько недавних запросов помним. Больше — это уже не «недавние». */
const RECENT_LIMIT = 6;
const RECENT_KEY = 'itv.search.recent';

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((item) => typeof item === 'string').slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

function rememberQuery(query: string): string[] {
  const trimmed = query.trim();
  if (trimmed.length < 2) return readRecent();
  const next = [trimmed, ...readRecent().filter((item) => item !== trimmed)].slice(0, RECENT_LIMIT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Приватный режим или переполненное хранилище: поиск от этого не ломается.
  }
  return next;
}

export function SearchPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const language = useGuestLanguage();
  const { isReady } = useGuestSession();
  const calm = useMediaQuery('(prefers-reduced-motion: reduce)');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [text, setText] = useState(params.get('q') ?? '');
  const [settled, setSettled] = useState(text);
  const [recent, setRecent] = useState<string[]>(() => readRecent());

  // Поле поиска — липкое, но слоем ОБЩЕГО стека: своего он не заводит.
  const barLayer = useStickyLayer<HTMLDivElement>(STICKY.bar, { gap: 8 });

  useEffect(() => {
    const id = window.setTimeout(() => setSettled(text), SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [text]);

  useEffect(() => {
    // Запрос виден в адресе: гость может поделиться ссылкой и вернуться назад.
    const next = new URLSearchParams(params);
    if (settled.trim()) next.set('q', settled.trim());
    else next.delete('q');
    setParams(next, { replace: true });
    if (settled.trim().length >= 2) setRecent(rememberQuery(settled));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const query = settled.trim();
  const { data, isFetching } = useQuery<GuestSearchResult>({
    queryKey: guestKeys.search(query, language),
    queryFn: () => guestApi.get<GuestSearchResult>('/guest/search', { query: { q: query, lang: language } }),
    enabled: isReady,
    staleTime: 30_000,
  });

  const groups = useMemo(
    () =>
      [
        { key: 'services' as const, rows: data?.services ?? [] },
        { key: 'items' as const, rows: data?.items ?? [] },
        { key: 'info' as const, rows: data?.info ?? [] },
      ].filter((group) => group.rows.length > 0),
    [data],
  );

  const nothingFound = query.length >= 2 && !isFetching && (data?.total ?? 0) === 0;

  return (
    /*
      Сверху резервируется ровно столько, сколько занимает шелл, — ИЗМЕРЕННОЕ
      значение из общего стека, а не число по месту. Без этого липкое поле
      прилипает выше собственного места в потоке и накрывает первую строку
      выдачи: ровно та поломка, ради которой стек и заводили.
    */
    <Box data-testid="guest-search" sx={{ pt: `${barLayer.top}px` }}>
      <Box
        ref={barLayer.ref}
        sx={(theme) => ({
          position: 'sticky',
          // Прилипает к тому же краю, от которого отсчитан отступ страницы.
          top: `${barLayer.top}px`,
          zIndex: 2,
          ...storefrontTokens(theme.palette.mode).glass.bar,
          borderRadius: surfaceRadius.panel(theme.palette.brand.radius),
          mx: { xs: 1.5, md: 0 },
          p: 1,
        })}
      >
        <TextField
          inputRef={inputRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('guest.search.placeholder')}
          fullWidth
          size="small"
          autoComplete="off"
          inputProps={{ 'data-testid': 'guest-search-input', 'aria-label': t('guest.search.title') }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <IconSearch size={18} />
              </InputAdornment>
            ),
            endAdornment: text ? (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={() => setText('')}
                  aria-label={t('guest.search.clear')}
                  data-testid="guest-search-clear"
                >
                  <IconClose size={16} />
                </IconButton>
              </InputAdornment>
            ) : null,
          }}
        />
      </Box>

      <Container maxWidth="sm" sx={{ py: 2, pb: 6 }}>
        {/* Пустое поле: подсказки отеля и то, что гость искал сам. */}
        {!query ? (
          <Stack spacing={3}>
            {data?.suggestions?.length ? (
              <Stack spacing={1}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
                  {t('guest.search.suggestions')}
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  {data.suggestions.map((hint) => (
                    <Chip
                      key={hint}
                      label={hint}
                      onClick={() => setText(hint)}
                      data-testid="guest-search-suggestion"
                    />
                  ))}
                </Stack>
              </Stack>
            ) : null}

            {recent.length ? (
              <Stack spacing={1}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
                  {t('guest.search.recent')}
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  {recent.map((hint) => (
                    <Chip
                      key={hint}
                      variant="outlined"
                      label={hint}
                      onClick={() => setText(hint)}
                      data-testid="guest-search-recent"
                    />
                  ))}
                </Stack>
              </Stack>
            ) : null}
          </Stack>
        ) : null}

        {/*
          Ничего не нашлось — это ОТВЕТ, а не пустая страница: гостю говорят,
          что делать дальше, и дают дорогу к живому человеку.
        */}
        {nothingFound ? (
          <Stack spacing={1.5} sx={{ py: 4, textAlign: 'center' }} data-testid="guest-search-empty">
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {t('guest.search.nothingTitle', { query })}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('guest.search.nothingHint')}
            </Typography>
            <Box>
              <Chip
                label={t('guest.search.askReception')}
                color="primary"
                onClick={() => navigate('/chat')}
                data-testid="guest-search-ask"
              />
            </Box>
          </Stack>
        ) : null}

        <Stack spacing={3} sx={{ mt: query ? 1 : 3 }}>
          {groups.map((group) => (
            <Stack key={group.key} spacing={1} data-testid={`guest-search-group-${group.key}`}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
                {t(`guest.search.group.${group.key}`)}
              </Typography>
              <Stack spacing={1}>
                {group.rows.map((row) => (
                  <ResultRow key={`${row.kind}-${row.code}`} row={row} calm={calm} onOpen={navigate} />
                ))}
              </Stack>
            </Stack>
          ))}
        </Stack>
      </Container>
    </Box>
  );
}

/** Строка выдачи: кадр, название, где искать. Тап ведёт ПРЯМО туда. */
function ResultRow({
  row,
  calm,
  onOpen,
}: {
  row: GuestSearchRow;
  calm: boolean;
  onOpen: (route: string) => void;
}) {
  return (
    <ButtonBase
      data-testid={`guest-search-result-${row.code}`}
      onClick={() => onOpen(row.route)}
      sx={(theme) => ({
        ...storefrontTokens(theme.palette.mode).glass.panel,
        borderRadius: surfaceRadius.panel(theme.palette.brand.radius),
        p: 1,
        gap: 1.25,
        width: '100%',
        justifyContent: 'flex-start',
        textAlign: 'start',
        transition: calm ? 'none' : 'border-color .2s ease, transform .12s ease',
        '@media (hover: hover)': { '&:hover': { borderColor: theme.palette.primary.main } },
        '&:active': { transform: calm ? 'none' : 'scale(.995)' },
        '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
      })}
    >
      <Box
        sx={(theme) => ({
          // `position: relative` — не украшение: кадр рисуется через `fill`, а
          // он растягивается до ближайшего позиционированного предка. Без него
          // картинка уезжает во всю страницу и накрывает собой выдачу.
          position: 'relative',
          width: 56,
          height: 56,
          flex: 'none',
          borderRadius: surfaceRadius.inner(theme.palette.brand.radius),
          overflow: 'hidden',
        })}
      >
        <KitImage src={row.image ?? null} alt="" fill />
      </Box>
      <Stack sx={{ minWidth: 0, flex: 1 }} spacing={0.25}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>
          {row.title}
        </Typography>
        {/* Где искать — то, ради чего поиск и заводился: гость помнит блюдо,
            но не помнит заведение. */}
        {row.venue ? (
          <Typography variant="caption" color="text.secondary" noWrap>
            {row.venue}
          </Typography>
        ) : row.subtitle ? (
          <Typography variant="caption" color="text.secondary" noWrap>
            {row.subtitle}
          </Typography>
        ) : null}
      </Stack>
      <IconForward size={16} />
    </ButtonBase>
  );
}
