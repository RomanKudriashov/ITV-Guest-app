import { useQuery } from '@tanstack/react-query';

import { ApiError, api } from '@/api/client';
import { retryTransientUpTo } from '@/api/retry';

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
    // Модули МЕНЯЮТСЯ посреди сессии — их включает NaviRoom Control, и меню
    // ждало этого пять минут кэша (партия 60): оператор включил модуль, отель
    // открыл панель — пункта нет. Теперь меню перечитывается, когда человек
    // возвращается на вкладку, и сразу после отказа «модуль выключен»
    // (`invalidateNavigationOnModuleOff`). Между переходами по экранам запроса
    // нет: оболочка не перемонтируется.
    staleTime: 15 * 1000,
    refetchOnWindowFocus: 'always',
    // Отказ по правам повтором не лечится: у линейного сотрудника раздела нет
    // и через три попытки. Три лишних круга с паузами — это только задержка
    // перед тем, как показать ему отказ.
    retry: retryTransientUpTo(3),
  });
}

/**
 * Сервер сказал «модуль выключен» — значит, меню на клиенте могло устареть:
 * модуль только что выключили (или включили соседний). Перечитываем сразу.
 */
export function isModuleOff(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.code === 'module_disabled';
}

/** Раздел закрыт ролью — не «не загрузилось», а «сюда нельзя». */
export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}
