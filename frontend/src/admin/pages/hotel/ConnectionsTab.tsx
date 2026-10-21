import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { QueryState } from '@/components/QueryState';
import { useActionFailed } from '@/hooks/useActionFailed';
import { useRights } from '../../useRights';
import { ink, primaryButtonSx, quietButtonSx, secondaryButtonSx, shape, surface, typo } from '../../adminTokens';
import { ChoiceField, Field, FormCell, FormGrid } from '../../form';
import { createNode, getHotelNodes, reissueHotelNode, revokeHotelNode, type NodeRow } from '../../adminClient';
import { Empty, FilterBar, Help, Panel, Pill, type Facet } from '../hotels/hotelsUi';

/**
 * ПОДКЛЮЧЕНИЯ ОТЕЛЯ (партия 62-B): сюда переехал раздел «On-premise» — но
 * только узлы ЭТОГО отеля. Выдать, перевыпустить, отозвать ключ — адресом
 * отеля: узел другого отеля по этим ручкам сервер не находит (404).
 *
 * Поставщик системы управления номером пока один — iRidi, текстом.
 */
export function ConnectionsTab({ hotelId }: { hotelId: string }) {
  const { t } = useTranslation();
  const { canWrite } = useRights();
  const qc = useQueryClient();
  const actionFailed = useActionFailed();
  // Состояние, назначение и текст — в адресе, считает сервер (партия 62-D).
  const [params] = useSearchParams();
  const filters = Object.fromEntries(['status', 'purpose', 'search'].map((key) => [key, params.get(key) ?? '']));
  const nodes = useQuery({ queryKey: ['admin', 'hotel-nodes', hotelId, filters], queryFn: () => getHotelNodes(hotelId, filters) });
  const counts = nodes.data?.facets;
  const nodeFacets: Facet[] = [
    { key: 'status', label: t('admin.card.connections.filter.status'), options: ['online', 'offline', 'revoked'].map((v) => ({ value: v, label: t(`admin.nodes.${v}`), count: counts?.status[v] ?? 0 })) },
    { key: 'purpose', label: t('admin.nodes.col.purpose'), options: ['grms', 'pms', 'both'].filter((v) => counts?.purpose[v] || params.get('purpose')?.includes(v)).map((v) => ({ value: v, label: t(`admin.nodes.purpose.${v}`), count: counts?.purpose[v] ?? 0 })) },
  ];
  const [issued, setIssued] = useState<{ name: string; key: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', purpose: 'grms' });

  const changed = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'hotel-nodes', hotelId] });
    void qc.invalidateQueries({ queryKey: ['admin', 'readiness', hotelId] });
    void qc.invalidateQueries({ queryKey: ['admin', 'fleet'] });
  };
  const create = useMutation({
    mutationFn: () => createNode(hotelId, { name: form.name.trim(), purpose: form.purpose }),
    onSuccess: (result) => {
      // Ключ виден ОДИН раз: на сервере лежит только его хэш.
      setIssued({ name: result.node.name, key: result.key });
      setCreating(false);
      setForm({ name: '', purpose: 'grms' });
      changed();
    },
    onError: actionFailed,
  });
  const revoke = useMutation({ mutationFn: (id: string) => revokeHotelNode(hotelId, id), onSuccess: changed, onError: actionFailed });
  const reissue = useMutation({
    mutationFn: (id: string) => reissueHotelNode(hotelId, id),
    onSuccess: (result) => {
      setIssued({ name: result.node.name, key: result.key });
      changed();
    },
    onError: actionFailed,
  });
  const busy = revoke.isPending || reissue.isPending;

  return (
    <Box sx={{ display: 'grid', gap: 2 }} data-testid="admin-connections">
      <Panel
        title={t('admin.card.connections.nodesTitle')}
        aside={
          canWrite && !creating ? (
            <Button sx={secondaryButtonSx} onClick={() => setCreating(true)} data-testid="admin-node-create">
              {t('admin.card.connections.add')}
            </Button>
          ) : null
        }
      >
        <Typography sx={{ ...typo.caption, color: ink.mid, mb: 1.5, display: 'flex', alignItems: 'center' }}>
          {t('admin.card.connections.about')}
          <Help>{t('admin.card.connections.aboutHelp')}</Help>
        </Typography>

        {creating ? (
          <Box sx={{ mb: 2, p: 1.5, borderRadius: `${shape.radius}px`, bgcolor: surface.s2 }}>
            <FormGrid>
              <Field
                span={6}
                label={t('admin.nodes.nodeName')}
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                inputProps={{ 'data-testid': 'admin-node-name' }}
              />
              <ChoiceField
                span={6}
                label={t('admin.nodes.col.purpose')}
                value={form.purpose}
                onChange={(next) => setForm((prev) => ({ ...prev, purpose: next }))}
                testId="admin-node-purpose"
                options={['grms', 'pms'].map((code) => ({ value: code, label: t(`admin.nodes.purpose.${code}`) }))}
              />
              <FormCell>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    sx={primaryButtonSx}
                    disabled={!form.name.trim() || create.isPending}
                    onClick={() => create.mutate()}
                    data-testid="admin-node-create-submit"
                  >
                    {t('admin.card.connections.issue')}
                  </Button>
                  <Button onClick={() => setCreating(false)} sx={quietButtonSx}>
                    {t('admin.hotel.cancel')}
                  </Button>
                </Box>
              </FormCell>
            </FormGrid>
          </Box>
        ) : null}

        {issued ? <IssuedKey name={issued.name} value={issued.key} onClose={() => setIssued(null)} /> : null}

        {nodes.data && nodes.data.total > 0 ? <FilterBar facets={nodeFacets} placeholder={t('admin.card.connections.filter.search')} /> : null}
        <QueryState query={nodes} what={t('state.what.nodes')}>
          {(page) =>
            page.items.length ? (
              <Box sx={{ display: 'grid', gap: 1 }}>
                {page.items.map((node) => (
                  <NodeCard
                    key={node.id}
                    node={node}
                    canWrite={canWrite}
                    busy={busy}
                    onRevoke={() => revoke.mutate(node.id)}
                    onReissue={() => reissue.mutate(node.id)}
                  />
                ))}
              </Box>
            ) : page.total ? (
              <Empty title={t('admin.card.rooms.noMatch')}>{t('admin.card.rooms.noMatchBody')}</Empty>
            ) : (
              <Empty title={t('admin.card.connections.emptyTitle')}>{t('admin.card.connections.emptyBody')}</Empty>
            )
          }
        </QueryState>
      </Panel>

      <Panel title={t('admin.card.connections.systemsTitle')}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '220px 1fr' }, gap: 1, ...typo.body }}>
          <Box sx={{ color: ink.mid }}>{t('admin.card.connections.roomSystem')}</Box>
          <Box sx={{ color: ink.hi, fontWeight: 600 }} data-testid="admin-connections-vendor">iRidi</Box>
          <Box sx={{ color: ink.mid }}>{t('admin.card.connections.otherSystems')}</Box>
          <Box sx={{ color: ink.low }}>{t('admin.card.connections.otherSoon')}</Box>
        </Box>
      </Panel>
    </Box>
  );
}

