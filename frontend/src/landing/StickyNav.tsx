import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { NAV_HEIGHT, SECTIONS, scrollToSection, useActiveSection } from './nav';

/**
 * Липкая полоса, которая появляется, когда обложка ушла вверх.
 *
 * МАТОВОЕ СТЕКЛО — `backdrop-filter: blur`. Размывается то, что проезжает ПОД
 * полосой, поэтому текст на ней читается над любым содержимым. Где
 * `backdrop-filter` не поддержан, остаётся просто полупрозрачный фон — темнее,
 * но читаемо; проверка идёт через `@supports`, а не через определение браузера.
 *
 * СОСТАВ СОБРАН ОБХОДОМ СТРАНИЦЫ — см. `SECTIONS`. В полосе было сперва три
 * ссылки на девять разделов, потом четыре сводных пункта с раскрытием; и то и
 * другое требовало от посетителя догадаться, что «Продукт» — это гость,
 * персонал, номер и устройства разом. Теперь пункт равен разделу, а надпись
 * равна той, что стоит на странице.
 *
 * ТЕСНОТА РЕШЕНА ПРОКРУТКОЙ САМОЙ ПОЛОСЫ. Восемь надписей вроде «Как движутся
 * данные» не помещаются в узкое окно ни при каком кегле. Перенос на вторую
 * строку сделал бы полосу вдвое выше — она перекрывала бы содержимое, ради
 * которого её и делают липкой. Сокращать надписи нельзя: они взяты со страницы,
 * и расхождение с ней — ровно то, что чинилось. Поэтому ряд ссылок едет вбок
 * внутри полосы; полоса остаётся в одну строку на любой ширине, а на широком
 * экране прокрутке просто нечего делать.
 *
 * Переключатели языка и темы в полосе НЕ живут: они приезжают сюда с обложки —
 * см. `LandingControls`. Место под них полоса оставляет отступом справа.
 */
export function StickyNav({ shown, calm }: { shown: boolean; calm: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const active = useActiveSection(SECTIONS);

  /*
    Растворение правого края ряда. Строка собрана заранее, а не задана функцией
    от темы прямо в `sx`: функция там обязана вернуть ЗНАЧЕНИЕ, и объект с
    точками останова из неё уже не разбирается — маска молча не применялась, и
    надпись по-прежнему обрывалась посередине.
  */
  const fadeEdge = `linear-gradient(to right, ${theme.palette.common.black} calc(100% - 28px), transparent 100%)`;

  /*
    Растворять край надо, только пока справа ЕСТЬ ЧТО показывать. Маска на
    постоянку гасила хвост последнего пункта, докрутив ряд до конца, — и
    «Как подключиться» выглядело обрезанным там, где обрезать уже нечего.
  */
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState(false);
  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    setMore(row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, t]);

  return (
    <Box
      component="nav"
      data-testid="landing-nav"
      data-shown={shown ? 'true' : 'false'}
      data-active={active}
      sx={{
        position: 'fixed',
        top: 0,
        insetInline: 0,
        zIndex: 10,
        height: NAV_HEIGHT,
        pl: { xs: 2, md: 4 },
        // Справа — место под переключатели, которые лежат отдельным слоем.
        // Ширина замерена по ним, а не подобрана: два значка (44 и 34) с
        // зазором между ними плюс собственный отступ полосы. Меньше — и
        // последняя ссылка уезжает под флаг.
        pr: { xs: 13, md: 17 },
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        borderBottom: '1px solid',
        borderColor: (theme) => alpha(theme.palette.divider, 0.6),
        bgcolor: (theme) => alpha(theme.palette.background.default, 0.72),
        '@supports (backdrop-filter: blur(1px))': {
          backdropFilter: 'blur(14px) saturate(140%)',
          bgcolor: (theme) => alpha(theme.palette.background.default, 0.55),
        },
        // Плавно, а не рывком. При просьбе не двигать — мгновенно и без сдвига.
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : 'translateY(-100%)',
        pointerEvents: shown ? 'auto' : 'none',
        transition: calm ? 'none' : 'opacity .28s ease, transform .28s ease',
      }}
    >
      <Typography
        variant="subtitle2"
        sx={{ fontWeight: 700, flexShrink: 0, display: { xs: 'none', sm: 'block' } }}
      >
        {t('landing.nav.brand')}
      </Typography>

      <Box
        ref={rowRef}
        onScroll={measure}
        data-more={more ? 'true' : 'false'}
        data-testid="landing-nav-links"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: { xs: 2, md: 2.5 },
          // Ряд едет вбок, а не переносится и не обрезается.
          overflowX: 'auto',
          overflowY: 'hidden',
          flex: 1,
          minWidth: 0,
          justifyContent: { xs: 'flex-start', lg: 'flex-end' },
          // Полоса прокрутки внутри полосы меню — лишняя деталь высотой в
          // треть её собственной высоты. Прокрутка остаётся, видна только сама
          // лента.
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
          /*
            Край ряда РАСТВОРЯЕТСЯ, а не обрезается.

            Обрезанная посередине надпись читается поломкой вёрстки: непонятно,
            что ряд едет вбок, — понятно только, что что-то не поместилось.
            Растворение говорит «дальше есть ещё» без единого слова и без
            стрелки, которую пришлось бы куда-то ставить.

            Только там, где ряд может не поместиться: на широком экране он
            прижат вправо, и растворение съедало бы последний пункт.
          */
          maskImage: more ? fadeEdge : 'none',
          WebkitMaskImage: more ? fadeEdge : 'none',
        }}
      >
        {SECTIONS.map((key) => {
          const current = active === key;
          return (
            <Box
              key={key}
              component="a"
              href={`#${key}`}
              data-testid={`landing-nav-${key}`}
              data-current={current ? 'true' : 'false'}
              onClick={(event: React.MouseEvent) => {
                // Своё скольжение вместо прыжка. Правая кнопка, средняя и
                // открытие в новой вкладке остаются браузеру: ссылка настоящая.
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                scrollToSection(key, calm);
                // Адрес обновляем ПОСЛЕ, и без прыжка: `location.hash = …`
                // прокрутил бы страницу второй раз, поверх собственной анимации.
                window.history.replaceState(null, '', `#${key}`);
              }}
              sx={{
                flexShrink: 0,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                position: 'relative',
                // Подчёркивание живёт ВНУТРИ ссылки, а не под ней: ряд ссылок
                // едет вбок и потому обрезает всё, что вылезло за его высоту, —
                // подчёркнутое `bottom: -2` в этой обрезке пропадало целиком.
                py: 0.75,
                color: current ? 'text.primary' : 'text.secondary',
                fontWeight: current ? 600 : 400,
                '&:hover': { color: 'text.primary' },
                // Подчёркивание текущего — снизу, по ширине надписи. Цветом
                // одним обойтись нельзя: разница «вторичный/основной» на
                // матовом стекле читается плохо.
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  insetInline: 0,
                  bottom: 2,
                  height: 2,
                  borderRadius: 2,
                  bgcolor: 'primary.main',
                  opacity: current ? 1 : 0,
                  transition: calm ? 'none' : 'opacity .2s ease',
                },
              }}
            >
              <Typography variant="body2" component="span">
                {t(`landing.nav.${key}`)}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
