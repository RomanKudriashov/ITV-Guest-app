import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import CloudOutlinedIcon from '@mui/icons-material/CloudOutlined';
import RouterOutlinedIcon from '@mui/icons-material/RouterOutlined';
import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';

import { accent, fieldSx, ink, panelSx, primaryButtonSx, secondaryButtonSx, shape, state, surface, typo } from '../adminTokens';
import { getHotelNodes, getHotelsView, type NodeRow } from '../adminClient';
import { Help, Panel, Pill } from '../pages/hotels/hotelsUi';
import { MockAction, PageHead, Sample, VariantBar, useGo, type VariantInfo } from './ui';

/**
 * МАКЕТ 2 — ПОДКЛЮЧЕНИЕ УПРАВЛЕНИЯ НОМЕРОМ (партия 63-М). Три варианта:
 *   А «Мастер»            — по шагам: схема → путь → настройка → проверка → готово;
 *   Б «Схема-конструктор» — цепочка звеньев, щелчок по звену — его настройка;
 *   В «Экран подключений» — что подключено после мастера: звенья карточками,
 *                           правка, перевыпуск ключа, проверка по звеньям.
 *
 * Два пути: (а) свой коннектор на сервере отеля — облако говорит с ним, он — с
 * сервером управления в сети отеля; (б) напрямую к серверу управления —
 * облако идёт к нему само (сервер должен быть доступен снаружи).
 */

const VARIANTS: VariantInfo[] = [
  { key: 'a', title: 'Вариант А · Мастер', idea: 'первое подключение ведёт за руку: сначала схема, кто с кем говорит, потом выбор пути, настройка, проверка по звеньям с понятным итогом.' },
  { key: 'b', title: 'Вариант Б · Схема-конструктор', idea: 'вся цепочка всегда перед глазами; щелчок по звену открывает его настройку справа; цвет звена — его состояние. Коннектор — дорога, сервер управления — куда она ведёт.' },
  { key: 'c', title: 'Вариант В · Экран подключений', idea: 'то, что видно после мастера: звенья карточками с состоянием и правкой, перевыпуск ключа, «Проверить» прогоняет цепочку и говорит, что красное и что делать.' },
];

type Path = 'connector' | 'direct' | 'both';
type LinkKey = 'guest' | 'cloud' | 'connector' | 'server' | 'device';
type LinkState = 'ok' | 'bad' | 'wait' | 'off';

const LINKS: Array<{ key: LinkKey; title: string; sub: string; icon: ReactNode }> = [
  { key: 'guest', title: 'Гость', sub: 'телефон в номере', icon: <PersonOutlineIcon /> },
  { key: 'cloud', title: 'NaviRoom', sub: 'наше облако', icon: <CloudOutlinedIcon /> },
  { key: 'connector', title: 'Коннектор', sub: 'программа на сервере отеля', icon: <RouterOutlinedIcon /> },
  { key: 'server', title: 'Сервер управления', sub: 'iRidi, Bittel или другой', icon: <DnsOutlinedIcon /> },
  { key: 'device', title: 'Оборудование', sub: 'свет, климат, шторы', icon: <LightbulbOutlinedIcon /> },
];

const SERVER_TYPES = [
  { key: 'iridi', title: 'iRidi', sub: 'HTTP-сервер iRidi в сети отеля', port: '1085', protocol: 'HTTP', sample: false },
  { key: 'bittel', title: 'Bittel', sub: 'сервер Bittel (RcuServer)', port: '21221', protocol: 'TCP', sample: true },
  { key: 'other', title: 'Другое', sub: 'любой сервер с HTTP-командами', port: '80', protocol: 'HTTP', sample: true },
];

/** Живой коннектор «Кристалла» (локально) — чтобы первое звено было настоящим. */
function useCrystalNodes() {
  return useQuery({
    queryKey: ['sandbox63', 'crystal-nodes'],
    queryFn: async () => {
      const fleet = await getHotelsView({ layout: 'list', origin: 'all', search: 'crystal' });
      const crystal = fleet.items.find((r) => r.subdomain === 'crystal');
      if (!crystal) return { hotel: null, nodes: [] as NodeRow[] };
      return { hotel: crystal.name, nodes: (await getHotelNodes(crystal.id)).items };
    },
  });
}

