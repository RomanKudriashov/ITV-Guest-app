import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { accent, ink, surface } from '../adminTokens';
import { getAudit } from '../adminClient';

/**
 * Аудит платформы — один список, а не разрез по отелям.
 *
 * Вопрос, который задают этому экрану, звучит «кто что делал», и ответ на него
 * не должен требовать сначала выбрать отель. Действия без отеля (вход, 2FA,
 * команда) и действия над отелями лежат вперемешку по времени — именно так их
 * и разбирают.
 *
 * Вход в отель виден здесь наравне с остальным: он и есть то действие, ради
 * отделимости которого весь механизм impersonation затевался.
 */
export function AuditPage() {
  const { t } = useTranslation();
  const audit = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => getAudit(150) });

  if (!audit.data) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box data-testid="admin-audit">
      <Typography sx={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em' }}>
        {t('admin.audit.title')}
      </Typography>
      <Typography sx={{ color: ink.low, fontSize: 13, mt: 0.5 }}>
        {t('admin.audit.subtitle')}
      </Typography>

      <Box sx={{ mt: 2.25 }}>
        {audit.data.map((row) => (
          <Box
            key={row.id}
            data-testid={`admin-audit-${row.action}`}
            sx={{
              display: 'flex',
              gap: 1.5,
              alignItems: 'baseline',
              py: 1.1,
              borderBottom: `1px solid ${surface.hair}`,
              fontSize: 12.5,
            }}
          >
            <Typography sx={{ color: ink.low, fontSize: 12, minWidth: 140, flex: 'none' }}>
              {new Date(row.at).toLocaleString()}
            </Typography>
            <Typography sx={{ color: accent.soft, fontSize: 12, minWidth: 180, flex: 'none' }}>
              {row.actor}
            </Typography>
            <Typography sx={{ color: ink.mid, flexGrow: 1 }}>
              {t(`admin.action.${row.action}`, { defaultValue: row.action })}
            </Typography>
            {row.hotel ? (
              <Typography sx={{ color: ink.hi, fontSize: 12, fontWeight: 600 }}>{row.hotel}</Typography>
            ) : null}
          </Box>
        ))}
        {audit.data.length === 0 ? (
          <Typography sx={{ color: ink.low, fontSize: 13, py: 4 }} data-testid="admin-audit-empty">
            {t('admin.audit.empty')}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}
