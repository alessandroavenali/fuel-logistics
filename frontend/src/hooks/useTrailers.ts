import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trailersApi } from '@/api/client';
import type { CreateTrailerInput } from '@/types';

export function useTrailers(isActive?: boolean) {
  return useQuery({
    queryKey: ['trailers', { isActive }],
    queryFn: () => trailersApi.getAll(isActive),
  });
}

export function useTrailer(id: string) {
  return useQuery({
    queryKey: ['trailers', id],
    queryFn: () => trailersApi.getById(id),
    enabled: !!id,
  });
}

export function useCreateTrailer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateTrailerInput) => trailersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trailers'] });
    },
  });
}

export function useUpdateTrailer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateTrailerInput> }) =>
      trailersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trailers'] });
    },
  });
}

export function useDeleteTrailer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => trailersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trailers'] });
    },
  });
}

export function useTrailersAtLocation(locationId: string) {
  return useQuery({
    queryKey: ['trailers', 'location', locationId],
    queryFn: () => trailersApi.getAtLocation(locationId),
    enabled: !!locationId,
  });
}

export function useTrailersStatus(scheduleId?: string) {
  return useQuery({
    queryKey: ['trailers', 'status', scheduleId],
    queryFn: () => trailersApi.getStatus(scheduleId),
  });
}
