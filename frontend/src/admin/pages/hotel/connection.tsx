import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import CloudOutlinedIcon from '@mui/icons-material/CloudOutlined';
import RouterOutlinedIcon from '@mui/icons-material/RouterOutlined';
import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';
import MeetingRoomOutlinedIcon from '@mui/icons-material/MeetingRoomOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';

import { accent, fieldSx, glassPanel, ink, panelSx, primaryButtonSx, secondaryButtonSx, shadow, shape, state, surface, typo } from '../../adminTokens';
import {
  PlatformError,
  checkControlServer,
  createNode,
  deleteControlServer,
  getConnection,
  getRoomsMap,
  putControlServer,
  readRoomState,
  reissueHotelNode,
  type ConnectionState,
  type ControlServerIn,
  type RoomRead,
  type ServerCheck,
} from '../../adminClient';
import { SelectField } from '@/components/SelectField';
import { useRights } from '../../useRights';
import { Help, Panel, Pill } from '../hotels/hotelsUi';

/**
 * ПОДКЛЮЧЕНИЕ УПРАВЛЕНИЯ НОМЕРОМ (партия 63-3, макеты 63-М «Подключение»:
 * А — мастер, В — постоянный экран).
 *
 * Цепочка: облако → коннектор на сервере отеля → сервер управления → номера.
 * Адрес сервера задаётся здесь; коннектор принимает его только в пределах
 * разрешённого круга, заданного при установке на объекте. Секрет сервера на
 * экран не возвращается — только «задан» и «изменить».
 */

type Tone = 'ok' | 'bad' | 'warn' | 'muted';
const TONE: Record<Tone, string> = { ok: state.ok, bad: state.bad, warn: state.warn, muted: ink.low };
const errorText = (error: unknown) => (error instanceof PlatformError ? error.message : error instanceof Error ? error.message : String(error));

export const connectionKey = (hotelId: string) => ['admin', 'connection', hotelId];

export function useConnection(hotelId: string, poll = false) {
  return useQuery({
    queryKey: connectionKey(hotelId),
    queryFn: () => getConnection(hotelId),
    // Ждём ответа коннектора на правку — часто: обычно он отвечает за секунды.
    refetchInterval: (query) => {
      const c = query.state.data;
      const pending = c?.server && c.connector.state === 'online' && !c.server.apply_error && c.server.applied_revision !== c.server.revision;
      return poll || pending ? 3000 : 30_000;
    },
  });
}

/* ── Цепочка звеньев ────────────────────────────────────────────────────── */

interface Link {
  key: 'cloud' | 'connector' | 'server' | 'rooms';
  icon: ReactNode;
  tone: Tone;
  word: string;
  sub: ReactNode;
}

export function useLinks(c: ConnectionState | undefined): Link[] {
  const { t } = useTranslation();
  const k = 'admin.card.conn';
  if (!c) return [];
  const connTone: Tone = c.connector.state === 'online' ? 'ok' : c.connector.state === 'none' ? 'muted' : 'bad';
  const srvTone: Tone = c.connector.state !== 'online' ? 'muted' : c.server_link.state === 'ok' ? 'ok' : c.server_link.state === 'down' ? 'bad' : 'warn';
  const roomsTone: Tone = !c.room_control ? 'muted' : c.rooms.total && c.rooms.ready === c.rooms.total ? 'ok' : c.rooms.ready ? 'warn' : 'bad';
  // Показываем адрес, по которому коннектор работает: отказанный адрес из Control — не он.
  const address = c.server && c.server_link.source === 'control' ? `${c.server.host}:${c.server.port}` : null;
  return [
    { key: 'cloud', icon: <CloudOutlinedIcon />, tone: 'ok', word: t(`${k}.state.ok`), sub: t(`${k}.cloudSub`) },
    {
      key: 'connector',
      icon: <RouterOutlinedIcon />,
      tone: connTone,
      word: t(`${k}.connector.${c.connector.state}`),
      sub: c.connector.name ? (
        <>
          <span data-words="data">{c.connector.name}</span>
          {c.connector.version ? ` · ${t(`${k}.version`, { version: c.connector.version })}` : ''}
        </>
      ) : (
        t(`${k}.connector.noneSub`)
      ),
    },
    {
      key: 'server',
      icon: <DnsOutlinedIcon />,
      tone: srvTone,
      word: c.connector.state !== 'online' ? t(`${k}.server.unknown`) : t(`${k}.server.${c.server_link.state}`),
      sub: (
        <>
          {address ? (
            <>
              <span data-words="data">{address}</span> · {t(`${k}.source.control`)}
            </>
          ) : (
            t(`${k}.server.addressFile`)
          )}
        </>
      ),
    },
    {
      key: 'rooms',
      icon: <MeetingRoomOutlinedIcon />,
      tone: roomsTone,
      word: c.room_control ? t(`${k}.rooms.ready`, { ready: c.rooms.ready, total: c.rooms.total }) : t(`${k}.rooms.off`),
      sub: t(`${k}.rooms.sub`),
    },
  ];
}

