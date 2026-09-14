/**
 * ПОДМОСТКИ ПОКАЗА: настоящие экраны витрины внутри панели.
 *
 * ============================ ЗАЧЕМ РАМКА ============================
 *
 * Оболочка витрины переключается ПО ШИРИНЕ ОКНА: `GuestLayout` спрашивает
 * `useMediaQuery('(min-width:1024px)')`, и при попадании рисует совсем другой
 * экран — верхнюю строку с вкладками, две колонки, корзину сбоку. Колонка
 * показа в панели — 440 пикселей, и порог не пересекался НИКОГДА: кнопка
 * «Компьютер» просила 900 и получала 440, «Телевизор» стоял заблокированным.
 *
 * Масштабированием это не решается: медиазапрос меряет ОКНО, а не элемент.
 * Растянув рамку и сжав её `transform: scale`, мы получили бы уменьшенную
 * телефонную вёрстку, а не десктопную.
 *
 * Поэтому показ живёт в `<iframe>`. У рамки СВОЁ окно и своя ширина: внутри
 * неё 1024 пикселя — это настоящие 1024, и витрина честно переключает
 * оболочку. Снаружи рамка ужимается `transform: scale(...)` до ширины колонки —
 * меняется только размер на экране, а не то, что нарисовано.
 *
 * ================= ПОЧЕМУ ЭТОГО МАЛО И ЧТО ЕЩЁ СДЕЛАНО ================
 *
 * React внутри портала выполняется в контексте ОКНА ПАНЕЛИ: `window` там —
 * родительское, и `useMediaQuery` мерил бы панель, а не рамку. Поэтому теме
 * показа подменяется `matchMedia` окном рамки (`MuiUseMediaQuery.defaultProps`).
 * Без этой строки рамка была бы красивой, а оболочка — всё той же телефонной.
 *
 * Стили эмоции тоже кладутся В ДОКУМЕНТ РАМКИ: иначе классы едут в панель, а
 * внутри рамки остаётся голая разметка.
 *
 * ================= ПОЧЕМУ СВОЙ КОРЕНЬ, А НЕ ПОРТАЛ ====================
 *
 * Первая редакция рисовала дерево показа порталом в тело рамки. Узлы при этом
 * оказываются в рамке, а КОНТЕКСТ течёт из панели: витрина попадала внутрь
 * роутера панели и падала на `You cannot render a <Router> inside another
 * <Router>`. И это не единственная беда портала — точно так же протекли бы
 * провайдеры темы, сессии и запросов.
 *
 * Поэтому показ монтируется ОТДЕЛЬНЫМ корнем React прямо в документе рамки.
 * Общего контекста с панелью у него нет вовсе: внутри — только то, что он сам
 * себе объявил, и перепутать витрину с панелью физически нечем.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import createCache, { type EmotionCache } from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { prefixer } from 'stylis';
import rtlPlugin from 'stylis-plugin-rtl';
import Box from '@mui/material/Box';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useRoutes, type RouteObject } from 'react-router-dom';

import { guestBranch } from '@/app/router';
import { GuestShellProviders } from '@/guest/GuestRoot';
import { PreviewSessionProvider } from '@/guest/session/GuestSessionProvider';
import { createAppTheme, type BrandTokens, type ThemeMode } from '@/theme';
import { previewI18n } from './previewI18n';

export interface PreviewStageProps {
  tokens: BrandTokens;
  mode: ThemeMode;
  rtl: boolean;
  language: string;
  /** Адрес экрана витрины — берётся из её же таблицы маршрутов. */
  route: string;
  /** Настоящая ширина ВНУТРИ рамки: по ней витрина выбирает оболочку. */
  width: number;
  /** Высота рамки в её собственных пикселях. */
  height: number;
  /** Во сколько раз ужать рамку на экране панели. */
  scale: number;
  /** Кэш с данными экранов — заполнен ответами серверной ручки показа. */
  client: QueryClient;
  hotelName: string;
  currency: string;
  minorUnits: number;
  testId?: string;
}

