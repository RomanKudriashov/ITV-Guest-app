import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { ink, panelSx, pillSx, primaryButtonSx, surface } from '../adminTokens';
import { getTeam, inviteMember, patchMember, type TeamMember } from '../adminClient';

const ROLES = ['owner', 'support', 'read_only'] as const;

/**
 * Команда платформы.
 *
 * /admin — мастер-ключ ко всем отелям, поэтому здесь всегда видно две вещи про
 * каждого: какую роль он имеет и включён ли у него второй фактор. Отсутствие
 * 2FA у человека с доступом ко всем отелям — не деталь настроек, а состояние,
 * на которое смотрят.
 */
export function TeamPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const team = useQuery({ queryKey: ['admin', 'team'], queryFn: getTeam });
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

  if (!team.data) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box data-testid="admin-team">
      <Typography sx={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em' }}>
        {t('admin.team.title')}
      </Typography>
      <Typography sx={{ color: ink.low, fontSize: 13, mt: 0.5 }}>{t('admin.team.subtitle')}</Typography>

      <Box sx={{ ...panelSx, mt: 2.25, display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          label={t('admin.team.email')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          inputProps={{ 'data-testid': 'admin-team-email' }}
          sx={{ minWidth: 260 }}
        />
        <TextField
          select
          size="small"
          label={t('admin.team.role')}
          value={role}
          onChange={(e) => setRole(e.target.value)}
          SelectProps={{ inputProps: { 'data-testid': 'admin-team-role' } }}
          sx={{ minWidth: 180 }}
        >
          {ROLES.map((code) => (
            <MenuItem key={code} value={code}>
              {t(`admin.role.${code}`)}
            </MenuItem>
          ))}
        </TextField>
        <Button
          disabled={!email.includes('@') || invite.isPending}
          onClick={() => invite.mutate()}
          data-testid="admin-team-invite"
          sx={primaryButtonSx}
        >
          {t('admin.team.invite')}
        </Button>
      </Box>

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

      <Box sx={{ mt: 2, overflowX: 'auto' }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <Box component="thead">
            <Box component="tr">
              {['member', 'role', 'access', 'twofa'].map((key) => (
                <Box
                  component="th"
                  key={key}
                  sx={{
                    textAlign: 'left',
                    fontSize: 10.5,
                    letterSpacing: '.1em',
                    textTransform: 'uppercase',
                    color: ink.low,
                    fontWeight: 700,
                    p: '11px 12px',
                    borderBottom: `1px solid ${surface.line}`,
                  }}
                >
                  {t(`admin.team.col.${key}`)}
                </Box>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {team.data.map((member) => (
              <MemberLine
                key={member.id}
                member={member}
                onRole={(next) => change.mutate({ id: member.id, role: next })}
                onActive={(next) => change.mutate({ id: member.id, is_active: next })}
              />
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function MemberLine({
  member,
  onRole,
  onActive,
}: {
  member: TeamMember;
  onRole: (role: string) => void;
  onActive: (active: boolean) => void;
}) {
  const { t } = useTranslation();
  const cell = { p: '13px 12px', borderBottom: `1px solid ${surface.hair}`, color: ink.mid } as const;

  return (
    <Box component="tr" data-testid={`admin-team-row-${member.email}`}>
      <Box component="td" sx={cell}>
        <Typography sx={{ color: ink.hi, fontWeight: 700, fontSize: 13 }}>{member.email}</Typography>
        {member.full_name ? (
          <Typography sx={{ fontSize: 11, color: ink.low }}>{member.full_name}</Typography>
        ) : null}
      </Box>
      <Box component="td" sx={cell}>
        <TextField
          select
          size="small"
          value={member.role}
          onChange={(e) => onRole(e.target.value)}
          variant="standard"
          SelectProps={{ inputProps: { 'data-testid': `admin-team-role-${member.email}` } }}
          sx={{ minWidth: 150 }}
        >
          {ROLES.map((code) => (
            <MenuItem key={code} value={code}>
              {t(`admin.role.${code}`)}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      <Box component="td" sx={cell}>
        <Button
          size="small"
          onClick={() => onActive(!member.is_active)}
          data-testid={`admin-team-active-${member.email}`}
          sx={{ fontSize: 12, color: ink.mid }}
        >
          {member.is_active ? t('admin.team.disable') : t('admin.team.enable')}
        </Button>
      </Box>
      <Box component="td" sx={cell}>
        <Box
          data-testid={`admin-team-2fa-${member.email}`}
          sx={{
            display: 'inline-block',
            fontSize: 10.5,
            fontWeight: 700,
            px: 1.1,
            py: 0.4,
            borderRadius: 999,
            ...pillSx(member.totp_enabled ? 'ok' : 'warn'),
          }}
        >
          {member.totp_enabled ? t('admin.security.on') : t('admin.security.off')}
        </Box>
      </Box>
    </Box>
  );
}
