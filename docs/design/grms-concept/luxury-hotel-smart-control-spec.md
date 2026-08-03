# Полная спецификация для реализации веб-приложения
**«Luxury Hotel In-Room Smart Control»**

---

## 1. Цель и общее описание

Создать высококачественный, премиальный веб-интерфейс (PWA) управления номером люксового отеля.  
Интерфейс должен выглядеть как продукт уровня Savant TrueImage / Control4 / Apple Home + премиальный автомобильный климат-контроль.

Основной экран — кинематографический фото-фон реальной suite + плавающие frosted-glass панели управления.

---

## 2. Технологический стек (рекомендуемый)

| Слой              | Технология                          | Причина |
|-------------------|-------------------------------------|-------|
| Framework         | Next.js 15 (App Router) + React 19  | SSR/SSG, отличная производительность, PWA |
| Язык              | TypeScript                          | Строгая типизация |
| Стилизация        | Tailwind CSS + CSS Variables + Framer Motion | Быстрая стилизация + премиальные анимации |
| Состояние         | Zustand + Immer                     | Лёгкий и мощный state |
| Иконки            | Lucide React / custom SVG           | Чистые геометрические иконки |
| Шрифт             | Inter / SF Pro Display (variable)   | Современный геометрический гротеск |
| PWA               | next-pwa / serwist                  | Установка на телефон как native app |
| Тёмная тема       | Только dark (fixed)                 | Соответствует концепции |

---

## 3. Дизайн-система

### Цвета (CSS Variables)

```css
:root {
  --bg-primary: #0B1220;
  --glass: rgba(255, 255, 255, 0.07);
  --glass-border: rgba(255, 255, 255, 0.12);
  --gold: #E3B23C;
  --blue: #5B93F0;
  --text-primary: #FFFFFF;
  --text-secondary: rgba(255, 255, 255, 0.65);
  --success: #34D399;
}
```

### Эффекты стекла

```css
.glass {
  background: var(--glass);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--glass-border);
  border-radius: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
}
```

### Типографика

- Заголовки: 17–20px, weight 600
- Основной текст: 14–15px, weight 500
- Статусы: 13px, weight 500, letter-spacing 0.02em

---

## 4. Структура экрана (Mobile-first, 9:19)

```
┌─────────────────────────────────────┐
│           Status Bar (safe)         │
├─────────────────────────────────────┤
│                                     │
│         [Кинематографический фон]   │
│         (фото suite + световые      │
│          эффекты + airflow)         │
│                                     │
│  ┌─────┐ ┌─────┐ ┌─────┐            │  ← Status Pills
│  │23°  │ │2 зоны│ │Штора│            │
│  └─────┘ └─────┘ └─────┘            │
│                                     │
│  [ Movie ] [ Night ] [ Morning ]    │  ← Scene buttons
│                                     │
│  ┌──────────────────┐  ┌──────────┐ │
│  │ Living  ○──────  │  │          │ │
│  │ Bedroom ○──────  │  │  ○ 23°   │ │  ← Zones + Thermostat
│  │ Bath    ○──────  │  │          │ │
│  └──────────────────┘  └──────────┘ │
│                                     │
│  ┌────────────────────────────────┐ │
│  │ Curtain  ●────────────○ Close  │ │  ← Curtain slider
│  └────────────────────────────────┘ │
│                                     │
└─────────────────────────────────────┘
```

---

## 5. Компоненты (детально)

### 5.1 BackgroundScene
- Полноэкранный `<img>` или `<video>` (loop, muted) с кинематографическим фото suite.
- Поверх — canvas или CSS-анимированный glowing airflow (тонкий поток воздуха от AC).
- Параллакс при наклоне телефона (опционально, через DeviceOrientation).

### 5.2 StatusPills

```tsx
type StatusPill = {
  id: string;
  label: string;
  value: string;
  icon?: ReactNode;
  accent?: 'gold' | 'blue' | 'default';
}
```

