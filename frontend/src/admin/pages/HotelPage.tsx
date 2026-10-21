import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { RoomControlTab } from './hotel/RoomControlTab';
import { ConnectionsTab } from './hotel/ConnectionsTab';
import { JournalTab } from './hotel/JournalTab';
import { OverviewTab } from './hotel/OverviewTab';
import { RoomsTab } from './hotel/RoomsTab';
import { HistoryTab } from './hotel/HistoryTab';
import { Pill } from './hotels/hotelsUi';
import { ConfirmChangesDialog } from './hotel/hotelDialogs';
import { AddressPanel, GroupPanel } from './hotel/ProfileExtras';

import { parentOf } from '@/app/backMap';
import { BackLink } from '@/kit/BackLink';

import { useActionFailed } from '@/hooks/useActionFailed';
import { useRights } from '../useRights';

import { accent, ink, panelSx, pillSx, primaryButtonSx, state, surface, typo } from '../adminTokens';
import { QueryState } from '@/components/QueryState';
import { formGridSx, spanSx } from '@/kit/formLayout';
import { MultiSelectField, SelectField } from '@/components/SelectField';
import { currencyOptions, languageOptions, timezoneOptions } from '@/components/hotelFieldOptions';
import { useFormDraft } from '@/hooks/useFormDraft';
import { EnterHotelDialog } from '../EnterHotelDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  cancelOffboarding,
  changeAdminEmail,
  deleteHotel,
  getMe,
  downloadHotelExport,
  getHotel,
  getHotelAdmins,
  getHotelFieldReference,
  getReadiness,
  getModules,
  getTariffs,
  removeHotelAdmin,
  getUsage,
  patchHotel,
  putModules,
  markOffboarding,
  purgeHotel,
  setHotelAdmin,
  setTariff,
  type DowngradeWarning,
  type FixTarget,
  type HotelPatch,
  type NeedsConfirmation,
  PlatformError,
  type HotelProfile,
  type ModuleEntry,
} from '../adminClient';
import { formatDateTime } from '@/utils/dates';

/*
  ДЕВЯТЬ ВКЛАДОК (партия 62-B, по утверждённому макету). Порядок — от «что с
  отелем сейчас» к «что с ним делали» и «что с его данными».
*/
const TABS = ['overview', 'profile', 'modules', 'connections', 'rooms', 'roomControl', 'journal', 'history', 'data'] as const;
export type Tab = (typeof TABS)[number];

/**
 * Прежние ключи вкладок, которые больше не рисуются сами по себе.
 *
 * Ключ остаётся живым АДРЕСОМ: тот, кто просит его (закладка, тест, чужая
 * ссылка), попадает туда, куда переехало содержимое, а не на пустой экран.
 *   * `usage`, `tariff` — «Тариф и лимиты» живут на «Модулях» до партии E,
 *     где тарифы уходят совсем;
 *   * `activity` — журнал правок отеля стал «Историей»;
 *   * `support` — входы поддержки стали частью «Журнала».
 */
const TAB_ALIASES: Record<string, Tab> = { usage: 'modules', tariff: 'modules', activity: 'history', support: 'journal' };

function resolveTab(key: string): Tab {
  if ((TABS as readonly string[]).includes(key)) return key as Tab;
  return TAB_ALIASES[key] ?? 'overview';
}

/** Фильтры и подвкладки вкладок: при смене вкладки не переносятся. */
const TAB_KEYS = ['sub', 'search', 'building', 'floor', 'category', 'variant', 'pin', 'who', 'what', 'period', 'status', 'purpose'];

/**
 * Карточка отеля — на вкладках, а не одним свитком.
 *
 * Вкладки соответствуют разным вопросам о разной природе: «кто это» (профиль),
 * «влезает ли в тариф» (использование), «что ему открыто» (модули), «что с ним
 * делали» (журнал), «на чём он сидит» (тариф). Один свиток заставлял бы
 * прокручивать журнал, чтобы поменять валюту.
 */