function IssuedKey({ name, value, onClose }: { name: string; value: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Alert severity="warning" sx={{ mb: 2 }} data-testid="admin-node-key" onClose={onClose}>
      <Box sx={{ ...typo.caption, mb: 0.5 }}>{t('admin.card.connections.keyOnce', { name })}</Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
        <Box component="code" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', fontWeight: 700 }} data-testid="admin-node-key-value">
          {value}
        </Box>
        <Tooltip title={copied ? t('admin.card.connections.copied') : t('admin.card.connections.copy')}>
          <IconButton
            size="small"
            aria-label={t('admin.card.connections.copy')}
            onClick={() => {
              void navigator.clipboard?.writeText(value).then(() => setCopied(true));
            }}
            data-testid="admin-node-key-copy"
          >
            <ContentCopyOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Alert>
  );
}

function NodeCard({
  node,
  canWrite,
  busy,
  onRevoke,
  onReissue,
}: {
  node: NodeRow;
  canWrite: boolean;
  busy: boolean;
  onRevoke: () => void;
  onReissue: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [ask, setAsk] = useState<'revoke' | 'reissue' | null>(null);
  const status = node.is_revoked ? 'revoked' : node.is_online ? 'online' : 'offline';
  const tone = node.is_revoked ? 'muted' : node.is_online ? 'ok' : 'bad';
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  return (
    <Box
      data-testid={`admin-node-${node.name}`}
      sx={{ p: 1.5, borderRadius: `${shape.radius}px`, border: `1px solid ${surface.hair}`, bgcolor: surface.s1, display: 'grid', gap: 1 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}>{node.name}</Box>
        <Pill tone={tone} testId={`admin-node-status-${node.name}`}>{t(`admin.nodes.${status}`)}</Pill>
        <Box sx={{ ...typo.caption, color: ink.mid }}>{t(`admin.nodes.purpose.${node.purpose}`)}</Box>
        {canWrite ? (
          <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
            <Button size="small" onClick={() => setAsk('reissue')} disabled={busy} data-testid={`admin-node-reissue-${node.name}`} sx={{ ...typo.caption }}>
              {node.is_revoked ? t('admin.card.connections.issueAgain') : t('admin.nodes.reissue')}
            </Button>
            {!node.is_revoked ? (
              <Button size="small" onClick={() => setAsk('revoke')} disabled={busy} data-testid={`admin-node-revoke-${node.name}`} sx={{ ...typo.caption, color: ink.mid }}>
                {t('admin.nodes.revoke')}
              </Button>
            ) : null}
          </Box>
        ) : null}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 1, ...typo.caption }}>
        <Fact label={t('admin.card.connections.lastSeen')}>
          {node.last_seen_at ? t('admin.nodes.secondsAgo', { seconds: node.seconds_since_seen ?? 0 }) : t('admin.nodes.never')}
        </Fact>
        <Fact label={t('admin.card.connections.version')}>{node.version || '—'}</Fact>
        <Fact label={t('admin.card.connections.keyIssued')}>{node.is_revoked ? t('admin.nodes.revoked') : fmt(node.key_issued_at)}</Fact>
      </Box>
      <ConfirmDialog
        open={ask !== null}
        testId={`admin-node-confirm-${node.name}`}
        destructive
        title={t(ask === 'revoke' ? 'admin.nodes.revokeConfirm.title' : 'admin.nodes.reissueConfirm.title', { name: node.name, hotel: node.hotel })}
        description={
          ask === 'revoke'
            ? t('admin.nodes.revokeConfirm.body', { name: node.name, hotel: node.hotel })
            : t('admin.nodes.reissueWarning', { name: node.name })
        }
        confirmLabel={t(ask === 'revoke' ? 'admin.nodes.revoke' : 'admin.nodes.reissue')}
        onConfirm={() => {
          if (ask === 'revoke') onRevoke();
          else onReissue();
          setAsk(null);
        }}
        onClose={() => setAsk(null)}
      />
    </Box>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ color: ink.low }}>{label}</Box>
      <Box sx={{ color: ink.hi, overflowWrap: 'anywhere' }}>{children}</Box>
    </Box>
  );
}
