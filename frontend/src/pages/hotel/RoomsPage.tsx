import { useState } from 'react';
import { useListQuery } from '@/kit/list/useListQuery';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cmsPath } from '@/app/hostRole';

import { QueryState } from '@/components/QueryState';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import Link from '@mui/material/Link';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import LibraryAddOutlinedIcon from '@mui/icons-material/LibraryAddOutlined';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import GridViewIcon from '@mui/icons-material/GridView';
import TableRowsIcon from '@mui/icons-material/TableRows';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import CleaningServicesOutlinedIcon from '@mui/icons-material/CleaningServicesOutlined';

import { ApiError } from '@/api/client';
import {
  ROOMS_PAGE_SIZE,
  bulkCreateRooms,
  bulkUpdateRooms,
  checkOutRoom,
  createRoom,
  createBuilding,
  createRoomCategory,
  deleteRoom,
  deleteBuilding,
  deleteRoomCategory,
  downloadRoomQrPng,
  fetchRenameImpact,
  fetchBuildings,
  fetchRoomCategories,
  fetchRoomQrSheetHtml,
  fetchRoomQrSvg,
  fetchRooms,
  previewBulkRooms,
  updateRoom,
} from '@/api/hotelAdmin';
import type {
  Building,
  GridRoom,
  Room,
  RoomBulkPatch,
  RoomBulkPreview,
  RoomBulkResult,
  RoomCategory,
  RoomFilters,
  RoomHousekeeping,
  RoomRenameImpact,
} from '@/api/hotelAdminTypes';
import { queryKeys } from '@/api/queryKeys';
import { RoomGrid } from './RoomGrid';
import { RoomPanel } from './RoomPanel';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { useToast } from '@/components/ToastProvider';

interface RoomForm {
  number: string;
  floor: string;
  zone: string;
  is_active: boolean;
}

const EMPTY_ROOM: RoomForm = { number: '', floor: '', zone: '', is_active: true };

/** Состояния уборки в порядке показа. `unknown` первым — это значение по умолчанию. */
const HOUSEKEEPING: RoomHousekeeping[] = ['unknown', 'clean', 'dirty', 'in_progress'];