const STATE_FILL: Record<LinkState, string> = { ok: state.ok, bad: state.bad, wait: state.warn, off: ink.low };
const STATE_TEXT: Record<LinkState, string> = { ok: 'работает', bad: 'не отвечает', wait: 'ждём', off: 'не нужно' };

/** Схема «кто с кем говорит»: подсветка текущего звена, цвет — состояние. */
function Chain({ path, active, states, onPick, compact }: { path: Path; active?: LinkKey | null; states?: Partial<Record<LinkKey, LinkState>>; onPick?: (key: LinkKey) => void; compact?: boolean }) {
  const shown = path === 'direct' ? LINKS.filter((l) => l.key !== 'connector') : LINKS;
  return (
    <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 0, overflowX: 'auto', py: 1 }} data-testid="sandbox-chain">
      {shown.map((link, i) => {
        const st = states?.[link.key];
        const on = active === link.key;
        return (
          <Box key={link.key} sx={{ display: 'flex', alignItems: 'center', flex: '1 0 auto' }}>
            <ButtonBase
              onClick={() => onPick?.(link.key)}
              disabled={!onPick}
              data-testid={`sandbox-link-${link.key}`}
              sx={{
                ...panelSx,
                p: compact ? 1 : 1.5,
                minWidth: compact ? 110 : 140,
                display: 'grid',
                justifyItems: 'center',
                gap: 0.5,
                textAlign: 'center',
                border: `2px solid ${on ? accent.main : st ? STATE_FILL[st] : surface.line}`,
                boxShadow: on ? `0 0 0 4px ${accent.washSoft}` : undefined,
              }}
            >
              <Box sx={{ color: on ? accent.soft : ink.mid, display: 'grid', placeItems: 'center' }}>{link.icon}</Box>
              <Box sx={{ ...typo.body, fontWeight: 800, color: ink.hi }}>{link.title}</Box>
              {!compact ? <Box sx={{ ...typo.caption, color: ink.mid }}>{link.sub}</Box> : null}
              {st ? (
                <Box sx={{ display: 'inline-flex', gap: 0.5, alignItems: 'center', ...typo.caption, fontWeight: 700, color: STATE_FILL[st] }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: STATE_FILL[st] }} />
                  {STATE_TEXT[st]}
                </Box>
              ) : null}
            </ButtonBase>
            {i < shown.length - 1 ? (
              <Box sx={{ flex: '1 0 28px', mx: 0.5, display: 'grid', justifyItems: 'center', ...typo.caption, color: ink.low }}>
                <Box sx={{ height: 2, width: '100%', bgcolor: surface.line, position: 'relative', '&::after': { content: '""', position: 'absolute', right: -2, top: -4, borderLeft: `6px solid ${surface.line}`, borderTop: '5px solid transparent', borderBottom: '5px solid transparent' } }} />
                <Box sx={{ mt: 0.5, fontSize: 10.5, whiteSpace: 'nowrap' }}>
                  {link.key === 'cloud' && path !== 'direct' ? 'зашифрованный канал' : link.key === 'cloud' ? 'через интернет' : link.key === 'connector' ? 'сеть отеля' : link.key === 'server' ? 'шина оборудования' : 'приложение'}
                </Box>
              </Box>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}

function PathCards({ path, onChange }: { path: Path; onChange: (p: Path) => void }) {
  const card = (key: Path, title: string, body: ReactNode, note?: ReactNode) => (
    <ButtonBase
      onClick={() => onChange(key)}
      data-testid={`sandbox-path-${key}`}
      sx={{ ...panelSx, display: 'block', textAlign: 'start', border: `2px solid ${path === key ? accent.main : surface.line}`, bgcolor: path === key ? accent.washSoft : undefined }}
    >
      <Box sx={{ ...typo.panelTitle, color: ink.hi }}>{title}</Box>
      <Box sx={{ ...typo.body, color: ink.mid, mt: 0.75 }}>{body}</Box>
      {note ? <Box sx={{ ...typo.caption, color: ink.low, mt: 1 }}>{note}</Box> : null}
    </ButtonBase>
  );
  return (
    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
      {card('connector', 'Свой коннектор в отеле', 'Небольшая программа на сервере отеля. Она сама звонит в NaviRoom и передаёт команды серверу управления в сети отеля. Ничего не нужно открывать наружу.', 'Подходит почти всегда. Нужен компьютер в сети отеля.')}
      {card('direct', 'Напрямую к серверу управления', 'NaviRoom обращается к серверу управления сам — по адресу и порту. Сервер должен быть доступен из интернета (проброс порта или VPN).', <>Проще, если сервер уже открыт наружу. Сейчас так не умеет — <Sample>нужна доработка</Sample></>)}
      {card('both', 'Коннектор + сервер, заданные здесь', 'Коннектор — дорога, сервер управления — куда она ведёт. Адрес, порт и вход сервера задаются здесь, в Control, и уходят в коннектор сами.', <>Сейчас адрес сервера пишется в файл коннектора вручную — <Sample>нужна доработка</Sample></>)}
    </Box>
  );
}

function Secret({ label, value }: { label: string; value: string }) {
  const [edit, setEdit] = useState(false);
  return edit ? (
    <TextField size="small" label={label} defaultValue="" type="password" sx={fieldSx} autoFocus helperText="Новое значение заменит старое. Старое не показывается." />
  ) : (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: `${shape.radiusSmall}px`, border: `1px solid ${surface.line}` }}>
      <Box sx={{ flex: 1 }}>
        <Box sx={{ ...typo.label, color: ink.mid }}>{label}</Box>
        <Box sx={{ ...typo.body, color: ink.hi, letterSpacing: 2 }}>{value ? '••••••••' : 'не задано'}</Box>
      </Box>
      <Button size="small" sx={secondaryButtonSx} onClick={() => setEdit(true)}>Изменить</Button>
    </Box>
  );
}

/** Настройка сервера управления: тип, адрес, порт, протокол, вход, таймауты. */
function ServerForm() {
  const [type, setType] = useState('iridi');
  const [auth, setAuth] = useState<'none' | 'login' | 'token'>('none');
  const t = SERVER_TYPES.find((s) => s.key === type)!;
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }} data-testid="sandbox-server-form">
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {SERVER_TYPES.map((s) => (
          <ButtonBase key={s.key} onClick={() => setType(s.key)} data-testid={`sandbox-server-${s.key}`} sx={{ ...panelSx, p: 1.25, textAlign: 'start', display: 'block', minWidth: 180, border: `2px solid ${type === s.key ? accent.main : surface.line}` }}>
            <Box sx={{ ...typo.body, fontWeight: 800, color: ink.hi, display: 'flex', gap: 0.75, alignItems: 'center' }}>
              {s.title} {s.sample ? <Sample /> : null}
            </Box>
            <Box sx={{ ...typo.caption, color: ink.mid }}>{s.sub}</Box>
          </ButtonBase>
        ))}
      </Box>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr 1fr' } }}>
        <TextField size="small" label="Адрес в сети отеля" defaultValue={type === 'iridi' ? '10.10.20.15' : ''} sx={fieldSx} helperText="IP или имя сервера, как его видит коннектор." />
        <TextField size="small" label="Порт" defaultValue={t.port} sx={fieldSx} />
        <TextField size="small" label="Протокол" value={t.protocol} sx={fieldSx} helperText={t.protocol === 'TCP' ? 'Коннектор пока говорит только HTTP' : ' '} />
      </Box>
      <Box>
        <Box sx={{ ...typo.label, color: ink.mid, mb: 0.75, display: 'flex', alignItems: 'center' }}>
          Вход на сервер <Help>Есть ли у сервера управления пароль. У iRidi на стенде входа нет; у других серверов бывает логин и пароль или токен.</Help>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1 }}>
          {([['none', 'без входа'], ['login', 'логин и пароль'], ['token', 'токен']] as const).map(([k, label]) => (
            <ButtonBase key={k} onClick={() => setAuth(k)} data-testid={`sandbox-auth-${k}`} sx={{ px: 1.25, py: 0.5, borderRadius: `${shape.pill}px`, ...typo.caption, fontWeight: 700, border: `1px solid ${auth === k ? accent.main : surface.line}`, color: auth === k ? accent.soft : ink.mid }}>
              {label}
            </ButtonBase>
          ))}
          {auth !== 'none' ? <Sample /> : null}
        </Box>
        {auth === 'login' ? (
          <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
            <TextField size="small" label="Логин" defaultValue="naviroom" sx={fieldSx} />
            <Secret label="Пароль" value="x" />
          </Box>
        ) : null}
        {auth === 'token' ? <Secret label="Токен" value="x" /> : null}
      </Box>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' } }}>
        <TextField size="small" label="Ждать ответа, мс" defaultValue="3000" sx={fieldSx} />
        <TextField size="small" label="Одновременных запросов" defaultValue="8" sx={fieldSx} />
        <TextField size="small" label="Проверять связь, с" defaultValue="60" sx={fieldSx} />
      </Box>
    </Box>
  );
}