export function Chain({ links, active, compact = false }: { links: Link[]; active?: Link['key'] | null; compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(4, minmax(0, 1fr))' }, gap: 1.25, alignItems: 'stretch' }} data-testid="admin-conn-chain">
      {links.map((link, i) => (
        <Box
          key={link.key}
          data-testid={`admin-conn-link-${link.key}`}
          data-tone={link.tone}
          sx={{
            ...panelSx,
            p: compact ? 1 : 1.5,
            position: 'relative',
            display: 'grid',
            gap: 0.4,
            border: `2px solid ${active === link.key ? accent.main : `color-mix(in srgb, ${TONE[link.tone]} 55%, transparent)`}`,
            boxShadow: active === link.key ? `0 0 0 4px ${accent.washSoft}` : undefined,
            '&::after': i < links.length - 1 ? { content: '"→"', position: 'absolute', right: { xs: 'auto', sm: -15 }, left: { xs: '50%', sm: 'auto' }, bottom: { xs: -17, sm: 'auto' }, top: { sm: '40%' }, color: ink.low, fontWeight: 800, transform: { xs: 'rotate(90deg)', sm: 'none' } } : {},
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: ink.mid, '& svg': { fontSize: 20 } }}>
            {link.icon}
            <Box sx={{ ...typo.body, fontWeight: 800, color: ink.hi }}>{t(`admin.card.conn.link.${link.key}`)}</Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ...typo.caption, fontWeight: 800, color: TONE[link.tone] }}>
            <Box component="span" aria-hidden sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: TONE[link.tone], flex: 'none' }} />
            {link.word}
          </Box>
          {!compact ? <Box sx={{ ...typo.caption, color: ink.mid, minWidth: 0, overflowWrap: 'anywhere' }}>{link.sub}</Box> : null}
        </Box>
      ))}
    </Box>
  );
}

/* ── Что видно о сервере: принял ли коннектор, последняя проверка ───────── */

function ApplyState({ c }: { c: ConnectionState }) {
  const { t } = useTranslation();
  const k = 'admin.card.conn.apply';
  const s = c.server;
  if (!s) return <Box sx={{ ...typo.caption, color: ink.mid }} data-testid="admin-conn-apply">{t(`${k}.none`)}</Box>;
  let tone: Tone = 'warn';
  let text: ReactNode;
  if (s.apply_error) {
    tone = 'bad';
    text = (
      <>
        <b>{t(`${k}.error.${s.apply_error}`, { address: s.apply_detail ?? '', defaultValue: t(`${k}.error.other`) })}</b> {t(`${k}.todo.${s.apply_error}`, { defaultValue: t(`${k}.todo.other`) })}
      </>
    );
  } else if (s.applied_revision === s.revision) {
    tone = 'ok';
    text = t(`${k}.applied`);
  } else if (c.connector.state !== 'online') {
    text = t(`${k}.offline`);
  } else {
    text = t(`${k}.waiting`);
  }
  return (
    <Box sx={{ ...typo.caption, color: TONE[tone], p: 1, borderRadius: `${shape.radiusSmall}px`, border: `1px solid color-mix(in srgb, ${TONE[tone]} 45%, transparent)` }} data-testid="admin-conn-apply" data-tone={tone}>
      {text}
    </Box>
  );
}

function CheckResult({ check }: { check: ServerCheck }) {
  const { t } = useTranslation();
  const k = 'admin.card.conn.check';
  const tone: Tone = check.reachable ? 'ok' : 'bad';
  const what = check.reachable ? 'ok' : !check.connector ? 'noConnector' : check.error === 'TTL_EXPIRED' ? 'oldConnector' : 'down';
  return (
    <Box sx={{ ...typo.body, color: TONE[tone], display: 'grid', gap: 0.25 }} data-testid="admin-conn-check-result" data-tone={tone}>
      <b>{t(`${k}.${what}`, { ms: check.latency_ms ?? 0, address: check.address ?? '' })}</b>
      {!check.reachable ? <Box sx={{ ...typo.caption, color: ink.mid }}>{t(`${k}.todo.${what}`)}</Box> : null}
      {check.reachable && check.source ? <Box sx={{ ...typo.caption, color: ink.mid }}>{t(`admin.card.conn.source.${check.source}`)}</Box> : null}
    </Box>
  );
}

/* ── Форма сервера управления ───────────────────────────────────────────── */

const KINDS: Array<{ key: 'iridi' | 'bittel' | 'other'; ready: boolean }> = [
  { key: 'iridi', ready: true },
  { key: 'bittel', ready: false },
  { key: 'other', ready: false },
];

