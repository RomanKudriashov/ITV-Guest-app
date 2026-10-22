import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { useRights } from '../useRights';

import { ink, panelSx, pillSx, primaryButtonSx, surface, typo } from '../adminTokens';
import { ChoiceField, Field, FormCell, FormGrid } from '../form';
import { QueryState } from '@/components/QueryState';
import { SelectField } from '@/components/SelectField';
import { getMe, getTeam, inviteMember, patchMember, resetMemberTwoFactor, type TeamMember } from '../adminClient';
import { FilterBar, Help, HelpLine, type Facet } from './hotels/hotelsUi';
import { SortHeader, useSort } from '../sort';

const ROLES = ['owner', 'support', 'read_only'] as const;

/**
 * Пользователи платформы.
 *
 * Раздел назывался «Команда». Слово путало: «команда» в системе значит ещё и
 * приказ оборудованию номера, и в журнале два разных смысла стояли рядом.
 * Идентификаторы (`team`, `platform.team.invited`) остались прежними — коды
 * действий уже записаны в аудите, и переименование их обнулило бы историю.
 *
 * /admin — мастер-ключ ко всем отелям, поэтому здесь всегда видно две вещи про
 * каждого: какую роль он имеет и включён ли у него второй фактор. Отсутствие
 * 2FA у человека с доступом ко всем отелям — не деталь настроек, а состояние,
 * на которое смотрят.
 */
