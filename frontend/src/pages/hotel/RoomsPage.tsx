import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
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
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import LibraryAddOutlinedIcon from '@mui/icons-material/LibraryAddOutlined';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';
import QrCode2Icon from '@mui/icons-material/QrCode2';

import { ApiError } from '@/api/client';
import {
  bulkCreateRooms,
  createRoom,
  deleteRoom,
  downloadRoomQrPng,
  fetchRoomQrSheetHtml,
  fetchRoomQrSvg,
  fetchRooms,
  updateRoom,
} from '@/api/hotelAdmin';
import type { Room, RoomBulkResult } from '@/api/hotelAdminTypes';
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
  const [qrRoom, setQrRoom] = useState<Room | null>(null);
  const [printing, setPrinting] = useState(false);

  const roomsQuery = useQuery({ queryKey: queryKeys.rooms, queryFn: fetchRooms });
  const rooms = roomsQuery.data ?? [];

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
              <Typography variant="h5">{t('hotel.rooms.title')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('hotel.rooms.subtitle')}
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
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
            <Alert severity="error">{t('hotel.rooms.loadError')}</Alert>
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
                    <TableCell>{t('hotel.rooms.active')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rooms.map((room) => (
                    <TableRow key={room.id} hover data-testid={`room-row-${room.number}`}>
                      <TableCell>
                        <Typography variant="body2" fontWeight={500}>
                          {room.number}
                        </Typography>
                      </TableCell>
                      <TableCell>{room.floor || '—'}</TableCell>
                      <TableCell>{room.zone || '—'}</TableCell>
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

  const mutation = useMutation({
    mutationFn: () =>
      room
        ? updateRoom(room.id, {
            number: form.number.trim(),
            floor: form.floor.trim(),
            zone: form.zone.trim(),
            is_active: form.is_active,
          })
        : createRoom({
            number: form.number.trim(),
            floor: form.floor.trim(),
            zone: form.zone.trim(),
            is_active: form.is_active,
          }),
    onSuccess: () => {
      toast.show(t('hotel.rooms.saved'), 'success');
      onSaved();
    },
    onError: (error) =>
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error'),
  });

  return (
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
          disabled={!form.number.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
          data-testid="room-save"
        >
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── Bulk range dialog ─────────────────────────────────────────────────── */

function BulkDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [floor, setFloor] = useState('');
  const [zone, setZone] = useState('');
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [result, setResult] = useState<RoomBulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fromNum = Number(from);
  const toNum = Number(to);
  const invalid =
    !from.trim() ||
    !to.trim() ||
    !Number.isFinite(fromNum) ||
    !Number.isFinite(toNum) ||
    fromNum > toNum;

  const mutation = useMutation({
    mutationFn: () =>
      bulkCreateRooms({
        from: fromNum,
        to: toNum,
        floor: floor.trim(),
        zone: zone.trim(),
        prefix: prefix.trim(),
        suffix: suffix.trim(),
      }),
    onSuccess: (data) => {
      setError(null);
      setResult(data);
      onDone();
    },
    onError: (mutationError) => {
      const code = mutationError instanceof ApiError ? mutationError.code : '';
      if (code === 'range_too_large') setError(t('hotel.rooms.bulkTooLarge'));
      else if (code === 'bad_range') setError(t('hotel.rooms.bulkBadRange'));
      else setError(mutationError instanceof ApiError ? mutationError.detail : t('errors.generic'));
    },
  });

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="room-bulk-dialog">
      <DialogTitle>{t('hotel.rooms.bulkTitle')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('hotel.rooms.bulkHint')}
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
          <Stack direction="row" spacing={2}>
            <TextField
              size="small"
              type="number"
              label={t('hotel.rooms.bulkFrom')}
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              inputProps={{ 'data-testid': 'room-bulk-from' }}
              fullWidth
            />
            <TextField
              size="small"
              type="number"
              label={t('hotel.rooms.bulkTo')}
              value={to}
              onChange={(event) => setTo(event.target.value)}
              inputProps={{ 'data-testid': 'room-bulk-to' }}
              fullWidth
            />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField
              size="small"
              label={t('hotel.rooms.floor')}
              value={floor}
              onChange={(event) => setFloor(event.target.value)}
              fullWidth
            />
            <TextField
              size="small"
              label={t('hotel.rooms.zone')}
              value={zone}
              onChange={(event) => setZone(event.target.value)}
              fullWidth
            />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField
              size="small"
              label={t('hotel.rooms.prefix')}
              value={prefix}
              onChange={(event) => setPrefix(event.target.value)}
              fullWidth
            />
            <TextField
              size="small"
              label={t('hotel.rooms.suffix')}
              value={suffix}
              onChange={(event) => setSuffix(event.target.value)}
              fullWidth
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{result ? t('common.close') : t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={invalid || mutation.isPending}
          onClick={() => mutation.mutate()}
          data-testid="room-bulk-submit"
        >
          {t('hotel.rooms.bulkSubmit')}
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
