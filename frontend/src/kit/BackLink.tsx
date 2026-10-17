import Button from '@mui/material/Button';
import ArrowBackOutlinedIcon from '@mui/icons-material/ArrowBackOutlined';
import ArrowForwardOutlinedIcon from '@mui/icons-material/ArrowForwardOutlined';
import { useTheme, type SxProps, type Theme } from '@mui/material/styles';
import { Link as RouterLink, useLocation } from 'react-router-dom';

/**
 * «← НАЗАД» ВНУТРЕННЕГО ЭКРАНА — ОДИН НА ВСЮ ПАНЕЛЬ (партия 56).
 *
 * Подпись — имя родителя («← Отели», «← Меню «Панорамы»»), а не безличное
 * «Назад»: человек видит, куда вернётся. Ведёт по карте маршрутов
 * (`app/backMap.ts`), НЕ по истории браузера: пришедший по ссылке из письма
 * или из закладки вернётся в родительский список, а не на чужую страницу.
 *
 * Настоящая ссылка: средняя кнопка открывает родителя в новой вкладке, а
 * охрана несохранённых изменений (useBlocker) срабатывает на переходе.
 */
export interface BackLinkProps {
  /**
   * Адрес родителя. Строка с `?` в начале — место на ТОМ ЖЕ пути
   * (`?section=fleet&group=…` консоли, `?…` ресепшена): путь берётся из
   * текущего адреса, а не из маршрута, внутри которого нарисована ссылка, —
   * в раскладочной ветке без `path` относительная ссылка уехала бы к её
   * родителю (партия 56).
   */
  to: string;
  label: string;
  testId?: string;
  /** Заменить запись истории, а не добавить: «назад» внутри одного экрана. */
  replace?: boolean;
  /** Отступы по месту; к общим правилам ссылки добавляются, а не заменяют их. */
  sx?: SxProps<Theme>;
}

export function BackLink({ to, label, testId = 'back-link', replace, sx }: BackLinkProps) {
  const rtl = useTheme().direction === 'rtl';
  const { pathname } = useLocation();
  const target = to.startsWith('?') ? { pathname, search: to === '?' ? '' : to } : to;
  return (
    <Button
      component={RouterLink}
      to={target}
      replace={replace}
      data-testid={testId}
      startIcon={rtl ? <ArrowForwardOutlinedIcon /> : <ArrowBackOutlinedIcon />}
      sx={[
        { alignSelf: 'flex-start', minWidth: 0, px: 1, ml: -1, textAlign: 'start', overflowWrap: 'anywhere' },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {label}
    </Button>
  );
}