Три пилюли в ряд с мягким glass-эффектом.

### 5.3 SceneButtons
Горизонтальный ряд из 3–4 кнопок:
- Movie (иконка солнца/плей)
- Night (луна)
- Morning (восход)
- Active state — золотой фон + glow.

### 5.4 ZoneToggles
Вертикальный список зон:

```
Living     [toggle]
Bedroom    [toggle]
Bath       [toggle]
```

Каждый toggle — кастомный, с плавной анимацией и цветом (gold когда on).

### 5.5 ThermostatDial
Круговой контроллер:
- Внешнее кольцо с делениями
- Внутренний круг с текущей/целевой температурой
- Drag / touch для изменения температуры (18–30°C)
- Мягкое синее ambient-кольцо + золотая стрелка

### 5.6 CurtainControl
Горизонтальный слайдер:
- Слева «Open», справа «Close»
- Thumb — золотой круг
- Прогресс-бар с градиентом

---

## 6. Состояние приложения (Zustand)

```ts
interface RoomState {
  temperature: number;          // 18–30
  targetTemperature: number;
  zones: {
    living: boolean;
    bedroom: boolean;
    bath: boolean;
  };
  curtainPosition: number;      // 0–100
  activeScene: 'movie' | 'night' | 'morning' | null;
  lights: {
    living: boolean;
    bedroom: boolean;
    bath: boolean;
  };
}
```

---

## 7. Анимации (Framer Motion)

- Появление всех glass-панелей: `opacity + y + scale` (stagger 0.08s)
- Переключение сцен: плавное изменение яркости и температуры цвета фона
- Toggle: scale + color transition 250ms
- Thermostat: spring-анимация при изменении значения
- Airflow: бесконечная CSS/Canvas анимация

---

## 8. Адаптивность и PWA

- Mobile-first (max-width 430px)
- На планшетах и десктопе — центрированный контейнер 390–430px с тёмными полями
- Добавить `manifest.json` + service worker
- Splash screen с логотипом отеля
- Поддержка safe-area (iPhone notch)

---

## 9. Дополнительные требования

1. **Производительность**  
   - Lighthouse ≥ 95  
   - Фон — WebP/AVIF + lazy  
   - Все анимации на GPU (transform/opacity)

2. **Доступность**  
   - Контраст текста ≥ 4.5:1  
   - Focus states  
   - ARIA-labels на всех контролах

3. **Реалистичность**  
   - При включении света — мягкое изменение яркости соответствующей зоны на фоне (через CSS filters или canvas overlay)
   - При изменении температуры — subtle цветовой сдвиг ambient light

4. **Звуки (опционально)**  
   - Мягкие тактильные клики при переключении (Web Audio API)

---

## 10. Структура проекта (рекомендуемая)

```
/app
  /page.tsx                 ← главный экран
  /layout.tsx
/components
  /BackgroundScene.tsx
  /StatusPills.tsx
  /SceneButtons.tsx
  /ZoneToggles.tsx
  /ThermostatDial.tsx
  /CurtainSlider.tsx
  /GlassCard.tsx
/store
  /roomStore.ts
/styles
  /globals.css
/public
  /images/suite-dusk.webp
  /manifest.json
```

---

## 11. Критерии приёмки

- Выглядит «дорого» даже на скриншоте
- Все элементы читаются при одном взгляде
- Анимации плавные (60 fps)
- Работает как PWA на iOS и Android
- Полностью соответствует визуальному референсу (фото + glass + gold/blue)

---

## Как использовать эту спецификацию

Скопируйте этот документ целиком и передайте Claude (или Cursor / v0 / Lovable) со словами:

> «Реализуй точную веб-версию этого интерфейса строго по спецификации ниже. Используй Next.js 15 + Tailwind + Framer Motion + Zustand. Сделай максимально близко к референсу.»

---

*Документ создан: 3 августа 2026*  
*Версия: 1.0*
