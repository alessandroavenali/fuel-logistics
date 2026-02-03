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
import { useDrivers, useCreateDriver, useUpdateDriver, useDeleteDriver } from '@/hooks/useDrivers';
import { useLocations } from '@/hooks/useLocations';
import { useToast } from '@/hooks/useToast';
import { Plus, Pencil, Trash2, AlertTriangle, MapPin } from 'lucide-react';
import { formatDate, formatCurrency, getDriverTypeLabel, isLicenseExpiringSoon, isLicenseExpired } from '@/lib/utils';
import type { Driver, DriverType, Location } from '@/types';

const driverSchema = z.object({
  name: z.string().min(1, 'Il nome è obbligatorio'),
  type: z.enum(['RESIDENT', 'ON_CALL', 'EMERGENCY']),
  phone: z.string().optional(),
  adrLicenseExpiry: z.string().optional(),
  adrCisternExpiry: z.string().optional(),
  weeklyWorkingDays: z.coerce.number().int().min(1).max(7),
  hourlyCost: z.coerce.number().min(0).optional(),
  baseLocationId: z.string().optional(),
});

type DriverFormData = z.infer<typeof driverSchema>;

export default function Drivers() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);

  const { data: drivers, isLoading } = useDrivers();
  const { data: locations } = useLocations({ isActive: true });
  const createMutation = useCreateDriver();
  const updateMutation = useUpdateDriver();
  const deleteMutation = useDeleteDriver();
  const { toast } = useToast();

  // Filter locations for base selection (PARKING = Tirano, DESTINATION = Livigno)
  const baseLocations = locations?.filter(
    (l: Location) => l.type === 'PARKING' || l.type === 'DESTINATION'
  ) || [];

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<DriverFormData>({
    resolver: zodResolver(driverSchema),
    defaultValues: {
      type: 'RESIDENT',
      weeklyWorkingDays: 5,
    },
  });

  const driverType = watch('type');

  const openCreateDialog = () => {
    setEditingDriver(null);
    // Default base location to Tirano (PARKING)
    const tiranoLocation = baseLocations.find((l: Location) => l.type === 'PARKING');
    reset({
      name: '',
      type: 'RESIDENT',
      phone: '',
      adrLicenseExpiry: '',
      adrCisternExpiry: '',
      weeklyWorkingDays: 5,
      hourlyCost: undefined,
      baseLocationId: tiranoLocation?.id || '',
    });
    setIsDialogOpen(true);
  };

  const openEditDialog = (driver: Driver) => {
    setEditingDriver(driver);
    reset({
      name: driver.name,
      type: driver.type,
      phone: driver.phone || '',
      adrLicenseExpiry: driver.adrLicenseExpiry
        ? new Date(driver.adrLicenseExpiry).toISOString().split('T')[0]
        : '',
      adrCisternExpiry: driver.adrCisternExpiry
        ? new Date(driver.adrCisternExpiry).toISOString().split('T')[0]
        : '',
      weeklyWorkingDays: driver.weeklyWorkingDays,
      hourlyCost: driver.hourlyCost || undefined,
      baseLocationId: driver.baseLocationId || '',
    });
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: DriverFormData) => {
    try {
      const payload = {
        ...data,
        adrLicenseExpiry: data.adrLicenseExpiry
          ? new Date(data.adrLicenseExpiry).toISOString()
          : undefined,
        adrCisternExpiry: data.adrCisternExpiry
          ? new Date(data.adrCisternExpiry).toISOString()
          : undefined,
        hourlyCost: data.type === 'ON_CALL' ? data.hourlyCost : undefined,
        baseLocationId: data.baseLocationId || null,
      };

      if (editingDriver) {
        await updateMutation.mutateAsync({ id: editingDriver.id, data: payload });
        toast({ title: 'Autista aggiornato', variant: 'success' });
      } else {
        await createMutation.mutateAsync(payload);
        toast({ title: 'Autista creato', variant: 'success' });
      }
      setIsDialogOpen(false);
    } catch (error) {
      toast({ title: 'Errore', description: 'Operazione fallita', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Sei sicuro di voler eliminare questo autista?')) return;
    try {
      await deleteMutation.mutateAsync(id);
      toast({ title: 'Autista eliminato', variant: 'success' });
    } catch (error) {
      toast({ title: 'Errore', description: 'Impossibile eliminare', variant: 'destructive' });
    }
  };

  const getLicenseStatus = (expiry: string | undefined) => {
    if (!expiry) return null;
    if (isLicenseExpired(expiry)) {
      return <Badge variant="destructive">Scaduta</Badge>;
    }
    if (isLicenseExpiringSoon(expiry)) {
      return <Badge variant="warning">In scadenza</Badge>;
    }
    return <Badge variant="success">Valida</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Autisti</h1>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Nuovo Autista
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Elenco Autisti</CardTitle>
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
                  <TableHead>Base</TableHead>
                  <TableHead>Telefono</TableHead>
                  <TableHead>ADR</TableHead>
                  <TableHead>ADR Cisterne</TableHead>
                  <TableHead>Costo/h</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drivers?.map((driver: Driver) => (
                  <TableRow key={driver.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {driver.name}
                        {(isLicenseExpiringSoon(driver.adrLicenseExpiry) ||
                          isLicenseExpiringSoon(driver.adrCisternExpiry)) && (
                          <AlertTriangle className="h-4 w-4 text-yellow-500" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{getDriverTypeLabel(driver.type)}</Badge>
                    </TableCell>
                    <TableCell>
                      {driver.baseLocation ? (
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm">{driver.baseLocation.name.split(' ')[0]}</span>
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell>{driver.phone || '-'}</TableCell>
                    <TableCell>
                      {driver.adrLicenseExpiry ? (
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{formatDate(driver.adrLicenseExpiry)}</span>
                          {getLicenseStatus(driver.adrLicenseExpiry)}
                        </div>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      {driver.adrCisternExpiry ? (
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{formatDate(driver.adrCisternExpiry)}</span>
                          {getLicenseStatus(driver.adrCisternExpiry)}
                        </div>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      {driver.hourlyCost ? formatCurrency(driver.hourlyCost) : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={driver.isActive ? 'success' : 'secondary'}>
                        {driver.isActive ? 'Attivo' : 'Inattivo'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(driver)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(driver.id)}
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingDriver ? 'Modifica Autista' : 'Nuovo Autista'}
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
                  value={driverType}
                  onValueChange={(value) => setValue('type', value as DriverType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RESIDENT">Dipendente</SelectItem>
                    <SelectItem value="ON_CALL">A chiamata</SelectItem>
                    <SelectItem value="EMERGENCY">Emergenza</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="phone">Telefono</Label>
                <Input id="phone" {...register('phone')} />
              </div>

              <div>
                <Label htmlFor="baseLocationId">Base Operativa</Label>
                <Select
                  value={watch('baseLocationId') || ''}
                  onValueChange={(value) => setValue('baseLocationId', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleziona base..." />
                  </SelectTrigger>
                  <SelectContent>
                    {baseLocations.map((location: Location) => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="adrLicenseExpiry">Scadenza ADR</Label>
                  <Input id="adrLicenseExpiry" type="date" {...register('adrLicenseExpiry')} />
                </div>
                <div>
                  <Label htmlFor="adrCisternExpiry">Scadenza ADR Cisterne</Label>
                  <Input id="adrCisternExpiry" type="date" {...register('adrCisternExpiry')} />
                </div>
              </div>

              <div>
                <Label htmlFor="weeklyWorkingDays">Giorni lavorativi/settimana</Label>
                <Input
                  id="weeklyWorkingDays"
                  type="number"
                  min={1}
                  max={7}
                  {...register('weeklyWorkingDays')}
                />
              </div>

              {driverType === 'ON_CALL' && (
                <div>
                  <Label htmlFor="hourlyCost">Costo orario (EUR)</Label>
                  <Input
                    id="hourlyCost"
                    type="number"
                    step="0.01"
                    min={0}
                    {...register('hourlyCost')}
                  />
                </div>
              )}
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Annulla
              </Button>
              <Button type="submit">
                {editingDriver ? 'Salva' : 'Crea'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