function Chips<V extends string>({ value, options, onChange, testId, disabled }: { value: V; options: Array<[V, ReactNode, boolean?]>; onChange: (v: V) => void; testId: string; disabled?: boolean }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }} role="radiogroup">
      {options.map(([key, label, off]) => (
        <ButtonBase
          key={key}
          role="radio"
          aria-checked={value === key}
          disabled={disabled || off}
          onClick={() => onChange(key)}
          data-testid={`${testId}-${key}`}
          sx={{ gap: 0.75, px: 1.25, py: 0.6, borderRadius: `${shape.pill}px`, ...typo.caption, fontWeight: 700, border: `1px solid ${value === key ? accent.main : surface.line}`, color: off ? ink.low : value === key ? accent.soft : ink.mid, bgcolor: value === key ? accent.washSoft : 'transparent' }}
        >
          {label}
        </ButtonBase>
      ))}
    </Box>
  );
}

export function ServerForm({ hotelId, c, onSaved }: { hotelId: string; c: ConnectionState; onSaved?: (next: ConnectionState) => void }) {
  const { t } = useTranslation();
  const { canWrite } = useRights();
  const qc = useQueryClient();
  const k = 'admin.card.conn.form';
  const s = c.server;
  const [form, setForm] = useState<ControlServerIn>(() => ({
    kind: s?.kind ?? 'iridi',
    protocol: s?.protocol ?? 'http',
    host: s?.host ?? '',
    port: s?.port ?? 1085,
    auth: s?.auth ?? 'none',
    login: s?.login ?? '',
    secret: null,
    timeout_ms: s?.timeout_ms ?? 3000,
    is_enabled: s?.is_enabled ?? true,
    node_id: s?.node_id ?? c.connector.id,
  }));
  const [editSecret, setEditSecret] = useState(!s?.has_secret);
  const save = useMutation({
    mutationFn: () => putControlServer(hotelId, { ...form, secret: editSecret ? form.secret || null : null }),
    onSuccess: (next) => {
      qc.setQueryData(connectionKey(hotelId), next);
      void qc.invalidateQueries({ queryKey: ['admin', 'readiness', hotelId] });
      setEditSecret(!next.server?.has_secret);
      setForm((f) => ({ ...f, secret: null }));
      onSaved?.(next);
    },
  });
  const set = <K extends keyof ControlServerIn>(key: K, value: ControlServerIn[K]) => setForm((f) => ({ ...f, [key]: value }));
  const label = (text: string, help: string) => (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      {text}
      <Help>{help}</Help>
    </Box>
  );
  const disabled = !canWrite;
  return (
    <Box sx={{ display: 'grid', gap: 2 }} data-testid="admin-conn-server-form">
      <Box>
        <Box sx={{ ...typo.label, color: ink.mid, mb: 0.75, display: 'flex', alignItems: 'center', gap: 0.5 }}>{t(`${k}.kind`)}<Help>{t(`${k}.kindHelp`)}</Help></Box>
        <Chips
          value={form.kind as 'iridi'}
          onChange={(v) => set('kind', v)}
          testId="admin-conn-kind"
          disabled={disabled}
          options={KINDS.map((kind) => [kind.key as 'iridi', <>{t(`${k}.kinds.${kind.key}`)}{!kind.ready ? <Pill tone="muted">{t(`${k}.soon`)}</Pill> : null}</>, !kind.ready])}
        />
      </Box>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr 1.4fr' } }}>
        <TextField size="small" label={label(t(`${k}.host`), t(`${k}.hostHelp`))} value={form.host} onChange={(e) => set('host', e.target.value.trim().slice(0, 255))} disabled={disabled} sx={fieldSx} InputLabelProps={{ shrink: true }} placeholder="10.10.20.15" inputProps={{ 'data-testid': 'admin-conn-host', 'data-words': 'data' }} />
        <TextField size="small" label={t(`${k}.port`)} value={form.port || ''} onChange={(e) => set('port', Number(e.target.value.replace(/\D/g, '').slice(0, 5)) || 0)} disabled={disabled} sx={fieldSx} inputProps={{ inputMode: 'numeric', 'data-testid': 'admin-conn-port' }} />
        <SelectField
          label={label(t(`${k}.protocol`), t(`${k}.protocolHelp`))}
          value={form.protocol}
          onChange={(v) => set('protocol', v)}
          options={[{ value: 'http', label: t(`${k}.protocols.http`) }, { value: 'https', label: t(`${k}.protocols.https`) }]}
          disabled={disabled}
          testId="admin-conn-protocol"
          fieldSx={fieldSx}
        />
      </Box>
      <Box>
        <Box sx={{ ...typo.label, color: ink.mid, mb: 0.75, display: 'flex', alignItems: 'center', gap: 0.5 }}>{t(`${k}.auth`)}<Help>{t(`${k}.authHelp`)}</Help></Box>
        <Chips value={form.auth as 'none'} onChange={(v) => set('auth', v)} testId="admin-conn-auth" disabled={disabled} options={(['none', 'basic', 'token'] as const).map((a) => [a as 'none', t(`${k}.auths.${a}`)])} />
      </Box>
      {form.auth !== 'none' ? (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          {form.auth === 'basic' ? (
            <TextField size="small" label={t(`${k}.login`)} value={form.login} onChange={(e) => set('login', e.target.value.slice(0, 128))} disabled={disabled} sx={fieldSx} inputProps={{ 'data-testid': 'admin-conn-login', 'data-words': 'data' }} />
          ) : null}
          {editSecret ? (
            <TextField
              size="small"
              type="password"
              autoComplete="new-password"
              label={t(form.auth === 'basic' ? `${k}.password` : `${k}.token`)}
              value={form.secret ?? ''}
              onChange={(e) => set('secret', e.target.value.slice(0, 512))}
              disabled={disabled}
              sx={fieldSx}
              helperText={t(`${k}.secretHelp`)}
              inputProps={{ 'data-testid': 'admin-conn-secret' }}
            />
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: `${shape.radiusSmall}px`, border: `1px solid ${surface.line}` }} data-testid="admin-conn-secret-set">
              <Box sx={{ flex: 1 }}>
                <Box sx={{ ...typo.label, color: ink.mid }}>{t(form.auth === 'basic' ? `${k}.password` : `${k}.token`)}</Box>
                <Box sx={{ ...typo.body, color: ink.hi, letterSpacing: 2 }}>••••••••</Box>
              </Box>
              {canWrite ? <Button size="small" sx={secondaryButtonSx} onClick={() => setEditSecret(true)} data-testid="admin-conn-secret-change">{t(`${k}.change`)}</Button> : null}
            </Box>
          )}
        </Box>
      ) : null}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, alignItems: 'center' }}>
        <TextField size="small" label={label(t(`${k}.timeout`), t(`${k}.timeoutHelp`))} value={form.timeout_ms || ''} onChange={(e) => set('timeout_ms', Number(e.target.value.replace(/\D/g, '').slice(0, 5)) || 0)} disabled={disabled} sx={fieldSx} InputLabelProps={{ shrink: true }} inputProps={{ inputMode: 'numeric', 'data-testid': 'admin-conn-timeout' }} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ...typo.body, color: ink.hi }}>
          <Switch checked={form.is_enabled} onChange={(e) => set('is_enabled', e.target.checked)} disabled={disabled} inputProps={{ 'aria-label': t(`${k}.enabled`) }} />
          {t(`${k}.enabled`)}
          <Help>{t(`${k}.enabledHelp`)}</Help>
        </Box>
      </Box>
      {save.isError ? <Typography sx={{ ...typo.caption, color: state.bad }} data-testid="admin-conn-save-error">{errorText(save.error)}</Typography> : null}
      {canWrite ? (
        <Box>
          <Button sx={primaryButtonSx} disabled={save.isPending || !form.host} onClick={() => save.mutate()} data-testid="admin-conn-save">
            {t(`${k}.save`)}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}

/* ── Постоянный экран «Подключения» ─────────────────────────────────────── */

export function ConnectionScreen({ hotelId, onWizard }: { hotelId: string; onWizard: () => void }) {
  const { t, i18n } = useTranslation();
  const { canWrite } = useRights();
  const qc = useQueryClient();
  const conn = useConnection(hotelId);
  const links = useLinks(conn.data);
  const [editing, setEditing] = useState(false);
  const [checked, setChecked] = useState<ServerCheck | null>(null);
  const k = 'admin.card.conn';
  const check = useMutation({
    mutationFn: () => checkControlServer(hotelId),
    onSuccess: (next) => {
      setChecked(next.check);
      qc.setQueryData(connectionKey(hotelId), next);
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteControlServer(hotelId),
    onSuccess: (next) => qc.setQueryData(connectionKey(hotelId), next),
  });
  const c = conn.data;
  if (!c) return null;
  const s = c.server;
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(i18n.language) : '—');
  return (
    <Panel
      title={t(`${k}.title`)}
      aside={
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {canWrite ? (
            <Button size="small" sx={primaryButtonSx} onClick={onWizard} data-testid="admin-conn-wizard-open">
              {t(c.connector.state === 'none' ? `${k}.connect` : `${k}.reconnect`)}
            </Button>
          ) : null}
        </Box>
      }
    >
      <Box sx={{ display: 'grid', gap: 2 }} data-testid="admin-conn-screen">
        <Chain links={links} />
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: '1.2fr 1fr' }, alignItems: 'start' }}>
          <Box sx={{ display: 'grid', gap: 1 }}>
            <Fact label={t(`${k}.fact.address`)} testId="admin-conn-address">
              {s && c.server_link.source === 'control' ? <span data-words="data">{`${s.host}:${s.port}`}</span> : t(`${k}.server.addressFile`)}
            </Fact>
            {s && c.server_link.source !== 'control' ? (
              <Fact label={t(`${k}.fact.inControl`)} testId="admin-conn-address-control">
                <span data-words="data">{`${s.host}:${s.port}`}</span>
              </Fact>
            ) : null}
            <Fact label={t(`${k}.fact.source`)} testId="admin-conn-source">
              {c.server_link.source ? t(`${k}.source.${c.server_link.source}`) : t(`${k}.source.unknown`)}
            </Fact>
            {s ? <Fact label={t(`${k}.fact.auth`)}>{t(`${k}.form.auths.${s.auth}`)}{s.has_secret ? ` · ${t(`${k}.fact.secretSet`)}` : ''}</Fact> : null}
            <Fact label={t(`${k}.fact.lastCheck`)}>
              {s?.last_check_at ? `${when(s.last_check_at)} · ${s.last_check_ok ? t(`${k}.server.ok`) : t(`${k}.server.down`)}` : t(`${k}.fact.never`)}
            </Fact>
            <ApplyState c={c} />
          </Box>
          <Box sx={{ display: 'grid', gap: 1 }}>
            {canWrite ? (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button sx={secondaryButtonSx} onClick={() => check.mutate()} disabled={check.isPending} data-testid="admin-conn-check">
                  {check.isPending ? t(`${k}.checking`) : t(`${k}.checkNow`)}
                </Button>
                <Button sx={secondaryButtonSx} onClick={() => setEditing(true)} data-testid="admin-conn-edit">
                  {t(s ? `${k}.editServer` : `${k}.setServer`)}
                </Button>
                {s ? (
                  <Button sx={{ ...secondaryButtonSx, color: ink.mid }} onClick={() => remove.mutate()} disabled={remove.isPending} data-testid="admin-conn-remove">
                    {t(`${k}.useFile`)}
                  </Button>
                ) : null}
                <Help>{t(`${k}.useFileHelp`)}</Help>
              </Box>
            ) : null}
            {checked ? <CheckResult check={checked} /> : null}
            {check.isError ? <Typography sx={{ ...typo.caption, color: state.bad }}>{errorText(check.error)}</Typography> : null}
          </Box>
        </Box>
      </Box>
      {editing ? (
        <Sheet title={t(`${k}.form.title`)} onClose={() => setEditing(false)} testId="admin-conn-edit-dialog">
          <ServerForm hotelId={hotelId} c={c} onSaved={() => setEditing(false)} />
        </Sheet>
      ) : null}
    </Panel>
  );
}

