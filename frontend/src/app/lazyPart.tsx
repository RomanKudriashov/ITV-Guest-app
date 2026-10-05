/**
 * ЧАСТИ СБОРКИ ГРУЗЯТСЯ ПО МАРШРУТУ (партия 35, п.65).
 *
 * Раньше весь интерфейс был одним файлом: гость по QR качал и панель, и
 * трекер, и консоль. Теперь у каждой части свой файл (`app/parts/*`), а
 * роутер берёт экран через `lazyFrom` — файл части приезжает, когда туда
 * пошли.
 *
 * ==================== ЧАСТЬ ИСЧЕЗЛА С СЕРВЕРА ====================
 *
 * После выкатки у открытой вкладки старый `index` ссылается на части прошлой
 * сборки, а их на сервере уже нет: nginx отвечает 404 (не витриной — см.
 * `infra/nginx/app.locations.conf`). Лечится одним перезапуском страницы:
 * свежий `index.html` знает новые имена. Перезапуск — ОДИН: отметка в
 * sessionStorage, и если за последнюю минуту страница уже перезапускалась по
 * этой причине, ошибка уходит дальше, к границе экрана. Иначе часть, которой
 * нет и в новой сборке (или сеть, которая не тянет), крутила бы страницу
 * вечно. Без хранилища (приватный режим, запрет) — тоже без перезапуска: петлю
 * там нечем остановить.
 */
import { Component, lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useTranslation } from 'react-i18next';

import { STORAGE_KEYS } from '@/storageKeys';

const RELOAD_WINDOW_MS = 60_000;

/** Часть не загрузилась и перезапуск уже был — это ловит `PartBoundary`. */
export class PartLoadError extends Error {
  constructor(readonly reason: unknown) {
    super(`часть сборки не загрузилась: ${String(reason)}`);
    this.name = 'PartLoadError';
  }
}

/** Перезапустить страницу, если это первая попытка за минуту. true — перезапуск пошёл. */
function reloadOnce(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(STORAGE_KEYS.partReload) ?? 0);
    if (Date.now() - last < RELOAD_WINDOW_MS) return false;
    window.sessionStorage.setItem(STORAGE_KEYS.partReload, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** Загрузчик части; `loaded` — модуль, когда он уже приехал. */
export interface PartLoader<M> {
  (): Promise<M>;
  loaded?: M;
}

/**
 * Загрузчик части: один импорт на все её экраны, неудача — один тихий
 * перезапуск. Пока страница перезапускается, обещание не исполняется вовсе —
 * экран не успевает мигнуть ошибкой.
 */
export function partLoader<M>(importer: () => Promise<M>): PartLoader<M> {
  let pending: Promise<M> | null = null;
  const load: PartLoader<M> = () => {
    pending ??= importer().then(
      (module) => {
        load.loaded = module;
        return module;
      },
      (error: unknown) => {
        pending = null;
        if (reloadOnce()) return new Promise<M>(() => undefined);
        throw new PartLoadError(error);
      },
    );
    return pending;
  };
  return load;
}

/**
 * Экран `name` из части: тип пропсов — как у настоящего компонента.
 *
 * ПРИЕХАВШАЯ ЧАСТЬ ОТДАЁТСЯ СИНХРОННО. `React.lazy` ждёт обещание при первом
 * показе КАЖДОГО экрана, даже если файл части давно загружен: `.then` всегда
 * исполняется следующей микрозадачей, и экран на кадр уходил бы в заглушку —
 * гость видел бы вспышку пустого фона при первом заходе в каждый раздел.
 * Синхронный «then» React читает сразу и не останавливается.
 */
export function lazyFrom<M, K extends keyof M>(load: PartLoader<M>, name: K): M[K] {
  return lazy(() => {
    const ready = load.loaded;
    if (ready) {
      const module = { default: ready[name] as unknown as ComponentType<object> };
      return { then: (resolve: (value: typeof module) => void) => resolve(module) } as unknown as Promise<typeof module>;
    }
    return load().then((loaded) => ({ default: loaded[name] as unknown as ComponentType<object> }));
  }) as unknown as M[K];
}

/**
 * Часть так и не приехала — объясняем и даём обновить РУКАМИ.
 *
 * Только для `PartLoadError`: остальные ошибки экрана идут дальше, к тем
 * границам, что ловили их и раньше. Без этой границы до человека доходила бы
 * служебная страница роутера со стеком.
 */
class PartBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    // Чужая ошибка — дальше, к внешней границе, как было до частей.
    if (!(error instanceof PartLoadError)) throw error;
    return this.props.fallback;
  }
}

function PartFailed() {
  const { t } = useTranslation();
  return (
    <Box sx={{ p: 2, minHeight: '100dvh', bgcolor: 'background.default' }}>
      <Alert
        severity="error"
        data-testid="part-failed"
        action={
          <Button color="inherit" size="small" onClick={() => window.location.reload()}>
            {t('state.reload')}
          </Button>
        }
      >
        {t('state.partFailed')}
      </Alert>
    </Box>
  );
}

/**
 * Пока часть едет — фон страницы, без крутилки: на быстрой сети это кадр-два,
 * и мигание индикатором заметнее, чем пустой фон.
 */
export function Part({ children }: { children: ReactNode }) {
  return (
    <PartBoundary fallback={<PartFailed />}>
      <Suspense fallback={<Box sx={{ minHeight: '100dvh', bgcolor: 'background.default' }} />}>
        {children}
      </Suspense>
    </PartBoundary>
  );
}
