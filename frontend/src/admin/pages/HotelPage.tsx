import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { accent, ink, panelSx, primaryButtonSx, state, surface } from '../adminTokens';
import { EnterHotelDialog } from '../EnterHotelDialog';
import {
  cancelOffboarding,
  downloadHotelExport,
  getActivity,
  getHotel,
  getModules,
  getUsage,
  patchHotel,
  putModules,
  markOffboarding,
  purgeHotel,
  setHotelAdmin,
  setTariff,
  type DowngradeWarning,
  type HotelProfile,
  type ModuleEntry,
} from '../adminClient';

const TABS = ['profile', 'usage', 'modules', 'activity', 'tariff', 'data'] as const;
type Tab = (typeof TABS)[number];

/**
 * Карточка отеля — на вкладках, а не одним свитком.
 *
 * Вкладки соответствуют разным вопросам о разной природе: «кто это» (профиль),
 * «влезает ли в тариф» (использование), «что ему открыто» (модули), «что с ним
 * делали» (журнал), «на чём он сидит» (тариф). Один свиток заставлял бы
 * прокручивать журнал, чтобы поменять валюту.
 */
export function HotelPage({ id, onBack }: { id: string; onBack: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('profile');
  const [entering, setEntering] = useState(false);
  const profile = useQuery({ queryKey: ['admin', 'hotel', id], queryFn: () => getHotel(id) });

  if (profile.isLoading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (profile.isError || !profile.data) {
    return <Alert severity="error">{t('admin.hotel.loadFailed')}</Alert>;
  }
  const hotel = profile.data;

  return (
    <Box data-testid="admin-hotel">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography sx={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em' }}
            data-testid="admin-hotel-name">
            {hotel.name}
          </Typography>
          <Typography sx={{ color: ink.low, fontSize: 13, mt: 0.5 }}>{hotel.subdomain}</Typography>
        </Box>
        <Button onClick={onBack} data-testid="admin-hotel-back" sx={{ color: ink.mid }}>
          {t('admin.hotel.back')}
        </Button>
        <Button onClick={() => setEntering(true)} data-testid="admin-hotel-enter" sx={primaryButtonSx}>
          {t('admin.enter.button')}
        </Button>
      </Box>

      <Box sx={{ display: 'flex', gap: 0.5, mt: 2, borderBottom: `1px solid ${surface.line}` }}>
        {TABS.map((key) => (
          <ButtonBase
            key={key}
            onClick={() => setTab(key)}
            data-testid={`admin-hotel-tab-${key}`}
            data-active={tab === key ? 'true' : undefined}
            sx={{
              px: 1.75,
              py: 1.25,
              fontSize: 13,
              fontWeight: 700,
              color: tab === key ? accent.soft : ink.mid,
              borderBottom: `2px solid ${tab === key ? accent.main : 'transparent'}`,
            }}
          >
            {t(`admin.hotel.tab.${key}`)}
          </ButtonBase>
        ))}
      </Box>

      <Box sx={{ mt: 2.25 }}>
        {tab === 'profile' ? <ProfileTab hotel={hotel} /> : null}
        {tab === 'usage' ? <UsageTab id={id} /> : null}
        {tab === 'modules' ? <ModulesTab id={id} /> : null}
        {tab === 'activity' ? <ActivityTab id={id} /> : null}
        {tab === 'tariff' ? <TariffTab id={id} /> : null}
        {tab === 'data' ? <DataTab hotel={hotel} /> : null}
      </Box>

      {entering ? (
        <EnterHotelDialog hotelId={id} hotelName={hotel.name} onClose={() => setEntering(false)} />
      ) : null}
    </Box>
  );
}

/* ── Профиль ────────────────────────────────────────────────────────────── */

function ProfileTab({ hotel }: { hotel: HotelProfile }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [adminEmail, setAdminEmail] = useState('');
  const [issued, setIssued] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'hotel', hotel.id] });
    void qc.invalidateQueries({ queryKey: ['admin', 'fleet'] });
  };
  const toggleActive = useMutation({
    mutationFn: (next: boolean) => patchHotel(hotel.id, { is_active: next } as Partial<HotelProfile>),
    onSuccess: refresh,
  });
  const resetAdmin = useMutation({
    mutationFn: () => setHotelAdmin(hotel.id, { email: adminEmail.trim() }),
    onSuccess: (result) => setIssued(result.password),
  });

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 1.75 }}>
      <Box sx={panelSx}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 1.25 }}>
          {t('admin.hotel.tab.profile')}
        </Typography>
        <Kv label={t('admin.hotel.field.name')} value={hotel.name} />
        {/* Поддомен не редактируется: это ключ тенанта, и он напечатан на QR в
            номерах. Смена поддомена превратила бы напечатанные коды в мусор. */}
        <Kv
          label={t('admin.hotel.field.subdomain')}
          value={`${hotel.subdomain} · ${t('admin.hotel.field.subdomainLocked')}`}
        />
        <Kv label={t('admin.hotel.field.timezone')} value={hotel.timezone} />
        <Kv label={t('admin.hotel.field.currency')} value={hotel.currency} />
        <Kv
          label={t('admin.hotel.field.languages')}
          value={hotel.languages.map((lang) => lang.code.toUpperCase()).join(' · ')}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5 }}>
          <Switch
            checked={hotel.is_active}
            onChange={(e) => toggleActive.mutate(e.target.checked)}
            inputProps={{ 'data-testid': 'admin-hotel-active' } as Record<string, string>}
          />
          <Typography sx={{ fontSize: 12.5, color: ink.mid }}>
            {hotel.is_active ? t('admin.hotel.activeOn') : t('admin.hotel.activeOff')}
          </Typography>
        </Box>
      </Box>

      <Box sx={panelSx}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 1.25 }}>
          {t('admin.hotel.adminTitle')}
        </Typography>
        <Typography sx={{ fontSize: 12, color: ink.low, mb: 1.5 }}>
          {t('admin.hotel.adminHint')}
        </Typography>
        <TextField
          size="small"
          fullWidth
          label={t('admin.hotel.adminEmail')}
          value={adminEmail}
          onChange={(e) => setAdminEmail(e.target.value)}
          inputProps={{ 'data-testid': 'admin-hotel-admin-email' }}
        />
        <Button
          sx={{ ...primaryButtonSx, mt: 1.5 }}
          disabled={!adminEmail.includes('@') || resetAdmin.isPending}
          onClick={() => resetAdmin.mutate()}
          data-testid="admin-hotel-admin-reset"
        >
          {t('admin.hotel.adminReset')}
        </Button>
        {issued ? (
          <Alert severity="info" sx={{ mt: 1.5 }} data-testid="admin-hotel-admin-password">
            {t('admin.hotel.adminPassword')}: <b>{issued}</b>
          </Alert>
        ) : null}
      </Box>
    </Box>
  );
}