function Fact({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, ...typo.caption, borderBottom: `1px solid ${surface.hair}`, py: 0.4 }} data-testid={testId}>
      <Box sx={{ color: ink.mid }}>{label}</Box>
      <Box sx={{ color: ink.hi, fontWeight: 700, textAlign: 'end' }}>{children}</Box>
    </Box>
  );
}

/* ── Окно: по центру, на телефоне — во весь экран ───────────────────────── */

function Sheet({ title, onClose, children, testId, footer }: { title: string; onClose: () => void; children: ReactNode; testId: string; footer?: ReactNode }) {
  const phone = useMediaQuery('(max-width:599px)');
  return (
    <Dialog
      open
      onClose={onClose}
      fullScreen={phone}
      maxWidth="md"
      fullWidth
      data-testid={testId}
      slotProps={{ paper: { sx: { ...glassPanel('sheet'), backgroundImage: 'none', borderRadius: phone ? 0 : `${shape.radiusLarge}px`, boxShadow: shadow.dialog, display: 'flex', flexDirection: 'column' } } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: { xs: '14px 14px 8px', sm: '18px 22px 8px' } }}>
        <Typography component="h2" sx={{ ...typo.pageTitle, fontSize: 20, color: ink.hi, flex: 1 }}>{title}</Typography>
        <IconButton size="small" onClick={onClose} aria-label="×" data-testid={`${testId}-close`}><CloseIcon /></IconButton>
      </Box>
      <Box sx={{ p: { xs: 1.75, sm: 2.75 }, pt: { xs: 1, sm: 1 }, overflowY: 'auto', flex: 1 }}>{children}</Box>
      {footer ? <Box sx={{ display: 'flex', gap: 1, p: { xs: '10px 14px 14px', sm: '12px 22px 18px' }, borderTop: `1px solid ${surface.hair}`, flexWrap: 'wrap' }}>{footer}</Box> : null}
    </Dialog>
  );
}

