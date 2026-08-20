import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { QueryState } from '@/components/QueryState';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';

import { ApiError } from '@/api/client';
import {
  assignItemBadges,
  createItem,
  fetchAllergens,
  fetchBadges,
  fetchCategories,
  fetchItem,
  fetchMarkers,
  putItemImages,
  updateItem,
} from '@/api/cms';
import { queryKeys } from '@/api/queryKeys';
import type { CmsCharacteristic, Item, Translated } from '@/api/types';
import { badgeRoleColor } from '@/kit/chips';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  ImageUploader,
  mediaToEditable,
  persistableImageIds,
  type EditableImage,
} from '@/components/ImageUploader';
import { SchedulePicker } from '@/components/SchedulePicker';
import { TranslatedField } from '@/components/TranslatedField';
import { useToast } from '@/components/ToastProvider';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';
import { useFormDraft } from '@/hooks/useFormDraft';
import { useAuth } from '@/auth';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { flattenCategories } from '@/utils/categories';
import { currencySymbol, inputToMinor, minorToInput } from '@/utils/money';
import { compactTranslated, pickTranslated } from '@/utils/translated';
import {
  LOCATION_MODES,
  behaviourFor,
  isLocationMode,
  isOfferingType,
  OFFERING_TYPES,
  type LocationMode,
  type OfferingType,
} from '@/offerings/behaviour';
import { ModifierGroupsEditor } from './ModifierGroupsEditor';
import { RequestFieldsEditor } from './RequestFieldsEditor';
import { SlotConfigEditor } from './SlotConfigEditor';
import {
  groupsToDrafts,
  syncModifierGroups,
  validateGroups,
  type DraftGroup,
} from './modifierDrafts';
import {
  fieldsToDrafts,
  syncRequestFields,
  validateFields,
  type DraftField,
} from './requestFieldDrafts';

interface ItemForm {
  category_id: string;
  /** Chosen at creation, immutable afterwards (`422 type_immutable`). */
  type: OfferingType;
  location_mode: LocationMode;
  title: Translated;
  description: Translated;
  /** Body of an `info` offering — translatable markup-ish text. */
  content: Translated;
  /** Kept as typed text; an empty box means "price not set", not zero. */
  priceInput: string;
  is_active: boolean;
  in_stock: boolean;
  /** Assigned from the tenant dictionaries (join). */
  allergen_ids: string[];
  marker_ids: string[];
  characteristics: CmsCharacteristic[];
  schedule_id: string | null;
  /** Prep/serving time in minutes as typed text; empty = not set. */
  prepInput: string;
}

