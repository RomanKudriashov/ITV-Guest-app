import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ViewModuleOutlinedIcon from '@mui/icons-material/ViewModuleOutlined';
import ViewListOutlinedIcon from '@mui/icons-material/ViewListOutlined';

import { fieldSx, ink, panelSx, primaryButtonSx, secondaryButtonSx, shape, state, surface, typo } from '../adminTokens';
import { AdminDialog } from '../form';
import { getAudit, type AuditRow } from '../adminClient';
import type { Go } from './SandboxApp';
import { useHotelBundle, type HotelBundle } from './sandboxData';
import { CONNECTION_TITLE, MODULES, type CatalogModule } from './moduleCatalog';
import { SILENT_AFTER_S, hotelProblems, plural, type HotelTab, type Problem } from './readiness';
import { FilterBar, passes, useFilters } from './FilterBar';
import { currencyLabel, dateTime, languageLabel, timezoneLabel } from './words';
import { AddressTabs, DevTag, Dot, Empty, Help, Hl, KV, Metric, PageHead, Panel, Pill, Sample, Toggle, ViewSwitch, severityLabel, severityTone } from './ui';

/**
 * МАКЕТЫ 2–4 — КАРТОЧКА ОТЕЛЯ (партия 62, второй заход).
 *
 * Вкладка — в адресе (`?tab=`): F5 и ссылка открывают ту же. Обзор,
 * профиль, модули и история нарисованы целиком; остальные вкладки — что в
 * них переезжает. У каждой вкладки строка «что это и что будет», у каждой
 * настройки — «?» с подробностью.
 */

const TABS: Array<{ key: HotelTab; label: string; about: string }> = [
  { key: 'overview', label: 'Обзор', about: 'Что мешает отелю работать прямо сейчас и что с этим сделать. Проверки обновляются раз в минуту.' },
  { key: 'profile', label: 'Профиль', about: 'Название, адрес, регион и деньги, администраторы. Опасные правки попросят подтверждения и расскажут о последствиях.' },
  { key: 'modules', label: 'Модули', about: 'Что включено у отеля. Модуль, которому нужно подключение, без него не работает — карточка подскажет.' },
  { key: 'connections', label: 'Подключения', about: 'Коннектор на сервере отеля и другие внешние системы.' },
  { key: 'rooms', label: 'Номерной фонд', about: 'Номера, этажи, категории и вариант управления у каждого номера.' },
  { key: 'roomControl', label: 'Управление номером', about: 'Варианты номеров, план, версии и журнал команд оборудования.' },
  { key: 'history', label: 'История', about: 'Кто, что и когда поменял у этого отеля — с тем, что было и что стало.' },
  { key: 'journal', label: 'Журнал', about: 'Входы поддержки в панель отеля и служебные события.' },
  { key: 'data', label: 'Данные', about: 'Выгрузка данных отеля и удаление по закону о персональных данных.' },
];