/* ── Мастер ─────────────────────────────────────────────────────────────── */

type Step = 0 | 1 | 2 | 3 | 4;
const STEPS = ['what', 'connector', 'server', 'room', 'done'] as const;

/** Команда установки: ключ, адрес облака и разрешённый круг. Только данные, не слова экрана. */
export function installCommand({ key, url, target, port, host }: { key: string; url: string; target: string; port: number; host?: string | null }) {
  const isNet = target.includes('/');
  const rule = isNet ? { net: target, ports: [port] } : { host: target, ports: [port] };
  // Адрес в файле — запасной, пока Control не задал свой: известный сервер, иначе заглушка.
  const local = host || (isNet ? '127.0.0.1' : target);
  const config = {
    backend_url: url,
    node_key_file: '/etc/itv-connector/key',
    allowedTargets: [rule],
    endpoints: { iridi: { baseUrl: `http://${local}:${port}` } },
  };
  return [
    'sudo mkdir -p /etc/itv-connector',
    `echo '${key}' | sudo tee /etc/itv-connector/key > /dev/null`,
    "sudo tee /etc/itv-connector/config.json > /dev/null <<'JSON'",
    JSON.stringify(config, null, 2),
    'JSON',
    'sudo systemctl restart itv-connector',
  ].join('\n');
}