/* ── Использование и лимиты ─────────────────────────────────────────────── */

function UsageTab({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const usage = useQuery({ queryKey: ['admin', 'usage', id], queryFn: () => getUsage(id) });
  if (!usage.data) return <CircularProgress />;
  const data = usage.data;

  return (
    <Box sx={{ ...panelSx, maxWidth: 640 }} data-testid="admin-hotel-usage">
      <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
        {data.tariff_title[i18n.language] ?? data.tariff_title.en ?? data.tariff}
      </Typography>
      {data.is_trial && data.trial_days_left !== null ? (
        <Typography sx={{ fontSize: 12, color: state.warn, mt: 0.5 }} data-testid="admin-hotel-trial">
          {t('admin.hotel.trialLeft', { days: data.trial_days_left })}
        </Typography>
      ) : null}

      <Box sx={{ mt: 2 }}>
        {data.rows.map((row) => (
          <Box key={row.key} sx={{ py: 1.25, borderBottom: `1px solid ${surface.hair}` }}
            data-testid={`admin-usage-${row.key}`}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
              <Typography sx={{ fontSize: 12.5, color: ink.mid, flexGrow: 1 }}>
                {t(`admin.hotel.limit.${row.key}`)}
              </Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: row.over ? state.bad : ink.hi }}>
                {row.used}
                {row.limit === null ? ` / ${t('admin.hotel.limit.none')}` : ` / ${row.limit}`}
              </Typography>
            </Box>
            {row.limit !== null ? (
              <Box sx={{ mt: 0.75, height: 5, borderRadius: 999, bgcolor: surface.s3, overflow: 'hidden' }}>
                <Box
                  sx={{
                    width: `${Math.min(100, Math.round((row.ratio ?? 0) * 100))}%`,
                    height: '100%',
                    bgcolor: row.over ? state.bad : accent.main,
                  }}
                />
              </Box>
            ) : null}
            {row.over ? (
              <Typography sx={{ fontSize: 11.5, color: state.bad, mt: 0.6 }}
                data-testid={`admin-usage-over-${row.key}`}>
                {t('admin.hotel.limitOver', { used: row.used, limit: row.limit })}
              </Typography>
            ) : null}
          </Box>
        ))}
      </Box>
      <Typography sx={{ fontSize: 11.5, color: ink.low, mt: 1.75 }}>
        {t('admin.hotel.limitHint')}
      </Typography>
    </Box>
  );
}