export function HotelPage({ id, onBack }: { id: string; onBack: () => void }) {
  const { t } = useTranslation();
  const { canWrite } = useRights();
  /*
    ВКЛАДКА ЖИВЁТ В АДРЕСЕ — там же, где раздел консоли и открытый отель.

    Раньше она была чистым локальным состоянием: ссылка вида `?tab=…` не
    работала вовсе, а F5 возвращал на «Профиль». Раз уж ключи вкладок стали
    публичными (у `usage` теперь есть псевдоним), адрес обязан их нести —
    иначе обещание «старая ссылка не сломается» не о чем.
  */
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = resolveTab(searchParams.get('tab') ?? '');
  const setTab = (key: Tab) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', key);
    for (const name of TAB_KEYS) params.delete(name);
    // replace, а не push: вкладка — это место на экране, а не шаг назад.
    setSearchParams(params, { replace: true });
  };
  const [entering, setEntering] = useState(false);
  /*
    ОДНА «← ОТЕЛИ» СЛЕВА СВЕРХУ (партия 56).

    Было два выхода: крошка «Отели» в шапке и кнопка «К списку» справа от
    имени. Остался один — ссылкой по карте маршрутов: список отелей с ЕГО
    фильтрами (они лежат в том же адресе), а не голый `?section=fleet`.
    Крошка в шапке — указатель «где я», а не вторая кнопка.
  */
  const location = useLocation();
  const back = parentOf(location.pathname, { search: location.search }, t) ?? {
    to: '?section=fleet',
    label: t('admin.nav.fleet'),
  };
  const profile = useQuery({ queryKey: ['admin', 'hotel', id], queryFn: () => getHotel(id) });
  // Готовность — для пометки в шапке и числа на «Обзоре»; сервер держит её минуту.
  const readiness = useQuery({ queryKey: ['admin', 'readiness', id], queryFn: () => getReadiness(id), refetchInterval: 60_000 });

  if (profile.isPending || profile.isError || profile.data === undefined) {
    // Выход есть и у неоткрывшейся карточки: чужая ссылка на удалённый отель
    // не должна оставлять человека без дороги к списку (партия 56).
    return (
      <Box data-testid="admin-hotel-pending">
        <BackLink to={back.to} label={back.label} testId="admin-hotel-back" sx={{ mb: 1 }} />
        <QueryState query={profile} what={t('state.what.hotel')}>
          {() => null}
        </QueryState>
      </Box>
    );
  }
  const hotel = profile.data;
  const problems = readiness.data?.problems ?? [];
  const anyBad = problems.some((p) => p.severity === 'bad');
  const openFix = (target: FixTarget) => (target === 'panel' ? setEntering(true) : setTab(target));

  return (
    <Box data-testid="admin-hotel">
      <BackLink to={back.to} label={back.label} testId="admin-hotel-back" sx={{ mb: 1 }} />
      {/* На 390 кнопки уходят под имя, а не сжимают его в три строки (партия 55). */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flexGrow: 1, minWidth: 200 }}>
          <Typography sx={{ ...typo.pageTitle, color: ink.hi }}
            data-testid="admin-hotel-name">
            {hotel.name}
          </Typography>
          <Box sx={{ ...typo.caption, color: ink.mid, mt: 0.5, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <span>
              {hotel.subdomain}
              {hotel.city ? ` · ${hotel.city}` : ''}
            </span>
            {!hotel.is_active ? (
              <Pill tone="muted" testId="admin-hotel-state">{t('admin.card.state.disabled')}</Pill>
            ) : readiness.data ? (
              <Pill tone={anyBad ? 'bad' : problems.length ? 'warn' : 'ok'} testId="admin-hotel-state">
                {problems.length ? t('admin.card.state.problems', { count: problems.length }) : t('admin.card.state.ready')}
              </Pill>
            ) : null}
          </Box>
        </Box>
        {/* Вход в отель — право WRITE (`POST /hotels/{id}/enter`). */}
        {canWrite ? (
          <Button onClick={() => setEntering(true)} data-testid="admin-hotel-enter" sx={primaryButtonSx}>
            {t('admin.enter.button')}
          </Button>
        ) : null}
      </Box>

      {/*
        Девять вкладок на 390 шире экрана. Прокрутка своя, а `width: 0` +
        `minWidth: 100%` не дают ряду участвовать в расчёте ширины колонки
        (иначе карточка уезжала вбок, партия 55).
      */}
      <Box
        role="tablist"
        sx={{
          display: 'flex',
          gap: 0.5,
          mt: 2,
          borderBottom: `1px solid ${surface.line}`,
          overflowX: 'auto',
          scrollbarWidth: 'none',
          width: 0,
          minWidth: '100%',
        }}
      >
        {TABS.map((key) => {
          const badge = key === 'overview' && hotel.is_active && problems.length ? problems.length : 0;
          return (
            <ButtonBase
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              data-testid={`admin-hotel-tab-${key}`}
              data-active={tab === key ? 'true' : undefined}
              sx={{
                flexShrink: 0,
                whiteSpace: 'nowrap',
                gap: 0.75,
                px: 1.75,
                py: 1.25,
                ...typo.body,
                fontWeight: 700,
                color: tab === key ? accent.soft : ink.mid,
                borderBottom: `2px solid ${tab === key ? accent.main : 'transparent'}`,
              }}
            >
              {t(`admin.hotel.tab.${key}`)}
              {badge ? <Pill tone={anyBad ? 'bad' : 'warn'} testId="admin-hotel-tab-badge">{badge}</Pill> : null}
            </ButtonBase>
          );
        })}
      </Box>

      {/*
        Объяснение вкладки — НАД содержимым и в одном месте на все вкладки:
        подпись под таблицей встречает человека уже после того, как он её не
        понял.
      */}
      {t(`admin.hotel.intro.${tab}`, { defaultValue: '' }) ? (
        <Typography
          sx={{ ...typo.caption, color: ink.mid, mt: 2.25, maxWidth: 760 }}
          data-testid={`admin-hotel-intro-${tab}`}
        >
          {t(`admin.hotel.intro.${tab}`)}
        </Typography>
      ) : null}

      <Box sx={{ mt: 2.25 }}>
        {tab === 'overview' ? <OverviewTab hotel={hotel} readiness={readiness} onFix={openFix} /> : null}
        {tab === 'profile' ? <ProfileTab hotel={hotel} /> : null}
        {tab === 'modules' ? (
          <Box sx={{ display: 'grid', gap: 2.5 }}>
            <ModulesTab id={id} />
            {/* «Тариф и лимиты» — здесь до партии E, где тарифы уходят. */}
            <TariffTab id={id} />
          </Box>
        ) : null}
        {tab === 'connections' ? <ConnectionsTab hotelId={id} /> : null}
        {tab === 'rooms' ? <RoomsTab hotelId={id} /> : null}
        {/* Конфигурация управления номером: наша работа, наша консоль. */}
        {tab === 'roomControl' ? <RoomControlTab hotelId={id} /> : null}
        {tab === 'journal' ? <JournalTab hotelId={id} /> : null}
        {tab === 'history' ? <HistoryTab hotelId={id} /> : null}
        {tab === 'data' ? <DataTab hotel={hotel} onRemoved={onBack} /> : null}
      </Box>

      {entering ? (
        <EnterHotelDialog hotelId={id} hotelName={hotel.name} onClose={() => setEntering(false)} />
      ) : null}
    </Box>
  );
}

/* ── Профиль ────────────────────────────────────────────────────────────── */