/** Свой коннектор: имя → команда установки с ключом → ожидание связи. */
function ConnectorForm({ node }: { node: NodeRow | null }) {
  const [issued, setIssued] = useState(false);
  const command = `curl -fsSL https://naviroom.ru/connector/install | sudo sh -s -- --key ${issued ? 'nrk_7f2c…a91e' : '<ключ>'}`;
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }} data-testid="sandbox-connector-form">
      <TextField size="small" label="Название коннектора" defaultValue={node?.name ?? 'Сервер в серверной'} sx={fieldSx} helperText="Как вы его узнаете в списке: «Сервер в серверной», «Ноутбук на ресепшене»." />
      <Box sx={{ ...typo.label, color: ink.mid }}>Установка на сервер отеля</Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', p: 1.25, borderRadius: `${shape.radiusSmall}px`, bgcolor: surface.s3, fontFamily: 'monospace', fontSize: 12.5, color: ink.hi, overflowX: 'auto' }}>
        <Box sx={{ flex: 1, whiteSpace: 'nowrap' }}>{command}</Box>
        <Button size="small" sx={secondaryButtonSx} startIcon={<ContentCopyOutlinedIcon fontSize="small" />} disabled={!issued}>Копировать</Button>
      </Box>
      <Box sx={{ ...typo.caption, color: ink.mid }}>
        Ключ — пропуск коннектора в NaviRoom. Показывается один раз, в команде. Потеряли — «Перевыпустить ключ»: старый перестанет действовать.
      </Box>
      {!issued ? (
        <Button sx={primaryButtonSx} onClick={() => setIssued(true)} data-testid="sandbox-issue-key">Выдать ключ и показать команду</Button>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ...typo.body, color: ink.hi }} data-testid="sandbox-waiting">
          <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: state.warn, animation: 'pulse 1.2s infinite', '@keyframes pulse': { '50%': { opacity: 0.3 } } }} />
          Ждём, пока коннектор выйдет на связь… Обычно это минута после запуска команды.
        </Box>
      )}
    </Box>
  );
}

