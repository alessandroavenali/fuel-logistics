import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { schedulesApi } from '@/api/client';
import type { CreateScheduleInput, CreateTripInput } from '@/types';

export function useSchedules(status?: string) {
  return useQuery({
    queryKey: ['schedules', { status }],
    queryFn: () => schedulesApi.getAll(status),
  });
}

export function useSchedule(id: string) {
  return useQuery({
    queryKey: ['schedules', id],
    queryFn: () => schedulesApi.getById(id),
    enabled: !!id,
  });
}

export function useCreateSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateScheduleInput) => schedulesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
  });
}

export function useUpdateSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateScheduleInput> }) =>
      schedulesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
  });
}

export function useDeleteSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => schedulesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
  });
}

export function useOptimizeSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => schedulesApi.optimize(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['schedules', id] });
    },
  });
}

export function useConfirmSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => schedulesApi.confirm(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['schedules', id] });
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
  });
}

export function useValidateSchedule() {
  return useMutation({
    mutationFn: (id: string) => schedulesApi.validate(id),
  });
}

export function useScheduleTrips(scheduleId: string) {
  return useQuery({
    queryKey: ['schedules', scheduleId, 'trips'],
    queryFn: () => schedulesApi.getTrips(scheduleId),
    enabled: !!scheduleId,
  });
}

export function useCreateTrip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ scheduleId, data }: { scheduleId: string; data: Omit<CreateTripInput, 'scheduleId'> }) =>
      schedulesApi.createTrip(scheduleId, data),
    onSuccess: (_, { scheduleId }) => {
      queryClient.invalidateQueries({ queryKey: ['schedules', scheduleId] });
    },
  });
}

export function useUpdateTrip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      scheduleId,
      tripId,
      data,
    }: {
      scheduleId: string;
      tripId: string;
      data: Partial<CreateTripInput>;
    }) => schedulesApi.updateTrip(scheduleId, tripId, data),
    onSuccess: (_, { scheduleId }) => {
      queryClient.invalidateQueries({ queryKey: ['schedules', scheduleId] });
    },
  });
}

export function useDeleteTrip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ scheduleId, tripId }: { scheduleId: string; tripId: string }) =>
      schedulesApi.deleteTrip(scheduleId, tripId),
    onSuccess: (_, { scheduleId }) => {
      queryClient.invalidateQueries({ queryKey: ['schedules', scheduleId] });
    },
  });
}
