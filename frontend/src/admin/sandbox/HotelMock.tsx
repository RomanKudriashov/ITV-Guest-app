import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { fieldSx, ink, panelSx, primaryButtonSx, secondaryButtonSx, shape, state, surface, typo } from '../adminTokens';
import { AdminDialog } from '../form';
import type { AuditRow } from '../adminClient';
import type { Go } from './SandboxApp';
import { useHotelBundle, type HotelBundle } from './sandboxData';
import { CONNECTION_TITLE, MODULES } from './moduleCatalog';
import { SILENT_AFTER_S, hotelProblems, plural, type HotelTab, type Problem } from './readiness';
import { AddressTabs, DevTag, Dot, KV, Metric, PageHead, Panel, Pill, Sample, Toggle, severityLabel, severityTone } from './ui';

/**
 * МАКЕТЫ 2–4 — КАРТОЧКА ОТЕЛЯ (партия 62).
 *
 * Вкладка — в адресе (`?tab=`): F5 и ссылка открывают ту же. Обзор, профиль
 * и модули нарисованы целиком; остальные вкладки — что в них переезжает.
 */

const TABS: Array<{ key: HotelTab; label: string }> = [
  { key: 'overview', label: 'Обзор' },
  { key: 'profile', label: 'Профиль' },
  { key: 'modules', label: 'Модули' },
  { key: 'connections', label: 'Подключения' },
  { key: 'rooms', label: 'Номерной фонд' },
  { key: 'roomControl', label: 'Управление номером' },
  { key: 'journal', label: 'Журнал' },
  { key: 'data', label: 'Данные' },
];

const PARKED: Partial<Record<HotelTab, string[]>> = {
  connections: [
    'Коннекторы отеля (бывший раздел «On-premise»): на связи ли, когда отвечал, версия.',
    'Выдать ключ, перевыпустить, отозвать — с подтверждением; ключ копируется кнопкой.',
    'PMS, эквайринг, замки — здесь же, когда появятся.',
  ],
  rooms: [
    'Номера, этажи, корпуса и категории — те же, что в панели отеля, для чтения и правки поддержкой.',
    'Вариант управления у каждого номера и массовое назначение варианта.',
  ],
  roomControl: [
    'Варианты (бывшие «типы номеров»), импорт ПНР, конструктор, план, версии, журнал команд.',
    'Уровень экрана: Кнопки / Схема / 3D-план — переключателем, а не только через API.',
  ],
  journal: [
    'Действия по отелю: кто, когда, что поменял — с «было → стало».',
    'Сессии поддержки этого отеля: кто входил, зачем, когда вышел; «Оборвать».',
  ],
  data: ['Выгрузка данных отеля.', 'Отключение по 152-ФЗ и стирание — только владелец, с вводом поддомена.'],
};

