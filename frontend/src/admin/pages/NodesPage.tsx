import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { ink, panelSx, pillSx, primaryButtonSx, quietButtonSx, surface, typo } from '../adminTokens';
import { Field, FormCell, FormGrid } from '../form';
import { QueryState } from '@/components/QueryState';
import {
  createNode,
  getFleet,
  getMe,
  getNodes,
  reissueNode,
  revokeNode,
  type NodeRow,
} from '../adminClient';

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
  const nodes = useQuery({ queryKey: ['admin', 'nodes'], queryFn: () => getNodes() });
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Заведение узла и перевыпуск ключа — право `write`. Роль «только чтение»
  // получает от сервера 403; экран не должен предлагать ей нажать.
  const me = useQuery({ queryKey: ['admin', 'me'], queryFn: getMe });
  const canWrite = me.data?.role !== 'read_only';

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ hotelId: '', name: '', purpose: 'grms' });
  const fleet = useQuery({
    queryKey: ['admin', 'fleet', 'for-nodes'],
    queryFn: () => getFleet({ origin: 'all', page_size: 200 }),
    enabled: creating,
  });

  const create = useMutation({
    mutationFn: () => createNode(form.hotelId, { name: form.name.trim(), purpose: form.purpose }),
    onSuccess: (result) => {
      // Ключ виден ОДИН раз: на сервере лежит только его хэш, показать
      // повторно нечего — можно лишь перевыпустить.
      setIssuedKey(result.key);
      setError(null);
      setCreating(false);
      setForm({ hotelId: '', name: '', purpose: 'grms' });
      void qc.invalidateQueries({ queryKey: ['admin', 'nodes'] });
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : t('admin.nodes.createFailed')),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeNode(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'nodes'] }),
  });
  const reissue = useMutation({
    mutationFn: (id: string) => reissueNode(id),
    onSuccess: (result) => {
      setIssuedKey(result.key);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'nodes'] });
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : t('admin.nodes.reissueFailed')),
  });

  return (
    <Box data-testid="admin-nodes">
      <Typography sx={{ ...typo.pageTitle, color: ink.hi }}>
        {t('admin.nodes.title')}
      </Typography>
      <Typography sx={{ ...typo.caption, color: ink.mid, mt: 0.5 }}>
        {t('admin.nodes.subtitle')}
      </Typography>

      {canWrite ? (
        <Box sx={{ ...panelSx, mt: 2 }}>
          {creating ? (
            /*
              Заведение узла — та же сетка формы, что в диалогах. Раньше это
              был ряд `flex-wrap` из полей с `minWidth` 240/200/160: на широком
              экране они выстраивались в строку разной длины, на среднем
              перескакивали по одному и ряд читался лестницей.
            */
            <FormGrid>
              <Field
                span={4}
                select
                label={t('admin.nodes.hotel')}
                value={form.hotelId}
                onChange={(event) => setForm((prev) => ({ ...prev, hotelId: event.target.value }))}
                SelectProps={{ inputProps: { 'data-testid': 'admin-node-hotel' } }}
              >
                {(fleet.data?.items ?? []).map((row) => (
                  <MenuItem key={row.id} value={row.id}>
                    {row.subdomain}
                  </MenuItem>
                ))}
              </Field>
              <Field
                span={4}
                label={t('admin.nodes.nodeName')}
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                inputProps={{ 'data-testid': 'admin-node-name' }}
              />
              <Field
                span={4}
                select
                label={t('admin.nodes.col.purpose')}
                value={form.purpose}
                onChange={(event) => setForm((prev) => ({ ...prev, purpose: event.target.value }))}
                SelectProps={{ inputProps: { 'data-testid': 'admin-node-purpose' } }}
              >
                {['grms', 'pms'].map((code) => (
                  <MenuItem key={code} value={code}>
                    {t(`admin.nodes.purpose.${code}`, { defaultValue: code })}
                  </MenuItem>
                ))}
              </Field>
              <FormCell>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    sx={primaryButtonSx}
                    disabled={!form.hotelId || !form.name.trim() || create.isPending}
                    onClick={() => create.mutate()}
                    data-testid="admin-node-create-submit"
                  >
                    {t('admin.nodes.create')}
                  </Button>
                  <Button onClick={() => setCreating(false)} sx={quietButtonSx}>
                    {t('admin.hotel.cancel')}
                  </Button>
                </Box>
              </FormCell>
            </FormGrid>
          ) : (
            <Button
              sx={primaryButtonSx}
              onClick={() => setCreating(true)}
              data-testid="admin-node-create"
            >
              {t('admin.nodes.create')}
            </Button>
          )}
        </Box>
      ) : null}

      {error ? (
        <Alert severity="error" sx={{ mt: 2 }} data-testid="admin-node-error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {issuedKey ? (
        <Alert severity="warning" sx={{ mt: 2 }} data-testid="admin-node-key">
          {/* Ключ показывается ОДИН раз: на сервере лежит только хэш. Подпись
              об этом стоит рядом с самим ключом, а не в справке — прочитать её
              потом будет негде. */}
          {t('admin.nodes.keyOnce')}: <b>{issuedKey}</b>
        </Alert>
      ) : null}

      <QueryState
        query={nodes}
        what={t('state.what.nodes')}
        isEmpty={(page) => page.items.length === 0}
        emptyText={t('admin.nodes.empty')}
      >
        {(page) => (
          <>
            {page.truncated ? (
              <Typography
                sx={{ ...typo.caption, color: ink.mid, mt: 1 }}
                data-testid="admin-nodes-truncated"
              >
                {t('state.truncated', { shown: page.items.length, total: page.total })}
              </Typography>
            ) : null}
        <Box sx={{ mt: 2, overflowX: 'auto' }}>
          <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', ...typo.body }}>
            <Box component="thead">
              <Box component="tr">
                {['hotel', 'purpose', 'status', 'seen', 'key'].map((key) => (
                  <Box
                    component="th"
                    key={key}
                    sx={{
                      textAlign: 'left',
                    ...typo.label,
                    color: ink.mid,
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
              {page.items.map((node) => (
                <NodeLine
                  key={node.id}
                  node={node}
                  onRevoke={() => revoke.mutate(node.id)}
                  onReissue={() => reissue.mutate(node.id)}
                  busy={revoke.isPending || reissue.isPending}
                  canWrite={canWrite}
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

function NodeLine({
  node,
  onRevoke,
  onReissue,
  busy,
  canWrite,
}: {
  node: NodeRow;
  onRevoke: () => void;
  onReissue: () => void;
  busy: boolean;
  canWrite: boolean;
}) {
  const { t } = useTranslation();
  const cell = { p: '13px 12px', borderBottom: `1px solid ${surface.hair}`, color: ink.mid } as const;

  return (
    <Box component="tr" data-testid={`admin-node-${node.name}`}>
      <Box component="td" sx={cell}>
        <Typography sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}>{node.hotel}</Typography>
        <Typography sx={{ ...typo.caption, color: ink.mid }}>{node.name}</Typography>
      </Box>
      <Box component="td" sx={cell}>{t(`admin.nodes.purpose.${node.purpose}`)}</Box>
      <Box component="td" sx={cell}>
        <Box
          data-testid={`admin-node-status-${node.name}`}
          sx={{
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
        {/*
          ПЕРЕВЫПУСК ДОСТУПЕН И ЖИВОМУ УЗЛУ.

          Кнопка стояла только у отозванного, то есть чтобы сменить ключ,
          администратор был обязан сначала уронить связь с оборудованием.
          Смена ключа на живом — штатная операция (утёк, меняем регламентно), и
          цена её честно названа в подтверждении: старый ключ умрёт сразу,
          коннектор переподключится новым.
        */}
        {canWrite ? (
          node.is_revoked ? (
            <Button size="small" onClick={onReissue} disabled={busy}
              data-testid={`admin-node-reissue-${node.name}`} sx={{ ...typo.caption }}>
              {t('admin.nodes.reissue')}
            </Button>
          ) : (
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Button
                size="small"
                onClick={() => {
                  if (window.confirm(t('admin.nodes.reissueWarning', { name: node.name }))) {
                    onReissue();
                  }
                }}
                disabled={busy}
                data-testid={`admin-node-reissue-${node.name}`}
                sx={{ ...typo.caption }}
              >
                {t('admin.nodes.reissue')}
              </Button>
              <Button size="small" onClick={onRevoke} disabled={busy}
                data-testid={`admin-node-revoke-${node.name}`} sx={{ ...typo.caption, color: ink.mid }}>
                {t('admin.nodes.revoke')}
              </Button>
            </Box>
          )
        ) : null}
      </Box>
    </Box>
  );
}