/* ── Модули ─────────────────────────────────────────────────────────────── */

function ModulesTab({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const modules = useQuery({ queryKey: ['admin', 'modules', id], queryFn: () => getModules(id) });
  const save = useMutation({
    mutationFn: (next: ModuleEntry[]) => putModules(id, next),
    onSuccess: (result) => qc.setQueryData(['admin', 'modules', id], result),
  });

  if (!modules.data) return <CircularProgress />;
  const list = modules.data.modules;

  // Клиент шлёт ТОЛЬКО «включено/выключено». Признак «выдано вне тарифа»
  // проставляет сервер: он один знает тарифную сетку, и второй источник правды
  // здесь означал бы расхождение UI с моделью реестра.
  const toggle = (code: string, enabled: boolean) => {
    save.mutate(
      list.map((entry) => (entry.code === code ? { ...entry, is_enabled: enabled } : entry)),
    );
  };

  return (
    <Box sx={{ ...panelSx, maxWidth: 640 }} data-testid="admin-hotel-modules">
      <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 1.25 }}>
        {t('admin.hotel.modulesTitle', { tariff: modules.data.tariff })}
      </Typography>
      {list.map((entry) => (
        <Box
          key={entry.code}
          data-testid={`admin-module-${entry.code}`}
          sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderBottom: `1px solid ${surface.hair}` }}
        >
          <Typography sx={{ fontSize: 12.5, color: ink.mid, flexGrow: 1 }}>
            {entry.title[i18n.language] ?? entry.title.en ?? entry.code}
          </Typography>
          {entry.is_enabled && entry.source === 'override' ? (
            <Box
              data-testid={`admin-module-override-${entry.code}`}
              sx={{ fontSize: 10, fontWeight: 700, color: state.gold, px: 0.9, py: 0.3, borderRadius: 999, border: `1px solid ${state.gold}55` }}
            >
              {t('admin.hotel.moduleOverride')}
            </Box>
          ) : null}
          <Switch
            checked={entry.is_enabled}
            onChange={(e) => toggle(entry.code, e.target.checked)}
            disabled={save.isPending}
            inputProps={{ 'data-testid': `admin-module-toggle-${entry.code}` } as Record<string, string>}
          />
        </Box>
      ))}
      <Typography sx={{ fontSize: 11.5, color: ink.low, mt: 1.75 }}>
        {t('admin.hotel.modulesHint')}
      </Typography>
    </Box>
  );
}

/* ── Журнал ─────────────────────────────────────────────────────────────── */

