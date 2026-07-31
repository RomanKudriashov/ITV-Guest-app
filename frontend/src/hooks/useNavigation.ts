import { useQuery } from '@tanstack/react-query';

import { api } from '@/api/client';

/**
 * Разделы CMS приходят С СЕРВЕРА.
 *
 * Гейтинг решает реестр модулей отеля, а роль решает, что человеку вообще
 * показывать. Собери меню на клиенте — и список того, за что отель не платил,
 * всё равно уехал бы к нему в бандл, а «спрятать пункт» стало бы косметикой
 * поверх открытого экрана.
 */
export interface NavItem {
  key: string;
  to: string;
  /** Код модуля, которым пункт открыт; null — базовый раздел. */
  module: string | null;
}

export interface NavGroup {
  key: string;
  items: NavItem[];
}

export interface NavigationResponse {
  groups: NavGroup[];
}

export function useNavigation() {
  return useQuery<NavigationResponse>({
    queryKey: ['cms', 'navigation'],
    queryFn: () => api.get<NavigationResponse>('/cms/navigation'),
    // Модули и роль за сессию не меняются; лишний запрос на каждый переход
    // между экранами тут ничего не уточнит.
    staleTime: 5 * 60 * 1000,
  });
}