export function HotelMock({ id, go }: { id: string; go: Go }) {
  const [params] = useSearchParams();
  const tab = (params.get('tab') as HotelTab) || 'overview';
  const { bundle: live } = useHotelBundle(id);
  /*
    СЦЕНАРИЙ «КОННЕКТОР МОЛЧИТ» (`?demo=offline`): у демо-отелей красных
    проблем нет, а макет должен показать важность цветом. Подменяется только
    отметка узла, и экран об этом говорит.
  */
  const scenario = params.get('demo') === 'offline';
  const bundle =
    live && scenario
      ? { ...live, nodes: live.nodes.map((n) => ({ ...n, is_online: false, seconds_since_seen: 640 })) }
      : live;
  const problems = bundle ? hotelProblems(bundle) : [];
  const realProblems = problems.filter((p) => !p.sample);

  if (!bundle) return <Panel><Box sx={{ ...typo.body, color: ink.mid }}>Загружаем отель…</Box></Panel>;
  const p = bundle.profile;

  return (
    <Box>
      <PageHead
        title={p.name}
        subtitle={
          <Box component="span" sx={{ display: 'inline-flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            {p.subdomain}
            {p.city ? ` · ${p.city}` : ''}
            {p.is_active ? <Pill tone={realProblems.some((x) => x.severity === 'bad') ? 'bad' : realProblems.length ? 'warn' : 'ok'}>{realProblems.length ? `${realProblems.length} ${plural(realProblems.length, 'проблема', 'проблемы', 'проблем')}` : 'готов'}</Pill> : <Pill tone="muted">отключён</Pill>}
          </Box>
        }
        actions={<Button sx={secondaryButtonSx}>Войти в панель отеля →</Button>}
      />
      {scenario ? (
        <Box sx={{ mb: 1.5, ...typo.caption, color: state.bad, fontWeight: 700 }}>
          Сценарий макета: коннектор отеля будто бы молчит 10 минут (на деле он на связи).
        </Box>
      ) : null}
      <AddressTabs
        tabs={TABS.map((t) => (t.key === 'overview' && realProblems.length ? { ...t, badge: realProblems.length, tone: realProblems.some((x) => x.severity === 'bad') ? 'bad' : 'warn' } : t))}
        active={tab}
        onChange={(key) => go({ tab: key, dialog: null })}
      />
      {tab === 'overview' ? <Overview bundle={bundle} problems={problems} go={go} /> : null}
      {tab === 'profile' ? <Profile bundle={bundle} /> : null}
      {tab === 'modules' ? <HotelModules bundle={bundle} go={go} /> : null}
      {PARKED[tab] ? (
        <Panel title={TABS.find((t) => t.key === tab)?.label}>
          <Typography sx={{ ...typo.caption, color: ink.mid, mb: 1 }}>В этой партии не макетируется — что сюда переезжает:</Typography>
          {PARKED[tab]!.map((line) => (
            <Box key={line} sx={{ ...typo.body, color: ink.hi, display: 'flex', gap: 1, py: 0.5 }}>
              <Box sx={{ color: ink.low }}>•</Box>
              {line}
            </Box>
          ))}
        </Panel>
      ) : null}
    </Box>
  );
}

/* ── Обзор ──────────────────────────────────────────────────────────────── */

/** Правило → как оно звучит, когда пройдено. */
const RULES: Array<[string, string]> = [
  ['module_without_connection', 'У включённых модулей есть подключение'],
  ['connector_silent', 'Коннектор на связи'],
  ['rooms_without_variant', 'У всех номеров есть вариант управления'],
  ['variant_unpublished', 'Варианты опубликованы'],
  ['failed_commands', 'Команды проходят'],
  ['no_menu_service', 'Есть сервис с меню и местом подачи'],
  ['rooms_without_pin', 'У номеров есть PIN'],
  ['admin_never_logged_in', 'Администратор входил'],
];

function Overview({ bundle, problems, go }: { bundle: HotelBundle; problems: Problem[]; go: Go }) {
  const [params] = useSearchParams();
  const [dialog, setDialog] = useState(params.get('dialog'));
  const p = bundle.profile;
  const roomControl = bundle.modules.find((m) => m.code === 'room_control')?.is_enabled;
  const bound = new Set(bundle.types.flatMap((t) => t.rooms)).size;
  const node = bundle.nodes.find((n) => !n.is_revoked);
  const day = Date.now() - 24 * 3600 * 1000;
  const recent = bundle.diagnostics.filter((r) => Date.parse(r.at) >= day);
  const failed = recent.filter((r) => r.result && !['ok', 'confirmed', 'accepted'].includes(r.result));
  const services = bundle.usage?.rows.find((r) => r.key === 'services')?.used;
  const failing = new Set(problems.map((x) => x.code.split(':')[0]));
  const roomRules = new Set(['rooms_without_variant', 'variant_unpublished', 'failed_commands', 'rooms_without_pin']);
  const passed = RULES.filter(([code]) => !failing.has(code) && (roomControl || !roomRules.has(code))).map(([, ok]) => ok);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(5, 1fr)' } }}>
        <Metric label="Номера" value={p.counts.rooms} hint={roomControl ? `с вариантом управления — ${bound}` : 'управление номером выключено'} />
        <Metric label="Персонал" value={p.counts.staff} hint={`${bundle.admins.length} ${plural(bundle.admins.length, 'администратор', 'администратора', 'администраторов')}`} />
        <Metric label="Сервисы" value={services ?? '—'} hint={`позиций в меню — ${p.counts.items}`} />
        <Metric
          label="Коннектор"
          value={node ? (node.is_online ? 'на связи' : 'молчит') : 'нет'}
          tone={node ? (node.seconds_since_seen != null && node.seconds_since_seen <= SILENT_AFTER_S ? 'ok' : 'bad') : 'muted'}
          hint={node ? `отвечал ${node.seconds_since_seen ?? '—'} с назад` : 'не заведён'}
        />
        <Metric
          label="Команды за сутки"
          value={roomControl ? `${recent.length - failed.length} / ${recent.length}` : '—'}
          tone={failed.length >= 10 ? 'warn' : undefined}
          hint={roomControl ? `неудачных — ${failed.length}` : 'модуль выключен'}
        />
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' }, alignItems: 'start' }}>
        <Panel title="Что мешает отелю работать" aside={<Typography sx={{ ...typo.caption, color: ink.low }}>сервер, обновление раз в минуту</Typography>}>
          {problems.length ? (
            <Box sx={{ display: 'grid', gap: 1 }}>
              {problems.map((x) => (
                <ProblemRow key={x.code} problem={x} onFix={() => go({ tab: x.fix, dialog: null })} />
              ))}
            </Box>
          ) : (
            <Box sx={{ ...typo.body, color: state.ok }}>Проблем нет — отель готов к гостям.</Box>
          )}
          {passed.length ? (
            <Box sx={{ mt: 2, pt: 1.5, borderTop: `1px solid ${surface.hair}` }}>
              <Typography sx={{ ...typo.label, color: ink.mid, mb: 0.75 }}>Пройдено</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {passed.map((rule) => (
                  <Box key={rule} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, ...typo.caption, color: ink.mid }}>
                    <Dot tone="ok" /> {rule}
                  </Box>
                ))}
              </Box>
            </Box>
          ) : null}
        </Panel>

        <Box sx={{ display: 'grid', gap: 2 }}>
          <Panel title="Включено">
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {bundle.modules.filter((m) => m.is_enabled).map((m) => {
                const c = MODULES.find((x) => x.code === m.code);
                return <Pill key={m.code} tone={c?.status === 'ready' ? 'info' : 'muted'}>{c?.title ?? m.code}</Pill>;
              })}
              {!bundle.modules.some((m) => m.is_enabled) ? <Box sx={{ ...typo.caption, color: ink.low }}>Ни одного модуля</Box> : null}
            </Box>
            <Button size="small" sx={{ ...secondaryButtonSx, mt: 1.5 }} onClick={() => go({ tab: 'modules' })}>Модули →</Button>
          </Panel>
          <Panel title="Опасная зона">
            <Typography sx={{ ...typo.caption, color: ink.mid, mb: 1.5 }}>
              Отключение закрывает отель для гостей и персонала, данные сохраняются.
            </Typography>
            <Button sx={{ ...secondaryButtonSx, color: state.bad, borderColor: state.bad }} onClick={() => setDialog('disable')}>
              Отключить отель…
            </Button>
          </Panel>
        </Box>
      </Box>

      {dialog === 'disable' ? <DisableDialog name={p.name} onClose={() => setDialog(null)} /> : null}
    </Box>
  );
}

