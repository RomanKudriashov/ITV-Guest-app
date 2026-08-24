/**
 * Транспорт: КУДА и ЧЕМ отправлять.
 *
 * Не только путь: у CMS и консоли платформы разные хранилища токенов, разный
 * обмен и разный вход. Подмешивать платформенный токен в клиент CMS значило бы
 * сцепить две авторизации — и однажды увести оператора на вход отеля.
 */
export interface GrmsTransport {
  base: string;
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
  put: <T>(path: string, body?: unknown) => Promise<T>;
  upload: <T>(path: string, form: FormData) => Promise<T>;
}

/**
 * API управления номером.
 *
 * ПУТЬ ПРИХОДИТ ПАРАМЕТРОМ. Одни и те же экраны обслуживают две области: CMS
 * отеля (`/cms/grms`) и консоль платформы (`/platform/hotels/{id}/grms`).
 * Раньше префикс был зашит, и переезд конфигурации в консоль означал бы вторую
 * копию клиента — а вместе с ней вторую копию каждой ошибки.
 *
 * Базу даёт `useGrms()` (см. `cms/roomControl/scope`), а не глобальная
 * переменная: в консоли она зависит от ОТКРЫТОГО отеля и меняется при переходе
 * между ними.
 *
 * Отдельный модуль, а не догрузка в `cms.ts`: раздел закрыт модулем
 * `room_control` целиком, и держать его вызовы рядом с базовыми — приглашать
 * позвать их с экрана, которому модуль не нужен.
 *
 * Все типы описывают ровно то, что отдаёт сервер (`backend/api/cms/grms.py`).
 * Предпросмотр импорта намеренно ходит туда-обратно целиком: администратор
 * его правит, и последнее слово за ним, а не за разобранным на сервере
 * состоянием между двумя запросами.
 */

/* ── Каталог ───────────────────────────────────────────────────────────── */

export interface CatalogElement {
  kind: string;
  title: string;
  required: string[];
  optional: string[];
}

export interface CapabilitySpec {
  value_kind: string;
  requires_command: boolean;
  requires_feedback: boolean;
  readonly: boolean;
}

export interface GrmsCatalog {
  elements: CatalogElement[];
  capabilities: Record<string, CapabilitySpec>;
}

export function fetchGrmsCatalog(
  t: GrmsTransport): Promise<GrmsCatalog> {
  return t.get<GrmsCatalog>(`${t.base}/catalog`);
}

/* ── Импорт ────────────────────────────────────────────────────────────── */

export interface ParsedVariable {
  key: string;
  command: string;
  feedback: string;
  value_kind: string;
  min_value: number;
  max_value: number;
  raw_range: string;
  description: string;
}

export interface ParsedType {
  name: string;
  reference_room: string;
  device_name_template: string;
  rooms: string[];
  variables: ParsedVariable[];
}

export interface ImportWarning {
  code: string;
  message: string;
  where: string;
}

export interface ImportPreview {
  types: ParsedType[];
  warnings: ImportWarning[];
}

export interface ChannelReport {
  feedback: string;
  status: string;
  value: string | number | null;
}

export interface TypeReport {
  type_name: string;
  device: string;
  checked: boolean;
  reason: string;
  channels: ChannelReport[];
  missing: string[];
  extra: string[];
}

export interface ReconcileResult {
  reports: TypeReport[];
  checked: boolean;
}

export interface ImportSaved {
  types: string[];
  rooms_not_in_system: string[];
  rooms_in_conflict: string[];
}

export function previewImport(
  t: GrmsTransport,
  file: File): Promise<ImportPreview> {
  const form = new FormData();
  form.append('file', file);
  return t.upload<ImportPreview>(`${t.base}/import/preview`, form);
}

export function reconcileImport(
  t: GrmsTransport,
  preview: ImportPreview): Promise<ReconcileResult> {
  return t.post<ReconcileResult>(`${t.base}/import/reconcile`, { preview });
}

export function confirmImport(
  t: GrmsTransport,
  preview: ImportPreview, replace: boolean): Promise<ImportSaved> {
  return t.post<ImportSaved>(`${t.base}/import/confirm`, { preview, replace });
}

/* ── Типы и конструктор ────────────────────────────────────────────────── */

export interface GrmsVariable {
  key: string;
  command: string;
  feedback: string;
  value_kind: string;
  min_value: number;
  max_value: number;
  raw_range: string;
  description: string;
}

export interface GrmsType {
  code: string;
  /** Название типа многоязычное: показывать через `pickTranslated`. */
  title: Record<string, string>;
  device_name_template: string;
  /**
   * УРОВЕНЬ ПЛАНА — записанное нами решение, а не догадка по кадрам.
   * Отель его не меняет; редактор по нему понимает, какие контролы у этого
   * типа осмысленны. Сервер всё равно откажет — это вежливость, а не защита.
   */
  plan_level: 'tiles' | 'simple' | 'full';
  rooms: string[];
  variables: GrmsVariable[];
}

export function fetchGrmsTypes(
  t: GrmsTransport): Promise<{ types: GrmsType[] }> {
  return t.get<{ types: GrmsType[] }>(`${t.base}/types`);
}

