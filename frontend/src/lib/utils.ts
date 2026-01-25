import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(date: string | Date): string {
  return new Date(date).toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatNumber(num: number): string {
  return num.toLocaleString('it-IT');
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount);
}

export function formatLiters(liters: number): string {
  return `${formatNumber(liters)} L`;
}

export function formatKm(km: number): string {
  return `${formatNumber(Math.round(km))} km`;
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}min`;
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'bg-gray-100 text-gray-800';
    case 'CONFIRMED':
      return 'bg-blue-100 text-blue-800';
    case 'COMPLETED':
      return 'bg-green-100 text-green-800';
    case 'CANCELLED':
      return 'bg-red-100 text-red-800';
    case 'PLANNED':
      return 'bg-yellow-100 text-yellow-800';
    case 'IN_PROGRESS':
      return 'bg-purple-100 text-purple-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

export function getDriverTypeLabel(type: string): string {
  switch (type) {
    case 'RESIDENT':
      return 'Dipendente';
    case 'ON_CALL':
      return 'A chiamata';
    case 'EMERGENCY':
      return 'Emergenza';
    default:
      return type;
  }
}

export function getLocationTypeLabel(type: string): string {
  switch (type) {
    case 'SOURCE':
      return 'Sorgente';
    case 'DESTINATION':
      return 'Destinazione';
    case 'PARKING':
      return 'Parcheggio';
    default:
      return type;
  }
}

export function getStatusLabel(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'Bozza';
    case 'CONFIRMED':
      return 'Confermato';
    case 'COMPLETED':
      return 'Completato';
    case 'CANCELLED':
      return 'Cancellato';
    case 'PLANNED':
      return 'Pianificato';
    case 'IN_PROGRESS':
      return 'In Corso';
    default:
      return status;
  }
}

export function isLicenseExpiringSoon(expiryDate: string | undefined, daysThreshold = 30): boolean {
  if (!expiryDate) return false;
  const expiry = new Date(expiryDate);
  const threshold = new Date();
  threshold.setDate(threshold.getDate() + daysThreshold);
  return expiry <= threshold;
}

export function isLicenseExpired(expiryDate: string | undefined): boolean {
  if (!expiryDate) return false;
  return new Date(expiryDate) < new Date();
}
