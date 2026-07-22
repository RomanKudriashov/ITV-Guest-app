import type { TrackerScope } from './types';

/** Query keys for the tracker. Namespaced away from the CMS and guest keys. */
export const trackerKeys = {
  all: ['tracker'] as const,
  points: (language: string) => ['tracker', 'points', language] as const,
  boards: ['tracker', 'board'] as const,
  board: (point: string, scope: TrackerScope, language: string) =>
    ['tracker', 'board', point, scope, language] as const,
  order: (id: string, language: string) => ['tracker', 'order', id, language] as const,
  chatThreads: (language: string) => ['tracker', 'chat', 'threads', language] as const,
  chatThread: (id: string) => ['tracker', 'chat', 'thread', id] as const,
};