/** Снимок редактируемого состояния — база для трёхстороннего слияния. */
interface MergeBase {
  form: ItemForm;
  images: string[];
  groups: DraftGroup[];
  fields: DraftField[];
  badgeIds: string[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * СЛИЯНИЕ ПО ПОЛЯМ, А НЕ ПО ФОРМЕ ЦЕЛИКОМ.
 *
 * Три точки: `base` — то, что мы в последний раз отдали серверу или получили
 * от него; `current` — что на экране сейчас; `incoming` — что пришло в ответе.
 *
 * Правило одно и на каждое поле своё: поле, которое человек ТРОГАЛ после
 * отправки (`current` разошлось с `base`), остаётся его — ответ его не
 * касается. Поле, которого не трогали, обновляется из ответа: так доезжает
 * нормализация сервера (сгенерированные коды, `single ⇒ max_choices=1`).
 *
 * Почему не «грязная форма — не трогаем целиком»: так решали дважды, и оба
 * раза упирались в ямы. Либо форма оставалась грязной навсегда (baseline
 * не обновлялся, метка «не сохранено» не гасла), либо правка уходила на
 * сервер, а на экране оставалась старая цифра. Обе ямы от того, что решение
 * принималось одно на всю форму, а вопрос стоит по каждому полю отдельно.
 */
function mergeFromServer<T extends object>(base: T, current: T, incoming: T): T {
  const merged = { ...incoming };
  for (const key of Object.keys(incoming) as (keyof T)[]) {
    // Человек изменил это поле после отправки — оно его, ответ не спорит.
    if (!same(current[key], base[key])) merged[key] = current[key];
  }
  return merged;
}

function emptyForm(categoryId: string, type: OfferingType = 'product'): ItemForm {
  const behaviour = behaviourFor(type);
  return {
    category_id: categoryId,
    type,
    location_mode: behaviour.defaultLocationMode,
    title: {},
    description: {},
    content: {},
    // An unpriced offering is normal for a service, so it starts empty there.
    priceInput: behaviour.priced === 'always' ? '0.00' : '',
    is_active: true,
    in_stock: true,
    allergen_ids: [],
    marker_ids: [],
    characteristics: [],
    schedule_id: null,
    prepInput: '',
  };
}

function formFromItem(item: Item, minorUnits: number): ItemForm {
  const type = isOfferingType(item.type) ? item.type : 'product';
  return {
    category_id: item.category_id,
    type,
    location_mode: isLocationMode(item.location_mode)
      ? item.location_mode
      : behaviourFor(type).defaultLocationMode,
    title: { ...item.title },
    description: { ...(item.description ?? {}) },
    content: { ...(item.content ?? {}) },
    priceInput: item.price === null || item.price === undefined
      ? ''
      : minorToInput(item.price, minorUnits),
    is_active: item.is_active,
    in_stock: item.in_stock,
    allergen_ids: [...(item.allergen_ids ?? [])],
    marker_ids: [...(item.marker_ids ?? [])],
    characteristics: (item.characteristics ?? []).map((c) => ({
      name: { ...c.name },
      value: { ...c.value },
    })),
    schedule_id: item.schedule_id ?? null,
    prepInput:
      item.prep_minutes === null || item.prep_minutes === undefined
        ? ''
        : String(item.prep_minutes),
  };
}

/** Item badges (id + order) → an ordered list of badge ids for the form. */
function badgeIdsFromItem(item: Item): string[] {
  return [...(item.badges ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((link) => link.id);
}

export function ItemEditorPage() {
  const { t } = useTranslation();
  const { id: routeId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [itemId, setItemId] = useState<string | null>(routeId ?? null);
  const isNew = !itemId;

  const { data: bootstrap, isLoading: bootstrapLoading } = useBootstrap();
  const languages = useContentLanguages(bootstrap);
  const minorUnits = bootstrap?.hotel.currency_minor_units ?? 100;

  const categoriesQuery = useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => fetchCategories(),
  });
  const flatCategories = useMemo(
    () => flattenCategories(categoriesQuery.data ?? []),
    [categoriesQuery.data],
  );

  const itemQuery = useQuery({
    queryKey: queryKeys.item(itemId ?? ''),
    queryFn: () => fetchItem(itemId as string),
    enabled: Boolean(itemId),
  });

  const badgesQuery = useQuery({ queryKey: queryKeys.badges, queryFn: fetchBadges });
  const activeBadges = useMemo(
    () => (badgesQuery.data ?? []).filter((badge) => badge.is_active),
    [badgesQuery.data],
  );

  const allergensQuery = useQuery({ queryKey: queryKeys.allergens, queryFn: fetchAllergens });
  const markersQuery = useQuery({ queryKey: queryKeys.markers, queryFn: fetchMarkers });
  const activeAllergens = useMemo(
    () => (allergensQuery.data ?? []).filter((a) => a.is_active),
    [allergensQuery.data],
  );
  const activeMarkers = useMemo(
    () => (markersQuery.data ?? []).filter((m) => m.is_active),
    [markersQuery.data],
  );

  const [form, setForm] = useState<ItemForm>(() =>
    emptyForm(
      searchParams.get('category_id') ?? '',
      isOfferingType(searchParams.get('type')) ? (searchParams.get('type') as OfferingType) : 'product',
    ),
  );
  const [images, setImages] = useState<EditableImage[]>([]);
  const [groups, setGroups] = useState<DraftGroup[]>([]);
  const [fields, setFields] = useState<DraftField[]>([]);
  const [badgeIds, setBadgeIds] = useState<string[]>([]);
  const [baseline, setBaseline] = useState<string>('');
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [activeLanguage, setActiveLanguage] = useState<string | undefined>();
  const dirtyRef = useRef(false);
  const hydratedIdRef = useRef<string | null>(null);

  /*
    ЧТО МЫ В ПОСЛЕДНИЙ РАЗ ОТДАЛИ/ПОЛУЧИЛИ ОТ СЕРВЕРА — база для слияния.

    Ответ сервера НИКОГДА не затирает поле, которого человек касался после
    отправки. Чтобы это решить, нужна третья точка отсчёта помимо «что на
    экране» и «что пришло»: то, от чего экран отсчитывает изменения. Ей и
    служит эта ссылка.

    Обновляется в двух местах: при гидратации (пришли новые данные) и в начале
    сохранения (мы отдали серверу текущее состояние). Второе и делает правило
    правилом «после ОТПРАВКИ», а не «после последнего ответа».
  */
  const lastServerRef = useRef<MergeBase | null>(null);

  /*
    Идёт ли наша собственная запись прямо сейчас.

    Пока сохранение в полёте, ЛЮБЫЕ данные позиции, лежащие в кэше, заведомо
    старее того, что мы уже отправили: часть записи (группы модификаторов,
    поля запроса, картинки) уходит отдельными запросами ПОСЛЕ основного
    `PATCH`. Гидратировать из них — значит откатывать форму к состоянию «до
    сохранения» ровно в середине сохранения. На этом терялась только что
    добавленная группа модификаторов: форма очищалась, метка «не сохранено»
    гасла раньше времени, а тест успевал прочитать позицию до записи групп.
  */
  const savingRef = useRef(false);

  /**
   * Запомнить, что именно уходит на сервер. Всё, набранное ПОСЛЕ этого
   * момента, разойдётся с базой и переживёт ответ.
   */
  /*
    БАЗА СЛИЯНИЯ СДВИГАЕТСЯ В МОМЕНТ ОТПРАВКИ — и снимок берётся при НАЖАТИИ,
    а не внутри мутации.

    Отсюда «после отправки» в правиле: всё, что человек наберёт начиная с этой
    секунды, разойдётся с базой и переживёт оба ответа сервера. То, что он
    правил ДО нажатия, с базой совпадёт — и ответ законно положит поверх
    нормализованную серверную версию.

    Именно при нажатии, потому что `mutate()` ставит работу в очередь: тело
    мутации выполняется асинхронно, и за это время успевает пройти следующее
    нажатие клавиши. Снимок, сделанный там, захватывал бы уже набранное как
    «то, что мы отправили».
  */
  const markSubmitted = useCallback(() => {
    savingRef.current = true;
    lastServerRef.current = {
      form: formRef.current,
      images: imagesRef.current.map((image) => image.id),
      groups: groupsRef.current,
      fields: fieldsRef.current,
      badgeIds: badgeIdsRef.current,
    };
  }, []);

  /*
    Текущее состояние формы, доступное эффекту гидратации без подписки на него.

    Через зависимости эффекта это не сделать: он бы перезапускался на каждое
    нажатие клавиши. Ссылки обновляются в рендере — тот же приём, что у
    `dirtyRef` строкой ниже.
  */
  const formRef = useRef(form);
  const imagesRef = useRef(images);
  const groupsRef = useRef(groups);
  const fieldsRef = useRef(fields);
  const badgeIdsRef = useRef(badgeIds);

  /*
    ЧЕРНОВИК. Сессия может умереть посреди правки — и до этого форма
    размонтировалась вместе с набранным текстом. Ключ включает пользователя:
    на общем компьютере чужое не всплывёт.
  */
  const { user } = useAuth();
  const draft = useFormDraft<{
    form: ItemForm;
    groups: DraftGroup[];
    fields: DraftField[];
    badgeIds: string[];
  }>({
    scope: 'cms',
    userId: user?.id,
    screen: `item:${routeId ?? 'new'}`,
  });
  const draftAppliedRef = useRef(false);
  /*
    Сохранение прошло, а свежие данные ещё не приехали.

    В этом окне форма ВСЁ ЕЩЁ считается грязной — baseline остался от прежних
    значений, — и эффект записи успевал вернуть черновик сразу после того, как
    его стёрли. Флаг держит запись выключенной, пока baseline не догонит; его
    снимает та же гидратация, что и обновляет baseline.
  */
  const justSavedRef = useRef(false);

  /** Snapshot used for the "unsaved changes" indicator. */
  const snapshot = useMemo(
    () => JSON.stringify({ form, images: persistableImageIds(images), groups, fields, badgeIds }),
    [form, images, groups, fields, badgeIds],
  );

  /**
   * The ONE switch of this editor. Which body an item has — modifier groups or
   * request fields — and whether its price may be empty is read from the
   * behaviour registry, not decided by conditions scattered over the form.
   */
  const behaviour = behaviourFor(form.type);

  /*
    Гидратация из загруженной позиции — СЛИЯНИЕМ, а не заменой.

    После сохранения позиция перечитывается ДВАЖДЫ: один раз от инвалидации по
    префиксу `['cms','items']` (ключ позиции `['cms','items','detail',id]`
    попадает под него), второй — явным запросом самого ключа. Оба ответа
    приезжают уже после того, как человек мог начать править, и прежний код
    честно клал их поверх формы: набранное жило около полусекунды и заменялось
    серверным.

    Теперь ответ применяется ПО ПОЛЯМ. Что человек тронул после отправки —
    остаётся его; чего не трогал — обновляется, и нормализация сервера доезжает
    как раньше. `baseline` при этом всегда считается от СЕРВЕРНОЙ версии: он
    отвечает на вопрос «что сохранено», а не «что на экране», и потому метка
    «не сохранено» гаснет ровно тогда, когда сохранять действительно нечего.
  */
  useEffect(() => {
    const item = itemQuery.data;
    if (!item) return;
    // Наша запись в полёте — то, что в кэше, старее её. Дождёмся ответа.
    if (savingRef.current) return;
    // Другая позиция — базы для слияния нет, кладём ответ целиком.
    if (hydratedIdRef.current !== item.id) lastServerRef.current = null;
    hydratedIdRef.current = item.id;
    // Свежие данные пришли — baseline сейчас догонит, запись черновика снова
    // имеет смысл.
    justSavedRef.current = false;
    const serverForm = formFromItem(item, minorUnits);
    const nextImages = (item.images ?? []).map(mediaToEditable);
    const serverGroups = groupsToDrafts(item.modifier_groups, minorUnits);
    const serverFields = fieldsToDrafts(item.request_fields);
    const serverBadgeIds = badgeIdsFromItem(item);

    const base = lastServerRef.current;
    const nextForm = base
      ? mergeFromServer(base.form, formRef.current, serverForm)
      : serverForm;
    /*
      Коллекции сравниваются целиком, а не по элементам, и это осознанно.
      Список модификаторов правят как одно целое — добавили вариант, сменили
      порядок; «слить по элементам» здесь означало бы угадывать, какой вариант
      чьей правкой является, а угадывать в редакторе меню нельзя.
    */
    const keep = <T,>(baseValue: T, currentValue: T, incoming: T): T =>
      base && !same(currentValue, baseValue) ? currentValue : incoming;
    const nextGroups = keep(base?.groups ?? serverGroups, groupsRef.current, serverGroups);
    const nextFields = keep(base?.fields ?? serverFields, fieldsRef.current, serverFields);
    const nextBadgeIds = keep(base?.badgeIds ?? serverBadgeIds, badgeIdsRef.current, serverBadgeIds);
    const nextImagesMerged = keep(
      base?.images ?? nextImages.map((image) => image.id),
      imagesRef.current.map((image) => image.id),
      nextImages.map((image) => image.id),
    );
    const imagesUnchanged = same(nextImagesMerged, nextImages.map((image) => image.id));

    setForm(nextForm);
    if (imagesUnchanged) setImages(nextImages);
    setGroups(nextGroups);
    setFields(nextFields);
    setBadgeIds(nextBadgeIds);

    // База слияния — то, что пришло с сервера: следующий ответ отсчитывается
    // от него, а не от того, что человек уже успел набрать.
    lastServerRef.current = {
      form: serverForm,
      images: nextImages.map((image) => image.id),
      groups: serverGroups,
      fields: serverFields,
      badgeIds: serverBadgeIds,
    };

    setBaseline(
      JSON.stringify({
        form: serverForm,
        images: nextImages.map((image) => image.id),
        groups: serverGroups,
        fields: serverFields,
        badgeIds: serverBadgeIds,
      }),
    );

    // Отложенное возвращается ПОВЕРХ пришедшего с сервера — иначе оно
    // потерялось бы ровно в тот момент, когда его и восстанавливают. Один
    // раз на открытие экрана: дальше правит человек.
    if (!draftAppliedRef.current) {
      draftAppliedRef.current = true;
      const kept = draft.restore();
      if (kept) {
        setForm(kept.form);
        setGroups(kept.groups);
        setFields(kept.fields);
        setBadgeIds(kept.badgeIds);
      }
    }
  }, [itemQuery.data, minorUnits, draft]);

  // Preselect the category for a brand-new item.
  useEffect(() => {
    if (!isNew || form.category_id || flatCategories.length === 0) return;
    const preset = searchParams.get('category_id');
    setForm((prev) => ({
      ...prev,
      category_id: preset || flatCategories[0].category.id,
    }));
  }, [isNew, form.category_id, flatCategories, searchParams]);

  // Seed the baseline of a new item once its category has been preselected,
  // so the freshly opened form does not immediately look "dirty".
  useEffect(() => {
    if (!isNew || baseline || !form.category_id) return;
    setBaseline(JSON.stringify({ form, images: [], groups: [], fields: [], badgeIds: [] }));
  }, [isNew, baseline, form]);

  const isDirty = baseline !== '' && snapshot !== baseline;
  dirtyRef.current = isDirty;
  // Зеркала состояния для эффекта гидратации: он читает их, а не подписывается.
  formRef.current = form;
  imagesRef.current = images;
  groupsRef.current = groups;
  fieldsRef.current = fields;
  badgeIdsRef.current = badgeIds;

  /*
    ЧЕРНОВИК: поднять отложенное и писать новое.

    Для НОВОЙ позиции подъём идёт здесь — у неё нет ответа сервера, после
    которого можно было бы встроиться, зато есть момент, когда выставлен
    baseline. Для существующей подъём уже случился при гидратации.
  */
  useEffect(() => {
    if (draftAppliedRef.current || !isNew || !baseline) return;
    draftAppliedRef.current = true;
    const kept = draft.restore();
    if (kept) {
      setForm(kept.form);
      setGroups(kept.groups);
      setFields(kept.fields);
      setBadgeIds(kept.badgeIds);
    }
  }, [isNew, baseline, draft]);

  // Пишем, пока есть несохранённое. Картинки не кладём: они уже на сервере и
  // живут своими идентификаторами, копировать их в черновик незачем.
  useEffect(() => {
    if (!draftAppliedRef.current || justSavedRef.current) return;
    // ИНВАРИАНТ: черновик существует ровно тогда, когда есть несохранённое.
    // Держать его «до следующего сохранения» не выйдет — форма считается
    // чистой не мгновенно, а когда доедут свежие данные, и в это окно запись
    // успевала вернуть только что стёртое. Симметричная пара save/discard в
    // одном эффекте закрывает окно с обеих сторон.
    if (isDirty) draft.save({ form, groups, fields, badgeIds });
    else draft.discard();
  }, [isDirty, form, groups, fields, badgeIds, draft]);

  /* ── Validation ─────────────────────────────────────────────────────── */

  const parsePrice = useCallback(
    (value: string) => inputToMinor(value, minorUnits),
    [minorUnits],
  );

  /** An empty box is `null` ("price not set"), not a parse failure. */
  const priceEmpty = !form.priceInput.trim();
  const priceMinor = priceEmpty ? null : parsePrice(form.priceInput);

  const formErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (!form.category_id) errors.category_id = t('validation.categoryRequired');
    if (!form.title[languages.defaultCode]?.trim()) {
      errors.title = t('validation.titleRequiredIn', {
        language: languages.labels[languages.defaultCode] ?? languages.defaultCode,
      });
    }
    if (priceEmpty) {
      // "Priced always" vs "priced optionally" is a property of the type, and
      // the registry is the one that knows it.
      if (behaviour.priced === 'always') errors.price = t('validation.priceRequired');
    } else if (priceMinor === null) errors.price = t('validation.priceInvalid');
    else if (priceMinor < 0) errors.price = t('validation.priceNegative');
    if (form.prepInput.trim()) {
      const prep = Number(form.prepInput);
      if (!Number.isInteger(prep) || prep < 0) errors.prep_minutes = t('item.prepInvalid');
    }
    return { ...errors, ...serverErrors };
  }, [form, languages, priceEmpty, priceMinor, behaviour, serverErrors, t]);

  const modifierErrors = useMemo(() => {
    const grouped: Record<string, Record<string, string>> = {};
    if (!behaviour.usesModifiers) return grouped;
    for (const error of validateGroups(groups, languages.defaultCode, parsePrice)) {
      grouped[error.target] = {
        ...grouped[error.target],
        [error.field]: t(error.messageKey),
      };
    }
    return grouped;
  }, [behaviour, groups, languages.defaultCode, parsePrice, t]);

  const requestFieldErrors = useMemo(() => {
    const grouped: Record<string, Record<string, string>> = {};
    if (!behaviour.usesFields) return grouped;
    for (const error of validateFields(fields, languages.defaultCode)) {
      grouped[error.target] = {
        ...grouped[error.target],
        [error.field]: t(error.messageKey),
      };
    }
    return grouped;
  }, [behaviour, fields, languages.defaultCode, t]);

  const isValid =
    Object.keys(formErrors).length === 0 &&
    Object.keys(modifierErrors).length === 0 &&
    Object.keys(requestFieldErrors).length === 0;

  /* ── Save ───────────────────────────────────────────────────────────── */

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        category_id: form.category_id,
        title: compactTranslated(form.title),
        description: compactTranslated(form.description),
        // Empty for every non-info type; the registry decides who edits it.
        content: compactTranslated(form.content),
        location_mode: form.location_mode,
        price: priceMinor,
        allergen_ids: form.allergen_ids,
        marker_ids: form.marker_ids,
        characteristics: form.characteristics
          .map((c) => ({ name: compactTranslated(c.name), value: compactTranslated(c.value) }))
          .filter((c) => Object.keys(c.name).length && Object.keys(c.value).length),
        schedule_id: form.schedule_id,
        is_active: form.is_active,
        in_stock: form.in_stock,
        prep_minutes: form.prepInput.trim() ? Number(form.prepInput) : null,
      };