function ProblemRow({ problem, onFix }: { problem: Problem; onFix: () => void }) {
  const tone = severityTone[problem.severity];
  return (
    <Box
      data-testid={`sandbox-problem-${problem.code.split(':')[0]}`}
      sx={{
        display: 'flex',
        gap: 1.5,
        alignItems: { xs: 'flex-start', sm: 'center' },
        flexDirection: { xs: 'column', sm: 'row' },
        p: 1.25,
        pl: 1.5,
        borderRadius: `${shape.radius}px`,
        bgcolor: surface.s1,
        border: `1px solid ${surface.hair}`,
        borderLeft: `4px solid ${state[tone]}`,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}>{problem.title}</Box>
          <Pill tone={tone}>{severityLabel[problem.severity]}</Pill>
          {problem.sample ? <Sample /> : null}
        </Box>
        <Box sx={{ ...typo.caption, color: ink.mid, mt: 0.25 }}>{problem.detail}</Box>
      </Box>
      <Button size="small" sx={problem.severity === 'bad' ? primaryButtonSx : secondaryButtonSx} onClick={onFix}>
        {problem.fixLabel} →
      </Button>
    </Box>
  );
}

function DisableDialog({ name, onClose }: { name: string; onClose: () => void }) {
  return (
    <AdminDialog
      testId="sandbox-disable"
      title={`Отключить ${name.includes('«') ? name : `«${name}»`}?`}
      subtitle="Данные, настройки и номера сохранятся. Включить обратно можно в любой момент."
      onClose={onClose}
      maxWidth="sm"
      actions={
        <>
          <Button sx={{ color: ink.mid }} onClick={onClose}>Отмена</Button>
          <Button sx={{ ...primaryButtonSx, bgcolor: state.bad }} disabled>Отключить</Button>
        </>
      }
    >
      <Box sx={{ display: 'grid', gap: 2 }}>
        <TextField label="Причина — видна в журнале и отелю" required multiline minRows={2} sx={fieldSx} placeholder="Например: неоплата за октябрь" />
        <TextField label="Включить автоматически (необязательно)" placeholder="дд.мм.гггг" sx={fieldSx} slotProps={{ inputLabel: { shrink: true } }} helperText="Пусто — отель останется выключенным, пока его не включат руками." />
        <Box sx={{ p: 1.5, borderRadius: `${shape.radius}px`, bgcolor: surface.s2 }}>
          <Typography sx={{ ...typo.label, color: ink.mid, mb: 1 }}>Что закроется</Typography>
          {[
            ['Гость', 'вместо витрины — «Отель временно не принимает заказы»; заказы, чат и управление номером закрыты; сессии гостей завершаются'],
            ['Персонал', 'выход из панели, трекера и стойки; вход закрыт до включения'],
            ['Панель', 'ссылки и QR ведут на ту же заглушку; уведомления в Telegram не уходят'],
            ['Номер', 'команды на оборудование не отправляются; коннектор остаётся подключённым'],
          ].map(([who, what]) => (
            <Box key={who} sx={{ display: 'grid', gridTemplateColumns: '84px 1fr', gap: 1, py: 0.4, ...typo.caption }}>
              <Box sx={{ fontWeight: 700, color: ink.hi }}>{who}</Box>
              <Box sx={{ color: ink.mid }}>{what}</Box>
            </Box>
          ))}
        </Box>
      </Box>
    </AdminDialog>
  );
}

/* ── Профиль ────────────────────────────────────────────────────────────── */

const OWNER_ONLY = <Pill tone="gold">только владелец</Pill>;

const CONSEQUENCES: Record<string, { title: string; lines: string[]; confirm: string }> = {
  subdomain: {
    title: 'Сменить поддомен?',
    lines: [
      'Все QR-коды в номерах и на столах ведут на старый адрес — их придётся перепечатать.',
      'Старый адрес 90 дней перенаправляет на новый, затем освобождается.',
      'Сотрудники и гости выйдут и войдут заново по новому адресу.',
    ],
    confirm: 'Введите новый поддомен ещё раз',
  },
  currency: {
    title: 'Сменить валюту?',
    lines: [
      'Цены хранятся числами — пересчёта не будет: 1 500 ₽ станут 1 500 €.',
      'Открытые заказы и корзины гостей останутся в старой валюте.',
      'Знаков после запятой — отдельное поле, меняется только явно.',
    ],
    confirm: 'Понимаю, цены не пересчитаются',
  },
  timezone: {
    title: 'Сменить часовой пояс?',
    lines: [
      'Часы работы заведений и расписания сдвинутся: «с 08:00» станет 08:00 по новому поясу.',
      'Отчёты «за сегодня» начнут считать сутки по новому поясу.',
      'Время в журналах не меняется — оно хранится в UTC.',
    ],
    confirm: 'Понимаю, часы сдвинутся',
  },
};

function Profile({ bundle }: { bundle: HotelBundle }) {
  const [params] = useSearchParams();
  const [dialog, setDialog] = useState(params.get('dialog'));
  const p = bundle.profile;
  const edit = (key: string) => (
    <Button size="small" sx={{ ...secondaryButtonSx, ml: 1, py: 0, minHeight: 28 }} onClick={() => setDialog(key)}>Изменить…</Button>
  );
  const consequence = dialog ? CONSEQUENCES[dialog] : undefined;

  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '3fr 2fr' }, alignItems: 'start' }}>
      <Box sx={{ display: 'grid', gap: 2 }}>
        <Panel title="Название и город" aside={<Typography sx={{ ...typo.caption, color: ink.low }}>по языкам отеля</Typography>}>
          {p.languages.map((lang) => (
            <KV key={lang.code} label={`${lang.title}${lang.is_default ? ' · основной' : ''}`}>
              <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
                <TextField size="small" label="Название" slotProps={{ inputLabel: { shrink: true } }} defaultValue={lang.is_default ? p.name : ''} placeholder="перевод не задан" sx={fieldSx} />
                <TextField size="small" label="Город" slotProps={{ inputLabel: { shrink: true } }} defaultValue={lang.is_default ? (p.city ?? '') : ''} placeholder="перевод не задан" sx={fieldSx} />
              </Box>
            </KV>
          ))}
        </Panel>
        <Panel title="Регион и деньги">
          <KV label="Часовой пояс" note="Часы заведений и «сегодня» в отчётах">{p.timezone}{edit('timezone')}</KV>
          <KV label="Валюта" note="Цены не пересчитываются">{p.currency}{edit('currency')}</KV>
          <KV label="Знаков после запятой" note="2 — копейки, 0 — без дробной части">{p.currency_minor_units}</KV>
          <KV label="Языки">
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {p.languages.map((l) => <Pill key={l.code} tone={l.is_default ? 'info' : 'muted'}>{l.title}{l.is_default ? ' · основной' : ''}</Pill>)}
            </Box>
          </KV>
        </Panel>
        <Panel title="Адрес и сеть">
          <KV label="Поддомен" note="На него ведут QR-коды">
            <Box component="span" sx={{ fontFamily: 'monospace' }}>{p.subdomain}</Box> {OWNER_ONLY}{edit('subdomain')}
          </KV>
          <KV label="Свой домен" note="Например, guest.hotel.ru — нужен сертификат">
            <Box component="span" sx={{ color: ink.low }}>не задан</Box> {OWNER_ONLY}
          </KV>
          <KV label="Сеть"><Box sx={{ display: 'inline-flex', gap: 1, alignItems: 'center' }}>NaviRoom Демо <Sample /></Box></KV>
        </Panel>
        <Panel title="Администраторы" aside={<Button size="small" sx={secondaryButtonSx}>+ Добавить</Button>}>
          {bundle.admins.map((a) => (
            <Box key={a.id} sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', py: 1, borderBottom: `1px solid ${surface.hair}` }}>
              <Box sx={{ flex: '1 1 200px', minWidth: 0 }}>
                <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi, overflowWrap: 'anywhere' }}>{a.email}</Box>
                <Box sx={{ ...typo.caption, color: a.last_login ? ink.mid : state.warn }}>
                  {a.last_login ? `входил ${new Date(a.last_login).toLocaleDateString('ru-RU')}` : 'ни разу не входил'}
                </Box>
              </Box>
              <Button size="small" sx={secondaryButtonSx}>Выслать пароль</Button>
              <Button size="small" sx={{ color: ink.mid }}>Снять права…</Button>
            </Box>
          ))}
        </Panel>
      </Box>

      <Panel title="История правок" aside={<Typography sx={{ ...typo.caption, color: ink.low }}>было → стало</Typography>}>
        <History rows={bundle.history} />
      </Panel>

      {consequence ? (
        <AdminDialog
          testId={`sandbox-consequence-${dialog}`}
          title={consequence.title}
          subtitle="Это изменение затрагивает гостей и персонал — прочитайте, что произойдёт."
          onClose={() => setDialog(null)}
          actions={
            <>
              <Button sx={{ color: ink.mid }} onClick={() => setDialog(null)}>Отмена</Button>
              <Button sx={primaryButtonSx} disabled>Сохранить</Button>
            </>
          }
        >
          <Box sx={{ display: 'grid', gap: 1.5 }}>
            <TextField
              label={dialog === 'subdomain' ? 'Новый поддомен' : dialog === 'currency' ? 'Новая валюта' : 'Новый пояс'}
              defaultValue={dialog === 'subdomain' ? `${p.subdomain}-hotel` : dialog === 'currency' ? 'EUR' : 'Europe/Kaliningrad'}
              sx={fieldSx}
            />
            <Box sx={{ p: 1.5, borderRadius: `${shape.radius}px`, bgcolor: surface.s2, borderLeft: `4px solid ${state.warn}` }}>
              {consequence.lines.map((line) => (
                <Box key={line} sx={{ ...typo.caption, color: ink.hi, display: 'flex', gap: 1, py: 0.3 }}>
                  <Box sx={{ color: state.warn }}>!</Box>
                  {line}
                </Box>
              ))}
            </Box>
            <TextField size="small" label={consequence.confirm} sx={fieldSx} />
          </Box>
        </AdminDialog>
      ) : null}
    </Box>
  );
}

