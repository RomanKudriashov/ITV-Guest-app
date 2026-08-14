import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { ink, panelSx, state, surface } from '../adminTokens';
import { QueryState } from '@/components/QueryState';
import { getTariffs } from '../adminClient';

/**
 * Модули и тарифы — механизм, а не справка.
 *
 * Экран отвечает на один вопрос: что открывает каждый тариф. Сама выдача
 * модулей конкретному отелю живёт в его карточке — там, где виден и его
 * фактический набор, и переопределения. Разносить управление по двум экранам
 * («здесь тариф, там тумблеры») было бы вернее для схемы данных и хуже для
 * человека: он решает не «что такое Business», а «что дать этому отелю».
 */
export function ModulesPage() {
  const { t, i18n } = useTranslation();
  const tariffs = useQuery({ queryKey: ['admin', 'tariffs'], queryFn: getTariffs });

  return (
    <Box data-testid="admin-modules">
      <Typography sx={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em' }}>
        {t('admin.modules.title')}
      </Typography>
      <Typography sx={{ color: ink.low, fontSize: 13, mt: 0.5 }}>
        {t('admin.modules.subtitle')}
      </Typography>

      <QueryState
        query={tariffs}
        what={t('state.what.tariffs')}
        isEmpty={(rows) => rows.length === 0}
        emptyText={t('admin.modules.empty')}
      >
        {(rows) => (
        <>
      <Box sx={{ mt: 2.5, overflowX: 'auto' }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <Box component="thead">
            <Box component="tr">
              {['tariff', 'hotels', 'modules', 'limits'].map((key) => (
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
                  {t(`admin.modules.col.${key}`)}
                </Box>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {rows.map((tariff) => (
              <Box component="tr" key={tariff.code} data-testid={`admin-tariff-row-${tariff.code}`}>
                <Cell>
                  <Typography sx={{ color: ink.hi, fontWeight: 700, fontSize: 13 }}>
                    {tariff.title[i18n.language] ?? tariff.title.en ?? tariff.code}
                  </Typography>
                  {tariff.is_trial ? (
                    <Typography sx={{ fontSize: 11, color: state.info }}>
                      {t('admin.modules.trialDays', { days: tariff.trial_days })}
                    </Typography>
                  ) : null}
                </Cell>
                <Cell>{tariff.hotels}</Cell>
                <Cell>
                  {tariff.modules.length
                    ? tariff.modules.map((code) => t(`admin.module.${code}`, { defaultValue: code })).join(' · ')
                    : t('admin.modules.base')}
                </Cell>
                <Cell>
                  {limitText(tariff.limits, t)}
                </Cell>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      <Box sx={{ ...panelSx, mt: 2, borderStyle: 'dashed' }}>
        <Typography sx={{ fontSize: 12.5, color: ink.mid, lineHeight: 1.6 }}>
          {t('admin.modules.note')}
        </Typography>
      </Box>
        </>
        )}
      </QueryState>
    </Box>
  );
}

function limitText(
  limits: { services: number | null; rooms: number | null; staff: number | null },
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const parts = (['services', 'rooms', 'staff'] as const)
    .filter((key) => limits[key] !== null)
    .map((key) => `${limits[key]} ${t(`admin.hotel.limit.${key}`).toLowerCase()}`);
  return parts.length ? parts.join(' · ') : t('admin.hotel.limit.none');
}

function Cell({ children }: { children: React.ReactNode }) {
  return (
    <Box component="td" sx={{ p: '13px 12px', borderBottom: `1px solid ${surface.hair}`, color: ink.mid }}>
      {children}
    </Box>
  );
}