function ProfileTab({ hotel }: { hotel: HotelProfile }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [adminEmail, setAdminEmail] = useState('');
  const [issued, setIssued] = useState<string | null>(null);
  const [existingAdmins, setExistingAdmins] = useState<string[]>([]);

  /*
    ПРОФИЛЬ ПРАВИТСЯ С ЭКРАНА.

    API умел это с самого начала, а вкладка показывала всё на чтение: чтобы
    сменить валюту отелю, оператор шёл в curl. Форма правит ровно то, что
    принимает `PATCH`, и ничего сверх.

    Черновик живёт отдельно от загруженного профиля: пока правка не сохранена,
    фоновое обновление списка не должно стирать введённое, а отказ сервера —
    тем более. `dirty` считается сравнением с исходным, а не флагом «трогали
    поле»: вернул значение обратно — и кнопка снова погасла.
  */
  /*
    НАЗВАНИЕ И ГОРОД — ПО КАЖДОМУ ЯЗЫКУ ОТЕЛЯ (партия 62-C). Раньше поле было
    одно и писало основной язык; переводы отель вёл в CMS. Теперь видны все
    языки сразу, а сервер получает только изменённые: чужие переводы не
    трогаются, пустое поле убирает перевод.
  */
  const langs = hotel.languages.map((lang) => lang.code);
  const initialNames = Object.fromEntries(langs.map((code) => [code, hotel.name_i18n?.[code] ?? (code === hotel.default_language ? hotel.name : '')]));
  const initialCities = Object.fromEntries(langs.map((code) => [code, hotel.city_i18n?.[code] ?? (code === hotel.default_language ? hotel.city ?? '' : '')]));
  const [draft, setDraft] = useState({
    names: initialNames,
    cities: initialCities,
    timezone: hotel.timezone,
    currency: hotel.currency,
    currency_minor_units: hotel.currency_minor_units,
    languages: hotel.languages.map((lang) => lang.code).join(', '),
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  // Сервер попросил подтвердить опасную правку (409) — окно последствий.
  const [need, setNeed] = useState<NeedsConfirmation | null>(null);
  // Смена валюты с другой размерностью ждёт ответа человека (партия 60).
  const [currencyAsk, setCurrencyAsk] = useState<{ code: string; units: number } | null>(null);
  const { i18n } = useTranslation();
  const reference = useQuery({
    queryKey: ['admin', 'reference', 'hotel-fields'],
    queryFn: getHotelFieldReference,
    staleTime: Infinity,
  });
  const uiLanguage = (i18n.resolvedLanguage ?? i18n.language ?? 'en').split('-')[0];
  const timezones = useMemo(() => timezoneOptions(reference.data?.timezones ?? []), [reference.data]);
  const currencies = useMemo(
    () => currencyOptions((reference.data?.currencies ?? []).map((c) => c.code), uiLanguage),
    [reference.data, uiLanguage],
  );
  const languageChoices = useMemo(() => languageOptions(reference.data?.languages ?? []), [reference.data]);

  /*
    ФОРМУ ВИДИТ ТОТ, КОМУ СЕРВЕР РАЗРЕШИТ.

    Роль «только чтение» получала на экране полноценную форму с активной
    кнопкой, а на сохранении — 403. Это не дыра в правах (сервер отказывает
    честно), но интерфейс обещал то, чего не может: человек набирает валюту,
    жмёт «Сохранить» и получает отказ вместо результата.

    Право берём из `me`, который уже загружен оболочкой консоли: своего запроса
    здесь не заводим.
  */
  const me = useQuery({ queryKey: ['admin', 'me'], queryFn: getMe });
  const canEdit = me.data?.role !== 'read_only';

  /*
    ЧЕРНОВИК. Сессия консоли может кончиться прямо посреди правки профиля —
    и введённое исчезало вместе с экраном. Ключ включает пользователя: за
    одним компьютером сидят разные люди платформы.
  */
  const kept = useFormDraft<typeof draft>({
    scope: 'platform',
    userId: me.data?.id,
    screen: `hotel:${hotel.id}`,
  });
  const keptAppliedRef = useRef(false);
  useEffect(() => {
    // Поднимаем один раз и только когда известен пользователь: до этого ключа
    // нет, и читать нечего.
    if (keptAppliedRef.current || !me.data?.id) return;
    keptAppliedRef.current = true;
    const saved = kept.restore();
    // Черновик прежнего вида (название строкой) не поднимаем — форма другая.
    if (saved && saved.names && saved.cities) setDraft(saved);
  }, [me.data?.id, kept]);

  const initial = {
    names: initialNames,
    cities: initialCities,
    timezone: hotel.timezone,
    currency: hotel.currency,
    currency_minor_units: hotel.currency_minor_units,
    languages: hotel.languages.map((lang) => lang.code).join(', '),
  };
  const same = (a: unknown, b: unknown) =>
    typeof a === 'object' ? JSON.stringify(a) === JSON.stringify(b) : String(a).trim() === String(b).trim();
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).filter((key) => !same(draft[key], initial[key]));
  const changedLangs = (now: Record<string, string>, was: Record<string, string>) =>
    Object.fromEntries(Object.entries(now).filter(([code, text]) => text.trim() !== (was[code] ?? '').trim()).map(([code, text]) => [code, text.trim()]));

  // Пишем черновик, пока есть расхождение с сохранённым.
  useEffect(() => {
    if (!keptAppliedRef.current) return;
    // Тот же инвариант, что и в редакторе блюда: есть расхождение — есть
    // черновик, нет расхождения — нет черновика.
    if (dirty.length) kept.save(draft);
    else kept.discard();
  }, [dirty.length, draft, kept]);

  // ТОЛЬКО ИЗМЕНЁННОЕ (партия 60). Форма слала все поля разом, и сохранение
  // часового пояса заодно переписывало название и город — одним языком
  // поверх переводов, которые отель вёл в CMS.
  const save = useMutation({
    mutationFn: (confirm: string[]) => {
      const body: HotelPatch = {};
      // Только изменённые языки: сервер сливает их с остальными переводами.
      if (dirty.includes('names')) body.name = changedLangs(draft.names, initial.names);
      if (dirty.includes('cities')) body.city = changedLangs(draft.cities, initial.cities);
      if (confirm.length) body.confirm = confirm;
      if (dirty.includes('timezone')) body.timezone = draft.timezone;
      if (dirty.includes('currency')) body.currency = draft.currency;
      if (dirty.includes('currency_minor_units')) body.currency_minor_units = Number(draft.currency_minor_units);
      if (dirty.includes('languages')) {
        body.languages = draft.languages
          .split(/[,\s]+/)
          .map((code) => code.trim().toLowerCase())
          .filter(Boolean);
      }
      return patchHotel(hotel.id, body);
    },
    onSuccess: () => {
      setSaveError(null);
      setNeed(null);
      // Сохранили — черновик отслужил.
      kept.discard();
      refresh();
    },
    // Введённое НЕ трогаем: человек только что это набрал, и отобрать текст
    // вместе с отказом — самый быстрый способ заставить набирать заново.
    onError: (error) => {
      // Опасная правка: сервер перечислил последствия — показываем и ждём «да».
      if (error instanceof PlatformError && error.status === 409 && error.code === 'needs_confirmation') {
        setNeed(error.data as NeedsConfirmation);
        return;
      }
      setSaveError(error instanceof Error ? error.message : t('admin.hotel.saveFailed'));
    },
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'hotel', hotel.id] });
    void qc.invalidateQueries({ queryKey: ['admin', 'fleet'] });
  };
  const resetAdmin = useMutation({
    mutationFn: () => setHotelAdmin(hotel.id, { email: adminEmail.trim() }),
    onSuccess: (result) => {
      setIssued(result.delivered_to);
      // Сервер называет тех, кто уже был админом. Пусто — заводили первого.
      setExistingAdmins(result.existing_admins ?? []);
      void qc.invalidateQueries({ queryKey: ['admin', 'hotel-admins', hotel.id] });
    },
    onError: (cause) =>
      setAdminError(cause instanceof Error ? cause.message : t('admin.hotel.adminFailed')),
  });

  /*
    СМЕНА АДРЕСА — ВЫХОД ИЗ ПОЛОЖЕНИЯ «ОТЕЛЬ ПОТЕРЯЛ И ЯЩИК».

    Пароль администратора уходит только ему на почту, поэтому недоступный
    адрес запирает отель насмерть: сбросить пароль можно, а прочитать письмо
    некому. Ручка меняет адрес НИЧЕГО НЕ ОТПРАВЛЯЯ — отправлять было бы
    некуда, в том и беда, — а дальше идёт обычный сброс уже на новый адрес.

    Право владельца, а не поддержки: подмена адреса — это и есть способ увести
    отель, и рутинной операцией она быть не должна.
  */
  const [newEmail, setNewEmail] = useState('');
  const [adminError, setAdminError] = useState<string | null>(null);
  const moveAdmin = useMutation({
    mutationFn: () =>
      changeAdminEmail(hotel.id, {
        current_email: adminEmail.trim(),
        new_email: newEmail.trim(),
      }),
    onSuccess: (result) => {
      setAdminError(null);
      setAdminEmail(result.email);
      setNewEmail('');
      setIssued(null);
      refresh();
    },
    onError: (cause) =>
      setAdminError(cause instanceof Error ? cause.message : t('admin.hotel.adminMoveFailed')),
  });

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 1.75 }}>
      <Box sx={panelSx}>
        <Typography sx={{ ...typo.panelTitle, color: ink.hi, mb: 1.25 }}>
          {t('admin.hotel.tab.profile')}
        </Typography>
        {canEdit ? (
          <>
        {/* По языку на строку: основной — первым, у него те же testid, что раньше. */}
        {[hotel.default_language, ...langs.filter((code) => code !== hotel.default_language)].map((code) => {
          const main = code === hotel.default_language;
          return (
            <Box key={code} sx={{ ...formGridSx, columnGap: 1.25, rowGap: 1.25, mb: 1.25 }}>
              <TextField
                size="small"
                label={`${t('admin.hotel.field.name')} · ${code.toUpperCase()}${main ? ` · ${t('admin.profile.mainLanguage')}` : ''}`}
                value={draft.names[code] ?? ''}
                placeholder={main ? '' : t('admin.profile.noTranslation')}
                onChange={(event) => setDraft((prev) => ({ ...prev, names: { ...prev.names, [code]: event.target.value } }))}
                inputProps={{ 'data-testid': main ? 'admin-hotel-name-input' : `admin-hotel-name-${code}` }}
                sx={spanSx(6)}
              />
              <TextField
                size="small"
                label={`${t('admin.hotel.field.city')} · ${code.toUpperCase()}`}
                value={draft.cities[code] ?? ''}
                placeholder={t('admin.profile.noTranslation')}
                onChange={(event) => setDraft((prev) => ({ ...prev, cities: { ...prev.cities, [code]: event.target.value } }))}
                inputProps={{ 'data-testid': main ? 'admin-hotel-city-input' : `admin-hotel-city-${code}` }}
                sx={spanSx(6)}
              />
            </Box>
          );
        })}
        <Typography sx={{ ...typo.caption, color: ink.low, mt: -0.5, mb: 1.25 }}>{t('admin.profile.languagesHint')}</Typography>
        {/* Пояс, валюта, языки — выбором из справочника сервера, а не вводом
            (партия 54): опечатка в поясе молча делала отель UTC-шным. */}
        <SelectField
          size="small"
          label={t('admin.hotel.field.timezone')}
          value={draft.timezone}
          onChange={(next) => setDraft((prev) => ({ ...prev, timezone: next }))}
          options={timezones}
          loading={reference.isLoading}
          testId="admin-hotel-timezone-input"
          sx={{ mb: 1.25 }}
        />
        {/* Валюта и знаки — пополам по сетке формы, на узком экране в столбик.
            Были 280 + 200 px: на 390 ряд распирал карточку на +100 px, а в
            арабском подпись «Знаки после запятой» не влезала в 200 (партия 55). */}
        <Box sx={{ ...formGridSx, columnGap: 1.25, rowGap: 1.25, mb: 1.25 }}>
          <SelectField
            size="small"
            label={t('admin.hotel.field.currency')}
            value={draft.currency}
            onChange={(next) => {
              // Размерность у валюты своя (иена без копеек, динар с тремя
              // знаками), но цены хранятся в минимальных единицах: молча
              // сменить знаки — значит в сто раз сдвинуть все цены отеля.
              // Поэтому — только с вопросом и объяснением (партия 60).
              const units = reference.data?.currencies.find((c) => c.code === next)?.minor_units;
              if (units === undefined || units === Number(draft.currency_minor_units)) {
                setDraft((prev) => ({ ...prev, currency: next }));
              } else {
                // Поле выбора раскрывается по фокусу: уводим фокус и задаём
                // вопрос, когда список уже закрылся, — иначе он висит поверх.
                (document.activeElement as HTMLElement | null)?.blur();
                window.setTimeout(() => setCurrencyAsk({ code: next, units }), 0);
              }
            }}
            options={currencies}
            loading={reference.isLoading}
            testId="admin-hotel-currency-input"
            sx={spanSx(6)}
          />
          {/* Размерность валюты — рядом с самой валютой: менять их порознь
              бессмысленно, цены хранятся в минимальных единицах. */}
          <SelectField
            size="small"
            label={t('admin.hotel.field.minorUnits')}
            value={String(draft.currency_minor_units)}
            onChange={(next) => setDraft((prev) => ({ ...prev, currency_minor_units: Number(next) }))}
            testId="admin-hotel-minor-units"
            helperText={t('admin.hotel.field.minorUnitsHint')}
            sx={spanSx(6)}
            options={[0, 2, 3].map((value) => ({ value: String(value), label: String(value) }))}
          />
        </Box>
        <ConfirmDialog
          open={currencyAsk !== null}
          testId="admin-hotel-currency-confirm"
          restoreFocus={false}
          title={t('admin.hotel.currencyConfirm.title', { code: currencyAsk?.code ?? '' })}
          description={t('admin.hotel.currencyConfirm.body', {
            code: currencyAsk?.code ?? '',
            next: currencyAsk?.units ?? 0,
            current: Number(draft.currency_minor_units),
            before: (12345 / 10 ** Number(draft.currency_minor_units)).toFixed(Number(draft.currency_minor_units)),
            after: (12345 / 10 ** (currencyAsk?.units ?? 0)).toFixed(currencyAsk?.units ?? 0),
          })}
          confirmLabel={t('admin.hotel.currencyConfirm.both', { next: currencyAsk?.units ?? 0 })}
          onConfirm={() => {
            if (currencyAsk) {
              setDraft((prev) => ({ ...prev, currency: currencyAsk.code, currency_minor_units: currencyAsk.units }));
            }
            setCurrencyAsk(null);
          }}
          onClose={() => setCurrencyAsk(null)}
        >
          <Button
            sx={{ mt: 1.5 }}
            data-testid="admin-hotel-currency-confirm-keep"
            onClick={() => {
              if (currencyAsk) setDraft((prev) => ({ ...prev, currency: currencyAsk.code }));
              setCurrencyAsk(null);
            }}
          >
            {t('admin.hotel.currencyConfirm.keep', { current: Number(draft.currency_minor_units) })}
          </Button>
        </ConfirmDialog>
        <MultiSelectField
          size="small"
          label={t('admin.hotel.field.languages')}
          // Черновик держит языки строкой «ru, en» — так он хранился и раньше,
          // и сохранённые черновики не ломаются.
          value={draft.languages.split(/[,\s]+/).filter(Boolean)}
          onChange={(next) => setDraft((prev) => ({ ...prev, languages: next.join(', ') }))}
          options={languageChoices}
          loading={reference.isLoading}
          testId="admin-hotel-languages-input"
          helperText={t('admin.hotel.field.languagesHint')}
        />

        {saveError ? (
          <Alert severity="error" sx={{ mt: 1.5 }} data-testid="admin-hotel-save-error">
            {saveError}
          </Alert>
        ) : null}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5 }}>
          <Button
            sx={primaryButtonSx}
            disabled={dirty.length === 0 || save.isPending}
            onClick={() => save.mutate([])}
            data-testid="admin-hotel-save"
          >
            {t('admin.hotel.save')}
          </Button>
          <Button
            disabled={dirty.length === 0 || save.isPending}
            onClick={() => {
              setDraft(initial);
              setSaveError(null);
            }}
            data-testid="admin-hotel-cancel"
            sx={{ color: ink.mid }}
          >
            {t('admin.hotel.cancel')}
          </Button>
          {dirty.length ? (
            <Typography
              sx={{ ...typo.caption, color: state.warn }}
              data-testid="admin-hotel-dirty"
            >
              {t('admin.hotel.dirty', { count: dirty.length })}
            </Typography>
          ) : null}
        </Box>
        </>
        ) : (
          <>
            <Kv label={t('admin.hotel.field.name')} value={hotel.name} />
            <Kv label={t('admin.hotel.field.timezone')} value={hotel.timezone} />
            <Kv
              label={t('admin.hotel.field.currency')}
              value={`${hotel.currency} · ${hotel.currency_minor_units}`}
            />
            <Kv
              label={t('admin.hotel.field.languages')}
              value={hotel.languages.map((lang) => lang.code.toUpperCase()).join(' · ')}
            />
            <Typography sx={{ ...typo.caption, color: ink.low, mt: 1 }} data-testid="admin-hotel-readonly">
              {t('admin.hotel.readOnly')}
            </Typography>
          </>
        )}
        {/* Состояние — подписью; отключают на «Обзоре», с причиной (партия 62-C). */}
        <Typography sx={{ ...typo.caption, color: ink.mid, mt: 1.5 }} data-testid="admin-hotel-active-label">
          {hotel.is_active ? t('admin.hotel.activeOn') : t('admin.hotel.activeOff')}
        </Typography>
        {need ? (
          <ConfirmChangesDialog
            need={need}
            busy={save.isPending}
            onConfirm={() => save.mutate(need.fields)}
            onClose={() => setNeed(null)}
          />
        ) : null}
      </Box>

      <AdminsPanel hotelId={hotel.id} />

      <AddressPanel hotel={hotel} />

      <GroupPanel hotel={hotel} />

      {/* «Только чтение» админа не заводит и не сбрасывает: сервер ответит 403 (партия 60). */}
      {canEdit ? (
      <Box sx={panelSx}>
        <Typography sx={{ ...typo.panelTitle, color: ink.hi, mb: 1.25 }}>
          {t('admin.hotel.adminTitle')}
        </Typography>
        <Typography sx={{ ...typo.caption, color: ink.mid, mb: 1.5 }}>
          {t('admin.hotel.adminHint')}
        </Typography>
        <TextField
          size="small"
          fullWidth
          label={t('admin.hotel.adminEmail')}
          value={adminEmail}
          onChange={(e) => setAdminEmail(e.target.value)}
          inputProps={{ 'data-testid': 'admin-hotel-admin-email' }}
        />
        {adminError ? (
          <Alert severity="error" sx={{ mt: 1.5 }} data-testid="admin-hotel-admin-error">
            {adminError}
          </Alert>
        ) : null}
        <Button
          sx={{ ...primaryButtonSx, mt: 1.5 }}
          disabled={!adminEmail.includes('@') || resetAdmin.isPending}
          onClick={() => resetAdmin.mutate()}
          data-testid="admin-hotel-admin-reset"
        >
          {t('admin.hotel.adminReset')}
        </Button>
        {issued ? (
          <Alert severity="success" sx={{ mt: 1.5 }} data-testid="admin-hotel-admin-sent">
            {t('admin.hotel.adminPasswordSent', { email: issued })}
          </Alert>
        ) : null}
        {/*
          ВТОРОЙ АДМИН — ПРЕДУПРЕЖДЕНИЕ, А НЕ ЗАПРЕТ. Он бывает нужен (передача
          дел), но чаще это опечатка в адресе, и раньше она проходила молча:
          отель тихо получал второго полноправного администратора.
        */}
        {existingAdmins.length ? (
          <Alert severity="warning" sx={{ mt: 1.5 }} data-testid="admin-hotel-admin-second">
            {t('admin.hotel.admins.existing', { list: existingAdmins.join(', ') })}
          </Alert>
        ) : null}

        {/* Смена адреса — только владельцу: подмена адреса и есть способ
            увести отель, рутинной операцией она быть не должна. */}
        {me.data?.role === 'owner' ? (
          <Box sx={{ mt: 2.5, pt: 2, borderTop: `1px solid ${surface.hair}` }}>
            <Typography sx={{ ...typo.caption, fontWeight: 700, mb: 0.5 }}>
              {t('admin.hotel.adminMoveTitle')}
            </Typography>
            <Typography sx={{ ...typo.caption, color: ink.low, mb: 1.25 }}>
              {t('admin.hotel.adminMoveHint')}
            </Typography>
            <TextField
              size="small"
              fullWidth
              label={t('admin.hotel.adminNewEmail')}
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              inputProps={{ 'data-testid': 'admin-hotel-admin-new-email' }}
            />
            <Button
              sx={{ mt: 1.25, color: ink.mid, border: `1px solid ${surface.line}` }}
              disabled={
                !newEmail.includes('@') || !adminEmail.includes('@') || moveAdmin.isPending
              }
              onClick={() => moveAdmin.mutate()}
              data-testid="admin-hotel-admin-move"
            >
              {t('admin.hotel.adminMove')}
            </Button>
          </Box>
        ) : null}
      </Box>
      ) : null}
    </Box>
  );
}

