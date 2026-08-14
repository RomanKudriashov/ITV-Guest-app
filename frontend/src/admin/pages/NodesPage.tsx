import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { ink, pillSx, surface } from '../adminTokens';
import { QueryState } from '../QueryState';
import { getNodes, reissueNode, revokeNode, type NodeRow } from '../adminClient';

/**
 * Реестр он-прем узлов.
 *
 * Узел нужен, как только отелю включили GRMS или PMS: обе системы живут внутри
 * объекта, и облако до них не дотягивается. Поэтому здесь виден ровно один
 * важный факт — отмечается ли коробка, — и ровно одно действие: ключ.
 *
 * «Офлайн» означает «перестал отмечаться», а не «мы не дозвонились»: связь
 * идёт изнутри наружу, за NAT постучаться снаружи некуда.
 */
export function NodesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const nodes = useQuery({ queryKey: ['admin', 'nodes'], queryFn: getNodes });
  const [issuedKey, setIssuedKey] = useState<string | null>(null);

  const revoke = useMutation({
    mutationFn: (id: string) => revokeNode(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'nodes'] }),
  });
  const reissue = useMutation({
    mutationFn: (id: string) => reissueNode(id),
    onSuccess: (result) => {
      setIssuedKey(result.key);
      void qc.invalidateQueries({ queryKey: ['admin', 'nodes'] });
    },
  });

  return (
    <Box data-testid="admin-nodes">
      <Typography sx={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em' }}>
        {t('admin.nodes.title')}
      </Typography>
      <Typography sx={{ color: ink.low, fontSize: 13, mt: 0.5 }}>
        {t('admin.nodes.subtitle')}
      </Typography>

      {issuedKey ? (
        <Alert severity="info" sx={{ mt: 2 }} data-testid="admin-node-key">
          {t('admin.nodes.keyOnce')}: <b>{issuedKey}</b>
        </Alert>
      ) : null}

      <QueryState
        query={nodes}
        what={t('admin.state.what.nodes')}
        isEmpty={(rows) => rows.length === 0}
        emptyText={t('admin.nodes.empty')}
      >
        {(rows) => (
        <Box sx={{ mt: 2, overflowX: 'auto' }}>
          <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <Box component="thead">
              <Box component="tr">
                {['hotel', 'purpose', 'status', 'seen', 'key'].map((key) => (
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
                    {t(`admin.nodes.col.${key}`)}
                  </Box>
                ))}
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map((node) => (
                <NodeLine
                  key={node.id}
                  node={node}
                  onRevoke={() => revoke.mutate(node.id)}
                  onReissue={() => reissue.mutate(node.id)}
                  busy={revoke.isPending || reissue.isPending}
                />
              ))}
            </Box>
          </Box>
        </Box>
        )}
      </QueryState>
    </Box>
  );
}

function NodeLine({
  node,
  onRevoke,
  onReissue,
  busy,
}: {
  node: NodeRow;
  onRevoke: () => void;
  onReissue: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const cell = { p: '13px 12px', borderBottom: `1px solid ${surface.hair}`, color: ink.mid } as const;

  return (
    <Box component="tr" data-testid={`admin-node-${node.name}`}>
      <Box component="td" sx={cell}>
        <Typography sx={{ color: ink.hi, fontWeight: 700, fontSize: 13 }}>{node.hotel}</Typography>
        <Typography sx={{ fontSize: 11, color: ink.low }}>{node.name}</Typography>
      </Box>
      <Box component="td" sx={cell}>{t(`admin.nodes.purpose.${node.purpose}`)}</Box>
      <Box component="td" sx={cell}>
        <Box
          data-testid={`admin-node-status-${node.name}`}
          sx={{
            display: 'inline-block',
            fontSize: 10.5,
            fontWeight: 700,
            px: 1.1,
            py: 0.4,
            borderRadius: 999,
            ...pillSx(node.is_revoked ? 'muted' : node.is_online ? 'ok' : 'warn'),
          }}
        >
          {node.is_revoked
            ? t('admin.nodes.revoked')
            : node.is_online
              ? t('admin.nodes.online')
              : t('admin.nodes.offline')}
        </Box>
      </Box>
      <Box component="td" sx={cell}>
        {node.last_seen_at
          ? t('admin.nodes.secondsAgo', { seconds: node.seconds_since_seen ?? 0 })
          : t('admin.nodes.never')}
      </Box>
      <Box component="td" sx={cell}>
        {node.is_revoked ? (
          <Button size="small" onClick={onReissue} disabled={busy}
            data-testid={`admin-node-reissue-${node.name}`} sx={{ fontSize: 12 }}>
            {t('admin.nodes.reissue')}
          </Button>
        ) : (
          <Button size="small" onClick={onRevoke} disabled={busy}
            data-testid={`admin-node-revoke-${node.name}`} sx={{ fontSize: 12, color: ink.mid }}>
            {t('admin.nodes.revoke')}
          </Button>
        )}
      </Box>
    </Box>
  );
}
