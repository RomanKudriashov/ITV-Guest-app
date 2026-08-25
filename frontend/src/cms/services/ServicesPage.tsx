import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import { useTranslation } from 'react-i18next';
import { cmsPath } from '@/app/hostRole';

import { QueryState } from '@/components/QueryState';
import { createService, fetchServiceTemplates, fetchServices } from './api';
import type { CmsService } from './api';

/**
 * «Сервисы» — верхний уровень CMS.
 *
 * Раньше меню отеля было одной кучей блюд, и вопрос «меню какого ресторана»
 * ответа не имел. Здесь список типизированных заведений, и наполнение живёт
 * внутри каждого.
 */
export function ServicesPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const services = useQuery({ queryKey: ['cms', 'services'], queryFn: () => fetchServices() });


  const label = (value: Record<string, string> | undefined, fallback: string) =>
    value?.[i18n.resolvedLanguage ?? 'ru'] ?? value?.ru ?? value?.en ?? fallback;

  return (
    <Box sx={{ p: 3 }} data-testid="cms-services">
      <Stack direction="row" alignItems="center" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h5">{t('services.title')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('services.subtitle')}
          </Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreating(true)}
          data-testid="services-add"
        >
          {t('services.add')}
        </Button>
      </Stack>

      {/*
        Рабочее и архивное — врозь.

        Выключенный сервис остаётся полноправной карточкой в общей сетке, и на
        стенде это давало двадцать «Рум-сервис ms…» поверх шести настоящих:
        оператор искал свой ресторан глазами среди мусора. Выключенные никуда
        не деваются (их нельзя удалить — на них висят заказы), но лежат
        свёрнутыми и не мешают работе.
      */}
      {/*
        Сообщение сервера пользователю не показывается. Здесь стояло
        `String(services.error)` — и на экран выезжало «ApiError: боль»:
        имя класса и текст исключения. Оператору это не говорит ничего, что
        он мог бы сделать, зато рассказывает про устройство сервера. Разбор
        живёт в консоли браузера, экран говорит по-человечески.
      */}
      <QueryState query={services} what={t('state.what.services')}>
        {(all) => {
          const active = all.filter((service) => service.is_active);
          const archived = all.filter((service) => !service.is_active);
          return (
            <>
      <ServiceGrid
        services={active}
        label={label}
        onOpen={(id) => navigate(cmsPath(`/services/${id}`))}
      />

      {archived.length ? (
        <Box sx={{ mt: 3 }}>
          <Button
            onClick={() => setArchiveOpen((open) => !open)}
            data-testid="services-archive-toggle"
            startIcon={
              <ExpandMoreIcon
                sx={{
                  transform: archiveOpen ? 'rotate(180deg)' : 'none',
                  transition: 'transform .2s',
                }}
              />
            }
            sx={{ color: 'text.secondary' }}
          >
            {t('services.archive', { count: archived.length })}
          </Button>
          <Collapse in={archiveOpen} unmountOnExit>
            <Box sx={{ mt: 2 }} data-testid="services-archive">
              <ServiceGrid
                services={archived}
                label={label}
                onOpen={(id) => navigate(cmsPath(`/services/${id}`))}
              />
            </Box>
          </Collapse>
        </Box>
      ) : null}
            </>
          );
        }}
      </QueryState>

      <CreateServiceDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(service) => {
          void queryClient.invalidateQueries({ queryKey: ['cms', 'services'] });
          setCreating(false);
          navigate(cmsPath(`/services/${service.id}`));
        }}
      />
    </Box>
  );
}

