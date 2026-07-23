import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { ThemeModeToggle } from '@/components/ThemeModeToggle';
import {
  BRAND_PRESETS,
  createHotel,
  getHotel,
  listHotels,
  patchHotel,
  platformLogin,
  platformToken,
  setHotelAdmin,
  type CreateHotelResult,
  type HotelBrief,
  type HotelProfile,
  PlatformError,
} from './platformClient';

const QK = ['platform', 'hotels'];

export function PlatformConsole() {
  const [authed, setAuthed] = useState<boolean>(() => Boolean(platformToken.get()));
  if (!authed) return <PlatformLogin onLoggedIn={() => setAuthed(true)} />;
  return <Console onLogout={() => {
    platformToken.clear();
    setAuthed(false);
  }} />;
}

/* ── Вход ──────────────────────────────────────────────────────────────── */

function PlatformLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await platformLogin(email.trim(), password);
      onLoggedIn();
    } catch (e) {
      setError(e instanceof PlatformError ? e.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2, bgcolor: 'background.default' }}>
      <Card variant="outlined" sx={{ width: 380, maxWidth: '100%' }} data-testid="platform-login">
        <CardContent>
          <Stack spacing={2}>
            <Box>
              <Typography variant="overline" color="primary">Платформа</Typography>
              <Typography variant="h6">Консоль отелей</Typography>
            </Box>
            {error ? <Alert severity="error" data-testid="platform-login-error">{error}</Alert> : null}
            <TextField
              label="Email" value={email} onChange={(e) => setEmail(e.target.value)}
              autoComplete="username" inputProps={{ 'data-testid': 'platform-login-email' }}
            />
            <TextField
              label="Пароль" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password" inputProps={{ 'data-testid': 'platform-login-password' }}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            />
            <Button variant="contained" disabled={busy || !email || !password}
              onClick={() => void submit()} data-testid="platform-login-submit">
              Войти
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}

/* ── Консоль ───────────────────────────────────────────────────────────── */

function Console({ onLogout }: { onLogout: () => void }) {
  const qc = useQueryClient();
  const hotels = useQuery({ queryKey: QK, queryFn: listHotels });
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createdAdmin, setCreatedAdmin] = useState<CreateHotelResult['admin'] | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: QK });

  const cmsUrl = (subdomain: string) =>
    `${window.location.protocol}//${subdomain}.${window.location.host}/cms`;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }} data-testid="platform-console">
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3, py: 1.5, display: 'flex', alignItems: 'center' }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>Платформа · отели</Typography>
        <ThemeModeToggle />
        <Button size="small" onClick={onLogout} data-testid="platform-logout" sx={{ ml: 1 }}>Выйти</Button>
      </Box>

      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="subtitle1">{hotels.data?.length ?? 0} отелей</Typography>
          <Button variant="contained" onClick={() => setCreating(true)} data-testid="platform-create-open">
            Создать отель
          </Button>
        </Stack>

        {hotels.isError ? <Alert severity="error">Не удалось загрузить отели</Alert> : null}

        <Card variant="outlined">
          <Table size="small" data-testid="platform-hotels-table">
            <TableHead>
              <TableRow>
                <TableCell>Название</TableCell>
                <TableCell>Поддомен</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell align="right">Номера</TableCell>
                <TableCell align="right">Персонал</TableCell>
                <TableCell align="right">Позиции</TableCell>
                <TableCell align="right">Действия</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(hotels.data ?? []).map((h: HotelBrief) => (
                <TableRow key={h.id} hover data-testid={`platform-hotel-row-${h.subdomain}`}>
                  <TableCell>{h.name}</TableCell>
                  <TableCell>{h.subdomain}</TableCell>
                  <TableCell>
                    <Chip size="small" label={h.is_active ? 'Активен' : 'Отключён'}
                      color={h.is_active ? 'success' : 'default'}
                      variant={h.is_active ? 'filled' : 'outlined'}
                      data-testid={`platform-hotel-status-${h.subdomain}`} />
                  </TableCell>
                  <TableCell align="right">{h.counts.rooms}</TableCell>
                  <TableCell align="right">{h.counts.staff}</TableCell>
                  <TableCell align="right">{h.counts.items}</TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => setSelectedId(h.id)}
                      data-testid={`platform-open-${h.subdomain}`}>Профиль</Button>
                    <Button size="small" href={cmsUrl(h.subdomain)} target="_blank" rel="noreferrer"
                      data-testid={`platform-goto-cms-${h.subdomain}`}>В CMS</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </Container>

      {creating ? (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={(res) => {
            setCreating(false);
            setCreatedAdmin(res.admin);
            void invalidate();
          }}
        />
      ) : null}

      {createdAdmin ? (
        <Dialog open onClose={() => setCreatedAdmin(null)}>
          <DialogTitle>Отель создан</DialogTitle>
          <DialogContent>
            <Stack spacing={1} sx={{ pt: 1 }}>
              <Typography variant="body2">Администратор: <b>{createdAdmin.email}</b></Typography>
              {createdAdmin.password ? (
                <Alert severity="info" data-testid="platform-created-password">
                  Пароль (показывается один раз): <b>{createdAdmin.password}</b>
                </Alert>
              ) : null}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreatedAdmin(null)}>Готово</Button>
          </DialogActions>
        </Dialog>
      ) : null}

      {selectedId ? (
        <ProfileDialog id={selectedId} onClose={() => setSelectedId(null)} onChanged={invalidate} />
      ) : null}
    </Box>
  );
}