const FIELD_TITLE: Record<string, string> = {
  name: 'Название',
  city: 'Город',
  timezone: 'Часовой пояс',
  currency: 'Валюта',
  currency_minor_units: 'Знаков после запятой',
  languages: 'Языки',
};

const SAMPLE_HISTORY: Array<{ at: string; actor: string; field: string; from: string; to: string }> = [
  { at: '2026-10-14T09:12:00Z', actor: 'platform@itv.local', field: 'timezone', from: 'Europe/Kaliningrad', to: 'Europe/Moscow' },
  { at: '2026-10-02T16:40:00Z', actor: 'support@itv.local', field: 'name', from: 'Кристалл', to: 'Отель «Кристалл»' },
  { at: '2026-09-21T11:05:00Z', actor: 'platform@itv.local', field: 'languages', from: 'ru, en', to: 'ru, en, ar, zh' },
];

function show(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).join(', ');
  return String(value);
}

function History({ rows }: { rows: AuditRow[] }) {
  const real = rows.flatMap((row) =>
    Object.entries((row.payload.changes ?? {}) as Record<string, { from: unknown; to: unknown }>).map(([field, change]) => ({
      at: row.at,
      actor: row.actor,
      field,
      from: show(change.from),
      to: show(change.to),
    })),
  );
  const items = (real.length ? real : SAMPLE_HISTORY).slice(0, 8);
  return (
    <Box>
      {!real.length ? (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1, ...typo.caption, color: ink.mid }}>
          <Sample /> правок профиля у этого отеля ещё не было
        </Box>
      ) : null}
      {items.map((item, i) => (
        <Box key={i} sx={{ py: 1, borderBottom: `1px solid ${surface.hair}` }}>
          <Box sx={{ ...typo.caption, color: ink.low }}>
            {new Date(item.at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} · {item.actor}
          </Box>
          <Box sx={{ ...typo.body, color: ink.hi, mt: 0.25 }}>
            <Box component="span" sx={{ fontWeight: 700 }}>{FIELD_TITLE[item.field] ?? item.field}: </Box>
            <Box component="span" sx={{ color: ink.mid, textDecoration: 'line-through' }}>{item.from}</Box>
            {' → '}
            <Box component="span">{item.to}</Box>
          </Box>
        </Box>
      ))}
      <Button size="small" sx={{ ...secondaryButtonSx, mt: 1.5 }}>Весь журнал отеля →</Button>
    </Box>
  );
}