export function TeamPage() {
  const { t } = useTranslation();
  // Состав правит только владелец (`OWNER` на `/team`). Остальным
  // форма приглашения отвечала 403 — предлагать её незачем.
  const { isOwner } = useRights();
  const qc = useQueryClient();
  // Фильтры — в адресе, считает сервер (партия 62-D).
  const [params] = useSearchParams();
  const filters = Object.fromEntries(['role', 'active', 'twofa', 'search'].map((key) => [key, params.get(key) ?? '']));
  // Порядок — с сервера (партия 62-F): столбец и направление в адресе.
  const sort = useSort('', ['member', 'role', 'access', 'twofa']);
  const query = { ...filters, ...sort.query };
  const team = useQuery({ queryKey: ['admin', 'team', query], queryFn: () => getTeam(100, query) });
  const facets: Facet[] = [
    { key: 'role', label: t('admin.team.filter.role'), options: ['owner', 'support', 'read_only'].map((r) => ({ value: r, label: t(`admin.journal.role.${r}`) })) },
    { key: 'active', label: t('admin.team.filter.active'), options: [{ value: 'yes', label: t('admin.team.filter.activeYes') }, { value: 'no', label: t('admin.team.filter.activeNo') }] },
    { key: 'twofa', label: t('admin.team.filter.twofa'), options: [{ value: 'yes', label: t('admin.team.filter.twofaYes') }, { value: 'no', label: t('admin.team.filter.twofaNo') }] },
  ];
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('support');
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: () => inviteMember({ email: email.trim(), role }),
    onSuccess: (result) => {
      setIssued({ email: result.member.email, password: result.password });
      setEmail('');
      setError(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'team'] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : t('admin.team.inviteFailed')),
  });
  const change = useMutation({
    mutationFn: (body: { id: string; role?: string; is_active?: boolean }) =>
      patchMember(body.id, { role: body.role, is_active: body.is_active }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'team'] }),
    onError: (e) => setError(e instanceof Error ? e.message : t('admin.team.changeFailed')),
  });
  const me = useQuery({ queryKey: ['admin', 'me'], queryFn: getMe });
  const resetTwoFactor = useMutation({
    mutationFn: (id: string) => resetMemberTwoFactor(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'team'] }),
    onError: (e) => setError(e instanceof Error ? e.message : t('admin.team.changeFailed')),
  });

  return (
    <Box data-testid="admin-team">
      <Typography sx={{ ...typo.pageTitle, color: ink.hi }}>
        {t('admin.team.title')}
      </Typography>
      <Typography sx={{ ...typo.caption, color: ink.mid, mt: 0.5 }}>{t('admin.team.subtitle')}</Typography>

      {isOwner ? (
      <Box sx={{ ...panelSx, mt: 2.25 }}>
        <FormGrid>
          <Field
            span={6}
            label={t('admin.team.email')}
            helperText={<HelpLine text={t('admin.team.emailHint')} help={t('admin.team.emailHelp')} />}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            inputProps={{ 'data-testid': 'admin-team-email' }}
          />
          <ChoiceField
            span={4}
            label={t('admin.team.role')}
            helperText={<HelpLine text={t('admin.team.roleHint')} help={t('admin.team.roleHelp')} />}
            value={role}
            onChange={setRole}
            testId="admin-team-role"
            options={ROLES.map((code) => ({ value: code, label: t(`admin.role.${code}`) }))}
          />
          {/*
            Кнопка стоит в своей ячейке и по нижнему краю ряда полей — иначе
            при появлении подписи под полем она уезжает вверх относительно них.
          */}
          <FormCell span={2}>
            <Button
              fullWidth
              disabled={!email.includes('@') || invite.isPending}
              onClick={() => invite.mutate()}
              data-testid="admin-team-invite"
              sx={{ ...primaryButtonSx, height: 56 }}
            >
              {t('admin.team.invite')}
            </Button>
          </FormCell>
        </FormGrid>
      </Box>
      ) : null}

      {error ? (
        <Alert severity="error" sx={{ mt: 1.5 }} data-testid="admin-team-error">
          {error}
        </Alert>
      ) : null}
      {issued ? (
        <Alert severity="info" sx={{ mt: 1.5 }} data-testid="admin-team-password">
          {t('admin.team.issued', { email: issued.email })}: <b>{issued.password}</b>
        </Alert>
      ) : null}

      <Box sx={{ mt: 2 }}>
        <FilterBar facets={facets} placeholder={t('admin.team.filter.search')} />
      </Box>
      <QueryState
        query={team}
        what={t('state.what.team')}
        isEmpty={(page) => page.items.length === 0}
        // Под фильтрами пустота — «ничего не нашлось», а не «вы один» (партия 62-F).
        emptyText={Object.values(filters).some(Boolean) ? t('admin.listFilteredEmpty') : t('admin.team.empty')}
      >
        {(page) => (
          <>
            {page.truncated ? (
              <Typography
                sx={{ ...typo.caption, color: ink.mid, mt: 1 }}
                data-testid="admin-team-truncated"
              >
                {t('state.truncated', { shown: page.items.length, total: page.total })}
              </Typography>
            ) : null}
      <Box sx={{ mt: 2, overflowX: 'auto' }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', ...typo.body }}>
          <Box component="thead">
            <Box component="tr">
              {(['member', 'role', 'access', 'twofa'] as const).map((key) => (
                <SortHeader key={key} column={{ key, label: t(`admin.team.col.${key}`) }} state={sort} testId={`admin-team-sort-${key}`}>
                  {key === 'role' ? <Help>{t('admin.team.roleHelp')}</Help> : null}
                </SortHeader>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {page.items.map((member) => (
              <MemberLine
                key={member.id}
                member={member}
                onRole={(next) => change.mutate({ id: member.id, role: next })}
                onActive={(next) => change.mutate({ id: member.id, is_active: next })}
                // Сброс 2FA — владельцу и не себе: себе — только командой на
                // сервере, иначе фактор снимал бы любой с открытой сессией.
                onResetTwoFactor={
                  isOwner && member.totp_enabled && member.id !== me.data?.id
                    ? () => resetTwoFactor.mutate(member.id)
                    : undefined
                }
              />
            ))}
          </Box>
        </Box>
      </Box>
          </>
        )}
      </QueryState>
    </Box>
  );
}

function MemberLine({
  member,
  onRole,
  onActive,
  onResetTwoFactor,
}: {
  member: TeamMember;
  onRole: (role: string) => void;
  onActive: (active: boolean) => void;
  onResetTwoFactor?: () => void;
}) {
  const { t } = useTranslation();
  const cell = { p: '13px 12px', borderBottom: `1px solid ${surface.hair}`, color: ink.mid } as const;
  // Роль меняет доступ ко всем отелям платформы — с вопросом (партия 60).
  const [askRole, setAskRole] = useState<string | null>(null);
  const [askReset, setAskReset] = useState(false);

  return (
    <Box component="tr" data-testid={`admin-team-row-${member.email}`}>
      <Box component="td" sx={cell}>
        <Typography sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}>{member.email}</Typography>
        {member.full_name ? (
          <Typography sx={{ ...typo.caption, color: ink.mid }}>{member.full_name}</Typography>
        ) : null}
      </Box>
      <Box component="td" sx={cell}>
        <SelectField
          size="small"
          fullWidth={false}
          value={member.role}
          onChange={(next) => {
            if (next === member.role) return;
            // Поле раскрывается по фокусу — вопрос задаём после закрытия списка.
            (document.activeElement as HTMLElement | null)?.blur();
            window.setTimeout(() => setAskRole(next), 0);
          }}
          testId={`admin-team-role-${member.email}`}
          // Самая длинная роль («Владелец платформы») — 157 px текста плюс
          // стрелка и отступы. В 150 она обрезалась; ширина жёсткая, чтобы
          // таблица на узком экране прокручивалась, а не сжимала поле (партия 55).
          sx={{ width: 230, minWidth: 230 }}
          options={ROLES.map((code) => ({ value: code, label: t(`admin.role.${code}`) }))}
        />
        <ConfirmDialog
          open={askRole !== null}
          testId={`admin-team-role-confirm-${member.email}`}
          restoreFocus={false}
          title={t('admin.team.roleConfirm.title', { email: member.email })}
          description={t('admin.team.roleConfirm.body', {
            from: t(`admin.role.${member.role}`),
            to: askRole ? t(`admin.role.${askRole}`) : '',
          })}
          confirmLabel={t('admin.team.roleConfirm.confirm')}
          onConfirm={() => {
            if (askRole) onRole(askRole);
            setAskRole(null);
          }}
          onClose={() => setAskRole(null)}
        />
      </Box>
      <Box component="td" sx={cell}>
        <Button
          size="small"
          onClick={() => onActive(!member.is_active)}
          data-testid={`admin-team-active-${member.email}`}
          sx={{ ...typo.caption, color: ink.mid }}
        >
          {member.is_active ? t('admin.team.disable') : t('admin.team.enable')}
        </Button>
      </Box>
      <Box component="td" sx={cell}>
        <Box
          data-testid={`admin-team-2fa-${member.email}`}
          sx={{
            ...pillSx(member.totp_enabled ? 'ok' : 'warn'),
          }}
        >
          {member.totp_enabled ? t('admin.security.on') : t('admin.security.off')}
        </Box>
        {onResetTwoFactor ? (
          <Button
            size="small"
            onClick={() => setAskReset(true)}
            data-testid={`admin-team-2fa-reset-${member.email}`}
            sx={{ ...typo.caption, color: ink.mid, mt: 0.5 }}
          >
            {t('admin.team.twoFactorReset.button')}
          </Button>
        ) : null}
        <ConfirmDialog
          open={askReset}
          testId={`admin-team-2fa-reset-confirm-${member.email}`}
          destructive
          title={t('admin.team.twoFactorReset.title', { email: member.email })}
          description={t('admin.team.twoFactorReset.body')}
          confirmLabel={t('admin.team.twoFactorReset.button')}
          onConfirm={() => {
            setAskReset(false);
            onResetTwoFactor?.();
          }}
          onClose={() => setAskReset(false)}
        />
      </Box>
    </Box>
  );
}
