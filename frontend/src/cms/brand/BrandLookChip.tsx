import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';

import { fetchBrandLook } from '@/api/cms';

/**
 * Откуда взялось оформление отеля — одной меткой.
 *
 * СЛОВО ЗДЕСЬ ВАЖНЕЕ КОДА. У справочника «расхождение» — плохая новость:
 * аллергены должны совпадать у всех. У оформления всё наоборот: отель,
 * перекрасивший витрину под свой бренд, сделал ровно то, чего от него ждут.
 *
 * Поэтому метка говорит «своё оформление», а не «расхождение», и рядом нет
 * кнопки «вернуть к эталону». Экран, предлагающий починить неполоманное,
 * приучает нажимать «ок» не глядя — и однажды этим «ок» снесут работу
 * дизайнера отеля.
 *
 * Полезная часть — подсказка: пока оформление своё, правки платформы до него
 * не доезжают. Это не претензия, а факт, который стоит знать заранее.
 */
export function BrandLookChip() {
  const { t } = useTranslation();
  const look = useQuery({ queryKey: ['cms', 'brand', 'look'], queryFn: fetchBrandLook });
  if (!look.data) return null;

  const follows = look.data.state === 'follows';
  return (
    <Tooltip title={follows ? '' : t('brand.look.hint')}>
      <Chip
        size="small"
        variant="outlined"
        data-testid="cms-brand-look"
        // Нейтральный тон в обоих случаях: своё оформление — не тревога.
        color="default"
        label={t(`brand.look.${look.data.state}`)}
      />
    </Tooltip>
  );
}
