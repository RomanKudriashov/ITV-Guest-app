import { Component, type ErrorInfo, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';

/**
 * Падение одного экрана не гасит консоль целиком.
 *
 * Найдено исполнением: ответ неожиданной формы (`{}` вместо сводки) роняет
 * рендер, React снимает всё дерево — и оператор видит БЕЛЫЙ ЭКРАН. Не
 * спиннер, не ошибку: пустое окно без навигации, из которого некуда нажать.
 * Перезагрузка страницы возвращает ровно то же.
 *
 * Граница ставится вокруг содержимого, а не вокруг всего приложения:
 * навигация обязана пережить падение экрана, иначе уйти с него можно только
 * через адресную строку.
 */
export class ScreenBoundary extends Component<
  { children: ReactNode; message: string; actionLabel: string; onReset?: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // В консоль браузера — с полным стеком: экран проглотили, а разбираться
    // по нему всё равно кому-то придётся.
    console.error('экран консоли упал', error, info.componentStack);
  }

  componentDidUpdate(prev: { children: ReactNode }) {
    // Переход в другой раздел — новая попытка: иначе один упавший экран
    // держал бы границу закрытой навсегда.
    if (this.state.failed && prev.children !== this.props.children) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Alert
        severity="error"
        data-testid="admin-screen-crashed"
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => {
              this.setState({ failed: false });
              this.props.onReset?.();
            }}
            data-testid="admin-screen-crashed-retry"
          >
            {this.props.actionLabel}
          </Button>
        }
      >
        {this.props.message}
      </Alert>
    );
  }
}