/* ── Модули ─────────────────────────────────────────────────────────────── */

function ModulesTab({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  // Тумблеры модулей — право WRITE (`PUT /hotels/{id}/modules`).
  const { canWrite } = useRights();
  const qc = useQueryClient();
  const modules = useQuery({ queryKey: ['admin', 'modules', id], queryFn: () => getModules(id) });
  const save = useMutation({
    mutationFn: (next: Pick<ModuleEntry, 'code' | 'is_enabled'>[]) => putModules(id, next),
    onSuccess: (result) => qc.setQueryData(['admin', 'modules', id], result),
  });

  if (modules.isPending || modules.isError || modules.data === undefined) {
    return (
      <QueryState query={modules} what={t('state.what.hotelModules')}>
        {() => null}
      </QueryState>
    );
  }
  const list = modules.data.modules;

  // Клиент шлёт ТОЛЬКО «включено/выключено» — то есть решение человека.
  // Тарифную сетку знает сервер, он же и решает, чем это решение обернётся.
  const toggle = (code: string, enabled: boolean) => {
    save.mutate([{ code, is_enabled: enabled }]);
  };

  /*
    ЧЕТЫРЕ СОСТОЯНИЯ, А НЕ ДВА.

    Экран показывал одну пометку — «вне тарифа» — и то только у включённых.
    Всё остальное выглядело одинаково: «тариф даёт и включено» ничем не
    отличалось от «включили руками», а «выключили руками» — от «тариф этого не
    даёт». Второе особенно дорого: оператор видел погашенный тумблер и не мог
    понять, включать ли его обратно.
  */
  const stateOf = (entry: ModuleEntry): 'inTariff' | 'override' | 'manualOff' | 'notInTariff' => {
    if (entry.is_enabled) return entry.in_tariff ? 'inTariff' : 'override';
    return entry.in_tariff ? 'manualOff' : 'notInTariff';
  };
  // «Тариф не даёт» — не событие: это фон, на котором живут остальные три.
  // Приглушённая пилюля, а не цветная.
  const TONE = {
    inTariff: 'ok',
    override: 'gold',
    manualOff: 'warn',
    notInTariff: 'muted',
  } as const;

  return (
    <Box sx={{ ...panelSx, maxWidth: 640 }} data-testid="admin-hotel-modules">
      <Typography sx={{ ...typo.panelTitle, color: ink.hi, mb: 1.25 }}>
        {t('admin.hotel.modulesTitle', { tariff: modules.data.tariff })}
      </Typography>
      {list.map((entry) => (
        <Box
          key={entry.code}
          data-testid={`admin-module-${entry.code}`}
          sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderBottom: `1px solid ${surface.hair}` }}
        >
          <Typography sx={{ ...typo.caption, color: ink.mid, flexGrow: 1 }}>
            {entry.title[i18n.language] ?? entry.title.en ?? entry.code}
          </Typography>
          <Box
            data-testid={`admin-module-state-${entry.code}`}
            data-state={stateOf(entry)}
            sx={pillSx(TONE[stateOf(entry)])}
          >
            {t(`admin.hotel.moduleState.${stateOf(entry)}`)}
          </Box>
          <Switch
            checked={entry.is_enabled}
            onChange={(e) => toggle(entry.code, e.target.checked)}
            disabled={save.isPending || !canWrite}
            inputProps={{ 'data-testid': `admin-module-toggle-${entry.code}` } as Record<string, string>}
          />
        </Box>
      ))}
      <Typography sx={{ ...typo.caption, color: ink.mid, mt: 1.75 }}>
        {t('admin.hotel.modulesHint')}
      </Typography>
    </Box>
  );
}

