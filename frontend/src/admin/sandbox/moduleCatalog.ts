/**
 * КАТАЛОГ МОДУЛЕЙ ДЛЯ МАКЕТА (партия 62).
 *
 * Что модуль даёт и чего требует — по разведке «как есть»
 * (`~/itv-recon/control/CONTROL-КАК-ЕСТЬ.md`, п.3.4): у кода девять модулей,
 * по-настоящему закрывают экраны два — «Управление номером» и «Маркетинг».
 * Остальные — заготовки: в каталоге они есть, выключателя у них нет.
 */

export type ModuleStatus = 'ready' | 'dev';
export type ConnectionKind = 'grms' | 'pms' | 'locks' | 'payments';

export interface CatalogModule {
  code: string;
  title: string;
  /** Одна строка «что даёт отелю». */
  gives: string;
  /** Что именно открывается у гостя, персонала и в панели. */
  opens: string[];
  status: ModuleStatus;
  /** Без какого подключения модуль не работает. */
  needs?: ConnectionKind;
  /** Настройки по умолчанию для нового включения. */
  defaults: Array<[string, string]>;
}

export const CONNECTION_TITLE: Record<ConnectionKind, string> = {
  grms: 'коннектор управления номером',
  pms: 'подключение к PMS',
  locks: 'система замков',
  payments: 'эквайринг',
};

export const MODULES: CatalogModule[] = [
  {
    code: 'room_control',
    title: 'Управление номером',
    gives: 'Гость управляет светом, климатом и шторами со своего телефона.',
    opens: ['Гость: вкладка «Номер»', 'Панель: доступ, PIN, проверка номера', 'Control: варианты, план, журнал команд'],
    status: 'ready',
    needs: 'grms',
    defaults: [
      ['Вход гостя без PIN (демо)', 'выключен'],
      ['Уровень экрана', 'Кнопки'],
    ],
  },
  {
    code: 'marketing',
    title: 'Маркетинг',
    gives: 'Баннеры на главной гостя и метки на позициях меню.',
    opens: ['Гость: баннеры, метки', 'Панель: раздел «Маркетинг»'],
    status: 'ready',
    defaults: [['Баннеров на главной', 'до 3']],
  },
  {
    code: 'pms',
    title: 'PMS',
    gives: 'Номера, заезды и выезды приходят из системы управления отелем.',
    opens: ['Панель: номера и гости из PMS'],
    status: 'dev',
    needs: 'pms',
    defaults: [],
  },
  {
    code: 'payment',
    title: 'Оплата',
    gives: 'Гость оплачивает заказ картой прямо в витрине.',
    opens: ['Гость: оплата заказа'],
    status: 'dev',
    needs: 'payments',
    defaults: [],
  },
  {
    code: 'mobile_key',
    title: 'Мобильный ключ',
    gives: 'Дверь номера открывается телефоном гостя.',
    opens: ['Гость: ключ на главной'],
    status: 'dev',
    needs: 'locks',
    defaults: [],
  },
  {
    code: 'native_app',
    title: 'Приложение отеля',
    gives: 'Витрина отеля в магазинах приложений под его именем.',
    opens: ['Гость: приложение'],
    status: 'dev',
    defaults: [],
  },
  {
    code: 'analytics_level',
    title: 'Расширенная аналитика',
    gives: 'Отчёты по выручке, позициям и персоналу за любой период.',
    opens: ['Панель: отчёты'],
    status: 'dev',
    defaults: [],
  },
  {
    code: 'multi_restaurant',
    title: 'Несколько заведений',
    gives: 'Больше одного ресторана или бара с отдельным меню и часами.',
    opens: ['Панель: заведения'],
    status: 'dev',
    defaults: [],
  },
  {
    code: 'extra_languages',
    title: 'Дополнительные языки',
    gives: 'Витрина на языках сверх русского и английского.',
    opens: ['Гость: выбор языка'],
    status: 'dev',
    defaults: [],
  },
];

export const moduleByCode = (code: string) => MODULES.find((m) => m.code === code);
