import { useState } from 'react';
import { useListQuery } from '@/kit/list/useListQuery';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cmsPath } from '@/app/hostRole';

import { QueryState } from '@/components/QueryState';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import Link from '@mui/material/Link';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import LibraryAddOutlinedIcon from '@mui/icons-material/LibraryAddOutlined';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import CleaningServicesOutlinedIcon from '@mui/icons-material/CleaningServicesOutlined';

import { ApiError } from '@/api/client';
import {
  ROOMS_PAGE_SIZE,
  bulkCreateRooms,
  checkOutRoom,
  createRoom,
  createRoomCategory,
  deleteRoom,
  deleteRoomCategory,
  downloadRoomQrPng,
  fetchRenameImpact,
  fetchRoomCategories,
  fetchRoomQrSheetHtml,
  fetchRoomQrSvg,
  fetchRooms,
  previewBulkRooms,
  updateRoom,
} from '@/api/hotelAdmin';
import type {
  Room,
  RoomBulkPreview,
  RoomBulkResult,
  RoomCategory,
  RoomRenameImpact,
} from '@/api/hotelAdminTypes';
import { queryKeys } from '@/api/queryKeys';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { useToast } from '@/components/ToastProvider';

interface RoomForm {
  number: string;
  floor: string;
  zone: string;
  is_active: boolean;
}

const EMPTY_ROOM: RoomForm = { number: '', floor: '', zone: '', is_active: true };