/** Маршруты витрины с подменённым корнем: сессия показа вместо гостевой. */
function usePreviewRoutes(hotelName: string, currency: string, minorUnits: number) {
  return useMemo<RouteObject[]>(
    () => [
      {
        ...guestBranch,
        element: (
          <PreviewSessionProvider
            hotel={{ name: hotelName } as never}
            currency={currency}
            minorUnits={minorUnits}
          >
            <GuestShellProviders />
          </PreviewSessionProvider>
        ),
      },
    ],
    [hotelName, currency, minorUnits],
  );
}

function PreviewRoutes({ routes }: { routes: RouteObject[] }) {
  return useRoutes(routes);
}

export function PreviewStage({
  tokens,
  mode,
  rtl,
  language,
  route,
  width,
  height,
  scale,
  client,
  hotelName,
  currency,
  minorUnits,
  testId = 'brand-preview-stage',
}: PreviewStageProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [doc, setDoc] = useState<Document | null>(null);
  const rootRef = useRef<Root | null>(null);
  const routes = usePreviewRoutes(hotelName, currency, minorUnits);

  // Документ рамки готов не в момент монтирования: `about:blank` доезжает
  // отдельным тиком, и портал в несуществующее тело молча ничего не покажет.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const ready = () => setDoc(frame.contentDocument ?? null);
    ready();
    frame.addEventListener('load', ready);
    return () => frame.removeEventListener('load', ready);
  }, []);

  const cache: EmotionCache | null = useMemo(() => {
    if (!doc) return null;
    return createCache({
      key: rtl ? 'preview-rtl' : 'preview',
      container: doc.head,
      stylisPlugins: rtl ? [prefixer, rtlPlugin] : [prefixer],
    });
  }, [doc, rtl]);

  const theme = useMemo(() => {
    const base = createAppTheme(tokens, mode, rtl ? 'rtl' : 'ltr');
    const frameWindow = doc?.defaultView;
    if (!frameWindow) return base;
    // ВОТ ЭТА СТРОКА и делает ширину настоящей: медиазапросы витрины меряют
    // окно рамки, а не окно панели вокруг.
    return {
      ...base,
      components: {
        ...base.components,
        MuiUseMediaQuery: {
          defaultProps: { matchMedia: frameWindow.matchMedia.bind(frameWindow) },
        },
      },
    };
  }, [tokens, mode, rtl, doc]);

  useEffect(() => {
    if (!doc) return;
    doc.documentElement.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    doc.documentElement.setAttribute('lang', language);
    doc.body.style.margin = '0';
  }, [doc, rtl, language]);

  useEffect(() => {
    void previewI18n.changeLanguage(language);
  }, [language]);

  // Дерево показа живёт в СВОЁМ корне: контекста панели у него нет, и роутер
  // витрины больше ни во что не вложен. Перерисовываем на каждое изменение
  // входов — токены меняются на каждый щелчок в редакторе.
  useEffect(() => {
    if (!doc || !cache) return;
    const root: Root = rootRef.current ?? createRoot(doc.body);
    rootRef.current = root;
    root.render(
      <CacheProvider value={cache}>
        <MuiThemeProvider theme={theme}>
          <CssBaseline />
          <I18nextProvider i18n={previewI18n}>
            <QueryClientProvider client={client}>
              <MemoryRouter initialEntries={[route]}>
                <PreviewRoutes routes={routes} />
              </MemoryRouter>
            </QueryClientProvider>
          </I18nextProvider>
        </MuiThemeProvider>
      </CacheProvider>,
    );
  }, [doc, cache, theme, client, route, routes]);

  // Корень снимается вместе с рамкой: оставленный, он продолжит рисовать в
  // документ, которого уже нет.
  useEffect(
    () => () => {
      const root = rootRef.current;
      rootRef.current = null;
      if (root) setTimeout(() => root.unmount(), 0);
    },
    [],
  );

  return (
    <Box
      data-testid={testId}
      sx={{
        width: width * scale,
        height: height * scale,
        overflow: 'hidden',
        borderRadius: 3,
        boxShadow: 3,
        // Рамка рисуется в СВОЮ ширину и ужимается целиком: так внутри неё
        // остаются настоящие пиксели, а на экране она занимает колонку.
        '& > iframe': {
          width,
          height,
          border: 0,
          display: 'block',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        },
      }}
    >
      <iframe ref={frameRef} title="preview" data-testid={`${testId}-frame`} />
    </Box>
  );
}