export function ConnectWizard({ hotelId, onClose }: { hotelId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(0);
  const conn = useConnection(hotelId, step === 1 || step === 2);
  const c = conn.data;
  const links = useLinks(c);
  const k = 'admin.card.conn.wiz';
  const active = (['cloud', 'connector', 'server', 'rooms', null] as const)[step];
  const canNext = step === 0 || (step === 1 && c?.connector.state === 'online') || (step === 2 && Boolean(c?.server) && c?.server?.applied_revision === c?.server?.revision && !c?.server?.apply_error) || step === 3;
  return (
    <Sheet
      title={t(`${k}.title`)}
      onClose={onClose}
      testId="admin-conn-wizard"
      footer={
        <>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', flex: { xs: '1 1 100%', sm: 1 }, alignItems: 'center' }}>
            {STEPS.map((s, i) => (
              <Pill key={s} tone={i === step ? 'info' : i < step ? 'ok' : 'muted'}>{`${i + 1}. ${t(`${k}.steps.${s}`)}`}</Pill>
            ))}
          </Box>
          {step > 0 && step < 4 ? <Button sx={secondaryButtonSx} onClick={() => setStep((step - 1) as Step)} data-testid="admin-conn-wiz-back">{t(`${k}.back`)}</Button> : null}
          {step < 4 ? (
            <Button sx={primaryButtonSx} disabled={!canNext} onClick={() => setStep((step + 1) as Step)} data-testid="admin-conn-wiz-next">
              {step === 3 ? t(`${k}.finish`) : t(`${k}.next`)}
            </Button>
          ) : (
            <Button sx={primaryButtonSx} onClick={onClose} data-testid="admin-conn-wiz-close">{t(`${k}.close`)}</Button>
          )}
        </>
      }
    >
      <Box sx={{ display: 'grid', gap: 2 }} data-testid={`admin-conn-wiz-step-${STEPS[step]}`}>
        <Typography component="h3" sx={{ ...typo.panelTitle, color: ink.hi }}>{`${step + 1}. ${t(`${k}.steps.${STEPS[step]}`)}`}</Typography>
        {c ? <Chain links={links} active={active} compact={step > 0} /> : null}
        {step === 0 ? <Box sx={{ ...typo.body, color: ink.mid, display: 'grid', gap: 1 }}><Box>{t(`${k}.what1`)}</Box><Box>{t(`${k}.what2`)}</Box></Box> : null}
        {step === 1 && c ? <ConnectorStep hotelId={hotelId} c={c} /> : null}
        {step === 2 && c ? (
          <Box sx={{ display: 'grid', gap: 2 }}>
            <Box sx={{ ...typo.body, color: ink.mid }}>{t(`${k}.server`)}</Box>
            <ServerForm hotelId={hotelId} c={c} onSaved={() => void qc.invalidateQueries({ queryKey: connectionKey(hotelId) })} />
            {c.server ? <ApplyState c={c} /> : null}
            {c.server ? <InlineCheck hotelId={hotelId} /> : null}
          </Box>
        ) : null}
        {step === 3 ? <RoomStep hotelId={hotelId} /> : null}
        {step === 4 && c ? (
          <Box sx={{ ...typo.body, color: ink.hi, display: 'grid', gap: 1 }} data-testid="admin-conn-wiz-summary">
            <Box>{t(`${k}.done1`)}</Box>
            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
              <li>{t(`${k}.doneConnector`, { name: c.connector.name ?? '—' })}</li>
              <li>
                {t(`${k}.doneServer`)} <span data-words="data">{c.server ? `${c.server.host}:${c.server.port}` : '—'}</span>
              </li>
              <li>{t(`${k}.doneRooms`, { ready: c.rooms.ready, total: c.rooms.total })}</li>
            </ul>
          </Box>
        ) : null}
      </Box>
    </Sheet>
  );
}

function ConnectorStep({ hotelId, c }: { hotelId: string; c: ConnectionState }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const k = 'admin.card.conn.wiz';
  const [choice, setChoice] = useState<string>(c.connector.id ?? 'new');
  const [name, setName] = useState(t(`${k}.defaultName`));
  const [target, setTarget] = useState(c.server?.host ?? '10.10.20.0/24');
  const [port, setPort] = useState(c.server?.port ?? 1085);
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const issued = useMutation({
    mutationFn: async () => (choice === 'new' ? createNode(hotelId, { name: name.trim(), purpose: 'grms' }) : reissueHotelNode(hotelId, choice)),
    onSuccess: async (result) => {
      setKey(result.key);
      setChoice(result.node.id);
      await qc.invalidateQueries({ queryKey: connectionKey(hotelId) });
      void qc.invalidateQueries({ queryKey: ['admin', 'hotel-nodes', hotelId] });
    },
  });
  const chosen = c.nodes.find((n) => n.id === choice);
  const command = useMemo(() => (key ? installCommand({ key, url: c.connector_url, target, port, host: c.server?.host }) : null), [key, c.connector_url, target, port, c.server?.host]);
  const online = chosen?.online;
  return (
    <Box sx={{ display: 'grid', gap: 2 }} data-testid="admin-conn-wiz-connector">
      <Box sx={{ ...typo.body, color: ink.mid }}>{t(`${k}.connectorLead`)}</Box>
      {c.nodes.length ? (
        <Chips
          value={choice}
          onChange={(v) => {
            setChoice(v);
            setKey(null);
          }}
          testId="admin-conn-node"
          options={[...c.nodes.map((n) => [n.id, <><span data-words="data">{n.name}</span> · {n.online ? t('admin.card.conn.connector.online') : n.never ? t('admin.card.conn.connector.never') : t('admin.card.conn.connector.silent')}</>] as [string, ReactNode]), ['new', t(`${k}.newConnector`)]]}
        />
      ) : null}
      {choice === 'new' ? <TextField size="small" label={t(`${k}.connectorName`)} value={name} onChange={(e) => setName(e.target.value.slice(0, 128))} sx={fieldSx} inputProps={{ 'data-testid': 'admin-conn-node-name', 'data-words': 'data' }} /> : null}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' } }}>
        <TextField
          size="small"
          label={<Box component="span" sx={{ display: 'inline-flex', gap: 0.5, alignItems: 'center' }}>{t(`${k}.circle`)}<Help>{t(`${k}.circleHelp`)}</Help></Box>}
          value={target}
          onChange={(e) => setTarget(e.target.value.trim().slice(0, 128))}
          sx={fieldSx}
          InputLabelProps={{ shrink: true }}
          inputProps={{ 'data-testid': 'admin-conn-circle', 'data-words': 'data' }}
        />
        <TextField size="small" label={t(`${k}.circlePort`)} value={port || ''} onChange={(e) => setPort(Number(e.target.value.replace(/\D/g, '').slice(0, 5)) || 0)} sx={fieldSx} inputProps={{ inputMode: 'numeric', 'data-testid': 'admin-conn-circle-port' }} />
      </Box>
      {online && !key ? (
        <Box sx={{ ...typo.body, color: state.ok, fontWeight: 700 }} data-testid="admin-conn-wiz-online">{t(`${k}.alreadyOnline`)}</Box>
      ) : null}
      {!key ? (
        <Box>
          <Button sx={choice === 'new' || !online ? primaryButtonSx : secondaryButtonSx} disabled={issued.isPending || (choice === 'new' && !name.trim())} onClick={() => issued.mutate()} data-testid="admin-conn-issue">
            {choice === 'new' ? t(`${k}.issueNew`) : t(`${k}.issueAgain`)}
          </Button>
          {choice !== 'new' ? <Box sx={{ ...typo.caption, color: state.warn, mt: 0.75 }}>{t(`${k}.issueAgainWarn`)}</Box> : null}
          {issued.isError ? <Typography sx={{ ...typo.caption, color: state.bad, mt: 0.5 }}>{errorText(issued.error)}</Typography> : null}
        </Box>
      ) : (
        <Box sx={{ display: 'grid', gap: 1 }}>
          <Box sx={{ ...typo.label, color: ink.mid }}>{t(`${k}.command`)}</Box>
          <Box component="pre" sx={{ m: 0, p: 1.5, borderRadius: `${shape.radiusSmall}px`, bgcolor: surface.s3, color: ink.hi, fontSize: 12, overflowX: 'auto', whiteSpace: 'pre' }} data-words="data" data-testid="admin-conn-command">
            {command}
          </Box>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button
              size="small"
              sx={secondaryButtonSx}
              startIcon={<ContentCopyOutlinedIcon fontSize="small" />}
              onClick={() => {
                void navigator.clipboard?.writeText(command ?? '').then(() => setCopied(true), () => undefined);
              }}
              data-testid="admin-conn-copy"
            >
              {copied ? t(`${k}.copied`) : t(`${k}.copy`)}
            </Button>
            <Box sx={{ ...typo.caption, color: ink.mid }}>{t(`${k}.keyOnce`)}</Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ...typo.body, color: online ? state.ok : ink.hi }} data-testid="admin-conn-wiz-wait" data-online={online ? 'true' : 'false'}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: online ? state.ok : state.warn, animation: online ? 'none' : 'pulse 1.2s infinite', '@keyframes pulse': { '50%': { opacity: 0.3 } } }} />
            {online ? t(`${k}.online`) : t(`${k}.waiting`)}
          </Box>
        </Box>
      )}
    </Box>
  );
}

