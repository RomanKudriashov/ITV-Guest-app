import TextField, { type TextFieldProps } from '@mui/material/TextField';
import Tabs, { type TabsProps } from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';

/**
 * Kit text field — a thin wrapper over MUI TextField that pins the token radius
 * and a visible focus ring, so every input in the redesign reads the same.
 */
export function KitTextField({ sx, InputProps, ...rest }: TextFieldProps) {
  return (
    <TextField
      variant="outlined"
      size="small"
      fullWidth
      InputProps={InputProps}
      sx={[
        (theme) => ({
          '& .MuiOutlinedInput-root': {
            borderRadius: `${theme.palette.brand.radius.md}px`,
          },
          '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderWidth: 2,
            borderColor: theme.palette.primary.main,
          },
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...rest}
    />
  );
}

export interface KitTabsProps extends Omit<TabsProps, 'children'> {
  tabs: { value: string; label: string }[];
}

/** Kit tabs — token-styled pill indicator over MUI Tabs. */
export function KitTabs({ tabs, sx, ...rest }: KitTabsProps) {
  return (
    <Tabs
      variant="scrollable"
      scrollButtons="auto"
      allowScrollButtonsMobile
      sx={[
        {
          minHeight: 44,
          '& .MuiTab-root': { minHeight: 44, textTransform: 'none' },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...rest}
    >
      {tabs.map((tab) => (
        <Tab key={tab.value} value={tab.value} label={tab.label} />
      ))}
    </Tabs>
  );
}