export function RoomsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [editing, setEditing] = useState<Room | 'new' | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Room | null>(null);
  const [pendingCheckout, setPendingCheckout] = useState<Room | null>(null);
  const [qrRoom, setQrRoom] = useState<Room | null>(null);
  const [printing, setPrinting] = useState(false);

  /*
    Поиск живёт В АДРЕСЕ и фильтрует НА СЕРВЕРЕ: ссылку на выборку можно
    послать, F5 её не сбрасывает, а счётчик не врёт — отсев уже скачанного
    списка показывал бы «найдено 2» независимо от того, сколько их в базе.
  */
  /*
    СТРАНИЦА — ТОЖЕ В АДРЕСЕ, рядом с поиском. Экран брал первую сотню (предел
    сервера по умолчанию) и молчал о том, что она первая: на фонде в триста
    номеров двести не существовали для администратора, а «выделить все» в
    массовых действиях выделило бы ровно видимую часть.
  */
  const { params, patch } = useListQuery({
    search: '',
    page: 1,
  });
  const pageNumber = Math.max(1, Number(params.page) || 1);
  const offset = (pageNumber - 1) * ROOMS_PAGE_SIZE;

  const roomsQuery = useQuery({
    queryKey: [...queryKeys.rooms, params.search, pageNumber],
    queryFn: () => fetchRooms(params.search, { limit: ROOMS_PAGE_SIZE, offset }),
  });
  const categoriesQuery = useQuery({
    queryKey: [...queryKeys.rooms, 'categories'],
    queryFn: fetchRoomCategories,
  });
  const categories = categoriesQuery.data ?? [];
  const rooms = roomsQuery.data?.items ?? [];
  const total = roomsQuery.data?.total ?? 0;
  const shownFrom = total === 0 ? 0 : offset + 1;
  const shownTo = offset + rooms.length;
  const hasMore = shownTo < total;

  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.rooms });
  const showError = (error: unknown) =>
    toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');

  /**
   * The print sheet sits behind staff JWT, so it is fetched with the authorized
   * client and opened from a blob URL — a plain `window.open` on the API path
   * cannot carry the Bearer token and would 401.
   */
  const handlePrintSheet = async () => {
    // Open the tab synchronously inside the click gesture so the popup blocker
    // lets it through; the blob URL is set once the HTML arrives.
    const win = window.open('', '_blank');
    setPrinting(true);
    try {
      const html = await fetchRoomQrSheetHtml();
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      if (win) {
        win.onload = () => {
          try {
            win.print();
          } catch {
            /* the sheet is still readable and printable by hand */
          }
        };
        win.location.href = url;
      } else {
        // Popup was blocked — fall back to a same-tab download-style anchor.
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.target = '_blank';
        anchor.rel = 'noopener';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      win?.close();
      toast.show(t('hotel.rooms.qrError'), 'error');
    } finally {
      setPrinting(false);
    }
  };

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateRoom(id, { is_active: isActive }),
    onMutate: async ({ id, isActive }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.rooms });
      const previous = queryClient.getQueryData<Room[]>(queryKeys.rooms);
      queryClient.setQueryData<Room[]>(queryKeys.rooms, (current) =>
        current?.map((room) => (room.id === id ? { ...room, is_active: isActive } : room)),
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.rooms, context.previous);
      showError(error);
    },
    onSettled: invalidate,
  });

  /**
   * ВЫЕЗД ГОСТЯ — здесь, а не в разделе управления номером.
   *
   * Отзыв гасит гостевые сессии целиком: вместе с ними уезжает и право
   * заказывать, а не только управление номером. Отелю без оборудования выезд
   * нужен ровно так же, и прятать его за модулем значило бы не дать половине
   * отелей единственный способ отобрать доступ у съехавшего.
   */
  const checkoutMutation = useMutation({
    mutationFn: (id: string) => checkOutRoom(id),
    onSuccess: (result) => {
      // Говорим ЧИСЛОМ, а не «готово»: администратор нажал на всякий случай и
      // должен видеть, было ли что отзывать.
      toast.show(
        result.revoked
          ? t('hotel.rooms.checkoutDone', { count: result.revoked, number: result.room })
          : t('hotel.rooms.checkoutNothing', { number: result.room }),
        'success',
      );
      setPendingCheckout(null);
      void invalidate();
    },
    onError: showError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRoom(id),
    onSuccess: () => {
      toast.show(t('hotel.rooms.deleted'), 'success');
      setPendingDelete(null);
      void invalidate();
    },
    onError: showError,
  });

  return (
    <Box sx={{ p: 3 }}>
      <Card variant="outlined" sx={{ borderColor: 'divider' }}>
        <CardContent sx={{ p: 2 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={2}
            flexWrap="wrap"
            useFlexGap
            sx={{ mb: 1 }}
          >
            <Stack>
              <Typography variant="h5" data-testid="cms-page-title">{t('hotel.rooms.title')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('hotel.rooms.subtitle')}
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
              <TextField
                size="small"
                value={params.search}
                /* Новый поиск — всегда с первой страницы: иначе набранное
                   слово находит три номера, а экран стоит на седьмой
                   странице и показывает пусто. */
                onChange={(event) => patch({ search: event.target.value, page: 1 })}
                placeholder={t('list.searchPlaceholder')}
                inputProps={{ 'data-testid': 'rooms-search' }}
                sx={{ minWidth: 200 }}
              />
              <Button
                startIcon={<PrintOutlinedIcon />}
                disabled={printing}
                onClick={() => void handlePrintSheet()}
                data-testid="rooms-print-qr"
              >
                {t('hotel.rooms.printQr')}
              </Button>
              <Button
                startIcon={<LibraryAddOutlinedIcon />}
                onClick={() => setBulkOpen(true)}
                data-testid="room-bulk-add"
              >
                {t('hotel.rooms.bulkAdd')}
              </Button>
              <Button onClick={() => setCategoriesOpen(true)} data-testid="room-categories-open">
                {t('hotel.rooms.categories')}
              </Button>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setEditing('new')}
                data-testid="room-add"
              >
                {t('hotel.rooms.add')}
              </Button>
            </Stack>
          </Stack>
          <Divider sx={{ mb: 1 }} />

          {roomsQuery.isLoading ? (
            <Stack spacing={1}>
              {[0, 1, 2, 3].map((key) => (
                <Skeleton key={key} variant="rounded" height={44} />
              ))}
            </Stack>
          ) : roomsQuery.isError ? (
            <QueryState query={roomsQuery} what={t('state.what.rooms')}>
              {() => null}
            </QueryState>
          ) : rooms.length === 0 ? (
            <EmptyState
              testId="rooms-empty"
              title={t('hotel.rooms.empty')}
              description={t('hotel.rooms.emptyHint')}
              action={
                <Button variant="contained" size="small" onClick={() => setBulkOpen(true)}>
                  {t('hotel.rooms.bulkAdd')}
                </Button>
              }
            />
          ) : (
            <Box data-testid="rooms-list">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('hotel.rooms.number')}</TableCell>
                    <TableCell>{t('hotel.rooms.floor')}</TableCell>
                    <TableCell>{t('hotel.rooms.zone')}</TableCell>
                    <TableCell>{t('hotel.rooms.category')}</TableCell>
                    <TableCell>{t('hotel.rooms.housekeeping')}</TableCell>
                    {/* Тот единственный вопрос про управление номером, который
                        задают, глядя на список: «а этот номер управляется?» */}
                    <TableCell>{t('hotel.rooms.controlType')}</TableCell>
                    <TableCell>{t('hotel.rooms.active')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rooms.map((room) => (
                    <TableRow key={room.id} hover data-testid={`room-row-${room.number}`}>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <Typography variant="body2" fontWeight={500}>
                            {room.number}
                          </Typography>
                          {/*
                            «Вне продажи» и уборка — ЗНАЧКАМИ, не цветом
                            строки: цвет в этом разделе означает занятость, а
                            её у нас нет и не будет до PMS. Красить им что-то
                            другое значит заранее занять смысл, который потом
                            придётся отбирать.
                          */}
                          {room.out_of_service ? (
                            <BuildOutlinedIcon
                              fontSize="inherit"
                              color="warning"
                              titleAccess={t('hotel.rooms.outOfService')}
                              data-testid={`room-out-of-service-${room.number}`}
                            />
                          ) : null}
                          {room.housekeeping === 'dirty' || room.housekeeping === 'in_progress' ? (
                            <CleaningServicesOutlinedIcon
                              fontSize="inherit"
                              color="action"
                              titleAccess={t(`hotel.rooms.housekeeping_${room.housekeeping}`)}
                            />
                          ) : null}
                        </Stack>
                      </TableCell>
                      <TableCell>{room.floor || '—'}</TableCell>
                      <TableCell data-testid={`room-category-${room.number}`}>
                        {room.category ? (
                          <Chip size="small" label={room.category.title || room.category.code} />
                        ) : (
                          <Typography variant="body2" color="text.disabled">
                            —
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell data-testid={`room-housekeeping-${room.number}`}>
                        <Typography
                          variant="body2"
                          color={room.housekeeping === 'unknown' ? 'text.disabled' : 'text.primary'}
                        >
                          {t(`hotel.rooms.housekeeping_${room.housekeeping}`)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {/*
                          Ссылка ведёт в конфигурацию ТИПА, а не номера:
                          настраивается тип один раз, а не двести раз по числу
                          комнат. Не управляется — прочерк, а не пустая ячейка:
                          пустая читается как «данные не доехали».
                        */}
                        {room.control_type ? (
                          <Link
                            component={RouterLink}
                            to={cmsPath(`/room-control?type=${encodeURIComponent(room.control_type)}`)}
                            variant="body2"
                            data-testid={`room-control-type-${room.number}`}
                          >
                            {room.control_type}
                          </Link>
                        ) : (
                          <Typography
                            variant="body2"
                            color="text.disabled"
                            data-testid={`room-control-type-${room.number}`}
                          >
                            —
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Switch
                          size="small"
                          checked={room.is_active}
                          onChange={(event) =>
                            toggleMutation.mutate({ id: room.id, isActive: event.target.checked })
                          }
                        />
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          onClick={() => setQrRoom(room)}
                          aria-label={t('hotel.rooms.qr')}
                          data-testid={`room-qr-${room.number}`}
                        >
                          <QrCode2Icon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => setPendingCheckout(room)}
                          aria-label={t('hotel.rooms.checkout')}
                          title={t('hotel.rooms.checkout')}
                          data-testid={`room-checkout-${room.number}`}
                        >
                          <LogoutOutlinedIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => setEditing(room)}
                          aria-label={t('common.edit')}
                          data-testid={`room-edit-${room.number}`}
                        >
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => setPendingDelete(room)}
                          aria-label={t('common.delete')}
                          data-testid={`room-delete-${room.number}`}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/*
                Счётчик — обязательная часть листания, а не украшение: он
                единственный отвечает на вопрос «это весь фонд или кусок?».
              */}
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ mt: 1.5 }}
                data-testid="rooms-pager"
              >
                <Typography variant="body2" color="text.secondary" data-testid="rooms-range">
                  {t('hotel.rooms.pagerRange', {
                    from: shownFrom,
                    to: shownTo,
                    total,
                  })}
                </Typography>
                <Box sx={{ flexGrow: 1 }} />
                <Button
                  size="small"
                  disabled={pageNumber <= 1}
                  onClick={() => patch({ page: pageNumber - 1 })}
                  data-testid="rooms-prev"
                >
                  {t('hotel.rooms.pagerPrev')}
                </Button>
                <Button
                  size="small"
                  disabled={!hasMore}
                  onClick={() => patch({ page: pageNumber + 1 })}
                  data-testid="rooms-next"
                >
                  {t('hotel.rooms.pagerNext')}
                </Button>
              </Stack>
            </Box>
          )}
        </CardContent>
      </Card>

      {editing ? (
        <RoomDialog
          room={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void invalidate();
          }}
        />
      ) : null}

      {bulkOpen ? (
        <BulkDialog
          onClose={() => setBulkOpen(false)}
          onDone={() => void invalidate()}
        />
      ) : null}

      {qrRoom ? <QrDialog room={qrRoom} onClose={() => setQrRoom(null)} /> : null}

      {categoriesOpen ? (
        <CategoriesDialog
          categories={categories}
          onClose={() => setCategoriesOpen(false)}
          onChanged={() => void invalidate()}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingCheckout)}
        testId="room-checkout-dialog"
        busy={checkoutMutation.isPending}
        title={t('hotel.rooms.checkoutTitle')}
        description={t('hotel.rooms.checkoutBody', { number: pendingCheckout?.number ?? '' })}
        confirmLabel={t('hotel.rooms.checkoutConfirm')}
        onClose={() => setPendingCheckout(null)}
        onConfirm={() => pendingCheckout && checkoutMutation.mutate(pendingCheckout.id)}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        testId="room-delete-dialog"
        destructive
        busy={deleteMutation.isPending}
        title={t('hotel.rooms.deleteTitle')}
        description={t('hotel.rooms.deleteBody', { number: pendingDelete?.number ?? '' })}
        confirmLabel={t('common.delete')}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
      />
    </Box>
  );
}

