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
  useLocations,
  useCreateLocation,
  useUpdateLocation,
  useDeleteLocation,
} from '@/hooks/useLocations';
import { useToast } from '@/hooks/useToast';
import { Plus, Pencil, Trash2, MapPin } from 'lucide-react';
import { getLocationTypeLabel } from '@/lib/utils';
import type { Location, LocationType } from '@/types';

const locationSchema = z.object({
  name: z.string().min(1, 'Il nome è obbligatorio'),
  type: z.enum(['SOURCE', 'DESTINATION', 'PARKING']),
  address: z.string().min(1, "L'indirizzo è obbligatorio"),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
});

type LocationFormData = z.infer<typeof locationSchema>;

export default function Locations() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);

  const { data: locations, isLoading } = useLocations();
  const createMutation = useCreateLocation();
  const updateMutation = useUpdateLocation();
  const deleteMutation = useDeleteLocation();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<LocationFormData>({
    resolver: zodResolver(locationSchema),
    defaultValues: {
      type: 'DESTINATION',
    },
  });

  const locationType = watch('type');

  const openCreateDialog = () => {
    setEditingLocation(null);
    reset({
      name: '',
      type: 'DESTINATION',
      address: '',
      latitude: undefined,
      longitude: undefined,
    });
    setIsDialogOpen(true);
  };

  const openEditDialog = (location: Location) => {
    setEditingLocation(location);
    reset({
      name: location.name,
      type: location.type,
      address: location.address,
      latitude: location.latitude || undefined,
      longitude: location.longitude || undefined,
    });
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: LocationFormData) => {
    try {
      if (editingLocation) {
        await updateMutation.mutateAsync({ id: editingLocation.id, data });
        toast({ title: 'Luogo aggiornato', variant: 'success' });
      } else {
        await createMutation.mutateAsync(data);
        toast({ title: 'Luogo creato', variant: 'success' });
      }
      setIsDialogOpen(false);
    } catch (error) {
      toast({ title: 'Errore', description: 'Operazione fallita', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Sei sicuro di voler eliminare questo luogo?')) return;
    try {
      await deleteMutation.mutateAsync(id);
      toast({ title: 'Luogo eliminato', variant: 'success' });
    } catch (error) {
      toast({ title: 'Errore', description: 'Impossibile eliminare', variant: 'destructive' });
    }
  };

  const getTypeColor = (type: LocationType) => {
    switch (type) {
      case 'SOURCE':
        return 'bg-blue-100 text-blue-800';
      case 'DESTINATION':
        return 'bg-green-100 text-green-800';
      case 'PARKING':
        return 'bg-orange-100 text-orange-800';
      default:
        return '';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Luoghi</h1>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Nuovo Luogo
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Elenco Luoghi</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p>Caricamento...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Indirizzo</TableHead>
                  <TableHead>Coordinate</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {locations?.map((location: Location) => (
                  <TableRow key={location.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        {location.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={getTypeColor(location.type)}>
                        {getLocationTypeLabel(location.type)}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{location.address}</TableCell>
                    <TableCell>
                      {location.latitude && location.longitude
                        ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`
                        : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={location.isActive ? 'success' : 'secondary'}>
                        {location.isActive ? 'Attivo' : 'Inattivo'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(location)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(location.id)}
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
              {editingLocation ? 'Modifica Luogo' : 'Nuovo Luogo'}
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

              <div>
                <Label htmlFor="type">Tipo</Label>
                <Select
                  value={locationType}
                  onValueChange={(value) => setValue('type', value as LocationType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SOURCE">Sorgente (fornitore)</SelectItem>
                    <SelectItem value="DESTINATION">Destinazione</SelectItem>
                    <SelectItem value="PARKING">Parcheggio</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="address">Indirizzo</Label>
                <Input id="address" {...register('address')} />
                {errors.address && (
                  <p className="text-sm text-destructive">{errors.address.message}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="latitude">Latitudine</Label>
                  <Input
                    id="latitude"
                    type="number"
                    step="0.0001"
                    {...register('latitude')}
                  />
                </div>
                <div>
                  <Label htmlFor="longitude">Longitudine</Label>
                  <Input
                    id="longitude"
                    type="number"
                    step="0.0001"
                    {...register('longitude')}
                  />
                </div>
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Annulla
              </Button>
              <Button type="submit">
                {editingLocation ? 'Salva' : 'Crea'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
