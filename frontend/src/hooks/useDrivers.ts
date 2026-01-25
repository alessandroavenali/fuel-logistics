import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { driversApi } from '@/api/client';
import type { CreateDriverInput } from '@/types';

export function useDrivers(params?: { isActive?: boolean; type?: string }) {
  return useQuery({
    queryKey: ['drivers', params],
    queryFn: () => driversApi.getAll(params),
  });
}

export function useDriver(id: string) {
  return useQuery({
    queryKey: ['drivers', id],
    queryFn: () => driversApi.getById(id),
    enabled: !!id,
  });
}

export function useCreateDriver() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateDriverInput) => driversApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
    },
  });
}

export function useUpdateDriver() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateDriverInput> }) =>
      driversApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
    },
  });
}

export function useDeleteDriver() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => driversApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
    },
  });
}

export function useDriverWorkLog(id: string, from?: string, to?: string) {
  return useQuery({
    queryKey: ['drivers', id, 'worklog', { from, to }],
    queryFn: () => driversApi.getWorkLog(id, from, to),
    enabled: !!id,
  });
}

export function useExpiringDrivers(days?: number) {
  return useQuery({
    queryKey: ['drivers', 'expiring', days],
    queryFn: () => driversApi.getExpiring(days),
  });
}
