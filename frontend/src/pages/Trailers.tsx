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
import { useTrailers, useCreateTrailer, useUpdateTrailer, useDeleteTrailer } from '@/hooks/useTrailers';
import { useToast } from '@/hooks/useToast';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { formatLiters } from '@/lib/utils';
import type { Trailer } from '@/types';

const trailerSchema = z.object({
  plate: z.string().min(1, 'La targa è obbligatoria'),
  name: z.string().optional(),
  capacityLiters: z.coerce.number().int().min(1000),
});

type TrailerFormData = z.infer<typeof trailerSchema>;

export default function Trailers() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTrailer, setEditingTrailer] = useState<Trailer | null>(null);

  const { data: trailers, isLoading } = useTrailers();
  const createMutation = useCreateTrailer();
  const updateMutation = useUpdateTrailer();
  const deleteMutation = useDeleteTrailer();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TrailerFormData>({
    resolver: zodResolver(trailerSchema),
    defaultValues: {
      capacityLiters: 17500,
    },
  });

  const openCreateDialog = () => {
    setEditingTrailer(null);
    reset({ plate: '', name: '', capacityLiters: 17500 });
    setIsDialogOpen(true);
  };

  const openEditDialog = (trailer: Trailer) => {
    setEditingTrailer(trailer);
    reset({
      plate: trailer.plate,
      name: trailer.name || '',
      capacityLiters: trailer.capacityLiters,
    });
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: TrailerFormData) => {
    try {
      if (editingTrailer) {
        await updateMutation.mutateAsync({ id: editingTrailer.id, data });
        toast({ title: 'Cisterna aggiornata', variant: 'success' });
      } else {
        await createMutation.mutateAsync(data);
        toast({ title: 'Cisterna creata', variant: 'success' });
      }
      setIsDialogOpen(false);
    } catch (error) {
      toast({ title: 'Errore', description: 'Operazione fallita', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Sei sicuro di voler eliminare questa cisterna?')) return;
    try {
      await deleteMutation.mutateAsync(id);
      toast({ title: 'Cisterna eliminata', variant: 'success' });
    } catch (error) {
      toast({ title: 'Errore', description: 'Impossibile eliminare', variant: 'destructive' });
    }
  };

  const toggleActive = async (trailer: Trailer) => {
    try {
      await updateMutation.mutateAsync({
        id: trailer.id,
        data: { isActive: !trailer.isActive },
      });
      toast({
        title: trailer.isActive ? 'Cisterna disattivata' : 'Cisterna attivata',
        variant: 'success',
      });
    } catch (error) {
      toast({ title: 'Errore', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Cisterne</h1>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Nuova Cisterna
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Elenco Cisterne</CardTitle>
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
                  <TableHead>Capacità</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trailers?.map((trailer: Trailer) => (
                  <TableRow key={trailer.id}>
                    <TableCell className="font-medium">{trailer.plate}</TableCell>
                    <TableCell>{trailer.name || '-'}</TableCell>
                    <TableCell>{formatLiters(trailer.capacityLiters)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={trailer.isActive ? 'success' : 'secondary'}
                        className="cursor-pointer"
                        onClick={() => toggleActive(trailer)}
                      >
                        {trailer.isActive ? 'Attiva' : 'Inattiva'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(trailer)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(trailer.id)}
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
              {editingTrailer ? 'Modifica Cisterna' : 'Nuova Cisterna'}
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
                <Label htmlFor="capacityLiters">Capacità (litri)</Label>
                <Input
                  id="capacityLiters"
                  type="number"
                  min={1000}
                  {...register('capacityLiters')}
                />
                {errors.capacityLiters && (
                  <p className="text-sm text-destructive">{errors.capacityLiters.message}</p>
                )}
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Annulla
              </Button>
              <Button type="submit">
                {editingTrailer ? 'Salva' : 'Crea'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
