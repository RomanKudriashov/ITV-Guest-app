import { useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';

/**
 * Мелкие частицы на фоне первого экрана — свой холст, без библиотеки.
 *
 * ПОЧЕМУ СВОЙ. `three.js` — полтораста килобайт и WebGL ради сорока точек,
 * `tsparticles` — сорок и собственный язык настройки. Здесь три килобайта и
 * ни одного запроса.
 *
 * ЧТОБЫ НЕ ЖРАЛО БАТАРЕЮ — четыре меры, и каждая нужна:
 *   • вкладка не на экране (`visibilitychange`) — кадры не считаются;
 *   • первый экран ушёл из вида (`IntersectionObserver`) — тоже;
 *   • плотность пикселей ограничена 1.5 — на ретине холст вчетверо дешевле;
 *   • слабая машина (`hardwareConcurrency <= 4`) получает вдвое меньше точек.
 *
 * ПРИ `prefers-reduced-motion` ХОЛСТ НЕ СОЗДАЁТСЯ ВОВСЕ — не «останавливается»,
 * а не появляется: остановленная анимация всё равно стоит разметки и памяти.
 *
 * ЧИСЛА ПОДОБРАНЫ ЗАМЕРОМ, А НЕ НА ГЛАЗ. Первая версия была невидимой: 48
 * точек радиусом до 2.2 px при 22% непрозрачности закрашивали 0.037% холста —
 * поверх яркой фотографии это ноль. Считал не глазами, а чтением пикселей.
 */
export function Particles({ calm, tint }: { calm: boolean; tint?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const theme = useTheme();
  /*
    Цвет точек — от темы, а не всегда белый.

    Частицы уехали с обложки на секции под ней: над фотографией они спорили с
    кадром, а кадр здесь главный. На секции же фон бывает и светлым, и белые
    точки на нём не видно вовсе.
  */
  const colour =
    tint ?? (theme.palette.mode === 'dark' ? theme.palette.common.white : theme.palette.primary.main);

  useEffect(() => {
    if (calm) return undefined;
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const weak = (navigator.hardwareConcurrency ?? 8) <= 4;
    const count = weak ? 70 : 140;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let width = 0;
    let height = 0;
    let frame = 0;
    let visible = true;
    let onScreen = true;

    const dots = Array.from({ length: count }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 1.4 + Math.random() * 2.6,
      // Медленно: полный проход по экрану занимает минуты, а не секунды.
      vx: (Math.random() - 0.5) * 0.00016,
      vy: -0.00006 - Math.random() * 0.00012,
      a: 0.3 + Math.random() * 0.45,
    }));

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      for (const dot of dots) {
        dot.x += dot.vx;
        dot.y += dot.vy;
        if (dot.y < -0.05) dot.y = 1.05;
        if (dot.x < -0.05) dot.x = 1.05;
        if (dot.x > 1.05) dot.x = -0.05;
        // Лёгкое свечение: радиальный градиент вместо плоского круга. Он и
        // даёт «дорого» — плоские точки читаются как пыль на объективе.
        const cx = dot.x * width;
        const cy = dot.y * height;
        const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, dot.r * 3);
        halo.addColorStop(0, colour);
        halo.addColorStop(1, 'transparent');
        ctx.globalAlpha = dot.a;
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(cx, cy, dot.r * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    };

    const start = () => {
      if (frame || !visible || !onScreen) return;
      frame = requestAnimationFrame(draw);
    };
    const stop = () => {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
    };

    resize();
    start();

    const onVisibility = () => {
      visible = document.visibilityState === 'visible';
      visible ? start() : stop();
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        onScreen ? start() : stop();
      },
      { threshold: 0 },
    );
    observer.observe(canvas);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', resize);

    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', resize);
    };
  }, [calm, colour]);

  if (calm) return null;
  return (
    <Box
      component="canvas"
      ref={ref}
      aria-hidden
      data-testid="landing-particles"
      sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  );
}