export interface DraftBinding {
  capability: string;
  variable: string;
}

export interface DraftElement {
  slug: string;
  kind: string;
  title: Record<string, string>;
  zone: string;
  publishable: boolean;
  problems: string[];
  bindings: DraftBinding[];
}

export interface DraftZone {
  code: string;
  title: Record<string, string>;
  sort_order: number;
}

export interface TypeStatus {
  type: string;
  publishable: string[];
  hidden: { slug: string; kind: string; problems: string[] }[];
  zones: DraftZone[];
  elements: DraftElement[];
}

export function fetchTypeStatus(
  t: GrmsTransport,
  code: string): Promise<TypeStatus> {
  return t.get<TypeStatus>(`${t.base}/types/${encodeURIComponent(code)}/status`);
}

export function addZone(
  t: GrmsTransport,
  code: string,
  payload: { code: string; title: Record<string, string>; sort_order?: number },): Promise<{ code: string }> {
  return t.post(`${t.base}/types/${encodeURIComponent(code)}/zones`, payload);
}

export function addElement(
  t: GrmsTransport,
  code: string,
  payload: {
    kind: string;
    slug: string;
    zone_code?: string;
    title?: Record<string, string> | null;
    sort_order?: number;
  },): Promise<{ slug: string; kind: string }> {
  return t.post(`${t.base}/types/${encodeURIComponent(code)}/elements`, payload);
}

export function addBinding(
  t: GrmsTransport,
  code: string,
  payload: {
    element_slug: string;
    capability: string;
    variable_key: string;
    trigger_value?: number | null;
  },): Promise<{ element: string; capability: string }> {
  return t.post(`${t.base}/types/${encodeURIComponent(code)}/bindings`, payload);
}

export function setDeviceOverride(
  t: GrmsTransport,
  code: string,
  payload: { room_number: string; device_name: string },): Promise<{ room: string; device: string }> {
  return t.post(`${t.base}/types/${encodeURIComponent(code)}/device-override`, payload);
}

/* ── Проверка на живом номере ──────────────────────────────────────────── */

export interface CheckStep {
  step: string;
  channel: string;
  ok: boolean;
  value: string | number | null;
  error: string;
  raw: unknown;
}

export interface CheckResult {
  element: string;
  kind: string;
  capability: string;
  device: string;
  room: string;
  outcome: string;
  note: string;
  steps: CheckStep[];
}

export function checkElement(
  t: GrmsTransport,
  code: string,
  payload: {
    element_slug: string;
    room_number: string;
    capability?: string;
    value?: number | null;
  },): Promise<CheckResult> {
  return t.post<CheckResult>(`${t.base}/types/${encodeURIComponent(code)}/check`, payload);
}

/* ── Публикация ────────────────────────────────────────────────────────── */

export interface VersionRecord {
  version: number;
  is_current: boolean;
  published_at: string;
  rolled_back_from: number | null;
  controls: number;
}

export function publishType(
  t: GrmsTransport,
  code: string): Promise<{ version: number; published_at: string }> {
  return t.post(`${t.base}/types/${encodeURIComponent(code)}/publish`);
}

export function rollbackType(
  t: GrmsTransport,
  code: string,
  toVersion: number,): Promise<{ version: number; rolled_back_from: number | null }> {
  return t.post(`${t.base}/types/${encodeURIComponent(code)}/rollback`, {
    to_version: toVersion,
  });
}

export function fetchVersions(
  t: GrmsTransport,
  code: string): Promise<{ versions: VersionRecord[] }> {
  return t.get(`${t.base}/types/${encodeURIComponent(code)}/versions`);
}

/* ── Доступ гостя ──────────────────────────────────────────────────────── */

export interface RoomPinRecord {
  room: string;
  issued_at: string;
  valid_until: string | null;
  is_active: boolean;
}

export interface AccessState {
  demo_entry: {
    enabled: boolean;
    warning: string;
    /** Последнее переключение из журнала. null — не трогали ни разу. */
    toggled: { enabled: boolean; at: string; by: string } | null;
  };
  pins: RoomPinRecord[];
}

export function fetchAccess(
  t: GrmsTransport): Promise<AccessState> {
  return t.get<AccessState>(`${t.base}/access`);
}

export function setRoomPin(
  t: GrmsTransport,
  roomNumber: string,
  pin: string,): Promise<{ room: string; has_pin: boolean }> {
  return t.post(`${t.base}/access/pin`, { room_number: roomNumber, pin });
}

export function setDemoEntry(
  t: GrmsTransport,
  enabled: boolean,): Promise<{ enabled: boolean; warning: string }> {
  return t.post(`${t.base}/access/demo-entry`, { enabled });
}

/* ── План ──────────────────────────────────────────────────────────────── */

/** Прямоугольник в ПРОЦЕНТАХ кадра. Пикселей в разметке нет нигде. */
export interface PlanRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlanZone {
  code: string;
  controlId: string;
  hit: PlanRect;
  mask: PlanRect;
}