function InlineCheck({ hotelId }: { hotelId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [result, setResult] = useState<ServerCheck | null>(null);
  const check = useMutation({
    mutationFn: () => checkControlServer(hotelId),
    onSuccess: (next) => {
      setResult(next.check);
      qc.setQueryData(connectionKey(hotelId), next);
    },
  });
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box>
        <Button sx={secondaryButtonSx} onClick={() => check.mutate()} disabled={check.isPending} data-testid="admin-conn-check">
          {check.isPending ? t('admin.card.conn.checking') : t('admin.card.conn.checkNow')}
        </Button>
      </Box>
      {result ? <CheckResult check={result} /> : null}
    </Box>
  );
}

// Причины сервера — кодами из разбора номера; слова — по своим ключам.
const READ_REASON: Record<string, string> = { NO_ROOM: 'no_room', NO_ROOM_TYPE: 'no_type', NO_PUBLISHED_CONFIG: 'no_config' };

function RoomStep({ hotelId }: { hotelId: string }) {
  const { t } = useTranslation();
  const k = 'admin.card.conn.wiz';
  const map = useQuery({ queryKey: ['admin', 'hotel-rooms-map', hotelId, { wizard: '1' }], queryFn: () => getRoomsMap(hotelId, {}) });
  const rooms = useMemo(() => (map.data?.buildings ?? []).flatMap((b) => b.floors.flatMap((f) => f.rooms)).filter((r) => r.variant), [map.data]);
  const [roomId, setRoomId] = useState('');
  useEffect(() => {
    if (!roomId && rooms[0]) setRoomId(rooms[0].id);
  }, [rooms, roomId]);
  const [result, setResult] = useState<RoomRead | null>(null);
  const read = useMutation({ mutationFn: () => readRoomState(hotelId, roomId), onSuccess: setResult });
  return (
    <Box sx={{ display: 'grid', gap: 2 }} data-testid="admin-conn-wiz-room">
      <Box sx={{ ...typo.body, color: ink.mid }}>{t(`${k}.roomLead`)}</Box>
      {rooms.length ? (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Box sx={{ minWidth: 220 }}>
            <SelectField label={t('admin.card.rooms.col.number')} value={roomId} onChange={setRoomId} options={rooms.map((r) => ({ value: r.id, label: r.number }))} testId="admin-conn-room" fieldSx={fieldSx} />
          </Box>
          <Button sx={primaryButtonSx} disabled={!roomId || read.isPending} onClick={() => read.mutate()} data-testid="admin-conn-room-read">
            {read.isPending ? t(`${k}.reading`) : t(`${k}.read`)}
          </Button>
        </Box>
      ) : (
        <Box sx={{ ...typo.body, color: state.warn }}>{t(`${k}.noRooms`)}</Box>
      )}
      {result ? (
        <Box sx={{ ...typo.body, color: result.ok ? state.ok : state.bad, display: 'grid', gap: 0.5 }} data-testid="admin-conn-room-result" data-ok={result.ok ? 'true' : 'false'}>
          <b>{result.ok ? t(`${k}.readOk`, { answered: result.answered, read: result.read }) : t(`${k}.readReason.${READ_REASON[result.reason] ?? result.reason}`, { defaultValue: t(`${k}.readReason.other`) })}</b>
          {result.device ? <Box sx={{ ...typo.caption, color: ink.mid }}>{t(`${k}.device`)} <span data-words="data">{result.device}</span></Box> : null}
          <Box sx={{ ...typo.caption, color: ink.mid }}>{t(`${k}.readSafe`)}</Box>
        </Box>
      ) : null}
      {read.isError ? <Typography sx={{ ...typo.caption, color: state.bad }}>{errorText(read.error)}</Typography> : null}
    </Box>
  );
}
