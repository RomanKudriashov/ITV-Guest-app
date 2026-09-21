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
import { cmsPath } from '@/app/hostRole';

import { ApiError } from '@/api/client';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

import { QueryState } from '@/components/QueryState';
import { fetchStaff } from '@/api/hotelAdmin';
import { queryKeys } from '@/api/queryKeys';
import { useToast } from '@/components/ToastProvider';
import { useAuth } from '@/auth/AuthProvider';

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
/*
  У заведения без каталога (ресепшен) нет меню, доставки, коммерции и
  включений: продавать ему нечего. Остаются часы, персонал и настройки.
*/
const CATALOG_TABS: ReadonlySet<TabKey> = new Set(['menu', 'delivery', 'commerce', 'inclusions']);

export function ServiceWorkspacePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const [chosenTab, setTab] = useState<TabKey | null>(null);

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
  const tabs = TABS.filter((key) => data.has_catalog || !CATALOG_TABS.has(key));
  const tab: TabKey = chosenTab && tabs.includes(chosenTab) ? chosenTab : tabs[0];
  const name =
    data.public_name[i18n.resolvedLanguage ?? 'ru'] ?? data.public_name.ru ?? data.code;

  return (
    <Box sx={{ p: 3 }} data-testid="cms-service-workspace">
      <Button
        size="small"
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate(cmsPath('/services'))}
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
        {!data.has_catalog ? (
          <Chip size="small" label={t('services.noCatalog')} data-testid="service-no-catalog" />
        ) : null}
      </Stack>
      {!data.has_catalog ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }} data-testid="service-no-catalog-hint">
          {t('services.noCatalogHint')}
        </Typography>
      ) : null}

      <Tabs
        value={tab}
        onChange={(_event, next: TabKey) => setTab(next)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
      >
        {tabs.map((key) => (
          <Tab key={key} value={key} label={t(`services.tabs.${key}`)} data-testid={`service-tab-${key}`} />
        ))}
      </Tabs>

      {tab === 'menu' ? (
        // Меню ЭТОГО заведения: тот же экран каталога, но в области сервиса.
        <Box data-testid="service-menu">
          <MenuPage serviceId={data.id} noun={data.noun} />
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
  // Есть ли каталог — решение уровня отеля: меняет его только администратор.
  const isAdmin = Boolean(useAuth().user?.is_hotel_admin);

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

      {isAdmin ? (
        <FormControlLabel
          control={
            <Switch
              checked={service.has_catalog}
              onChange={(event) => save.mutate({ has_catalog: event.target.checked })}
              data-testid="service-has-catalog"
            />
          }
          label={t('services.hasCatalog')}
        />
      ) : null}

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
  // Право спрашиваем ПРАВОМ, а не названием роли: `unrestricted` на сервере и
  // `is_hotel_admin` здесь — одно и то же утверждение об уровне отеля.
  const isHotelAdmin = Boolean(useAuth().user?.is_hotel_admin);

  return (
    <Stack spacing={2} data-testid="service-delivery">
      <Alert severity="info">{t('services.deliveryHint')}</Alert>
      <Typography variant="body2" color="text.secondary">
        {t('services.deliveryMatrixHint')}
      </Typography>
      {/*
        КНОПКА ВЕДЁТ НА АДМИНСКИЙ ЭКРАН — значит показываем её только тому, кто
        туда войдёт.

        Локации живут в настройках отеля, и раздел закрыт администратором.
        Управляющий, нажав здесь, попадал бы на пустой экран с отказом — при
        том, что сам он ничего неправильного не сделал. Предложение, которое
        нельзя принять, хуже отсутствия предложения: оно выглядит поломкой.
      */}
      {isHotelAdmin ? (
        <Button
          variant="outlined"
          href="/cms/settings#locations"
          sx={{ alignSelf: 'flex-start' }}
          data-testid="service-delivery-locations"
        >
          {t('services.toLocations')}
        </Button>
      ) : null}
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

/**
 * Вкладка «Персонал» заведения — СПИСОК ЛЮДЕЙ, а не число со ссылкой.
 *
 * Раньше здесь стояло «сотрудников: 4» и кнопка «в раздел персонала».
 * Управляющий, открывший карточку заведения, хотел ответа на вопрос «кто у
 * меня работает и кто из них старший», а получал предложение поискать самому
 * — в общем списке отеля, где его люди перемешаны с чужими.
 *
 * Список берётся из общей выдачи персонала и фильтруется по ТОЧКЕ ИСПОЛНЕНИЯ
 * этого заведения: право видеть чужих людей выдача уже соблюдает сама
 * (управляющий получает только свои заведения), и второго правила доступа мы
 * здесь не заводим.
 */
function StaffTab({ service }: { service: CmsService }) {
  const { t } = useTranslation();
  const pointId = service.execution_point?.id ?? null;

  const staff = useQuery({
    queryKey: [...queryKeys.staff, 'of-point', pointId],
    queryFn: () => fetchStaff(),
    enabled: Boolean(pointId),
  });

  const rows = (staff.data ?? [])
    .map((person) => ({
      person,
      assignment: person.assignments.find(
        (entry) => entry.execution_point_id === pointId && entry.is_active,
      ),
    }))
    .filter((row) => row.assignment)
    // Старшие выше: смена читает список сверху вниз, и первым должен стоять
    // тот, к кому идут с вопросом.
    .sort((a, b) => {
      const weight = (level?: string) => (level === 'manager' ? 0 : level === 'lead' ? 1 : 2);
      const byLevel = weight(a.assignment?.level) - weight(b.assignment?.level);
      return byLevel !== 0 ? byLevel : a.person.full_name.localeCompare(b.person.full_name, 'ru');
    });

  return (
    <Stack spacing={2} data-testid="service-staff">
      <QueryState query={staff} what={t('services.tabs.staff')}>
        {() =>
          rows.length === 0 ? (
            <Alert severity="info" data-testid="service-staff-empty">
              {t('services.staffEmpty')}
            </Alert>
          ) : (
            <Table size="small" data-testid="service-staff-table">
              <TableHead>
                <TableRow>
                  <TableCell>{t('hotel.staff.fullName')}</TableCell>
                  <TableCell>{t('hotel.staff.email')}</TableCell>
                  <TableCell>{t('services.staffLevel')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map(({ person, assignment }) => (
                  <TableRow key={person.id} data-testid={`service-staff-row-${person.id}`}>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <span>{person.full_name}</span>
                        {!person.is_active && (
                          <Chip size="small" label={t('services.staffOff')} />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>{person.email}</TableCell>
                    <TableCell data-testid={`service-staff-level-${person.id}`}>
                      {t(`hotel.staff.levels.${assignment!.level}`)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        }
      </QueryState>

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
