import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { QueryState } from '@/components/QueryState';
import { useActionFailed } from '@/hooks/useActionFailed';
import { useRights } from '../../useRights';
import { ink, primaryButtonSx, secondaryButtonSx, shape, state, surface, typo } from '../../adminTokens';
import {
  disableHotel,
  enableHotel,
  getModules,
  type FixTarget,
  type HotelProfile,
  type Readiness,
  type ReadinessProblem,
  type Severity,
} from '../../adminClient';
import { Dot, Empty, Help, Metric, Panel, Pill } from '../hotels/hotelsUi';
import { DisableDialog } from './hotelDialogs';

/**
 * ОБЗОР ОТЕЛЯ (партия 62-B, по утверждённому макету): что мешает отелю
 * работать прямо сейчас и куда идти это исправлять.
 *
 * Правила считает сервер (`/hotels/{id}/readiness`, кэш минута) — то же
 * число стоит в строке «Отелей» и в сводке группы. Экран только называет их
 * своими словами: важность цветом, «исправить» — на вкладку, где это правят.
 */

export const SEVERITY_TONE: Record<Severity, 'bad' | 'warn' | 'info'> = { bad: 'bad', warn: 'warn', info: 'info' };
const ROOM_MODULE_OFF = new Set(['rooms_without_variant', 'variant_unpublished', 'failed_commands', 'rooms_without_pin']);

export function OverviewTab({
  hotel,
  readiness,
  onFix,
}: {
  hotel: HotelProfile;
  readiness: UseQueryResult<Readiness>;
  onFix: (target: FixTarget) => void;
}) {
  const { t } = useTranslation();
  return (
    <QueryState query={readiness} what={t('admin.card.what')}>
      {(data) => <Overview hotel={hotel} data={data} onFix={onFix} />}
    </QueryState>
  );
}

function Overview({ hotel, data, onFix }: { hotel: HotelProfile; data: Readiness; onFix: (target: FixTarget) => void }) {
  const { t } = useTranslation();
  const f = data.facts;
  const passed = data.rules.filter((rule) => rule.status === 'pass');
  const failed = f.commands.failed;
  const connector = f.connector;

  return (
    <Box sx={{ display: 'grid', gap: 2 }} data-testid="admin-overview">
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(5, minmax(0, 1fr))' } }}>
        <Metric
          label={t('admin.card.metric.rooms')}
          value={f.rooms}
          hint={f.room_control ? t('admin.card.metric.roomsBound', { count: f.rooms_bound }) : t('admin.card.metric.roomControlOff')}
        />
        <Metric label={t('admin.card.metric.staff')} value={f.staff} hint={t('admin.card.metric.admins', { count: f.admins })} />
        <Metric
          label={t('admin.card.metric.services')}
          value={f.services}
          hint={t('admin.card.metric.menuServices', { count: f.menu_services, items: f.items })}
        />
        <Metric
          label={t('admin.card.metric.connector')}
          value={connector ? (connector.online ? t('admin.card.metric.online') : t('admin.card.metric.silent')) : t('admin.card.metric.noConnector')}
          tone={connector ? (connector.online ? 'ok' : 'bad') : 'muted'}
          hint={connector ? seen(t, connector.seconds) : t('admin.card.metric.noConnectorHint')}
        />
        <Metric
          label={t('admin.card.metric.commands')}
          value={f.room_control ? t('admin.card.metric.commandsValue', { ok: f.commands.total - failed, total: f.commands.total }) : '—'}
          tone={failed >= 10 ? 'warn' : undefined}
          hint={f.room_control ? t('admin.card.metric.commandsHint', { count: failed }) : t('admin.card.metric.roomControlOff')}
        />
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' }, alignItems: 'start' }}>
        <Panel
          title={t('admin.card.problemsTitle')}
          aside={
            <Box sx={{ ...typo.caption, color: ink.low, display: 'inline-flex', alignItems: 'center' }}>
              {t('admin.card.everyMinute')}
              <Help>{t('admin.card.problemsHelp')}</Help>
            </Box>
          }
        >
          {!hotel.is_active ? (
            <Box sx={{ ...typo.caption, color: ink.mid, mb: 1.5 }} data-testid="admin-overview-disabled-note">
              {t('admin.card.disabledNote')}
            </Box>
          ) : null}
          {data.problems.length ? (
            <Box sx={{ display: 'grid', gap: 1 }} data-testid="admin-overview-problems">
              {data.problems.map((problem) => (
                <ProblemRow key={problem.key} problem={problem} onFix={() => onFix(problem.fix)} />
              ))}
            </Box>
          ) : (
            <Empty title={t('admin.card.noProblems')}>{t('admin.card.noProblemsBody')}</Empty>
          )}
          {passed.length ? (
            <Box sx={{ mt: 2, pt: 1.5, borderTop: `1px solid ${surface.hair}` }} data-testid="admin-overview-passed">
              <Typography sx={{ ...typo.label, color: ink.mid, mb: 0.75 }}>{t('admin.card.passed')}</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25 }}>
                {passed.map((rule) => (
                  <Box key={rule.code} data-testid={`admin-passed-${rule.code}`} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, ...typo.caption, color: ink.mid }}>
                    <Dot tone="ok" /> {t(`admin.card.rule.${rule.code}.passed`)}
                  </Box>
                ))}
              </Box>
            </Box>
          ) : null}
          {!f.room_control ? (
            <Typography sx={{ ...typo.caption, color: ink.low, mt: 1.5 }}>
              {t('admin.card.roomRulesSkipped', { count: data.rules.filter((r) => r.status === 'skip' && ROOM_MODULE_OFF.has(r.code)).length })}
            </Typography>
          ) : null}
        </Panel>

        <Box sx={{ display: 'grid', gap: 2 }}>
          <EnabledModules hotelId={hotel.id} onOpen={() => onFix('modules')} />
          <Activation hotel={hotel} />
        </Box>
      </Box>
    </Box>
  );
}