/* ── Single room dialog ────────────────────────────────────────────────── */

function RoomDialog({
  room,
  onClose,
  onSaved,
}: {
  room: Room | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState<RoomForm>(
    room
      ? { number: room.number, floor: room.floor, zone: room.zone, is_active: room.is_active }
      : EMPTY_ROOM,
  );

  /*
    ПЕРЕИМЕНОВАНИЕ — ЧЕРЕЗ ПОКАЗ ПОСЛЕДСТВИЙ, а не через «сохранить».

    Два из них с этого экрана не видны вовсе: наклейка QR в номере кодирует
    НОМЕР (после правки она ведёт в никуда), а имя устройства iRidi собирается
    из номера шаблоном типа — команды уедут на другое имя, и номер перестанет
    управляться. Сервер поэтому не принимает смену номера без `confirm_rename`;
    здесь мы спрашиваем у него, что именно изменится, и показываем это числами.
  */
  const [impact, setImpact] = useState<RoomRenameImpact | null>(null);
  const [keepDevice, setKeepDevice] = useState(true);
  const [checking, setChecking] = useState(false);

  const trimmed = {
    number: form.number.trim(),
    floor: form.floor.trim(),
    zone: form.zone.trim(),
    is_active: form.is_active,
  };
  const isRename = Boolean(room) && trimmed.number !== room?.number;

  const mutation = useMutation({
    mutationFn: (confirmed: boolean) =>
      room
        ? updateRoom(room.id, {
            ...trimmed,
            ...(confirmed
              ? { confirm_rename: true, keep_device_name: keepDevice }
              : {}),
          })
        : createRoom(trimmed),
    onSuccess: (saved) => {
      /*
        «Создан» и «восстановлен» — разные события, и второе надо сказать
        ЧИСЛАМИ. Человек нажал «добавить номер»: он не просил ничего
        восстанавливать и по фразе «вместе с историей» не поймёт, что именно
        получил — историю на три заказа или на четыреста.
      */
      toast.show(
        saved.restored
          ? t('hotel.rooms.restored', {
              number: saved.number,
              orders: t('hotel.rooms.restoredOrders', { count: saved.restored_orders ?? 0 }),
              sessions: t('hotel.rooms.restoredSessions', {
                count: saved.restored_sessions ?? 0,
              }),
            })
          : t('hotel.rooms.saved'),
        'success',
      );
      onSaved();
    },
    onError: (error) =>
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error'),
  });

  const handleSave = async () => {
    if (!isRename || !room) {
      mutation.mutate(false);
      return;
    }
    setChecking(true);
    try {
      const found = await fetchRenameImpact(room.id, trimmed.number);
      if (found.taken) {
        toast.show(t('hotel.rooms.renameTaken', { number: trimmed.number }), 'error');
        return;
      }
      setKeepDevice(found.device_changes);
      setImpact(found);
    } catch (error) {
      toast.show(
        error instanceof ApiError ? error.detail : t('hotel.rooms.renameCheckError'),
        'error',
      );
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <Dialog open onClose={onClose} maxWidth="xs" fullWidth data-testid="room-dialog">
        <DialogTitle>{room ? t('hotel.rooms.editTitle') : t('hotel.rooms.newTitle')}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              size="small"
              label={t('hotel.rooms.number')}
              value={form.number}
              onChange={(event) => setForm((prev) => ({ ...prev, number: event.target.value }))}
              inputProps={{ 'data-testid': 'room-number' }}
              required
              fullWidth
            />
            <TextField
              size="small"
              label={t('hotel.rooms.floor')}
              value={form.floor}
              onChange={(event) => setForm((prev) => ({ ...prev, floor: event.target.value }))}
              fullWidth
            />
            <TextField
              size="small"
              label={t('hotel.rooms.zone')}
              value={form.zone}
              onChange={(event) => setForm((prev) => ({ ...prev, zone: event.target.value }))}
              fullWidth
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.is_active}
                  onChange={(event) => setForm((prev) => ({ ...prev, is_active: event.target.checked }))}
                />
              }
              label={t('hotel.rooms.active')}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={!form.number.trim() || mutation.isPending || checking}
            onClick={() => void handleSave()}
            data-testid="room-save"
          >
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {impact ? (
        <RenameDialog
          impact={impact}
          keepDevice={keepDevice}
          onKeepDeviceChange={setKeepDevice}
          busy={mutation.isPending}
          onClose={() => setImpact(null)}
          onConfirm={() => {
            setImpact(null);
            mutation.mutate(true);
          }}
        />
      ) : null}
    </>
  );
}

