import type { HotelAdmin, ModuleEntry, NodeRow } from '../adminClient';
import type { HotelBundle } from './sandboxData';
import { CONNECTION_TITLE, moduleByCode } from './moduleCatalog';

/**
 * ПРАВИЛА ГОТОВНОСТИ ОТЕЛЯ — МАКЕТ (партия 62).
 *
 * В сборке это считает сервер (кэш 60 с), здесь — клиент по тем же ручкам,
 * чтобы макет показал настоящие проблемы демо-отелей. Два правила, для
 * которых у платформы нет данных (PIN номеров, места подачи), идут
 * «образцом»: как будет выглядеть, а не что есть.
 */

export type Severity = 'bad' | 'warn' | 'info';
export type HotelTab =
  | 'overview'
  | 'profile'
  | 'modules'
  | 'connections'
  | 'rooms'
  | 'roomControl'
  | 'journal'
  | 'data';

export interface Problem {
  code: string;
  severity: Severity;
  title: string;
  detail: string;
  fix: HotelTab;
  fixLabel: string;
  /** Данных у платформы нет — показан образец. */
  sample?: boolean;
}

/** Коннектор молчит дольше этого — проблема. */
export const SILENT_AFTER_S = 180;
/** Столько неудачных команд и чтений за сутки — проблема. */
export const FAILED_PER_DAY = 10;

const CONNECTION_PURPOSE: Record<string, Array<NodeRow['purpose']>> = {
  grms: ['grms', 'both'],
  pms: ['pms', 'both'],
};

/** Правила, которые можно посчитать по реестру (без карточки). */
export function quickProblems(modules: ModuleEntry[], nodes: NodeRow[], admins: HotelAdmin[]): Problem[] {
  const out: Problem[] = [];
  const live = nodes.filter((node) => !node.is_revoked);
  for (const module of modules.filter((m) => m.is_enabled)) {
    // Заготовки не в счёт: они ничего не делают и с подключением тоже.
    const catalog = moduleByCode(module.code);
    const needs = catalog?.status === 'ready' ? catalog.needs : undefined;
    if (!needs) continue;
    const purposes = CONNECTION_PURPOSE[needs];
    if (!purposes || !live.some((node) => purposes.includes(node.purpose))) {
      out.push({
        code: `module_without_connection:${module.code}`,
        severity: 'bad',
        title: `«${moduleByCode(module.code)?.title ?? module.code}» включён без подключения`,
        detail: `Нужен ${CONNECTION_TITLE[needs]}. Пока его нет, гость видит модуль, но он не работает.`,
        fix: 'connections',
        fixLabel: 'Добавить подключение',
      });
    }
  }
  for (const node of live) {
    if (node.seconds_since_seen == null || node.seconds_since_seen > SILENT_AFTER_S) {
      out.push({
        code: `connector_silent:${node.id}`,
        severity: 'bad',
        title: `Коннектор «${node.name}» не на связи`,
        detail:
          node.seconds_since_seen == null
            ? 'Ни разу не выходил на связь — ключ не установлен на объекте.'
            : `Молчит ${minutes(node.seconds_since_seen)} — команды гостей не доходят до номеров.`,
        fix: 'connections',
        fixLabel: 'Открыть подключения',
      });
    }
  }
  if (admins.length && admins.every((admin) => !admin.last_login)) {
    out.push({
      code: 'admin_never_logged_in',
      severity: 'warn',
      title: admins.length === 1 ? 'Администратор ни разу не входил' : 'Ни один администратор ни разу не входил',
      detail: `${admins.map((a) => a.email).join(', ')} — пароль мог не дойти или потеряться.`,
      fix: 'profile',
      fixLabel: 'Выслать пароль заново',
    });
  }
  return out;
}

/** Полный список — для обзора отеля. */
export function hotelProblems(bundle: HotelBundle, now = Date.now()): Problem[] {
  const out = quickProblems(bundle.modules, bundle.nodes, bundle.admins);
  const roomControl = bundle.modules.find((m) => m.code === 'room_control')?.is_enabled;
  if (roomControl) {
    const bound = new Set(bundle.types.flatMap((type) => type.rooms));
    const free = bundle.profile.counts.rooms - bound.size;
    if (free > 0) {
      out.push({
        code: 'rooms_without_variant',
        severity: 'warn',
        title: `${free} ${plural(free, 'номер', 'номера', 'номеров')} без варианта управления`,
        detail: 'Гость в этих номерах увидит «номер не управляется».',
        fix: 'roomControl',
        fixLabel: 'Назначить вариант',
      });
    }
    for (const type of bundle.types) {
      const versions = bundle.versions[type.code] ?? [];
      if (!versions.some((v) => v.is_current)) {
        out.push({
          code: `variant_unpublished:${type.code}`,
          severity: 'warn',
          title: `Вариант «${type.title.ru ?? type.code}» не опубликован`,
          detail: `${type.rooms.length} ${plural(type.rooms.length, 'номер', 'номера', 'номеров')} ждут первой версии.`,
          fix: 'roomControl',
          fixLabel: 'Опубликовать',
        });
      }
    }
    const day = now - 24 * 3600 * 1000;
    const failed = bundle.diagnostics.filter(
      (row) => Date.parse(row.at) >= day && row.result && !['ok', 'confirmed', 'accepted'].includes(row.result),
    );
    if (failed.length >= FAILED_PER_DAY) {
      out.push({
        code: 'failed_commands',
        severity: 'warn',
        title: `${failed.length} неудачных обращений к оборудованию за сутки`,
        detail: `Чаще всего: ${topReason(failed.map((row) => row.result))}. Номера: ${[...new Set(failed.map((r) => r.room))].slice(0, 5).join(', ')}.`,
        fix: 'roomControl',
        fixLabel: 'Открыть журнал команд',
      });
    }
    out.push({
      code: 'rooms_without_pin',
      severity: 'info',
      title: 'Номера без PIN',
      detail: 'Гость не подтвердит номер и не включит свет, пока PIN не выдан.',
      fix: 'rooms',
      fixLabel: 'Выдать PIN',
      sample: true,
    });
  }
  out.push({
    code: 'no_menu_service',
    severity: 'warn',
    title: 'Нет сервиса с меню и местом подачи',
    detail: 'Гостю нечего заказать: ни одно заведение не принимает заказы в номер.',
    fix: 'modules',
    fixLabel: 'Открыть заведения в панели',
    sample: true,
  });
  const order: Record<Severity, number> = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

function minutes(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} мин`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} ч` : `${Math.round(h / 24)} дн`;
}

function topReason(results: string[]): string {
  const counts = new Map<string, number>();
  for (const r of results) counts.set(r, (counts.get(r) ?? 0) + 1);
  const [reason, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const label: Record<string, string> = {
    CHANNEL_NOT_FOUND: 'канал не найден на сервере iRidi',
    CONNECTOR_OFFLINE: 'коннектор не на связи',
    unconfirmed: 'команда не подтвердилась',
    failed: 'команда не прошла',
  };
  return `${label[reason] ?? reason} (${count})`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