/* ── Модули отеля ───────────────────────────────────────────────────────── */

function HotelModules({ bundle, go }: { bundle: HotelBundle; go: Go }) {
  const live = bundle.nodes.filter((n) => !n.is_revoked);
  const hasConnection = (needs?: string) =>
    !needs ? true : needs === 'grms' ? live.some((n) => n.purpose !== 'pms') : needs === 'pms' ? live.some((n) => n.purpose !== 'grms') : false;
  const ready = MODULES.filter((m) => m.status === 'ready');
  const dev = MODULES.filter((m) => m.status === 'dev');

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
        {ready.map((m) => {
          const entry = bundle.modules.find((x) => x.code === m.code);
          const on = Boolean(entry?.is_enabled);
          const linked = hasConnection(m.needs);
          return (
            <ModuleCard
              key={m.code}
              title={m.title}
              gives={m.gives}
              toggle={<Toggle checked={on} label={m.title} />}
              status={
                !on ? <Pill tone="muted">выключен</Pill> : linked ? <Pill tone="ok">работает</Pill> : <Pill tone="bad">включён, но не работает</Pill>
              }
            >
              {m.needs ? (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', ...typo.caption, color: linked ? ink.mid : state.bad }}>
                  <Dot tone={linked ? 'ok' : 'bad'} />
                  {linked ? `Подключение есть: ${CONNECTION_TITLE[m.needs]}` : `Нужно подключение: ${CONNECTION_TITLE[m.needs]}`}
                  {!linked ? <Button size="small" sx={secondaryButtonSx} onClick={() => go({ tab: 'connections' })}>Подключить…</Button> : null}
                </Box>
              ) : null}
              <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
                <Button size="small" sx={secondaryButtonSx} disabled={!on}>Настроить</Button>
                <Button size="small" sx={{ color: ink.mid }} onClick={() => go({ s: 'modules', hotel: null, tab: null, module: m.code })}>О модуле</Button>
              </Box>
            </ModuleCard>
          );
        })}
      </Box>
      <Panel title="В разработке" aside={<Typography sx={{ ...typo.caption, color: ink.low }}>включить нельзя — выключателя нет</Typography>}>
        <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' } }}>
          {dev.map((m) => {
            const on = bundle.modules.find((x) => x.code === m.code)?.is_enabled;
            return (
              <Box key={m.code} sx={{ p: 1.25, borderRadius: `${shape.radius}px`, border: `1px dashed ${surface.line}`, opacity: 0.85 }}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}>{m.title}</Box>
                  <DevTag />
                </Box>
                <Box sx={{ ...typo.caption, color: ink.mid, mt: 0.5 }}>{m.gives}</Box>
                {on ? (
                  <Box sx={{ ...typo.caption, color: state.warn, mt: 0.75 }}>
                    Сейчас включён в старой консоли, но ничего не делает — при переходе выключится.
                  </Box>
                ) : null}
              </Box>
            );
          })}
        </Box>
      </Panel>
    </Box>
  );
}

function ModuleCard({ title, gives, toggle, status, children }: { title: string; gives: string; toggle: ReactNode; status: ReactNode; children?: ReactNode }) {
  return (
    <Box sx={{ ...panelSx }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Typography component="h3" sx={{ ...typo.panelTitle, color: ink.hi, flex: 1 }}>{title}</Typography>
        {status}
        {toggle}
      </Box>
      <Typography sx={{ ...typo.body, color: ink.mid, mt: 0.5, mb: 1 }}>{gives}</Typography>
      {children}
    </Box>
  );
}