export interface PlanWindow extends PlanRect {
  code: string;
  orientation: 'horizontal' | 'vertical';
  curtainId: string;
  blackoutId: string;
}

export interface PlanPoint {
  controlId: string;
  x: number;
  y: number;
}

export interface PlanGeometry {
  aspect: number | null;
  zones: PlanZone[];
  windows: PlanWindow[];
  points: PlanPoint[];
  mirrored: boolean;
  /**
   * Гасить ли сами светильники при расчёте ночного кадра.
   *
   * Живёт с конфигурацией плана, а не в коде: порог «ярче окружения» на
   * светлых кадрах не срабатывает, и решить это может только тот, кто видит
   * свой рендер.
   */
  extinguish_sources: boolean;
}

export interface PlanFrame {
  id: string;
  status: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface PlanControl {
  controlId: string;
  title: string;
  kind: string;
  zone: string;
}

export interface PlanState {
  geometry: PlanGeometry;
  frames: { lit: PlanFrame | null; off: PlanFrame | null; off_source: string };
  controls: PlanControl[];
  published: boolean;
}

export interface PairVerdict {
  ok: boolean;
  reason: string;
  match: number;
  lit_size: number[];
  off_size: number[];
}

export interface FramesUploaded {
  ok: boolean;
  pair: PairVerdict | null;
  hint?: string;
  night?: string;
  plan?: PlanState;
}

export function fetchPlan(
  t: GrmsTransport,
  code: string): Promise<PlanState> {
  return t.get<PlanState>(`${t.base}/types/${encodeURIComponent(code)}/plan`);
}

export function savePlan(
  t: GrmsTransport,
  code: string, geometry: PlanGeometry): Promise<PlanState> {
  return t.put<PlanState>(`${t.base}/types/${encodeURIComponent(code)}/plan`, geometry);
}

export function uploadPlanFrames(
  t: GrmsTransport,
  code: string,
  lit: File,
  off?: File | null,): Promise<FramesUploaded> {
  const form = new FormData();
  form.append('lit', lit);
  if (off) form.append('off', off);
  return t.upload<FramesUploaded>(
    `${t.base}/types/${encodeURIComponent(code)}/plan/frames`,
    form,
  );
}

export function copyPlan(
  t: GrmsTransport,
  code: string, source: string): Promise<PlanState> {
  return t.post<PlanState>(`${t.base}/types/${encodeURIComponent(code)}/plan/copy`, { source });
}

/* ── Диагностика инженера (ТЗ §14.3, §6.8) ─────────────────────────────── */

/**
 * Строка журнала обмена. Каждое поле здесь ЗАПИСАНО сервером в момент обмена
 * — кроме `element_kind`, который добывается по слугу из текущей конфигурации
 * и потому может быть пустым у старых строк.
 */
export interface DiagnosticsRow {
  id: string;
  at: string;
  action: string;
  room: string;
  element: string;
  element_kind: string;
  device: string;
  command: string;
  feedback: string;
  request_id: string;
  sent: number | string | null;
  observed: number | string | null;
  raw_response: string;
  duration_ms: number | null;
  result: string;
  /** Код причины отказа; пусто, если обмен состоялся. */
  reason: string;
  /** Та же причина словами ТЗ §6.8. Пусто, если код нам незнаком. */
  reason_label: string;
}

export interface DiagnosticsJournal {
  rows: DiagnosticsRow[];
  /** Выдача обрезана потолком — инженер смотрит не весь журнал. */
  truncated: boolean;
  limit: number;
}

export interface DiagnosticsFilters {
  room?: string;
  element_kind?: string;
  outcome?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
}

export function fetchDiagnostics(
  t: GrmsTransport,
  filters: DiagnosticsFilters): Promise<DiagnosticsJournal> {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '' && value !== null) query[key] = String(value);
  }
  // Фильтры в строке запроса: транспорт умеет только путь, и собирать её
  // здесь честнее, чем заводить второй способ передавать параметры.
  const search = new URLSearchParams(query).toString();
  return t.get<DiagnosticsJournal>(
    `${t.base}/diagnostics${search ? `?${search}` : ''}`,
  );
}

/** Звено связи. `unknown` — «не знаем», и это не то же самое, что «сломано». */
export interface LinkPart {
  state: string;
}

export interface DiagnosticsLink {
  connector: LinkPart & {
    name: string;
    last_seen_at: string | null;
    version: string;
  };
  iridi_endpoint: LinkPart;
  state_readable: LinkPart & {
    reason: string;
    reason_label: string;
    at: string | null;
  };
  checked_at: string;
}

export function fetchDiagnosticsLink(
  t: GrmsTransport): Promise<DiagnosticsLink> {
  return t.get<DiagnosticsLink>(`${t.base}/diagnostics/link`);
}

export interface DiagnosticsFilterValues {
  element_kinds: { code: string; title: string }[];
  outcomes: string[];
}

export function fetchDiagnosticsFilterValues(
  t: GrmsTransport): Promise<DiagnosticsFilterValues> {
  return t.get<DiagnosticsFilterValues>(`${t.base}/diagnostics/filters`);
}
