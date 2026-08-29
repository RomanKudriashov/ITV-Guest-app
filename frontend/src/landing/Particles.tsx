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
 * Ощущение медленного и дорогого даёт не количество точек, а их скорость и
 * низкий контраст; это же и самое дешёвое по кадрам.
 */
export function Particles({ calm }: { calm: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const theme = useTheme();
  const tint = theme.palette.common.white;

  useEffect(() => {
    if (calm) return undefined;
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const weak = (navigator.hardwareConcurrency ?? 8) <= 4;
    const count = weak ? 24 : 48;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let width = 0;
    let height = 0;
    let frame = 0;
    let visible = true;
    let onScreen = true;

    const dots = Array.from({ length: count }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.6 + Math.random() * 1.6,
      // Медленно: полный проход по экрану занимает минуты, а не секунды.
      vx: (Math.random() - 0.5) * 0.00016,
      vy: -0.00006 - Math.random() * 0.00012,
      a: 0.06 + Math.random() * 0.16,
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
        ctx.globalAlpha = dot.a;
        ctx.fillStyle = tint;
        ctx.beginPath();
        ctx.arc(dot.x * width, dot.y * height, dot.r, 0, Math.PI * 2);
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
  }, [calm, tint]);

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
