import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, addMinutes } from 'date-fns';
import { DriverTimeline } from '@/components/calendar/DriverTimeline';
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
import { useRoutes } from '@/hooks/useRoutes';
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
  Clock,
  MapPin,
  Fuel,
} from 'lucide-react';
import {
  formatDate,
  formatTime,
  formatLiters,
  getStatusLabel,
  getStatusColor,
  getDriverTypeLabel,
} from '@/lib/utils';
import type { Trip, Location, ValidationResult, TrailerStatus, VehicleStatus, DriverAvailability, Route, ScheduleInitialState, TripType } from '@/types';

// Helper per badge tipo viaggio
const getTripTypeBadge = (type: TripType) => {
  const badges: Record<TripType, { label: string; className: string }> = {
    SHUTTLE_LIVIGNO: {
      label: 'Shuttle',
      className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    },
    SUPPLY_MILANO: {
      label: 'Rifornimento',
      className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    },
    FULL_ROUND: {
      label: 'Completo',
      className: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
    },
    TRANSFER_TIRANO: {
      label: 'Sversamento',
      className: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
    },
  };
  return badges[type] || badges.FULL_ROUND;
};


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
  const { data: routes } = useRoutes(true);

  const parkingLocation = useMemo(() =>
    locations?.find((l: Location) => l.type === 'PARKING'),
    [locations]
  );

  const sourceLocation = useMemo(() =>
    locations?.find((l: Location) => l.type === 'SOURCE'),
    [locations]
  );

  const destinationLocation = useMemo(() =>
    locations?.find((l: Location) => l.type === 'DESTINATION'),
    [locations]
  );

  // Build route lookup maps
  const routeMap = useMemo(() => {
    if (!routes) return null;
    const map: Record<string, Route> = {};
    routes.forEach((r: Route) => {
      const key = `${r.fromLocationId}-${r.toLocationId}`;
      map[key] = r;
    });
    return map;
  }, [routes]);

  // Calculate trip timeline based on trip type and routes
  // TIPI DI VIAGGIO (nuovo modello con cisterna integrata):
  // - SHUTTLE_LIVIGNO: Tirano -> Livigno -> Tirano (4.5h, solo motrice - cisterna integrata)
  // - SUPPLY_MILANO: Tirano -> Milano -> Tirano (6h, motrice + 1 rimorchio)
  // - FULL_ROUND: Tirano -> Milano -> Tirano -> Livigno -> Tirano (9h, solo motrice)
  // - TRANSFER_TIRANO: Sversamento rimorchio pieno -> cisterna integrata (30 min)
  const calculateTimeline = useMemo(() => {
    return (trip: Trip | null) => {
      if (!trip || !routeMap || !sourceLocation || !parkingLocation || !destinationLocation) {
        return [];
      }

      const timeline: Array<{
        time: Date;
        location: string;
        action: string;
        icon: 'start' | 'arrive' | 'depart' | 'dropoff' | 'pickup' | 'load' | 'unload' | 'end';
        details?: string;
        trailers?: Array<{ plate: string; full: boolean }>;
      }> = [];

      const allTrailers = trip.trailers || [];
      const totalLiters = allTrailers.reduce((sum, t) => sum + t.litersLoaded, 0);
      let currentTime = new Date(trip.departureTime);

      const LOAD_TIME = 30;
      const UNLOAD_TIME = 30;

      const getRouteDuration = (fromId: string, toId: string): number => {
        const route = routeMap[`${fromId}-${toId}`];
        return route?.durationMinutes || 60;
      };

      const getTrailerPlates = (trailers: typeof trip.trailers, full: boolean) =>
        trailers?.map(t => ({ plate: t.trailer?.plate || '?', full })) || [];

      const tripType = trip.tripType || 'FULL_ROUND';

      // === SHUTTLE_LIVIGNO: Tirano -> Livigno -> Tirano (solo motrice, cisterna integrata) ===
      if (tripType === 'SHUTTLE_LIVIGNO') {
        // 1. Partenza da Tirano con cisterna integrata piena (senza rimorchio!)
        timeline.push({
          time: new Date(currentTime),
          location: parkingLocation.name,
          action: 'Partenza (cisterna integrata piena)',
          icon: 'start',
          // No trailers - solo cisterna integrata
        });

        // 2. Tirano -> Livigno (2h)
        currentTime = addMinutes(currentTime, getRouteDuration(parkingLocation.id, destinationLocation.id));
        timeline.push({
          time: new Date(currentTime),
          location: destinationLocation.name,
          action: 'Arrivo a Livigno',
          icon: 'arrive',
        });

        // 3. Scarico cisterna integrata
        timeline.push({
          time: new Date(currentTime),
          location: destinationLocation.name,
          action: 'Scarico cisterna integrata',
          icon: 'unload',
          details: '17.500 L',
        });
        currentTime = addMinutes(currentTime, UNLOAD_TIME);

        // 4. Livigno -> Tirano (ritorno)
        timeline.push({
          time: new Date(currentTime),
          location: destinationLocation.name,
          action: 'Partenza verso Tirano',
          icon: 'depart',
        });

        currentTime = addMinutes(currentTime, getRouteDuration(destinationLocation.id, parkingLocation.id));
        timeline.push({
          time: new Date(currentTime),
          location: parkingLocation.name,
          action: 'Fine turno (cisterna integrata vuota)',
          icon: 'end',
        });
      }

      // === SUPPLY_MILANO: Tirano -> Milano -> Tirano (motrice + 1 rimorchio) ===
      else if (tripType === 'SUPPLY_MILANO') {
        // 1. Partenza da Tirano con motrice + 1 rimorchio vuoto
        timeline.push({
          time: new Date(currentTime),
          location: parkingLocation.name,
          action: 'Partenza (motrice + rimorchio vuoto)',
          icon: 'start',
          trailers: getTrailerPlates(allTrailers, false),
        });

        // 2. Tirano -> Milano
        currentTime = addMinutes(currentTime, getRouteDuration(parkingLocation.id, sourceLocation.id));
        timeline.push({
          time: new Date(currentTime),
          location: sourceLocation.name,
          action: 'Arrivo a Milano',
          icon: 'arrive',
          trailers: getTrailerPlates(allTrailers, false),
        });

        // 3. Carico cisterna integrata + rimorchio (35.000L totali)
        timeline.push({
          time: new Date(currentTime),
          location: sourceLocation.name,
          action: 'Carico carburante (integrata + rimorchio)',
          icon: 'load',
          details: '35.000 L totali',
          trailers: getTrailerPlates(allTrailers, true),
        });
        currentTime = addMinutes(currentTime, LOAD_TIME * 2); // Carico doppio

        // 4. Milano -> Tirano (ritorno)
        timeline.push({
          time: new Date(currentTime),
          location: sourceLocation.name,
          action: 'Partenza verso Tirano',
          icon: 'depart',
          trailers: getTrailerPlates(allTrailers, true),
        });

        currentTime = addMinutes(currentTime, getRouteDuration(sourceLocation.id, parkingLocation.id));
        timeline.push({
          time: new Date(currentTime),
          location: parkingLocation.name,
          action: 'Fine - Rimorchio pieno a Tirano (da sversare)',
          icon: 'end',
          trailers: getTrailerPlates(allTrailers, true),
        });
      }

      // === TRANSFER_TIRANO: Sversamento rimorchio pieno -> cisterna integrata ===
      else if (tripType === 'TRANSFER_TIRANO') {
        const TRANSFER_TIME = 30;

        // 1. Inizio sversamento a Tirano
        timeline.push({
          time: new Date(currentTime),
          location: parkingLocation.name,
          action: 'Inizio sversamento rimorchio',
          icon: 'start',
          trailers: getTrailerPlates(allTrailers, true),
        });

        // 2. Sversamento in corso
        timeline.push({
          time: new Date(currentTime),
          location: parkingLocation.name,
          action: 'Sversamento in cisterna integrata',
          icon: 'unload',
          details: `${totalLiters.toLocaleString()} L`,
          trailers: getTrailerPlates(allTrailers, false),
        });
        currentTime = addMinutes(currentTime, TRANSFER_TIME);

        // 3. Fine sversamento
        timeline.push({
          time: new Date(currentTime),
          location: parkingLocation.name,
          action: 'Sversamento completato - Motrice pronta',
          icon: 'end',
          trailers: getTrailerPlates(allTrailers, false),
        });
      }

      // === FULL_ROUND: Tirano -> Milano -> Tirano -> Livigno -> Tirano ===
      // Usa solo la cisterna integrata della motrice (17.500L), senza rimorchi
      else if (tripType === 'FULL_ROUND') {
        const INTEGRATED_TANK_LITERS = 17500;

        // 1. Partenza da Tirano (solo motrice, cisterna vuota)
        timeline.push({
          time: new Date(currentTime),
          location: parkingLocation.name,
          action: 'Partenza verso Milano',
          icon: 'start',
        });

        // 2. Tirano -> Milano
        currentTime = addMinutes(currentTime, getRouteDuration(parkingLocation.id, sourceLocation.id));
        timeline.push({
          time: new Date(currentTime),
          location: sourceLocation.name,
          action: 'Arrivo a Milano',
          icon: 'arrive',
        });

        // 3. Carico cisterna integrata a Milano
        timeline.push({
          time: new Date(currentTime),
          location: sourceLocation.name,
          action: 'Carico cisterna integrata',
          icon: 'load',
          details: `${INTEGRATED_TANK_LITERS.toLocaleString()} L`,
        });
        currentTime = addMinutes(currentTime, LOAD_TIME);

        // 4. Milano -> Tirano
        timeline.push({
          time: new Date(currentTime),
          location: sourceLocation.name,
          action: 'Partenza verso Tirano',
          icon: 'depart',
        });

        currentTime = addMinutes(currentTime, getRouteDuration(sourceLocation.id, parkingLocation.id));
        timeline.push({
          time: new Date(currentTime),
          location: parkingLocation.name,
          action: 'Arrivo a Tirano',
          icon: 'arrive',
        });

        // 5. Tirano -> Livigno
        timeline.push({
          time: new Date(currentTime),
          location: parkingLocation.name,
          action: 'Partenza verso Livigno',
          icon: 'depart',
        });

        currentTime = addMinutes(currentTime, getRouteDuration(parkingLocation.id, destinationLocation.id));
        timeline.push({
          time: new Date(currentTime),
          location: destinationLocation.name,
          action: 'Arrivo a Livigno',
          icon: 'arrive',
        });

        // 6. Scarico cisterna integrata a Livigno
        timeline.push({
          time: new Date(currentTime),
          location: destinationLocation.name,
          action: 'Scarico cisterna integrata',
          icon: 'unload',
          details: `${INTEGRATED_TANK_LITERS.toLocaleString()} L`,
        });
        currentTime = addMinutes(currentTime, UNLOAD_TIME);

        // 7. Livigno -> Tirano (ritorno)
        timeline.push({
          time: new Date(currentTime),
          location: destinationLocation.name,
          action: 'Partenza verso Tirano',
          icon: 'depart',
        });

        currentTime = addMinutes(currentTime, getRouteDuration(destinationLocation.id, parkingLocation.id));
        timeline.push({
          time: new Date(currentTime),
          location: parkingLocation.name,
          action: 'Fine turno',
          icon: 'end',
        });
      }

      return timeline;
    };
  }, [routeMap, sourceLocation, parkingLocation, destinationLocation]);

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

  // Extract drivers list from availability data
  const activeDrivers = useMemo(() => {
    if (!driversAvailability) return [];
    return driversAvailability.map((d: DriverAvailability) => ({
      id: d.id,
      name: d.name,
      type: d.type,
    }));
  }, [driversAvailability]);

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

  const handleTripSelect = (trip: Trip) => {
    setSelectedTrip(trip);
    // Don't open dialog, just select for detail panel
  };

  const handleEditTrip = () => {
    if (!selectedTrip) return;
    setIsNewTrip(false);
    setTripForm({
      driverId: selectedTrip.driverId,
      vehicleId: selectedTrip.vehicleId,
      date: new Date(selectedTrip.date).toISOString().split('T')[0],
      departureTime: formatTime(selectedTrip.departureTime),
      trailers: selectedTrip.trailers?.map(t => ({
        trailerId: t.trailerId,
        litersLoaded: t.litersLoaded,
        dropOffLocationId: t.dropOffLocationId || '',
        isPickup: t.isPickup,
      })) || [],
    });
    setIsDialogOpen(true);
  };

  const handleSlotClick = (driverId: string, date: Date, hour: number) => {
    if (schedule?.status !== 'DRAFT') return;
    setSelectedTrip(null);
    setIsNewTrip(true);
    setTripForm({
      driverId: driverId,
      vehicleId: '',
      date: format(date, 'yyyy-MM-dd'),
      departureTime: `${hour.toString().padStart(2, '0')}:00`,
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

  if (isLoading) return <p>Caricamento...</p>;
  if (!schedule) return <p>Pianificazione non trovata</p>;

  const totalLitersPlanned = schedule.trips?.reduce(
    (sum: number, trip: Trip) => {
      // FULL_ROUND e SHUTTLE usano cisterna integrata (17.500L)
      if (trip.tripType === 'FULL_ROUND' || trip.tripType === 'SHUTTLE_LIVIGNO') {
        return sum + 17500;
      }
      // Altri tipi usano i litri dai rimorchi
      return sum + (trip.trailers?.reduce((ts: number, t: any) => ts + t.litersLoaded, 0) || 0);
    },
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

      {/* Initial States - Only show if there are initial states */}
      {schedule.initialStates && schedule.initialStates.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Container className="h-4 w-4" />
              Condizioni Iniziali Cisterne
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {schedule.initialStates.map((state: ScheduleInitialState) => (
                <div key={state.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                  <div className="flex items-center gap-2">
                    <Container className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">
                      {state.trailer?.name || state.trailer?.plate || 'N/A'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {state.location?.name || 'N/A'}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`text-xs ${state.isFull ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300' : 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}
                    >
                      {state.isFull ? 'Piena' : 'Vuota'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
        <CardHeader className="flex flex-row items-center justify-between pb-2">
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
        <CardContent className="pt-0">
          <div className="h-[500px]">
            <DriverTimeline
              trips={schedule.trips || []}
              drivers={activeDrivers}
              startDate={new Date(schedule.startDate)}
              endDate={new Date(schedule.endDate)}
              onSelectTrip={handleTripSelect}
              selectedTripId={selectedTrip?.id}
              isDraft={schedule.status === 'DRAFT'}
              onSlotClick={handleSlotClick}
              routeMap={routeMap || undefined}
              locations={{
                source: sourceLocation,
                parking: parkingLocation,
                destination: destinationLocation,
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Trip Detail Panel - Below Calendar */}
      {selectedTrip && (
        <Card className="border-2 border-primary/20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Dettaglio Viaggio - {formatDate(selectedTrip.departureTime)}
                <Badge className={getTripTypeBadge(selectedTrip.tripType).className}>
                  {getTripTypeBadge(selectedTrip.tripType).label}
                </Badge>
              </CardTitle>
              <div className="flex gap-2">
                {schedule.status === 'DRAFT' && (
                  <Button size="sm" variant="outline" onClick={handleEditTrip}>
                    Modifica
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setSelectedTrip(null)}>
                  Chiudi
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-6">
              {/* Trip Info - Left Column */}
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">Risorse</h4>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{selectedTrip.driver?.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {getDriverTypeLabel(selectedTrip.driver?.type || '')}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Truck className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{selectedTrip.vehicle?.plate}</span>
                      {selectedTrip.vehicle?.name && (
                        <span className="text-muted-foreground">({selectedTrip.vehicle.name})</span>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">Cisterne</h4>
                  <div className="space-y-2">
                    {selectedTrip.trailers?.map((t, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <Container className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{t.trailer?.plate}</span>
                        <span className="text-muted-foreground">
                          {t.litersLoaded.toLocaleString()} L
                        </span>
                        {t.isPickup && (
                          <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 text-xs">
                            <ArrowUp className="h-3 w-3 mr-1" />
                            Ritiro Tirano
                          </Badge>
                        )}
                        {t.dropOffLocationId && (
                          <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 text-xs">
                            <ArrowDown className="h-3 w-3 mr-1" />
                            Lascia Tirano
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">Riepilogo</h4>
                  <div className="text-sm space-y-1">
                    <p>Tipo viaggio: <Badge className={`${getTripTypeBadge(selectedTrip.tripType).className} text-xs`}>{getTripTypeBadge(selectedTrip.tripType).label}</Badge></p>
                    <p>Totale litri: <span className="font-medium">{formatLiters(
                      // FULL_ROUND e SHUTTLE usano cisterna integrata (17.500L), non rimorchi
                      selectedTrip.tripType === 'FULL_ROUND' || selectedTrip.tripType === 'SHUTTLE_LIVIGNO'
                        ? 17500
                        : selectedTrip.trailers?.reduce((sum, t) => sum + t.litersLoaded, 0) || 0
                    )}</span></p>
                    <p>Partenza: <span className="font-medium">{formatTime(selectedTrip.departureTime)}</span></p>
                    <p>Ritorno: <span className="font-medium">{selectedTrip.returnTime ? formatTime(selectedTrip.returnTime) : '-'}</span></p>
                  </div>
                </div>
              </div>

              {/* Timeline - Right Columns (span 2) */}
              <div className="md:col-span-2">
                <h4 className="text-sm font-medium text-muted-foreground mb-3">Cronologia Viaggio</h4>
                <div className="relative bg-muted/30 rounded-lg p-4">
                  {/* Vertical line */}
                  <div className="absolute left-7 top-6 bottom-6 w-0.5 bg-border" />

                  <div className="space-y-2">
                    {calculateTimeline(selectedTrip).map((step, index) => (
                      <div key={index} className="flex items-center gap-3 relative">
                        {/* Icon */}
                        <div className={`z-10 flex items-center justify-center w-6 h-6 rounded-full shrink-0 ${
                          step.icon === 'start' ? 'bg-green-500 text-white' :
                          step.icon === 'end' ? 'bg-blue-500 text-white' :
                          step.icon === 'dropoff' ? 'bg-orange-500 text-white' :
                          step.icon === 'pickup' ? 'bg-purple-500 text-white' :
                          step.icon === 'load' ? 'bg-emerald-500 text-white' :
                          step.icon === 'unload' ? 'bg-yellow-500 text-white' :
                          'bg-muted-foreground/20 text-muted-foreground'
                        }`}>
                          {step.icon === 'start' && <MapPin className="h-3 w-3" />}
                          {step.icon === 'end' && <MapPin className="h-3 w-3" />}
                          {step.icon === 'arrive' && <ArrowDown className="h-3 w-3" />}
                          {step.icon === 'depart' && <ArrowUp className="h-3 w-3" />}
                          {step.icon === 'dropoff' && <ArrowDown className="h-3 w-3" />}
                          {step.icon === 'pickup' && <ArrowUp className="h-3 w-3" />}
                          {step.icon === 'load' && <Fuel className="h-3 w-3" />}
                          {step.icon === 'unload' && <Fuel className="h-3 w-3" />}
                        </div>

                        {/* Time */}
                        <span className="font-mono text-sm font-medium w-12 shrink-0">
                          {format(step.time, 'HH:mm')}
                        </span>

                        {/* Action & Location */}
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium">{step.action}</span>
                          <span className="text-sm text-muted-foreground ml-2">{step.location}</span>
                          {step.details && (
                            <span className="ml-2 text-xs bg-muted px-1.5 py-0.5 rounded">
                              {step.details}
                            </span>
                          )}
                        </div>

                        {/* Trailer icons */}
                        {step.trailers && step.trailers.length > 0 && (
                          <div className="flex items-center gap-1 shrink-0">
                            {step.trailers.map((trailer, ti) => (
                              <div
                                key={ti}
                                className={`relative flex items-center justify-center w-8 h-6 rounded border-2 ${
                                  trailer.full
                                    ? 'bg-amber-100 border-amber-500 dark:bg-amber-900/50'
                                    : 'bg-gray-100 border-gray-400 dark:bg-gray-800'
                                }`}
                                title={`${trailer.plate} - ${trailer.full ? 'Piena' : 'Vuota'}`}
                              >
                                <Container className={`h-3 w-3 ${trailer.full ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500'}`} />
                                {trailer.full && (
                                  <div className="absolute -top-1 -right-1 w-2 h-2 bg-amber-500 rounded-full" />
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Legend */}
                  <div className="flex items-center gap-4 mt-4 pt-3 border-t text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <div className="w-6 h-4 rounded border-2 bg-gray-100 border-gray-400 dark:bg-gray-800 flex items-center justify-center">
                        <Container className="h-2 w-2 text-gray-500" />
                      </div>
                      <span>Vuota</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="relative w-6 h-4 rounded border-2 bg-amber-100 border-amber-500 dark:bg-amber-900/50 flex items-center justify-center">
                        <Container className="h-2 w-2 text-amber-700 dark:text-amber-300" />
                        <div className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-amber-500 rounded-full" />
                      </div>
                      <span>Piena</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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

                    {/* Opzioni cisterna */}
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={trailer.isPickup}
                          onChange={(e) => handleTrailerChange(index, 'isPickup', e.target.checked)}
                          disabled={schedule.status !== 'DRAFT'}
                          className="rounded border-input"
                        />
                        <ArrowUp className="h-4 w-4 text-purple-600" />
                        Ritira cisterna da Tirano
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
                          Lascia cisterna a Tirano
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
