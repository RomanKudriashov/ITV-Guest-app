import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ImageUploader,
  mediaToEditable,
  type EditableImage,
} from '@/components/ImageUploader';
import type { MediaAsset } from '@/api/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/client';
import { QueryState } from '@/components/QueryState';
import { useToast } from '@/components/ToastProvider';

import { useBootstrap } from '@/hooks/useBootstrap';
import { MenuPage } from '@/pages/menu/MenuPage';
import { InclusionsTab } from './InclusionsTab';
import { fetchService, updateService } from './api';
import type { CmsService } from './api';

/**
 * Рабочее пространство одного заведения.
 *
 * Всё, что относится к заведению, собрано здесь — и меню на вкладке
 * принадлежит ИМЕННО ЕМУ. Это и есть ответ на вопрос «меню какого ресторана»
 * со стороны CMS: раньше меню отеля было одной кучей, и принадлежность блюда
 * заведению нигде не была видна.
 */
const TABS = ['menu', 'schedule', 'delivery', 'commerce', 'staff', 'inclusions'] as const;
type TabKey = (typeof TABS)[number];

export function ServiceWorkspacePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const [tab, setTab] = useState<TabKey>('menu');

  const service = useQuery({
    queryKey: ['cms', 'service', id],
    queryFn: () => fetchService(id),
    enabled: Boolean(id),
  });

  if (service.isLoading) {
    return (
      <Stack alignItems="center" sx={{ py: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }
  if (service.error || !service.data) {
    return (
      <Box sx={{ p: 3 }}>
        {/*
          Здесь стояло `String(service.error)` — на экран выезжало «ApiError:
          боль». Имя класса и текст исключения оператору бесполезны, а про
          устройство сервера рассказывают. Разбор — в консоли браузера.
        */}
        <QueryState query={service} what={t('state.what.service')}>
          {() => null}
        </QueryState>
      </Box>
    );
  }

  const data = service.data;
  const name =
    data.public_name[i18n.resolvedLanguage ?? 'ru'] ?? data.public_name.ru ?? data.code;

  return (
    <Box sx={{ p: 3 }} data-testid="cms-service-workspace">
      <Button
        size="small"
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate('/cms/services')}
        sx={{ mb: 1 }}
      >
        {t('services.backToList')}
      </Button>

      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <Typography variant="h5">{name}</Typography>
        <Chip size="small" variant="outlined" label={t(`services.types.${data.type}`)} />
        {/* Вид рабочего экрана персонала следует из типа (R3) — показываем сразу. */}
        <Chip
          size="small"
          color="info"
          variant="outlined"
          label={t(`services.trackers.${data.tracker_type}`)}
        />
        {!data.is_guest_facing ? (
          <Chip size="small" label={t('services.hiddenFromGuest')} />
        ) : null}
      </Stack>

      <Tabs
        value={tab}
        onChange={(_event, next: TabKey) => setTab(next)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
      >
        {TABS.map((key) => (
          <Tab key={key} value={key} label={t(`services.tabs.${key}`)} data-testid={`service-tab-${key}`} />
        ))}
      </Tabs>

      {tab === 'menu' ? (
        // Меню ЭТОГО заведения: тот же экран каталога, но в области сервиса.
        <Box data-testid="service-menu">
          <MenuPage serviceId={data.id} />
        </Box>
      ) : null}
      {tab === 'inclusions' ? <InclusionsTab service={data} /> : null}
      {tab === 'schedule' ? <ScheduleTab service={data} /> : null}
      {tab === 'delivery' ? <DeliveryTab /> : null}
      {tab === 'commerce' ? <CommerceTab service={data} /> : null}
      {tab === 'staff' ? <StaffTab service={data} /> : null}
    </Box>
  );
}

function useSaveService(service: CmsService) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (patch: Parameters<typeof updateService>[1]) =>
      updateService(service.id, patch),
    onSuccess: () => {
      // Вкладки сервиса сохраняют по месту, без кнопки «Сохранить» — значит
      // результат обязан быть виден. Молчание после выбора неотличимо от
      // «не нажалось», и на этом уже теряли правку расписания.
      toast.show(t('services.saved'), 'success');
      void queryClient.invalidateQueries({ queryKey: ['cms', 'service', service.id] });
      void queryClient.invalidateQueries({ queryKey: ['cms', 'services'] });
    },
    onError: (error) => {
      // `String(error)` печатал «ApiError: …» — имя класса и текст исключения.
      //
      // `detail` берём ТОЛЬКО у 4xx: там это наш доменный текст, написанный
      // для оператора («Заполните название заведения»). У 5xx в `detail`
      // лежит нутро сервера — «relation does not exist» и прочее, что говорит
      // о нашем устройстве и не говорит, что делать. Разбор живёт в консоли
      // браузера, экран говорит по-человечески.
      const human =
        error instanceof ApiError && error.status < 500 ? error.detail : null;
      toast.show(human ?? t('services.saveFailed'), 'error');
    },
  });
}

