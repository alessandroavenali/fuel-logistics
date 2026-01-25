import { useState } from 'react';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useRoutes,
  useCreateRoute,
  useUpdateRoute,
  useDeleteRoute,
  useCalculateRoute,
} from '@/hooks/useRoutes';
import { useLocations } from '@/hooks/useLocations';
import { useToast } from '@/hooks/useToast';
import { Plus, Pencil, Trash2, ArrowRight, Calculator } from 'lucide-react';
import { formatKm, formatDuration, formatCurrency } from '@/lib/utils';
import type { Route, Location } from '@/types';

const routeSchema = z.object({
  name: z.string().min(1, 'Il nome è obbligatorio'),
  fromLocationId: z.string().min(1, 'Seleziona partenza'),
  toLocationId: z.string().min(1, 'Seleziona arrivo'),
  distanceKm: z.coerce.number().min(0),
  durationMinutes: z.coerce.number().int().min(0),
  tollCost: z.coerce.number().min(0).optional(),
});

type RouteFormData = z.infer<typeof routeSchema>;

export default function RoutesPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);

  const { data: routes, isLoading } = useRoutes();
  const { data: locations } = useLocations();
  const createMutation = useCreateRoute();
  const updateMutation = useUpdateRoute();
  const deleteMutation = useDeleteRoute();
  const calculateMutation = useCalculateRoute();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<RouteFormData>({
    resolver: zodResolver(routeSchema),
    defaultValues: {
      distanceKm: 0,
      durationMinutes: 0,
    },
  });

  const fromLocationId = watch('fromLocationId');
  const toLocationId = watch('toLocationId');

  const openCreateDialog = () => {
    setEditingRoute(null);
    reset({
      name: '',
      fromLocationId: '',
      toLocationId: '',
      distanceKm: 0,
      durationMinutes: 0,
      tollCost: undefined,
    });
    setIsDialogOpen(true);
  };

  const openEditDialog = (route: Route) => {
    setEditingRoute(route);
    reset({
      name: route.name,
      fromLocationId: route.fromLocationId,
      toLocationId: route.toLocationId,
      distanceKm: route.distanceKm,
      durationMinutes: route.durationMinutes,
      tollCost: route.tollCost || undefined,
    });
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: RouteFormData) => {
    try {
      if (editingRoute) {
        await updateMutation.mutateAsync({ id: editingRoute.id, data });
        toast({ title: 'Percorso aggiornato', variant: 'success' });
      } else {
        await createMutation.mutateAsync(data);
        toast({ title: 'Percorso creato', variant: 'success' });
      }
      setIsDialogOpen(false);
    } catch (error) {
      toast({ title: 'Errore', description: 'Operazione fallita', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Sei sicuro di voler eliminare questo percorso?')) return;
    try {
      await deleteMutation.mutateAsync(id);
      toast({ title: 'Percorso eliminato', variant: 'success' });
    } catch (error) {
      toast({ title: 'Errore', description: 'Impossibile eliminare', variant: 'destructive' });
    }
  };

  const handleCalculate = async () => {
    const fromLoc = locations?.find((l: Location) => l.id === fromLocationId);
    const toLoc = locations?.find((l: Location) => l.id === toLocationId);

    if (!fromLoc?.latitude || !fromLoc?.longitude || !toLoc?.latitude || !toLoc?.longitude) {
      toast({
        title: 'Coordinate mancanti',
        description: 'Entrambe le location devono avere coordinate',
        variant: 'destructive',
      });
      return;
    }

    try {
      const result = await calculateMutation.mutateAsync({
        from: { latitude: fromLoc.latitude, longitude: fromLoc.longitude },
        to: { latitude: toLoc.latitude, longitude: toLoc.longitude },
      });

      setValue('distanceKm', result.distanceKm);
      setValue('durationMinutes', result.durationMinutes);
      setValue('name', `${fromLoc.name} -> ${toLoc.name}`);

      toast({ title: 'Percorso calcolato', variant: 'success' });
    } catch (error) {
      toast({ title: 'Errore nel calcolo', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Percorsi</h1>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Nuovo Percorso
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Elenco Percorsi</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p>Caricamento...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Da</TableHead>
                  <TableHead>A</TableHead>
                  <TableHead>Distanza</TableHead>
                  <TableHead>Durata</TableHead>
                  <TableHead>Pedaggi</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {routes?.map((route: Route) => (
                  <TableRow key={route.id}>
                    <TableCell className="font-medium">{route.name}</TableCell>
                    <TableCell>{route.fromLocation?.name || '-'}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        {route.toLocation?.name || '-'}
                      </div>
                    </TableCell>
                    <TableCell>{formatKm(route.distanceKm)}</TableCell>
                    <TableCell>{formatDuration(route.durationMinutes)}</TableCell>
                    <TableCell>
                      {route.tollCost ? formatCurrency(route.tollCost) : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={route.isActive ? 'success' : 'secondary'}>
                        {route.isActive ? 'Attivo' : 'Inattivo'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(route)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(route.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
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
            <DialogTitle>
              {editingRoute ? 'Modifica Percorso' : 'Nuovo Percorso'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Nome</Label>
                <Input id="name" {...register('name')} />
                {errors.name && (
                  <p className="text-sm text-destructive">{errors.name.message}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="fromLocationId">Partenza</Label>
                  <Select
                    value={fromLocationId}
                    onValueChange={(value) => setValue('fromLocationId', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleziona..." />
                    </SelectTrigger>
                    <SelectContent>
                      {locations?.map((location: Location) => (
                        <SelectItem key={location.id} value={location.id}>
                          {location.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.fromLocationId && (
                    <p className="text-sm text-destructive">{errors.fromLocationId.message}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="toLocationId">Arrivo</Label>
                  <Select
                    value={toLocationId}
                    onValueChange={(value) => setValue('toLocationId', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleziona..." />
                    </SelectTrigger>
                    <SelectContent>
                      {locations?.map((location: Location) => (
                        <SelectItem key={location.id} value={location.id}>
                          {location.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.toLocationId && (
                    <p className="text-sm text-destructive">{errors.toLocationId.message}</p>
                  )}
                </div>
              </div>

              {fromLocationId && toLocationId && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCalculate}
                  disabled={calculateMutation.isPending}
                >
                  <Calculator className="mr-2 h-4 w-4" />
                  Calcola Distanza e Tempo
                </Button>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="distanceKm">Distanza (km)</Label>
                  <Input
                    id="distanceKm"
                    type="number"
                    step="0.1"
                    {...register('distanceKm')}
                  />
                </div>
                <div>
                  <Label htmlFor="durationMinutes">Durata (minuti)</Label>
                  <Input
                    id="durationMinutes"
                    type="number"
                    {...register('durationMinutes')}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="tollCost">Costo Pedaggi (EUR)</Label>
                <Input
                  id="tollCost"
                  type="number"
                  step="0.01"
                  {...register('tollCost')}
                />
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Annulla
              </Button>
              <Button type="submit">
                {editingRoute ? 'Salva' : 'Crea'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
