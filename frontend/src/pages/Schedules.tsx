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
  useCalculateMaxCapacity,
} from '@/hooks/useSchedules';
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
}

// Helper: genera working days (Lun-Ven) tra due date
function getWorkingDaysBetween(start: Date, end: Date): string[] {
  const days: string[] = [];
  const current = new Date(start);
  while (current <= end) {
    const dayOfWeek = current.getDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
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

  const { data: schedules, isLoading } = useSchedules();
  const { data: trailers } = useTrailers(true); // Only active trailers
  const { data: vehicles } = useVehicles(true); // Only active vehicles
  const { data: drivers } = useDrivers({ isActive: true }); // Only active drivers
  const { data: locations } = useLocations({ isActive: true });
  const createMutation = useCreateSchedule();
  const deleteMutation = useDeleteSchedule();
  const calculateMaxMutation = useCalculateMaxCapacity();
  const { toast } = useToast();

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
      }));
      setVehicleStates(defaultVehicleStates);
    }
  }, [isDialogOpen, trailers, vehicles, parkingLocation, locations]);

  const updateTrailerState = (trailerId: string, field: 'locationId' | 'isFull', value: string | boolean) => {
    setInitialStates(prev => prev.map(state =>
      state.trailerId === trailerId ? { ...state, [field]: value } : state
    ));
  };

  const updateVehicleState = (vehicleId: string, locationId: string) => {
    setVehicleStates(prev => prev.map(state =>
      state.vehicleId === vehicleId ? { ...state, locationId } : state
    ));
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
    return getWorkingDaysBetween(start, end);
  }, [watchedStartDate, watchedEndDate]);

  // Group working days by week for display
  const workingDaysByWeek = useMemo(() => groupDaysByWeek(workingDays), [workingDays]);

  // Initialize driver availability when dialog opens or drivers/dates change
  useEffect(() => {
    if (isDialogOpen && drivers && workingDays.length > 0) {
      setDriverAvailability(getDefaultAvailability(drivers, workingDays));
    }
  }, [isDialogOpen, drivers, workingDays]);

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
  };

  // Helper to select all days for a driver
  const selectAllDaysForDriver = (driverId: string) => {
    setDriverAvailability(prev => {
      const newMap = new Map(prev);
      newMap.set(driverId, new Set(workingDays));
      return newMap;
    });
  };

  // Helper to select no days for a driver
  const selectNoDaysForDriver = (driverId: string) => {
    setDriverAvailability(prev => {
      const newMap = new Map(prev);
      newMap.set(driverId, new Set());
      return newMap;
    });
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
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: ScheduleFormData) => {
    try {
      const payload = {
        ...data,
        startDate: new Date(data.startDate).toISOString(),
        endDate: new Date(data.endDate).toISOString(),
        initialStates: initialStates.length > 0 ? initialStates : undefined,
        vehicleStates: vehicleStates.length > 0 ? vehicleStates : undefined,
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
      const result = await calculateMaxMutation.mutateAsync({
        startDate: new Date(formValues.startDate).toISOString(),
        endDate: new Date(formValues.endDate).toISOString(),
        initialStates: initialStates.length > 0 ? initialStates : undefined,
        driverAvailability: driverAvailabilityApi,
      });
      setMaxCapacityResult(result);
      setIsMaxPreviewOpen(true);
    } catch (error) {
      toast({
        title: 'Errore',
        description: 'Impossibile calcolare la capacità massima',
        variant: 'destructive',
      });
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
      description: `${maxCapacityResult.maxLiters.toLocaleString()}L in ${maxCapacityResult.workingDays} giorni`,
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
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Nuova Pianificazione</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)}>
            {/* Main form fields */}
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="name">Nome</Label>
                  <Input id="name" placeholder="es. Settimana 1-7 Febbraio" {...register('name')} />
                  {errors.name && (
                    <p className="text-sm text-destructive">{errors.name.message}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
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

                <div>
                  <Label htmlFor="requiredLiters">Litri Richiesti</Label>
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
                      disabled={calculateMaxMutation.isPending}
                      title="Calcola capacità massima"
                    >
                      {calculateMaxMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Zap className="h-4 w-4" />
                      )}
                      MAX
                    </Button>
                  </div>
                  {errors.requiredLiters && (
                    <p className="text-sm text-destructive">{errors.requiredLiters.message}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="notes">Note (opzionale)</Label>
                  <Input id="notes" {...register('notes')} />
                </div>

                {/* Vehicles Section */}
                {vehicles && vehicles.length > 0 && locations && locations.length > 0 && (
                  <div className="border-t pt-4">
                    <Label className="text-base font-semibold">Motrici</Label>
                    <p className="text-sm text-muted-foreground mb-3">
                      Posizione iniziale di ciascuna motrice.
                    </p>
                    <div className="space-y-2">
                      {vehicles.map((vehicle: Vehicle) => {
                        const state = vehicleStates.find(s => s.vehicleId === vehicle.id);
                        return (
                          <div key={vehicle.id} className="flex items-center gap-3 p-2 bg-muted/50 rounded-md">
                            <div className="w-28">
                              <span className="font-medium text-sm">
                                {vehicle.name || vehicle.plate}
                              </span>
                            </div>
                            <div className="flex-1">
                              <Select
                                value={state?.locationId || ''}
                                onValueChange={(value) => updateVehicleState(vehicle.id, value)}
                              >
                                <SelectTrigger className="h-8 text-xs">
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
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Trailers Section - Right Column */}
              <div>
                {trailers && trailers.length > 0 && locations && locations.length > 0 && (
                  <div>
                    <Label className="text-base font-semibold">Cisterne</Label>
                    <p className="text-sm text-muted-foreground mb-3">
                      Posizione e stato iniziale di ciascuna cisterna.
                    </p>
                    <div className="space-y-2">
                      {trailers.map((trailer: Trailer) => {
                        const state = initialStates.find(s => s.trailerId === trailer.id);
                        return (
                          <div key={trailer.id} className="flex items-center gap-3 p-2 bg-muted/50 rounded-md">
                            <div className="w-24">
                              <span className="font-medium text-sm">
                                {trailer.name || trailer.plate}
                              </span>
                            </div>
                            <div className="flex-1">
                              <Select
                                value={state?.locationId || ''}
                                onValueChange={(value) => updateTrailerState(trailer.id, 'locationId', value)}
                              >
                                <SelectTrigger className="h-8 text-xs">
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
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground w-12">
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
                  </div>
                )}
              </div>
            </div>

            {/* Driver Availability Section - Full Width */}
            {drivers && drivers.length > 0 && workingDays.length > 0 && (
              <div className="border-t pt-4 mt-4">
                <Label className="text-base font-semibold">Disponibilità Autisti</Label>
                <p className="text-sm text-muted-foreground mb-3">
                  Seleziona i giorni in cui ogni autista è disponibile.
                </p>
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {drivers.map((driver: Driver) => {
                    const driverDays = driverAvailability.get(driver.id) || new Set();
                    const allSelected = workingDays.every(d => driverDays.has(d));
                    const noneSelected = driverDays.size === 0;

                    return (
                      <div key={driver.id} className="p-3 bg-muted/50 rounded-md">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{driver.name}</span>
                            <Badge className={`text-xs ${getDriverTypeBadgeColor(driver.type)}`}>
                              {getDriverTypeLabel(driver.type)}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant={allSelected ? 'secondary' : 'outline'}
                              size="sm"
                              className="h-6 text-xs px-2"
                              onClick={() => selectAllDaysForDriver(driver.id)}
                            >
                              Tutti
                            </Button>
                            <Button
                              type="button"
                              variant={noneSelected ? 'secondary' : 'outline'}
                              size="sm"
                              className="h-6 text-xs px-2"
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
                                    inline-flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer
                                    ${driverDays.has(day)
                                      ? 'bg-primary text-primary-foreground'
                                      : 'bg-background border hover:bg-accent'
                                    }
                                  `}
                                >
                                  <Checkbox
                                    checked={driverDays.has(day)}
                                    onCheckedChange={() => toggleDriverDay(driver.id, day)}
                                    className="h-3 w-3"
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
              </div>
            )}

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
                  in {maxCapacityResult.workingDays} giorni lavorativi
                </p>
                <p className="text-sm text-muted-foreground">
                  (~{maxCapacityResult.dailyCapacity.toLocaleString()}L/giorno)
                </p>
              </div>

              <div className="space-y-2">
                <p className="font-medium text-sm">Distribuzione viaggi stimata:</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-muted/50 p-2 rounded">
                    <span className="text-muted-foreground">Shuttle Livigno:</span>
                    <span className="font-medium ml-2">
                      {maxCapacityResult.breakdown.livignoDriverShuttles}
                    </span>
                  </div>
                  <div className="bg-muted/50 p-2 rounded">
                    <span className="text-muted-foreground">Shuttle Tirano:</span>
                    <span className="font-medium ml-2">
                      {maxCapacityResult.breakdown.tiranoDriverShuttles}
                    </span>
                  </div>
                  <div className="bg-muted/50 p-2 rounded">
                    <span className="text-muted-foreground">Supply Milano:</span>
                    <span className="font-medium ml-2">
                      {maxCapacityResult.breakdown.supplyTrips}
                    </span>
                  </div>
                  <div className="bg-muted/50 p-2 rounded">
                    <span className="text-muted-foreground">Full Round:</span>
                    <span className="font-medium ml-2">
                      {maxCapacityResult.breakdown.tiranoDriverFullRounds}
                    </span>
                  </div>
                </div>
              </div>

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
