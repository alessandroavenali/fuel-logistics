import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '@/api/client';

export function useTripsReport(from?: string, to?: string) {
  return useQuery({
    queryKey: ['reports', 'trips', { from, to }],
    queryFn: () => reportsApi.getTrips(from, to),
  });
}

export function useDriversReport(from?: string, to?: string) {
  return useQuery({
    queryKey: ['reports', 'drivers', { from, to }],
    queryFn: () => reportsApi.getDrivers(from, to),
  });
}

export function useCostsReport(from?: string, to?: string) {
  return useQuery({
    queryKey: ['reports', 'costs', { from, to }],
    queryFn: () => reportsApi.getCosts(from, to),
  });
}

export function useLitersReport(from?: string, to?: string) {
  return useQuery({
    queryKey: ['reports', 'liters', { from, to }],
    queryFn: () => reportsApi.getLiters(from, to),
  });
}

export function useEfficiencyReport(from?: string, to?: string) {
  return useQuery({
    queryKey: ['reports', 'efficiency', { from, to }],
    queryFn: () => reportsApi.getEfficiency(from, to),
  });
}
