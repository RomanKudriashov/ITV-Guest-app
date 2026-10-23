import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';
import { useTranslation } from 'react-i18next';

import { accent, fieldSx, ink, panelSx, primaryButtonSx, secondaryButtonSx, shadow, shape, state, surface, typo } from '../../adminTokens';
import {
  PlatformError,
  previewBatch,
  runBatch,
  type BatchAction,
  type BatchPreview,
  type BatchResult,
  type BatchRow,
  type BatchValue,
  type RoomsDictionaries,
} from '../../adminClient';
import { AdminDialog } from '../../form';
import { SelectField } from '@/components/SelectField';
import { DateField } from '@/components/DateField';
import { Help, Pill } from '../hotels/hotelsUi';

/**
 * ДЕЙСТВИЯ НАД МНОГИМИ НОМЕРАМИ (партия 63-2): панель выбора снизу, окно
 * «выбрать → показать, что изменится → выполнить», лист PIN один раз, выбор
 * рамкой по схеме. Выбор в адресе не хранится — он живёт, пока открыт экран.
 */

export type Group = 'variant' | 'pin' | 'category' | 'building' | 'state' | 'delete';
const GROUPS: Group[] = ['variant', 'pin', 'category', 'building', 'state', 'delete'];

const errorText = (error: unknown) => (error instanceof PlatformError ? error.message : error instanceof Error ? error.message : String(error));

/* ── Панель выбора ──────────────────────────────────────────────────────── */

export function SelectionPanel({
  count,
  canWrite,
  onAction,
  onClear,
}: {
  count: number;
  canWrite: boolean;
  onAction: (group: Group) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  if (!count) return null;
  return (
    <Box
      data-testid="admin-rooms-selection"
      sx={{
        position: 'sticky',
        bottom: 12,
        zIndex: 20,
        ...panelSx,
        p: 1,
        display: 'flex',
        gap: 0.75,
        alignItems: 'center',
        flexWrap: 'wrap',
        border: `1px solid ${accent.main}`,
        boxShadow: shadow.menu,
      }}
    >
      <Box sx={{ ...typo.body, fontWeight: 800, color: ink.hi, px: 1 }} data-testid="admin-rooms-selection-count">
        {t('admin.card.rooms.sel.count', { count })}
      </Box>
      {canWrite ? (
        GROUPS.map((group) => (
          <Button
            key={group}
            size="small"
            sx={{ ...secondaryButtonSx, ...(group === 'delete' ? { color: state.bad } : {}) }}
            onClick={() => onAction(group)}
            data-testid={`admin-rooms-batch-${group}`}
          >
            {t(`admin.card.rooms.batch.group.${group}`)}
          </Button>
        ))
      ) : (
        <Box sx={{ ...typo.caption, color: ink.mid }}>{t('admin.card.rooms.sel.readOnly')}</Box>
      )}
      <Box sx={{ flex: 1 }} />
      <Button size="small" sx={{ color: ink.mid }} onClick={onClear} data-testid="admin-rooms-selection-clear">
        {t('admin.card.rooms.sel.clear')}
      </Button>
    </Box>
  );
}

/* ── Рамка мышью по схеме ───────────────────────────────────────────────── */

/**
 * Рамка: нажать на пустом месте схемы и вести — номера, которых рамка
 * коснулась, выбираются (с Shift — добавляются к выбору). Касание на телефоне
 * рамку не рисует: там выбор — долгим нажатием.
 */
export function useMarquee(onPick: (ids: string[], add: boolean) => void) {
  const [box, setBox] = useState<null | { x1: number; y1: number; x2: number; y2: number }>(null);
  const start = useRef<null | { x: number; y: number; add: boolean }>(null);
  const moved = useRef(false);
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-room-id], button, a, input, [role="button"], [role="checkbox"]')) return;
    start.current = { x: event.clientX, y: event.clientY, add: event.shiftKey || event.metaKey || event.ctrlKey };
    moved.current = false;
  };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const s = start.current;
      if (!s) return;
      if (!moved.current && Math.hypot(event.clientX - s.x, event.clientY - s.y) < 6) return;
      moved.current = true;
      setBox({ x1: s.x, y1: s.y, x2: event.clientX, y2: event.clientY });
    };
    const up = (event: PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s || !moved.current) return;
      const left = Math.min(s.x, event.clientX);
      const right = Math.max(s.x, event.clientX);
      const top = Math.min(s.y, event.clientY);
      const bottom = Math.max(s.y, event.clientY);
      const ids = [...document.querySelectorAll<HTMLElement>('[data-testid="admin-rooms-body"] [data-room-id]')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.right >= left && r.left <= right && r.bottom >= top && r.top <= bottom;
        })
        .map((el) => el.dataset.roomId ?? '')
        .filter(Boolean);
      setBox(null);
      onPick(ids, s.add);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [onPick]);
  const overlay = box ? (
    <Box
      aria-hidden
      data-testid="admin-rooms-marquee"
      sx={{
        position: 'fixed',
        left: Math.min(box.x1, box.x2),
        top: Math.min(box.y1, box.y2),
        width: Math.abs(box.x2 - box.x1),
        height: Math.abs(box.y2 - box.y1),
        border: `1.5px dashed ${accent.main}`,
        bgcolor: accent.washSoft,
        pointerEvents: 'none',
        zIndex: 30,
        borderRadius: '4px',
      }}
    />
  ) : null;
  return { onPointerDown, overlay, dragging: Boolean(box) };
}

