import { useState } from 'react';
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
  useSchedules,
  useCreateSchedule,
  useDeleteSchedule,
} from '@/hooks/useSchedules';
import { useToast } from '@/hooks/useToast';
import { Plus, Eye, Trash2 } from 'lucide-react';
import { formatDate, formatLiters, getStatusLabel, getStatusColor } from '@/lib/utils';
import type { Schedule } from '@/types';

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

  const { data: schedules, isLoading } = useSchedules();
  const createMutation = useCreateSchedule();
  const deleteMutation = useDeleteSchedule();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    reset,
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
                <Input
                  id="requiredLiters"
                  type="number"
                  min={0}
                  placeholder="es. 70000"
                  {...register('requiredLiters')}
                />
                {errors.requiredLiters && (
                  <p className="text-sm text-destructive">{errors.requiredLiters.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="notes">Note (opzionale)</Label>
                <Input id="notes" {...register('notes')} />
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
    </div>
  );
}
