import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { routesApi } from '@/api/client';
import type { CreateRouteInput } from '@/types';

export function useRoutes(isActive?: boolean) {
  return useQuery({
    queryKey: ['routes', { isActive }],
    queryFn: () => routesApi.getAll(isActive),
  });
}

export function useRoute(id: string) {
  return useQuery({
    queryKey: ['routes', id],
    queryFn: () => routesApi.getById(id),
    enabled: !!id,
  });
}

export function useCreateRoute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateRouteInput) => routesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] });
    },
  });
}

export function useUpdateRoute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateRouteInput> }) =>
      routesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] });
    },
  });
}

export function useDeleteRoute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => routesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] });
    },
  });
}

export function useCalculateRoute() {
  return useMutation({
    mutationFn: ({
      from,
      to,
    }: {
      from: { latitude: number; longitude: number };
      to: { latitude: number; longitude: number };
    }) => routesApi.calculate(from, to),
  });
}