/* ── Окно действия ──────────────────────────────────────────────────────── */

interface Choice {
  action: BatchAction;
  value: BatchValue;
}

export function BatchDialog({
  hotelId,
  group,
  roomIds,
  dict,
  onClose,
  onDone,
}: {
  hotelId: string;
  group: Group;
  roomIds: string[];
  dict: RoomsDictionaries | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [choice, setChoice] = useState<Choice>(() => initial(group, dict));
  const [shown, setShown] = useState<BatchPreview | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const preview = useMutation({
    mutationFn: () => previewBatch(hotelId, choice.action, choice.value, roomIds),
    onSuccess: setShown,
  });
  const run = useMutation({
    mutationFn: () => runBatch(hotelId, shown!.ticket!, roomIds),
    onSuccess: async (done) => {
      setResult(done);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['admin', 'hotel-rooms-map', hotelId] }),
        client.invalidateQueries({ queryKey: ['admin', 'rooms-dictionaries', hotelId] }),
        client.invalidateQueries({ queryKey: ['admin', 'room-detail', hotelId] }),
        client.invalidateQueries({ queryKey: ['admin', 'readiness', hotelId] }),
      ]);
      onDone();
    },
  });
  const close = () => {
    // Лист PIN закрывается один раз и навсегда — спросить.
    if (result?.pins.length && !confirmClose) setConfirmClose(true);
    else onClose();
  };
  const setAction = (action: BatchAction, value: BatchValue = null) => {
    setShown(null);
    setChoice({ action, value });
  };
  const k = 'admin.card.rooms.batch';

  return (
    <AdminDialog
      title={t(`${k}.title.${group}`, { count: roomIds.length })}
      subtitle={t(`${k}.subtitle`)}
      onClose={close}
      testId="admin-rooms-batch-dialog"
      maxWidth="md"
      actions={
        result ? (
          <Button sx={primaryButtonSx} onClick={close} data-testid="admin-rooms-batch-close">
            {t(`${k}.close`)}
          </Button>
        ) : (
          <>
            <Button sx={secondaryButtonSx} onClick={onClose}>{t('admin.card.rooms.edit.cancel')}</Button>
            {shown ? (
              <Button
                sx={{ ...primaryButtonSx, ...(choice.action === 'delete' ? { bgcolor: state.bad, '&:hover': { bgcolor: state.bad } } : {}) }}
                disabled={!shown.ticket || run.isPending}
                onClick={() => run.mutate()}
                data-testid="admin-rooms-batch-run"
              >
                {shown.summary.change ? t(`${k}.run`, { count: shown.summary.change }) : t(`${k}.nothing`)}
              </Button>
            ) : (
              <Button sx={primaryButtonSx} disabled={!ready(choice) || preview.isPending} onClick={() => preview.mutate()} data-testid="admin-rooms-batch-preview">
                {t(`${k}.preview`)}
              </Button>
            )}
          </>
        )
      }
    >
      {result ? (
        <Done result={result} action={choice.action} confirmClose={confirmClose} />
      ) : (
        <Box sx={{ display: 'grid', gap: 2 }}>
          <ChoiceForm group={group} choice={choice} setAction={setAction} dict={dict} />
          {preview.isError ? <Typography sx={{ ...typo.caption, color: state.bad }}>{errorText(preview.error)}</Typography> : null}
          {run.isError ? <Typography sx={{ ...typo.caption, color: state.bad }} data-testid="admin-rooms-batch-error">{errorText(run.error)}</Typography> : null}
          {shown ? <PreviewTable preview={shown} /> : null}
        </Box>
      )}
    </AdminDialog>
  );
}

