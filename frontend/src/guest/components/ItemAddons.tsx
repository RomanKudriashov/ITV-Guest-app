import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { IconAdd, IconCheck } from '@/icons';
import type { ModifierGroup, ModifierOption } from '../api/types';
import { itemCard, surfaceRadius } from '../storefrontTokens';

/**
 * ДОБАВКИ — не чипы, а карточки с ценой и кнопкой.
 *
 * Разница с модификатором не в оформлении, а в сути выбора. Модификатор
 * отвечает «каким сделать блюдо»: прожарка одна из четырёх, и варианты стоят
 * рядом равными чипами, потому что гость выбирает МЕЖДУ ними. Добавка отвечает
 * «что положить сверху»: каждая набирается отдельно, у каждой своя цена, и
 * складываются они друг с другом. Поэтому у добавки строка со своей ценой и
 * своя кнопка — как в корзине, а не как в переключателе.
 *
 * Отличаются они ПО ДАННЫМ, а не по названию группы: множественный выбор, у
 * которого варианты стоят денег. Проверять код группы (`extras`) значило бы
 * завести на фронте знание о том, как отель назвал свои группы, — и потерять
 * добавки у отеля, назвавшего их иначе.
 */
export function isAddonGroup(group: ModifierGroup): boolean {
  return group.selection === 'multi' && group.options.some((option) => option.price_delta > 0);
}

export interface AddonGroupProps {
  group: ModifierGroup;
  chosen: string[];
  /** Форматированная цена добавки: «+250 ₽». */
  priceOf: (option: ModifierOption) => string | null;
  onToggle: (optionId: string) => void;
}

export function AddonGroup({ group, chosen, priceOf, onToggle }: AddonGroupProps) {
  const { t } = useTranslation();
  const max = group.max_choices || 0;
  // Предел набран — кнопки невыбранных добавок гаснут. Молча игнорировать
  // нажатие нельзя: гость жмёт и не понимает, почему ничего не происходит.
  const limitReached = max > 0 && chosen.length >= max;

  return (
    <Box>
      <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: itemCard.block }}>
        <Typography variant="subtitle1">{group.title}</Typography>
        {max > 0 ? (
          <Typography variant="caption" color="text.secondary" data-testid="guest-addon-limit">
            {t('guest.item.upTo', { count: max })}
          </Typography>
        ) : null}
      </Stack>

      <Box
        role="group"
        aria-label={group.title}
        sx={{
          display: 'grid',
          // Колонки от места в карточке, а не от ширины окна: на десктопе
          // добавки лежат в узкой правой колонке модалки.
          gridTemplateColumns: `repeat(auto-fill, minmax(${itemCard.addonMinWidth}px, 1fr))`,
          gap: itemCard.tight,
        }}
      >
        {group.options.map((option) => {
          const selected = chosen.includes(option.id);
          const blocked = limitReached && !selected;
          const price = priceOf(option);
          return (
            <ButtonBase
              key={option.id}
              disabled={blocked}
              onClick={() => onToggle(option.id)}
              /*
                ТОТ ЖЕ `testid`, ЧТО У ЧИПА МОДИФИКАТОРА, и это не экономия на
                именах: в данных добавка — такой же вариант группы, изменилось
                только её оформление. Отдельное имя означало бы, что снаружи
                (в проверках, в разборе трафика) добавка — другая сущность, и
                каждая проверка выбора начиналась бы с вопроса «а как эту
                группу нарисовали».
              */
              data-testid={`guest-modifier-option-${option.code}`}
              data-kind="addon"
              data-selected={selected ? 'true' : 'false'}
              role="checkbox"
              aria-checked={selected}
              aria-label={
                selected
                  ? t('guest.item.addonRemove', { title: option.title })
                  : t('guest.item.addonAdd', { title: option.title })
              }
              sx={(theme) => ({
                justifyContent: 'space-between',
                gap: 1,
                width: '100%',
                px: itemCard.addonPaddingX,
                py: itemCard.addonPaddingY,
                textAlign: 'start',
                borderRadius: surfaceRadius.inner(theme.palette.brand.radius),
                border: `1px solid ${selected ? theme.palette.primary.main : theme.palette.divider}`,
                bgcolor: selected
                  ? `color-mix(in srgb, ${theme.palette.primary.main} 10%, transparent)`
                  : 'transparent',
                color: 'text.primary',
                opacity: blocked ? 0.45 : 1,
                transition: 'background .2s ease, border-color .2s ease',
                '@media (hover: hover)': {
                  '&:hover:not(:disabled)': { borderColor: theme.palette.primary.main },
                },
                '&.Mui-focusVisible': {
                  outline: `2px solid ${theme.palette.primary.main}`,
                  outlineOffset: 2,
                },
              })}
            >
              <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {option.title}
                </Typography>
                {price ? (
                  <Typography variant="caption" color="text.secondary">
                    {price}
                  </Typography>
                ) : null}
              </Stack>
              {/*
                Кнопка нарисована, а не вложена: настоящая <button> внутри
                <button> — недопустимая разметка, и по ней нельзя было бы
                попасть иначе, чем точно в кружок. Нажимается вся карточка,
                кружок показывает, что произойдёт.
              */}
              <Box
                aria-hidden
                sx={(theme) => ({
                  display: 'flex',
                  flex: 'none',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: itemCard.addonButton,
                  height: itemCard.addonButton,
                  borderRadius: '50%',
                  border: `1px solid ${selected ? 'transparent' : theme.palette.divider}`,
                  bgcolor: selected ? theme.palette.primary.main : 'transparent',
                  color: selected ? theme.palette.primary.contrastText : theme.palette.text.secondary,
                })}
              >
                {selected ? <IconCheck size={18} /> : <IconAdd size={18} />}
              </Box>
            </ButtonBase>
          );
        })}
      </Box>
    </Box>
  );
}