/** Проверка по звеньям: «коннектор на связи → видит сервер → номер 201 ответил». */
function Check({ path, run }: { path: Path; run: number }) {
  const steps =
    path === 'direct'
      ? [
          { key: 'reach', title: 'NaviRoom дотянулся до сервера управления', fail: 'Сервер не отвечает снаружи: проверьте проброс порта или VPN и адрес.' },
          { key: 'room', title: 'Номер 201 ответил', fail: 'Сервер отвечает, номер — нет: проверьте имя устройства номера в файле пусконаладки.' },
        ]
      : [
          { key: 'node', title: 'Коннектор на связи', fail: 'Коннектор молчит: проверьте, что программа запущена и у сервера отеля есть интернет.' },
          { key: 'server', title: 'Коннектор видит сервер управления', fail: 'Коннектор не достучался до сервера: проверьте адрес и порт.' },
          { key: 'room', title: 'Номер 201 ответил', fail: 'Сервер отвечает, номер — нет: проверьте имя устройства номера.' },
        ];
  const [done, setDone] = useState(0);
  useEffect(() => {
    setDone(0);
    if (!run) return;
    const timers = steps.map((_, i) => window.setTimeout(() => setDone(i + 1), 700 * (i + 1)));
    return () => timers.forEach((id) => window.clearTimeout(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, path]);
  // Образец: последнее звено — красное, чтобы видно было «что делать».
  const failAt = steps.length - 1;
  return (
    <Box sx={{ display: 'grid', gap: 1 }} data-testid="sandbox-check">
      {steps.map((s, i) => {
        const st: LinkState = i >= done ? 'off' : i === failAt ? 'bad' : 'ok';
        return (
          <Box key={s.key} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', p: 1, borderRadius: `${shape.radiusSmall}px`, border: `1px solid ${st === 'bad' ? state.bad : surface.hair}` }}>
            <Box sx={{ mt: 0.6, width: 10, height: 10, borderRadius: '50%', bgcolor: i >= done ? surface.line : STATE_FILL[st], flex: 'none' }} />
            <Box sx={{ flex: 1 }}>
              <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}>{s.title}</Box>
              {st === 'bad' ? <Box sx={{ ...typo.caption, color: state.bad }}>{s.fail}</Box> : null}
              {st === 'ok' ? <Box sx={{ ...typo.caption, color: ink.mid }}>да</Box> : null}
            </Box>
            {i >= done && run ? <Box sx={{ ...typo.caption, color: ink.low }}>…</Box> : null}
          </Box>
        );
      })}
      {done >= steps.length ? (
        <Box sx={{ ...typo.body, color: ink.hi }}>
          <b>Итог:</b> до сервера управления всё работает, номер 201 не ответил. <Sample>образец итога</Sample>
        </Box>
      ) : null}
    </Box>
  );
}

export function ConnectMock() {
  const [params, go] = useGo();
  const v = params.get('v') || 'a';
  const nodes = useCrystalNodes();
  const node = nodes.data?.nodes.find((n) => !n.is_revoked && n.is_online) ?? nodes.data?.nodes.find((n) => !n.is_revoked) ?? null;
  return (
    <Box data-testid="sandbox-connect">
      <PageHead
        title="Подключение управления номером"
        subtitle={
          <>
            Как команда гостя «включить свет» доходит до лампы в номере, и что для этого настроить. Отель: {nodes.data?.hotel ?? '…'} — коннектор настоящий (локально), сервер управления и вход — <Sample />.
          </>
        }
      />
      <VariantBar variants={VARIANTS} value={v} onChange={(key) => go({ v: key, step: null, link: null, run: null })} />
      {v === 'a' ? <Wizard node={node} /> : null}
      {v === 'b' ? <Builder node={node} /> : null}
      {v === 'c' ? <AfterWizard node={node} /> : null}
    </Box>
  );
}

/* ── А: мастер ───────────────────────────────────────────────────────────── */

const STEPS = ['Как это устроено', 'Путь', 'Настройка', 'Проверка', 'Готово'];

function Wizard({ node }: { node: NodeRow | null }) {
  const [params, go] = useGo();
  const step = Number(params.get('step') ?? 0);
  const path = (params.get('path') as Path) || 'connector';
  const active: LinkKey = step === 0 ? 'cloud' : step === 2 ? (path === 'direct' ? 'server' : 'connector') : step >= 3 ? 'device' : 'cloud';
  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1.5 }} data-testid="sandbox-steps">
        {STEPS.map((s, i) => (
          <ButtonBase key={s} onClick={() => go({ step: String(i) })} sx={{ px: 1.25, py: 0.5, borderRadius: `${shape.pill}px`, ...typo.caption, fontWeight: 700, color: i === step ? accent.onAccent : i < step ? accent.soft : ink.mid, bgcolor: i === step ? accent.main : surface.s2, border: `1px solid ${i === step ? accent.main : surface.line}` }}>
            {i + 1}. {s}
          </ButtonBase>
        ))}
      </Box>
      <Panel title={STEPS[step]}>
        <Chain path={path} active={active} compact={step > 0} />
        {step === 0 ? (
          <Box sx={{ ...typo.body, color: ink.mid, display: 'grid', gap: 1, mt: 1 }}>
            <Box>Гость нажимает «Свет» в телефоне. Команда уходит в NaviRoom, оттуда — к серверу управления в отеле (iRidi, Bittel или другому), а он уже включает свет.</Box>
            <Box>Сервер управления стоит в сети отеля, и снаружи его обычно не видно. Поэтому в отеле ставится <b>коннектор</b> — он сам звонит в NaviRoom и держит связь. Если сервер управления открыт наружу, можно и без коннектора.</Box>
          </Box>
        ) : null}
        {step === 1 ? <PathCards path={path} onChange={(p) => go({ path: p })} /> : null}
        {step === 2 ? (
          <Box sx={{ display: 'grid', gap: 2 }}>
            {path !== 'direct' ? <Box><Typography sx={{ ...typo.panelTitle, color: ink.hi, mb: 1 }}>Коннектор</Typography><ConnectorForm node={node} /></Box> : null}
            <Box><Typography sx={{ ...typo.panelTitle, color: ink.hi, mb: 1 }}>Сервер управления</Typography><ServerForm /></Box>
          </Box>
        ) : null}
        {step === 3 ? <Check path={path} run={1} /> : null}
        {step === 4 ? <AfterWizard node={node} embedded /> : null}
        <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
          {step > 0 ? <Button sx={secondaryButtonSx} onClick={() => go({ step: String(step - 1) })}>Назад</Button> : null}
          {step < STEPS.length - 1 ? <Button sx={primaryButtonSx} onClick={() => go({ step: String(step + 1) })} data-testid="sandbox-next">Дальше</Button> : null}
        </Box>
      </Panel>
    </Box>
  );
}