/* ── Rename confirmation ───────────────────────────────────────────────── */

/**
 * Разбор последствий переименования. Не «вы уверены?», а перечень того, что
 * сломается, и единственная кнопка, которая одно из этого чинит.
 */
function RenameDialog({
  impact,
  keepDevice,
  onKeepDeviceChange,
  busy,
  onClose,
  onConfirm,
}: {
  impact: RoomRenameImpact;
  keepDevice: boolean;
  onKeepDeviceChange: (value: boolean) => void;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="room-rename-dialog">
      <DialogTitle>{t('hotel.rooms.renameTitle', { number: impact.number })}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <Typography variant="body2">
            {t('hotel.rooms.renameLead', { number: impact.new_number })}
          </Typography>

          <Alert severity="warning" data-testid="room-rename-qr">
            {t('hotel.rooms.renameQr', { url: impact.qr_url })}
          </Alert>

          {impact.device_changes ? (
            <Alert severity="warning" data-testid="room-rename-device">
              {t('hotel.rooms.renameDevice', {
                from: impact.device,
                to: impact.device_after,
              })}
            </Alert>
          ) : (
            <Alert severity="info" data-testid="room-rename-device">
              {t('hotel.rooms.renameNoDevice')}
            </Alert>
          )}

          {impact.live_sessions > 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('hotel.rooms.renameSessions', { count: impact.live_sessions })}
            </Typography>
          ) : null}

          {impact.device_changes ? (
            <FormControlLabel
              control={
                <Checkbox
                  checked={keepDevice}
                  onChange={(event) => onKeepDeviceChange(event.target.checked)}
                  data-testid="room-rename-keep-device"
                />
              }
              label={
                <Stack>
                  <Typography variant="body2">{t('hotel.rooms.renameKeepDevice')}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('hotel.rooms.renameKeepDeviceHint', { device: impact.device })}
                  </Typography>
                </Stack>
              }
            />
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          color="warning"
          disabled={busy}
          onClick={onConfirm}
          data-testid="room-rename-confirm"
        >
          {t('hotel.rooms.renameConfirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── Categories ────────────────────────────────────────────────────────── */

/** Справочник категорий: завести, переименовать, убрать пустую. */
function CategoriesDialog({
  categories,
  onClose,
  onChanged,
}: {
  categories: RoomCategory[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [title, setTitle] = useState('');

  const fail = (error: unknown) =>
    toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');

  const create = useMutation({
    mutationFn: () => createRoomCategory({ title: { ru: title.trim() } }),
    onSuccess: () => {
      setTitle('');
      onChanged();
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRoomCategory(id),
    onSuccess: onChanged,
    onError: fail,
  });

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth data-testid="rooms-categories-dialog">
      <DialogTitle>{t('hotel.rooms.categories')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1} sx={{ pt: 1 }}>
          {categories.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('hotel.rooms.categoriesEmpty')}
            </Typography>
          ) : (
            categories.map((category) => (
              <Stack
                key={category.id}
                direction="row"
                spacing={1}
                alignItems="center"
                data-testid={`room-category-row-${category.code}`}
              >
                <Typography variant="body2" sx={{ flexGrow: 1 }}>
                  {category.title_i18n || category.code}
                </Typography>
                {/* Число номеров — ответ на вопрос, который задают перед тем,
                    как категорию трогать. */}
                <Typography variant="caption" color="text.secondary">
                  {t('hotel.rooms.categoryRooms', { count: category.rooms_count })}
                </Typography>
                <IconButton
                  size="small"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(category.id)}
                  aria-label={t('common.delete')}
                  data-testid={`room-category-delete-${category.code}`}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))
          )}
          <Divider sx={{ my: 1 }} />
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              label={t('hotel.rooms.categoryNew')}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              inputProps={{ 'data-testid': 'room-category-title' }}
              fullWidth
            />
            <Button
              variant="contained"
              disabled={!title.trim() || create.isPending}
              onClick={() => create.mutate()}
              data-testid="room-category-add"
            >
              {t('common.add')}
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── Bulk range dialog ─────────────────────────────────────────────────── */

function BulkDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  /*
    ОДНО ПОЛЕ ВМЕСТО «С» И «ПО».

    Пара чисел покрывала регулярный корпус и не покрывала ничего больше:
    «3А» после ремонта и «Люкс-1» с террасой заводили поштучно — а из-за этого
    фонд заводили не целиком. Строка принимает и то, и другое: «101-105, 3А,
    Люкс-1». Диапазон по-прежнему пишется как диапазон.
  */
  const [spec, setSpec] = useState('');
  const [floor, setFloor] = useState('');
  const [zone, setZone] = useState('');
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [result, setResult] = useState<RoomBulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const payload = {
    spec: spec.trim(),
    floor: floor.trim(),
    zone: zone.trim(),
    prefix: prefix.trim(),
    suffix: suffix.trim(),
  };

  const asError = (thrown: unknown): string => {
    const code = thrown instanceof ApiError ? thrown.code : '';
    if (code === 'range_too_large') return t('hotel.rooms.bulkTooLarge');
    if (code === 'bad_range') return t('hotel.rooms.bulkBadRange');
    return thrown instanceof ApiError ? thrown.detail : t('errors.generic');
  };

  /*
    ПРЕДПРОСМОТР ХОДИТ НА СЕРВЕР, а не разбирает строку в браузере. Иначе
    появился бы второй разбор той же строки — и день, когда он начнёт
    расходиться с настоящим: показали одно, создали другое.
  */
  const preview = useQuery({
    queryKey: [...queryKeys.rooms, 'bulk-preview', payload],
    queryFn: () => previewBulkRooms(payload),
    enabled: Boolean(payload.spec),
    retry: false,
  });

  const previewData: RoomBulkPreview | undefined = preview.data;
  const previewError = preview.error ? asError(preview.error) : null;

  const mutation = useMutation({
    mutationFn: () => bulkCreateRooms(payload),
    onSuccess: (data) => {
      setError(null);
      setResult(data);
      onDone();
    },
    onError: (mutationError) => setError(asError(mutationError)),
  });

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="room-bulk-dialog">
      <DialogTitle>{t('hotel.rooms.bulkTitle')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('hotel.rooms.bulkSpecHint')}
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {result ? (
            <Alert severity="success" data-testid="room-bulk-result">
              <Typography variant="body2">
                {t('hotel.rooms.bulkResult', {
                  created: result.created.length,
                  skipped: result.skipped.length,
                })}
              </Typography>
              {result.created.length ? (
                <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                  {t('hotel.rooms.bulkCreatedList', { list: result.created.join(', ') })}
                </Typography>
              ) : null}
              {result.skipped.length ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="div"
                  sx={{ wordBreak: 'break-all' }}
                >
                  {t('hotel.rooms.bulkSkippedList', { list: result.skipped.join(', ') })}
                </Typography>
              ) : null}
            </Alert>
          ) : null}

          <TextField
            size="small"
            label={t('hotel.rooms.bulkSpec')}
            placeholder="101-105, 3А, Люкс-1"
            value={spec}
            onChange={(event) => setSpec(event.target.value)}
            inputProps={{ 'data-testid': 'room-bulk-spec' }}
            multiline
            minRows={2}
            fullWidth
          />

          {previewError ? (
            <Alert severity="error" data-testid="room-bulk-preview-error">
              {previewError}
            </Alert>
          ) : null}

          {previewData && !previewError ? (
            <Alert severity="info" data-testid="room-bulk-preview">
              <Typography variant="body2" data-testid="room-bulk-preview-counts">
                {t('hotel.rooms.bulkPreviewCounts', {
                  create: previewData.create_count,
                  exists: previewData.exists_count,
                })}
              </Typography>
              {/* СПИСОК ЦЕЛИКОМ: «будет создано 500» без перечня — это не
                  предпросмотр, а обещание. */}
              <Typography
                variant="caption"
                color="text.secondary"
                component="div"
                sx={{ wordBreak: 'break-all' }}
                data-testid="room-bulk-preview-list"
              >
                {previewData.numbers.join(', ')}
              </Typography>
              {previewData.will_restore.length ? (
                <Typography
                  variant="caption"
                  color="warning.main"
                  component="div"
                  data-testid="room-bulk-preview-restore"
                >
                  {t('hotel.rooms.bulkPreviewRestore', {
                    list: previewData.will_restore.join(', '),
                  })}
                </Typography>
              ) : null}
            </Alert>
          ) : null}

          <Stack direction="row" spacing={2}>
            <TextField
              size="small"
              label={t('hotel.rooms.prefix')}
              value={prefix}
              onChange={(event) => setPrefix(event.target.value)}
              inputProps={{ 'data-testid': 'room-bulk-prefix' }}
              fullWidth
            />
            <TextField
              size="small"
              label={t('hotel.rooms.suffix')}
              value={suffix}
              onChange={(event) => setSuffix(event.target.value)}
              inputProps={{ 'data-testid': 'room-bulk-suffix' }}
              fullWidth
            />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField
              size="small"
              label={t('hotel.rooms.floor')}
              value={floor}
              onChange={(event) => setFloor(event.target.value)}
              inputProps={{ 'data-testid': 'room-bulk-floor' }}
              fullWidth
            />
            <TextField
              size="small"
              label={t('hotel.rooms.zone')}
              value={zone}
              onChange={(event) => setZone(event.target.value)}
              inputProps={{ 'data-testid': 'room-bulk-zone-create' }}
              fullWidth
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
        <Button
          variant="contained"
          /* Создание доступно ровно тогда, когда предпросмотр СОСТОЯЛСЯ и
             показал, что создавать: иначе кнопка обещает неизвестно что. */
          disabled={
            !previewData || Boolean(previewError) || previewData.create_count === 0 || mutation.isPending
          }
          onClick={() => mutation.mutate()}
          data-testid="room-bulk-submit"
        >
          {t('hotel.rooms.bulkSubmitCount', { count: previewData?.create_count ?? 0 })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── QR dialog ─────────────────────────────────────────────────────────── */

function QrDialog({ room, onClose }: { room: Room; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);

  const qrQuery = useQuery({
    queryKey: ['cms', 'rooms', room.id, 'qr'],
    queryFn: () => fetchRoomQrSvg(room.id),
    staleTime: 5 * 60 * 1000,
  });

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadRoomQrPng(room.id, room.number);
    } catch {
      toast.show(t('hotel.rooms.qrError'), 'error');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth data-testid="room-qr-dialog">
      <DialogTitle>{t('hotel.rooms.qrTitle', { number: room.number })}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} alignItems="center">
          {qrQuery.isLoading ? (
            <CircularProgress />
          ) : qrQuery.isError ? (
            <Alert severity="error">{t('hotel.rooms.qrError')}</Alert>
          ) : (
            <Box
              data-testid="room-qr-image"
              sx={{
                width: 240,
                height: 240,
                bgcolor: 'common.white',
                p: 1,
                borderRadius: 1,
                '& svg': { width: '100%', height: '100%' },
              }}
              // The SVG is trusted markup returned by our own API.
              dangerouslySetInnerHTML={{ __html: qrQuery.data ?? '' }}
            />
          )}
          <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
            {room.guest_url}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('hotel.rooms.qrScanHint')}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
        <Button
          variant="contained"
          disabled={downloading}
          onClick={() => void handleDownload()}
          data-testid={`room-qr-download-${room.number}`}
        >
          {t('hotel.rooms.downloadPng')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