/* ── Тариф и лимиты ─────────────────────────────────────────────────────── */

/**
 * Тариф и лимиты — ОДНА вкладка, потому что вопрос один.
 *
 * Было две: «Использование» показывало, сколько отель израсходовал, «Тариф» —
 * на чём он сидит и как это сменить. Обе кормились ОДНИМ запросом `getUsage`, и
 * название тарифа было выведено дважды из одного поля. Разрез проходил ровно по
 * живому: предупреждение «не влезет в лимит комнат» жило на одной вкладке, а
 * число 42, по которому его можно проверить, — на другой.
 *
 * Предупреждение теперь не отдельная жёлтая плашка, а ВТОРОЕ ЧИСЛО на той же
 * строке: «комнаты 42 / 30 — не влезает». Считается на клиенте по сетке
 * тарифов, поэтому видно ДО нажатия, а не после ответа сервера. Ответ сервера
 * при этом остаётся истиной: если он вернул предупреждения, показываем их —
 * сетка на клиенте могла отстать от той, что на сервере.
 */
function TariffTab({ id }: { id: string }) {
  const actionFailed = useActionFailed();
  // Тариф пишет только владелец (`OWNER` на `/hotels/{id}/tariff`). Ровно здесь
  // и жил самый дорогой молчаливый отказ: панель получала 403 и не менялась
  // никак, а оператор уходил уверенный, что тариф записан.
  const { isOwner } = useRights();
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const usage = useQuery({ queryKey: ['admin', 'usage', id], queryFn: () => getUsage(id) });
  // Сетка тарифов — ради лимитов ВЫБРАННОГО тарифа. Без неё «не влезает» можно
  // было узнать только у сервера и только после нажатия.
  const grid = useQuery({ queryKey: ['admin', 'tariffs'], queryFn: getTariffs });
  const [next, setNext] = useState<string>('');
  const [warnings, setWarnings] = useState<DowngradeWarning[]>([]);

  const apply = useMutation({
    mutationFn: (acknowledge: boolean) =>
      setTariff(id, { tariff: next || usage.data!.tariff, acknowledge_downgrade: acknowledge }),
    onSuccess: (result) => {
      setWarnings(result.warnings ?? []);
      if (result.ok) {
        setNext('');
        void qc.invalidateQueries({ queryKey: ['admin', 'usage', id] });
        void qc.invalidateQueries({ queryKey: ['admin', 'fleet'] });
        void qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      }
    },
  
    // Отказ виден: молча съеденный 403 читается как успех.
    onError: actionFailed,
  });

  if (usage.isPending || usage.isError || usage.data === undefined) {
    return (
      <QueryState query={usage} what={t('state.what.usage')}>
        {() => null}
      </QueryState>
    );
  }

  const data = usage.data;
  const codes = (grid.data ?? []).map((row) => row.code);
  const selected = next || data.tariff;
  // Пока сетка не приехала — предпросмотра нет, но выбор и цифры уже работают.
  const preview =
    next && next !== data.tariff
      ? (grid.data ?? []).find((row) => row.code === next) ?? null
      : null;

  return (
    <Box sx={{ ...panelSx, maxWidth: 640 }} data-testid="admin-hotel-tariff">
      <Typography sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}>
        {data.tariff_title[i18n.language] ?? data.tariff_title.en ?? data.tariff}
      </Typography>
      {data.is_trial && data.trial_days_left !== null ? (
        <Typography sx={{ ...typo.caption, color: state.warn, mt: 0.5 }} data-testid="admin-hotel-trial">
          {t('admin.hotel.trialLeft', { days: data.trial_days_left })}
        </Typography>
      ) : null}

      {/* Цифры — сразу под именем тарифа: это и есть ответ на «хватает ли». */}
      <Box sx={{ mt: 2 }} data-testid="admin-hotel-usage">
        {data.rows.map((row) => {
          const nextLimit = preview ? preview.limits[row.key] ?? null : undefined;
          const willNotFit = nextLimit !== undefined && nextLimit !== null && row.used > nextLimit;
          return (
            <Box key={row.key} sx={{ py: 1.25, borderBottom: `1px solid ${surface.hair}` }}
              data-testid={`admin-usage-${row.key}`}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                <Typography sx={{ ...typo.caption, color: ink.mid, flexGrow: 1 }}>
                  {t(`admin.hotel.limit.${row.key}`)}
                </Typography>
                <Typography
                  sx={{
                    ...typo.body,
                    fontWeight: 700,
                    color: row.over || willNotFit ? state.bad : ink.hi,
                  }}
                >
                  {row.used}
                  {/*
                    При выбранном другом тарифе делитель — ЕГО лимит, а не
                    сегодняшний: человек смотрит на «что будет», и показывать
                    ему при этом старое число значит заставлять считать в уме.
                  */}
                  {nextLimit !== undefined
                    ? nextLimit === null
                      ? ` / ${t('admin.hotel.limit.none')}`
                      : ` / ${nextLimit}`
                    : row.limit === null
                      ? ` / ${t('admin.hotel.limit.none')}`
                      : ` / ${row.limit}`}
                </Typography>
              </Box>
              {row.limit !== null ? (
                <Box sx={{ mt: 0.75, height: 5, borderRadius: 999, bgcolor: surface.s3, overflow: 'hidden' }}>
                  <Box
                    sx={{
                      width: `${Math.min(100, Math.round((row.ratio ?? 0) * 100))}%`,
                      height: '100%',
                      bgcolor: row.over || willNotFit ? state.bad : accent.main,
                    }}
                  />
                </Box>
              ) : null}
              {willNotFit ? (
                <Typography sx={{ ...typo.caption, color: state.bad, mt: 0.6 }}
                  data-testid={`admin-usage-wont-fit-${row.key}`}>
                  {t('admin.hotel.limitWontFit')}
                </Typography>
              ) : row.over ? (
                <Typography sx={{ ...typo.caption, color: state.bad, mt: 0.6 }}
                  data-testid={`admin-usage-over-${row.key}`}>
                  {t('admin.hotel.limitOver', { used: row.used, limit: row.limit })}
                </Typography>
              ) : null}
            </Box>
          );
        })}
      </Box>
      <Typography sx={{ ...typo.caption, color: ink.mid, mt: 1.75 }}>
        {t('admin.hotel.limitHint')}
      </Typography>

      <Box sx={{ mt: 2.75, pt: 2.25, borderTop: `1px solid ${surface.line}` }}>
        <Typography sx={{ ...typo.caption, color: ink.mid, mb: 1.5 }}>
          {t('admin.hotel.tariffHint')}
        </Typography>
        <SelectField
          size="small"
          label={t('admin.hotel.tariffLabel')}
          value={codes.includes(selected) ? selected : ''}
          onChange={(next) => {
            setNext(next);
            setWarnings([]);
          }}
          testId="admin-tariff-select"
          sx={{ maxWidth: 320 }}
          options={(grid.data ?? []).map((row) => ({
            value: row.code,
            label: row.title[i18n.language] ?? row.title.en ?? row.code,
            testId: `admin-tariff-option-${row.code}`,
          }))}
        />

        {data.trial_ends_at ? (
          <Typography sx={{ ...typo.caption, color: ink.mid, mt: 1.25 }}>
            {t('admin.hotel.trialEnds', { date: data.trial_ends_at })}
          </Typography>
        ) : null}

        {/*
          Модули из плашки не выгнать: они не имеют строки с числом, к которой
          можно было бы прицепить подсветку. Зато список поимённый и приходит
          ДО нажатия — из сетки тарифов, а не из ответа сервера.
        */}
        {preview ? (
          <ModuleLoss hotelId={id} nextModules={preview.modules} />
        ) : null}

        {warnings.filter((warning) => warning.modules).map((warning) => (
          <Typography
            key={warning.key}
            sx={{ ...typo.caption, color: state.warn, mt: 1 }}
            data-testid="admin-tariff-warning"
          >
            {t('admin.hotel.downgradeModules', { modules: warning.modules!.join(', ') })}
          </Typography>
        ))}

        <Box sx={{ display: 'flex', gap: 1, mt: 1.75 }}>
          {isOwner ? (
            <>
              <Button
                onClick={() => apply.mutate(false)}
                disabled={apply.isPending}
                data-testid="admin-tariff-apply"
                sx={primaryButtonSx}
              >
                {t('admin.hotel.tariffApply')}
              </Button>
              {warnings.length ? (
                <Button
                  onClick={() => apply.mutate(true)}
                  disabled={apply.isPending}
                  data-testid="admin-tariff-force"
                  sx={{ color: state.warn, border: `1px solid ${state.warn}55` }}
                >
                  {t('admin.hotel.tariffForce')}
                </Button>
              ) : null}
            </>
          ) : (
            <Typography sx={{ ...typo.caption, color: ink.mid }} data-testid="admin-tariff-readonly">
              {t('admin.hotel.tariffOwnerOnly')}
            </Typography>
          )}
        </Box>
        <Typography sx={{ ...typo.caption, color: ink.low, mt: 1.5 }}>
          {t('admin.hotel.tariffNoMoney')}
        </Typography>
      </Box>
    </Box>
  );
}