function ScheduleTab({ service }: { service: CmsService }) {
  const { t } = useTranslation();
  const { data: bootstrap } = useBootstrap();
  const save = useSaveService(service);

  return (
    <Stack spacing={2} sx={{ maxWidth: 520 }} data-testid="service-schedule">
      <Typography variant="body2" color="text.secondary">
        {t('services.scheduleHint')}
      </Typography>
      <TextField
        select
        size="small"
        label={t('services.schedule')}
        value={service.schedule_id ?? ''}
        onChange={(event) => save.mutate({ schedule_id: event.target.value || null })}
        data-testid="service-schedule-select"
      >
        <MenuItem value="">{t('services.scheduleAlways')}</MenuItem>
        {(bootstrap?.schedules ?? []).map((schedule: { id: string; name: string }) => (
          <MenuItem key={schedule.id} value={schedule.id}>
            {schedule.name}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        size="small"
        type="number"
        label={t('services.sla')}
        defaultValue={service.execution_point.sla_minutes}
        onBlur={(event) => save.mutate({ sla_minutes: Number(event.target.value) })}
        helperText={t('services.slaHint')}
        data-testid="service-sla"
      />

      <FormControlLabel
        control={
          <Switch
            checked={service.is_guest_facing}
            onChange={(event) => save.mutate({ is_guest_facing: event.target.checked })}
            data-testid="service-guest-facing"
          />
        }
        label={t('services.guestFacing')}
      />

      {/*
        ФОТО ЗАВЕДЕНИЯ. Поле было в модели, бэкенд его принимал, гость показывал
        — а загрузить было негде: интерфейса не существовало вовсе, и картинка
        ставилась только запросом мимо CMS.
      */}
      <Box>
        <Typography variant="subtitle2">{t('services.photo')}</Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          {t('media.where.venue')}
        </Typography>
        <ServicePhotoField
          image={service.image}
          onChange={(id) => save.mutate({ image_id: id })}
        />
      </Box>
    </Stack>
  );
}

/**
 * Мост между массивным `ImageUploader` и одиночным `image_id` заведения.
 *
 * Тот же путь загрузки и тот же кроппер, что у позиции и категории: пятый
 * способ грузить картинку завёл бы пятый набор краевых случаев.
 */
function ServicePhotoField({
  image,
  onChange,
}: {
  image: MediaAsset | null;
  onChange: (id: string | null) => void;
}) {
  const [images, setImages] = useState<EditableImage[]>(() =>
    image ? [mediaToEditable(image)] : [],
  );
  const lastEmitted = useRef<string | null>(image?.id ?? null);

  useEffect(() => {
    const ready = images.find((entry) => !entry.error && !entry.id.startsWith('tmp:'));
    const next = ready?.id ?? null;
    if (next !== lastEmitted.current) {
      lastEmitted.current = next;
      onChange(next);
    }
  }, [images, onChange]);

  return (
    <ImageUploader
      value={images}
      onChange={setImages}
      kind="item"
      multiple={false}
      surface="venue"
      testId="service-photo"
    />
  );
}

function DeliveryTab() {
  const { t } = useTranslation();
  return (
    <Stack spacing={2} data-testid="service-delivery">
      <Alert severity="info">{t('services.deliveryHint')}</Alert>
      <Typography variant="body2" color="text.secondary">
        {t('services.deliveryMatrixHint')}
      </Typography>
      <Button
        variant="outlined"
        href="/cms/settings#locations"
        sx={{ alignSelf: 'flex-start' }}
        data-testid="service-delivery-locations"
      >
        {t('services.toLocations')}
      </Button>
    </Stack>
  );
}

function CommerceTab({ service }: { service: CmsService }) {
  const { t } = useTranslation();
  const save = useSaveService(service);
  const commerce = service.commerce;

  // null = «наследовать значение отеля». Пустое поле означает именно это, а
  // не ноль: ноль — это «сбора нет», и путать их дорого.
  const field = (
    key: keyof typeof commerce,
    labelKey: string,
    helperKey: string,
  ) => (
    <TextField
      key={key}
      size="small"
      type="number"
      label={t(labelKey)}
      defaultValue={commerce[key] ?? ''}
      placeholder={t('services.commerce.inherited')}
      helperText={t(helperKey)}
      onBlur={(event) =>
        save.mutate({ [key]: event.target.value === '' ? null : Number(event.target.value) })
      }
      data-testid={`service-commerce-${key}`}
      sx={{ maxWidth: 280 }}
    />
  );

  return (
    <Stack spacing={2} data-testid="service-commerce">
      <Alert severity="info">{t('services.commerce.explainer')}</Alert>
      {field('service_fee_bp', 'services.commerce.fee', 'services.commerce.feeHint')}
      {field('min_order_minor', 'services.commerce.minOrder', 'services.commerce.minOrderHint')}
      {field(
        'free_delivery_threshold_minor',
        'services.commerce.freeDelivery',
        'services.commerce.freeDeliveryHint',
      )}
    </Stack>
  );
}

function StaffTab({ service }: { service: CmsService }) {
  const { t } = useTranslation();
  return (
    <Stack spacing={2} data-testid="service-staff">
      <Typography variant="body2" color="text.secondary">
        {t('services.staffCount', { count: service.staff_count })}
      </Typography>
      <Button
        variant="outlined"
        href="/cms/staff"
        sx={{ alignSelf: 'flex-start' }}
        data-testid="service-staff-link"
      >
        {t('services.toStaff')}
      </Button>
    </Stack>
  );
}
