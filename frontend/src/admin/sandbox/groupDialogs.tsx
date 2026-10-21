import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import InputAdornment from '@mui/material/InputAdornment';
import Radio from '@mui/material/Radio';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SearchIcon from '@mui/icons-material/Search';

import { accent, fieldSx, ink, primaryButtonSx, shape, state, surface, typo } from '../adminTokens';
import { AdminDialog } from '../form';
import type { HotelLine } from './sandboxData';
import { GROUP_COLORS, groupsStore, type Group, type GroupColor } from './groupsStore';
import { MODULES } from './moduleCatalog';
import { plural } from './readiness';
import { Hl } from './ui';

/**
 * ОКНА ГРУПП (партия 62, третий заход): создать, удалить, добавить отель,
 * действие по всей группе. Каждое окно говорит, что будет и со сколькими
 * отелями, и просит подтверждения там, где действие задевает гостей.
 */

export const colorVar = (c: GroupColor) => (c === 'accent' ? accent.main : state[c]);

/** Цветная метка группы — та же в списке отелей и на странице группы. */
export function GroupMark({ color, size = 12 }: { color: GroupColor; size?: number }) {
  return <Box component="span" aria-hidden sx={{ display: 'inline-block', width: size, height: size, borderRadius: '4px', bgcolor: colorVar(color), flex: '0 0 auto' }} />;
}

export function ColorPicker({ value, onChange }: { value: GroupColor; onChange: (c: GroupColor) => void }) {
  return (
    <Box role="radiogroup" aria-label="Цвет-метка" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
      {GROUP_COLORS.map(([c, label]) => (
        <ButtonBase
          key={c}
          role="radio"
          aria-checked={value === c}
          aria-label={label}
          onClick={() => onChange(c)}
          sx={{ gap: 0.75, px: 1, py: 0.5, borderRadius: `${shape.pill}px`, border: `1px solid ${value === c ? accent.main : surface.line}`, bgcolor: value === c ? accent.washSoft : 'transparent', ...typo.caption, color: ink.hi }}
        >
          <GroupMark color={c} />
          {label}
        </ButtonBase>
      ))}
    </Box>
  );
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <TextField
      size="small"
      fullWidth
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      sx={fieldSx}
      slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
    />
  );
}

