import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { ApiError } from '@/api/client';
import {
  addBinding,
  addElement,
  addZone,
  fetchGrmsCatalog,
  fetchTypeStatus,
  setDeviceOverride,
  type GrmsType,
} from '@/api/grms';
import { queryKeys } from '@/api/queryKeys';
import { EmptyState } from '@/components/EmptyState';
import { useToast } from '@/components/ToastProvider';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';
import { pickTranslated } from '@/utils/translated';

/**
 * Конструктор интерфейса номера.
 *
 * Импорт создаёт ТОЛЬКО переменные — экран собирается здесь, руками: Excel это
 * карта каналов, а не описание интерфейса, и выводить одно из другого значит
 * показывать гостю то, что удобно оборудованию.
 *
 * Каталог видов элементов приходит с сервера и на фронте не дополняется:
 * список обязан совпадать с тем, что умеет исполнить адаптер.
 *
 * НЕПРИВЯЗАННЫЙ ЭЛЕМЕНТ — НЕ ОШИБКА. Он просто не попадёт в публикацию, и
 * говорит об этом сам экран, а не отказ на публикации.
 */
export function BuilderTab({ type }: { type: GrmsType }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: bootstrap } = useBootstrap();
  const languages = useContentLanguages(bootstrap);

  const catalog = useQuery({ queryKey: queryKeys.grmsCatalog, queryFn: fetchGrmsCatalog });
  const status = useQuery({
    queryKey: queryKeys.grmsStatus(type.code),
    queryFn: () => fetchTypeStatus(type.code),
  });

  const [zoneCode, setZoneCode] = useState('');
  const [zoneTitle, setZoneTitle] = useState('');
  const [elementKind, setElementKind] = useState('');
  const [elementSlug, setElementSlug] = useState('');
  const [elementZone, setElementZone] = useState('');
  const [elementTitle, setElementTitle] = useState('');
  const [bindElement, setBindElement] = useState('');
  const [bindCapability, setBindCapability] = useState('');
  const [bindVariable, setBindVariable] = useState('');
  const [overrideRoom, setOverrideRoom] = useState('');
  const [overrideDevice, setOverrideDevice] = useState('');

  const failure = (error: unknown) =>
    toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.grmsStatus(type.code) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.grmsPlan(type.code) });
  };

  const zoneMutation = useMutation({
    mutationFn: () =>
      addZone(type.code, {
        code: zoneCode.trim(),
        title: { [languages.defaultCode]: zoneTitle.trim() || zoneCode.trim() },
      }),
    onSuccess: () => {
      setZoneCode('');
      setZoneTitle('');
      refresh();
    },
    onError: failure,
  });

  const elementMutation = useMutation({
    mutationFn: () =>
      addElement(type.code, {
        kind: elementKind,
        slug: elementSlug.trim(),
        zone_code: elementZone,
        title: elementTitle.trim() ? { [languages.defaultCode]: elementTitle.trim() } : null,
      }),
    onSuccess: () => {
      setElementSlug('');
      setElementTitle('');
      refresh();
    },
    onError: failure,
  });

  const bindMutation = useMutation({
    mutationFn: () =>
      addBinding(type.code, {
        element_slug: bindElement,
        capability: bindCapability,
        variable_key: bindVariable,
      }),
    onSuccess: () => {
      setBindVariable('');
      refresh();
      toast.show(t('roomControl.builder.bound'), 'success');
    },
    onError: failure,
  });

  const overrideMutation = useMutation({
    mutationFn: () =>
      setDeviceOverride(type.code, {
        room_number: overrideRoom,
        device_name: overrideDevice.trim(),
      }),
    onSuccess: () => {
      setOverrideDevice('');
      toast.show(t('roomControl.builder.overrideSaved'), 'success');
    },
    onError: failure,
  });

  /** Возможности того вида, к которому относится выбранный элемент. */
  const capabilitiesFor = useMemo(() => {
    const element = status.data?.elements.find((e) => e.slug === bindElement);
    const kind = catalog.data?.elements.find((k) => k.kind === element?.kind);
    return kind ? [...kind.required, ...kind.optional] : [];
  }, [status.data, catalog.data, bindElement]);

  if (catalog.isLoading || status.isLoading) return <Skeleton variant="rounded" height={400} />;
  if (catalog.isError || status.isError || !catalog.data || !status.data) {
    return <Alert severity="error">{t('roomControl.builder.loadError')}</Alert>;
  }

  const draft = status.data;

  return (
    <Stack spacing={2} data-testid="grms-builder">
      {/* ── Переменные типа ─────────────────────────────────────────────── */}
      <Card variant="outlined" sx={{ borderColor: 'divider' }}>
        <CardContent>
          <Typography variant="subtitle1">{t('roomControl.builder.variables')}</Typography>
          <Typography variant="caption" color="text.secondary">
            {t('roomControl.builder.variablesHint')}
          </Typography>
          <Divider sx={{ my: 1.5 }} />
          {type.variables.length === 0 ? (
            <EmptyState
              testId="grms-no-variables"
              title={t('roomControl.builder.noVariables')}
              description={t('roomControl.builder.noVariablesHint')}
            />
          ) : (
            <Box sx={{ maxHeight: 260, overflow: 'auto' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('roomControl.builder.variable')}</TableCell>
                    <TableCell>{t('roomControl.builder.command')}</TableCell>
                    <TableCell>{t('roomControl.builder.feedback')}</TableCell>
                    <TableCell>{t('roomControl.builder.valueKind')}</TableCell>
                    <TableCell>{t('roomControl.builder.range')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {type.variables.map((variable) => (
                    <TableRow key={variable.key}>
                      <TableCell>{variable.key}</TableCell>
                      <TableCell>{variable.command || '—'}</TableCell>
                      <TableCell>{variable.feedback || '—'}</TableCell>
                      <TableCell>{variable.value_kind}</TableCell>
                      <TableCell>
                        {variable.min_value}–{variable.max_value}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </CardContent>
      </Card>

      <Stack direction="row" spacing={2} alignItems="flex-start" flexWrap="wrap" useFlexGap>
        {/* ── Зоны ──────────────────────────────────────────────────────── */}
        <Card variant="outlined" sx={{ width: 320, flexShrink: 0, borderColor: 'divider' }}>
          <CardContent>
            <Typography variant="subtitle1">{t('roomControl.builder.zones')}</Typography>
            <Divider sx={{ my: 1.5 }} />
            <Stack spacing={1} sx={{ mb: 2 }}>
              {draft.zones.map((zone) => (
                <Chip
                  key={zone.code}
                  label={pickTranslated(zone.title, languages.displayLanguage, languages.defaultCode) || zone.code}
                  data-testid={`grms-zone-${zone.code}`}
                />
              ))}
              {draft.zones.length === 0 && (
                <Typography variant="caption" color="text.secondary">
                  {t('roomControl.builder.noZones')}
                </Typography>
              )}
            </Stack>
            <Stack spacing={1}>
              <TextField
                size="small"
                label={t('roomControl.builder.zoneCode')}
                value={zoneCode}
                onChange={(e) => setZoneCode(e.target.value)}
                data-testid="grms-zone-code"
              />
              <TextField
                size="small"
                label={t('roomControl.builder.zoneTitle')}
                value={zoneTitle}
                onChange={(e) => setZoneTitle(e.target.value)}
                data-testid="grms-zone-title"
              />
              <Button
                variant="outlined"
                disabled={!zoneCode.trim() || zoneMutation.isPending}
                onClick={() => zoneMutation.mutate()}
                data-testid="grms-zone-add"
              >
                {t('roomControl.builder.addZone')}
              </Button>
            </Stack>
          </CardContent>
        </Card>

        {/* ── Элементы ─────────────────────────────────────────────────── */}
        <Card variant="outlined" sx={{ flexGrow: 1, minWidth: 380, borderColor: 'divider' }}>
          <CardContent>
            <Typography variant="subtitle1">{t('roomControl.builder.elements')}</Typography>
            <Divider sx={{ my: 1.5 }} />
            <Stack spacing={1} sx={{ mb: 2 }}>
              {draft.elements.map((element) => (
                <Box
                  key={element.slug}
                  data-testid={`grms-element-${element.slug}`}
                  data-publishable={String(element.publishable)}
                  sx={{ p: 1, borderRadius: 2, bgcolor: 'brand.surfaceMuted' }}
                >
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }}>
                      {pickTranslated(element.title, languages.displayLanguage, languages.defaultCode) ||
                        element.slug}
                    </Typography>
                    <Chip size="small" label={element.kind} />
                    {element.zone && <Chip size="small" variant="outlined" label={element.zone} />}
                    <Chip
                      size="small"
                      color={element.publishable ? 'success' : 'default'}
                      label={
                        element.publishable
                          ? t('roomControl.builder.willPublish')
                          : t('roomControl.builder.hidden')
                      }
                    />
                  </Stack>
                  <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
                    {element.bindings.map((binding) => (
                      <Chip
                        key={binding.capability}
                        size="small"
                        variant="outlined"
                        label={`${binding.capability} → ${binding.variable}`}
                      />
                    ))}
                  </Stack>
                  {element.problems.map((problem) => (
                    <Typography key={problem} variant="caption" color="warning.main" display="block">
                      {problem}
                    </Typography>
                  ))}
                </Box>
              ))}
              {draft.elements.length === 0 && (
                <Typography variant="caption" color="text.secondary">
                  {t('roomControl.builder.noElements')}
                </Typography>
              )}
            </Stack>

            <Divider sx={{ my: 1.5 }} />
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <TextField
                select
                size="small"
                sx={{ minWidth: 180 }}
                label={t('roomControl.builder.kind')}
                value={elementKind}
                onChange={(e) => setElementKind(e.target.value)}
                data-testid="grms-element-kind"
              >
                {catalog.data.elements.map((kind) => (
                  <MenuItem key={kind.kind} value={kind.kind}>
                    {kind.title}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label={t('roomControl.builder.slug')}
                value={elementSlug}
                onChange={(e) => setElementSlug(e.target.value)}
                data-testid="grms-element-slug"
              />
              <TextField
                select
                size="small"
                sx={{ minWidth: 160 }}
                label={t('roomControl.builder.zone')}
                value={elementZone}
                onChange={(e) => setElementZone(e.target.value)}
                data-testid="grms-element-zone"
              >
                <MenuItem value="">{t('roomControl.builder.noZone')}</MenuItem>
                {draft.zones.map((zone) => (
                  <MenuItem key={zone.code} value={zone.code}>
                    {pickTranslated(zone.title, languages.displayLanguage, languages.defaultCode) || zone.code}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label={t('roomControl.builder.elementTitle')}
                value={elementTitle}
                onChange={(e) => setElementTitle(e.target.value)}
                data-testid="grms-element-title"
              />
              <Button
                variant="outlined"
                disabled={!elementKind || !elementSlug.trim() || elementMutation.isPending}
                onClick={() => elementMutation.mutate()}
                data-testid="grms-element-add"
              >
                {t('roomControl.builder.addElement')}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Stack>

      {/* ── Привязки ────────────────────────────────────────────────────── */}
      <Card variant="outlined" sx={{ borderColor: 'divider' }}>
        <CardContent>
          <Typography variant="subtitle1">{t('roomControl.builder.bind')}</Typography>
          <Typography variant="caption" color="text.secondary">
            {t('roomControl.builder.bindHint')}
          </Typography>
          <Divider sx={{ my: 1.5 }} />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <TextField
              select
              size="small"
              sx={{ minWidth: 200 }}
              label={t('roomControl.builder.element')}
              value={bindElement}
              onChange={(e) => {
                setBindElement(e.target.value);
                setBindCapability('');
              }}
              data-testid="grms-bind-element"
            >
              {draft.elements.map((element) => (
                <MenuItem key={element.slug} value={element.slug}>
                  {pickTranslated(element.title, languages.displayLanguage, languages.defaultCode) ||
                        element.slug}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              sx={{ minWidth: 180 }}
              label={t('roomControl.builder.capability')}
              value={bindCapability}
              onChange={(e) => setBindCapability(e.target.value)}
              disabled={!bindElement}
              data-testid="grms-bind-capability"
            >
              {capabilitiesFor.map((capability) => (
                <MenuItem key={capability} value={capability}>
                  {capability}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              sx={{ minWidth: 200 }}
              label={t('roomControl.builder.variable')}
              value={bindVariable}
              onChange={(e) => setBindVariable(e.target.value)}
              data-testid="grms-bind-variable"
            >
              {type.variables.map((variable) => (
                <MenuItem key={variable.key} value={variable.key}>
                  {variable.key}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="contained"
              disabled={!bindElement || !bindCapability || !bindVariable || bindMutation.isPending}
              onClick={() => bindMutation.mutate()}
              data-testid="grms-bind-save"
            >
              {t('roomControl.builder.bindSave')}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {/* ── Имя устройства ──────────────────────────────────────────────── */}
      <Card variant="outlined" sx={{ borderColor: 'divider' }}>
        <CardContent>
          <Typography variant="subtitle1">{t('roomControl.builder.deviceTemplate')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {type.device_name_template || '—'}
          </Typography>
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="caption" color="text.secondary">
            {t('roomControl.builder.overrideHint')}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
            <TextField
              select
              size="small"
              sx={{ minWidth: 160 }}
              label={t('roomControl.builder.room')}
              value={overrideRoom}
              onChange={(e) => setOverrideRoom(e.target.value)}
              data-testid="grms-override-room"
            >
              {type.rooms.map((room) => (
                <MenuItem key={room} value={room}>
                  {room}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              sx={{ minWidth: 220 }}
              label={t('roomControl.builder.deviceOverride')}
              value={overrideDevice}
              onChange={(e) => setOverrideDevice(e.target.value)}
              data-testid="grms-override-device"
            />
            <Button
              variant="outlined"
              disabled={!overrideRoom || !overrideDevice.trim() || overrideMutation.isPending}
              onClick={() => overrideMutation.mutate()}
              data-testid="grms-override-save"
            >
              {t('common.save')}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