const PARKED: Partial<Record<HotelTab, string[]>> = {
  connections: [
    'Коннекторы отеля (бывший раздел «On-premise»): на связи ли, когда отвечал, версия программы.',
    'Выдать ключ, перевыпустить, отозвать — с подтверждением; ключ копируется кнопкой.',
    'Система управления отелем, оплата, замки — здесь же, когда появятся.',
  ],
  rooms: [
    'Номера, этажи, корпуса и категории — те же, что в панели отеля.',
    'Вариант управления у каждого номера и назначение варианта сразу многим номерам.',
  ],
  roomControl: [
    'Варианты (бывшие «типы номеров»), загрузка файла пусконаладки, конструктор, план, версии, журнал команд.',
    'Вид экрана гостя: «Кнопки», «Схема», «3D-план» — переключателем.',
  ],
  journal: ['Входы поддержки в панель отеля: кто, зачем, когда вышел; «Оборвать».', 'Служебные события отеля.'],
  data: ['Выгрузка данных отеля.', 'Удаление по закону о персональных данных — только владелец, с вводом поддомена.'],
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
    live && scenario ? { ...live, nodes: live.nodes.map((n) => ({ ...n, is_online: false, seconds_since_seen: 640 })) } : live;
  const problems = bundle ? hotelProblems(bundle) : [];
  const real = problems.filter((p) => !p.sample);
  const anyBad = real.some((x) => x.severity === 'bad');

  if (!bundle) return <Panel><Box sx={{ ...typo.body, color: ink.mid }}>Загружаем отель…</Box></Panel>;
  const p = bundle.profile;
  const current = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <Box>
      <PageHead
        title={p.name}
        subtitle={
          <Box component="span" sx={{ display: 'inline-flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            {p.subdomain}
            {p.city ? ` · ${p.city}` : ''}
            {p.is_active ? (
              <Pill tone={anyBad ? 'bad' : real.length ? 'warn' : 'ok'}>
                {real.length ? `${real.length} ${plural(real.length, 'проблема', 'проблемы', 'проблем')}` : 'готов'}
              </Pill>
            ) : (
              <Pill tone="muted">отключён</Pill>
            )}
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
        tabs={TABS.map((t) => (t.key === 'overview' && real.length ? { ...t, badge: real.length, tone: anyBad ? 'bad' : 'warn' } : t))}
        active={tab}
        onChange={(key) => go({ tab: key, dialog: null, q: null, who: null, what: null, period: null, mstate: null, view: null })}
      />
      <Typography sx={{ ...typo.body, color: ink.mid, mt: -0.5, mb: 2 }}>{current.about}</Typography>

      {tab === 'overview' ? <Overview bundle={bundle} problems={problems} go={go} /> : null}
      {tab === 'profile' ? <Profile bundle={bundle} /> : null}
      {tab === 'modules' ? <HotelModules bundle={bundle} go={go} /> : null}
      {tab === 'history' ? <History id={id} go={go} /> : null}
      {PARKED[tab] ? (
        <Panel title={current.label}>
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
  const silent = node && (node.seconds_since_seen == null || node.seconds_since_seen > SILENT_AFTER_S);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(5, 1fr)' } }}>
        <Metric label="Номера" value={p.counts.rooms} hint={roomControl ? `с вариантом управления — ${bound}` : 'управление номером выключено'} />
        <Metric label="Персонал" value={p.counts.staff} hint={`${bundle.admins.length} ${plural(bundle.admins.length, 'администратор', 'администратора', 'администраторов')}`} />
        <Metric label="Сервисы" value={services ?? '—'} hint={`позиций в меню — ${p.counts.items}`} />
        <Metric
          label="Коннектор"
          value={node ? (silent ? 'молчит' : 'на связи') : 'нет'}
          tone={node ? (silent ? 'bad' : 'ok') : 'muted'}
          hint={node ? `последний ответ — ${node.seconds_since_seen ?? '—'} с назад` : 'не заведён'}
        />
        <Metric
          label="Команды за сутки"
          value={roomControl ? `${recent.length - failed.length} из ${recent.length}` : '—'}
          tone={failed.length >= 10 ? 'warn' : undefined}
          hint={roomControl ? `прошли; неудачных — ${failed.length}` : 'модуль выключен'}
        />
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' }, alignItems: 'start' }}>
        <Panel
          title="Что мешает отелю работать"
          aside={
            <Box sx={{ ...typo.caption, color: ink.low, display: 'inline-flex', alignItems: 'center' }}>
              обновляется раз в минуту
              <Help>Проверки считает сервер. Красная — гость уже сейчас чего-то не может; жёлтая — скоро может стать красной; синяя — стоит проверить. Кнопка справа ведёт туда, где это исправляют.</Help>
            </Box>
          }
        >
          {problems.length ? (
            <Box sx={{ display: 'grid', gap: 1 }}>
              {problems.map((x) => (
                <ProblemRow key={x.code} problem={x} onFix={() => go({ tab: x.fix, dialog: null })} />
              ))}
            </Box>
          ) : (
            <Empty title="Проблем нет">Отель готов к гостям. Если что-то сломается, проверка появится здесь в течение минуты.</Empty>
          )}
          {passed.length ? (
            <Box sx={{ mt: 2, pt: 1.5, borderTop: `1px solid ${surface.hair}` }}>
              <Typography sx={{ ...typo.label, color: ink.mid, mb: 0.75 }}>Пройдено</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25 }}>
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
              {!bundle.modules.some((m) => m.is_enabled) ? <Box sx={{ ...typo.caption, color: ink.low }}>Ни одного модуля — гость видит только меню и заказы.</Box> : null}
            </Box>
            <Button size="small" sx={{ ...secondaryButtonSx, mt: 1.5 }} onClick={() => go({ tab: 'modules' })}>Модули →</Button>
          </Panel>
          <Panel title="Отключение отеля">
            <Typography sx={{ ...typo.caption, color: ink.mid, mb: 1.5 }}>
              Закрывает отель для гостей и сотрудников; данные и настройки сохраняются, включить можно в любой момент.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button sx={{ ...secondaryButtonSx, color: state.bad, borderColor: state.bad }} onClick={() => setDialog('disable')}>
                Отключить отель…
              </Button>
              <Button sx={{ color: ink.mid }} onClick={() => go({ s: 'preview', screen: 'guest', tab: null })}>Что увидят гость и сотрудник</Button>
            </Box>
          </Panel>
        </Box>
      </Box>

      {dialog === 'disable' ? <DisableDialog name={p.name} onClose={() => setDialog(null)} onPreview={() => go({ s: 'preview', screen: 'guest', tab: null, dialog: null })} /> : null}
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

function DisableDialog({ name, onClose, onPreview }: { name: string; onClose: () => void; onPreview: () => void }) {
  return (
    <AdminDialog
      testId="sandbox-disable"
      title={`Отключить ${name.includes('«') ? name : `«${name}»`}?`}
      subtitle="Данные, настройки и номера сохранятся. Включить обратно можно в любой момент."
      onClose={onClose}
      maxWidth="sm"
      actions={
        <>
          <Button sx={{ color: ink.mid, mr: 'auto' }} onClick={onPreview}>Показать экраны</Button>
          <Button sx={{ color: ink.mid }} onClick={onClose}>Отмена</Button>
          <Button sx={{ ...primaryButtonSx, bgcolor: state.bad }} disabled>Отключить</Button>
        </>
      }
    >
      <Box sx={{ display: 'grid', gap: 2 }}>
        <TextField
          label="Причина"
          required
          multiline
          minRows={2}
          sx={fieldSx}
          placeholder="Например: неоплата за октябрь"
          helperText="Видна только здесь, в Control. Отелю, гостям и сотрудникам причину не показываем."
        />
        <TextField
          label="Включить автоматически"
          placeholder="дд.мм.гггг"
          sx={fieldSx}
          slotProps={{ inputLabel: { shrink: true } }}
          helperText="Необязательно. Пусто — отель останется отключённым, пока его не включат руками."
        />
        <Box sx={{ p: 1.5, borderRadius: `${shape.radius}px`, bgcolor: surface.s2 }}>
          <Typography sx={{ ...typo.label, color: ink.mid, mb: 1 }}>Что произойдёт</Typography>
          {[
            ['Гость', 'вместо витрины — экран в бренде отеля «Отель временно не принимает заказы»; заказы и чат закрыты; команды номера не уходят'],
            ['Сотрудники', 'открытые входы завершаются; форма входа видна, но войти нельзя — «Вход недоступен», без причины'],
            ['Номер', 'команды на оборудование не отправляются; коннектор остаётся подключённым'],
            ['Control', 'отель в списке с пометкой «отключён», причиной, кем и когда'],
          ].map(([who, what]) => (
            <Box key={who} sx={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 1, py: 0.4, ...typo.caption }}>
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

const CONSEQUENCES: Record<string, { title: string; lines: string[]; confirm: string; field: string; value: string }> = {
  subdomain: {
    title: 'Сменить поддомен?',
    lines: [
      'QR-коды в номерах и на столах ведут на старый адрес. Старый адрес будет перенаправлять на новый, пока перенаправление не уберут вручную — перепечатывать QR не обязательно.',
      'Сотрудники и гости выйдут и войдут заново по новому адресу.',
      'Ссылки в письмах и закладках продолжат работать через перенаправление.',
    ],
    confirm: 'Введите новый поддомен ещё раз',
    field: 'Новый поддомен',
    value: 'crystal-hotel',
  },
  currency: {
    title: 'Сменить валюту?',
    lines: [
      'Цены хранятся числами — пересчёта не будет: 1 500 ₽ станут 1 500 €.',
      'Открытые заказы и корзины гостей останутся в прежней валюте.',
      'Знаков после запятой — отдельная настройка, она не меняется сама.',
    ],
    confirm: 'Напишите «понимаю»',
    field: 'Новая валюта',
    value: 'Евро, €',
  },
  timezone: {
    title: 'Сменить часовой пояс?',
    lines: [
      'Часы работы заведений и расписания сдвинутся: «с 08:00» станет 08:00 по новому поясу.',
      'Отчёты «за сегодня» начнут считать сутки по новому поясу.',
      'Время в журналах не изменится — оно хранится независимо от пояса.',
    ],
    confirm: 'Напишите «понимаю»',
    field: 'Новый часовой пояс',
    value: 'Калининград, UTC+2',
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
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, alignItems: 'start' }}>
      <Panel
        title="Название и город"
        aside={<Box sx={{ ...typo.caption, color: ink.low, display: 'inline-flex', alignItems: 'center' }}>на каждом языке отеля<Help>Гость видит название и город на своём языке. Пустой перевод — гость увидит основной язык.</Help></Box>}
      >
        {p.languages.map((lang) => (
          <KV key={lang.code} label={`${languageLabel(lang.code)}${lang.is_default ? ' · основной' : ''}`}>
            <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
              <TextField size="small" label="Название" slotProps={{ inputLabel: { shrink: true } }} defaultValue={lang.is_default ? p.name : ''} placeholder="перевод не задан" sx={fieldSx} />
              <TextField size="small" label="Город" slotProps={{ inputLabel: { shrink: true } }} defaultValue={lang.is_default ? (p.city ?? '') : ''} placeholder="перевод не задан" sx={fieldSx} />
            </Box>
          </KV>
        ))}
      </Panel>
      <Box sx={{ display: 'grid', gap: 2 }}>
        <Panel title="Регион и деньги">
          <KV label="Часовой пояс" note="По нему открываются и закрываются заведения" help="Все часы отеля — работы заведений, расписаний, «сегодня» в отчётах — считаются в этом поясе.">
            {timezoneLabel(p.timezone)}{edit('timezone')}
          </KV>
          <KV label="Валюта" note="Цены при смене не пересчитываются" help="Валюта, в которой гость видит цены и платит. Числа цен остаются прежними — меняется только знак.">
            {currencyLabel(p.currency)}{edit('currency')}
          </KV>
          <KV label="Знаков после запятой" note="2 — с копейками, 0 — целыми" help="Сколько цифр после запятой показывать в ценах. Для рубля обычно 2, для иены 0.">
            {p.currency_minor_units}
          </KV>
          <KV label="Языки" help="Языки, на которых гость может читать витрину. Основной — тот, что откроется по умолчанию.">
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {p.languages.map((l) => <Pill key={l.code} tone={l.is_default ? 'info' : 'muted'}>{languageLabel(l.code)}{l.is_default ? ' · основной' : ''}</Pill>)}
            </Box>
          </KV>
        </Panel>
        <Panel title="Адрес и группа">
          <KV label="Поддомен" note="На него ведут QR-коды отеля" help="Адрес отеля: поддомен.naviroom.ru. Смена оставит перенаправление со старого адреса, пока его не уберут вручную.">
            <Box component="span" sx={{ fontFamily: 'monospace' }}>{p.subdomain}</Box> {OWNER_ONLY}{edit('subdomain')}
          </KV>
          <KV label="Свой домен" note="Например, guest.hotel.ru" help="Если у отеля есть свой сайт, витрина может открываться на его адресе. Нужно, чтобы отель направил домен к нам; сертификат выпустим сами.">
            <Box component="span" sx={{ color: ink.low }}>не задан</Box> {OWNER_ONLY}
          </KV>
          <KV label="Группа" help="Группа объединяет отели одного владельца. Перенести отель в другую группу можно здесь или в списке отелей.">
            <Box sx={{ display: 'inline-flex', gap: 1, alignItems: 'center' }}>Демо-отели <Sample /></Box>
          </KV>
        </Panel>
        <Panel title="Администраторы" aside={<Button size="small" sx={secondaryButtonSx}>+ Добавить</Button>}>
          <Typography sx={{ ...typo.caption, color: ink.mid, mb: 1 }}>
            Администратор отеля входит в панель отеля и заводит остальных сотрудников. Пароль приходит ему письмом — мы его не видим.
          </Typography>
          {bundle.admins.map((a) => (
            <Box key={a.id} sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', py: 1, borderBottom: `1px solid ${surface.hair}` }}>
              <Box sx={{ flex: '1 1 200px', minWidth: 0 }}>
                <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi, overflowWrap: 'anywhere' }}>{a.email}</Box>
                <Box sx={{ ...typo.caption, color: a.last_login ? ink.mid : state.warn }}>
                  {a.last_login ? `входил ${dateTime(a.last_login)}` : 'ни разу не входил — возможно, письмо не дошло'}
                </Box>
              </Box>
              <Button size="small" sx={secondaryButtonSx}>Выслать пароль заново</Button>
              <Button size="small" sx={{ color: ink.mid }}>Снять права…</Button>
            </Box>
          ))}
        </Panel>
      </Box>

      {consequence ? (
        <AdminDialog
          testId={`sandbox-consequence-${dialog}`}
          title={consequence.title}
          subtitle="Это изменение затрагивает гостей и сотрудников — прочитайте, что произойдёт."
          onClose={() => setDialog(null)}
          actions={
            <>
              <Button sx={{ color: ink.mid }} onClick={() => setDialog(null)}>Отмена</Button>
              <Button sx={primaryButtonSx} disabled>Сохранить</Button>
            </>
          }
        >
          <Box sx={{ display: 'grid', gap: 1.5 }}>
            <TextField label={consequence.field} defaultValue={consequence.value} sx={fieldSx} />
            <Box sx={{ p: 1.5, borderRadius: `${shape.radius}px`, bgcolor: surface.s2, borderLeft: `4px solid ${state.warn}` }}>
              {consequence.lines.map((line) => (
                <Box key={line} sx={{ ...typo.caption, color: ink.hi, display: 'flex', gap: 1, py: 0.3 }}>
                  <Box sx={{ color: state.warn, fontWeight: 700 }}>!</Box>
                  {line}
                </Box>
              ))}
            </Box>
            <TextField size="small" label={consequence.confirm} sx={fieldSx} helperText="Кнопка «Сохранить» включится, когда подтверждение совпадёт." />
          </Box>
        </AdminDialog>
      ) : null}
    </Box>
  );
}

/* ── История ────────────────────────────────────────────────────────────── */

const FIELD_TITLE: Record<string, string> = {
  name: 'Название',
  city: 'Город',
  timezone: 'Часовой пояс',
  currency: 'Валюта',
  currency_minor_units: 'Знаков после запятой',
  languages: 'Языки',
};

interface Change {
  id: string;
  at: string;
  actor: string;
  section: string;
  what: string;
  from?: string;
  to?: string;
  text?: string;
}

const PLAN_LEVEL: Record<string, string> = { tiles: 'Кнопки', simple: 'Простой план', full: 'Полный план' };

function show(field: string, value: unknown): string {
  if (value == null || value === '') return '—';
  if (field === 'timezone') return timezoneLabel(String(value));
  if (field === 'currency') return currencyLabel(String(value));
  if (Array.isArray(value)) return value.map((v) => languageLabel(String(v))).join(', ');
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).filter(Boolean).join(' · ');
  return String(value);
}

/** Запись журнала → строки истории словами, без кодов. */
function describe(row: AuditRow): Change[] {
  const base = { at: row.at, actor: row.actor };
  const pl = row.payload as Record<string, unknown>;
  if (row.action === 'platform.hotel.updated') {
    return Object.entries((pl.changes ?? {}) as Record<string, { from: unknown; to: unknown }>).map(([field, c], i) => ({
      ...base,
      id: `${row.id}-${i}`,
      section: 'Профиль',
      what: FIELD_TITLE[field] ?? 'Другое поле',
      from: show(field, c.from),
      to: show(field, c.to),
    }));
  }
  const one = (section: string, what: string, text?: string, from?: string, to?: string): Change[] => [{ ...base, id: row.id, section, what, text, from, to }];
  switch (row.action) {
    case 'platform.hotel.modules_set':
      return one('Модули', 'Набор модулей', `изменён набор модулей (${String(pl.count ?? '—')})`);
    case 'platform.hotel.entered':
    case 'impersonation.started':
      return one('Вход поддержки', 'Вход в панель отеля', `причина: «${String(pl.reason ?? '—')}»`);
    case 'impersonation.revoked':
      return one('Вход поддержки', 'Вход завершён');
    case 'platform.hotel.tariff_set':
      return one('Модули', 'Тариф', 'тариф пересохранён (тарифы уходят)');
    case 'grms.plan_level_changed':
      return one('Управление номером', 'Вид экрана гостя', undefined, PLAN_LEVEL[String(pl.from)] ?? '—', PLAN_LEVEL[String(pl.to)] ?? '—');
    case 'grms.published':
    case 'grms.publish':
      return one('Управление номером', 'Публикация варианта', `опубликована версия ${String(pl.version ?? '')}`);
    case 'grms.rolled_back':
    case 'grms.rollback':
      return one('Управление номером', 'Откат варианта', `возврат к версии ${String(pl.to ?? pl.to_version ?? '')}`);
    case 'grms.import_confirmed':
      return one('Управление номером', 'Загрузка файла пусконаладки', `вариантов: ${String(pl.types ?? '—')}`);
    case 'grms.device_override':
      return one('Управление номером', 'Имя устройства номера', `номер ${String(pl.room ?? '')}`);
    case 'grms.plan_saved':
    case 'grms.plan_frames':
      return one('Управление номером', 'План номера', 'план сохранён');
    case 'grms.zone_added':
    case 'grms.element_added':
      return one('Управление номером', 'Конструктор', 'добавлен элемент управления');
    default:
      return one('Прочее', 'Служебное действие');
  }
}

const PERIODS: Array<[string, string, number]> = [
  ['day', 'За сутки', 1],
  ['week', 'За неделю', 7],
  ['month', 'За месяц', 30],
];

function History({ id, go }: { id: string; go: Go }) {
  const { q, values } = useFilters(['who', 'what', 'period']);
  const audit = useQuery({ queryKey: ['sandbox', 'hotel-audit', id], queryFn: () => getAudit({ hotel_id: id, limit: 200 }) });
  // Одно действие журнал сейчас пишет двумя записями (вход поддержки,
  // публикация, откат) — показываем одну.
  const DOUBLES = new Set(['impersonation.started', 'grms.publish', 'grms.rollback']);
  const all = (audit.data?.items ?? []).filter((row) => !DOUBLES.has(row.action)).flatMap(describe);
  const actors = [...new Set(all.map((c) => c.actor))];
  const sections = [...new Set(all.map((c) => c.section))];
  const period = [...values.period][0];
  const since = period ? Date.now() - (PERIODS.find(([k]) => k === period)?.[2] ?? 3650) * 86400_000 : 0;
  const ql = q.toLowerCase();
  const shown = all.filter(
    (c) =>
      passes(values.who, c.actor) &&
      passes(values.what, c.section) &&
      Date.parse(c.at) >= since &&
      (!ql || [c.what, c.from, c.to, c.text, c.actor, c.section].some((s) => s?.toLowerCase().includes(ql))),
  );

  return (
    <Box>
      <FilterBar
        go={go}
        placeholder="Что искать: поле, значение, сотрудник"
        facets={[
          { key: 'who', label: 'Кто', options: actors.map((a) => ({ value: a, label: a, count: all.filter((c) => c.actor === a).length })) },
          { key: 'what', label: 'Что', options: sections.map((s) => ({ value: s, label: s, count: all.filter((c) => c.section === s).length })) },
          { key: 'period', label: 'Период', options: PERIODS.map(([k, label]) => ({ value: k, label })) },
        ]}
      />
      <Box sx={{ ...panelSx, p: 0 }}>
        {audit.isPending ? <Box sx={{ p: 2, ...typo.body, color: ink.mid }}>Загружаем историю…</Box> : null}
        {!audit.isPending && !shown.length ? (
          <Empty title={all.length ? 'Под фильтры ничего не попало' : 'Правок ещё не было'}>
            {all.length
              ? 'Уберите часть фильтров или расширьте период — история хранится вся.'
              : 'Когда кто-то из команды поменяет профиль, модули или управление номером, здесь появится запись: кто, когда и что было до правки.'}
          </Empty>
        ) : null}
        {shown.slice(0, 25).map((c) => (
          <Box key={c.id} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '180px 160px 1fr' }, gap: { xs: 0.25, md: 2 }, px: 2, py: 1.25, borderBottom: `1px solid ${surface.hair}` }}>
            <Box sx={{ ...typo.caption, color: ink.mid }}>
              {dateTime(c.at)}
              <Box sx={{ color: ink.low }}><Hl text={c.actor} q={q} /></Box>
            </Box>
            <Box sx={{ ...typo.caption, color: ink.mid }}>
              <Pill tone="muted">{c.section}</Pill>
            </Box>
            <Box sx={{ ...typo.body, color: ink.hi, minWidth: 0, overflowWrap: 'anywhere' }}>
              <Box component="span" sx={{ fontWeight: 700 }}><Hl text={c.what} q={q} />: </Box>
              {c.from != null ? (
                <>
                  <Box component="span" sx={{ color: ink.mid, textDecoration: 'line-through' }}><Hl text={c.from} q={q} /></Box>
                  {' → '}
                  <Hl text={c.to ?? '—'} q={q} />
                </>
              ) : (
                <Box component="span" sx={{ color: ink.mid }}><Hl text={c.text ?? ''} q={q} /></Box>
              )}
            </Box>
          </Box>
        ))}
        {shown.length > 25 ? (
          <Box sx={{ p: 1.5, textAlign: 'center' }}>
            <Button size="small" sx={secondaryButtonSx}>Показать ещё {shown.length - 25}</Button>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

/* ── Модули отеля ───────────────────────────────────────────────────────── */

type ModuleState = 'works' | 'broken' | 'off' | 'dev';

function HotelModules({ bundle, go }: { bundle: HotelBundle; go: Go }) {
  const [params] = useSearchParams();
  const view = params.get('view') === 'list' ? 'list' : 'blocks';
  const { q, values } = useFilters(['mstate']);
  const live = bundle.nodes.filter((n) => !n.is_revoked);
  const linked = (m: CatalogModule) =>
    !m.needs ? true : m.needs === 'grms' ? live.some((n) => n.purpose !== 'pms') : m.needs === 'pms' ? live.some((n) => n.purpose !== 'grms') : false;
  const stateOf = (m: CatalogModule): ModuleState => {
    if (m.status === 'dev') return 'dev';
    const on = bundle.modules.find((x) => x.code === m.code)?.is_enabled;
    if (!on) return 'off';
    return linked(m) ? 'works' : 'broken';
  };
  const LABEL: Record<ModuleState, [string, 'ok' | 'bad' | 'muted']> = {
    works: ['работает', 'ok'],
    broken: ['включён, но не работает', 'bad'],
    off: ['выключен', 'muted'],
    dev: ['в разработке', 'muted'],
  };
  const ql = q.toLowerCase();
  const shown = MODULES.filter((m) => passes(values.mstate, stateOf(m)) && (!ql || `${m.title} ${m.gives}`.toLowerCase().includes(ql)));
  const ready = shown.filter((m) => m.status === 'ready');
  const dev = shown.filter((m) => m.status === 'dev');
  const wasOn = (m: CatalogModule) => bundle.modules.find((x) => x.code === m.code)?.is_enabled;

  return (
    <Box>
      <FilterBar
        go={go}
        placeholder="Название модуля или что он даёт"
        facets={[
          {
            key: 'mstate',
            label: 'Состояние',
            options: (Object.keys(LABEL) as ModuleState[]).map((k) => ({ value: k, label: LABEL[k][0], tone: LABEL[k][1], count: MODULES.filter((m) => stateOf(m) === k).length })),
          },
        ]}
        aside={
          <ViewSwitch
            label="Вид"
            value={view}
            onChange={(v) => go({ view: v === 'blocks' ? null : v }, true)}
            options={[
              ['blocks', 'Блоки', <ViewModuleOutlinedIcon key="b" fontSize="small" />],
              ['list', 'Список', <ViewListOutlinedIcon key="l" fontSize="small" />],
            ]}
          />
        }
      />
      {!shown.length ? <Box sx={panelSx}><Empty title="Ничего не нашлось">Ни один модуль не подходит под поиск и фильтр. Нажмите «Сбросить».</Empty></Box> : null}

      {view === 'list' && shown.length ? (
        <Box sx={{ ...panelSx, p: 0 }}>
          {shown.map((m, i) => {
            const st = stateOf(m);
            return (
              <Box key={m.code} sx={{ display: 'flex', gap: 1.5, alignItems: 'center', px: 2, py: 1.25, borderTop: i ? `1px solid ${surface.hair}` : 'none', opacity: st === 'dev' ? 0.8 : 1 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}><Hl text={m.title} q={q} /></Box>
                  <Box sx={{ ...typo.caption, color: ink.mid }}>
                    {m.gives}
                    {st === 'broken' && m.needs ? <Box component="span" sx={{ color: state.bad }}> Нужно подключение: {CONNECTION_TITLE[m.needs]}.</Box> : null}
                    {st === 'dev' && wasOn(m) ? <Box component="span" sx={{ color: state.warn }}> Был включён — выключится при переходе.</Box> : null}
                  </Box>
                </Box>
                <Pill tone={LABEL[st][1]}>{LABEL[st][0]}</Pill>
                {st === 'dev' ? <Box sx={{ width: 40 }} /> : <Toggle checked={st !== 'off'} label={m.title} />}
              </Box>
            );
          })}
        </Box>
      ) : null}

      {view === 'blocks' && shown.length ? (
        <Box sx={{ display: 'grid', gap: 2 }}>
          {ready.length ? (
            <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
              {ready.map((m) => {
                const st = stateOf(m);
                return (
                  <ModuleCard key={m.code} title={<Hl text={m.title} q={q} />} gives={m.gives} toggle={<Toggle checked={st !== 'off'} label={m.title} />} status={<Pill tone={LABEL[st][1]}>{LABEL[st][0]}</Pill>}>
                    {m.needs ? (
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', ...typo.caption, color: st === 'broken' ? state.bad : ink.mid }}>
                        <Dot tone={linked(m) ? 'ok' : st === 'off' ? 'muted' : 'bad'} />
                        {linked(m) ? `Подключение есть: ${CONNECTION_TITLE[m.needs]}` : `Нужно подключение: ${CONNECTION_TITLE[m.needs]}`}
                        <Help>Модуль работает только вместе с этим подключением. Включить можно и без него — тогда гость увидит модуль, но он не будет работать, а обзор отеля покажет проблему.</Help>
                        {!linked(m) ? <Button size="small" sx={secondaryButtonSx} onClick={() => go({ tab: 'connections' })}>Подключить…</Button> : null}
                      </Box>
                    ) : null}
                    <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
                      <Button size="small" sx={secondaryButtonSx} disabled={st === 'off'}>Настроить</Button>
                      <Button size="small" sx={{ color: ink.mid }} onClick={() => go({ s: 'modules', hotel: null, tab: null, view: null, module: m.code })}>О модуле</Button>
                    </Box>
                  </ModuleCard>
                );
              })}
            </Box>
          ) : null}
          {dev.length ? (
            <Panel title="В разработке" aside={<Box sx={{ ...typo.caption, color: ink.low, display: 'inline-flex', alignItems: 'center' }}>включить пока нельзя<Help>Эти модули ещё не готовы. Как только модуль заработает, у него появится выключатель.</Help></Box>}>
              <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' } }}>
                {dev.map((m) => (
                  <Box key={m.code} sx={{ p: 1.25, borderRadius: `${shape.radius}px`, border: `1px dashed ${surface.line}`, opacity: 0.85 }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', justifyContent: 'space-between' }}>
                      <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}><Hl text={m.title} q={q} /></Box>
                      <DevTag />
                    </Box>
                    <Box sx={{ ...typo.caption, color: ink.mid, mt: 0.5 }}>{m.gives}</Box>
                    {wasOn(m) ? <Box sx={{ ...typo.caption, color: state.warn, mt: 0.75 }}>Был включён, но ничего не делал — при переходе выключится; запись уйдёт в историю отеля.</Box> : null}
                  </Box>
                ))}
              </Box>
            </Panel>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

function ModuleCard({ title, gives, toggle, status, children }: { title: ReactNode; gives: string; toggle: ReactNode; status: ReactNode; children?: ReactNode }) {
  return (
    <Box sx={{ ...panelSx }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography component="h3" sx={{ ...typo.panelTitle, color: ink.hi, flex: '1 1 auto' }}>{title}</Typography>
        {status}
        {toggle}
      </Box>
      <Typography sx={{ ...typo.body, color: ink.mid, mt: 0.5, mb: 1 }}>{gives}</Typography>
      {children}
    </Box>
  );
}
