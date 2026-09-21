import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useTranslation } from 'react-i18next';

import type { EscalationRule, NotificationChannel } from '@/api/notificationTypes';

/**
 * ПРАВИЛА — ТАБЛИЦЕЙ, А НЕ ВЫПАДАЮЩИМ СПИСКОМ.
 *
 * В списке видно одно имя за раз, и ответить на вопрос «а что у нас вообще
 * настроено» можно было только перебрав его до конца, открывая каждое правило.
 * Отель с восемью заведениями так не проверяют — и не проверяли.
 *
 * Строка отвечает на три вопроса сразу: КОМУ уходит, ЧЕРЕЗ СКОЛЬКО и КУДА
 * (заведение или весь отель). Сводка ступеней складывается в одну строку:
 * «через 10 мин → старшему, через 30 → руководителю».
 */
export interface RulesTableProps {
  rules: EscalationRule[];
  channels: NotificationChannel[];
  selectedId: string;
  onSelect: (id: string) => void;
  pointTitle: (id: string | null | undefined) => string;
}

/**
 * Правило, которому НЕКУДА доставлять.
 *
 * Все цели ступени — от «точки» до «руководителя» — в итоге разрешаются в
 * КАНАЛЫ уведомлений (`delivery.py`). Нет активных каналов — правило сработает
 * в пустоту: отель уверен, что его предупредят, а сообщение не уйдёт никуда.
 * Это молчаливый отказ, и увидеть его без подсказки нельзя.
 */
export function ruleHasNowhereToGo(
  rule: EscalationRule,
  channels: NotificationChannel[],
): boolean {
  const active = channels.filter((channel) => channel.is_active);
  if (active.length === 0) return true;
  const steps = rule.steps ?? [];
  if (steps.length === 0) return false;
  // Ступень, адресованная КОНКРЕТНОМУ каналу, который выключен или исчез, —
  // тот же молчаливый отказ, только адресный.
  return steps.some(
    (step) =>
      step.target_kind === 'channel' &&
      !active.some((channel) => channel.id === step.channel_id),
  );
}

export function EscalationRulesTable({
  rules,
  channels,
  selectedId,
  onSelect,
  pointTitle,
}: RulesTableProps) {
  const { t } = useTranslation();

  const stepsSummary = (rule: EscalationRule): string => {
    const steps = rule.steps ?? [];
    if (steps.length === 0) return t('notifications.escalation.noSteps');
    return steps
      .slice()
      .sort((a, b) => a.delay_minutes - b.delay_minutes)
      .map((step) =>
        t('notifications.escalation.stepSummary', {
          minutes: step.delay_minutes,
          target: t(`notifications.escalation.targets.${step.target_kind}`),
        }),
      )
      .join(' · ');
  };

  const anyChannel = channels.some((channel) => channel.is_active);

  return (
    <Box data-testid="cms-escalation-rules">
      {!anyChannel && (
        <Alert severity="warning" sx={{ mb: 1.5 }} data-testid="cms-escalation-no-channels">
          {t('notifications.escalation.noChannelsWarning')}
        </Alert>
      )}
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('notifications.escalation.name')}</TableCell>
            <TableCell>{t('notifications.escalation.point')}</TableCell>
            <TableCell>{t('notifications.escalation.stepsTitle')}</TableCell>
            <TableCell>{t('notifications.escalation.active')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rules.map((rule) => {
            const mute = ruleHasNowhereToGo(rule, channels);
            return (
              <TableRow
                key={rule.id}
                hover
                selected={rule.id === selectedId}
                onClick={() => onSelect(rule.id)}
                sx={{ cursor: 'pointer' }}
                data-testid={`cms-escalation-row-${rule.id}`}
              >
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    {mute && (
                      <Tooltip title={t('notifications.escalation.muteHint')}>
                        <WarningAmberIcon
                          color="warning"
                          fontSize="small"
                          data-testid={`cms-escalation-mute-${rule.id}`}
                        />
                      </Tooltip>
                    )}
                    <span>{rule.name || pointTitle(rule.execution_point_id)}</span>
                  </Box>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    {pointTitle(rule.execution_point_id)}
                  </Typography>
                </TableCell>
                <TableCell data-testid={`cms-escalation-steps-${rule.id}`}>
                  <Typography variant="body2" color="text.secondary">
                    {stepsSummary(rule)}
                  </Typography>
                </TableCell>
                <TableCell>
                  {rule.is_active ? (
                    <Chip size="small" color="success" label={t('common.on')} />
                  ) : (
                    <Chip size="small" label={t('common.off')} />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}
