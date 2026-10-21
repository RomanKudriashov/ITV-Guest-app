import { useQueries, useQuery } from '@tanstack/react-query';

import {
  getActivity,
  getAudit,
  getFleet,
  getHotel,
  getHotelAdmins,
  getModules,
  getNodes,
  getUsage,
  platformRequest,
  type ActivityRow,
  type AuditRow,
  type FleetRow,
  type HotelAdmin,
  type HotelProfile,
  type HotelUsage,
  type ModuleEntry,
  type NodeRow,
} from '../adminClient';

/**
 * ДАННЫЕ ПЕСОЧНИЦЫ — ТОЛЬКО ЧТЕНИЕ (партия 62).
 *
 * Макеты показывают локальные демо-отели такими, какие они есть: те же ручки,
 * что у нынешней консоли. Ни одна функция здесь не пишет. Чего у платформы
 * нет вовсе (сети отелей, PIN номеров, места подачи), макет помечает
 * «образцом» — см. `Sample` в `ui.tsx`.
 */

export interface GrmsType {
  code: string;
  title: Record<string, string>;
  plan_level: 'tiles' | 'simple' | 'full';
  rooms: string[];
}
export interface GrmsVersion {
  version: number;
  is_current: boolean;
  published_at: string | null;
}
export interface DiagnosticsRow {
  at: string;
  action: string;
  room: string;
  result: string;
}

const grmsTypes = (id: string) =>
  platformRequest<{ types: GrmsType[] }>(`/hotels/${id}/grms/types`).then((r) => r.types);
const grmsVersions = (id: string, code: string) =>
  platformRequest<{ versions: GrmsVersion[] }>(`/hotels/${id}/grms/types/${code}/versions`).then((r) => r.versions);
const grmsDiagnostics = (id: string) =>
  platformRequest<{ rows: DiagnosticsRow[] }>(`/hotels/${id}/grms/diagnostics?limit=500`).then((r) => r.rows);

/** Строка реестра отелей: реестр + профиль (живые номера) + модули. */
export interface HotelLine {
  row: FleetRow;
  profile?: HotelProfile;
  modules: ModuleEntry[];
  nodes: NodeRow[];
  admins: HotelAdmin[];
}

export function useNodes() {
  return useQuery({ queryKey: ['sandbox', 'nodes'], queryFn: () => getNodes(200), staleTime: 60_000 });
}

export function useFleetLines() {
  const fleet = useQuery({
    queryKey: ['sandbox', 'fleet'],
    queryFn: () => getFleet({ origin: 'all', page_size: 100, sort: 'name' }),
    staleTime: 60_000,
  });
  const nodes = useNodes();
  const ids = fleet.data?.items.map((row) => row.id) ?? [];
  const profiles = useQueries({
    queries: ids.map((id) => ({ queryKey: ['sandbox', 'hotel', id], queryFn: () => getHotel(id), staleTime: 60_000 })),
  });
  const modules = useQueries({
    queries: ids.map((id) => ({ queryKey: ['sandbox', 'modules', id], queryFn: () => getModules(id), staleTime: 60_000 })),
  });
  const admins = useQueries({
    queries: ids.map((id) => ({ queryKey: ['sandbox', 'admins', id], queryFn: () => getHotelAdmins(id), staleTime: 60_000 })),
  });
  const lines: HotelLine[] = (fleet.data?.items ?? []).map((row, index) => ({
    row,
    profile: profiles[index]?.data,
    modules: modules[index]?.data?.modules ?? [],
    nodes: (nodes.data?.items ?? []).filter((node) => node.hotel_id === row.id),
    admins: admins[index]?.data?.admins ?? [],
  }));
  const ready =
    fleet.isSuccess && nodes.isSuccess && [...profiles, ...modules, ...admins].every((q) => !q.isPending);
  return { lines, ready, error: fleet.error ?? nodes.error };
}

/** Всё, что нужно карточке отеля. */
export interface HotelBundle {
  profile: HotelProfile;
  modules: ModuleEntry[];
  nodes: NodeRow[];
  admins: HotelAdmin[];
  usage?: HotelUsage;
  activity: ActivityRow[];
  types: GrmsType[];
  versions: Record<string, GrmsVersion[]>;
  diagnostics: DiagnosticsRow[];
  history: AuditRow[];
}

export function useHotelBundle(id: string) {
  const profile = useQuery({ queryKey: ['sandbox', 'hotel', id], queryFn: () => getHotel(id) });
  const modules = useQuery({ queryKey: ['sandbox', 'modules', id], queryFn: () => getModules(id) });
  const admins = useQuery({ queryKey: ['sandbox', 'admins', id], queryFn: () => getHotelAdmins(id) });
  const usage = useQuery({ queryKey: ['sandbox', 'usage', id], queryFn: () => getUsage(id) });
  const activity = useQuery({ queryKey: ['sandbox', 'activity', id], queryFn: () => getActivity(id) });
  const nodes = useNodes();
  const roomControlOn = Boolean(modules.data?.modules.find((m) => m.code === 'room_control')?.is_enabled);
  const types = useQuery({
    queryKey: ['sandbox', 'grms-types', id],
    queryFn: () => grmsTypes(id),
    enabled: roomControlOn,
  });
  const versions = useQueries({
    queries: (types.data ?? []).map((type) => ({
      queryKey: ['sandbox', 'grms-versions', id, type.code],
      queryFn: () => grmsVersions(id, type.code),
    })),
  });
  const diagnostics = useQuery({
    queryKey: ['sandbox', 'grms-diag', id],
    queryFn: () => grmsDiagnostics(id),
    enabled: roomControlOn,
  });
  const history = useQuery({
    queryKey: ['sandbox', 'history', id],
    queryFn: () => getAudit({ hotel_id: id, action: 'platform.hotel.updated', limit: 20 }),
  });

  const ready =
    profile.isSuccess &&
    modules.isSuccess &&
    admins.isSuccess &&
    nodes.isSuccess &&
    !usage.isPending &&
    !activity.isPending &&
    (!roomControlOn || (!types.isPending && !diagnostics.isPending && versions.every((q) => !q.isPending)));

  const bundle: HotelBundle | null =
    ready && profile.data && modules.data
      ? {
          profile: profile.data,
          modules: modules.data.modules,
          nodes: (nodes.data?.items ?? []).filter((node) => node.hotel_id === id),
          admins: admins.data?.admins ?? [],
          usage: usage.data,
          activity: activity.data ?? [],
          types: types.data ?? [],
          versions: Object.fromEntries((types.data ?? []).map((type, i) => [type.code, versions[i]?.data ?? []])),
          diagnostics: diagnostics.data ?? [],
          history: history.data?.items ?? [],
        }
      : null;
  return { bundle, error: profile.error };
}
