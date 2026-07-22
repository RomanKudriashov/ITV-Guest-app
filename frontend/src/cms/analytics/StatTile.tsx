import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';

/** A small headline stat used by the operations / traffic / reviews tabs. */
export function StatTile({
  label,
  value,
  loading,
  testId,
}: {
  label: string;
  value: string | undefined;
  loading?: boolean;
  testId?: string;
}) {
  return (
    <Card variant="outlined" sx={{ borderColor: 'divider' }} data-testid={testId}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        {loading ? (
          <Skeleton variant="text" width="60%" height={32} />
        ) : (
          <Typography variant="h6" sx={{ mt: 0.25 }}>
            {value ?? '—'}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