export function RoomsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [editing, setEditing] = useState<Room | 'new' | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Room | null>(null);
  const [pendingCheckout, setPendingCheckout] = useState<Room | null>(null);
  const [qrRoom, setQrRoom] = useState<Room | null>(null);
  const [printing, setPrinting] = useState(false);

  /*
    Поиск живёт В АДРЕСЕ и фильтрует НА СЕРВЕРЕ: ссылку на выборку можно
    послать, F5 её не сбрасывает, а счётчик не врёт — отсев уже скачанного
    списка показывал бы «найдено 2» независимо от того, сколько их в базе.
  */
  /*
    СТРАНИЦА — ТОЖЕ В АДРЕСЕ, рядом с поиском. Экран брал первую сотню (предел
    сервера по умолчанию) и молчал о том, что она первая: на фонде в триста
    номеров двести не существовали для администратора, а «выделить все» в
    массовых действиях выделило бы ровно видимую часть.
  */
  const { params, patch } = useListQuery({
    search: '',
    page: 1,
    floor: '',
    category: '',
    housekeeping: '',
    view: 'list',
    orders: '',
    control: '',
  });
  const pageNumber = Math.max(1, Number(params.page) || 1);
  const offset = (pageNumber - 1) * ROOMS_PAGE_SIZE;

  // Фильтры выборки — ровно те, по которым сервер строит «все по выборке» для
  // массовой правки. Разъехавшись, они дали бы экран, где человек видит одно,
  // а правит другое.
  const filters: RoomFilters = {
    floor: params.floor || undefined,
    category: params.category || undefined,
    housekeeping: params.housekeeping || undefined,
    // Два фильтра показывает только сетка, но в выборку они входят наравне:
    // выделение «все по выборке» обязано означать ровно то, что на экране.
    has_orders: params.orders === 'yes' || undefined,
    has_control: params.control === 'yes' || undefined,
  };
  const isFiltered = Boolean(
    params.search || params.floor || params.category || params.housekeeping || params.orders || params.control,
  );
  // На сетке те же фильтры — она гасит ими кубики, не запрашивая ничего
  // нового: выборка на экране и выборка на сервере должны совпадать.
  const gridFilters = filters;

  const roomsQuery = useQuery({
    queryKey: [
      ...queryKeys.rooms,
      params.search,
      pageNumber,
      params.floor,
      params.category,
      params.housekeeping,
      params.orders,
      params.control,
    ],
    queryFn: () => fetchRooms(params.search, { limit: ROOMS_PAGE_SIZE, offset }, filters),
  });
  const buildingsQuery = useQuery({
    queryKey: [...queryKeys.rooms, 'buildings'],
    queryFn: fetchBuildings,
  });
  const buildings = buildingsQuery.data ?? [];

  const categoriesQuery = useQuery({
    queryKey: [...queryKeys.rooms, 'categories'],
    queryFn: fetchRoomCategories,
  });
  const categories = categoriesQuery.data ?? [];
  const rooms = roomsQuery.data?.items ?? [];
  const total = roomsQuery.data?.total ?? 0;
  const shownFrom = total === 0 ? 0 : offset + 1;
  const shownTo = offset + rooms.length;
  const hasMore = shownTo < total;

  /*
    ВЫДЕЛЕНИЕ. Два состояния, и второе — не «галочка в шапке».

    `picked` — отмеченные строки. `allMatching` — «все по выборке»: его нельзя
    выразить списком идентификаторов, потому что клиент их не видел (страница
    50 строк при 314 в фильтре). Поэтому при `allMatching` наружу уходят
    фильтры, а множество строит сервер.
  */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [buildingsOpen, setBuildingsOpen] = useState(false);
  /*
    ВИД ЖИВЁТ В АДРЕСЕ, как поиск и фильтры: ссылкой на сетку можно поделиться,
    и F5 не выкидывает обратно в таблицу.
  */
  const view = params.view === 'grid' ? 'grid' : 'list';
  const [panelRoom, setPanelRoom] = useState<GridRoom | null>(null);

  const selectedCount = allMatching ? total : picked.size;
  const pageAllPicked = rooms.length > 0 && rooms.every((room) => picked.has(room.id));

  const resetSelection = () => {
    setPicked(new Set());
    setAllMatching(false);
  };

  const togglePicked = (id: string) => {
    setAllMatching(false);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Выделение рамкой на сетке отдаёт пачку разом — одной перерисовкой. */
  const pickMany = (ids: string[]) => {
    setAllMatching(false);
    setPicked((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const togglePage = () => {
    setAllMatching(false);
    setPicked((prev) => {
      const next = new Set(prev);
      if (pageAllPicked) rooms.forEach((room) => next.delete(room.id));
      else rooms.forEach((room) => next.add(room.id));
      return next;
    });
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.rooms });
  const showError = (error: unknown) =>
    toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');

  /**
   * The print sheet sits behind staff JWT, so it is fetched with the authorized
   * client and opened from a blob URL — a plain `window.open` on the API path
   * cannot carry the Bearer token and would 401.
   */
  const handlePrintSheet = async () => {
    // Open the tab synchronously inside the click gesture so the popup blocker
    // lets it through; the blob URL is set once the HTML arrives.
    const win = window.open('', '_blank');
    setPrinting(true);
    try {
      const html = await fetchRoomQrSheetHtml();
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      if (win) {
        win.onload = () => {
          try {
            win.print();
          } catch {
            /* the sheet is still readable and printable by hand */
          }
        };
        win.location.href = url;
      } else {
        // Popup was blocked — fall back to a same-tab download-style anchor.
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.target = '_blank';
        anchor.rel = 'noopener';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      win?.close();
      toast.show(t('hotel.rooms.qrError'), 'error');
    } finally {
      setPrinting(false);
    }
  };

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateRoom(id, { is_active: isActive }),
    onMutate: async ({ id, isActive }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.rooms });
      const previous = queryClient.getQueryData<Room[]>(queryKeys.rooms);
      queryClient.setQueryData<Room[]>(queryKeys.rooms, (current) =>
        current?.map((room) => (room.id === id ? { ...room, is_active: isActive } : room)),
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.rooms, context.previous);
      showError(error);
    },
    onSettled: invalidate,
  });

  /**
   * ВЫЕЗД ГОСТЯ — здесь, а не в разделе управления номером.
   *
   * Отзыв гасит гостевые сессии целиком: вместе с ними уезжает и право
   * заказывать, а не только управление номером. Отелю без оборудования выезд
   * нужен ровно так же, и прятать его за модулем значило бы не дать половине
   * отелей единственный способ отобрать доступ у съехавшего.
   */
  const checkoutMutation = useMutation({
    mutationFn: (id: string) => checkOutRoom(id),
    onSuccess: (result) => {
      // Говорим ЧИСЛОМ, а не «готово»: администратор нажал на всякий случай и
      // должен видеть, было ли что отзывать.
      toast.show(
        result.revoked
          ? t('hotel.rooms.checkoutDone', { count: result.revoked, number: result.room })
          : t('hotel.rooms.checkoutNothing', { number: result.room }),
        'success',
      );
      setPendingCheckout(null);
      void invalidate();
    },
    onError: showError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRoom(id),
    onSuccess: () => {
      toast.show(t('hotel.rooms.deleted'), 'success');
      setPendingDelete(null);
      void invalidate();
    },
    onError: showError,
  });

  return (
    <Box sx={{ p: 3 }}>
      <Card variant="outlined" sx={{ borderColor: 'divider' }}>
        <CardContent sx={{ p: 2 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={2}
            flexWrap="wrap"
            useFlexGap
            sx={{ mb: 1 }}
          >
            <Stack>
              <Typography variant="h5" data-testid="cms-page-title">{t('hotel.rooms.title')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('hotel.rooms.subtitle')}
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
              <TextField
                size="small"
                value={params.search}
                /* Новый поиск — всегда с первой страницы: иначе набранное
                   слово находит три номера, а экран стоит на седьмой
                   странице и показывает пусто. */
                onChange={(event) => {
                  resetSelection();
                  patch({ search: event.target.value, page: 1 });
                }}
                placeholder={t('list.searchPlaceholder')}
                inputProps={{ 'data-testid': 'rooms-search' }}
                sx={{ minWidth: 200 }}
              />
              <Button
                startIcon={<PrintOutlinedIcon />}
                disabled={printing}
                onClick={() => void handlePrintSheet()}
                data-testid="rooms-print-qr"
              >
                {t('hotel.rooms.printQr')}
              </Button>
              <Button
                startIcon={<LibraryAddOutlinedIcon />}
                onClick={() => setBulkOpen(true)}
                data-testid="room-bulk-add"
              >
                {t('hotel.rooms.bulkAdd')}
              </Button>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={view}
                onChange={(_, next) => next && patch({ view: next, page: 1 })}
                aria-label={t('hotel.rooms.viewSwitch')}
              >
                <ToggleButton value="list" data-testid="rooms-view-list" aria-label={t('hotel.rooms.viewList')}>
                  <TableRowsIcon fontSize="small" />
                </ToggleButton>
                <ToggleButton value="grid" data-testid="rooms-view-grid" aria-label={t('hotel.rooms.viewGrid')}>
                  <GridViewIcon fontSize="small" />
                </ToggleButton>
              </ToggleButtonGroup>
              <Button onClick={() => setBuildingsOpen(true)} data-testid="room-buildings-open">
                {t('hotel.rooms.buildings')}
              </Button>
              <Button onClick={() => setCategoriesOpen(true)} data-testid="room-categories-open">
                {t('hotel.rooms.categories')}
              </Button>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setEditing('new')}
                data-testid="room-add"
              >
                {t('hotel.rooms.add')}
              </Button>
            </Stack>
          </Stack>

          {/* Фильтры выборки — те же, что уходят в массовую правку. */}
          <Stack
            direction="row"
            spacing={1}
            flexWrap="wrap"
            useFlexGap
            alignItems="center"
            sx={{ mb: 1 }}
          >
            <TextField
              select
              size="small"
              label={t('hotel.rooms.filterCategory')}
              value={params.category}
              onChange={(event) => {
                resetSelection();
                patch({ category: event.target.value, page: 1 });
              }}
              sx={{ minWidth: 180 }}
              /* Нативный select — как у остальных списков CMS: он доступен с
                 клавиатуры и его умеет выбирать проверка. */
              SelectProps={{ native: true }}
              InputLabelProps={{ shrink: true }}
              inputProps={{ 'data-testid': 'rooms-filter-category' }}
            >
              <option value="">{t('common.all')}</option>
              <option value="none">{t('hotel.rooms.categoryNone')}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.title_i18n || category.code}
                </option>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label={t('hotel.rooms.filterHousekeeping')}
              value={params.housekeeping}
              onChange={(event) => {
                resetSelection();
                patch({ housekeeping: event.target.value, page: 1 });
              }}
              sx={{ minWidth: 180 }}
              SelectProps={{ native: true }}
              InputLabelProps={{ shrink: true }}
              inputProps={{ 'data-testid': 'rooms-filter-housekeeping' }}
            >
              <option value="">{t('common.all')}</option>
              {HOUSEKEEPING.map((value) => (
                <option key={value} value={value}>
                  {t(`hotel.rooms.housekeeping_${value}`)}
                </option>
              ))}
            </TextField>
            <TextField
              size="small"
              label={t('hotel.rooms.filterFloor')}
              value={params.floor}
              onChange={(event) => {
                resetSelection();
                patch({ floor: event.target.value, page: 1 });
              }}
              sx={{ width: 120 }}
              inputProps={{ 'data-testid': 'rooms-filter-floor' }}
            />
            {view === 'grid' ? (
              <>
                {/* Эти два фильтра про то, что видно на кубике, и на таблице
                    их нет: там нет ни точки заказов, ни значка устройства. */}
                <Button
                  size="small"
                  variant={params.orders === 'yes' ? 'contained' : 'outlined'}
                  onClick={() => patch({ orders: params.orders === 'yes' ? '' : 'yes' })}
                  data-testid="rooms-filter-orders"
                >
                  {t('hotel.rooms.filterHasOrders')}
                </Button>
                <Button
                  size="small"
                  variant={params.control === 'yes' ? 'contained' : 'outlined'}
                  onClick={() => patch({ control: params.control === 'yes' ? '' : 'yes' })}
                  data-testid="rooms-filter-control"
                >
                  {t('hotel.rooms.filterHasControl')}
                </Button>
              </>
            ) : null}
            {isFiltered ? (
              <Button
                size="small"
                onClick={() => {
                  resetSelection();
                  patch({
                    search: '',
                    floor: '',
                    category: '',
                    housekeeping: '',
                    orders: '',
                    control: '',
                    page: 1,
                  });
                }}
                data-testid="rooms-filters-reset"
              >
                {t('list.resetFilters')}
              </Button>
            ) : null}
          </Stack>

          {/*
            ПОЛОСА ВЫДЕЛЕНИЯ. Она обязана говорить, СКОЛЬКО именно будет
            изменено, и различать «отмечено на странице» и «все по выборке»:
            «выделить все» на экране, показывающем 50 из 314, — это готовый
            инцидент.
          */}
          {selectedCount > 0 ? (
            <Alert
              severity="info"
              sx={{ mb: 1 }}
              data-testid="rooms-selection-bar"
              action={
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => setBulkEditOpen(true)}
                    data-testid="rooms-bulk-edit"
                  >
                    {t('hotel.rooms.bulkEdit')}
                  </Button>
                  <Button size="small" onClick={resetSelection} data-testid="rooms-selection-clear">
                    {t('hotel.rooms.selectionClear')}
                  </Button>
                </Stack>
              }
            >
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="body2" data-testid="rooms-selection-count">
                  {allMatching
                    ? t('hotel.rooms.selectionAll', { count: selectedCount })
                    : t('hotel.rooms.selectionPicked', { count: selectedCount })}
                </Typography>
                {!allMatching && total > picked.size ? (
                  <Button
                    size="small"
                    onClick={() => {
                      setPicked(new Set());
                      setAllMatching(true);
                    }}
                    data-testid="rooms-select-all-matching"
                  >
                    {t('hotel.rooms.selectAllMatching', { count: total })}
                  </Button>
                ) : null}
              </Stack>
            </Alert>
          ) : null}

          <Divider sx={{ mb: 1 }} />

          {view === 'grid' ? (
            <RoomGrid
              search={params.search}
              filters={gridFilters}
              categories={categories}
              selection={{ picked, allMatching, toggle: togglePicked, pickMany }}
              onOpenRoom={setPanelRoom}
            />
          ) : roomsQuery.isLoading ? (
            <Stack spacing={1}>
              {[0, 1, 2, 3].map((key) => (
                <Skeleton key={key} variant="rounded" height={44} />
              ))}
            </Stack>
          ) : roomsQuery.isError ? (
            <QueryState query={roomsQuery} what={t('state.what.rooms')}>
              {() => null}
            </QueryState>
          ) : rooms.length === 0 ? (
            <EmptyState
              testId="rooms-empty"
              title={t('hotel.rooms.empty')}
              description={t('hotel.rooms.emptyHint')}
              action={
                <Button variant="contained" size="small" onClick={() => setBulkOpen(true)}>
                  {t('hotel.rooms.bulkAdd')}
                </Button>
              }
            />
          ) : (
            <Box data-testid="rooms-list">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      {/* Галочка в шапке отмечает ТОЛЬКО эту страницу, и так и
                          подписана: «все по выборке» — отдельная кнопка. */}
                      <Checkbox
                        size="small"
                        checked={pageAllPicked && !allMatching}
                        indeterminate={!pageAllPicked && picked.size > 0 && !allMatching}
                        onChange={togglePage}
                        inputProps={{ 'aria-label': t('hotel.rooms.selectPage') }}
                        data-testid="rooms-select-page"
                      />
                    </TableCell>
                    <TableCell>{t('hotel.rooms.number')}</TableCell>
                    <TableCell>{t('hotel.rooms.floor')}</TableCell>
                    <TableCell>{t('hotel.rooms.zone')}</TableCell>
                    <TableCell>{t('hotel.rooms.category')}</TableCell>
                    <TableCell>{t('hotel.rooms.housekeeping')}</TableCell>
                    {/* Тот единственный вопрос про управление номером, который
                        задают, глядя на список: «а этот номер управляется?» */}
                    <TableCell>{t('hotel.rooms.controlType')}</TableCell>
                    <TableCell>{t('hotel.rooms.active')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rooms.map((room) => (
                    <TableRow
                      key={room.id}
                      hover
                      selected={allMatching || picked.has(room.id)}
                      data-testid={`room-row-${room.number}`}
                    >
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          checked={allMatching || picked.has(room.id)}
                          onChange={() => togglePicked(room.id)}
                          inputProps={{ 'aria-label': room.number }}
                          data-testid={`room-pick-${room.number}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <Typography variant="body2" fontWeight={500}>
                            {room.number}
                          </Typography>
                          {/*
                            «Вне продажи» и уборка — ЗНАЧКАМИ, не цветом
                            строки: цвет в этом разделе означает занятость, а
                            её у нас нет и не будет до PMS. Красить им что-то
                            другое значит заранее занять смысл, который потом
                            придётся отбирать.
                          */}
                          {room.out_of_service ? (
                            <BuildOutlinedIcon
                              fontSize="inherit"
                              color="warning"
                              titleAccess={t('hotel.rooms.outOfService')}
                              data-testid={`room-out-of-service-${room.number}`}
                            />
                          ) : null}
                          {room.housekeeping === 'dirty' || room.housekeeping === 'in_progress' ? (
                            <CleaningServicesOutlinedIcon
                              fontSize="inherit"
                              color="action"
                              titleAccess={t(`hotel.rooms.housekeeping_${room.housekeeping}`)}
                            />
                          ) : null}
                        </Stack>
                      </TableCell>
                      <TableCell>{room.floor || '—'}</TableCell>
                      <TableCell data-testid={`room-category-${room.number}`}>
                        {room.category ? (
                          <Chip size="small" label={room.category.title || room.category.code} />
                        ) : (
                          <Typography variant="body2" color="text.disabled">
                            —
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell data-testid={`room-housekeeping-${room.number}`}>
                        <Typography
                          variant="body2"
                          color={room.housekeeping === 'unknown' ? 'text.disabled' : 'text.primary'}
                        >
                          {t(`hotel.rooms.housekeeping_${room.housekeeping}`)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {/*
                          Ссылка ведёт в конфигурацию ТИПА, а не номера:
                          настраивается тип один раз, а не двести раз по числу
                          комнат. Не управляется — прочерк, а не пустая ячейка:
                          пустая читается как «данные не доехали».
                        */}
                        {room.control_type ? (
                          <Link
                            component={RouterLink}
                            to={cmsPath(`/room-control?type=${encodeURIComponent(room.control_type)}`)}
                            variant="body2"
                            data-testid={`room-control-type-${room.number}`}
                          >
                            {room.control_type}
                          </Link>
                        ) : (
                          <Typography
                            variant="body2"
                            color="text.disabled"
                            data-testid={`room-control-type-${room.number}`}
                          >
                            —
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Switch
                          size="small"
                          checked={room.is_active}
                          onChange={(event) =>
                            toggleMutation.mutate({ id: room.id, isActive: event.target.checked })
                          }
                        />
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          onClick={() => setQrRoom(room)}
                          aria-label={t('hotel.rooms.qr')}
                          data-testid={`room-qr-${room.number}`}
                        >
                          <QrCode2Icon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => setPendingCheckout(room)}
                          aria-label={t('hotel.rooms.checkout')}
                          title={t('hotel.rooms.checkout')}
                          data-testid={`room-checkout-${room.number}`}
                        >
                          <LogoutOutlinedIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => setEditing(room)}
                          aria-label={t('common.edit')}
                          data-testid={`room-edit-${room.number}`}
                        >
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => setPendingDelete(room)}
                          aria-label={t('common.delete')}
                          data-testid={`room-delete-${room.number}`}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/*
                Счётчик — обязательная часть листания, а не украшение: он
                единственный отвечает на вопрос «это весь фонд или кусок?».
              */}
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ mt: 1.5 }}
                data-testid="rooms-pager"
              >
                <Typography variant="body2" color="text.secondary" data-testid="rooms-range">
                  {t('hotel.rooms.pagerRange', {
                    from: shownFrom,
                    to: shownTo,
                    total,
                  })}
                </Typography>
                <Box sx={{ flexGrow: 1 }} />
                <Button
                  size="small"
                  disabled={pageNumber <= 1}
                  onClick={() => patch({ page: pageNumber - 1 })}
                  data-testid="rooms-prev"
                >
                  {t('hotel.rooms.pagerPrev')}
                </Button>
                <Button
                  size="small"
                  disabled={!hasMore}
                  onClick={() => patch({ page: pageNumber + 1 })}
                  data-testid="rooms-next"
                >
                  {t('hotel.rooms.pagerNext')}
                </Button>
              </Stack>
            </Box>
          )}
        </CardContent>
      </Card>

      {editing ? (
        <RoomDialog
          room={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void invalidate();
          }}
        />
      ) : null}

      {bulkOpen ? (
        <BulkDialog
          onClose={() => setBulkOpen(false)}
          onDone={() => void invalidate()}
        />
      ) : null}

      {qrRoom ? <QrDialog room={qrRoom} onClose={() => setQrRoom(null)} /> : null}

      {panelRoom ? (
        <RoomPanel
          room={panelRoom}
          categories={categories}
          buildings={buildings}
          onClose={() => setPanelRoom(null)}
          onChanged={() => void invalidate()}
          onShowQr={() => setQrRoom(panelRoom)}
        />
      ) : null}

      {bulkEditOpen ? (
        <BulkEditDialog
          categories={categories}
          count={selectedCount}
          allMatching={allMatching}
          selection={
            allMatching
              ? { all_matching: true, search: params.search, filters }
              : { ids: [...picked] }
          }
          onClose={() => setBulkEditOpen(false)}
          onDone={() => {
            setBulkEditOpen(false);
            resetSelection();
            void invalidate();
          }}
        />
      ) : null}

      {buildingsOpen ? (
        <BuildingsDialog
          buildings={buildings}
          onClose={() => setBuildingsOpen(false)}
          onChanged={() => void invalidate()}
        />
      ) : null}

      {categoriesOpen ? (
        <CategoriesDialog
          categories={categories}
          onClose={() => setCategoriesOpen(false)}
          onChanged={() => void invalidate()}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingCheckout)}
        testId="room-checkout-dialog"
        busy={checkoutMutation.isPending}
        title={t('hotel.rooms.checkoutTitle')}
        description={t('hotel.rooms.checkoutBody', { number: pendingCheckout?.number ?? '' })}
        confirmLabel={t('hotel.rooms.checkoutConfirm')}
        onClose={() => setPendingCheckout(null)}
        onConfirm={() => pendingCheckout && checkoutMutation.mutate(pendingCheckout.id)}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        testId="room-delete-dialog"
        destructive
        busy={deleteMutation.isPending}
        title={t('hotel.rooms.deleteTitle')}
        description={t('hotel.rooms.deleteBody', { number: pendingDelete?.number ?? '' })}
        confirmLabel={t('common.delete')}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
      />
    </Box>
  );
}

/* ── Single room dialog ────────────────────────────────────────────────── */

function RoomDialog({
  room,
  onClose,
  onSaved,
}: {
  room: Room | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState<RoomForm>(
    room
      ? { number: room.number, floor: room.floor, zone: room.zone, is_active: room.is_active }
      : EMPTY_ROOM,
  );

  /*
    ПЕРЕИМЕНОВАНИЕ — ЧЕРЕЗ ПОКАЗ ПОСЛЕДСТВИЙ, а не через «сохранить».

    Два из них с этого экрана не видны вовсе: наклейка QR в номере кодирует
    НОМЕР (после правки она ведёт в никуда), а имя устройства iRidi собирается
    из номера шаблоном типа — команды уедут на другое имя, и номер перестанет
    управляться. Сервер поэтому не принимает смену номера без `confirm_rename`;
    здесь мы спрашиваем у него, что именно изменится, и показываем это числами.
  */
  const [impact, setImpact] = useState<RoomRenameImpact | null>(null);
  const [keepDevice, setKeepDevice] = useState(true);
  const [checking, setChecking] = useState(false);

  const trimmed = {
    number: form.number.trim(),
    floor: form.floor.trim(),
    zone: form.zone.trim(),
    is_active: form.is_active,
  };
  const isRename = Boolean(room) && trimmed.number !== room?.number;

  const mutation = useMutation({
    mutationFn: (confirmed: boolean) =>
      room
        ? updateRoom(room.id, {
            ...trimmed,
            ...(confirmed
              ? { confirm_rename: true, keep_device_name: keepDevice }
              : {}),
          })
        : createRoom(trimmed),
    onSuccess: (saved) => {
      /*
        «Создан» и «восстановлен» — разные события, и второе надо сказать
        ЧИСЛАМИ. Человек нажал «добавить номер»: он не просил ничего
        восстанавливать и по фразе «вместе с историей» не поймёт, что именно
        получил — историю на три заказа или на четыреста.
      */
      toast.show(
        saved.restored
          ? t('hotel.rooms.restored', {
              number: saved.number,
              orders: t('hotel.rooms.restoredOrders', { count: saved.restored_orders ?? 0 }),
              sessions: t('hotel.rooms.restoredSessions', {
                count: saved.restored_sessions ?? 0,
              }),
            })
          : t('hotel.rooms.saved'),
        'success',
      );
      onSaved();
    },
    onError: (error) =>
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error'),
  });

  const handleSave = async () => {
    if (!isRename || !room) {
      mutation.mutate(false);
      return;
    }
    setChecking(true);
    try {
      const found = await fetchRenameImpact(room.id, trimmed.number);
      if (found.taken) {
        toast.show(t('hotel.rooms.renameTaken', { number: trimmed.number }), 'error');
        return;
      }
      setKeepDevice(found.device_changes);
      setImpact(found);
    } catch (error) {
      toast.show(
        error instanceof ApiError ? error.detail : t('hotel.rooms.renameCheckError'),
        'error',
      );
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <Dialog open onClose={onClose} maxWidth="xs" fullWidth data-testid="room-dialog">
        <DialogTitle>{room ? t('hotel.rooms.editTitle') : t('hotel.rooms.newTitle')}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              size="small"
              label={t('hotel.rooms.number')}
              value={form.number}
              onChange={(event) => setForm((prev) => ({ ...prev, number: event.target.value }))}
              inputProps={{ 'data-testid': 'room-number' }}
              required
              fullWidth
            />
            <TextField
              size="small"
              label={t('hotel.rooms.floor')}
              value={form.floor}
              onChange={(event) => setForm((prev) => ({ ...prev, floor: event.target.value }))}
              fullWidth
            />
            <TextField
              size="small"
              label={t('hotel.rooms.zone')}
              value={form.zone}
              onChange={(event) => setForm((prev) => ({ ...prev, zone: event.target.value }))}
              fullWidth
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.is_active}
                  onChange={(event) => setForm((prev) => ({ ...prev, is_active: event.target.checked }))}
                />
              }
              label={t('hotel.rooms.active')}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={!form.number.trim() || mutation.isPending || checking}
            onClick={() => void handleSave()}
            data-testid="room-save"
          >
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {impact ? (
        <RenameDialog
          impact={impact}
          keepDevice={keepDevice}
          onKeepDeviceChange={setKeepDevice}
          busy={mutation.isPending}
          onClose={() => setImpact(null)}
          onConfirm={() => {
            setImpact(null);
            mutation.mutate(true);
          }}
        />
      ) : null}
    </>
  );
}

/* ── Rename confirmation ───────────────────────────────────────────────── */

/**
 * Разбор последствий переименования. Не «вы уверены?», а перечень того, что
 * сломается, и единственная кнопка, которая одно из этого чинит.
 */
function RenameDialog({
  impact,
  keepDevice,
  onKeepDeviceChange,
  busy,
  onClose,
  onConfirm,
}: {
  impact: RoomRenameImpact;
  keepDevice: boolean;
  onKeepDeviceChange: (value: boolean) => void;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="room-rename-dialog">
      <DialogTitle>{t('hotel.rooms.renameTitle', { number: impact.number })}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <Typography variant="body2">
            {t('hotel.rooms.renameLead', { number: impact.new_number })}
          </Typography>

          <Alert severity="warning" data-testid="room-rename-qr">
            {t('hotel.rooms.renameQr', { url: impact.qr_url })}
          </Alert>

          {impact.device_changes ? (
            <Alert severity="warning" data-testid="room-rename-device">
              {t('hotel.rooms.renameDevice', {
                from: impact.device,
                to: impact.device_after,
              })}
            </Alert>
          ) : (
            <Alert severity="info" data-testid="room-rename-device">
              {t('hotel.rooms.renameNoDevice')}
            </Alert>
          )}

          {impact.live_sessions > 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('hotel.rooms.renameSessions', { count: impact.live_sessions })}
            </Typography>
          ) : null}

          {impact.device_changes ? (
            <FormControlLabel
              control={
                <Checkbox
                  checked={keepDevice}
                  onChange={(event) => onKeepDeviceChange(event.target.checked)}
                  data-testid="room-rename-keep-device"
                />
              }
              label={
                <Stack>
                  <Typography variant="body2">{t('hotel.rooms.renameKeepDevice')}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('hotel.rooms.renameKeepDeviceHint', { device: impact.device })}
                  </Typography>
                </Stack>
              }
            />
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          color="warning"
          disabled={busy}
          onClick={onConfirm}
          data-testid="room-rename-confirm"
        >
          {t('hotel.rooms.renameConfirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── Bulk edit ─────────────────────────────────────────────────────────── */

/**
 * Массовая правка. Номера здесь НЕТ: переименование требует подтверждения на
 * каждый номер — у каждого своя наклейка QR и своё имя устройства.
 *
 * Заголовок называет число, которое будет изменено, и отдельно — что это «все
 * по выборке», а не то, что видно на экране.
 */
function BulkEditDialog({
  categories,
  count,
  allMatching,
  selection,
  onClose,
  onDone,
}: {
  categories: RoomCategory[];
  count: number;
  allMatching: boolean;
  selection: Parameters<typeof bulkUpdateRooms>[0];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [patch, setPatch] = useState<RoomBulkPatch>({});

  const setField = <K extends keyof RoomBulkPatch>(key: K, value: RoomBulkPatch[K]) =>
    setPatch((prev) => {
      const next = { ...prev };
      if (value === undefined || value === '') delete next[key];
      else next[key] = value;
      return next;
    });

  const mutation = useMutation({
    mutationFn: () => bulkUpdateRooms(selection, patch),
    onSuccess: (result) => {
      // Числами и по факту: сколько попало в выборку и сколько реально
      // изменилось. «Готово» без чисел здесь ничего не значит.
      toast.show(
        t('hotel.rooms.bulkEditDone', { changed: result.changed, matched: result.matched }),
        'success',
      );
      onDone();
    },
    onError: (error) =>
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error'),
  });

  const nothingToDo = Object.keys(patch).length === 0;

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth data-testid="rooms-bulk-edit-dialog">
      <DialogTitle>{t('hotel.rooms.bulkEditTitle', { count })}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity={allMatching ? 'warning' : 'info'} data-testid="rooms-bulk-edit-scope">
            {allMatching
              ? t('hotel.rooms.bulkEditScopeAll', { count })
              : t('hotel.rooms.bulkEditScopePicked', { count })}
          </Alert>

          <TextField
            select
            size="small"
            label={t('hotel.rooms.category')}
            value={patch.category_id ?? ''}
            onChange={(event) =>
              setField(
                'category_id',
                event.target.value === 'none' ? null : event.target.value || undefined,
              )
            }
            SelectProps={{ native: true }}
            InputLabelProps={{ shrink: true }}
            inputProps={{ 'data-testid': 'rooms-bulk-category' }}
            fullWidth
          >
            <option value="">{t('hotel.rooms.bulkKeep')}</option>
            <option value="none">{t('hotel.rooms.categoryNone')}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.title_i18n || category.code}
              </option>
            ))}
          </TextField>

          <TextField
            select
            size="small"
            label={t('hotel.rooms.housekeeping')}
            value={patch.housekeeping ?? ''}
            onChange={(event) =>
              setField('housekeeping', (event.target.value || undefined) as RoomHousekeeping)
            }
            SelectProps={{ native: true }}
            InputLabelProps={{ shrink: true }}
            inputProps={{ 'data-testid': 'rooms-bulk-housekeeping' }}
            fullWidth
          >
            <option value="">{t('hotel.rooms.bulkKeep')}</option>
            {HOUSEKEEPING.map((value) => (
              <option key={value} value={value}>
                {t(`hotel.rooms.housekeeping_${value}`)}
              </option>
            ))}
          </TextField>

          <TextField
            size="small"
            label={t('hotel.rooms.floor')}
            value={patch.floor ?? ''}
            onChange={(event) => setField('floor', event.target.value)}
            inputProps={{ 'data-testid': 'rooms-bulk-floor' }}
            fullWidth
          />
          <TextField
            size="small"
            label={t('hotel.rooms.zone')}
            value={patch.zone ?? ''}
            onChange={(event) => setField('zone', event.target.value)}
            inputProps={{ 'data-testid': 'rooms-bulk-zone' }}
            fullWidth
          />

          <FormControlLabel
            control={
              <Checkbox
                checked={patch.out_of_service === true}
                indeterminate={patch.out_of_service === undefined}
                onChange={(event) => setField('out_of_service', event.target.checked)}
                data-testid="rooms-bulk-out-of-service"
              />
            }
            label={t('hotel.rooms.outOfService')}
          />
          <Typography variant="caption" color="text.secondary">
            {t('hotel.rooms.bulkKeepHint')}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={nothingToDo || mutation.isPending}
          onClick={() => mutation.mutate()}
          data-testid="rooms-bulk-apply"
        >
          {t('hotel.rooms.bulkApply', { count })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── Categories ────────────────────────────────────────────────────────── */

/** Справочник категорий: завести, переименовать, убрать пустую. */
/**
 * КОРПУСА — СПРАВОЧНИК, устроенный как категории номеров.
 *
 * До этого корпус был свободной строкой в карточке номера: «Главный корпус»,
 * «главный корпус» и «Гл. корпус» жили как три разных здания, и фильтр делил
 * фонд на три части, притом что здание одно. Одинаковое устройство с
 * категориями намеренно: это два справочника одного экрана.
 */
function BuildingsDialog({
  buildings,
  onClose,
  onChanged,
}: {
  buildings: Building[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [title, setTitle] = useState('');

  const fail = (error: unknown) =>
    toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');

  const create = useMutation({
    mutationFn: () => createBuilding({ title: { ru: title.trim() } }),
    onSuccess: () => {
      setTitle('');
      onChanged();
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteBuilding(id),
    onSuccess: onChanged,
    onError: fail,
  });

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth data-testid="rooms-buildings-dialog">
      <DialogTitle>{t('hotel.rooms.buildings')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1} sx={{ pt: 1 }}>
          {buildings.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('hotel.rooms.buildingsEmpty')}
            </Typography>
          ) : (
            buildings.map((building) => (
              <Stack
                key={building.id}
                direction="row"
                spacing={1}
                alignItems="center"
                data-testid={`room-building-row-${building.code}`}
              >
                <Typography variant="body2" sx={{ flexGrow: 1 }}>
                  {building.title_i18n || building.code}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('hotel.rooms.categoryRooms', { count: building.rooms_count })}
                </Typography>
                <IconButton
                  size="small"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(building.id)}
                  aria-label={t('common.delete')}
                  data-testid={`room-building-delete-${building.code}`}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))
          )}
          <Divider sx={{ my: 1 }} />
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              label={t('hotel.rooms.buildingNew')}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              inputProps={{ 'data-testid': 'room-building-title' }}
              fullWidth
            />
            <Button
              variant="contained"
              disabled={!title.trim() || create.isPending}
              onClick={() => create.mutate()}
              data-testid="room-building-add"
            >
              {t('common.add')}
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}

function CategoriesDialog({
  categories,
  onClose,
  onChanged,
}: {
  categories: RoomCategory[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [title, setTitle] = useState('');

  const fail = (error: unknown) =>
    toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');

  const create = useMutation({
    mutationFn: () => createRoomCategory({ title: { ru: title.trim() } }),
    onSuccess: () => {
      setTitle('');
      onChanged();
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRoomCategory(id),
    onSuccess: onChanged,
    onError: fail,
  });

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth data-testid="rooms-categories-dialog">
      <DialogTitle>{t('hotel.rooms.categories')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1} sx={{ pt: 1 }}>
          {categories.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('hotel.rooms.categoriesEmpty')}
            </Typography>
          ) : (
            categories.map((category) => (
              <Stack
                key={category.id}
                direction="row"
                spacing={1}
                alignItems="center"
                data-testid={`room-category-row-${category.code}`}
              >
                <Typography variant="body2" sx={{ flexGrow: 1 }}>
                  {category.title_i18n || category.code}
                </Typography>
                {/* Число номеров — ответ на вопрос, который задают перед тем,
                    как категорию трогать. */}
                <Typography variant="caption" color="text.secondary">
                  {t('hotel.rooms.categoryRooms', { count: category.rooms_count })}
                </Typography>
                <IconButton
                  size="small"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(category.id)}
                  aria-label={t('common.delete')}
                  data-testid={`room-category-delete-${category.code}`}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))
          )}
          <Divider sx={{ my: 1 }} />
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              label={t('hotel.rooms.categoryNew')}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              inputProps={{ 'data-testid': 'room-category-title' }}
              fullWidth
            />
            <Button
              variant="contained"
              disabled={!title.trim() || create.isPending}
              onClick={() => create.mutate()}
              data-testid="room-category-add"
            >
              {t('common.add')}
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── Bulk range dialog ─────────────────────────────────────────────────── */

function BulkDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  /*
    ОДНО ПОЛЕ ВМЕСТО «С» И «ПО».

    Пара чисел покрывала регулярный корпус и не покрывала ничего больше:
    «3А» после ремонта и «Люкс-1» с террасой заводили поштучно — а из-за этого
    фонд заводили не целиком. Строка принимает и то, и другое: «101-105, 3А,
    Люкс-1». Диапазон по-прежнему пишется как диапазон.
  */
  const [spec, setSpec] = useState('');
  const [floor, setFloor] = useState('');
  const [zone, setZone] = useState('');
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [result, setResult] = useState<RoomBulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const payload = {
    spec: spec.trim(),
    floor: floor.trim(),
    zone: zone.trim(),
    prefix: prefix.trim(),
    suffix: suffix.trim(),
  };

  const asError = (thrown: unknown): string => {
    const code = thrown instanceof ApiError ? thrown.code : '';
    if (code === 'range_too_large') return t('hotel.rooms.bulkTooLarge');
    if (code === 'bad_range') return t('hotel.rooms.bulkBadRange');
    return thrown instanceof ApiError ? thrown.detail : t('errors.generic');
  };

  /*
    ПРЕДПРОСМОТР ХОДИТ НА СЕРВЕР, а не разбирает строку в браузере. Иначе
    появился бы второй разбор той же строки — и день, когда он начнёт
    расходиться с настоящим: показали одно, создали другое.
  */
  const preview = useQuery({
    queryKey: [...queryKeys.rooms, 'bulk-preview', payload],
    queryFn: () => previewBulkRooms(payload),
    enabled: Boolean(payload.spec),
    retry: false,
  });

  const previewData: RoomBulkPreview | undefined = preview.data;
  const previewError = preview.error ? asError(preview.error) : null;

  const mutation = useMutation({
    mutationFn: () => bulkCreateRooms(payload),
    onSuccess: (data) => {
      setError(null);
      setResult(data);
      onDone();
    },
    onError: (mutationError) => setError(asError(mutationError)),
  });

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="room-bulk-dialog">
      <DialogTitle>{t('hotel.rooms.bulkTitle')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('hotel.rooms.bulkSpecHint')}
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {result ? (
            <Alert severity="success" data-testid="room-bulk-result">
              <Typography variant="body2">
                {t('hotel.rooms.bulkResult', {
                  created: result.created.length,
                  skipped: result.skipped.length,
                })}
              </Typography>
              {result.created.length ? (
                <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                  {t('hotel.rooms.bulkCreatedList', { list: result.created.join(', ') })}
                </Typography>
              ) : null}
              {result.skipped.length ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="div"
                  sx={{ wordBreak: 'break-all' }}
                >
                  {t('hotel.rooms.bulkSkippedList', { list: result.skipped.join(', ') })}
                </Typography>
              ) : null}
            </Alert>
          ) : null}

          <TextField
            size="small"
            label={t('hotel.rooms.bulkSpec')}
            placeholder="101-105, 3А, Люкс-1"
            value={spec}
            onChange={(event) => setSpec(event.target.value)}
            inputProps={{ 'data-testid': 'room-bulk-spec' }}
            multiline
            minRows={2}
            fullWidth
          />

          {previewError ? (
            <Alert severity="error" data-testid="room-bulk-preview-error">
              {previewError}
            </Alert>
          ) : null}

          {previewData && !previewError ? (
            <Alert severity="info" data-testid="room-bulk-preview">
              <Typography variant="body2" data-testid="room-bulk-preview-counts">
                {t('hotel.rooms.bulkPreviewCounts', {
                  create: previewData.create_count,
                  exists: previewData.exists_count,
                })}
              </Typography>
              {/* СПИСОК ЦЕЛИКОМ: «будет создано 500» без перечня — это не
                  предпросмотр, а обещание. */}
              <Typography
                variant="caption"
                color="text.secondary"
                component="div"
                sx={{ wordBreak: 'break-all' }}
                data-testid="room-bulk-preview-list"
              >
                {previewData.numbers.join(', ')}
              </Typography>
              {previewData.will_restore.length ? (
                <Typography
                  variant="caption"
                  color="warning.main"
                  component="div"
                  data-testid="room-bulk-preview-restore"
                >
                  {t('hotel.rooms.bulkPreviewRestore', {
                    list: previewData.will_restore.join(', '),
                  })}
                </Typography>
              ) : null}
            </Alert>
          ) : null}

          <Stack direction="row" spacing={2}>
            <TextField
              size="small"
              label={t('hotel.rooms.prefix')}
              value={prefix}
              onChange={(event) => setPrefix(event.target.value)}
              inputProps={{ 'data-testid': 'room-bulk-prefix' }}
              fullWidth
            />
            <TextField
              size="small"
              label={t('hotel.rooms.suffix')}
              value={suffix}
              onChange={(event) => setSuffix(event.target.value)}
              inputProps={{ 'data-testid': 'room-bulk-suffix' }}
              fullWidth
            />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField
              size="small"
              label={t('hotel.rooms.floor')}
              value={floor}
              onChange={(event) => setFloor(event.target.value)}
              inputProps={{ 'data-testid': 'room-bulk-floor' }}
              fullWidth
            />
            <TextField
              size="small"
              label={t('hotel.rooms.zone')}
              value={zone}
              onChange={(event) => setZone(event.target.value)}
              inputProps={{ 'data-testid': 'room-bulk-zone-create' }}
              fullWidth
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
        <Button
          variant="contained"
          /* Создание доступно ровно тогда, когда предпросмотр СОСТОЯЛСЯ и
             показал, что создавать: иначе кнопка обещает неизвестно что. */
          disabled={
            !previewData || Boolean(previewError) || previewData.create_count === 0 || mutation.isPending
          }
          onClick={() => mutation.mutate()}
          data-testid="room-bulk-submit"
        >
          {t('hotel.rooms.bulkSubmitCount', { count: previewData?.create_count ?? 0 })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── QR dialog ─────────────────────────────────────────────────────────── */

function QrDialog({ room, onClose }: { room: Room; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);

  const qrQuery = useQuery({
    queryKey: ['cms', 'rooms', room.id, 'qr'],
    queryFn: () => fetchRoomQrSvg(room.id),
    staleTime: 5 * 60 * 1000,
  });

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadRoomQrPng(room.id, room.number);
    } catch {
      toast.show(t('hotel.rooms.qrError'), 'error');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth data-testid="room-qr-dialog">
      <DialogTitle>{t('hotel.rooms.qrTitle', { number: room.number })}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} alignItems="center">
          {qrQuery.isLoading ? (
            <CircularProgress />
          ) : qrQuery.isError ? (
            <Alert severity="error">{t('hotel.rooms.qrError')}</Alert>
          ) : (
            <Box
              data-testid="room-qr-image"
              sx={{
                width: 240,
                height: 240,
                bgcolor: 'common.white',
                p: 1,
                borderRadius: 1,
                '& svg': { width: '100%', height: '100%' },
              }}
              // The SVG is trusted markup returned by our own API.
              dangerouslySetInnerHTML={{ __html: qrQuery.data ?? '' }}
            />
          )}
          <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
            {room.guest_url}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('hotel.rooms.qrScanHint')}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
        <Button
          variant="contained"
          disabled={downloading}
          onClick={() => void handleDownload()}
          data-testid={`room-qr-download-${room.number}`}
        >
          {t('hotel.rooms.downloadPng')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
