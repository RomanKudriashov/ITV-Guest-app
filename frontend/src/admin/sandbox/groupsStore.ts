import { useSyncExternalStore } from 'react';

import type { Tone } from './ui';

/**
 * ГРУППЫ ПЕСОЧНИЦЫ (партия 62, третий заход) — общее хранилище в памяти
 * вкладки: список отелей и страница группы видят одно и то же. Групп у
 * платформы локально нет, поэтому начальный состав — образец; правки живут
 * до перезагрузки страницы и никуда не отправляются.
 *
 * `parentId` заложен под «группу в группе»: в модели родитель есть,
 * интерфейс показывает один уровень.
 */

export type GroupColor = Exclude<Tone, 'muted'> | 'accent';

export const GROUP_COLORS: Array<[GroupColor, string]> = [
  ['accent', 'Синий'],
  ['ok', 'Зелёный'],
  ['warn', 'Янтарный'],
  ['bad', 'Красный'],
  ['gold', 'Золотой'],
  ['info', 'Голубой'],
];

export interface GroupHistory {
  at: string;
  actor: string;
  what: string;
  from?: string;
  to?: string;
  text?: string;
}

export interface Group {
  id: string;
  title: string;
  description: string;
  note: string;
  color: GroupColor;
  order: number;
  parentId: string | null;
  hotels: string[];
  /** Модули, которые включаются у отеля, когда его добавляют в группу. */
  autoModules: string[];
  autoEnabled: boolean;
  history: GroupHistory[];
}

const now = Date.now();
const ago = (days: number, hours = 0) => new Date(now - days * 86400_000 - hours * 3600_000).toISOString();

let groups: Group[] = [
  {
    id: 'g-demo',
    title: 'Демо-отели',
    description: 'Отели для показов клиентам: заполнены меню, управление номером работает на эмуляторе.',
    note: 'Перед показом проверить, что коннектор «Кристалла» на связи.',
    color: 'accent',
    order: 1,
    parentId: null,
    hotels: ['crystal', 'azure'],
    autoModules: ['room_control'],
    autoEnabled: true,
    history: [
      { at: ago(0, 3), actor: 'platform@itv.local', what: 'Состав', text: 'добавлен отель «Azure Resort» (переехал из «Санкт-Петербург»)' },
      { at: ago(2), actor: 'platform@itv.local', what: 'Модули по группе', text: 'включён «Управление номером» во всех отелях (2)' },
      { at: ago(5), actor: 'support@itv.local', what: 'Название', from: 'Демо', to: 'Демо-отели' },
      { at: ago(5, 1), actor: 'support@itv.local', what: 'Цвет-метка', from: 'Серый', to: 'Синий' },
      { at: ago(9), actor: 'platform@itv.local', what: 'Группа создана', text: 'с отелями «Отель «Кристалл»», «Azure Resort»' },
    ],
  },
  {
    id: 'g-spb',
    title: 'Санкт-Петербург',
    description: 'Отели в Петербурге одного владельца.',
    note: '',
    color: 'gold',
    order: 2,
    parentId: null,
    hotels: ['lumen'],
    autoModules: [],
    autoEnabled: false,
    history: [{ at: ago(12), actor: 'platform@itv.local', what: 'Группа создана', text: 'с отелем «Lumen Boutique»' }],
  },
];

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const groupsStore = {
  get: () => groups,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Отель — максимум в одной группе: перенос убирает его из прежней. */
  move(subs: string[], groupId: string | null) {
    groups = groups.map((g) => ({
      ...g,
      hotels: g.id === groupId ? [...new Set([...g.hotels, ...subs])] : g.hotels.filter((h) => !subs.includes(h)),
    }));
    emit();
  },
  create(input: { title: string; description: string; color: GroupColor; hotels: string[] }) {
    const id = `g-${Date.now().toString(36)}`;
    groups = groups.map((g) => ({ ...g, hotels: g.hotels.filter((h) => !input.hotels.includes(h)) }));
    groups = [
      ...groups,
      {
        id,
        ...input,
        note: '',
        order: groups.length + 1,
        parentId: null,
        autoModules: [],
        autoEnabled: false,
        history: [{ at: new Date().toISOString(), actor: 'вы', what: 'Группа создана', text: `отелей: ${input.hotels.length}` }],
      },
    ];
    emit();
    return id;
  },
  patch(id: string, patch: Partial<Group>) {
    groups = groups.map((g) => (g.id === id ? { ...g, ...patch } : g));
    emit();
  },
  remove(id: string) {
    groups = groups.filter((g) => g.id !== id);
    emit();
  },
};

export function useGroups(): Group[] {
  return useSyncExternalStore(groupsStore.subscribe, groupsStore.get);
}

export const byOrder = (a: Group, b: Group) => a.order - b.order || a.title.localeCompare(b.title, 'ru');