function initial(group: Group, dict?: RoomsDictionaries): Choice {
  switch (group) {
    case 'variant':
      return { action: 'variant_set', value: dict?.variants[0]?.code ?? null };
    case 'pin':
      return { action: 'pin_issue', value: null };
    case 'category':
      return { action: 'category', value: dict?.categories[0]?.id ?? 'none' };
    case 'building':
      return { action: 'building', value: dict?.buildings[0]?.id ?? 'none' };
    case 'state':
      return { action: 'out_of_service', value: true };
    default:
      return { action: 'delete', value: null };
  }
}

function ready(choice: Choice) {
  if (choice.action === 'variant_set') return Boolean(choice.value);
  return true;
}

function Pills<V extends string>({ value, options, onChange, testId }: { value: V; options: Array<[V, string]>; onChange: (v: V) => void; testId: string }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }} role="radiogroup">
      {options.map(([key, label]) => (
        <ButtonBase
          key={key}
          role="radio"
          aria-checked={value === key}
          onClick={() => onChange(key)}
          data-testid={`${testId}-${key}`}
          sx={{ px: 1.25, py: 0.6, borderRadius: `${shape.pill}px`, ...typo.caption, fontWeight: 700, border: `1px solid ${value === key ? accent.main : surface.line}`, color: value === key ? accent.soft : ink.mid, bgcolor: value === key ? accent.washSoft : 'transparent' }}
        >
          {label}
        </ButtonBase>
      ))}
    </Box>
  );
}

function ChoiceForm({ group, choice, setAction, dict }: { group: Group; choice: Choice; setAction: (a: BatchAction, v?: BatchValue) => void; dict?: RoomsDictionaries }) {
  const { t } = useTranslation();
  const k = 'admin.card.rooms.batch';
  const help = <Help>{t(`${k}.help.${group}`)}</Help>;
  if (group === 'variant') {
    const mode = choice.action === 'variant_clear' ? 'clear' : 'set';
    return (
      <Box sx={{ display: 'grid', gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Pills value={mode} onChange={(m) => setAction(m === 'set' ? 'variant_set' : 'variant_clear', m === 'set' ? (dict?.variants[0]?.code ?? null) : null)} options={[['set', t(`${k}.variantSet`)], ['clear', t(`${k}.variantClear`)]]} testId="admin-rooms-batch-mode" />
          {help}
        </Box>
        {mode === 'set' ? (
          dict?.variants.length ? (
            <SelectField label={t('admin.card.rooms.col.variant')} value={String(choice.value ?? '')} onChange={(v) => setAction('variant_set', v)} options={dict.variants.map((v) => ({ value: v.code, label: v.title }))} testId="admin-rooms-batch-variant" fieldSx={fieldSx} />
          ) : (
            <Typography sx={{ ...typo.body, color: ink.mid }}>{t('admin.card.rooms.edit.noVariants')}</Typography>
          )
        ) : null}
      </Box>
    );
  }
  if (group === 'pin') {
    const mode = choice.action === 'pin_issue' ? 'issue' : choice.action === 'pin_clear' ? 'clear' : 'until';
    return (
      <Box sx={{ display: 'grid', gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Pills
            value={mode}
            onChange={(m) => setAction(m === 'issue' ? 'pin_issue' : m === 'clear' ? 'pin_clear' : 'pin_until')}
            options={[['issue', t(`${k}.pinIssue`)], ['clear', t(`${k}.pinClear`)], ['until', t(`${k}.pinUntil`)]]}
            testId="admin-rooms-batch-mode"
          />
          {help}
        </Box>
        {mode !== 'clear' ? (
          <DateField
            label={t('admin.card.rooms.access.validUntil')}
            value={String(choice.value ?? '')}
            onChange={(v) => setAction(choice.action, v || null)}
            testId="admin-rooms-batch-until"
            helperText={mode === 'issue' ? t(`${k}.issueHelp`) : t('admin.card.rooms.access.validUntilHelp')}
          />
        ) : null}
      </Box>
    );
  }
  if (group === 'category' || group === 'building') {
    const items = (group === 'building' ? dict?.buildings : dict?.categories) ?? [];
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flex: 1 }}>
          <SelectField
            label={t(`admin.card.rooms.col.${group}`)}
            value={String(choice.value ?? 'none')}
            onChange={(v) => setAction(group, v)}
            options={[...items.map((i) => ({ value: i.id, label: i.title_i18n })), { value: 'none', label: t(`${k}.clear.${group}`) }]}
            testId={`admin-rooms-batch-${group}-value`}
            fieldSx={fieldSx}
          />
        </Box>
        {help}
      </Box>
    );
  }
  if (group === 'state') {
    const key = `${choice.action}:${String(choice.value)}`;
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Pills
          value={key}
          onChange={(v) => {
            const [action, value] = v.split(':');
            setAction(action as BatchAction, value === 'true');
          }}
          options={[
            ['out_of_service:true', t(`${k}.outOn`)],
            ['out_of_service:false', t(`${k}.outOff`)],
            ['active:false', t(`${k}.activeOff`)],
            ['active:true', t(`${k}.activeOn`)],
          ]}
          testId="admin-rooms-batch-state"
        />
        {help}
      </Box>
    );
  }
  return (
    <Box sx={{ ...typo.body, color: ink.hi, display: 'flex', alignItems: 'center', gap: 1 }}>
      {t(`${k}.deleteLead`)}
      {help}
    </Box>
  );
}

