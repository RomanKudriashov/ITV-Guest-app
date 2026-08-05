import { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useGuestSession } from '../session/GuestSessionProvider';
import { surfaceRadius } from '../storefrontTokens';

/**
 * Чип номера с выходом из отеля.
 *
 * До этого выхода у гостя не было вовсе: механизм завершения сессии в провайдере
 * существовал, но ни один экран его не звал. Гость с чужого устройства — из
 * лобби, с планшета в холле — не мог перестать быть постояльцем 305.
 *
 * Сделано меню на самом чипе, а не отдельной кнопкой: чип и так отвечает на
 * вопрос «кто я сейчас», и действие «перестать им быть» естественно живёт там
 * же. Отдельная кнопка «выйти» добавила бы в шапку витрины ещё один элемент
 * ради редкого действия.
 *
 * Один компонент на обе раскладки: у номера должен быть ОДИН владелец —
 * дублирование чипа на телефоне уже было и путало.
 *
 * РЕЖИМ ПРОСМОТРА (`room === null`) живёт здесь же, а не отдельным компонентом.
 * Гость, вошедший «просто посмотреть меню», номера не имеет — чип не рисовался
 * вовсе, и вернуться к вводу номера было НЕЧЕМ: ни кнопки, ни пункта меню,
 * назад по истории — на ту же витрину. Единственным выходом оставалась чистка
 * хранилища руками. Место у этого действия ровно то же: чип отвечает на вопрос
 * «кто я сейчас», и «я пока никто, хочу представиться» — тот же вопрос.
 */
export function RoomMenu({
  room,
  variant = 'bar',
}: {
  /** `null` — гость смотрит витрину без номера (режим просмотра). */
  room: string | null;
  variant?: 'bar' | 'floating';
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { end } = useGuestSession();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const leave = () => {
    setAnchor(null);
    end();
    // На экран входа, а не на /login: у гостя нет учётной записи, он
    // представляется номером.
    navigate('/', { replace: true });
  };

  // Режим просмотра: не меню, а одно действие — представиться номером. Меню
  // с единственным пунктом здесь было бы лишним шагом.
  if (room === null) {
    return (
      <ButtonBase
        onClick={leave}
        data-testid="guest-identify"
        sx={(th) => ({
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.75,
          height: variant === 'bar' ? 34 : 36,
          px: variant === 'bar' ? 1.6 : 1.25,
          borderRadius: (theme) => surfaceRadius.pill(theme.palette.brand.radius),
          fontSize: variant === 'bar' ? 12 : 12.5,
          fontWeight: 700,
          whiteSpace: 'nowrap',
          color: th.palette.primary.main,
          border: `1px solid ${alpha(th.palette.primary.main, 0.4)}`,
          bgcolor: alpha(th.palette.primary.main, 0.08),
        })}
      >
        {t('guest.session.identify')}
      </ButtonBase>
    );
  }

  return (
    <>
      <ButtonBase
        onClick={(event) => setAnchor(event.currentTarget)}
        data-testid="guest-room-chip"
        sx={
          variant === 'bar'
            ? // Чип в верхней строке лежит на стекле НАД СТРАНИЦЕЙ, а не над
              // кадром: цвет обязан переключаться вместе с темой. Раньше он был
              // жёстко белым на белесой подложке и на светлой оставался тёмным
              // островом — единственный элемент строки, не заметивший режим.
              (th) => ({
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.9,
                height: 34,
                px: 1.6,
                borderRadius: (theme) => surfaceRadius.pill(theme.palette.brand.radius),
                fontSize: 12,
                fontWeight: 600,
                color: th.palette.text.primary,
                bgcolor: alpha(th.palette.text.primary, 0.06),
                border: `1px solid ${alpha(th.palette.text.primary, 0.14)}`,
              })
            : (th) => ({
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.75,
                height: 36,
                px: 1.25,
                borderRadius: (theme) => surfaceRadius.pill(theme.palette.brand.radius),
                border: `1px solid ${th.palette.divider}`,
                color: 'text.primary',
                fontSize: 12.5,
                fontWeight: 700,
                whiteSpace: 'nowrap',
              })
        }
      >
        <Box
          aria-hidden
          sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'primary.main', flex: 'none' }}
        />
        <Typography component="span" sx={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1 }}>
          {variant === 'bar'
            ? t('guest.home.room', { room })
            : t('guest.common.roomShort', { room })}
        </Typography>
      </ButtonBase>

      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem disabled sx={{ opacity: 1, fontSize: 12.5 }}>
          {t('guest.session.current', { room })}
        </MenuItem>
        <MenuItem onClick={leave} data-testid="guest-leave-hotel">
          {t('guest.session.leave')}
        </MenuItem>
      </Menu>
    </>
  );
}
