/**
 * Уведомления о смене статуса заказа.
 *
 * ЧТО ЭТО НА САМОМ ДЕЛЕ. Это локальные уведомления браузера, а не push с
 * сервера: их показывает вкладка, у которой открыт сокет заказа
 * (`useOrderLive`). Работает, пока приложение запущено — в том числе свёрнутое
 * и с потухшим экраном. Закрытому приложению уведомление не придёт: для этого
 * нужен service worker, подписка Push API и отправитель на сервере, и это
 * отдельная работа, а не флаг.
 *
 * ПОЧЕМУ РАЗРЕШЕНИЕ СПРАШИВАЕТСЯ ПОСЛЕ ЗАКАЗА, А НЕ НА ВХОДЕ. Запрос при первом
 * открытии — самый надёжный способ получить отказ навсегда: гость ещё ничего не
 * заказал, и вопрос «можно ли вам писать» для него бессмысленный. После
 * оформления у вопроса появляется предмет: «сообщить, когда заказ поедет».
 * Браузер запоминает отказ насовсем, второго шанса спросить не будет.
 *
 * ОТКАЗ НИЧЕГО НЕ ЛОМАЕТ. Статус заказа виден на экране заказа и в полосе
 * активного заказа — уведомление это ускорение, а не единственный канал.
 */

/** Умеет ли браузер уведомления вообще. Не умеет — кнопки быть не должно. */
export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export type NotificationPermissionState = 'unsupported' | 'default' | 'granted' | 'denied';

export function notificationPermission(): NotificationPermissionState {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission as NotificationPermissionState;
}

/**
 * Спросить разрешение. Возвращает итог, каким бы он ни был.
 *
 * Свой try/catch: в старых Safari `requestPermission` не отдаёт промис, а
 * зовёт колбэк, и обращение к `.then` там бросает.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (!notificationsSupported()) return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    return result as NotificationPermissionState;
  } catch {
    return notificationPermission();
  }
}

/**
 * Показать уведомление о новом статусе.
 *
 * Молчим, когда вкладка НА ВИДУ: гость и так смотрит на этот самый статус, и
 * системная плашка поверх него — шум. Уведомление имеет смысл ровно тогда,
 * когда экран заказа не перед глазами.
 */
export function notifyOrderStatus(options: {
  orderNumber: number | string;
  statusTitle: string;
  title: string;
  icon?: string;
}): void {
  if (notificationPermission() !== 'granted') return;
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
  try {
    // `tag` по заказу: следующий статус ЗАМЕЩАЕТ предыдущее уведомление, а не
    // копится стопкой. Гостю нужен текущий статус, а не история переходов.
    new Notification(options.title, {
      body: options.statusTitle,
      icon: options.icon ?? '/icon-192.png',
      tag: `order-${options.orderNumber}`,
      renotify: true,
    } as NotificationOptions);
  } catch {
    /* Уведомление — не критичный путь: отказ браузера не должен ронять экран. */
  }
}