/* ── Показ: что изменится ───────────────────────────────────────────────── */

function useWords() {
  const { t } = useTranslation();
  const k = 'admin.card.rooms.batch';
  return (action: BatchAction, value: string | boolean | null): string => {
    if (value === null || value === '') {
      if (action === 'variant_set' || action === 'variant_clear') return t('admin.card.rooms.noVariantValue');
      if (action === 'building') return t('admin.card.rooms.noBuilding');
      if (action === 'category') return t(`${k}.noCategory`);
      if (action === 'pin_until') return t(`${k}.noEnd`);
      return '—';
    }
    if (typeof value === 'boolean') {
      if (action === 'pin_issue' || action === 'pin_clear') return value ? t('admin.card.rooms.pinValue.yes') : t('admin.card.rooms.pinValue.no');
      if (action === 'out_of_service') return value ? t(`${k}.outOn`) : t(`${k}.outOff`);
      if (action === 'active') return value ? t(`${k}.activeOn`) : t(`${k}.activeOff`);
      if (action === 'delete') return value ? t(`${k}.exists`) : t(`${k}.deleted`);
    }
    if (action === 'pin_until') return new Date(`${value}T12:00:00`).toLocaleDateString();
    return String(value);
  };
}

function PreviewTable({ preview }: { preview: BatchPreview }) {
  const { t } = useTranslation();
  const words = useWords();
  const k = 'admin.card.rooms.batch';
  const { summary } = preview;
  const tone = (row: BatchRow) => (row.outcome === 'change' ? 'info' : row.outcome === 'same' ? 'muted' : 'bad');
  return (
    <Box sx={{ display: 'grid', gap: 1.25 }} data-testid="admin-rooms-batch-shown">
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', ...typo.body }} data-testid="admin-rooms-batch-summary">
        <Pill tone="info">{t(`${k}.sum.change`, { count: summary.change })}</Pill>
        {summary.same ? <Pill tone="muted">{t(`${k}.sum.same`, { count: summary.same })}</Pill> : null}
        {summary.refused ? <Pill tone="bad">{t(`${k}.sum.refused`, { count: summary.refused })}</Pill> : null}
      </Box>
      {Object.entries(summary.warnings).map(([key, count]) => (
        <Box key={key} sx={{ p: 1, borderRadius: `${shape.radiusSmall}px`, border: `1px solid ${state.warn}`, color: ink.hi, ...typo.body }} data-testid={`admin-rooms-batch-warning-${key}`}>
          {t(`${k}.warn.${key}`, { count })}
        </Box>
      ))}
      <Box sx={{ maxHeight: 320, overflowY: 'auto', border: `1px solid ${surface.hair}`, borderRadius: `${shape.radiusSmall}px` }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', ...typo.caption, '& td': { p: '6px 10px', borderBottom: `1px solid ${surface.hair}` } }}>
          <Box component="tbody">
            {preview.rows.map((row) => (
              <Box component="tr" key={row.id} data-testid={`admin-rooms-batch-row-${row.number ?? row.id}`} data-outcome={row.outcome}>
                <Box component="td" sx={{ fontWeight: 800, color: ink.hi, whiteSpace: 'nowrap' }}>{row.number ?? '—'}</Box>
                <td><Pill tone={tone(row)}>{t(`${k}.outcome.${row.outcome}`)}</Pill></td>
                <Box component="td" sx={{ color: ink.mid }}>
                  {row.outcome === 'refused' ? (
                    t(`${k}.reason.${row.reason ?? 'not_found'}`)
                  ) : (
                    <>
                      <span data-words="data">{words(preview.action, row.from)}</span> → <span data-words="data">{preview.action === 'pin_issue' ? t(`${k}.newPin`) : words(preview.action, row.to)}</span>
                    </>
                  )}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

/* ── Итог и лист PIN ────────────────────────────────────────────────────── */

function Done({ result, action, confirmClose }: { result: BatchResult; action: BatchAction; confirmClose: boolean }) {
  const { t } = useTranslation();
  const k = 'admin.card.rooms.batch';
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }} data-testid="admin-rooms-batch-done">
      <Typography sx={{ ...typo.body, color: ink.hi, fontWeight: 700 }}>
        {t(`${k}.done`, { count: result.done })}
        {result.skipped ? ` ${t(`${k}.skipped`, { count: result.skipped })}` : ''}
      </Typography>
      {action === 'pin_issue' && result.pins.length ? <PinSheet pins={result.pins} /> : null}
      {confirmClose ? (
        <Box sx={{ p: 1.25, borderRadius: `${shape.radiusSmall}px`, border: `1px solid ${state.bad}`, color: state.bad, ...typo.body }} data-testid="admin-rooms-pins-close-warning">
          {t(`${k}.pins.closeWarning`)}
        </Box>
      ) : null}
    </Box>
  );
}

function PinSheet({ pins }: { pins: Array<{ number: string; pin: string }> }) {
  const { t } = useTranslation();
  const k = 'admin.card.rooms.batch.pins';
  const csv = () => {
    // Точка с запятой и BOM — чтобы Excel на русской системе открыл как таблицу.
    const text = `﻿${t(`${k}.colRoom`)};${t(`${k}.colPin`)}\n${pins.map((p) => `${p.number};${p.pin}`).join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `pin-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const print = () => {
    const win = window.open('', '_blank', 'width=720,height=900');
    if (!win) return;
    const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
    const cards = pins
      .map((p) => `<div class="card"><div class="room">${esc(t(`${k}.cardRoom`, { number: p.number }))}</div><div class="pin">${esc(p.pin)}</div><div class="hint">${esc(t(`${k}.cardHint`))}</div></div>`)
      .join('');
    win.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${esc(t(`${k}.printTitle`))}</title><style>body{font-family:system-ui,sans-serif;margin:16px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.card{border:1px dashed currentColor;border-radius:8px;padding:12px;break-inside:avoid}.room{font-weight:700}.pin{font:700 26px monospace;letter-spacing:4px;margin:6px 0}.hint{font-size:11px;opacity:.65}</style></head><body><div class="grid">${cards}</div><script>window.onload=function(){window.print()}</script></body></html>`,
    );
    win.document.close();
  };
  return (
    <Box sx={{ display: 'grid', gap: 1 }} data-testid="admin-rooms-pin-sheet">
      <Box sx={{ p: 1.25, borderRadius: `${shape.radiusSmall}px`, border: `1px solid ${state.warn}`, ...typo.body, color: ink.hi }}>{t(`${k}.once`)}</Box>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button sx={secondaryButtonSx} startIcon={<DownloadOutlinedIcon fontSize="small" />} onClick={csv} data-testid="admin-rooms-pins-csv">{t(`${k}.csv`)}</Button>
        <Button sx={secondaryButtonSx} startIcon={<PrintOutlinedIcon fontSize="small" />} onClick={print} data-testid="admin-rooms-pins-print">{t(`${k}.print`)}</Button>
      </Box>
      <Box sx={{ maxHeight: 320, overflowY: 'auto', border: `1px solid ${surface.hair}`, borderRadius: `${shape.radiusSmall}px` }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', ...typo.body, '& td, & th': { p: '6px 12px', borderBottom: `1px solid ${surface.hair}`, textAlign: 'start' } }}>
          <Box component="thead">
            <Box component="tr" sx={{ '& th': { ...typo.label, color: ink.mid } }}>
              <th>{t(`${k}.colRoom`)}</th>
              <th>{t(`${k}.colPin`)}</th>
            </Box>
          </Box>
          <Box component="tbody">
            {pins.map((p) => (
              <Box component="tr" key={p.number} data-testid={`admin-rooms-pin-${p.number}`}>
                <Box component="td" sx={{ fontWeight: 800, color: ink.hi }}>{p.number}</Box>
                <Box component="td" sx={{ fontFamily: 'monospace', fontSize: 16, letterSpacing: 2, color: ink.hi }} data-words="data">{p.pin}</Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export function SelectionHint({ children }: { children: ReactNode }) {
  return <Box sx={{ ...typo.caption, color: ink.low }}>{children}</Box>;
}
