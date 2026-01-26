import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
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
import type { MaxCapacityResult } from '@/api/client';
import { useTrailers } from '@/hooks/useTrailers';
import { useLocations } from '@/hooks/useLocations';
import { useToast } from '@/hooks/useToast';
import { Plus, Eye, Trash2, Zap, Loader2 } from 'lucide-react';
import { formatDate, formatLiters, getStatusLabel, getStatusColor } from '@/lib/utils';
import type { Schedule, Trailer, Location } from '@/types';

interface TrailerInitialState {
  trailerId: string;
  locationId: string;
  isFull: boolean;
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
  const [isMaxPreviewOpen, setIsMaxPreviewOpen] = useState(false);
  const [maxCapacityResult, setMaxCapacityResult] = useState<MaxCapacityResult | null>(null);

  const { data: schedules, isLoading } = useSchedules();
  const { data: trailers } = useTrailers(true); // Only active trailers
  const { data: locations } = useLocations({ isActive: true });
  const createMutation = useCreateSchedule();
  const deleteMutation = useDeleteSchedule();
  const calculateMaxMutation = useCalculateMaxCapacity();
  const { toast } = useToast();

  // Get destination location (Livigno) as default
  const destinationLocation = locations?.find((l: Location) => l.type === 'DESTINATION');

  // Initialize initial states when dialog opens and data is available
  useEffect(() => {
    if (isDialogOpen && trailers && destinationLocation) {
      const defaultStates: TrailerInitialState[] = trailers.map((trailer: Trailer) => ({
        trailerId: trailer.id,
        locationId: destinationLocation.id,
        isFull: false, // Default: empty
      }));
      setInitialStates(defaultStates);
    }
  }, [isDialogOpen, trailers, destinationLocation]);

  const updateTrailerState = (trailerId: string, field: 'locationId' | 'isFull', value: string | boolean) => {
    setInitialStates(prev => prev.map(state =>
      state.trailerId === trailerId ? { ...state, [field]: value } : state
    ));
  };

  const {
    register,
    handleSubmit,
    reset,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<ScheduleFormData>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      requiredLiters: 0,
    },
  });

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

    try {
      const result = await calculateMaxMutation.mutateAsync({
        startDate: new Date(formValues.startDate).toISOString(),
        endDate: new Date(formValues.endDate).toISOString(),
        initialStates: initialStates.length > 0 ? initialStates : undefined,
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuova Pianificazione</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)}>
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

              {/* Initial States Section */}
              {trailers && trailers.length > 0 && locations && locations.length > 0 && (
                <div className="border-t pt-4 mt-4">
                  <Label className="text-base font-semibold">Condizioni Iniziali Cisterne</Label>
                  <p className="text-sm text-muted-foreground mb-3">
                    Specifica la posizione e lo stato di ciascuna cisterna all'inizio della pianificazione.
                  </p>
                  <div className="space-y-3 max-h-60 overflow-y-auto">
                    {trailers.map((trailer: Trailer) => {
                      const state = initialStates.find(s => s.trailerId === trailer.id);
                      return (
                        <div key={trailer.id} className="flex items-center gap-3 p-2 bg-muted/50 rounded-md">
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-sm truncate">
                              {trailer.name || trailer.plate}
                            </span>
                          </div>
                          <div className="w-40">
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
                            <Label htmlFor={`full-${trailer.id}`} className="text-xs whitespace-nowrap">
                              {state?.isFull ? 'Piena' : 'Vuota'}
                            </Label>
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
