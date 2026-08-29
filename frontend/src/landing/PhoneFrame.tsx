import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import { alpha } from '@mui/material/styles';

/**
 * Корпус телефона по НАСТОЯЩИМ пропорциям.
 *
 * Прошлая версия читалась как дешёвая подделка, и по делу: сплошная обводка в
 * восемь пикселей, умеренное скругление и вырез, нарисованный прямоугольной
 * «пилюлей» поверх экрана. Ни одна из трёх величин не была взята у аппарата.
 *
 * Здесь всё три — от реального корпуса и заданы ДОЛЯМИ ОТ ШИРИНЫ, поэтому
 * силуэт остаётся верным на любом размере:
 *
 *   соотношение сторон   19.5 : 9   (высокий экран современного телефона)
 *   радиус углов         ≈ 16 %     от ширины корпуса
 *   грань корпуса        ≈ 2.6 %    — тонкая, как на аппарате, а не рамка
 *   вырез                ≈ 30 %     ширины, высотой ≈ 8.5 %, полностью скруглён
 *
 * Готовый набор устройств (`devices.css` и подобные) не взят намеренно: он
 * тянет свой CSS и свою разметку ради одного силуэта, а нам нужен ровно один
 * корпус — дешевле описать его долями, чем зависеть от чужого файла.
 */
export function PhoneFrame({
  children,
  width = 280,
  testId,
}: {
  children: ReactNode;
  width?: number;
  testId?: string;
}) {
  const bezel = Math.round(width * 0.026);
  const radius = Math.round(width * 0.16);
  const notchWidth = Math.round(width * 0.3);
  const notchHeight = Math.round(width * 0.085);

  return (
    <Box
      data-testid={testId}
      sx={{
        position: 'relative',
        width,
        maxWidth: '100%',
        mx: 'auto',
        aspectRatio: '9 / 19.5',
        borderRadius: `${radius}px`,
        padding: `${bezel}px`,
        bgcolor: 'text.primary',
        boxShadow: (theme) =>
          `0 24px 60px -28px ${alpha(theme.palette.common.black, 0.6)}, ` +
          `inset 0 0 0 1px ${alpha(theme.palette.common.white, 0.12)}`,
      }}
    >
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          height: '100%',
          borderRadius: `${radius - bezel}px`,
          overflow: 'hidden',
          bgcolor: 'background.default',
        }}
      >
        {children}
        {/*
          Вырез — ПОВЕРХ экрана и того же цвета, что корпус: на аппарате это
          вырезанная область матрицы, а не наклейка. Полное скругление по
          высоте даёт форму пилюли без единого угла.
        */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            top: Math.round(notchHeight * 0.45),
            left: '50%',
            transform: 'translateX(-50%)',
            width: notchWidth,
            height: notchHeight,
            borderRadius: `${notchHeight}px`,
            bgcolor: 'text.primary',
          }}
        />
      </Box>
    </Box>
  );
}
