import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  useSchedules,
  useCreateSchedule,
  useDeleteSchedule,
} from '@/hooks/useSchedules';
import { schedulesApi } from '@/api/client';
import type { MaxCapacityResult, DriverAvailabilityInput } from '@/api/client';
import { useTrailers } from '@/hooks/useTrailers';
import { useVehicles } from '@/hooks/useVehicles';
import { useDrivers } from '@/hooks/useDrivers';
import { useLocations } from '@/hooks/useLocations';
import { useToast } from '@/hooks/useToast';
import { Plus, Eye, Trash2, Zap, Loader2 } from 'lucide-react';
import { formatDate, formatLiters, getStatusLabel, getStatusColor } from '@/lib/utils';
import type { Schedule, Trailer, Vehicle, Location, Driver } from '@/types';

interface TrailerInitialState {
  trailerId: string;
  locationId: string;
  isFull: boolean;
}

interface VehicleInitialState {
  vehicleId: string;
  locationId: string;
  isTankFull: boolean;
}

// Helper: genera giorni tra due date (con opzione weekend)
function getWorkingDaysBetween(start: Date, end: Date, includeWeekend: boolean = false): string[] {
  const days: string[] = [];
  const current = new Date(start);
  while (current <= end) {
    const dayOfWeek = current.getDay();
    // Se includeWeekend: tutti i giorni. Altrimenti solo Lun-Ven
    if (includeWeekend || (dayOfWeek >= 1 && dayOfWeek <= 5)) {
      days.push(current.toISOString().split('T')[0]);
    }
    current.setDate(current.getDate() + 1);
  }
  return days;
}

// Helper: inizializza disponibilità default per driver
function getDefaultAvailability(
  drivers: Driver[],
  workingDays: string[]
): Map<string, Set<string>> {
  const availability = new Map<string, Set<string>>();
  for (const driver of drivers) {
    if (driver.type === 'RESIDENT') {
      availability.set(driver.id, new Set(workingDays));
    } else {
      availability.set(driver.id, new Set());
    }
  }
  return availability;
}

// Helper: formatta data per display (es. "Lun 3")
function formatDayShort(dateStr: string): string {
  const date = new Date(dateStr);
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  return `${dayNames[date.getDay()]} ${date.getDate()}`;
}

// Helper: raggruppa giorni per settimana
function groupDaysByWeek(days: string[]): string[][] {
  const weeks: string[][] = [];
  let currentWeek: string[] = [];
  let lastWeekNum = -1;

  for (const day of days) {
    const date = new Date(day);
    const weekNum = getWeekNumber(date);
    if (lastWeekNum !== -1 && weekNum !== lastWeekNum) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    currentWeek.push(day);
    lastWeekNum = weekNum;
  }
  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }
  return weeks;
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// Helper: ottieni label tipo driver
function getDriverTypeLabel(type: string): string {
  switch (type) {
    case 'RESIDENT': return 'Dipendente';
    case 'ON_CALL': return 'A chiamata';
    case 'EMERGENCY': return 'Emergenza';
    default: return type;
  }
}

// Helper: ottieni colore badge tipo driver
function getDriverTypeBadgeColor(type: string): string {
  switch (type) {
    case 'RESIDENT': return 'bg-green-100 text-green-800';
    case 'ON_CALL': return 'bg-yellow-100 text-yellow-800';
    case 'EMERGENCY': return 'bg-red-100 text-red-800';
    default: return 'bg-gray-100 text-gray-800';
  }
}

const scheduleSchema = z.object({
  name: z.string().min(1, 'Il nome è obbligatorio'),
  startDate: z.string().min(1, 'La data di inizio è obbligatoria'),
  endDate: z.string().min(1, 'La data di fine è obbligatoria'),
  requiredLiters: z.coerce.number().int().min(0),
  notes: z.string().optional(),
});

type ScheduleFormData = z.infer<typeof scheduleSchema>;