/** «Ответил 40 с назад» / «молчит 12 мин» / «ни разу не выходил на связь». */
function seen(t: (key: string, options?: Record<string, unknown>) => string, seconds: number | null): string {
  if (seconds == null) return t('admin.card.ago.never');
  if (seconds < 120) return t('admin.card.ago.seconds', { count: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return t('admin.card.ago.minutes', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t('admin.card.ago.hours', { count: hours });
  return t('admin.card.ago.days', { count: Math.round(hours / 24) });
}

/** Слова правила: заголовок и подробность из кода и чисел сервера. */
export function useProblemText() {
  const { t } = useTranslation();
  return (problem: ReadinessProblem): { title: string; detail: string } => {
    const p = problem.params as Record<string, unknown>;
    const base = `admin.card.rule.${problem.code}`;
    switch (problem.code) {
      case 'module_without_connection':
        return {
          title: t(`${base}.title`, { module: t(`admin.module.${String(p.module)}`) }),
          detail: t(`${base}.detail`),
        };
      case 'connector_silent':
        return {
          title: t(`${base}.title`, { node: String(p.node) }),
          detail: p.seconds == null ? t(`${base}.never`) : t(`${base}.detail`, { ago: seen(t, Number(p.seconds)) }),
        };
      case 'variant_unpublished':
        return {
          title: t(`${base}.title`, { variant: String(p.variant) }),
          detail: t(`${base}.detail`, { count: Number(p.rooms) }),
        };
      case 'failed_commands': {
        const reason = String(p.reason ?? '');
        const rooms = Array.isArray(p.rooms) ? (p.rooms as string[]) : [];
        return {
          title: t(`${base}.title`, { count: problem.count }),
          detail: t(`${base}.detail`, {
            reason: t(`admin.card.reason.${reason}`, { defaultValue: t('admin.card.reason.other') }),
            reasonCount: Number(p.reason_count ?? 0),
            rooms: rooms.join(', ') || '—',
          }),
        };
      }
      case 'admin_never_logged_in': {
        const emails = Array.isArray(p.emails) ? (p.emails as string[]) : [];
        return {
          title: t(`${base}.title`, { count: problem.count }),
          detail: t(`${base}.detail`, { emails: emails.join(', ') }),
        };
      }
      default:
        return { title: t(`${base}.title`, { count: problem.count }), detail: t(`${base}.detail`, { count: problem.count }) };
    }
  };
}

function ProblemRow({ problem, onFix }: { problem: ReadinessProblem; onFix: () => void }) {
  const { t } = useTranslation();
  const text = useProblemText()(problem);
  const tone = SEVERITY_TONE[problem.severity];
  return (
    <Box
      data-testid={`admin-problem-${problem.code}`}
      data-severity={problem.severity}
      sx={{
        display: 'flex',
        gap: 1.5,
        alignItems: { xs: 'flex-start', sm: 'center' },
        flexDirection: { xs: 'column', sm: 'row' },
        p: 1.25,
        pl: 1.5,
        borderRadius: `${shape.radius}px`,
        bgcolor: surface.s1,
        border: `1px solid ${surface.hair}`,
        borderLeft: `4px solid ${state[tone]}`,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}>{text.title}</Box>
          <Pill tone={tone}>{t(`admin.card.severity.${problem.severity}`)}</Pill>
        </Box>
        <Box sx={{ ...typo.caption, color: ink.mid, mt: 0.25 }}>{text.detail}</Box>
      </Box>
      <Button
        size="small"
        sx={problem.severity === 'bad' ? primaryButtonSx : secondaryButtonSx}
        onClick={onFix}
        data-testid={`admin-problem-fix-${problem.code}`}
      >
        {t(`admin.card.rule.${problem.code}.fix`)} →
      </Button>
    </Box>
  );
}

function EnabledModules({ hotelId, onOpen }: { hotelId: string; onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  const modules = useQuery({ queryKey: ['admin', 'modules', hotelId], queryFn: () => getModules(hotelId) });
  const on = (modules.data?.modules ?? []).filter((m) => m.is_enabled);
  return (
    <Panel title={t('admin.card.enabled')}>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }} data-testid="admin-overview-modules">
        {on.map((m) => (
          <Pill key={m.code} tone="info">{m.title[i18n.language] ?? m.title.ru ?? t(`admin.module.${m.code}`)}</Pill>
        ))}
        {modules.data && !on.length ? <Box sx={{ ...typo.caption, color: ink.low }}>{t('admin.card.noModules')}</Box> : null}
      </Box>
      <Button size="small" sx={{ ...secondaryButtonSx, mt: 1.5 }} onClick={onOpen}>
        {t('admin.card.toModules')} →
      </Button>
    </Panel>
  );
}

/**
 * Отключение отеля (партия 62-C): причина обязательна и видна только здесь,
 * дата авто-включения — по желанию. Отключённый — пометка: причина, кем,
 * когда, когда включится сам.
 */
function Activation({ hotel }: { hotel: HotelProfile }) {
  const { t, i18n } = useTranslation();
  const { canWrite } = useRights();
  const qc = useQueryClient();
  const actionFailed = useActionFailed();
  const [dialog, setDialog] = useState<'disable' | 'enable' | null>(null);
  const changed = () => {
    setDialog(null);
    void qc.invalidateQueries({ queryKey: ['admin', 'hotel', hotel.id] });
    void qc.invalidateQueries({ queryKey: ['admin', 'readiness', hotel.id] });
    void qc.invalidateQueries({ queryKey: ['admin', 'activity', hotel.id] });
    void qc.invalidateQueries({ queryKey: ['admin', 'fleet'] });
  };
  const disable = useMutation({
    mutationFn: (body: { reason: string; enable_on: string | null }) => disableHotel(hotel.id, body),
    onSuccess: changed,
    onError: actionFailed,
  });
  const enable = useMutation({ mutationFn: () => enableHotel(hotel.id), onSuccess: changed, onError: actionFailed });
  const off = hotel.disabled;
  const date = (iso: string | null | undefined, withTime = false) =>
    iso ? new Date(iso).toLocaleString(i18n.language, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'long' }) : '';

  return (
    <Panel title={t('admin.card.activation.title')}>
      {hotel.is_active ? (
        <Typography sx={{ ...typo.caption, color: ink.mid, mb: 1.5 }}>{t('admin.card.activation.onText')}</Typography>
      ) : (
        <Box data-testid="admin-hotel-disabled-mark" sx={{ mb: 1.5, p: 1.25, borderRadius: `${shape.radius}px`, bgcolor: 'var(--adm-state-bad-wash)', ...typo.caption, color: ink.hi, display: 'grid', gap: 0.5 }}>
          <Box sx={{ fontWeight: 700 }}>{t('admin.card.activation.offTitle')}</Box>
          {off?.reason ? <Box data-testid="admin-hotel-disabled-reason">{t('admin.card.activation.reason', { reason: off.reason })}</Box> : null}
          {off?.at ? <Box>{t('admin.card.activation.when', { at: date(off.at, true), by: off.by || '—' })}</Box> : null}
          <Box>{off?.enable_on ? t('admin.card.activation.enableOn', { date: date(off.enable_on) }) : t('admin.card.activation.manual')}</Box>
          <Box sx={{ color: ink.mid }}>{t('admin.card.activation.onlyHere')}</Box>
        </Box>
      )}
      {canWrite ? (
        <Button
          sx={hotel.is_active ? { ...secondaryButtonSx, color: state.bad, borderColor: state.bad } : primaryButtonSx}
          onClick={() => setDialog(hotel.is_active ? 'disable' : 'enable')}
          disabled={disable.isPending || enable.isPending}
          data-testid={hotel.is_active ? 'admin-overview-disable' : 'admin-overview-enable'}
        >
          {hotel.is_active ? t('admin.card.activation.disable') : t('admin.card.activation.enable')}
        </Button>
      ) : null}
      {dialog === 'disable' ? (
        <DisableDialog
          title={t('admin.card.disable.title', { name: hotel.name })}
          busy={disable.isPending}
          onSubmit={(body) => disable.mutate(body)}
          onClose={() => setDialog(null)}
        />
      ) : null}
      <ConfirmDialog
        open={dialog === 'enable'}
        testId="admin-overview-active-confirm"
        title={t('admin.hotel.activeConfirm.onTitle', { name: hotel.name })}
        description={t('admin.hotel.activeConfirm.onBody')}
        confirmLabel={t('admin.hotel.activeConfirm.on')}
        onConfirm={() => enable.mutate()}
        onClose={() => setDialog(null)}
      />
    </Panel>
  );
}