/**
 * Какие модули отель ПОТЕРЯЕТ на выбранном тарифе — поимённо и до нажатия.
 *
 * Сравниваем включённое сейчас с тем, что даёт новый тариф. Ручное «включено
 * сверх тарифа» здесь тоже учитывается: именно оно гаснет громче всего, потому
 * что его включали осознанно.
 */
function ModuleLoss({ hotelId, nextModules }: { hotelId: string; nextModules: string[] }) {
  const { t, i18n } = useTranslation();
  const modules = useQuery({
    queryKey: ['admin', 'modules', hotelId],
    queryFn: () => getModules(hotelId),
  });
  if (!modules.data) return null;

  const granted = new Set(nextModules);
  // Название модуля приезжает с сервера переведённым — второго словаря на
  // клиенте заводить нечего, он разошёлся бы с первым.
  const lost = modules.data.modules
    .filter((entry) => entry.is_enabled && !granted.has(entry.code))
    .map((entry) => entry.title[i18n.language] ?? entry.title.en ?? entry.code);
  if (!lost.length) return null;

  return (
    <Typography
      sx={{ ...typo.caption, color: state.warn, mt: 1.25 }}
      data-testid="admin-tariff-module-loss"
    >
      {t('admin.hotel.downgradeModules', { modules: lost.join(', ') })}
    </Typography>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 2,
        py: 0.9,
        ...typo.caption,
        color: ink.mid,
        borderBottom: `1px solid ${surface.hair}`,
      }}
    >
      <span>{label}</span>
      <Box component="b" sx={{ color: ink.hi, fontWeight: 600, textAlign: 'right' }}>
        {value}
      </Box>
    </Box>
  );
}