function ActivityTab({ id }: { id: string }) {
  const { t } = useTranslation();
  const activity = useQuery({ queryKey: ['admin', 'activity', id], queryFn: () => getActivity(id) });
  if (!activity.data) return <CircularProgress />;

  return (
    <Box sx={{ ...panelSx, maxWidth: 760 }} data-testid="admin-hotel-activity">
      {activity.data.length === 0 ? (
        <Typography sx={{ fontSize: 12.5, color: ink.low }}>{t('admin.hotel.activityEmpty')}</Typography>
      ) : null}
      {activity.data.map((row) => (
        <Box
          key={row.id}
          data-testid={`admin-activity-${row.action}`}
          sx={{ display: 'flex', gap: 1.5, py: 1, borderBottom: `1px solid ${surface.hair}`, fontSize: 12.5 }}
        >
          <Typography sx={{ color: ink.low, fontSize: 12, minWidth: 132 }}>
            {new Date(row.at).toLocaleString()}
          </Typography>
          <Typography sx={{ color: ink.low, fontSize: 12, minWidth: 74 }}>
            {t(`admin.actor.${row.actor_type}`, { defaultValue: row.actor_type })}
          </Typography>
          <Typography sx={{ color: ink.mid, flexGrow: 1 }}>{row.action}</Typography>
          {/* Действие поддержки под чужой личиной обязано быть отличимо — это
              инвариант импersonation, а не украшение журнала. */}
          {row.impersonated_by ? (
            <Box sx={{ fontSize: 10, fontWeight: 700, color: state.warn }}>
              {t('admin.hotel.viaSupport')}
            </Box>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}

/* ── Тариф ──────────────────────────────────────────────────────────────── */

const TARIFF_CODES = ['standard', 'business', 'resort', 'trial'];

function TariffTab({ id }: { id: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const usage = useQuery({ queryKey: ['admin', 'usage', id], queryFn: () => getUsage(id) });
  const [next, setNext] = useState<string>('');
  const [warnings, setWarnings] = useState<DowngradeWarning[]>([]);

  const apply = useMutation({
    mutationFn: (acknowledge: boolean) =>
      setTariff(id, { tariff: next || usage.data!.tariff, acknowledge_downgrade: acknowledge }),
    onSuccess: (result) => {
      setWarnings(result.warnings ?? []);
      if (result.ok) {
        void qc.invalidateQueries({ queryKey: ['admin', 'usage', id] });
        void qc.invalidateQueries({ queryKey: ['admin', 'fleet'] });
        void qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      }
    },
  });

  if (!usage.data) return <CircularProgress />;

  return (
    <Box sx={{ ...panelSx, maxWidth: 560 }} data-testid="admin-hotel-tariff">
      <Typography sx={{ fontSize: 12, color: ink.low, mb: 1.5 }}>
        {t('admin.hotel.tariffHint')}
      </Typography>
      <TextField
        select
        size="small"
        fullWidth
        label={t('admin.hotel.tariffLabel')}
        value={next || usage.data.tariff}
        onChange={(e) => {
          setNext(e.target.value);
          setWarnings([]);
        }}
        SelectProps={{ inputProps: { 'data-testid': 'admin-tariff-select' } }}
      >
        {TARIFF_CODES.map((code) => (
          <MenuItem key={code} value={code} data-testid={`admin-tariff-option-${code}`}>
            {code}
          </MenuItem>
        ))}
      </TextField>

      {usage.data.trial_ends_at ? (
        <Typography sx={{ fontSize: 12, color: ink.mid, mt: 1.25 }}>
          {t('admin.hotel.trialEnds', { date: usage.data.trial_ends_at })}
        </Typography>
      ) : null}

      {warnings.length ? (
        <Alert severity="warning" sx={{ mt: 1.75 }} data-testid="admin-tariff-warning">
          <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>
            {t('admin.hotel.downgradeTitle')}
          </Typography>
          {warnings.map((warning) => (
            <Typography key={warning.key} sx={{ fontSize: 12 }}>
              {warning.modules
                ? t('admin.hotel.downgradeModules', { modules: warning.modules.join(', ') })
                : t('admin.hotel.downgradeLimit', {
                    what: t(`admin.hotel.limit.${warning.key}`),
                    used: warning.used,
                    limit: warning.limit,
                  })}
            </Typography>
          ))}
        </Alert>
      ) : null}

      <Box sx={{ display: 'flex', gap: 1, mt: 1.75 }}>
        <Button
          onClick={() => apply.mutate(false)}
          disabled={apply.isPending}
          data-testid="admin-tariff-apply"
          sx={primaryButtonSx}
        >
          {t('admin.hotel.tariffApply')}
        </Button>
        {warnings.length ? (
          <Button
            onClick={() => apply.mutate(true)}
            disabled={apply.isPending}
            data-testid="admin-tariff-force"
            sx={{ color: state.warn, border: `1px solid ${state.warn}55` }}
          >
            {t('admin.hotel.tariffForce')}
          </Button>
        ) : null}
      </Box>
      <Typography sx={{ fontSize: 11.5, color: ink.low, mt: 1.5 }}>
        {t('admin.hotel.tariffNoMoney')}
      </Typography>
    </Box>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 2,
        py: 0.9,
        fontSize: 12.5,
        color: ink.mid,
        borderBottom: `1px solid ${surface.hair}`,
      }}
    >
      <span>{label}</span>
      <Box component="b" sx={{ color: ink.hi, fontWeight: 600, textAlign: 'right' }}>
        {value}
      </Box>
    </Box>
  );
}


/* ── Данные отеля: экспорт и офбординг ──────────────────────────────────── */

/**
 * Экспорт и офбординг стоят рядом намеренно: это две стороны одного разговора
 * «отель уходит». Но действия у них разной природы, и разделены они не только
 * кнопками — экспорт обратим и делается сколько угодно раз, удаление требует
 * пометки, ввода поддомена и роли владельца.
 */
function DataTab({ hotel }: { hotel: HotelProfile }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const marked = hotel.offboarding;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'hotel', hotel.id] });
    void qc.invalidateQueries({ queryKey: ['admin', 'fleet'] });
  };

  const mark = useMutation({
    mutationFn: () => markOffboarding(hotel.id, reason.trim()),
    onSuccess: refresh,
    onError: (e) => setError(e instanceof Error ? e.message : t('admin.data.markFailed')),
  });
  const cancel = useMutation({
    mutationFn: () => cancelOffboarding(hotel.id),
    onSuccess: refresh,
  });
  const purge = useMutation({
    mutationFn: () => purgeHotel(hotel.id, confirm.trim()),
    onSuccess: (data) => {
      setResult(t('admin.data.purged', { count: Object.values(data.removed).reduce((a, b) => a + b, 0) }));
      setError(null);
      refresh();
    },
    onError: (e) => setError(e instanceof Error ? e.message : t('admin.data.purgeFailed')),
  });

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 1.75 }}
      data-testid="admin-hotel-data">
      <Box sx={panelSx}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 1 }}>
          {t('admin.data.exportTitle')}
        </Typography>
        <Typography sx={{ fontSize: 12, color: ink.low, mb: 1.75 }}>
          {t('admin.data.exportHint')}
        </Typography>
        <Button
          onClick={() => void downloadHotelExport(hotel.id, hotel.subdomain)}
          data-testid="admin-hotel-export"
          sx={primaryButtonSx}
        >
          {t('admin.data.export')}
        </Button>
      </Box>

      <Box sx={{ ...panelSx, borderColor: `${state.bad}55` }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 1, color: state.bad }}>
          {t('admin.data.offboardTitle')}
        </Typography>
        <Typography sx={{ fontSize: 12, color: ink.low, mb: 1.75 }}>
          {t('admin.data.offboardHint')}
        </Typography>

        {error ? <Alert severity="error" sx={{ mb: 1.5 }} data-testid="admin-data-error">{error}</Alert> : null}
        {result ? <Alert severity="success" sx={{ mb: 1.5 }} data-testid="admin-data-purged">{result}</Alert> : null}

        {marked ? (
          <>
            <Alert severity="warning" sx={{ mb: 1.5 }} data-testid="admin-data-marked">
              {t('admin.data.marked')}
            </Alert>
            {/* Второй шаг. Поддомен вводят руками: галочку ставят не глядя, а
                имя удаляемого набирают, только посмотрев на него. */}
            <TextField
              size="small"
              fullWidth
              label={t('admin.data.confirmLabel', { subdomain: hotel.subdomain })}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              inputProps={{ 'data-testid': 'admin-data-confirm' }}
            />
            <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
              <Button
                disabled={confirm.trim() !== hotel.subdomain || purge.isPending}
                onClick={() => purge.mutate()}
                data-testid="admin-data-purge"
                sx={{ color: state.bad, border: `1px solid ${state.bad}55` }}
              >
                {t('admin.data.purge')}
              </Button>
              <Button onClick={() => cancel.mutate()} data-testid="admin-data-cancel" sx={{ color: ink.mid }}>
                {t('admin.data.cancel')}
              </Button>
            </Box>
          </>
        ) : (
          <>
            <TextField
              size="small"
              fullWidth
              label={t('admin.data.reason')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              inputProps={{ 'data-testid': 'admin-data-reason' }}
            />
            <Button
              disabled={reason.trim().length < 3 || mark.isPending}
              onClick={() => mark.mutate()}
              data-testid="admin-data-mark"
              sx={{ mt: 1.5, color: state.warn, border: `1px solid ${state.warn}55` }}
            >
              {t('admin.data.mark')}
            </Button>
          </>
        )}
      </Box>
    </Box>
  );
}