function ServiceCard({
  service,
  label,
  onOpen,
}: {
  service: CmsService;
  label: (value: Record<string, string> | undefined, fallback: string) => string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Card variant="outlined" data-testid={`service-card-${service.code}`}>
      <CardActionArea onClick={onOpen} sx={{ p: 0 }}>
        {service.image ? (
          <Box
            component="img"
            src={service.image.url}
            alt=""
            sx={{ width: '100%', height: 132, objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <Box sx={{ height: 132, bgcolor: 'action.hover' }} />
        )}

        <Box sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, minWidth: 0 }} noWrap>
              {label(service.public_name, service.code)}
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Chip size="small" label={t(`services.types.${service.type}`)} variant="outlined" />
          </Stack>

          <Typography variant="body2" color="text.secondary" noWrap sx={{ mb: 1.5 }}>
            {label(service.tagline, '—')}
          </Typography>

          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {/*
              Служебное заведение помечено явно: «хозслужбы нет на витрине» —
              это решение отеля, а не недоработка, и админ должен видеть
              разницу между «скрыт» и «забыли включить».
            */}
            {!service.is_guest_facing ? (
              <Chip
                size="small"
                color="default"
                icon={<VisibilityOffOutlinedIcon sx={{ fontSize: 15 }} />}
                label={t('services.hiddenFromGuest')}
                data-testid={`service-hidden-${service.code}`}
              />
            ) : null}
            {!service.is_active ? (
              <Chip size="small" color="warning" label={t('services.disabled')} />
            ) : null}
            <Chip
              size="small"
              variant="outlined"
              label={t('services.itemCount', { count: service.item_count })}
            />
            {service.inclusion_count > 0 ? (
              <Chip
                size="small"
                variant="outlined"
                color="info"
                label={t('services.inclusionCount', { count: service.inclusion_count })}
              />
            ) : null}
          </Stack>
        </Box>
      </CardActionArea>
    </Card>
  );
}

function CreateServiceDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (service: CmsService) => void;
}) {
  const { t, i18n } = useTranslation();
  const [type, setType] = useState('restaurant');
  const [name, setName] = useState('');

  const templates = useQuery({
    queryKey: ['cms', 'service-templates'],
    queryFn: fetchServiceTemplates,
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () => createService({ type, public_name: { ru: name.trim() } }),
    onSuccess: onCreated,
  });

  const chosen = (templates.data ?? []).find((entry) => entry.type === type);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('services.create.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            select
            label={t('services.create.type')}
            value={type}
            onChange={(event) => setType(event.target.value)}
            data-testid="service-create-type"
          >
            {(templates.data ?? []).map((template) => (
              <MenuItem key={template.type} value={template.type}>
                {template.title[i18n.resolvedLanguage ?? 'ru'] ??
                  template.title.ru ??
                  template.type}
              </MenuItem>
            ))}
          </TextField>

          {/*
            Шаблон — это «из каких кирпичей собран тип». Показываем сразу: из
            него следует и то, что отель будет наполнять, и какой рабочий
            экран получит персонал.
          */}
          {chosen ? (
            <Alert severity="info" data-testid="service-create-template">
              {t('services.create.bricks', {
                bricks: chosen.bricks.map((b) => t(`services.bricks.${b}`)).join(', '),
              })}
              {' · '}
              {t('services.create.tracker', {
                tracker: t(`services.trackers.${chosen.tracker_type}`),
              })}
            </Alert>
          ) : null}

          <TextField
            label={t('services.create.name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            // testid — на сам input: у MUI TextField атрибут корня садится на
            // обёртку, и .fill() упирается в div.
            inputProps={{ 'data-testid': 'service-create-name' }}
            autoFocus
          />

          {create.error ? <Alert severity="error">{String(create.error)}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!name.trim() || create.isPending}
          onClick={() => create.mutate()}
          data-testid="service-create-submit"
        >
          {t('services.create.submit')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Сетка карточек — одна и та же для рабочих и для архивных. */
function ServiceGrid({
  services,
  label,
  onOpen,
}: {
  services: CmsService[];
  /** Тот же резолвер перевода, что у страницы: значение по языку + запасное. */
  label: (value: Record<string, string> | undefined, fallback: string) => string;
  onOpen: (id: string) => void;
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' },
      }}
    >
      {services.map((service) => (
        <ServiceCard
          key={service.id}
          service={service}
          label={label}
          onOpen={() => onOpen(service.id)}
        />
      ))}
    </Box>
  );
}
