import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { it } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  useSchedule,
  useOptimizeSchedule,
  useConfirmSchedule,
  useValidateSchedule,
  useCreateTrip,
  useUpdateTrip,
  useDeleteTrip,
} from '@/hooks/useSchedules';
import { useDrivers } from '@/hooks/useDrivers';
import { useVehicles } from '@/hooks/useVehicles';
import { useTrailers } from '@/hooks/useTrailers';
import { useToast } from '@/hooks/useToast';
import {
  Wand2,
  CheckCircle,
  AlertTriangle,
  Plus,
  ArrowLeft,
  Trash2,
} from 'lucide-react';
import {
  formatDate,
  formatTime,
  formatLiters,
  getStatusLabel,
  getStatusColor,
  getDriverTypeLabel,
} from '@/lib/utils';
import type { Trip, Driver, Vehicle, Trailer, ValidationResult } from '@/types';

const locales = { it };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
});

export default function ScheduleDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isNewTrip, setIsNewTrip] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  const { data: schedule, isLoading } = useSchedule(id!);
  const { data: drivers } = useDrivers({ isActive: true });
  const { data: vehicles } = useVehicles(true);
  const { data: trailers } = useTrailers(true);

  const optimizeMutation = useOptimizeSchedule();
  const confirmMutation = useConfirmSchedule();
  const validateMutation = useValidateSchedule();
  const createTripMutation = useCreateTrip();
  const updateTripMutation = useUpdateTrip();
  const deleteTripMutation = useDeleteTrip();

  const [tripForm, setTripForm] = useState({
    driverId: '',
    vehicleId: '',
    date: '',
    departureTime: '06:00',
    trailerId: '',
    litersLoaded: 17500,
  });

  const calendarEvents = useMemo(() => {
    if (!schedule?.trips) return [];
    return schedule.trips.map((trip: Trip) => ({
      id: trip.id,
      title: `${trip.driver?.name || 'N/A'} - ${trip.vehicle?.plate || 'N/A'}`,
      start: new Date(trip.departureTime),
      end: trip.returnTime ? new Date(trip.returnTime) : new Date(new Date(trip.departureTime).getTime() + 8 * 60 * 60 * 1000),
      resource: trip,
    }));
  }, [schedule?.trips]);

  const handleOptimize = async () => {
    try {
      const result = await optimizeMutation.mutateAsync(id!);
      toast({
        title: 'Ottimizzazione completata',
        description: `Generati ${result.statistics.totalTrips} viaggi per ${formatLiters(result.statistics.totalLiters)}`,
        variant: 'success',
      });
      if (result.warnings.length > 0) {
        toast({
          title: 'Attenzione',
          description: result.warnings.join(', '),
          variant: 'warning' as any,
        });
      }
    } catch (error: any) {
      toast({
        title: 'Errore',
        description: error.message || 'Ottimizzazione fallita',
        variant: 'destructive',
      });
    }
  };

  const handleValidate = async () => {
    try {
      const result = await validateMutation.mutateAsync(id!);
      setValidationResult(result);
      if (result.isValid) {
        toast({ title: 'Validazione OK', description: 'Nessuna violazione ADR', variant: 'success' });
      } else {
        toast({
          title: 'Violazioni trovate',
          description: `${result.violations.length} violazioni, ${result.warnings.length} avvisi`,
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({ title: 'Errore validazione', variant: 'destructive' });
    }
  };

  const handleConfirm = async () => {
    if (!confirm('Confermare la pianificazione?')) return;
    try {
      await confirmMutation.mutateAsync(id!);
      toast({ title: 'Pianificazione confermata', variant: 'success' });
    } catch (error: any) {
      toast({ title: 'Errore', description: error.message, variant: 'destructive' });
    }
  };

  const handleEventClick = (event: any) => {
    setSelectedTrip(event.resource);
    setIsNewTrip(false);
    setTripForm({
      driverId: event.resource.driverId,
      vehicleId: event.resource.vehicleId,
      date: new Date(event.resource.date).toISOString().split('T')[0],
      departureTime: formatTime(event.resource.departureTime),
      trailerId: event.resource.trailers?.[0]?.trailerId || '',
      litersLoaded: event.resource.trailers?.[0]?.litersLoaded || 17500,
    });
    setIsDialogOpen(true);
  };

  const handleSlotSelect = (slotInfo: any) => {
    if (schedule?.status !== 'DRAFT') return;
    setSelectedTrip(null);
    setIsNewTrip(true);
    setTripForm({
      driverId: '',
      vehicleId: '',
      date: format(slotInfo.start, 'yyyy-MM-dd'),
      departureTime: '06:00',
      trailerId: '',
      litersLoaded: 17500,
    });
    setIsDialogOpen(true);
  };

  const handleSaveTrip = async () => {
    try {
      const dateTime = new Date(`${tripForm.date}T${tripForm.departureTime}:00`);
      const returnTime = new Date(dateTime.getTime() + 8 * 60 * 60 * 1000);

      const data = {
        vehicleId: tripForm.vehicleId,
        driverId: tripForm.driverId,
        date: dateTime.toISOString(),
        departureTime: dateTime.toISOString(),
        returnTime: returnTime.toISOString(),
        trailers: tripForm.trailerId
          ? [{ trailerId: tripForm.trailerId, litersLoaded: tripForm.litersLoaded }]
          : undefined,
      };

      if (isNewTrip) {
        await createTripMutation.mutateAsync({ scheduleId: id!, data });
        toast({ title: 'Viaggio creato', variant: 'success' });
      } else {
        await updateTripMutation.mutateAsync({
          scheduleId: id!,
          tripId: selectedTrip!.id,
          data,
        });
        toast({ title: 'Viaggio aggiornato', variant: 'success' });
      }
      setIsDialogOpen(false);
    } catch (error) {
      toast({ title: 'Errore', variant: 'destructive' });
    }
  };

  const handleDeleteTrip = async () => {
    if (!selectedTrip || !confirm('Eliminare questo viaggio?')) return;
    try {
      await deleteTripMutation.mutateAsync({ scheduleId: id!, tripId: selectedTrip.id });
      toast({ title: 'Viaggio eliminato', variant: 'success' });
      setIsDialogOpen(false);
    } catch (error) {
      toast({ title: 'Errore', variant: 'destructive' });
    }
  };

  const eventStyleGetter = (event: any) => {
    const trip = event.resource as Trip;
    let backgroundColor = '#3b82f6'; // blue

    if (trip.status === 'COMPLETED') backgroundColor = '#22c55e';
    else if (trip.status === 'CANCELLED') backgroundColor = '#ef4444';
    else if (trip.status === 'IN_PROGRESS') backgroundColor = '#a855f7';

    return { style: { backgroundColor } };
  };

  if (isLoading) return <p>Caricamento...</p>;
  if (!schedule) return <p>Pianificazione non trovata</p>;

  const totalLitersPlanned = schedule.trips?.reduce(
    (sum: number, trip: Trip) =>
      sum + (trip.trailers?.reduce((ts: number, t: any) => ts + t.litersLoaded, 0) || 0),
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/schedules')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{schedule.name}</h1>
            <p className="text-muted-foreground">
              {formatDate(schedule.startDate)} - {formatDate(schedule.endDate)}
            </p>
          </div>
          <Badge className={getStatusColor(schedule.status)}>
            {getStatusLabel(schedule.status)}
          </Badge>
        </div>

        {schedule.status === 'DRAFT' && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleOptimize} disabled={optimizeMutation.isPending}>
              <Wand2 className="mr-2 h-4 w-4" />
              Genera Turni
            </Button>
            <Button variant="outline" onClick={handleValidate} disabled={validateMutation.isPending}>
              <AlertTriangle className="mr-2 h-4 w-4" />
              Valida ADR
            </Button>
            <Button onClick={handleConfirm} disabled={confirmMutation.isPending || !schedule.trips?.length}>
              <CheckCircle className="mr-2 h-4 w-4" />
              Conferma
            </Button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Litri Richiesti</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatLiters(schedule.requiredLiters)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Litri Pianificati</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatLiters(totalLitersPlanned || 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Viaggi</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{schedule.trips?.length || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Copertura</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {schedule.requiredLiters > 0
                ? Math.round((totalLitersPlanned / schedule.requiredLiters) * 100)
                : 0}
              %
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Validation Result */}
      {validationResult && (
        <Card className={validationResult.isValid ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
          <CardHeader>
            <CardTitle className={validationResult.isValid ? 'text-green-800' : 'text-red-800'}>
              Risultato Validazione ADR
            </CardTitle>
          </CardHeader>
          <CardContent>
            {validationResult.violations.length > 0 && (
              <div className="mb-4">
                <h4 className="font-medium text-red-800">Violazioni:</h4>
                <ul className="list-inside list-disc text-sm text-red-700">
                  {validationResult.violations.map((v, i) => (
                    <li key={i}>{v.message} ({v.driverName})</li>
                  ))}
                </ul>
              </div>
            )}
            {validationResult.warnings.length > 0 && (
              <div>
                <h4 className="font-medium text-yellow-800">Avvisi:</h4>
                <ul className="list-inside list-disc text-sm text-yellow-700">
                  {validationResult.warnings.map((w, i) => (
                    <li key={i}>{w.message} ({w.driverName})</li>
                  ))}
                </ul>
              </div>
            )}
            {validationResult.isValid && validationResult.warnings.length === 0 && (
              <p className="text-green-700">Nessuna violazione o avviso trovato.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Calendar */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Calendario Turni</CardTitle>
          {schedule.status === 'DRAFT' && (
            <Button
              size="sm"
              onClick={() => {
                setSelectedTrip(null);
                setIsNewTrip(true);
                setTripForm({
                  driverId: '',
                  vehicleId: '',
                  date: format(new Date(schedule.startDate), 'yyyy-MM-dd'),
                  departureTime: '06:00',
                  trailerId: '',
                  litersLoaded: 17500,
                });
                setIsDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Aggiungi Viaggio
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="h-[600px]">
            <Calendar
              localizer={localizer}
              events={calendarEvents}
              startAccessor="start"
              endAccessor="end"
              defaultView={Views.WEEK}
              views={[Views.WEEK, Views.MONTH]}
              min={new Date(1970, 1, 1, 5, 0, 0)}
              max={new Date(1970, 1, 1, 22, 0, 0)}
              onSelectEvent={handleEventClick}
              onSelectSlot={handleSlotSelect}
              selectable={schedule.status === 'DRAFT'}
              eventPropGetter={eventStyleGetter}
              messages={{
                week: 'Settimana',
                month: 'Mese',
                today: 'Oggi',
                previous: 'Precedente',
                next: 'Successivo',
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Trip Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isNewTrip ? 'Nuovo Viaggio' : 'Dettaglio Viaggio'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Autista</Label>
              <Select
                value={tripForm.driverId}
                onValueChange={(v) => setTripForm({ ...tripForm, driverId: v })}
                disabled={schedule.status !== 'DRAFT'}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona autista..." />
                </SelectTrigger>
                <SelectContent>
                  {drivers?.map((d: Driver) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name} ({getDriverTypeLabel(d.type)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Motrice</Label>
              <Select
                value={tripForm.vehicleId}
                onValueChange={(v) => setTripForm({ ...tripForm, vehicleId: v })}
                disabled={schedule.status !== 'DRAFT'}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona motrice..." />
                </SelectTrigger>
                <SelectContent>
                  {vehicles?.map((v: Vehicle) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.plate} {v.name && `(${v.name})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Data</Label>
                <Input
                  type="date"
                  value={tripForm.date}
                  onChange={(e) => setTripForm({ ...tripForm, date: e.target.value })}
                  disabled={schedule.status !== 'DRAFT'}
                />
              </div>
              <div>
                <Label>Ora Partenza</Label>
                <Input
                  type="time"
                  value={tripForm.departureTime}
                  onChange={(e) => setTripForm({ ...tripForm, departureTime: e.target.value })}
                  disabled={schedule.status !== 'DRAFT'}
                />
              </div>
            </div>

            <div>
              <Label>Cisterna</Label>
              <Select
                value={tripForm.trailerId}
                onValueChange={(v) => setTripForm({ ...tripForm, trailerId: v })}
                disabled={schedule.status !== 'DRAFT'}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona cisterna..." />
                </SelectTrigger>
                <SelectContent>
                  {trailers?.map((t: Trailer) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.plate} - {formatLiters(t.capacityLiters)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Litri Caricati</Label>
              <Input
                type="number"
                value={tripForm.litersLoaded}
                onChange={(e) => setTripForm({ ...tripForm, litersLoaded: parseInt(e.target.value) })}
                disabled={schedule.status !== 'DRAFT'}
              />
            </div>
          </div>

          <DialogFooter className="mt-6">
            {!isNewTrip && schedule.status === 'DRAFT' && (
              <Button variant="destructive" onClick={handleDeleteTrip}>
                <Trash2 className="mr-2 h-4 w-4" />
                Elimina
              </Button>
            )}
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              {schedule.status === 'DRAFT' ? 'Annulla' : 'Chiudi'}
            </Button>
            {schedule.status === 'DRAFT' && (
              <Button onClick={handleSaveTrip}>
                {isNewTrip ? 'Crea' : 'Salva'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