      // `type` travels only on creation: the server answers 422 `type_immutable`
      // to a change, and an item that switched type would orphan its body.
      const saved = itemId
        ? await updateItem(itemId, payload)
        : await createItem({ ...payload, type: form.type });

      const imageIds = persistableImageIds(images);
      const originalImageIds = (itemQuery.data?.images ?? []).map((image) => image.id);
      if (
        imageIds.length !== originalImageIds.length ||
        imageIds.some((id, index) => id !== originalImageIds[index])
      ) {
        await putItemImages(saved.id, imageIds);
      }

      // The body an item does not have is never touched: a service has no
      // modifier groups to sync, a dish has no request fields.
      if (behaviour.usesModifiers) {
        await syncModifierGroups(
          saved.id,
          groups,
          itemQuery.data?.modifier_groups ?? [],
          (value) => parsePrice(value) ?? 0,
        );
      }
      if (behaviour.usesFields) {
        await syncRequestFields(saved.id, fields, itemQuery.data?.request_fields ?? []);
      }

      // Badges are a replace-the-set operation, like images: PUT only when the
      // ordered id list actually changed.
      const originalBadgeIds = badgeIdsFromItem(itemQuery.data ?? ({ badges: [] } as unknown as Item));
      if (
        badgeIds.length !== originalBadgeIds.length ||
        badgeIds.some((id, index) => id !== originalBadgeIds[index])
      ) {
        await assignItemBadges(saved.id, badgeIds);
      }