/* ── Б: схема-конструктор ────────────────────────────────────────────────── */

function Builder({ node }: { node: NodeRow | null }) {
  const [params, go] = useGo();
  const path = (params.get('path') as Path) || 'both';
  const link = (params.get('link') as LinkKey) || 'server';
  const states: Partial<Record<LinkKey, LinkState>> = {
    guest: 'ok',
    cloud: 'ok',
    connector: path === 'direct' ? 'off' : node?.is_online ? 'ok' : 'bad',
    server: 'ok',
    device: 'wait',
  };
  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 0.75, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        <Box sx={{ ...typo.label, color: ink.mid }}>Путь</Box>
        {([['both', 'коннектор + сервер'], ['connector', 'только коннектор'], ['direct', 'напрямую']] as const).map(([k, label]) => (
          <ButtonBase key={k} onClick={() => go({ path: k })} sx={{ px: 1.25, py: 0.5, borderRadius: `${shape.pill}px`, ...typo.caption, fontWeight: 700, border: `1px solid ${path === k ? accent.main : surface.line}`, color: path === k ? accent.soft : ink.mid }}>
            {label}
          </ButtonBase>
        ))}
      </Box>
      <Panel title="Цепочка" aside={<Box sx={{ ...typo.caption, color: ink.low }}>щёлкните звено</Box>}>
        <Chain path={path} active={link} states={states} onPick={(k) => go({ link: k })} />
      </Panel>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1.3fr 1fr' }, mt: 2, alignItems: 'start' }}>
        <Panel title={LINKS.find((l) => l.key === link)?.title ?? ''}>
          {link === 'connector' ? (path === 'direct' ? <Box sx={{ ...typo.body, color: ink.mid }}>На этом пути коннектора нет: NaviRoom идёт к серверу управления сам.</Box> : <ConnectorForm node={node} />) : null}
          {link === 'server' ? <ServerForm /> : null}
          {link === 'cloud' ? <Box sx={{ ...typo.body, color: ink.mid }}>Наше облако. Настраивать здесь нечего: оно принимает команды гостя и отдаёт их дальше по цепочке.</Box> : null}
          {link === 'guest' ? <Box sx={{ ...typo.body, color: ink.mid }}>Телефон гостя в номере: вход по QR и PIN номера. Сами PIN — в номерном фонде.</Box> : null}
          {link === 'device' ? <Box sx={{ ...typo.body, color: ink.mid }}>Оборудование номера: что именно умеет каждый номер, задаёт вариант номера (вкладка «Варианты номеров»).</Box> : null}
        </Panel>
        <Panel title="Как сочетаются коннектор и сервер">
          <Box sx={{ ...typo.body, color: ink.mid, display: 'grid', gap: 1 }}>
            <Box><b>Коннектор — дорога.</b> Он один на отель, держит связь с облаком и знает только, как дойти до сети отеля.</Box>
            <Box><b>Сервер управления — куда дорога ведёт.</b> Его адрес, порт, протокол и вход задаются здесь, в Control, и уходят в коннектор сами — на объекте ничего править не нужно.</Box>
            <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
              Сейчас адрес сервера пишется в файл коннектора руками, а пароль сервера коннектор не хранит. <Sample>нужна доработка коннектора</Sample>
            </Box>
          </Box>
        </Panel>
      </Box>
    </Box>
  );
}

