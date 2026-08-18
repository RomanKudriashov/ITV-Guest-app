import type { TrackerScope } from './types';

/** Query keys for the tracker. Namespaced away from the CMS and guest keys. */
export const trackerKeys = {
  all: ['tracker'] as const,
  points: (language: string) => ['tracker', 'points', language] as const,
  boards: ['tracker', 'board'] as const,
  /*
    `search` — ПОСЛЕДНИЙ сегмент, и пустая строка означает «доска как есть».

    Живой снимок из сокета приходит НЕФИЛЬТРОВАННЫМ и кладётся ровно по ключу
    с пустым поиском. Если бы поиск сидел где-то в середине ключа, снимок
    попадал бы не туда, и доска переставала бы обновляться сама — ровно то,
    чего здесь делать нельзя.
  */
  board: (point: string, scope: TrackerScope, language: string, date = '', search = '') =>
    ['tracker', 'board', point, scope, language, date, search] as const,
  order: (id: string, language: string) => ['tracker', 'order', id, language] as const,
  chatThreads: (language: string) => ['tracker', 'chat', 'threads', language] as const,
  chatThread: (id: string) => ['tracker', 'chat', 'thread', id] as const,
};
