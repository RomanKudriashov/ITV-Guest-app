/**
 * Сервисы — верхний уровень CMS.
 *
 * Ресурс адресуется id СЕРВИСА, а не точки исполнения: снаружи отель
 * настраивает заведение, а бригада за ним — деталь реализации. От этого же
 * зависят включения (R2): они адресуются сервисом.
 */
import { api } from '@/api/client';
import type { ListPage, MediaAsset } from '@/api/types';

export interface ServiceExecutionPoint {
  id: string;
  code: string;
  title: Record<string, string>;
  kind: string;
  sla_minutes: number;
}

export interface ServiceCommerce {
  service_fee_bp: number | null;
  tip_presets: number[] | null;
  min_order_minor: number | null;
  free_delivery_threshold_minor: number | null;
  price_round_to_minor: number | null;
}

export interface CmsService {
  id: string;
  code: string;
  type: string;
  public_name: Record<string, string>;
  tagline: Record<string, string>;
  is_guest_facing: boolean;
  is_active: boolean;
  sort_order: number;
  schedule_id: string | null;
  /** Полный медиа-ассет: редактору кадра нужны исходник и рамка. */
  image: MediaAsset | null;
  /** Вид рабочего экрана персонала — выводится из типа сервиса (R3). */
  tracker_type: string;
  execution_point: ServiceExecutionPoint;
  commerce: ServiceCommerce;
  category_count: number;
  item_count: number;
  staff_count: number;
  channel_count: number;
  inclusion_count: number;
  has_escalation: boolean;
}

export interface ServiceTemplate {
  type: string;
  title: Record<string, string>;
  /** Из каких кирпичей собран тип: product | service_request | slot | info. */
  bricks: string[];
  tracker_type: string;
  default_guest_facing: boolean;
}

export interface ServicePayload {
  type: string;
  public_name: Record<string, string>;
  tagline?: Record<string, string>;
  is_guest_facing?: boolean;
  schedule_id?: string | null;
  sla_minutes?: number | null;
  image_id?: string | null;
  sort_order?: number | null;
}

export function fetchServices(search = ''): Promise<CmsService[]> {
  // Разворот здесь, а не на экранах: выдача в оболочке, а экрану нужен список.
  return api
    .get<ListPage<CmsService>>('/cms/services', { query: search ? { search } : undefined })
    .then((page) => page.items);
}

export function fetchServiceTemplates(): Promise<ServiceTemplate[]> {
  return api.get<ServiceTemplate[]>('/cms/services/templates');
}

export function fetchService(id: string): Promise<CmsService> {
  return api.get<CmsService>(`/cms/services/${id}`);
}

export function createService(payload: ServicePayload): Promise<CmsService> {
  return api.post<CmsService>('/cms/services', payload);
}

export function updateService(
  id: string,
  payload: Partial<ServicePayload & ServiceCommerce>,
): Promise<CmsService> {
  return api.patch<CmsService>(`/cms/services/${id}`, payload);
}

export function deleteService(id: string): Promise<void> {
  return api.delete<void>(`/cms/services/${id}`);
}

/* ── Включённый контент (модель R2, управляющий UI — R4) ──────────────── */

export interface Inclusion {
  id: string;
  source_service_id: string;
  source_service_code?: string;
  /** all — весь источник; categories — только выбранные разделы. */
  scope: 'all' | 'categories';
  markup_kind: 'none' | 'percent' | 'fixed';
  markup_value: number;
  /** source — готовит источник; own — готовим сами. */
  executor: 'source' | 'own';
  schedule_id: string | null;
  is_active: boolean;
  sort_order: number;
  category_ids: string[];
  hidden_item_ids: string[];
}

export interface InclusionPayload {
  source_service_id?: string;
  scope?: string;
  markup_kind?: string;
  markup_value?: number;
  executor?: string;
  schedule_id?: string | null;
  is_active?: boolean;
  category_ids?: string[];
  hidden_item_ids?: string[];
}

export function fetchInclusions(serviceId: string): Promise<Inclusion[]> {
  return api.get<Inclusion[]>(`/cms/services/${serviceId}/inclusions`);
}

export function createInclusion(
  serviceId: string,
  payload: InclusionPayload,
): Promise<Inclusion> {
  return api.post<Inclusion>(`/cms/services/${serviceId}/inclusions`, payload);
}

export function updateInclusion(id: string, payload: InclusionPayload): Promise<Inclusion> {
  return api.patch<Inclusion>(`/cms/inclusions/${id}`, payload);
}

export function deleteInclusion(id: string): Promise<void> {
  return api.delete<void>(`/cms/inclusions/${id}`);
}

/* ── Маршрутизация категории на исполнителя (R4 C1) ───────────────────── */

export interface CategoryRoutes {
  category_id: string;
  routes: Array<{
    id: string;
    execution_point_id: string;
    execution_point_code: string;
    priority: number;
    is_active: boolean;
  }>;
  effective: { execution_point_id: string; execution_point_code: string } | null;
  /** route | convention | single_point | none — откуда взялся исполнитель. */
  effective_source: string;
}

export function fetchCategoryRoutes(categoryId: string): Promise<CategoryRoutes> {
  return api.get<CategoryRoutes>(`/cms/categories/${categoryId}/routes`);
}

export function replaceCategoryRoutes(
  categoryId: string,
  routes: Array<{ execution_point_id: string; is_active?: boolean }>,
): Promise<CategoryRoutes> {
  return api.put<CategoryRoutes>(`/cms/categories/${categoryId}/routes`, { routes });
}