/* ── В: экран подключений ────────────────────────────────────────────────── */

function AfterWizard({ node, embedded = false }: { node: NodeRow | null; embedded?: boolean }) {
  const [params, go] = useGo();
  const run = Number(params.get('run') ?? 0);
  const [dialog, setDialog] = useState<null | 'reissue' | 'edit'>(null);
  const card = (title: string, st: LinkState, rows: Array<[string, ReactNode]>, actions: ReactNode, sample = false) => (
    <Box sx={{ ...panelSx, display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Box sx={{ ...typo.panelTitle, color: ink.hi, flex: 1 }}>{title}</Box>
        {sample ? <Sample /> : null}
        <Pill tone={st === 'ok' ? 'ok' : st === 'bad' ? 'bad' : st === 'wait' ? 'warn' : 'muted'}>{STATE_TEXT[st]}</Pill>
      </Box>
      {rows.map(([k, val]) => (
        <Box key={k} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, ...typo.caption, borderBottom: `1px solid ${surface.hair}`, py: 0.4 }}>
          <Box sx={{ color: ink.mid }}>{k}</Box>
          <Box sx={{ color: ink.hi, fontWeight: 700, textAlign: 'right' }}>{val}</Box>
        </Box>
      ))}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>{actions}</Box>
    </Box>
  );
  return (
    <Box data-testid="sandbox-after">
      {!embedded ? (
        <Panel title="Цепочка сейчас">
          <Chain path="both" states={{ guest: 'ok', cloud: 'ok', connector: node?.is_online ? 'ok' : 'bad', server: 'ok', device: 'wait' }} compact />
        </Panel>
      ) : null}
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, mt: embedded ? 0 : 2 }}>
        {card(
          `Коннектор «${node?.name ?? 'Сервер в серверной'}»`,
          node?.is_online ? 'ok' : node ? 'bad' : 'wait',
          [
            ['Последний сигнал', node?.seconds_since_seen != null ? `${node.seconds_since_seen} с назад` : 'ни разу'],
            ['Версия', node?.version || '—'],
            ['Ключ выдан', node?.key_issued_at ? new Date(node.key_issued_at).toLocaleDateString('ru') : '—'],
          ],
          <>
            <Button size="small" sx={secondaryButtonSx} onClick={() => setDialog('reissue')}>Перевыпустить ключ</Button>
          </>,
        )}
        {card(
          'Сервер управления iRidi',
          'ok',
          [
            ['Адрес', '10.10.20.15 : 1085'],
            ['Протокол', 'HTTP'],
            ['Вход', 'без входа'],
            ['Ждать ответа', '3 с'],
          ],
          <Button size="small" sx={secondaryButtonSx} onClick={() => setDialog('edit')}>Изменить</Button>,
          true,
        )}
      </Box>
      <Panel title="Проверка цепочки" aside={<Button size="small" sx={primaryButtonSx} onClick={() => go({ run: String(run + 1) })} data-testid="sandbox-run-check">Проверить</Button>}>
        {run ? <Check path="both" run={run} /> : <Box sx={{ ...typo.body, color: ink.mid }}>«Проверить» пройдёт цепочку по звеньям и скажет, где обрывается и что делать.</Box>}
      </Panel>
      {dialog === 'reissue' ? (
        <MockAction title="Перевыпустить ключ коннектора" onClose={() => setDialog(null)} confirm="Перевыпустить">
          <Box>Старый ключ перестанет действовать сразу — коннектор отключится, пока на сервере отеля не запустят команду с новым ключом.</Box>
        </MockAction>
      ) : null}
      {dialog === 'edit' ? (
        <MockAction title="Сервер управления" onClose={() => setDialog(null)} confirm="Сохранить">
          <ServerForm />
        </MockAction>
      ) : null}
    </Box>
  );
}

