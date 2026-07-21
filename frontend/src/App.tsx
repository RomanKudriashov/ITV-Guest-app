import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActions from '@mui/material/CardActions';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import {
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '@/i18n';
import { useAppTheme } from '@/theme';

export default function App() {
  const { t, i18n } = useTranslation();
  const { mode, direction, setMode } = useAppTheme();
  const language = (i18n.resolvedLanguage ?? i18n.language ?? 'en') as SupportedLanguage;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: 4 }}>
      <Container maxWidth="sm">
        <Stack spacing={3}>
          <Box>
            <Typography variant="h4" component="h1" color="text.primary">
              {t('app.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('app.subtitle')}
            </Typography>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="stretch">
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="language-select-label">{t('common.language')}</InputLabel>
              <Select
                labelId="language-select-label"
                id="language-select"
                value={language}
                label={t('common.language')}
                onChange={(event) => {
                  void i18n.changeLanguage(event.target.value);
                }}
              >
                {SUPPORTED_LANGUAGES.map((lng) => (
                  <MenuItem key={lng} value={lng}>
                    {LANGUAGE_LABELS[lng]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <ToggleButtonGroup
              size="small"
              exclusive
              color="primary"
              value={mode}
              onChange={(_event, next) => {
                if (next === 'light' || next === 'dark') setMode(next);
              }}
              aria-label={t('common.theme')}
            >
              <ToggleButton value="light">{t('common.light')}</ToggleButton>
              <ToggleButton value="dark">{t('common.dark')}</ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          <Box>
            <Typography variant="h6" component="h2" color="text.primary">
              {t('demo.heading')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('demo.description')}
            </Typography>
          </Box>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip label={t('demo.chipTokens')} color="primary" />
            <Chip label={t('demo.chipRtl')} color="secondary" variant="outlined" />
            <Chip label={t('demo.chipI18n')} />
          </Stack>

          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" component="h3" gutterBottom color="text.primary">
                {t('demo.cardTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('demo.cardBody')}
              </Typography>
              <TextField
                fullWidth
                size="small"
                label={t('demo.inputLabel')}
                helperText={t('demo.inputHelper')}
              />
            </CardContent>
            <Divider />
            <CardActions sx={{ px: 2, py: 1.5, gap: 1 }}>
              <Button variant="contained">{t('demo.primaryAction')}</Button>
              <Button variant="outlined" color="secondary">
                {t('demo.secondaryAction')}
              </Button>
            </CardActions>
          </Card>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="text.primary" gutterBottom>
              {t('demo.stateTitle')}
            </Typography>
            <Stack spacing={0.5}>
              <Typography variant="body2" color="text.secondary">
                {t('demo.stateDirection')}: {direction}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('demo.stateLanguage')}: {language}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('demo.stateMode')}: {mode}
              </Typography>
            </Stack>
          </Paper>
        </Stack>
      </Container>
    </Box>
  );
}