/* ── Создание ──────────────────────────────────────────────────────────── */

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (r: CreateHotelResult) => void }) {
  const [form, setForm] = useState({
    subdomain: '', name: '', admin_email: '', currency: 'RUB',
    timezone: 'Europe/Moscow', languages: 'ru,en', preset: 'midnight_navy',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const mutation = useMutation({
    mutationFn: () => createHotel({
      subdomain: form.subdomain.trim(), name: form.name.trim(), admin_email: form.admin_email.trim(),
      currency: form.currency, timezone: form.timezone,
      languages: form.languages.split(',').map((s) => s.trim()).filter(Boolean),
      preset: form.preset,
    }),
    onSuccess: onCreated,
    onError: (e) => setError(e instanceof PlatformError ? e.message : 'Не удалось создать'),
  });

  const valid = form.subdomain && form.name && form.admin_email;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="platform-create-dialog">
      <DialogTitle>Новый отель</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField label="Поддомен" value={form.subdomain} onChange={set('subdomain')}
            helperText="Ключ тенанта, потом не меняется" inputProps={{ 'data-testid': 'platform-create-subdomain' }} />
          <TextField label="Название" value={form.name} onChange={set('name')}
            inputProps={{ 'data-testid': 'platform-create-name' }} />
          <TextField label="Email администратора" value={form.admin_email} onChange={set('admin_email')}
            inputProps={{ 'data-testid': 'platform-create-admin-email' }} />
          <Stack direction="row" spacing={2}>
            <TextField label="Валюта" value={form.currency} onChange={set('currency')} sx={{ width: 120 }} />
            <TextField label="Языки" value={form.languages} onChange={set('languages')}
              helperText="через запятую" sx={{ flexGrow: 1 }} />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField label="Таймзона" value={form.timezone} onChange={set('timezone')} sx={{ flexGrow: 1 }} />
            <TextField select label="Пресет" value={form.preset} onChange={set('preset')} sx={{ width: 200 }}
              inputProps={{ 'data-testid': 'platform-create-preset' }}>
              {BRAND_PRESETS.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </TextField>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button variant="contained" disabled={!valid || mutation.isPending}
          onClick={() => mutation.mutate()} data-testid="platform-create-submit">Создать</Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── Профиль ───────────────────────────────────────────────────────────── */

function ProfileDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ['platform', 'hotel', id], queryFn: () => getHotel(id) });
  const [resetPassword, setResetPassword] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['platform', 'hotel', id] });
    onChanged();
  };

  const toggleActive = useMutation({
    mutationFn: (next: boolean) => patchHotel(id, { is_active: next } as Partial<HotelProfile>),
    onSuccess: refresh,
  });
  const resetAdmin = useMutation({
    mutationFn: (email: string) => setHotelAdmin(id, { email }),
    onSuccess: (r) => setResetPassword(r.password),
  });

  const h = profile.data;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="platform-profile">
      <DialogTitle>{h?.name ?? 'Отель'}</DialogTitle>
      <DialogContent dividers>
        {h ? (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">{h.subdomain}</Typography>
            <Stack direction="row" spacing={3}>
              <Metric label="Номера" value={h.counts.rooms} />
              <Metric label="Персонал" value={h.counts.staff} />
              <Metric label="Позиции" value={h.counts.items} />
            </Stack>
            <Typography variant="body2">
              Валюта {h.currency} · TZ {h.timezone} · языки {h.languages.map((l) => l.code).join(', ')}
            </Typography>
            <Divider />
            <FormControlLabel
              control={
                <Switch checked={h.is_active} onChange={(e) => toggleActive.mutate(e.target.checked)}
                  inputProps={{ 'data-testid': 'platform-active-toggle' } as Record<string, string>} />
              }
              label={h.is_active ? 'Активен' : 'Отключён (витрина недоступна)'}
            />
            <Divider />
            <Button variant="outlined" onClick={() => {
              const owner = h.languages.length ? `owner@${h.subdomain}.local` : '';
              const email = window.prompt('Email hotel-admin для сброса/создания', owner) || '';
              if (email) resetAdmin.mutate(email.trim());
            }} data-testid="platform-reset-admin">
              Завести / сбросить hotel-admin
            </Button>
            {resetPassword ? (
              <Alert severity="info" data-testid="platform-reset-password">
                Новый пароль (один раз): <b>{resetPassword}</b>
              </Alert>
            ) : null}
          </Stack>
        ) : (
          <Typography>Загрузка…</Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Box>
      <Typography variant="h6">{value}</Typography>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Box>
  );
}