export default function Schedules() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [initialStates, setInitialStates] = useState<TrailerInitialState[]>([]);
  const [vehicleStates, setVehicleStates] = useState<VehicleInitialState[]>([]);
  const [driverAvailability, setDriverAvailability] = useState<Map<string, Set<string>>>(new Map());
  const [isMaxPreviewOpen, setIsMaxPreviewOpen] = useState(false);
  const [maxCapacityResult, setMaxCapacityResult] = useState<MaxCapacityResult | null>(null);
  const [includeWeekend, setIncludeWeekend] = useState(false);
  const [maxCalcStartedAt, setMaxCalcStartedAt] = useState<number | null>(null);
  const [maxCalcElapsedSeconds, setMaxCalcElapsedSeconds] = useState(0);

  const { data: schedules, isLoading } = useSchedules();
  const { data: trailers } = useTrailers(true); // Only active trailers
  const { data: vehicles } = useVehicles(true); // Only active vehicles
  const { data: drivers } = useDrivers({ isActive: true }); // Only active drivers
  const { data: locations } = useLocations({ isActive: true });
  const createMutation = useCreateSchedule();
  const deleteMutation = useDeleteSchedule();
  const { toast } = useToast();
  const [isCalculatingMax, setIsCalculatingMax] = useState(false);
  const [maxCalcJobId, setMaxCalcJobId] = useState<string | null>(null);
  const [maxCalcProgress, setMaxCalcProgress] = useState<{
    solutions?: number;
    objective_liters?: number;
    objective_deliveries?: number;
    elapsed_seconds?: number;
  } | null>(null);
  const [maxMode, setMaxMode] = useState<'quick' | 'optimal'>('optimal');
  const [stopRequested, setStopRequested] = useState(false);

  // Get parking location (Tirano) as fallback default
  const parkingLocation = locations?.find((l: Location) => l.type === 'PARKING');

  // Initialize initial states when dialog opens and data is available
  // Uses each trailer's/vehicle's baseLocation as default, falls back to Tirano if not set
  useEffect(() => {
    if (isDialogOpen && trailers && vehicles && parkingLocation && locations) {
      const defaultTrailerStates: TrailerInitialState[] = trailers.map((trailer: Trailer) => ({
        trailerId: trailer.id,
        locationId: trailer.baseLocationId || parkingLocation.id,
        isFull: false, // Default: empty
      }));
      setInitialStates(defaultTrailerStates);

      const defaultVehicleStates: VehicleInitialState[] = vehicles.map((vehicle: Vehicle) => ({
        vehicleId: vehicle.id,
        locationId: vehicle.baseLocationId || parkingLocation.id,
        isTankFull: false, // Default: cisterna integrata vuota
      }));
      setVehicleStates(defaultVehicleStates);
    }
  }, [isDialogOpen, trailers, vehicles, parkingLocation, locations]);

  const updateTrailerState = (trailerId: string, field: 'locationId' | 'isFull', value: string | boolean) => {
    setInitialStates(prev => prev.map(state =>
      state.trailerId === trailerId ? { ...state, [field]: value } : state
    ));
    // Invalida il risultato MAX perché lo stato iniziale è cambiato
    setMaxCapacityResult(null);
  };

  const updateVehicleState = (vehicleId: string, field: 'locationId' | 'isTankFull', value: string | boolean) => {
    setVehicleStates(prev => prev.map(state =>
      state.vehicleId === vehicleId ? { ...state, [field]: value } : state
    ));
    // Invalida il risultato MAX perché lo stato iniziale è cambiato
    setMaxCapacityResult(null);
  };

  const {
    register,
    handleSubmit,
    reset,
    getValues,
    setValue,
    control,
    formState: { errors },
  } = useForm<ScheduleFormData>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      requiredLiters: 0,
    },
  });

  // Watch date fields
  const watchedStartDate = useWatch({ control, name: 'startDate' });
  const watchedEndDate = useWatch({ control, name: 'endDate' });

  // Compute working days from watched dates
  const workingDays = useMemo(() => {
    if (!watchedStartDate || !watchedEndDate) return [];
    const start = new Date(watchedStartDate);
    const end = new Date(watchedEndDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return [];
    return getWorkingDaysBetween(start, end, includeWeekend);
  }, [watchedStartDate, watchedEndDate, includeWeekend]);

  // Group working days by week for display
  const workingDaysByWeek = useMemo(() => groupDaysByWeek(workingDays), [workingDays]);

  // Initialize driver availability when dialog opens or drivers/dates change
  useEffect(() => {
    if (isDialogOpen && drivers && workingDays.length > 0) {
      setDriverAvailability(getDefaultAvailability(drivers, workingDays));
    }
  }, [isDialogOpen, drivers, workingDays]);

  // Invalida MAX quando cambiano le date (workingDays)
  useEffect(() => {
    setMaxCapacityResult(null);
  }, [workingDays]);

  // Elapsed timer for long-running MAX calculations
  useEffect(() => {
    if (!isCalculatingMax || maxCalcStartedAt === null) {
      return;
    }
    const timer = setInterval(() => {
      setMaxCalcElapsedSeconds(Math.floor((Date.now() - maxCalcStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isCalculatingMax, maxCalcStartedAt]);

  // Helper to toggle a single day for a driver
  const toggleDriverDay = (driverId: string, date: string) => {
    setDriverAvailability(prev => {
      const newMap = new Map(prev);
      const driverDays = new Set(newMap.get(driverId) || []);
      if (driverDays.has(date)) {
        driverDays.delete(date);
      } else {
        driverDays.add(date);
      }
      newMap.set(driverId, driverDays);
      return newMap;
    });
    // Invalida il risultato MAX perché la disponibilità è cambiata
    setMaxCapacityResult(null);
  };

  // Helper to select all days for a driver
  const selectAllDaysForDriver = (driverId: string) => {
    setDriverAvailability(prev => {
      const newMap = new Map(prev);
      newMap.set(driverId, new Set(workingDays));
      return newMap;
    });
    // Invalida il risultato MAX perché la disponibilità è cambiata
    setMaxCapacityResult(null);
  };

  // Helper to select no days for a driver
  const selectNoDaysForDriver = (driverId: string) => {
    setDriverAvailability(prev => {
      const newMap = new Map(prev);
      newMap.set(driverId, new Set());
      return newMap;
    });
    // Invalida il risultato MAX perché la disponibilità è cambiata
    setMaxCapacityResult(null);
  };

  // Convert driver availability to API format
  const getDriverAvailabilityForApi = (): DriverAvailabilityInput[] => {
    const result: DriverAvailabilityInput[] = [];
    driverAvailability.forEach((dates, driverId) => {
      if (dates.size > 0) {
        result.push({
          driverId,
          availableDates: Array.from(dates).sort(),
        });
      }
    });
    return result;
  };

  const openCreateDialog = () => {
    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    reset({
      name: '',
      startDate: today.toISOString().split('T')[0],
      endDate: nextWeek.toISOString().split('T')[0],
      requiredLiters: 0,
      notes: '',
    });
    setIncludeWeekend(false);
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: ScheduleFormData) => {
    try {
      // endDate deve essere a fine giornata (23:59:59) per includere l'ultimo giorno
      const endDateObj = new Date(data.endDate);
      endDateObj.setHours(23, 59, 59, 999);

      const payload = {
        ...data,
        startDate: new Date(data.startDate).toISOString(),
        endDate: endDateObj.toISOString(),
        initialStates: initialStates.length > 0 ? initialStates : undefined,
        vehicleStates: vehicleStates.length > 0 ? vehicleStates : undefined,
        includeWeekend,
      };
      await createMutation.mutateAsync(payload);
      toast({ title: 'Pianificazione creata', variant: 'success' });
      setIsDialogOpen(false);
    } catch (error) {
      toast({ title: 'Errore', description: 'Operazione fallita', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Sei sicuro di voler eliminare questa pianificazione?')) return;
    try {
      await deleteMutation.mutateAsync(id);
      toast({ title: 'Pianificazione eliminata', variant: 'success' });
    } catch (error) {
      toast({ title: 'Errore', description: 'Impossibile eliminare', variant: 'destructive' });
    }
  };

  const handleCalculateMax = async () => {
    const formValues = getValues();
    if (!formValues.startDate || !formValues.endDate) {
      toast({
        title: 'Errore',
        description: 'Seleziona prima le date di inizio e fine',
        variant: 'destructive',
      });
      return;
    }

    // Check if at least one driver is available
    const driverAvailabilityApi = getDriverAvailabilityForApi();
    if (driverAvailabilityApi.length === 0) {
      toast({
        title: 'Errore',
        description: 'Seleziona almeno un autista disponibile per almeno un giorno',
        variant: 'destructive',
      });
      return;
    }

    try {
      setMaxCalcStartedAt(Date.now());
      setMaxCalcElapsedSeconds(0);
      setMaxCalcProgress(null);
      setStopRequested(false);

      // endDate deve essere a fine giornata (23:59:59) per includere l'ultimo giorno
      const endDateObj = new Date(formValues.endDate);
      endDateObj.setHours(23, 59, 59, 999);

      setIsCalculatingMax(true);

      const payload = {
        startDate: new Date(formValues.startDate).toISOString(),
        endDate: endDateObj.toISOString(),
        initialStates: initialStates.length > 0 ? initialStates : undefined,
        vehicleStates: vehicleStates.length > 0 ? vehicleStates : undefined,
        driverAvailability: driverAvailabilityApi,
        includeWeekend,
        timeLimitSeconds: maxMode === 'quick' ? 60 : 14400,
      };

      const job = await schedulesApi.startCalculateMaxJob(payload);
      setMaxCalcJobId(job.jobId);

      const maxWaitMs = 4 * 60 * 60 * 1000;
      const pollEveryMs = 2000;
      const pollStart = Date.now();
      let result: MaxCapacityResult | null = null;

      while (Date.now() - pollStart < maxWaitMs) {
        const status = await schedulesApi.getCalculateMaxJob(job.jobId);
        if (status.progress) {
          setMaxCalcProgress(status.progress);
        }
        if (status.status === 'COMPLETED' && status.result) {
          result = status.result;
          break;
        }
        if (status.status === 'FAILED') {
          throw new Error(status.error || 'Calcolo MAX fallito');
        }
        await new Promise(resolve => setTimeout(resolve, pollEveryMs));
      }

      if (!result) {
        throw new Error('Timeout lato client: il calcolo MAX ha superato 4 ore');
      }

      setMaxCapacityResult(result);
      setIsMaxPreviewOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Impossibile calcolare la capacità massima';
      toast({
        title: 'Errore',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsCalculatingMax(false);
      setMaxCalcStartedAt(null);
      setMaxCalcElapsedSeconds(0);
      setMaxCalcJobId(null);
      setMaxCalcProgress(null);
      setStopRequested(false);
    }
  };

  const handleStopMax = async () => {
    if (!maxCalcJobId) return;
    setStopRequested(true);
    try {
      await schedulesApi.stopCalculateMaxJob(maxCalcJobId);
    } catch {
      // ignore; polling will surface status
    }
  };

  const handleConfirmMax = async () => {
    if (!maxCapacityResult) return;

    const formValues = getValues();
    setValue('requiredLiters', maxCapacityResult.maxLiters);
    setIsMaxPreviewOpen(false);

    // Auto-generate name if empty
    if (!formValues.name) {
      const start = new Date(formValues.startDate);
      const end = new Date(formValues.endDate);
      setValue(
        'name',
        `MAX ${start.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} - ${end.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}`
      );
    }

    toast({
      title: 'Capacità massima impostata',
      description: `${maxCapacityResult.maxLiters.toLocaleString()}L in ${maxCapacityResult.daysWithDeliveries} giorni con autisti`,
      variant: 'success',
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Pianificazione</h1>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Nuova Pianificazione
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Elenco Pianificazioni</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p>Caricamento...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Periodo</TableHead>
                  <TableHead>Litri Richiesti</TableHead>
                  <TableHead>Viaggi</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules?.map((schedule: Schedule) => (
                  <TableRow key={schedule.id}>
                    <TableCell className="font-medium">{schedule.name}</TableCell>
                    <TableCell>
                      {formatDate(schedule.startDate)} - {formatDate(schedule.endDate)}
                    </TableCell>
                    <TableCell>{formatLiters(schedule.requiredLiters)}</TableCell>
                    <TableCell>{schedule._count?.trips || 0}</TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(schedule.status)}>
                        {getStatusLabel(schedule.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" asChild>
                        <Link to={`/schedules/${schedule.id}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                      {schedule.status === 'DRAFT' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(schedule.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuova Pianificazione</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)}>
            {/* Three Column Layout */}
            <div className="grid grid-cols-3 gap-4">
              {/* Column 1: Project Details */}
              <div className="space-y-3">
                <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide border-b pb-2">
                  Progetto
                </h3>
                <div>
                  <Label htmlFor="name">Nome</Label>
                  <Input id="name" placeholder="es. Settimana 1-7 Febbraio" {...register('name')} />
                  {errors.name && (
                    <p className="text-sm text-destructive">{errors.name.message}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="startDate">Data Inizio</Label>
                    <Input id="startDate" type="date" {...register('startDate')} />
                    {errors.startDate && (
                      <p className="text-sm text-destructive">{errors.startDate.message}</p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="endDate">Data Fine</Label>
                    <Input id="endDate" type="date" {...register('endDate')} />
                    {errors.endDate && (
                      <p className="text-sm text-destructive">{errors.endDate.message}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                  <div>
                    <Label htmlFor="includeWeekend" className="font-medium text-sm">Includi weekend</Label>
                    <p className="text-xs text-muted-foreground">
                      Per consegne sabato/domenica
                    </p>
                  </div>
                  <Switch
                    id="includeWeekend"
                    checked={includeWeekend}
                    onCheckedChange={(checked) => {
                      setIncludeWeekend(checked);
                      setMaxCapacityResult(null); // Invalida MAX
                    }}
                  />
                </div>

                <div>
                  <Label htmlFor="requiredLiters">Litri Richiesti</Label>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Modalità calcolo:</span>
                    <div className="inline-flex rounded-md border bg-background p-0.5">
                      <button
                        type="button"
                        className={`px-2 py-0.5 text-[11px] rounded ${maxMode === 'quick' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                        onClick={() => setMaxMode('quick')}
                      >
                        Stima veloce (60s)
                      </button>
                      <button
                        type="button"
                        className={`px-2 py-0.5 text-[11px] rounded ${maxMode === 'optimal' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                        onClick={() => setMaxMode('optimal')}
                      >
                        Ottimizza (4h)
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      id="requiredLiters"
                      type="number"
                      min={0}
                      placeholder="es. 70000"
                      className="flex-1"
                      {...register('requiredLiters')}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handleCalculateMax}
                      disabled={isCalculatingMax}
                      title="Calcola capacità massima"
                    >
                      {isCalculatingMax ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Zap className="h-4 w-4" />
                      )}
                      MAX
                    </Button>
                  </div>
                  {isCalculatingMax && (
                    <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-2">
                      <p className="text-xs font-medium text-primary">
                        Calcolo MAX in corso ({maxCalcElapsedSeconds}s)
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Scenario complesso: può richiedere anche molti minuti (timeout server: 4 ore).
                      </p>
                      {maxCalcProgress && (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          Best finora: <span className="font-medium text-foreground">
                            {(maxCalcProgress.objective_liters ?? 0).toLocaleString()}L
                          </span>
                          {typeof maxCalcProgress.solutions === 'number' && (
                            <span className="ml-2">soluzioni: {maxCalcProgress.solutions}</span>
                          )}
                        </div>
                      )}
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-muted">
                        <div className="h-full w-1/3 animate-pulse rounded bg-primary/70" />
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleStopMax}
                          disabled={stopRequested}
                          className="h-7 text-[11px]"
                        >
                          {stopRequested ? 'Stop inviato' : 'Ferma qui'}
                        </Button>
                        {stopRequested && (
                          <span className="text-[11px] text-muted-foreground">Attendo l’ultima soluzione.</span>
                        )}
                      </div>
                    </div>
                  )}
                  {errors.requiredLiters && (
                    <p className="text-sm text-destructive">{errors.requiredLiters.message}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="notes">Note (opzionale)</Label>
                  <Input id="notes" {...register('notes')} />
                </div>
              </div>

              {/* Column 2: Driver Availability */}
              <div className="space-y-4">
                <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide border-b pb-2">
                  Autisti
                </h3>
                {drivers && drivers.length > 0 && workingDays.length > 0 ? (
                  <div className="space-y-2">
                    {drivers.map((driver: Driver) => {
                      const driverDays = driverAvailability.get(driver.id) || new Set();
                      const allSelected = workingDays.every(d => driverDays.has(d));
                      const noneSelected = driverDays.size === 0;

                      return (
                        <div key={driver.id} className="p-2 bg-muted/50 rounded-md">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1">
                              <span className="font-medium text-sm">{driver.name}</span>
                              <Badge className={`text-[10px] px-1 ${getDriverTypeBadgeColor(driver.type)}`}>
                                {getDriverTypeLabel(driver.type)}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant={allSelected ? 'secondary' : 'outline'}
                                size="sm"
                                className="h-5 text-[10px] px-1"
                                onClick={() => selectAllDaysForDriver(driver.id)}
                              >
                                Tutti
                              </Button>
                              <Button
                                type="button"
                                variant={noneSelected ? 'secondary' : 'outline'}
                                size="sm"
                                className="h-5 text-[10px] px-1"
                                onClick={() => selectNoDaysForDriver(driver.id)}
                              >
                                Nessuno
                              </Button>
                            </div>
                          </div>
                          <div className="space-y-1">
                            {workingDaysByWeek.map((week, weekIdx) => (
                              <div key={weekIdx} className="flex flex-wrap gap-1">
                                {week.map((day) => (
                                  <label
                                    key={day}
                                    className={`
                                      inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] cursor-pointer
                                      ${driverDays.has(day)
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-background border hover:bg-accent'
                                      }
                                    `}
                                  >
                                    <Checkbox
                                      checked={driverDays.has(day)}
                                      onCheckedChange={() => toggleDriverDay(driver.id, day)}
                                      className="h-2.5 w-2.5"
                                    />
                                    {formatDayShort(day)}
                                  </label>
                                ))}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Seleziona le date per vedere gli autisti disponibili.
                  </p>
                )}
              </div>

              {/* Column 3: Vehicles (Motrici + Cisterne) */}
              <div className="space-y-4">
                {/* Motrici Section */}
                <div>
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide border-b pb-2">
                    Motrici
                  </h3>
                  {vehicles && vehicles.length > 0 && locations && locations.length > 0 ? (
                    <div className="space-y-1 mt-2">
                      {vehicles.map((vehicle: Vehicle) => {
                        const state = vehicleStates.find(s => s.vehicleId === vehicle.id);
                        return (
                          <div key={vehicle.id} className="flex items-center gap-2 p-1.5 bg-muted/50 rounded-md">
                            <div className="flex-1 min-w-0">
                              <span className="font-medium text-xs">{vehicle.name}</span>
                              <span className="text-[10px] text-muted-foreground ml-1">
                                ({vehicle.plate})
                              </span>
                            </div>
                            <div className="w-24 shrink-0">
                              <Select
                                value={state?.locationId || ''}
                                onValueChange={(value) => updateVehicleState(vehicle.id, 'locationId', value)}
                              >
                                <SelectTrigger className="h-7 text-xs">
                                  <SelectValue placeholder="Posizione" />
                                </SelectTrigger>
                                <SelectContent>
                                  {locations.map((location: Location) => (
                                    <SelectItem key={location.id} value={location.id}>
                                      {location.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-muted-foreground w-10">
                                {state?.isTankFull ? 'Piena' : 'Vuota'}
                              </span>
                              <Switch
                                id={`tank-${vehicle.id}`}
                                checked={state?.isTankFull || false}
                                onCheckedChange={(checked) => updateVehicleState(vehicle.id, 'isTankFull', checked)}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground mt-2">Nessuna motrice disponibile.</p>
                  )}
                </div>

                {/* Cisterne Section */}
                <div>
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide border-b pb-2">
                    Cisterne
                  </h3>
                  {trailers && trailers.length > 0 && locations && locations.length > 0 ? (
                    <div className="space-y-1 mt-2">
                      {trailers.map((trailer: Trailer) => {
                        const state = initialStates.find(s => s.trailerId === trailer.id);
                        return (
                          <div key={trailer.id} className="flex items-center gap-2 p-1.5 bg-muted/50 rounded-md">
                            <div className="flex-1 min-w-0">
                              <span className="font-medium text-xs">{trailer.name}</span>
                              <span className="text-[10px] text-muted-foreground ml-1">
                                ({trailer.plate})
                              </span>
                            </div>
                            <div className="w-24 shrink-0">
                              <Select
                                value={state?.locationId || ''}
                                onValueChange={(value) => updateTrailerState(trailer.id, 'locationId', value)}
                              >
                                <SelectTrigger className="h-7 text-xs">
                                  <SelectValue placeholder="Posizione" />
                                </SelectTrigger>
                                <SelectContent>
                                  {locations.map((location: Location) => (
                                    <SelectItem key={location.id} value={location.id}>
                                      {location.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-muted-foreground w-10">
                                {state?.isFull ? 'Piena' : 'Vuota'}
                              </span>
                              <Switch
                                id={`full-${trailer.id}`}
                                checked={state?.isFull || false}
                                onCheckedChange={(checked) => updateTrailerState(trailer.id, 'isFull', checked)}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground mt-2">Nessuna cisterna disponibile.</p>
                  )}
                </div>
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Annulla
              </Button>
              <Button type="submit">Crea</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* MAX Capacity Preview Dialog */}
      <Dialog open={isMaxPreviewOpen} onOpenChange={setIsMaxPreviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Capacità Massima Calcolata</DialogTitle>
          </DialogHeader>
          {maxCapacityResult && (
            <div className="space-y-4">
              <div className="text-center py-4 bg-muted rounded-lg">
                <p className="text-4xl font-bold text-primary">
                  {maxCapacityResult.maxLiters.toLocaleString()}L
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  in {maxCapacityResult.daysWithDeliveries} giorni con autisti disponibili
                  {maxCapacityResult.daysWithDeliveries < maxCapacityResult.workingDays && (
                    <span className="text-yellow-600"> (su {maxCapacityResult.workingDays} {includeWeekend ? 'totali' : 'lavorativi'})</span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  (~{maxCapacityResult.dailyCapacity.toLocaleString()}L/giorno)
                </p>
              </div>

              <div className="space-y-2">
                <p className="font-medium text-sm">Distribuzione viaggi stimata:</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-blue-500/10 p-2 rounded border border-blue-500/30">
                    <span className="text-blue-600">Tirano → Livigno:</span>
                    <span className="font-medium ml-2">
                      {maxCapacityResult.breakdown.tiranoDriverShuttles}
                    </span>
                    <span className="text-xs text-muted-foreground ml-1">(17.5kL cad.)</span>
                  </div>
                  <div className="bg-cyan-500/10 p-2 rounded border border-cyan-500/30">
                    <span className="text-cyan-600">Livigno → Tirano → Livigno:</span>
                    <span className="font-medium ml-2">
                      {maxCapacityResult.breakdown.shuttleFromLivigno || 0}
                    </span>
                    <span className="text-xs text-muted-foreground ml-1">(17.5kL cad.)</span>
                  </div>
                  <div className="bg-pink-500/10 p-2 rounded border border-pink-500/30">
                    <span className="text-pink-600">Livigno → Milano → Livigno:</span>
                    <span className="font-medium ml-2">
                      {maxCapacityResult.breakdown.supplyFromLivigno || 0}
                    </span>
                    <span className="text-xs text-muted-foreground ml-1">(ADR, 17.5kL)</span>
                  </div>
                  <div className="bg-muted/50 p-2 rounded">
                    <span className="text-muted-foreground">Tirano → Milano → Tirano:</span>
                    <span className="font-medium ml-2">
                      {maxCapacityResult.breakdown.supplyTrips}
                    </span>
                    <span className="text-xs text-muted-foreground ml-1">(rifornimento)</span>
                  </div>
                  <div className="bg-muted/50 p-2 rounded">
                    <span className="text-muted-foreground">Transfer a Tirano:</span>
                    <span className="font-medium ml-2">
                      {maxCapacityResult.breakdown.transferTrips || 0}
                    </span>
                    <span className="text-xs text-muted-foreground ml-1">(travaso)</span>
                  </div>
                </div>
              </div>

              {/* Eccezioni ADR usate */}
              {(maxCapacityResult.breakdown.adrExceptionsUsed || 0) > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-600 font-medium">Eccezioni ADR:</span>
                    <span className="font-bold text-amber-700">
                      {maxCapacityResult.breakdown.adrExceptionsUsed}
                    </span>
                    <span className="text-sm text-amber-600/80">
                      (10h invece di 9h, max 2/settimana per driver)
                    </span>
                  </div>
                </div>
              )}

              {maxCapacityResult.constraints.length > 0 && (
                <div className="space-y-2">
                  <p className="font-medium text-sm">Note:</p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {maxCapacityResult.constraints.map((constraint, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-yellow-500">•</span>
                        {constraint}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsMaxPreviewOpen(false)}>
              Annulla
            </Button>
            <Button onClick={handleConfirmMax}>
              Usa questo valore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
