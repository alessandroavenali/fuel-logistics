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
import { useDriversAvailability } from '@/hooks/useDrivers';
import { useVehiclesStatus } from '@/hooks/useVehicles';
import { useTrailersStatus } from '@/hooks/useTrailers';
import { useLocations } from '@/hooks/useLocations';
import { useToast } from '@/hooks/useToast';
import {
  Wand2,
  CheckCircle,
  AlertTriangle,
  Plus,
  ArrowLeft,
  Trash2,
  Truck,
  Container,
  Users,
  CircleDot,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import {
  formatDate,
  formatTime,
  formatLiters,
  getStatusLabel,
  getStatusColor,
  getDriverTypeLabel,
} from '@/lib/utils';
import type { Trip, Location, ValidationResult, TrailerStatus, VehicleStatus, DriverAvailability } from '@/types';

const locales = { it };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
});

interface TripTrailerForm {
  trailerId: string;
  litersLoaded: number;
  dropOffLocationId: string;
  isPickup: boolean;
}

export default function ScheduleDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isNewTrip, setIsNewTrip] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  const { data: schedule, isLoading } = useSchedule(id!);
  const { data: driversAvailability } = useDriversAvailability({ scheduleId: id });
  const { data: vehiclesStatus } = useVehiclesStatus({ scheduleId: id });
  const { data: trailersStatus } = useTrailersStatus(id);
  const { data: locations } = useLocations({ isActive: true });

  const parkingLocation = useMemo(() =>
    locations?.find((l: Location) => l.type === 'PARKING'),
    [locations]
  );

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
    trailers: [] as TripTrailerForm[],
  });

  const selectedVehicle = useMemo(() =>
    vehiclesStatus?.find((v: VehicleStatus) => v.id === tripForm.vehicleId),
    [vehiclesStatus, tripForm.vehicleId]
  );

  const calendarEvents = useMemo(() => {
    if (!schedule?.trips) return [];
    return schedule.trips.map((trip: Trip) => {
      const trailerInfo = trip.trailers?.map(t => t.trailer?.plate).filter(Boolean).join(', ') || '';
      const totalLiters = trip.trailers?.reduce((sum, t) => sum + t.litersLoaded, 0) || 0;
      const hasDropOff = trip.trailers?.some(t => t.dropOffLocationId);
      const hasPickup = trip.trailers?.some(t => t.isPickup);

      return {
        id: trip.id,
        title: `${trip.driver?.name || 'N/A'} - ${trip.vehicle?.plate || 'N/A'}`,
        subtitle: `${trailerInfo} (${formatLiters(totalLiters)})`,
        start: new Date(trip.departureTime),
        end: trip.returnTime ? new Date(trip.returnTime) : new Date(new Date(trip.departureTime).getTime() + 8 * 60 * 60 * 1000),
        resource: trip,
        hasDropOff,
        hasPickup,
      };
    });
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
    const trip = event.resource as Trip;
    setSelectedTrip(trip);
    setIsNewTrip(false);
    setTripForm({
      driverId: trip.driverId,
      vehicleId: trip.vehicleId,
      date: new Date(trip.date).toISOString().split('T')[0],
      departureTime: formatTime(trip.departureTime),
      trailers: trip.trailers?.map(t => ({
        trailerId: t.trailerId,
        litersLoaded: t.litersLoaded,
        dropOffLocationId: t.dropOffLocationId || '',
        isPickup: t.isPickup,
      })) || [],
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
      trailers: [],
    });
    setIsDialogOpen(true);
  };

  const handleAddTrailer = () => {
    if (!selectedVehicle || tripForm.trailers.length >= selectedVehicle.maxTrailers) return;
    setTripForm({
      ...tripForm,
      trailers: [
        ...tripForm.trailers,
        { trailerId: '', litersLoaded: 17500, dropOffLocationId: '', isPickup: false },
      ],
    });
  };

  const handleRemoveTrailer = (index: number) => {
    setTripForm({
      ...tripForm,
      trailers: tripForm.trailers.filter((_, i) => i !== index),
    });
  };

  const handleTrailerChange = (index: number, field: keyof TripTrailerForm, value: any) => {
    const newTrailers = [...tripForm.trailers];
    newTrailers[index] = { ...newTrailers[index], [field]: value };

    // Se attivo "Recupero da Tirano", resetta "Sgancia a Tirano"
    if (field === 'isPickup' && value === true) {
      newTrailers[index].dropOffLocationId = '';
    }

    setTripForm({ ...tripForm, trailers: newTrailers });
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
        trailers: tripForm.trailers
          .filter(t => t.trailerId)
          .map(t => ({
            trailerId: t.trailerId,
            litersLoaded: t.litersLoaded,
            dropOffLocationId: t.dropOffLocationId || undefined,
            isPickup: t.isPickup,
          })),
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

  const EventComponent = ({ event }: { event: any }) => (
    <div className="text-xs leading-tight">
      <div className="font-medium truncate">{event.title}</div>
      <div className="opacity-80 truncate">{event.subtitle}</div>
      <div className="flex gap-1 mt-0.5">
        {event.hasDropOff && (
          <span title="Sgancio cisterna" className="text-yellow-200">
            <ArrowDown className="h-3 w-3" />
          </span>
        )}
        {event.hasPickup && (
          <span title="Recupero cisterna" className="text-green-200">
            <ArrowUp className="h-3 w-3" />
          </span>
        )}
      </div>
    </div>
  );

  if (isLoading) return <p>Caricamento...</p>;
  if (!schedule) return <p>Pianificazione non trovata</p>;

  const totalLitersPlanned = schedule.trips?.reduce(
    (sum: number, trip: Trip) =>
      sum + (trip.trailers?.reduce((ts: number, t: any) => ts + t.litersLoaded, 0) || 0),
    0
  );

  // Group trailers by location
  const trailersByLocation = {
    source: trailersStatus?.filter((t: TrailerStatus) => t.currentLocation === 'SOURCE') || [],
    parking: trailersStatus?.filter((t: TrailerStatus) => t.currentLocation === 'PARKING') || [],
    transit: trailersStatus?.filter((t: TrailerStatus) => t.currentLocation === 'IN_TRANSIT') || [],
  };

  return (
    <div className="space-y-6">
      {/* Header */}
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

      {/* Resource Status */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Trailers Status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Container className="h-4 w-4" />
              Stato Cisterne
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <CircleDot className="h-3 w-3 text-blue-500" />
                Deposito Milano ({trailersByLocation.source.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {trailersByLocation.source.map((t: TrailerStatus) => (
                  <Badge key={t.id} variant="outline" className="text-xs">
                    {t.plate}
                  </Badge>
                ))}
                {trailersByLocation.source.length === 0 && (
                  <span className="text-xs text-muted-foreground">Nessuna</span>
                )}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <CircleDot className="h-3 w-3 text-orange-500" />
                Parcheggio Tirano ({trailersByLocation.parking.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {trailersByLocation.parking.map((t: TrailerStatus) => (
                  <Badge key={t.id} variant="outline" className="text-xs bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800">
                    {t.plate}
                  </Badge>
                ))}
                {trailersByLocation.parking.length === 0 && (
                  <span className="text-xs text-muted-foreground">Nessuna</span>
                )}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <CircleDot className="h-3 w-3 text-purple-500" />
                In Viaggio ({trailersByLocation.transit.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {trailersByLocation.transit.map((t: TrailerStatus) => (
                  <Badge key={t.id} variant="outline" className="text-xs bg-purple-50 dark:bg-purple-950 border-purple-200 dark:border-purple-800">
                    {t.plate}
                  </Badge>
                ))}
                {trailersByLocation.transit.length === 0 && (
                  <span className="text-xs text-muted-foreground">Nessuna</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Vehicles Status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Truck className="h-4 w-4" />
              Stato Motrici
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {vehiclesStatus?.map((v: VehicleStatus) => (
              <div key={v.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{v.plate}</span>
                  {v.name && <span className="text-muted-foreground">({v.name})</span>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={v.status === 'AVAILABLE' ? 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300' : 'bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300'}
                  >
                    {v.status === 'AVAILABLE' ? 'Disponibile' : 'In uso'}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{v.tripsCount} viaggi</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Drivers Status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              Disponibilità Autisti
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {driversAvailability?.slice(0, 5).map((d: DriverAvailability) => (
              <div key={d.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{d.name}</span>
                  <Badge variant="outline" className="text-xs">
                    {getDriverTypeLabel(d.type)}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full ${d.weeklyStats.percentUsed > 80 ? 'bg-red-500' : d.weeklyStats.percentUsed > 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
                      style={{ width: `${Math.min(100, d.weeklyStats.percentUsed)}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground w-10">
                    {d.weeklyStats.hoursWorked}h
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Validation Result */}
      {validationResult && (
        <Card className={validationResult.isValid ? 'border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800' : 'border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800'}>
          <CardHeader>
            <CardTitle className={validationResult.isValid ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}>
              Risultato Validazione ADR
            </CardTitle>
          </CardHeader>
          <CardContent>
            {validationResult.violations.length > 0 && (
              <div className="mb-4">
                <h4 className="font-medium text-red-800 dark:text-red-200">Violazioni:</h4>
                <ul className="list-inside list-disc text-sm text-red-700 dark:text-red-300">
                  {validationResult.violations.map((v, i) => (
                    <li key={i}>{v.message} ({v.driverName})</li>
                  ))}
                </ul>
              </div>
            )}
            {validationResult.warnings.length > 0 && (
              <div>
                <h4 className="font-medium text-yellow-800 dark:text-yellow-200">Avvisi:</h4>
                <ul className="list-inside list-disc text-sm text-yellow-700 dark:text-yellow-300">
                  {validationResult.warnings.map((w, i) => (
                    <li key={i}>{w.message} ({w.driverName})</li>
                  ))}
                </ul>
              </div>
            )}
            {validationResult.isValid && validationResult.warnings.length === 0 && (
              <p className="text-green-700 dark:text-green-300">Nessuna violazione o avviso trovato.</p>
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
                  trailers: [],
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
              components={{
                event: EventComponent,
              }}
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

      {/* Trip Dialog - Improved */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {isNewTrip ? 'Nuovo Viaggio' : 'Dettaglio Viaggio'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Driver & Vehicle row */}
            <div className="grid grid-cols-2 gap-4">
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
                    {driversAvailability?.map((d: DriverAvailability) => (
                      <SelectItem key={d.id} value={d.id}>
                        <div className="flex items-center gap-2">
                          <span>{d.name}</span>
                          <span className="text-xs text-muted-foreground">
                            ({getDriverTypeLabel(d.type)})
                          </span>
                          {d.status === 'DRIVING' && (
                            <Badge variant="outline" className="text-xs">In viaggio</Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Motrice</Label>
                <Select
                  value={tripForm.vehicleId}
                  onValueChange={(v) => setTripForm({ ...tripForm, vehicleId: v, trailers: [] })}
                  disabled={schedule.status !== 'DRAFT'}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleziona motrice..." />
                  </SelectTrigger>
                  <SelectContent>
                    {vehiclesStatus?.map((v: VehicleStatus) => (
                      <SelectItem key={v.id} value={v.id}>
                        <div className="flex items-center gap-2">
                          <span>{v.plate}</span>
                          {v.name && <span className="text-xs text-muted-foreground">({v.name})</span>}
                          <span className="text-xs text-muted-foreground">
                            max {v.maxTrailers} cisterne
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Date & Time row */}
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

            {/* Trailers Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base">Cisterne</Label>
                {schedule.status === 'DRAFT' && selectedVehicle && tripForm.trailers.length < selectedVehicle.maxTrailers && (
                  <Button type="button" variant="outline" size="sm" onClick={handleAddTrailer}>
                    <Plus className="h-4 w-4 mr-1" />
                    Aggiungi Cisterna
                  </Button>
                )}
              </div>

              {!tripForm.vehicleId && (
                <p className="text-sm text-muted-foreground">Seleziona prima una motrice</p>
              )}

              {tripForm.trailers.map((trailer, index) => (
                <Card key={index} className="p-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Cisterna {index + 1}</span>
                      {schedule.status === 'DRAFT' && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveTrailer(index)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Cisterna</Label>
                        <Select
                          value={trailer.trailerId}
                          onValueChange={(v) => handleTrailerChange(index, 'trailerId', v)}
                          disabled={schedule.status !== 'DRAFT'}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleziona..." />
                          </SelectTrigger>
                          <SelectContent>
                            {trailersStatus?.map((t: TrailerStatus) => (
                              <SelectItem
                                key={t.id}
                                value={t.id}
                                disabled={tripForm.trailers.some((tt, i) => i !== index && tt.trailerId === t.id)}
                              >
                                <div className="flex items-center gap-2">
                                  <span>{t.plate}</span>
                                  <Badge variant="outline" className={`text-xs ${
                                    t.currentLocation === 'SOURCE' ? 'bg-blue-50 dark:bg-blue-950' :
                                    t.currentLocation === 'PARKING' ? 'bg-orange-50 dark:bg-orange-950' : 'bg-purple-50 dark:bg-purple-950'
                                  }`}>
                                    {t.currentLocationName}
                                  </Badge>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label className="text-xs">Litri</Label>
                        <Input
                          type="number"
                          value={trailer.litersLoaded}
                          onChange={(e) => handleTrailerChange(index, 'litersLoaded', parseInt(e.target.value) || 0)}
                          disabled={schedule.status !== 'DRAFT'}
                        />
                      </div>
                    </div>

                    {/* Pickup/DropOff options */}
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={trailer.isPickup}
                          onChange={(e) => handleTrailerChange(index, 'isPickup', e.target.checked)}
                          disabled={schedule.status !== 'DRAFT'}
                          className="rounded border-input"
                        />
                        <ArrowUp className="h-4 w-4 text-green-600" />
                        Recupero da Tirano
                      </label>

                      {!trailer.isPickup && parkingLocation && (
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={trailer.dropOffLocationId === parkingLocation.id}
                            onChange={(e) => handleTrailerChange(
                              index,
                              'dropOffLocationId',
                              e.target.checked ? parkingLocation.id : ''
                            )}
                            disabled={schedule.status !== 'DRAFT'}
                            className="rounded border-input"
                          />
                          <ArrowDown className="h-4 w-4 text-orange-600" />
                          Sgancia a Tirano
                        </label>
                      )}
                    </div>
                  </div>
                </Card>
              ))}

              {tripForm.vehicleId && tripForm.trailers.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nessuna cisterna aggiunta. Clicca "Aggiungi Cisterna" per iniziare.
                </p>
              )}
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
              <Button onClick={handleSaveTrip} disabled={!tripForm.driverId || !tripForm.vehicleId}>
                {isNewTrip ? 'Crea' : 'Salva'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
