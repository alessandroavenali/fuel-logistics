import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSchedules } from '@/hooks/useSchedules';
import { useDrivers, useExpiringDrivers } from '@/hooks/useDrivers';
import { useVehicles } from '@/hooks/useVehicles';
import { useTrailers } from '@/hooks/useTrailers';
import { useLitersReport } from '@/hooks/useReports';
import {
  Calendar,
  Truck,
  Container,
  Users,
  AlertTriangle,
  TrendingUp,
  Droplets,
} from 'lucide-react';
import { formatLiters, formatDate, getStatusLabel, getStatusColor } from '@/lib/utils';

export default function Dashboard() {
  const { data: schedules } = useSchedules();
  const { data: drivers } = useDrivers({ isActive: true });
  const { data: vehicles } = useVehicles(true);
  const { data: trailers } = useTrailers(true);
  const { data: expiringDrivers } = useExpiringDrivers(30);
  const { data: litersReport } = useLitersReport();

  const activeSchedules = schedules?.filter(
    (s: any) => s.status === 'DRAFT' || s.status === 'CONFIRMED'
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <Button asChild>
          <Link to="/schedules">Nuova Pianificazione</Link>
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Motrici Attive</CardTitle>
            <Truck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{vehicles?.length || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Rimorchi Attivi</CardTitle>
            <Container className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{trailers?.length || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Autisti Attivi</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{drivers?.length || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Litri Totali</CardTitle>
            <Droplets className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {litersReport?.totalLiters ? formatLiters(litersReport.totalLiters) : '-'}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Expiring Licenses Alert */}
        {expiringDrivers && expiringDrivers.length > 0 && (
          <Card className="border-yellow-200 bg-yellow-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-yellow-800">
                <AlertTriangle className="h-5 w-5" />
                Patentini in Scadenza
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {expiringDrivers.slice(0, 5).map((driver: any) => (
                  <li key={driver.id} className="flex items-center justify-between">
                    <span className="font-medium">{driver.name}</span>
                    <Badge variant="warning">
                      {driver.adrLicenseExpiry &&
                        new Date(driver.adrLicenseExpiry) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) &&
                        `ADR: ${formatDate(driver.adrLicenseExpiry)}`}
                      {driver.adrCisternExpiry &&
                        new Date(driver.adrCisternExpiry) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) &&
                        ` Cisterne: ${formatDate(driver.adrCisternExpiry)}`}
                    </Badge>
                  </li>
                ))}
              </ul>
              <Button asChild variant="link" className="mt-2 p-0 text-yellow-800">
                <Link to="/drivers">Vedi tutti gli autisti</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Active Schedules */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Pianificazioni Attive
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeSchedules && activeSchedules.length > 0 ? (
              <ul className="space-y-3">
                {activeSchedules.slice(0, 5).map((schedule: any) => (
                  <li key={schedule.id}>
                    <Link
                      to={`/schedules/${schedule.id}`}
                      className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted"
                    >
                      <div>
                        <p className="font-medium">{schedule.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatDate(schedule.startDate)} - {formatDate(schedule.endDate)}
                        </p>
                      </div>
                      <div className="text-right">
                        <Badge className={getStatusColor(schedule.status)}>
                          {getStatusLabel(schedule.status)}
                        </Badge>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {formatLiters(schedule.requiredLiters)}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">Nessuna pianificazione attiva</p>
            )}
            <Button asChild variant="link" className="mt-2 p-0">
              <Link to="/schedules">Gestisci pianificazioni</Link>
            </Button>
          </CardContent>
        </Card>

        {/* Quick Stats */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Statistiche Rapide
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Media litri/giorno</span>
                <span className="font-medium">
                  {litersReport?.averageLitersPerDay
                    ? formatLiters(Math.round(litersReport.averageLitersPerDay))
                    : '-'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pianificazioni attive</span>
                <span className="font-medium">{activeSchedules?.length || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Autisti dipendenti</span>
                <span className="font-medium">
                  {drivers?.filter((d: any) => d.type === 'RESIDENT').length || 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Autisti a chiamata</span>
                <span className="font-medium">
                  {drivers?.filter((d: any) => d.type === 'ON_CALL').length || 0}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
