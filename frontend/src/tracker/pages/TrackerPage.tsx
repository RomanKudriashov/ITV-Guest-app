import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import { fetchTrackerBoard } from '../api/tracker';
import { cmsPath } from '@/app/hostRole';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
} from '@dnd-kit/core';

import TextField from '@mui/material/TextField';

import { useListQuery } from '@/kit/list/useListQuery';
import { useMatch, useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { alpha, useTheme } from '@mui/material/styles';
import GroupWorkOutlinedIcon from '@mui/icons-material/GroupWorkOutlined';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/EmptyState';
import { EmptyBoard } from '../components/EmptyBoard';
import { ShiftTiles, type ShiftFocus } from '../components/ShiftTiles';
import { OrdersNumbers } from '@/cms/orders/OrdersNumbers';
import { BoardFilters } from '../components/BoardFilters';
import { RoomGroup } from '../components/RoomGroup';
import { BoardColumn } from '../components/BoardColumn';
import { CancelDialog } from '../components/CancelDialog';
import { ReopenDialog } from '../components/ReopenDialog';
import { OrderCard } from '../components/OrderCard';
import { OrderDetailSheet } from '../components/OrderDetailSheet';
import { TrackerChatPanel } from '../components/TrackerChatPanel';
import { TrackerTopBar } from '../components/TrackerTopBar';
import { useBoardLive, type BoardLiveEvent } from '../hooks/useBoardLive';
import { columnCoordinateGetter } from '../boardKeyboard';
import { insertionIndexAt, neighboursAt } from '../boardInsertion';
import { applyOverlay, useBoardDrag } from '../hooks/useBoardDrag';
import { handoverText, useHandover } from '../hooks/useHandover';
import { useOrderActions } from '../hooks/useOrderActions';
import { usePointSelection } from '../hooks/usePointSelection';
import { useTrackerSound } from '../hooks/useTrackerSound';
import {
  useTrackerBoard,
  useTrackerChatThreads,
  useTrackerLanguage,
  useTrackerOrder,
  useTrackerPoints,
} from '../hooks/useTrackerQueries';
import { isTransportFailure, trackerErrorMessage } from '../errors';
import type { TrackerOrder, TrackerScope } from '../api/types';
import { useAuth } from '@/auth';

/** How long a freshly changed order keeps its ring. */
const HIGHLIGHT_MS = 30_000;
/** Fallback polling while the socket is down. */
const OFFLINE_POLL_MS = 15_000;

export function TrackerPage() {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigate = useNavigate();
  const wide = useMediaQuery(theme.breakpoints.up('md'));
  const language = useTrackerLanguage();
  /*
    Порог захвата — 8 пикселей. Стандартные четыре мало для кухни: палец
    съезжает на пять-шесть при обычном нажатии, и часть тапов по ручке
    превращалась бы в микро-перетаскивания без цели.
  */
  /*
    ТАП И ПЕРЕНОС РАЗЛИЧАЮТСЯ ПОРОГОМ, И ПОРОГ РАЗНЫЙ ПО ПРИРОДЕ ВВОДА.

    Один `PointerSensor` на оба ввода не годится, когда тянется ВСЯ карточка:
    порог в пикселях, честный для мыши, на пальце ломает и тап, и прокрутку.

      мышь   — восемь пикселей смещения. Дрожание руки на клике меньше;
      палец  — двести миллисекунд удержания с допуском в восемь пикселей.
               Тап короче — карточка открывается. Прокрутка доски уводит палец
               дальше допуска в первые же миллисекунды — захват отменяется, и
               доска листается, а не едет карточка.

    Клавиатура — третьим сенсором: `onDragEnd` к ней готов давно, в нём стоит
    отдельная проверка перехода «клавиатурный жест не обязан знать про правило».
  */
  /*
    ЦЕЛЬ ИЩЕТСЯ УКАЗАТЕЛЕМ, А ЕСЛИ ЕГО НЕТ — БЛИЖАЙШИМ ЦЕНТРОМ.

    Стоял один `pointerWithin`, и это тихо ломало клавиатуру: у неё указателя
    НЕТ ВОВСЕ, детектор возвращал пустоту, `event.over` приходил `null` — и
    бросок молча не делал ничего. Сенсор при этом был подключён, наложение
    поднималось и ехало, то есть жест выглядел рабочим до последнего шага.

    Указатель остаётся первым: он точнее и позволяет целиться между колонками.
  */
  /** Где палец/курсор по вертикали прямо сейчас; `null` — жест клавиатурный. */
  const pointerY = useRef<number | null>(null);

  const boardCollision = useCallback<CollisionDetection>((args) => {
    /*
      ЗАПАСНОЙ ПУТЬ — ТОЛЬКО ТАМ, ГДЕ УКАЗАТЕЛЯ НЕТ ВОВСЕ.

      Первая версия падала на `byPointer.length` — и это ломало ПРОМАХ: палец
      или мышь вне всех колонок дают пустой список так же, как его даёт
      клавиатура, и «мимо» превращалось в «положить в ближайшую». Три проверки
      покраснели разом, и поделом: угадывать за человека, куда он хотел,
      когда он явно бросил мимо, — хуже, чем не сделать ничего.

      Разделяет их `pointerCoordinates`: у клавиатуры он `null`, у указателя —
      всегда координата, даже если она над пустотой.
    */
    if (args.pointerCoordinates) {
      // Координата курсора нужна ещё и зазору: место в колонке теперь выбирают,
      // и щель обязана быть там, куда человек смотрит. Детектор — единственное
      // место жеста, где эта координата есть на каждом движении.
      pointerY.current = args.pointerCoordinates.y;
      return pointerWithin(args);
    }
    // Клавиатура координат не даёт — и место там выбирают стрелками, а не
    // щелью. Обнуляем, чтобы прошлая мышиная координата не обещала лишнего.
    pointerY.current = null;

    /*
      У КЛАВИАТУРЫ ЦЕЛЬ ВЫБИРАЕТ `closestCenter` — БЛИЖАЙШАЯ КОЛОНКА.

      Здесь стоял свой выбор: «колонка, чей горизонтальный диапазон НАКРЫВАЕТ
      центр несомой карточки». Он появился, когда стрелки двигали карточку и
      по вертикали тоже, и центр уезжал вниз, сбивая `closestCenter`.

      Вертикаль с тех пор переехала в отдельное действие (Alt+↑/↓ на карточке),
      и накрытие стало не нужным, а вредным: `KeyboardSensor` применяет
      возвращённую координату НЕ ЦЕЛИКОМ — замерено ещё в партии 3, — и при
      неполном шаге центр карточки остаётся в своей колонке. Цель не менялась,
      и жест завершался перестановкой внутри неё: законным, но совсем другим
      действием. Ближайший центр переживает неполный шаг, накрытие — нет.
    */
    /*
      У КЛАВИАТУРЫ КОЛОНКА ВЫБИРАЕТСЯ ПО ГОРИЗОНТАЛИ, А НЕ ПО БЛИЗОСТИ ЦЕНТРОВ.

      `closestCenter` сравнивает центры целиком — и по вертикали тоже. Пока
      стрелки двигали карточку только между колонками, это работало; с длинной
      колонкой центр уезжает вниз, и ближайшей по расстоянию оказывается
      соседняя колонка — шаг вбок оборачивался чужой целью.

      Колонка — вертикальная полоса, поэтому и выбирается она по горизонтали:
      та, чей диапазон накрывает центр несомой карточки.

      ОТДЕЛЬНО: сам жест на экране не виден — наложение при клавиатурном
      переносе не двигается (замер: x=378 до шага и после), `onDragMove` и
      `onDragOver` не приходят, зазор не рисуется. Перенос при этом работает.
      Показывать зазор по цели из детектора я пробовал и откатил: он
      расходился с целью, которую dnd-kit берёт при отпускании, то есть на
      экране появлялся второй ответ на вопрос «куда ляжет», иногда неверный.
      Видимость клавиатурного жеста — отдельная работа.
    */
    return closestCenter(args);
  }, []);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnCoordinateGetter }),
  );
  const detailMatch = useMatch('/tracker/order/:id');
  const openOrderId = detailMatch?.params.id ?? null;

  const [scope, setScope] = useState<TrackerScope>('active');
  const [activeColumn, setActiveColumn] = useState<string | null>(null);
  /** Колонка под курсором во время жеста — по ней рисуется зазор. */
  const [overColumn, setOverColumn] = useState<string | null>(null);
  /** Место в этой колонке, куда карточка ляжет; `null` — зазора нет. */
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [highlighted, setHighlighted] = useState<Record<string, number>>({});
  const [pollMs, setPollMs] = useState<number | undefined>(undefined);
  const [cancelTarget, setCancelTarget] = useState<TrackerOrder | null>(null);
  /*
    ПОСЛЕДНИЙ ШАГ, КОТОРЫЙ ЕЩЁ МОЖНО ОТМЕНИТЬ.

    В прошлой партии «Отменить» не строилось сознательно: вернуть статус назад
    было нечем, и кнопка обещала бы то, чего сервер не умеет. Условие
    изменилось — возврат разрешён, — и обещание стало выполнимым.

    Спрашивать подтверждение здесь не надо, даже если заказ уехал в
    «Доставлено»: человек отменяет СВОЁ действие, сделанное секунду назад, и
    второй вопрос подряд — помеха, а не защита. Вопрос остаётся там, где
    закрытую карточку трогают спустя время.
  */
  const [undo, setUndo] = useState<{ orderId: string; number: number; back: string } | null>(null);
  /** Закрытый заказ, который просят вернуть в работу, и куда именно. */
  const [reopenTarget, setReopenTarget] = useState<{ order: TrackerOrder; code: string } | null>(
    null,
  );
  const [chatOpen, setChatOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Threads drive the top-bar badge; the socket of an open thread invalidates
  // this query so the count moves on its own.
  const threadsQuery = useTrackerChatThreads();
  const chatUnread = (threadsQuery.data ?? []).reduce((sum, thread) => sum + thread.unread, 0);

  const { user } = useAuth();
  const pointsQuery = useTrackerPoints();
  const points = pointsQuery.data?.points;
  const { selected: pointCode, select } = usePointSelection(points);

  // День ленты записей. Пустая строка = «сегодня по времени отеля»: считать
  // сегодняшнюю дату на клиенте нельзя — у отеля своя таймзона, и в полночь
  // клиент и сервер разошлись бы на сутки.
  const [day, setDay] = useState('');
  /*
    Поиск на доске — в адресе и НА СЕРВЕРЕ.

    719 заказов, и человек ищет конкретный: по номеру заказа или по номеру
    комнаты. Отсев уже полученной доски врал бы так же, как врал журнал
    платформы, а живой контур при этом не ломается: нефильтрованный снимок из
    сокета в отфильтрованную доску не подменяется, она перечитывает своё.
  */
  const {
    params: listParams,
    patch: patchList,
    reset: resetList,
  } = useListQuery({
    search: '',
    focus: '',
    // Фильтры панели. Флаги строками, а не булевыми: адрес — это строки, и
    // «1» переживает обновление страницы одинаково во всех браузерах.
    mine: '',
    unassigned: '',
    overdue: '',
    assignee: '',
    order_type: '',
    // Только для истории: период по моменту ЗАКРЫТИЯ и точная комната.
    since: '',
    until: '',
    room: '',
  });
  const focus = listParams.focus as ShiftFocus;
  const filters = useMemo(
    () => ({
      mine: listParams.mine,
      unassigned: listParams.unassigned,
      overdue: listParams.overdue,
      assignee: listParams.assignee,
      order_type: listParams.order_type,
      since: listParams.since,
      until: listParams.until,
      room: listParams.room,
    }),
    [
      listParams.mine,
      listParams.since,
      listParams.until,
      listParams.room,
      listParams.unassigned,
      listParams.overdue,
      listParams.assignee,
      listParams.order_type,
    ],
  );
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const boardQuery = useTrackerBoard(
    pointCode,
    scope,
    pollMs,
    day || undefined,
    listParams.search,
    focus,
    filters,
  );
  const sound = useTrackerSound();
  const actions = useOrderActions();

  // Sound fires on the EVENT, not on every snapshot: a snapshot arrives on every
  // status change of every order, and a kitchen that beeps constantly gets muted.
  const soundRef = useRef(sound.play);
  soundRef.current = sound.play;

  const onLiveEvent = useCallback((message: BoardLiveEvent) => {
    if (message.event === 'order.created') soundRef.current();
    if (message.orderId) {
      const id = message.orderId;
      setHighlighted((previous) => ({ ...previous, [id]: Date.now() }));
    }
  }, []);

  const { status: live, hold } = useBoardLive(pointCode, Boolean(pointCode), onLiveEvent);

  // The socket owns the board; polling is the honest fallback when it is down.
  useEffect(() => {
    setPollMs(live === 'online' ? undefined : OFFLINE_POLL_MS);
  }, [live]);

  // Expire highlights so the board calms down on its own.
  useEffect(() => {
    if (!Object.keys(highlighted).length) return;
    const timer = window.setTimeout(() => {
      const cutoff = Date.now() - HIGHLIGHT_MS;
      setHighlighted((previous) => {
        const next = Object.fromEntries(
          Object.entries(previous).filter(([, at]) => at > cutoff),
        );
        return Object.keys(next).length === Object.keys(previous).length ? previous : next;
      });
    }, HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlighted]);

  const rawColumns = useMemo(() => boardQuery.data?.columns ?? [], [boardQuery.data]);
  const boardPoint = boardQuery.data?.point;
  const shift = boardQuery.data?.shift;
  /** Цифры по выборке — приходят только для истории. */
  const selection = boardQuery.data?.selection;

  /*
    «ПОКАЗАТЬ БОЛЬШЕ»: СЕРВЕР ЛИСТАЛ ДАВНО, ЭКРАН — НЕТ.

    Курсор приезжал в каждом ответе (`next_cursor`) и молча пропадал: история
    обрывалась на первой странице, и человек видел ровно столько, сколько
    влезло, без единого признака, что дальше что-то есть. С окном в сутки это
    было почти незаметно, без окна — история стала в двадцать раз длиннее.

    Догруженное живёт в состоянии страницы, а не в кэше запроса: снимок доски
    приходит целиком и заменяет первую страницу, и подмешивать к нему хвост
    значило бы показывать два разных момента времени как один список.
  */
  const [extraOrders, setExtraOrders] = useState<TrackerOrder[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Новая выборка — новое листание: хвост от прошлого фильтра к ней не
  // относится.
  useEffect(() => {
    setExtraOrders([]);
    setHistoryCursor(boardQuery.data?.next_cursor ?? null);
    // Зависимость — КУРСОР, а не весь снимок. Снимок приходит новым объектом
    // на каждый опрос, и сброс по нему перерисовывал страницу посреди
    // клавиатурного жеста: dnd-kit пересчитывал прямоугольники колонок, шаг
    // стрелки терялся, и жест сводился к перестановке внутри своей колонки.
  }, [boardQuery.data?.next_cursor]);

  const loadMoreHistory = async () => {
    if (!historyCursor || !pointCode) return;
    setLoadingMore(true);
    try {
      const body = await fetchTrackerBoard(
        pointCode,
        'history',
        language,
        undefined,
        listParams.search,
        focus,
        { ...filters, cursor: historyCursor },
      );
      const rows = body.columns.flatMap((column) => column.orders);
      setExtraOrders((previous) => [...previous, ...rows]);
      setHistoryCursor(body.next_cursor ?? null);
    } finally {
      setLoadingMore(false);
    }
  };
  /*
    Можем ли мы утверждать, что заявок НЕТ.

    Сокет упал — это ещё не «мы ничего не знаем»: доска переходит на опрос раз
    в 15 секунд, и пока опрос отвечает, пустота настоящая. Не знаем мы её
    только когда молчат оба канала: тогда и говорим об этом, а не показываем
    спокойный итог смены поверх копящихся на сервере заявок.
  */
  const boardUnconfirmed =
    live === 'offline' &&
    (!boardQuery.dataUpdatedAt || Date.now() - boardQuery.dataUpdatedAt > OFFLINE_POLL_MS * 2);

  // Which shape the server asked for. Records (spa) come as one ordered day —
  // grouping an appointment by status would hide the only thing that matters
  // there, which is who comes next.
  const timeline = boardQuery.data?.layout === 'timeline' && scope === 'active';

  // Сервер отвечает, какой день показал (в таймзоне отеля) — от него и шагаем.
  // Здесь и в проверке вкладки берём ИСХОДНЫЕ колонки: наложение переносит
  // карточки между колонками, но самих колонок не создаёт и не удаляет.
  const shownDay = rawColumns[0]?.date ?? '';
  const shiftDay = useCallback(
    (days: number) => {
      if (!shownDay) return;
      const next = new Date(`${shownDay}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + days);
      setDay(next.toISOString().slice(0, 10));
    },
    [shownDay],
  );

  // Keep the phone tab valid when the preset changes under our feet.
  useEffect(() => {
    if (!rawColumns.length) return;
    if (rawColumns.some((column) => column.code === activeColumn)) return;
    setActiveColumn(rawColumns[0].code);
  }, [rawColumns, activeColumn]);

  const allOrders = useMemo(
    () => rawColumns.flatMap((column) => column.orders),
    [rawColumns],
  );

  const drag = useBoardDrag(allOrders, hold);
  /*
    Колонки, которые видит человек: снимок сервера плюс наложение того, что мы
    уже переложили и чей ответ ещё не пришёл. Правится НАД снимком, а не в нём:
    снимок — единственная правда, с которой мы сверяемся.
  */
  const columns = useMemo(() => {
    const withOverlay = applyOverlay(rawColumns, drag.overlay);
    // Догруженный хвост истории дописывается В КОНЕЦ единственной колонки:
    // история приходит одной лентой, и место записи в ней задано сервером.
    if (!extraOrders.length) return withOverlay;
    return withOverlay.map((column, index) =>
      index === 0 ? { ...column, orders: [...column.orders, ...extraOrders] } : column,
    );
  }, [rawColumns, drag.overlay, extraOrders]);

  // Кто увёл заказ, пока мы на него смотрели. Считается по НЕФИЛЬТРОВАННОМУ
  // составу: под включённым фильтром заказ исчезает и просто потому, что
  // перестал подходить, и объявлять это чужим действием было бы враньём.
  const handover = useHandover(activeFilters || listParams.search || focus ? undefined : allOrders);

  /*
    Бросок. Разрешённость проверена дважды — колонкой, которая не приняла бы
    недопустимый бросок, и хуком, — а сервер проверяет в третий раз и остаётся
    последним словом.
  */
  /*
    ГДЕ СЕЙЧАС ЖЕСТ ПО ВЕРТИКАЛИ.

    У мыши и пальца это координата указателя. У КЛАВИАТУРЫ указателя нет вовсе,
    и раньше это значило «зазора не будет»: человек, работающий стрелками,
    видел бы, как карточка едет, но не видел бы, куда она ляжет. Для него
    вертикаль жеста — середина самой несомой карточки, которую dnd-kit двигает
    стрелками; ответ получается тот же по смыслу.
  */
  const gestureY = useCallback(
    (event: {
      delta?: { y: number };
      active: {
        rect: {
          current: {
            initial: { top: number; height: number } | null;
            translated: { top: number; height: number } | null;
          };
        };
      };
    }) => {
      if (pointerY.current !== null) return pointerY.current;
      /*
        Клавиатурный сдвиг берётся ИЗ `delta`, а не из `translated`.

        `translated` в момент этого обработчика ещё показывает исходное место:
        замерено — после стрелки вниз зазор оставался наверху колонки, то есть
        там, откуда карточку взяли. `delta` же обновляется сразу и говорит
        ровно то, что нужно: на сколько карточка уехала от старта.
      */
      const initial = event.active.rect.current.initial;
      if (initial) return initial.top + (event.delta?.y ?? 0) + initial.height / 2;
      const box = event.active.rect.current.translated;
      return box ? box.top + box.height / 2 : null;
    },
    [],
  );

  const handleDrop = useCallback(
    (orderId: string, target: string | null, index: number | null) => {
      const order = allOrders.find((candidate) => candidate.id === orderId) ?? null;
      const status = drag.onDragEnd(orderId, target);

      /*
        БРОСОК ТЕПЕРЬ ДЕЛАЕТ ДВЕ РАЗНЫЕ ВЕЩИ, И РАЗЛИЧАЕТ ИХ КОЛОНКА.

        Чужая колонка — смена статуса; своя — перестановка в очереди. Место в
        обоих случаях просится отдельным запросом, ПОСЛЕ смены статуса: сервер
        кладёт переехавшую карточку в хвост целевой колонки, и если человек
        нёс её в середину, хвост — не то, что он видел под курсором.

        Перестановка молчалива: у неё нет «чужих рук». Заказ, который увели,
        отзовётся отказом на самой смене статуса, а перестановка чужого заказа
        просто не найдёт соседей и вернёт понятный отказ карточке.
      */
      const reorderTo = (): void => {
        const column = columns.find((candidate) => candidate.code === (target ?? ''));
        if (!column || index === null) return;
        void actions.moveTo(orderId, neighboursAt(column.orders, orderId, index));
      };

      if (!status) {
        // Своя колонка — только перестановка. Промах мимо всех колонок
        // (`target === null`) не делает ничего: угадывать за человека нельзя.
        if (target && order?.status.code === target) reorderTo();
        return;
      }
      // В реестр — ДО запроса: ответ может прийти позже снимка, и заказ,
      // отмеченный после ответа, успел бы объявиться «уведённым чужим».
      handover.mark(orderId);
      void actions
        .changeStatus(orderId, status, (error: unknown) => {
          /*
            ОТКАЗ ПОСЛЕ БРОСКА — ЧАЩЕ ВСЕГО ЧУЖИЕ РУКИ, И ЭТО НАДО СКАЗАТЬ.

            Снимки на время жеста придержаны, а свой заказ мы пометили `mark`
            до запроса — значит, сравнение снимков об этом промолчит: заказ
            числится нашим. Человек получил бы сухое «нельзя перейти» и решил,
            что запретила система, хотя карточку увёл сосед по смене.

            Признак узкий: перенос БЫЛ разрешён в момент захвата
            (`next_statuses` отдал эту колонку), а сервер его не принял. Значит,
            между захватом и броском статус заказа изменился — не нами.
          */
          const code = error instanceof ApiError ? error.code : '';
          /*
            ГОЛОГО 404 ЗДЕСЬ БЫТЬ НЕ ДОЛЖНО.

            «Не найден» — это не только чужие руки. Заказ пропадает и от
            обычной уборки стенда, и от закрытия смены, и от удаления
            администратором; на демо-стенде уборка съедала их десятками. Сказать
            в этот момент «успел передвинуть кто-то другой» значит назвать
            человека, которого не было.

            Чужие руки опознаёт узкий признак: перенос БЫЛ разрешён в момент
            захвата (`next_statuses` отдал эту колонку), а сервер ответил, что
            переход невозможен — значит статус изменился между захватом и
            броском. Отсутствие заказа — отдельная новость, и у неё свои слова.
          */
          if (code === 'invalid_transition') {
            handover.announce({
              kind: 'moved',
              number: order?.number ?? 0,
              who: order?.assignee?.name ?? null,
            });
          } else if (code === 'order_not_found' || (error instanceof ApiError && error.status === 404)) {
            handover.announce({ kind: 'vanished', number: order?.number ?? 0, who: null });
          }
        })
        .then((moved) => {
          // Место просим только если смена статуса удалась: иначе карточка
          // осталась в прежней колонке, и «поставь между этими» относилось бы
          // к очереди, в которую она не попала.
          if (moved) reorderTo();
        })
        .finally(() => drag.settle(orderId));
    },
    [actions, allOrders, columns, drag, handover],
  );
  const boardOrder = allOrders.find((order) => order.id === openOrderId) ?? null;
  /** Карточка, которую несут: её рисует наложение и по ней считается зазор. */
  const draggedOrder = allOrders.find((order) => order.id === drag.draggingId) ?? null;

  // The snapshot wins: tapping a card must not cost a request. The dedicated
  // endpoint is only for a cold deep link — another point, the history scope, or
  // a page opened straight from a message.
  const detailQuery = useTrackerOrder(
    openOrderId ?? undefined,
    Boolean(openOrderId) && !boardOrder && !boardQuery.isLoading,
  );
  const openOrder = boardOrder ?? detailQuery.data ?? null;

  const closeDetail = useCallback(() => navigate('/tracker'), [navigate]);

  const errorFor = (order: TrackerOrder): string | null =>
    actions.actionError && actions.actionError.orderId === order.id
      ? trackerErrorMessage(actions.actionError.error, t)
      : null;

  /*
    СМЕНА СТАТУСА С КНОПКИ — ОДНА ДВЕРЬ ДЛЯ ВСЕХ ЭКРАНОВ.

    Закрытый заказ выпускается только через вопрос: гость уже видел
    «доставлено», смена уже отчиталась, и одно неточное касание по карточке не
    имеет права это отменить. Рабочий заказ идёт сразу — там вопрос был бы
    помехой на каждом втором нажатии.

    Дверь одна, потому что экранов два (доска и подробности), и второй обход
    правила завёлся бы ровно там, где про него забыли.
  */
  const requestStatus = (order: TrackerOrder, code: string) => {
    if (order.status.is_terminal) {
      setReopenTarget({ order, code });
      return;
    }
    const back = order.status.code;
    handover.mark(order.id);
    void actions.changeStatus(order.id, code).then((moved) => {
      // Предложение отменить появляется только у УДАВШЕГОСЯ шага: отменять
      // нечего, если сервер отказал, а сообщение об отказе уже на карточке.
      if (moved) setUndo({ orderId: order.id, number: order.number, back });
    });
  };

  /*
    ПЕРЕСТАНОВКА С КЛАВИАТУРЫ — ШАГ ЧЕРЕЗ ОДНОГО СОСЕДА.

    Соседи считаются по СПИСКУ КОЛОНКИ, а не по разметке: здесь не жест, и
    мерить прямоугольники незачем — порядок известен из самих данных доски.

    Шаг вниз меняет карточку местами со следующей, вверх — с предыдущей. У
    края колонки шага нет: делать вид, что нажатие сработало, хуже, чем не
    сделать ничего.
  */
  const reorderByKeyboard = (order: TrackerOrder, direction: -1 | 1) => {
    const column = columns.find((candidate) =>
      candidate.orders.some((candidateOrder) => candidateOrder.id === order.id),
    );
    if (!column) return;
    const here = column.orders.findIndex((candidate) => candidate.id === order.id);
    const target = here + direction;
    if (target < 0 || target >= column.orders.length) return;
    // Место считается СРЕДИ ОСТАЛЬНЫХ: собственная карточка из счёта выпадает,
    // поэтому индекс соседки и есть новое место — шаг вниз ставит карточку
    // после неё, шаг вверх — перед ней.
    void actions.moveTo(order.id, neighboursAt(column.orders, order.id, target));
  };

  const renderCard = (order: TrackerOrder, draggable = false) => (
    <OrderCard
      key={order.id}
      order={order}
      draggable={draggable}
      busy={actions.pendingOrderId === order.id}
      highlighted={Boolean(highlighted[order.id])}
      errorText={errorFor(order)}
      onOpen={() => navigate(`/tracker/order/${order.id}`)}
      onAccept={() => {
        handover.mark(order.id);
        void actions.accept(order.id);
      }}
      onStatus={(code) => requestStatus(order, code)}
      onCancel={() => setCancelTarget(order)}
      onReorder={(direction) => reorderByKeyboard(order, direction)}
    />
  );

  // ---- gates ---------------------------------------------------------------

  if (pointsQuery.isLoading) {
    return (
      // Высота по содержимому: экран теперь внутри оболочки, и `100vh`
      // добавлял бы к её шапке ещё один полный экран пустоты.
      <Stack sx={{ py: 10 }} alignItems="center" justifyContent="center">
        <CircularProgress aria-label={t('tracker.loading')} />
      </Stack>
    );
  }

  if (pointsQuery.error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void pointsQuery.refetch()}>
              {t('tracker.retry')}
            </Button>
          }
        >
          {trackerErrorMessage(pointsQuery.error, t)}
        </Alert>
      </Box>
    );
  }

  // No assignment is not an error — it is a different screen, not an empty board.
  if (!points?.length) {
    return (
      <Box data-testid="tracker-screen">
        <TrackerTopBar
          points={[]}
          onSelect={select}
          live={live}
          soundEnabled={sound.enabled}
          onToggleSound={sound.toggle}
          chatUnread={chatUnread}
          onOpenChat={() => setChatOpen(true)}
        />
        <TrackerChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
        <Box data-testid="tracker-no-points" sx={{ pt: 6 }}>
          <EmptyState
            icon={<GroupWorkOutlinedIcon fontSize="large" />}
            title={t('tracker.noPoints.title')}
            description={t('tracker.noPoints.body')}
            /*
              КНОПКА В CMS — ТОЛЬКО ТЕМ, КОГО ТУДА ПУСКАЮТ.

              Она стояла здесь всегда и вела линейного сотрудника ровно в тот
              отказ, из которого он сюда и пришёл: трекер → CMS → «сюда
              нельзя» → кнопка «на трекер». Петля между двумя отказами.

              У человека без привязки дела в CMS нет и быть не может: его
              вопрос решает администратор отеля, и об этом сказано текстом.
            */
            action={
              user?.has_cms_access ? (
                <Button variant="outlined" onClick={() => navigate(cmsPath('/menu'))} sx={{ minHeight: 44 }}>
                  {t('tracker.toCms')}
                </Button>
              ) : null
            }
          />
        </Box>
      </Box>
    );
  }

  const currentColumn =
    columns.find((column) => column.code === activeColumn) ?? columns[0] ?? null;

  return (
    <Box data-testid="tracker-screen">
      <TrackerTopBar
        points={points}
        selected={pointCode}
        onSelect={select}
        live={live}
        soundEnabled={sound.enabled}
        onToggleSound={sound.toggle}
        chatUnread={chatUnread}
        onOpenChat={() => setChatOpen(true)}
      />

      {/*
        ОБЫЧНЫЕ ВКЛАДКИ, КАК В «УВЕДОМЛЕНИЯХ».

        Было `variant="fullWidth"` — две плашки во весь экран, растянутые под
        мобильную раскладку и оставшиеся такими в вебе. В панели вкладки
        выглядят иначе везде, кроме этого экрана, и трекер читался как чужой.
      */}
      <Tabs
        value={scope}
        onChange={(_event, next: TrackerScope) => setScope(next)}
        sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}
      >
        <Tab value="active" label={t('tracker.scope.active')} data-testid="tracker-active-tab" />
        <Tab value="history" label={t('tracker.scope.history')} data-testid="tracker-history-tab" />
      </Tabs>

      {!wide && columns.length && !timeline ? (
        <Tabs
          value={currentColumn?.code ?? false}
          onChange={(_event, next: string) => setActiveColumn(next)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
        >
          {columns.map((column) => (
            <Tab
              key={column.code}
              value={column.code}
              data-testid={`tracker-tab-${column.code}`}
              sx={{ minHeight: 48 }}
              /*
                Счётчик стоит В СТРОКЕ с названием, а не значком поверх него.
                Значок висел на `right: -12`, то есть ЗА границей вкладки, и на
                телефоне его срезало вместе с числом: «4|5» вместо «4» и «5» —
                повар видел обрубок и не понимал, сколько заказов в колонке.
                Строка ужимается вместе с вкладкой и обрезаться не может.
              */
              label={
                <Box
                  component="span"
                  sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}
                >
                  {column.title}
                  <Box
                    component="span"
                    sx={(th) => ({
                      minWidth: 20,
                      px: 0.6,
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      lineHeight: '18px',
                      bgcolor: alpha(th.palette.primary.main, 0.16),
                      color: th.palette.primary.main,
                    })}
                  >
                    {column.orders.length}
                  </Box>
                </Box>
              }
            />
          ))}
        </Tabs>
      ) : null}

      {/*
        Сводка смены. Приезжает В ТОМ ЖЕ ответе, что и колонки, и в том же
        снимке из сокета — поэтому числа над доской и карточки под ней не могут
        разойтись.
      */}
      {/*
        НАД ИСТОРИЕЙ — ЦИФРЫ ВЫБОРКИ, А НЕ СВОДКА СМЕНЫ.

        Плитки «Новых» и «В работе» на истории показывали числа АКТИВНОЙ доски
        (замер: 150 и 52 при 36 карточках в списке) — человек видел «Новых 150»
        там, где ни одного нового заказа нет, и плитка была ещё и кликабельной.
        «Сделано» и «Скорость» тоже были не про список: они считаются за смену,
        а история теперь без окна.

        Компонент тот же, что в разделе «Заказы»: одинаковые числа обязаны
        выглядеть одинаково, иначе через полгода их будет два разных.
      */}
      {scope === 'history' && selection ? (
        <OrdersNumbers summary={selection} />
      ) : shift ? (
        <ShiftTiles
          shift={shift}
          focus={focus}
          // «Просрочено» у плитки и «только просроченные» в панели — ОДИН
          // параметр. Иначе на экране было бы два ответа на один вопрос, и
          // однажды они разошлись бы.
          overdueOn={listParams.overdue === '1'}
          onFocus={(next) => patchList({ focus: next })}
          onOverdue={(on) => patchList({ overdue: on ? '1' : '' })}
        />
      ) : null}

      <BoardFilters
        open={filtersOpen}
        history={scope === 'history'}
        onToggle={() => setFiltersOpen((value) => !value)}
        values={filters}
        onChange={(next) => patchList(next)}
        onReset={resetList}
        assignees={boardQuery.data?.assignees ?? []}
        activeCount={activeFilters}
      />

      {/*
        ПОРОГ ПРОСРОЧКИ НАЗВАН СЛОВАМИ.

        Красная метка на карточке молчала о том, откуда она берётся, и человек
        не мог понять, много двадцать минут или мало для этой точки. Порог —
        настройка ТОЧКИ (`sla_minutes`), у кухни и у консьержа он разный;
        поэтому строка стоит на доске, а не в общих настройках, и берёт число
        из того же ответа, из которого приехали карточки.

        И говорит, ОТКУДА он взялся. «Позже 240 минут» без этого читается как
        чья-то настройка, и управляющий идёт искать, кто её поставил, — хотя
        никто не ставил, это умолчание вида работы.
      */}
      {boardPoint?.sla_minutes ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', px: { xs: 1.5, md: 2 }, pt: { xs: 1.5, md: 2 } }}
          data-testid="tracker-sla-hint"
        >
          {t(
            boardPoint.sla_source === 'type'
              ? 'tracker.board.slaHintDefault'
              : 'tracker.board.slaHint',
            { minutes: boardPoint.sla_minutes },
          )}
        </Typography>
      ) : null}

      {/* Поиск по доске. Рядом с ней, а не в шапке: он про эту доску. */}
      <Box sx={{ px: { xs: 1.5, md: 2 }, pt: { xs: 1.5, md: 2 } }}>
        <TextField
          size="small"
          fullWidth
          value={listParams.search}
          onChange={(event) => patchList({ search: event.target.value })}
          placeholder={t('tracker.searchPlaceholder')}
          inputProps={{ 'data-testid': 'tracker-search', inputMode: 'numeric' }}
        />
      </Box>

      <Box sx={{ p: { xs: 1.5, md: 2 } }} data-testid="tracker-board">
        {boardQuery.isLoading ? (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress aria-label={t('tracker.loading')} />
          </Stack>
        ) : boardQuery.error && !isTransportFailure(boardQuery.error) ? (
          // Сервер ОТВЕТИЛ отказом — называем причину и даём повторить.
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => void boardQuery.refetch()}>
                {t('tracker.retry')}
              </Button>
            }
          >
            {trackerErrorMessage(boardQuery.error, t)}
          </Alert>
        ) : boardQuery.error ? (
          /*
            До сервера не достучались, и доски у нас нет. Это НЕ «заявок нет» и
            не «сервер отказал»: молчащая доска читается как «работы нет», и
            смена спокойно ждёт, пока заявки копятся на сервере. Говорим то же,
            что при неподтверждённой пустоте, — потому что случай тот же.
          */
          <Box data-testid="tracker-empty">
            <EmptyBoard shift={undefined} unconfirmed language={language} />
          </Box>
        ) : !allOrders.length && !timeline ? (
          // У ленты пустой день — не пустая доска: переключатель дня обязан
          // остаться, иначе из пустого сегодня некуда шагнуть.
          <Box data-testid="tracker-empty">
            {/* Под поиском или срезом — «ничего не найдено», а не «доска
                пуста»: это разные ответы, и второй заставил бы искать
                несуществующую причину, почему заказов «нет». */}
            {listParams.search || focus || activeFilters ? (
              <EmptyState
                title={t('list.nothingFound')}
                description={t('list.nothingFoundHint')}
              />
            ) : scope === 'history' ? (
              <EmptyState
                title={t('tracker.board.emptyHistoryTitle')}
                description={t('tracker.board.emptyHistoryBody')}
              />
            ) : (
              // Три разных «пусто» разведены внутри: затишье со сводкой,
              // начало смены, обрыв связи. Последнее — вообще не пустота.
              <EmptyBoard shift={shift} unconfirmed={boardUnconfirmed} language={language} />
            )}
          </Box>
        ) : timeline ? (
          // Лента записей: один день по времени слота, во всю ширину. Колонок
          // здесь нет по существу задачи, а не ради экономии места.
          <Box
            sx={{ maxWidth: 720, mx: 'auto' }}
            data-testid="tracker-timeline"
            // День, который РЕАЛЬНО показан, — в таймзоне отеля. Клиенту он
            // нужен и для шага по дням, и чтобы не вычислять «сегодня» самому.
            data-day={shownDay}
          >
            {columns.map((column) => (
              <Stack key={column.code} spacing={1.5}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Button
                    size="small"
                    onClick={() => shiftDay(-1)}
                    data-testid="tracker-day-prev"
                    sx={{ minWidth: 44 }}
                  >
                    ←
                  </Button>
                  <Typography variant="overline" color="text.secondary" sx={{ flexGrow: 1 }}>
                    {t('tracker.board.day', { date: column.date ?? column.title })}
                  </Typography>
                  {day ? (
                    <Button size="small" onClick={() => setDay('')} data-testid="tracker-day-today">
                      {t('tracker.board.today')}
                    </Button>
                  ) : null}
                  <Button
                    size="small"
                    onClick={() => shiftDay(1)}
                    data-testid="tracker-day-next"
                    sx={{ minWidth: 44 }}
                  >
                    →
                  </Button>
                </Stack>
                {column.orders.length ? (
                  column.orders.map((order) => renderCard(order))
                ) : (
                  <EmptyState
                    title={t('tracker.board.emptyTimelineTitle')}
                    description={t('tracker.board.emptyTimelineBody')}
                  />
                )}
              </Stack>
            ))}
          </Box>
        ) : wide ? (
          /*
            Перетаскивание — ТОЛЬКО на широком экране. На телефоне колонки
            показаны по одной вкладкой, и бросать физически некуда: цель не
            видна. Там статус двигают кнопкой на карточке, как и раньше.
          */
          <DndContext
            sensors={sensors}
            collisionDetection={boardCollision}
            onDragStart={(event) => drag.onDragStart(String(event.active.id))}
            onDragCancel={() => {
              setOverColumn(null);
              setOverIndex(null);
              drag.onDragCancel();
            }}
            onDragMove={(event) => {
              /*
                ЦЕЛЬ ЧИТАЕТСЯ ЗДЕСЬ ЖЕ, А НЕ БЕРЁТСЯ ИЗ `onDragOver`.

                `onDragOver` срабатывает на СМЕНУ цели. Пока карточку носят
                внутри её собственной колонки, цель не меняется ни разу — и
                зазор не появлялся вовсе: ровно в том жесте, ради которого
                ручной порядок и заводили. Замерено пробой на живой доске.

                Место пересчитывается на каждом движении: внутри колонки
                курсор ходит между карточками, и щель, замершая на входе,
                показывала бы не то место.
              */
              const over = event.over ? String(event.over.id) : null;
              const code = over?.startsWith('column:') ? over.slice('column:'.length) : null;
              if (code !== overColumn) setOverColumn(code);
              setOverIndex(
                code && draggedOrder
                  ? insertionIndexAt(code, draggedOrder.number, gestureY(event))
                  : null,
              );
            }}
            onDragOver={(event) => {
              const over = event.over ? String(event.over.id) : null;
              const code = over?.startsWith('column:') ? over.slice('column:'.length) : null;
              setOverColumn(code);
              setOverIndex(
                code && draggedOrder
                  ? insertionIndexAt(code, draggedOrder.number, gestureY(event))
                  : null,
              );
            }}
            onDragEnd={(event) => {
              const over = event.over ? String(event.over.id) : null;
              const index = overIndex;
              setOverColumn(null);
              setOverIndex(null);
              handleDrop(
                String(event.active.id),
                over?.startsWith('column:') ? over.slice('column:'.length) : null,
                index,
              );
            }}
          >
            <Stack direction="row" spacing={2} alignItems="flex-start">
              {columns.map((column) => (
                <BoardColumn
                  key={column.code}
                  column={column}
                  dropAllowed={
                    drag.draggingId === null ? null : drag.allowedTargets.has(column.code)
                  }
                  /*
                    ЗАЗОР ИДЁТ ЗА КУРСОРОМ — УСЛОВИЕ ИЗМЕНИЛОСЬ.

                    В прошлой партии щель считалась временем создания, и это
                    было честно: ручного порядка не существовало, место в
                    очереди не выбирали, а вычисляли. С появлением
                    `board_position` выбор появился — и щель обязана стоять
                    там, куда человек смотрит, иначе карточка ложится не туда,
                    куда он её нёс.
                  */
                  placeholderAt={
                    draggedOrder && overColumn === column.code && drag.allowedTargets.has(column.code)
                      ? overIndex
                      : null
                  }
                  renderGroup={(group) => (
                    <RoomGroup key={group.key} group={group}>
                      {group.orders.map((order) => renderCard(order, true))}
                    </RoomGroup>
                  )}
                >
                  {column.orders.map((order) => renderCard(order, true))}
                </BoardColumn>
              ))}
            </Stack>
            {/*
              КАРТОЧКА ЕДЕТ ПОД КУРСОРОМ. Раньше она бледнела на месте, и жест
              выглядел как «ничего не происходит»: цель видна, а что несут —
              нет. Наложение рисует ту же карточку, приподнятую тенью.
            */}
            <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(.2,.7,.3,1)' }}>
              {draggedOrder ? (
                <Box
                  sx={{ width: 320, maxWidth: '90vw', cursor: 'grabbing', boxShadow: 8, borderRadius: 2 }}
                  data-testid="tracker-drag-overlay"
                >
                  {renderCard(draggedOrder)}
                </Box>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : currentColumn ? (
          <BoardColumn
            column={currentColumn}
            showHeader={false}
            renderGroup={(group) => (
              <RoomGroup key={group.key} group={group}>
                {group.orders.map((order) => renderCard(order))}
              </RoomGroup>
            )}
          >
            {currentColumn.orders.map((order) => renderCard(order))}
          </BoardColumn>
        ) : null}

        {/*
          «ПОКАЗАТЬ БОЛЬШЕ» — ТОЛЬКО ТАМ, ГДЕ ЕСТЬ ЧТО ПОКАЗЫВАТЬ.

          Кнопка появляется, когда сервер прислал курсор: он и означает «дальше
          что-то есть». Без него кнопка обещала бы продолжение, которого нет.
        */}
        {scope === 'history' && historyCursor ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 2 }}>
            <Button
              variant="outlined"
              onClick={() => void loadMoreHistory()}
              disabled={loadingMore}
              data-testid="tracker-history-more"
            >
              {loadingMore ? t('tracker.loadingMore') : t('tracker.loadMore')}
            </Button>
          </Box>
        ) : null}

        {boardQuery.data?.server_time ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', textAlign: 'center', pt: 2 }}
          >
            {live === 'online' ? t('tracker.liveOn') : t('tracker.liveOff')}
          </Typography>
        ) : null}
      </Box>

      <OrderDetailSheet
        order={openOrder}
        open={Boolean(openOrderId)}
        loading={boardQuery.isLoading || detailQuery.isLoading}
        loadError={
          !openOrder && detailQuery.error ? trackerErrorMessage(detailQuery.error, t) : null
        }
        busy={Boolean(openOrder && actions.pendingOrderId === openOrder.id)}
        errorText={openOrder ? errorFor(openOrder) : null}
        onClose={closeDetail}
        onAccept={() => openOrder && void actions.accept(openOrder.id)}
        onStatus={(code) => openOrder && requestStatus(openOrder, code)}
        onCancel={() => openOrder && setCancelTarget(openOrder)}
      />

      {/*
        Заказ увели, пока мы на него смотрели. Молчание здесь заставляет искать
        карточку глазами по колонкам, а потом обновлять страницу.
      */}
      <Snackbar
        open={Boolean(handover.notice)}
        autoHideDuration={6000}
        onClose={handover.dismiss}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="info" onClose={handover.dismiss} data-testid="tracker-handover">
          {handover.notice ? handoverText(handover.notice, t) : ''}
        </Alert>
      </Snackbar>

      <TrackerChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />

      {/*
        ОТМЕНИТЬ ТОЛЬКО ЧТО СДЕЛАННЫЙ ШАГ.

        Живёт снекбаром, а не кнопкой на карточке: предложение относится к
        одному конкретному действию и живёт ровно столько, сколько человек
        помнит, что нажал. Кнопка на карточке предлагала бы «отменить» и через
        полчаса, когда отменять уже нечего — заказ прошёл ещё три шага.
      */}
      <Snackbar
        open={Boolean(undo)}
        autoHideDuration={8000}
        onClose={() => setUndo(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity="success"
          data-testid="tracker-undo"
          action={
            <Button
              color="inherit"
              size="small"
              data-testid="tracker-undo-action"
              onClick={() => {
                const target = undo;
                setUndo(null);
                if (!target) return;
                handover.mark(target.orderId);
                void actions.changeStatus(target.orderId, target.back);
              }}
            >
              {t('tracker.actions.undo')}
            </Button>
          }
          onClose={() => setUndo(null)}
        >
          {t('tracker.actions.undoHint', { number: undo?.number ?? '' })}
        </Alert>
      </Snackbar>

      <ReopenDialog
        open={Boolean(reopenTarget)}
        orderNumber={reopenTarget?.order.number ?? null}
        statusTitle={
          reopenTarget?.order.next_statuses.find((next) => next.code === reopenTarget.code)
            ?.title ?? null
        }
        busy={Boolean(reopenTarget && actions.pendingOrderId === reopenTarget.order.id)}
        onClose={() => setReopenTarget(null)}
        onConfirm={() => {
          const target = reopenTarget;
          setReopenTarget(null);
          if (!target) return;
          handover.mark(target.order.id);
          void actions.changeStatus(target.order.id, target.code);
        }}
      />

      <CancelDialog
        open={Boolean(cancelTarget)}
        orderId={cancelTarget?.id ?? null}
        orderNumber={cancelTarget?.number ?? null}
        busy={Boolean(cancelTarget && actions.pendingOrderId === cancelTarget.id)}
        onClose={() => setCancelTarget(null)}
        onConfirm={(reason) => {
          const target = cancelTarget;
          setCancelTarget(null);
          if (target) void actions.cancel(target.id, reason);
        }}
      />
    </Box>
  );
}
