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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useVehicles, useCreateVehicle, useUpdateVehicle, useDeleteVehicle } from '@/hooks/useVehicles';
import { useToast } from '@/hooks/useToast';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import type { Vehicle } from '@/types';

const vehicleSchema = z.object({
  plate: z.string().min(1, 'La targa è obbligatoria'),
  name: z.string().optional(),
  maxTrailers: z.coerce.number().int().min(1).max(3),
});

type VehicleFormData = z.infer<typeof vehicleSchema>;

export default function Vehicles() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);

  const { data: vehicles, isLoading } = useVehicles();
  const createMutation = useCreateVehicle();
  const updateMutation = useUpdateVehicle();
  const deleteMutation = useDeleteVehicle();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<VehicleFormData>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: {
      maxTrailers: 2,
    },
  });

  const openCreateDialog = () => {
    setEditingVehicle(null);
    reset({ plate: '', name: '', maxTrailers: 2 });
    setIsDialogOpen(true);
  };

  const openEditDialog = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle);
    reset({
      plate: vehicle.plate,
      name: vehicle.name || '',
      maxTrailers: vehicle.maxTrailers,
    });
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: VehicleFormData) => {
    try {
      if (editingVehicle) {
        await updateMutation.mutateAsync({ id: editingVehicle.id, data });
        toast({ title: 'Motrice aggiornata', variant: 'success' });
      } else {
        await createMutation.mutateAsync(data);
        toast({ title: 'Motrice creata', variant: 'success' });
      }
      setIsDialogOpen(false);
    } catch (error) {
      toast({ title: 'Errore', description: 'Operazione fallita', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Sei sicuro di voler eliminare questa motrice?')) return;
    try {
      await deleteMutation.mutateAsync(id);
      toast({ title: 'Motrice eliminata', variant: 'success' });
    } catch (error) {
      toast({ title: 'Errore', description: 'Impossibile eliminare', variant: 'destructive' });
    }
  };

  const toggleActive = async (vehicle: Vehicle) => {
    try {
      await updateMutation.mutateAsync({
        id: vehicle.id,
        data: { isActive: !vehicle.isActive },
      });
      toast({
        title: vehicle.isActive ? 'Motrice disattivata' : 'Motrice attivata',
        variant: 'success',
      });
    } catch (error) {
      toast({ title: 'Errore', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Motrici</h1>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Nuova Motrice
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Elenco Motrici</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p>Caricamento...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Targa</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Max Cisterne</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles?.map((vehicle: Vehicle) => (
                  <TableRow key={vehicle.id}>
                    <TableCell className="font-medium">{vehicle.plate}</TableCell>
                    <TableCell>{vehicle.name || '-'}</TableCell>
                    <TableCell>{vehicle.maxTrailers}</TableCell>
                    <TableCell>
                      <Badge
                        variant={vehicle.isActive ? 'success' : 'secondary'}
                        className="cursor-pointer"
                        onClick={() => toggleActive(vehicle)}
                      >
                        {vehicle.isActive ? 'Attiva' : 'Inattiva'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(vehicle)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(vehicle.id)}
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
              {editingVehicle ? 'Modifica Motrice' : 'Nuova Motrice'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-4">
              <div>
                <Label htmlFor="plate">Targa</Label>
                <Input id="plate" {...register('plate')} />
                {errors.plate && (
                  <p className="text-sm text-destructive">{errors.plate.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="name">Nome (opzionale)</Label>
                <Input id="name" {...register('name')} />
              </div>
              <div>
                <Label htmlFor="maxTrailers">Max Cisterne</Label>
                <Input
                  id="maxTrailers"
                  type="number"
                  min={1}
                  max={3}
                  {...register('maxTrailers')}
                />
                {errors.maxTrailers && (
                  <p className="text-sm text-destructive">{errors.maxTrailers.message}</p>
                )}
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Annulla
              </Button>
              <Button type="submit">
                {editingVehicle ? 'Salva' : 'Crea'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
