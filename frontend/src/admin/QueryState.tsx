import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { ink } from './adminTokens';

/**
 * Три исхода запроса — и они РАЗНЫЕ на экране.
 *
 * Было одно условие на все случаи: `if (!data) return <CircularProgress />`.
 * Упавший запрос оставляет `data` неопределённой ровно так же, как ещё не
 * пришедший, — и экран крутил спиннер бесконечно. Оператор ждал того, чего не
 * будет: ни ошибки, ни повтора, ни причины.
 *
 * Здесь три ветки различимы по построению, и «нет ответа» не может выглядеть
 * как «ответ пустой»: это разные ветки с разным текстом, а не одно и то же
 * отсутствие данных.
 *
 *   загрузка — спиннер, и только пока запрос действительно идёт;
 *   ошибка   — что именно не загрузилось + кнопка повторить;
 *   пустота  — фраза утверждением («узлов пока нет»), а не пустое место.
 *
 * Почему render-prop, а не `{children}`: ветка с данными обязана получить их
 * УЖЕ не-undefined. Иначе каждая страница снова писала бы `data!` или свою
 * проверку — то есть ту же заплатку, от которой уходим.
 */
export function QueryState<T>({
  query,
  what,
  isEmpty,
  emptyText,
  children,
}: {
  query: UseQueryResult<T>;
  /** Что не загрузилось, винительный падеж: «сводку», «список узлов». */
  what: string;
  /** Пуст ли ответ. Пустота — это состояние ДАННЫХ, знать его может только страница. */
  isEmpty?: (data: T) => boolean;
  /** Фраза о пустоте. Утверждение, а не «нет данных». */
  emptyText?: string;
  children: (data: T) => ReactNode;
}) {
  const { t } = useTranslation();

  if (query.isPending) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }} data-testid="admin-state-loading">
        <CircularProgress />
      </Box>
    );
  }

  // `isError` — не единственный способ остаться без данных: запрос могли
  // отменить, а ответ — не разобрать. Условие по факту («данных нет, а
  // загрузка кончилась»), а не по названию состояния.
  if (query.isError || query.data === undefined) {
    return (
      <Alert
        severity="error"
        data-testid="admin-state-error"
        sx={{ mt: 2 }}
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            data-testid="admin-state-retry"
          >
            {t('admin.state.retry')}
          </Button>
        }
      >
        {t('admin.state.loadFailed', { what })}
      </Alert>
    );
  }

  if (isEmpty?.(query.data)) {
    return (
      <Typography
        sx={{ color: ink.low, fontSize: 13, py: 4 }}
        data-testid="admin-state-empty"
      >
        {emptyText ?? t('admin.state.empty')}
      </Typography>
    );
  }

  return <>{children(query.data)}</>;
}