/** Выбор отелей: поиск, галочки, у отеля из другой группы — предупреждение. */
function HotelPicker({ lines, groups, selfId, value, onChange }: { lines: HotelLine[]; groups: Group[]; selfId?: string; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState('');
  const ql = q.toLowerCase();
  const candidates = lines.filter((l) => {
    const g = groups.find((x) => x.hotels.includes(l.row.subdomain));
    if (selfId && g?.id === selfId) return false;
    return !ql || `${l.profile?.name ?? l.row.name} ${l.row.subdomain} ${l.profile?.city ?? ''}`.toLowerCase().includes(ql);
  });
  const toggle = (sub: string) => onChange(value.includes(sub) ? value.filter((s) => s !== sub) : [...value, sub]);
  return (
    <Box>
      <SearchField value={q} onChange={setQ} placeholder="Найти отель: название, поддомен, город" />
      <Box sx={{ mt: 1, maxHeight: 280, overflowY: 'auto', border: `1px solid ${surface.line}`, borderRadius: `${shape.radius}px` }}>
        {!candidates.length ? <Box sx={{ p: 2, ...typo.caption, color: ink.mid }}>Таких отелей нет. Проверьте написание.</Box> : null}
        {candidates.map((l) => {
          const g = groups.find((x) => x.hotels.includes(l.row.subdomain));
          const name = l.profile?.name ?? l.row.name;
          const on = value.includes(l.row.subdomain);
          return (
            <ButtonBase key={l.row.id} onClick={() => toggle(l.row.subdomain)} sx={{ display: 'flex', width: '100%', justifyContent: 'flex-start', gap: 1, px: 1, py: 0.75, textAlign: 'left', borderBottom: `1px solid ${surface.hair}`, bgcolor: on ? accent.washSoft : undefined }}>
              <Checkbox size="small" checked={on} tabIndex={-1} sx={{ p: 0.5 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ ...typo.body, fontWeight: 700, color: l.row.is_active ? ink.hi : ink.low }}><Hl text={name} q={q} /></Box>
                <Box sx={{ ...typo.caption, color: ink.mid }}>
                  <Hl text={l.row.subdomain} q={q} />
                  {g ? ` · сейчас в «${g.title}»` : ' · без группы'}
                  {!l.row.is_active ? ' · отключён' : ''}
                </Box>
                {on && g ? <Box sx={{ ...typo.caption, color: state.warn, fontWeight: 600 }}>Переедет из группы «{g.title}»</Box> : null}
              </Box>
            </ButtonBase>
          );
        })}
      </Box>
      <Typography sx={{ ...typo.caption, color: ink.mid, mt: 0.75 }}>
        Выбрано: {value.length}. Отель состоит не больше чем в одной группе — из прежней он уйдёт сам.
      </Typography>
    </Box>
  );
}

export function CreateGroupDialog({ lines, groups, onClose, onCreated }: { lines: HotelLine[]; groups: Group[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<GroupColor>('ok');
  const [hotels, setHotels] = useState<string[]>([]);
  return (
    <AdminDialog
      testId="sandbox-group-create"
      title="Новая группа"
      subtitle="Группа объединяет отели одного владельца. Её видит только наша команда — гостям и сотрудникам отелей она не показывается."
      onClose={onClose}
      maxWidth="md"
      actions={
        <>
          <Button sx={{ color: ink.mid }} onClick={onClose}>Отмена</Button>
          <Button sx={primaryButtonSx} disabled={!title.trim()} onClick={() => onCreated(groupsStore.create({ title: title.trim(), description, color, hotels }))}>
            Создать{hotels.length ? ` с ${hotels.length} ${plural(hotels.length, 'отелем', 'отелями', 'отелями')}` : ''}
          </Button>
        </>
      }
    >
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
        <Box sx={{ display: 'grid', gap: 2, alignContent: 'start' }}>
          <TextField label="Название" required placeholder="Например, «Отели Метрополь»" value={title} onChange={(e) => setTitle(e.target.value)} sx={fieldSx} />
          <TextField label="Описание" placeholder="Чьи это отели и зачем они вместе" multiline minRows={2} value={description} onChange={(e) => setDescription(e.target.value)} sx={fieldSx} />
          <Box>
            <Typography sx={{ ...typo.caption, color: ink.mid, mb: 0.75 }}>Цвет-метка — по нему группу узнают в списке отелей</Typography>
            <ColorPicker value={color} onChange={setColor} />
          </Box>
        </Box>
        <Box>
          <Typography sx={{ ...typo.caption, color: ink.mid, mb: 0.75 }}>Отели группы — можно выбрать сейчас или добавить позже</Typography>
          <HotelPicker lines={lines} groups={groups} value={hotels} onChange={setHotels} />
        </Box>
      </Box>
    </AdminDialog>
  );
}

export function AddHotelsDialog({ group, lines, groups, onClose, initial = [] }: { group: Group; lines: HotelLine[]; groups: Group[]; onClose: () => void; initial?: string[] }) {
  const [hotels, setHotels] = useState<string[]>(initial);
  const movers = hotels.filter((h) => groups.some((g) => g.id !== group.id && g.hotels.includes(h)));
  return (
    <AdminDialog
      testId="sandbox-group-add"
      title={`Добавить отели в «${group.title}»`}
      subtitle={
        group.autoEnabled && group.autoModules.length
          ? `У группы включено правило: новым отелям включится ${group.autoModules.map((c) => `«${MODULES.find((m) => m.code === c)?.title}»`).join(', ')}.`
          : 'Отели без группы и из других групп. Правило «умолчания для новых отелей» у этой группы выключено.'
      }
      onClose={onClose}
      actions={
        <>
          <Button sx={{ color: ink.mid }} onClick={onClose}>Отмена</Button>
          <Button
            sx={primaryButtonSx}
            disabled={!hotels.length}
            onClick={() => {
              groupsStore.move(hotels, group.id);
              onClose();
            }}
          >
            Добавить {hotels.length || ''}
          </Button>
        </>
      }
    >
      <HotelPicker lines={lines} groups={groups} selfId={group.id} value={hotels} onChange={setHotels} />
      {movers.length ? (
        <Box sx={{ mt: 1.5, p: 1.25, borderRadius: `${shape.radius}px`, bgcolor: 'var(--adm-state-warn-wash)', ...typo.caption, color: ink.hi }}>
          {movers.length} {plural(movers.length, 'отель переедет', 'отеля переедут', 'отелей переедут')} из другой группы. Умолчания прежней группы у них останутся включёнными — модули сами не выключаются.
        </Box>
      ) : null}
    </AdminDialog>
  );
}

export function DeleteGroupDialog({ group, lines, onClose, onDeleted }: { group: Group; lines: HotelLine[]; onClose: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState('');
  const names = group.hotels.map((sub) => lines.find((l) => l.row.subdomain === sub)?.profile?.name ?? sub);
  return (
    <AdminDialog
      testId="sandbox-group-delete"
      title={`Удалить группу «${group.title}»?`}
      subtitle="Удаляется только группа. Отели остаются как есть — с модулями, номерами и данными — и переходят в «Отели без группы»."
      onClose={onClose}
      actions={
        <>
          <Button sx={{ color: ink.mid }} onClick={onClose}>Отмена</Button>
          <Button
            sx={{ ...primaryButtonSx, bgcolor: state.bad }}
            disabled={confirm.trim() !== group.title}
            onClick={() => {
              groupsStore.remove(group.id);
              onDeleted();
            }}
          >
            Удалить группу
          </Button>
        </>
      }
    >
      <Typography sx={{ ...typo.label, color: ink.mid, mb: 1 }}>
        {names.length ? `Уйдут в «Отели без группы» — ${names.length}` : 'В группе нет отелей'}
      </Typography>
      {names.map((n) => (
        <Box key={n} sx={{ ...typo.body, color: ink.hi, py: 0.4 }}>• {n}</Box>
      ))}
      <Box sx={{ mt: 1.5, ...typo.caption, color: ink.mid }}>
        Умолчания группы и её заметка удалятся. История группы останется в «Журнале действий».
      </Box>
      <TextField size="small" label="Введите название группы" value={confirm} onChange={(e) => setConfirm(e.target.value)} sx={{ ...fieldSx, mt: 2 }} fullWidth helperText="Кнопка включится, когда название совпадёт." />
    </AdminDialog>
  );
}

/** Действие по всей группе: модуль во всех отелях или отключение / включение всех. */
export function GroupActionDialog({ kind, group, lines, onClose }: { kind: 'module' | 'disable' | 'enable'; group: Group; lines: HotelLine[]; onClose: () => void }) {
  const [code, setCode] = useState('room_control');
  const [turnOn, setTurnOn] = useState(true);
  const inGroup = lines.filter((l) => group.hotels.includes(l.row.subdomain));
  const ready = MODULES.filter((m) => m.status === 'ready');
  const already = inGroup.filter((l) => l.modules.some((m) => m.code === code && m.is_enabled) === turnOn).length;
  const n = inGroup.length;
  const title =
    kind === 'module'
      ? `Модуль во всех отелях «${group.title}»`
      : kind === 'disable'
        ? `Отключить все отели «${group.title}»?`
        : `Включить все отели «${group.title}»?`;
  return (
    <AdminDialog
      testId={`sandbox-group-action-${kind}`}
      title={title}
      subtitle={
        kind === 'module'
          ? 'Модуль включится или выключится у каждого отеля группы. Отели, где он уже в нужном положении, не меняются.'
          : kind === 'disable'
            ? 'Гости всех отелей группы увидят «Отель временно не принимает заказы», сотрудники не смогут войти. Данные сохранятся.'
            : 'Отели снова откроются гостям и сотрудникам. Отели, которые отключали по отдельности, тоже включатся — проверьте список.'
      }
      onClose={onClose}
      actions={
        <>
          <Button sx={{ color: ink.mid }} onClick={onClose}>Отмена</Button>
          <Button sx={kind === 'disable' ? { ...primaryButtonSx, bgcolor: state.bad } : primaryButtonSx} disabled>
            {kind === 'module' ? `${turnOn ? 'Включить' : 'Выключить'} у ${n - already} ${plural(n - already, 'отеля', 'отелей', 'отелей')}` : kind === 'disable' ? `Отключить ${n}` : `Включить ${n}`}
          </Button>
        </>
      }
    >
      {kind === 'module' ? (
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          <Box>
            <Typography sx={{ ...typo.caption, color: ink.mid, mb: 0.5 }}>Модуль</Typography>
            {ready.map((m) => (
              <ButtonBase key={m.code} onClick={() => setCode(m.code)} sx={{ display: 'flex', width: '100%', justifyContent: 'flex-start', gap: 1, py: 0.25, textAlign: 'left' }}>
                <Radio size="small" checked={code === m.code} tabIndex={-1} />
                <Box>
                  <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}>{m.title}</Box>
                  <Box sx={{ ...typo.caption, color: ink.mid }}>{m.gives}</Box>
                </Box>
              </ButtonBase>
            ))}
            <Typography sx={{ ...typo.caption, color: ink.low, mt: 0.5 }}>Модули в разработке здесь не показаны — их нельзя включить.</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {[true, false].map((on) => (
              <ButtonBase key={String(on)} onClick={() => setTurnOn(on)} sx={{ px: 1.5, py: 0.75, borderRadius: `${shape.radius}px`, border: `1px solid ${turnOn === on ? accent.main : surface.line}`, bgcolor: turnOn === on ? accent.washSoft : 'transparent', ...typo.body, fontWeight: 600 }}>
                {on ? 'Включить' : 'Выключить'}
              </ButtonBase>
            ))}
          </Box>
        </Box>
      ) : (
        <TextField label="Причина" required={kind === 'disable'} multiline minRows={2} fullWidth sx={fieldSx} helperText="Видна только здесь, в Control, и попадёт в историю группы и каждого отеля." />
      )}
      <Box sx={{ mt: 2, p: 1.5, borderRadius: `${shape.radius}px`, bgcolor: surface.s2 }}>
        <Typography sx={{ ...typo.label, color: ink.mid, mb: 0.75 }}>Отели группы — {n}</Typography>
        {inGroup.map((l) => {
          const on = l.modules.some((m) => m.code === code && m.is_enabled);
          const note =
            kind === 'module' ? (on === turnOn ? 'уже так — без изменений' : turnOn ? 'включится' : 'выключится') : kind === 'disable' ? (l.row.is_active ? 'отключится' : 'уже отключён') : l.row.is_active ? 'уже включён' : 'включится';
          const changes = !note.startsWith('уже');
          return (
            <Box key={l.row.id} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.4, ...typo.caption }}>
              <Box sx={{ color: ink.hi, fontWeight: 600 }}>{l.profile?.name ?? l.row.name}</Box>
              <Box sx={{ color: changes ? (kind === 'disable' ? state.bad : accent.soft) : ink.low }}>{note}</Box>
            </Box>
          );
        })}
      </Box>
    </AdminDialog>
  );
}
