import Button from '@mui/material/Button';
import ArrowBackOutlinedIcon from '@mui/icons-material/ArrowBackOutlined';
import ArrowForwardOutlinedIcon from '@mui/icons-material/ArrowForwardOutlined';
import { useTheme } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';

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
  to: string;
  label: string;
  testId?: string;
}

export function BackLink({ to, label, testId = 'back-link' }: BackLinkProps) {
  const rtl = useTheme().direction === 'rtl';
  return (
    <Button
      component={RouterLink}
      to={to}
      data-testid={testId}
      startIcon={rtl ? <ArrowForwardOutlinedIcon /> : <ArrowBackOutlinedIcon />}
      sx={{ alignSelf: 'flex-start', minWidth: 0, px: 1, ml: -1, textAlign: 'start', overflowWrap: 'anywhere' }}
    >
      {label}
    </Button>
  );
}
