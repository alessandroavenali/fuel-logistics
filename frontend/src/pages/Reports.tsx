import { useState } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useTripsReport,
  useDriversReport,
  useCostsReport,
  useLitersReport,
  useEfficiencyReport,
} from '@/hooks/useReports';
import { Download, Filter } from 'lucide-react';
import {
  formatDate,
  formatLiters,
  formatCurrency,
  getDriverTypeLabel,
  getStatusLabel,
  getStatusColor,
} from '@/lib/utils';

export default function Reports() {
  const [dateRange, setDateRange] = useState({
    from: new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0],
  });

  const { data: tripsReport, isLoading: loadingTrips } = useTripsReport(dateRange.from, dateRange.to);
  const { data: driversReport, isLoading: loadingDrivers } = useDriversReport(dateRange.from, dateRange.to);
  const { data: costsReport, isLoading: loadingCosts } = useCostsReport(dateRange.from, dateRange.to);
  const { data: litersReport, isLoading: loadingLiters } = useLitersReport(dateRange.from, dateRange.to);
  const { data: efficiencyReport, isLoading: loadingEfficiency } = useEfficiencyReport(dateRange.from, dateRange.to);

  const exportCSV = (data: any[], filename: string) => {
    if (!data || data.length === 0) return;

    const headers = Object.keys(data[0]).join(',');
    const rows = data.map((row) =>
      Object.values(row)
        .map((val) => (typeof val === 'string' ? `"${val}"` : val))
        .join(',')
    );
    const csv = [headers, ...rows].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Report</h1>
      </div>

      {/* Date Range Filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-end gap-4">
            <div>
              <Label>Da</Label>
              <Input
                type="date"
                value={dateRange.from}
                onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
              />
            </div>
            <div>
              <Label>A</Label>
              <Input
                type="date"
                value={dateRange.to}
                onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
              />
            </div>
            <Button variant="outline">
              <Filter className="mr-2 h-4 w-4" />
              Filtra
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="liters">
        <TabsList>
          <TabsTrigger value="liters">Litri</TabsTrigger>
          <TabsTrigger value="trips">Viaggi</TabsTrigger>
          <TabsTrigger value="drivers">Autisti</TabsTrigger>
          <TabsTrigger value="costs">Costi</TabsTrigger>
          <TabsTrigger value="efficiency">Efficienza</TabsTrigger>
        </TabsList>

        {/* Liters Tab */}
        <TabsContent value="liters" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Totale Litri</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {litersReport?.totalLiters ? formatLiters(litersReport.totalLiters) : '-'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Media Giornaliera</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {litersReport?.averageLitersPerDay
                    ? formatLiters(Math.round(litersReport.averageLitersPerDay))
                    : '-'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Giorni con Viaggi</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{litersReport?.daily?.length || 0}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Andamento Litri Trasportati</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportCSV(litersReport?.daily || [], 'litri-giornalieri')}
              >
                <Download className="mr-2 h-4 w-4" />
                Esporta CSV
              </Button>
            </CardHeader>
            <CardContent>
              {loadingLiters ? (
                <p>Caricamento...</p>
              ) : (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={litersReport?.daily || []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tickFormatter={(d) => formatDate(d)} />
                      <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        formatter={(value: number) => formatLiters(value)}
                        labelFormatter={(label) => formatDate(label)}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="liters"
                        name="Litri"
                        stroke="#3b82f6"
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Trips Tab */}
        <TabsContent value="trips" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Totale Viaggi</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{tripsReport?.summary?.totalTrips || 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Completati</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-green-600">
                  {tripsReport?.summary?.completedTrips || 0}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Cancellati</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-red-600">
                  {tripsReport?.summary?.cancelledTrips || 0}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Litri Totali</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {tripsReport?.summary?.totalLiters
                    ? formatLiters(tripsReport.summary.totalLiters)
                    : '-'}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Dettaglio Viaggi</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingTrips ? (
                <p>Caricamento...</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Autista</TableHead>
                      <TableHead>Motrice</TableHead>
                      <TableHead>Litri</TableHead>
                      <TableHead>Stato</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tripsReport?.trips?.slice(0, 20).map((trip: any) => (
                      <TableRow key={trip.id}>
                        <TableCell>{formatDate(trip.date)}</TableCell>
                        <TableCell>{trip.driver?.name || '-'}</TableCell>
                        <TableCell>{trip.vehicle?.plate || '-'}</TableCell>
                        <TableCell>
                          {formatLiters(
                            trip.trailers?.reduce((s: number, t: any) => s + t.litersLoaded, 0) || 0
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(trip.status)}>
                            {getStatusLabel(trip.status)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Drivers Tab */}
        <TabsContent value="drivers" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Riepilogo Autisti</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportCSV(driversReport || [], 'autisti-report')}
              >
                <Download className="mr-2 h-4 w-4" />
                Esporta CSV
              </Button>
            </CardHeader>
            <CardContent>
              {loadingDrivers ? (
                <p>Caricamento...</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Autista</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Viaggi</TableHead>
                      <TableHead>Ore Guida</TableHead>
                      <TableHead>Ore Lavoro</TableHead>
                      <TableHead>Costo Stimato</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {driversReport?.map((driver: any) => (
                      <TableRow key={driver.id}>
                        <TableCell className="font-medium">{driver.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{getDriverTypeLabel(driver.type)}</Badge>
                        </TableCell>
                        <TableCell>{driver.totalTrips}</TableCell>
                        <TableCell>{driver.totalDrivingHours.toFixed(1)}h</TableCell>
                        <TableCell>{driver.totalWorkingHours.toFixed(1)}h</TableCell>
                        <TableCell>
                          {driver.estimatedCost ? formatCurrency(driver.estimatedCost) : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ore per Autista</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={driversReport || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="totalDrivingHours" name="Ore Guida" fill="#3b82f6" />
                    <Bar dataKey="totalWorkingHours" name="Ore Lavoro" fill="#22c55e" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Costs Tab */}
        <TabsContent value="costs" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Costo Totale Autisti</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {costsReport?.totalDriverCosts
                    ? formatCurrency(costsReport.totalDriverCosts)
                    : '-'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Viaggi nel Periodo</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{costsReport?.tripCount || 0}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Dettaglio Costi Autisti a Chiamata</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingCosts ? (
                <p>Caricamento...</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Autista</TableHead>
                      <TableHead>Ore Totali</TableHead>
                      <TableHead>Costo Orario</TableHead>
                      <TableHead>Costo Totale</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {costsReport?.driverCosts?.map((driver: any) => (
                      <TableRow key={driver.driverId}>
                        <TableCell className="font-medium">{driver.driverName}</TableCell>
                        <TableCell>{driver.totalHours.toFixed(1)}h</TableCell>
                        <TableCell>{formatCurrency(driver.hourlyCost)}</TableCell>
                        <TableCell className="font-bold">
                          {formatCurrency(driver.totalCost)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Efficiency Tab */}
        <TabsContent value="efficiency" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Efficienza Pianificazioni</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingEfficiency ? (
                <p>Caricamento...</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pianificazione</TableHead>
                      <TableHead>Litri Richiesti</TableHead>
                      <TableHead>Litri Consegnati</TableHead>
                      <TableHead>Efficienza</TableHead>
                      <TableHead>Viaggi</TableHead>
                      <TableHead>Stato</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {efficiencyReport?.map((schedule: any) => (
                      <TableRow key={schedule.scheduleId}>
                        <TableCell className="font-medium">{schedule.scheduleName}</TableCell>
                        <TableCell>{formatLiters(schedule.requiredLiters)}</TableCell>
                        <TableCell>{formatLiters(schedule.deliveredLiters)}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              schedule.efficiency >= 100
                                ? 'success'
                                : schedule.efficiency >= 80
                                  ? 'warning'
                                  : 'destructive'
                            }
                          >
                            {schedule.efficiency.toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {schedule.completedTrips}/{schedule.totalTrips}
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(schedule.status)}>
                            {getStatusLabel(schedule.status)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