      return saved;
    },
    onSuccess: async (saved) => {
      setServerErrors({});
      toast.show(t('item.saved'), 'success');

      /*
        Сброса `hydratedIdRef` здесь БОЛЬШЕ НЕТ, и это существенно.

        Он появился при прежней схеме, где регидратация пропускалась у любой
        грязной формы: обнуление ссылки было единственным способом впустить
        ответ сервера с нормализацией. Со слиянием по полям такой пропуск не
        нужен — нетронутые поля и так берутся из ответа.

        А вред от него был прямой: эффект видел обнулённую ссылку как переход
        на ДРУГУЮ позицию, сбрасывал базу слияния и клал ответ поверх формы
        целиком. Ровно на этом терялось набранное сразу после сохранения:
        база исчезала, и «человек это трогал» становилось неотличимо от
        «пришло с сервера».
      */
      dirtyRef.current = false;
      // Сохранили — черновик отслужил. Оставить его значило бы однажды
      // «вернуть» правки поверх уже сохранённого.
      justSavedRef.current = true;
      draft.discard();
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
      void queryClient.invalidateQueries({ queryKey: ['cms', 'items'] });

      if (!itemId) {
        /*
          Новая позиция стала существующей — адрес следует за ней.

          Заодно СРАЗУ отмечаем её как уже гидратированную. Иначе смена
          `itemId` выглядит для эффекта как переход на другую позицию, а на
          переходе база слияния обнуляется — и первый же ответ ложится
          поверх формы целиком. Терялось на этом не что-нибудь, а работа,
          сделанная сразу после создания: добавленная группа модификаторов
          исчезала, потому что сервер её ещё не знал, а локальную версию
          обнулённая база защитить не могла.
        */
        hydratedIdRef.current = saved.id;
        setItemId(saved.id);
        navigate(`/cms/menu/items/${saved.id}`, { replace: true });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.item(saved.id) });
    },
    onSettled: () => {
      // Запись кончилась — ответам снова можно верить.
      savingRef.current = false;
    },
    onError: (error) => {
      if (error instanceof ApiError && error.isValidation && error.field) {
        setServerErrors({ [error.field]: error.detail });
        toast.show(error.detail, 'error');
        return;
      }
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');
    },
  });

  const guard = useUnsavedChangesGuard(isDirty && !saveMutation.isPending);

  const toggleCode = (list: string[], code: string) =>
    list.includes(code) ? list.filter((entry) => entry !== code) : [...list, code];

  if (bootstrapLoading || (itemId && itemQuery.isLoading)) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton variant="rounded" height={64} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={420} />
      </Box>
    );
  }

  if (!bootstrap) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{t('errors.loadBootstrap')}</Alert>
      </Box>
    );
  }

  if (itemId && itemQuery.isError) {
    return (
      <Box sx={{ p: 3 }}>
        <QueryState query={itemQuery} what={t('state.what.item')}>
          {() => null}
        </QueryState>
      </Box>
    );
  }

  // Без разделов позицию некуда положить: `categoriesQuery.data ?? []`
  // превращал несостоявшийся ответ в пустой выпадающий список, и редактор
  // молча предлагал заполнить форму, которую всё равно не сохранить.
  if (categoriesQuery.isError || categoriesQuery.data === undefined) {
    return (
      <Box sx={{ p: 3 }}>
        <QueryState query={categoriesQuery} what={t('state.what.category')}>
          {() => null}
        </QueryState>
      </Box>
    );
  }

  const currency = currencySymbol(bootstrap.hotel.currency, languages.displayLanguage);

  return (
    <Box sx={{ p: 3, pb: 10 }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/cms/menu')}
          data-testid="item-back-button"
        >
          {t('common.back')}
        </Button>
        <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h5" noWrap>
            {isNew
              ? t('item.newTitle')
              : pickTranslated(form.title, languages.displayLanguage, languages.defaultCode) ||
                t('item.untitled')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {isDirty ? t('editor.unsaved') : t('editor.saved')}
          </Typography>
        </Stack>
        {isDirty ? (
          <Chip size="small" color="warning" label={t('editor.unsavedBadge')} data-testid="item-dirty-badge" />
        ) : null}
        <Button
          variant="contained"
          size="large"
          disabled={!isValid || !isDirty || saveMutation.isPending}
          onClick={() => {
            /*
              Снимок базы слияния берётся ЗДЕСЬ, а не внутри мутации.

              `mutate()` ставит работу в очередь, и её тело выполняется уже
              асинхронно — за это время человек успевает набрать следующий
              символ. Снимок, сделанный там, захватывал бы это набранное как
              «то, что мы отправили», и ответ сервера законно клал бы поверх
              него свою версию. Нажатие — единственный момент, про который
              точно известно: вот это состояние и уходит на сервер.
            */
            markSubmitted();
            saveMutation.mutate();
          }}
          data-testid="item-save-button"
          startIcon={
            saveMutation.isPending ? <CircularProgress size={16} color="inherit" /> : undefined
          }
        >
          {t('common.save')}
        </Button>
      </Stack>

      <Stack direction="row" spacing={3} alignItems="flex-start">
        <Stack spacing={3} sx={{ flexGrow: 1, minWidth: 0 }}>
          {/* Basics */}
          <Card variant="outlined" sx={{ borderColor: 'divider' }}>
            <CardContent>
              <Stack spacing={2.5}>
                <Typography variant="subtitle1">{t('item.basics')}</Typography>

                {/*
                  Type is picked once, at creation. Afterwards the control stays
                  visible but disabled: the editor must SHOW what kind of item
                  this is, and the server refuses to change it anyway.
                */}
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary">
                    {t('item.type')}
                  </Typography>
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    color="primary"
                    value={form.type}
                    disabled={!isNew}
                    onChange={(_event, value: OfferingType | null) => {
                      if (!value) return;
                      setForm((prev) => ({
                        ...prev,
                        type: value,
                        // The default comes from the registry; the hotel may
                        // still override it right below.
                        location_mode: behaviourFor(value).defaultLocationMode,
                        // Keep a typed price only where the type still charges;
                        // an optional/never-priced type starts with an empty box.
                        priceInput:
                          behaviourFor(value).priced === 'always' ? prev.priceInput : '',
                      }));
                    }}
                  >
                    {OFFERING_TYPES.map((type) => (
                      <ToggleButton
                        key={type}
                        value={type}
                        data-testid={`cms-item-type-${type}`}
                        sx={{ minHeight: 40, px: 2 }}
                      >
                        {t(`item.types.${type}`)}
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                  <Typography variant="caption" color="text.secondary">
                    {isNew ? t('item.typeHint') : t('item.typeLocked')}
                  </Typography>
                </Stack>

                <TranslatedField
                  label={t('item.title')}
                  value={form.title}
                  onChange={(title) => setForm((prev) => ({ ...prev, title }))}
                  languages={languages.codes}
                  languageLabels={languages.labels}
                  defaultLanguage={languages.defaultCode}
                  required
                  error={formErrors.title}
                  testId="item-title-input"
                  activeLanguage={activeLanguage}
                  onActiveLanguageChange={setActiveLanguage}
                />

                <TranslatedField
                  label={t('item.description')}
                  value={form.description}
                  onChange={(description) => setForm((prev) => ({ ...prev, description }))}
                  languages={languages.codes}
                  languageLabels={languages.labels}
                  defaultLanguage={languages.defaultCode}
                  multiline
                  testId="item-description-input"
                  activeLanguage={activeLanguage}
                  onActiveLanguageChange={setActiveLanguage}
                />

                <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                  <TextField
                    select
                    size="small"
                    label={t('item.category')}
                    value={form.category_id}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, category_id: event.target.value }))
                    }
                    error={Boolean(formErrors.category_id)}
                    helperText={formErrors.category_id}
                    sx={{ minWidth: 260 }}
                    inputProps={{ 'data-testid': 'item-category-select' }}
                  >
                    {flatCategories.map(({ category, depth }) => (
                      <MenuItem key={category.id} value={category.id}>
                        {`${' '.repeat(depth * 3)}${
                          pickTranslated(
                            category.title,
                            languages.displayLanguage,
                            languages.defaultCode,
                          ) || category.code
                        }`}
                      </MenuItem>
                    ))}
                  </TextField>

                  {/* Location mode only exists for the types that route to a
                      place — a booking uses its department, an info page none. */}
                  {behaviour.configuresLocation ? (
                    <TextField
                      select
                      size="small"
                      label={t('item.locationMode')}
                      value={form.location_mode}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          location_mode: event.target.value as LocationMode,
                        }))
                      }
                      helperText={t(`item.locationModes.${form.location_mode}Hint`)}
                      sx={{ minWidth: 220 }}
                      SelectProps={{ native: true }}
                      InputLabelProps={{ shrink: true }}
                      inputProps={{ 'data-testid': 'cms-location-mode' }}
                    >
                      {LOCATION_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {t(`item.locationModes.${mode}`)}
                        </option>
                      ))}
                    </TextField>
                  ) : null}

                  {/* An info page has no price at all — the box is hidden, not
                      shown empty. Slots and services keep it (optionally). */}
                  {behaviour.priced !== 'never' ? (
                    <TextField
                      size="small"
                      label={t('item.price')}
                      value={form.priceInput}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, priceInput: event.target.value }))
                      }
                      error={Boolean(formErrors.price)}
                      helperText={
                        formErrors.price ??
                        (behaviour.priced === 'optional'
                          ? t('item.priceOptionalHint')
                          : t('item.priceHint'))
                      }
                      sx={{ width: 200 }}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">{currency}</InputAdornment>
                        ),
                      }}
                      inputProps={{ 'data-testid': 'item-price-input', inputMode: 'decimal' }}
                    />
                  ) : null}

                  <TextField
                    size="small"
                    type="number"
                    label={t('item.prepMinutes')}
                    value={form.prepInput}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, prepInput: event.target.value }))
                    }
                    error={Boolean(formErrors.prep_minutes)}
                    helperText={formErrors.prep_minutes ?? t('item.prepMinutesHint')}
                    sx={{ width: 200 }}
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position="end">{t('item.minutesUnit')}</InputAdornment>
                      ),
                    }}
                    inputProps={{ 'data-testid': 'cms-item-prep-minutes', min: 0, step: 1 }}
                  />

                  <FormControlLabel
                    control={
                      <Switch
                        checked={form.is_active}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, is_active: event.target.checked }))
                        }
                        inputProps={
                          { 'data-testid': 'item-active-switch' } as Record<string, string>
                        }
                      />
                    }
                    label={t('item.active')}
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        color="success"
                        checked={form.in_stock}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, in_stock: event.target.checked }))
                        }
                        inputProps={
                          { 'data-testid': 'item-stock-switch' } as Record<string, string>
                        }
                      />
                    }
                    label={t('item.inStock')}
                  />
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          {/*
            Item body — ONE card, one content chosen by the registry flags and
            nothing else. A dish is configured with modifier groups, a service
            with the fields of its request form, an info page with its content,
            a slot with its booking config.
          */}
          <Card variant="outlined" sx={{ borderColor: 'divider' }}>
            <CardContent>
              {behaviour.usesModifiers ? (
                <ModifierGroupsEditor
                  groups={groups}
                  onChange={setGroups}
                  languages={languages.codes}
                  languageLabels={languages.labels}
                  defaultLanguage={languages.defaultCode}
                  currencySymbol={currency}
                  errors={modifierErrors}
                />
              ) : null}
              {behaviour.usesFields ? (
                <RequestFieldsEditor
                  fields={fields}
                  onChange={setFields}
                  languages={languages.codes}
                  languageLabels={languages.labels}
                  defaultLanguage={languages.defaultCode}
                  errors={requestFieldErrors}
                />
              ) : null}
              {behaviour.usesContent ? (
                <Stack spacing={1}>
                  <Typography variant="subtitle1">{t('item.contentSection')}</Typography>
                  <TranslatedField
                    label={t('item.content')}
                    value={form.content}
                    onChange={(content) => setForm((prev) => ({ ...prev, content }))}
                    languages={languages.codes}
                    languageLabels={languages.labels}
                    defaultLanguage={languages.defaultCode}
                    multiline
                    rows={10}
                    helperText={t('item.contentHint')}
                    testId="cms-info-content"
                    activeLanguage={activeLanguage}
                    onActiveLanguageChange={setActiveLanguage}
                  />
                </Stack>
              ) : null}
              {behaviour.usesSlots ? (
                <SlotConfigEditor
                  itemId={itemId}
                  schedules={bootstrap.schedules}
                  executionPoints={bootstrap.execution_points}
                  dayParts={bootstrap.day_parts}
                  displayLanguage={languages.displayLanguage}
                  fallbackLanguage={languages.defaultCode}
                />
              ) : null}
            </CardContent>
          </Card>
        </Stack>

        {/* Side column */}
        <Stack spacing={3} sx={{ width: 380, flexShrink: 0 }}>
          <Card variant="outlined" sx={{ borderColor: 'divider' }}>
            <CardContent>
              <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
                {t('item.photos')}
              </Typography>
              <ImageUploader value={images} onChange={setImages} kind="item" surface="item" />
            </CardContent>
          </Card>

          <Card variant="outlined" sx={{ borderColor: 'divider' }} data-testid="cms-item-facets">
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="subtitle1">{t('item.allergens')}</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {activeAllergens.map((allergen) => {
                    const selected = form.allergen_ids.includes(allergen.id);
                    return (
                      <Chip
                        key={allergen.id}
                        label={
                          pickTranslated(allergen.title, languages.displayLanguage, languages.defaultCode) ||
                          allergen.code
                        }
                        color={selected ? 'warning' : 'default'}
                        variant={selected ? 'filled' : 'outlined'}
                        onClick={() =>
                          setForm((prev) => ({ ...prev, allergen_ids: toggleCode(prev.allergen_ids, allergen.id) }))
                        }
                        data-testid={`item-allergen-${allergen.code}`}
                      />
                    );
                  })}
                  {activeAllergens.length === 0 ? (
                    <Typography variant="caption" color="text.secondary">
                      {t('item.noAllergens')}
                    </Typography>
                  ) : null}
                </Stack>

                <Divider />

                <Typography variant="subtitle1">{t('item.markers')}</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {activeMarkers.map((marker) => {
                    const selected = form.marker_ids.includes(marker.id);
                    return (
                      <Chip
                        key={marker.id}
                        label={
                          pickTranslated(marker.title, languages.displayLanguage, languages.defaultCode) ||
                          marker.code
                        }
                        color={selected ? 'success' : 'default'}
                        variant={selected ? 'filled' : 'outlined'}
                        onClick={() =>
                          setForm((prev) => ({ ...prev, marker_ids: toggleCode(prev.marker_ids, marker.id) }))
                        }
                        data-testid={`item-marker-${marker.code}`}
                      />
                    );
                  })}
                  {activeMarkers.length === 0 ? (
                    <Typography variant="caption" color="text.secondary">
                      {t('item.noMarkers')}
                    </Typography>
                  ) : null}
                </Stack>

                <Divider />

                <Typography variant="subtitle1">{t('item.characteristics')}</Typography>
                <Stack spacing={1.5} data-testid="cms-item-characteristics">
                  {form.characteristics.map((row, index) => (
                    <Stack key={index} direction="row" spacing={1} alignItems="flex-start">
                      <Box sx={{ flex: 1 }}>
                        <TranslatedField
                          label={t('item.characteristicName')}
                          value={row.name}
                          onChange={(name) =>
                            setForm((prev) => ({
                              ...prev,
                              characteristics: prev.characteristics.map((c, i) => (i === index ? { ...c, name } : c)),
                            }))
                          }
                          languages={languages.codes}
                          languageLabels={languages.labels}
                          defaultLanguage={languages.defaultCode}
                          testId={`characteristic-name-${index}`}
                        />
                      </Box>
                      <Box sx={{ flex: 1 }}>
                        <TranslatedField
                          label={t('item.characteristicValue')}
                          value={row.value}
                          onChange={(value) =>
                            setForm((prev) => ({
                              ...prev,
                              characteristics: prev.characteristics.map((c, i) => (i === index ? { ...c, value } : c)),
                            }))
                          }
                          languages={languages.codes}
                          languageLabels={languages.labels}
                          defaultLanguage={languages.defaultCode}
                          testId={`characteristic-value-${index}`}
                        />
                      </Box>
                      <IconButton
                        aria-label={t('common.delete')}
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            characteristics: prev.characteristics.filter((_, i) => i !== index),
                          }))
                        }
                        data-testid={`characteristic-remove-${index}`}
                        sx={{ mt: 0.5 }}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  ))}
                  <Button
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={() =>
                      setForm((prev) => ({ ...prev, characteristics: [...prev.characteristics, { name: {}, value: {} }] }))
                    }
                    data-testid="characteristic-add"
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    {t('item.addCharacteristic')}
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          <Card variant="outlined" sx={{ borderColor: 'divider' }}>
            <CardContent>
              <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
                {t('item.badges')}
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap data-testid="cms-item-badges">
                {activeBadges.map((badge) => {
                  const selected = badgeIds.includes(badge.id);
                  const badgeLabel =
                    pickTranslated(badge.label, languages.displayLanguage, languages.defaultCode) ||
                    badge.id;
                  return (
                    <Chip
                      key={badge.id}
                      label={badgeLabel}
                      variant={selected ? 'filled' : 'outlined'}
                      onClick={() =>
                        setBadgeIds((prev) =>
                          prev.includes(badge.id)
                            ? prev.filter((id) => id !== badge.id)
                            : [...prev, badge.id],
                        )
                      }
                      data-testid={`cms-item-badge-${badge.id}`}
                      sx={(theme) => {
                        const color = badgeRoleColor(badge.color_role, theme);
                        return selected
                          ? { bgcolor: color, color: theme.palette.getContrastText(color) }
                          : { borderColor: color, color };
                      }}
                    />
                  );
                })}
                {activeBadges.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    {t('item.noBadges')}
                  </Typography>
                ) : null}
              </Stack>
            </CardContent>
          </Card>

          <Card variant="outlined" sx={{ borderColor: 'divider' }}>
            <CardContent>
              <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
                {t('schedule.section')}
              </Typography>
              <SchedulePicker
                value={form.schedule_id}
                onChange={(schedule_id) => setForm((prev) => ({ ...prev, schedule_id }))}
                schedules={bootstrap.schedules}
                dayParts={bootstrap.day_parts}
                testId="item-schedule-select"
              />
            </CardContent>
          </Card>
        </Stack>
      </Stack>

      <ConfirmDialog
        open={guard.isBlocked}
        testId="unsaved-dialog"
        title={t('editor.leaveTitle')}
        description={t('editor.leaveBody')}
        confirmLabel={t('editor.leaveConfirm')}
        cancelLabel={t('editor.leaveCancel')}
        destructive
        onConfirm={guard.proceed}
        onClose={guard.reset}
      />
    </Box>
  );
}