/* ── Данные отеля: экспорт и офбординг ──────────────────────────────────── */

/**
 * Экспорт и офбординг стоят рядом намеренно: это две стороны одного разговора
 * «отель уходит». Но действия у них разной природы, и разделены они не только
 * кнопками — экспорт обратим и делается сколько угодно раз, удаление требует
 * пометки, ввода поддомена и роли владельца.
 */
function DataTab({ hotel, onRemoved }: { hotel: HotelProfile; onRemoved?: () => void }) {
  const actionFailed = useActionFailed();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const marked = hotel.offboarding;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'hotel', hotel.id] });
    void qc.invalidateQueries({ queryKey: ['admin', 'fleet'] });
  };

  const mark = useMutation({
    mutationFn: () => markOffboarding(hotel.id, reason.trim()),
    onSuccess: refresh,
    onError: (e) => setError(e instanceof Error ? e.message : t('admin.data.markFailed')),
  });
  const cancel = useMutation({
    mutationFn: () => cancelOffboarding(hotel.id),
    onSuccess: refresh,
  
    // Отказ виден: молча съеденный 403 читается как успех.
    onError: actionFailed,
  });
  /*
    РАЗРУШАЮЩЕЕ — ТОЛЬКО ВЛАДЕЛЬЦУ, И НА ДВУХ РУБЕЖАХ.

    Сервер требует OWNER и на очистку, и на удаление строки. Экран до сих пор
    показывал эти кнопки всем, включая роль «только чтение»: человек вводил
    поддомен, жал «Стереть данные» и получал 403. Рубеж на сервере — защита,
    рубеж на экране — честность.
  */
  const me = useQuery({ queryKey: ['admin', 'me'], queryFn: getMe });
  const isOwner = me.data?.role === 'owner';

  const [deleteConfirm, setDeleteConfirm] = useState('');
  const remove = useMutation({
    mutationFn: () => deleteHotel(hotel.id, deleteConfirm.trim()),
    onSuccess: (data) => {
      setResult(t('admin.data.deleted', { subdomain: data.subdomain }));
      setError(null);
      refresh();
      onRemoved?.();
    },
    onError: (e) => setError(e instanceof Error ? e.message : t('admin.data.deleteFailed')),
  });

  const purge = useMutation({
    mutationFn: () => purgeHotel(hotel.id, confirm.trim()),
    onSuccess: (data) => {
      setResult(t('admin.data.purged', { count: Object.values(data.removed).reduce((a, b) => a + b, 0) }));
      setError(null);
      refresh();
    },
    onError: (e) => setError(e instanceof Error ? e.message : t('admin.data.purgeFailed')),
  });

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 1.75 }}
      data-testid="admin-hotel-data">
      <Box sx={panelSx}>
        <Typography sx={{ ...typo.panelTitle, color: ink.hi, mb: 1 }}>
          {t('admin.data.exportTitle')}
        </Typography>
        <Typography sx={{ ...typo.caption, color: ink.mid, mb: 1.75 }}>
          {t('admin.data.exportHint')}
        </Typography>
        <Button
          onClick={() => void downloadHotelExport(hotel.id, hotel.subdomain)}
          data-testid="admin-hotel-export"
          sx={primaryButtonSx}
        >
          {t('admin.data.export')}
        </Button>
      </Box>

      <Box sx={{ ...panelSx, borderColor: `${state.bad}55` }}>
        <Typography sx={{ ...typo.panelTitle, color: state.bad, mb: 1 }}>
          {t('admin.data.offboardTitle')}
        </Typography>
        <Typography sx={{ ...typo.caption, color: ink.mid, mb: 1.75 }}>
          {t('admin.data.offboardHint')}
        </Typography>

        {error ? <Alert severity="error" sx={{ mb: 1.5 }} data-testid="admin-data-error">{error}</Alert> : null}
        {result ? <Alert severity="success" sx={{ mb: 1.5 }} data-testid="admin-data-purged">{result}</Alert> : null}

        {marked ? (
          <>
            <Alert severity="warning" sx={{ mb: 1.5 }} data-testid="admin-data-marked">
              {t('admin.data.marked')}
            </Alert>
            {/* Второй шаг. Поддомен вводят руками: галочку ставят не глядя, а
                имя удаляемого набирают, только посмотрев на него. */}
            <TextField
              size="small"
              fullWidth
              label={t('admin.data.confirmLabel', { subdomain: hotel.subdomain })}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              inputProps={{ 'data-testid': 'admin-data-confirm' }}
            />
            <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
              {isOwner ? (
                <Button
                  disabled={confirm.trim() !== hotel.subdomain || purge.isPending}
                  onClick={() => purge.mutate()}
                  data-testid="admin-data-purge"
                  sx={{ color: state.bad, border: `1px solid ${state.bad}55` }}
                >
                  {t('admin.data.purge')}
                </Button>
              ) : null}
              <Button onClick={() => cancel.mutate()} data-testid="admin-data-cancel" sx={{ color: ink.mid }}>
                {t('admin.data.cancel')}
              </Button>
            </Box>
          </>
        ) : (
          <>
            <TextField
              size="small"
              fullWidth
              label={t('admin.data.reason')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              inputProps={{ 'data-testid': 'admin-data-reason' }}
            />
            <Button
              disabled={reason.trim().length < 3 || mark.isPending}
              onClick={() => mark.mutate()}
              data-testid="admin-data-mark"
              sx={{ mt: 1.5, color: state.warn, border: `1px solid ${state.warn}55` }}
            >
              {t('admin.data.mark')}
            </Button>
          </>
        )}
      </Box>

      {/*
        УДАЛЕНИЕ СТРОКИ — отдельная панель, а не кнопка рядом с очисткой.

        Это разные операции, и путать их дорого: очистка стирает ДАННЫЕ отеля
        (необратимо, по 152-ФЗ), а удаление убирает отель из реестра и
        освобождает поддомен — строка при этом остаётся мягко удалённой, чтобы
        платформа могла ответить, что отель был.
      */}
      {isOwner ? (
        <Box sx={{ ...panelSx, borderColor: `${state.bad}55` }} data-testid="admin-data-delete-panel">
          <Typography sx={{ ...typo.panelTitle, color: state.bad, mb: 1 }}>
            {t('admin.data.deleteTitle')}
          </Typography>
          <Typography sx={{ ...typo.caption, color: ink.mid, mb: 1.75 }}>
            {t('admin.data.deleteHint')}
          </Typography>
          <TextField
            size="small"
            fullWidth
            label={t('admin.data.confirmLabel', { subdomain: hotel.subdomain })}
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            inputProps={{ 'data-testid': 'admin-data-delete-confirm' }}
          />
          <Button
            sx={{ mt: 1.5, color: state.bad, border: `1px solid ${state.bad}55` }}
            disabled={deleteConfirm.trim() !== hotel.subdomain || remove.isPending}
            onClick={() => remove.mutate()}
            data-testid="admin-data-delete"
          >
            {t('admin.data.delete')}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}

/* ── Администраторы отеля ───────────────────────────────────────────────── */

/**
 * КТО ВХОДИТ В CMS ЭТОГО ОТЕЛЯ.
 *
 * Списка не существовало нигде — ни в консоли, ни в API. Опечатка в адресе при
 * заведении молча добавляла ВТОРОГО полноправного администратора: увидеть это
 * было негде, а убрать — нечем.
 *
 * Снятие — право владельца, и последнего сервер не отдаёт: отель остался бы без
 * доступа к своей CMS. Кнопку у последнего не показываем вовсе и говорим почему
 * — предлагать действие, которое всегда откажет, значит врать интерфейсом.
 */
function AdminsPanel({ hotelId }: { hotelId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const actionFailed = useActionFailed();
  const { isOwner } = useRights();

  const admins = useQuery({
    queryKey: ['admin', 'hotel-admins', hotelId],
    queryFn: () => getHotelAdmins(hotelId),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => removeHotelAdmin(hotelId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'hotel-admins', hotelId] }),
    onError: actionFailed,
  });

  const rows = admins.data?.admins ?? [];
  const active = rows.filter((row) => row.is_active);

  return (
    <Box sx={{ ...panelSx, mb: 2.25 }} data-testid="admin-hotel-admins">
      <Typography sx={{ ...typo.panelTitle, color: ink.hi, mb: 1.25 }}>
        {t('admin.hotel.admins.title')}
      </Typography>
      <Typography sx={{ ...typo.caption, color: ink.mid, mb: 1.5 }}>
        {t('admin.hotel.admins.hint')}
      </Typography>

      <QueryState query={admins} what={t('admin.hotel.admins.title')}>
        {(data) =>
          data.admins.length === 0 ? (
            <Typography sx={{ ...typo.caption, color: ink.mid }}>—</Typography>
          ) : (
            <Box>
              {data.admins.map((row) => (
                <Box
                  key={row.id}
                  data-testid={`admin-hotel-admin-${row.id}`}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    py: 1,
                    borderBottom: `1px solid ${surface.hair}`,
                  }}
                >
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography sx={{ ...typo.body, color: ink.hi, wordBreak: 'break-all' }}>
                      {row.email}
                    </Typography>
                    <Typography sx={{ ...typo.caption, color: ink.low }}>
                      {row.last_login
                        ? formatDateTime(row.last_login)
                        : t('admin.hotel.admins.never')}
                    </Typography>
                  </Box>
                  {isOwner && active.length > 1 ? (
                    <Button
                      size="small"
                      onClick={() => remove.mutate(row.id)}
                      disabled={remove.isPending}
                      data-testid={`admin-hotel-admin-remove-${row.id}`}
                      sx={{ color: state.bad, border: `1px solid ${state.bad}55` }}
                    >
                      {t('admin.hotel.admins.remove')}
                    </Button>
                  ) : null}
                </Box>
              ))}
              {active.length <= 1 ? (
                <Typography sx={{ ...typo.caption, color: ink.mid, mt: 1.25 }}
                  data-testid="admin-hotel-admins-last">
                  {t('admin.hotel.admins.lastHint')}
                </Typography>
              ) : null}
            </Box>
          )
        }
      </QueryState>
    </Box>
  );
}
