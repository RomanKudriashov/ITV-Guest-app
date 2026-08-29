import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

/**
 * Липкая полоса, которая появляется, когда обложка ушла вверх.
 *
 * МАТОВОЕ СТЕКЛО — `backdrop-filter: blur`. Размывается то, что проезжает ПОД
 * полосой, поэтому текст на ней читается над любым содержимым. Где
 * `backdrop-filter` не поддержан, остаётся просто полупрозрачный фон — темнее,
 * но читаемо; проверка идёт через `@supports`, а не через определение браузера.
 *
 * СОСТАВ СОБРАН ПО СТРАНИЦЕ, А НЕ ПО ПАМЯТИ. В полосе было три ссылки на девять
 * разделов: половина страницы из меню не открывалась вовсе. Список ниже —
 * обход страницы сверху вниз, вместе с подразделами: две схемы движения данных
 * и «кому подходит» — это отдельные части, до которых иначе только скроллом.
 *
 * ПОЧЕМУ ГРУППАМИ. Девять ссылок в строку не помещаются рядом с названием и
 * переключателями, а прятать лишние — вернуться к тому же неполному меню.
 * Четыре пункта с раскрытием держат полный состав и оставляют полосу полосой.
 *
 * РАСКРЫТИЕ — БЕЗ СОСТОЯНИЯ И БЕЗ JS. `:hover` и `:focus-within` на самом
 * пункте: список из четырёх якорей не стоит ни портала, ни обработчиков. По
 * клавиатуре подпункты доступны тем же `focus-within` — они настоящие ссылки, а
 * не пункты выдуманного меню.
 *
 * Переключатели языка и темы в полосе НЕ живут: они приезжают сюда с обложки —
 * см. `LandingControls`. Место под них полоса оставляет отступом справа.
 */

/**
 * Разделы страницы. Порядок — порядок на странице; вложенность — настоящая
 * вложенность, а не рубрикация ради красоты.
 */
const SECTIONS = [
  {
    key: 'product',
    href: '#claims',
    children: ['claims', 'guest', 'staff', 'room', 'devices'],
  },
  { key: 'how', href: '#how', children: ['flowOrder', 'flowRoom'] },
  { key: 'modules', href: '#modules', children: ['modulesList', 'audience'] },
  { key: 'contact', href: '#contact', children: [] },
] as const;

/** Куда ведёт подпункт. Держится рядом со списком, чтобы не разъехалось. */
const CHILD_HREF: Record<string, string> = {
  claims: '#claims',
  guest: '#guest',
  staff: '#staff',
  room: '#room',
  devices: '#devices',
  flowOrder: '#flow-order',
  flowRoom: '#flow-room',
  modulesList: '#modules',
  audience: '#audience',
};

export function StickyNav({ shown, calm }: { shown: boolean; calm: boolean }) {
  const { t } = useTranslation();

  return (
    <Box
      component="nav"
      data-testid="landing-nav"
      data-shown={shown ? 'true' : 'false'}
      sx={{
        position: 'fixed',
        top: 0,
        insetInline: 0,
        zIndex: 10,
        pl: { xs: 2, md: 4 },
        // Справа — место под переключатели, которые лежат отдельным слоем.
        // Ширина замерена по ним, а не подобрана: два значка (44 и 34) с
        // зазором между ними плюс собственный отступ полосы. Меньше — и
        // последняя ссылка уезжает под флаг.
        pr: { xs: 13, md: 17 },
        py: 1,
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
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mr: 'auto' }}>
        {t('landing.nav.brand')}
      </Typography>
      <Stack direction="row" spacing={2.5} sx={{ display: { xs: 'none', md: 'flex' } }}>
        {SECTIONS.map((section) => (
          <Box key={section.key} sx={{ position: 'relative', py: 0.5 }}>
            <Box
              component="a"
              href={section.href}
              data-testid={`landing-nav-${section.key}`}
              sx={{
                color: 'text.secondary',
                textDecoration: 'none',
                '&:hover': { color: 'text.primary' },
              }}
            >
              <Typography variant="body2">{t(`landing.nav.${section.key}`)}</Typography>
            </Box>

            {section.children.length ? (
              <Box
                data-testid={`landing-nav-${section.key}-sub`}
                sx={{
                  position: 'absolute',
                  top: '100%',
                  insetInlineStart: -12,
                  pt: 1,
                  opacity: 0,
                  visibility: 'hidden',
                  transition: calm ? 'none' : 'opacity .18s ease',
                  // Раскрытие держится и при наведении на сам список: иначе он
                  // закрывался бы в тот момент, когда курсор уходит с заголовка
                  // вниз, к подпунктам.
                  'div:hover > &, div:focus-within > &': { opacity: 1, visibility: 'visible' },
                }}
              >
                <Stack
                  spacing={0.5}
                  sx={{
                    minWidth: 200,
                    p: 1.25,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'background.paper',
                    boxShadow: (theme) => `0 18px 40px -24px ${alpha(theme.palette.common.black, 0.6)}`,
                  }}
                >
                  {section.children.map((child) => (
                    <Box
                      key={child}
                      component="a"
                      href={CHILD_HREF[child]}
                      data-testid={`landing-nav-${child}`}
                      sx={{
                        color: 'text.secondary',
                        textDecoration: 'none',
                        px: 1,
                        py: 0.5,
                        borderRadius: 1,
                        '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
                      }}
                    >
                      <Typography variant="body2">{t(`landing.nav.${child}`)}</Typography>
                    </Box>
                  ))}
                </Stack>
              </Box>
            ) : null}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
