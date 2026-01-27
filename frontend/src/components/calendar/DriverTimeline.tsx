import { useMemo, useState } from 'react';
import { format, addDays, subDays, isSameDay, startOfDay, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Truck, Container, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Trip, TripStatus, TripType, DriverType } from '@/types';

interface TimelineDriver {
  id: string;
  name: string;
  type: DriverType;
}

interface DriverTimelineProps {
  trips: Trip[];
  drivers: TimelineDriver[];
  startDate: Date;
  endDate: Date;
  onSelectTrip: (trip: Trip) => void;
  selectedTripId?: string;
  isDraft?: boolean;
  onSlotClick?: (driverId: string, date: Date, hour: number) => void;
}

// Timeline config
const START_HOUR = 5;
const END_HOUR = 22;
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
const HOUR_WIDTH = 80; // pixels per hour

const statusColors: Record<TripStatus, { bg: string; border: string; text: string }> = {
  PLANNED: { bg: 'bg-blue-500', border: 'border-blue-600', text: 'text-white' },
  IN_PROGRESS: { bg: 'bg-purple-500', border: 'border-purple-600', text: 'text-white' },
  COMPLETED: { bg: 'bg-green-500', border: 'border-green-600', text: 'text-white' },
  CANCELLED: { bg: 'bg-red-400', border: 'border-red-500', text: 'text-white line-through opacity-60' },
};

// Colori per tipo di viaggio
const tripTypeColors: Record<TripType, { bg: string; border: string; text: string; label: string }> = {
  SHUTTLE_LIVIGNO: { bg: 'bg-green-500', border: 'border-green-600', text: 'text-white', label: 'Shuttle' },
  SUPPLY_MILANO: { bg: 'bg-blue-500', border: 'border-blue-600', text: 'text-white', label: 'Supply' },
  FULL_ROUND: { bg: 'bg-purple-500', border: 'border-purple-600', text: 'text-white', label: 'Completo' },
  TRANSFER_TIRANO: { bg: 'bg-orange-500', border: 'border-orange-600', text: 'text-white', label: 'Transfer' },
};

function getTimePosition(date: Date): number {
  const hours = date.getHours() + date.getMinutes() / 60;
  return Math.max(0, (hours - START_HOUR) * HOUR_WIDTH);
}

function getTimeWidth(start: Date, end: Date): number {
  const startHours = start.getHours() + start.getMinutes() / 60;
  const endHours = end.getHours() + end.getMinutes() / 60;
  const duration = endHours - startHours;
  return Math.max(HOUR_WIDTH / 2, duration * HOUR_WIDTH);
}

function formatLiters(liters: number): string {
  return liters >= 1000 ? `${(liters / 1000).toFixed(0)}k L` : `${liters} L`;
}

export function DriverTimeline({
  trips,
  drivers,
  startDate,
  endDate,
  onSelectTrip,
  selectedTripId,
  isDraft = false,
  onSlotClick,
}: DriverTimelineProps) {
  const [currentDate, setCurrentDate] = useState<Date>(() => startOfDay(new Date(startDate)));

  // Get all dates in the schedule range
  const scheduleDates = useMemo(() => {
    const dates: Date[] = [];
    let current = startOfDay(new Date(startDate));
    const end = startOfDay(new Date(endDate));
    while (current <= end) {
      dates.push(current);
      current = addDays(current, 1);
    }
    return dates;
  }, [startDate, endDate]);

  // Filter trips for current day
  const dayTrips = useMemo(() => {
    return trips.filter(trip => {
      const tripDate = startOfDay(parseISO(trip.departureTime));
      return isSameDay(tripDate, currentDate);
    });
  }, [trips, currentDate]);

  // Group trips by driver
  const tripsByDriver = useMemo(() => {
    const grouped: Record<string, Trip[]> = {};
    drivers.forEach(d => {
      grouped[d.id] = [];
    });
    dayTrips.forEach(trip => {
      if (trip.driverId && grouped[trip.driverId]) {
        grouped[trip.driverId].push(trip);
      }
    });
    return grouped;
  }, [dayTrips, drivers]);

  // Navigation
  const canGoPrev = currentDate > startOfDay(new Date(startDate));
  const canGoNext = currentDate < startOfDay(new Date(endDate));

  const goToPrev = () => {
    if (canGoPrev) setCurrentDate(prev => subDays(prev, 1));
  };

  const goToNext = () => {
    if (canGoNext) setCurrentDate(prev => addDays(prev, 1));
  };

  const timelineWidth = HOURS.length * HOUR_WIDTH;

  return (
    <div className="flex flex-col h-full">
      {/* Header with navigation */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={goToPrev}
            disabled={!canGoPrev}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={goToNext}
            disabled={!canGoNext}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="font-semibold text-lg ml-2">
            {format(currentDate, "EEEE d MMMM yyyy", { locale: it })}
          </span>
        </div>

        {/* Day pills */}
        <div className="flex gap-1">
          {scheduleDates.map((date, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentDate(date)}
              className={cn(
                "px-3 py-1 text-sm rounded-full transition-colors",
                isSameDay(date, currentDate)
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80 text-muted-foreground"
              )}
            >
              {format(date, "EEE d", { locale: it })}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline container */}
      <div className="flex-1 overflow-hidden border rounded-lg bg-card">
        <div className="flex h-full">
          {/* Driver names column (fixed) */}
          <div className="w-48 flex-shrink-0 border-r bg-muted/30">
            {/* Header spacer */}
            <div className="h-10 border-b flex items-center px-3 font-medium text-sm text-muted-foreground">
              Autisti
            </div>
            {/* Driver rows */}
            {drivers.map((driver) => (
              <div
                key={driver.id}
                className="h-20 border-b flex items-center px-3 gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{driver.name}</div>
                  <Badge variant="outline" className="text-xs mt-1">
                    {driver.type === 'RESIDENT' ? 'Fisso' : driver.type === 'ON_CALL' ? 'Reperibile' : 'Emergenza'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>

          {/* Timeline scrollable area */}
          <div className="flex-1 overflow-x-auto">
            <div style={{ minWidth: timelineWidth }}>
              {/* Time header */}
              <div className="h-10 border-b flex bg-muted/20 sticky top-0">
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="border-r text-center text-sm text-muted-foreground flex items-center justify-center"
                    style={{ width: HOUR_WIDTH }}
                  >
                    {hour.toString().padStart(2, '0')}:00
                  </div>
                ))}
              </div>

              {/* Driver timeline rows */}
              {drivers.map((driver) => {
                const driverTrips = tripsByDriver[driver.id] || [];

                return (
                  <div
                    key={driver.id}
                    className="h-20 border-b relative group"
                    onClick={(e) => {
                      if (isDraft && onSlotClick && e.target === e.currentTarget) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const hour = Math.floor(x / HOUR_WIDTH) + START_HOUR;
                        onSlotClick(driver.id, currentDate, hour);
                      }
                    }}
                  >
                    {/* Hour grid lines */}
                    <div className="absolute inset-0 flex pointer-events-none">
                      {HOURS.map((hour) => (
                        <div
                          key={hour}
                          className="border-r border-dashed border-border/50 h-full"
                          style={{ width: HOUR_WIDTH }}
                        />
                      ))}
                    </div>

                    {/* Hover indicator for adding trips */}
                    {isDraft && (
                      <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                    )}

                    {/* Trip bars */}
                    {driverTrips.map((trip) => {
                      const start = new Date(trip.departureTime);
                      const end = trip.returnTime
                        ? new Date(trip.returnTime)
                        : new Date(start.getTime() + 8 * 60 * 60 * 1000);

                      const left = getTimePosition(start);
                      const width = getTimeWidth(start, end);
                      // Usa colori per tipo di viaggio, con override per cancelled
                      const tripType = trip.tripType || 'FULL_ROUND';
                      const isCancelled = trip.status === 'CANCELLED';
                      const colors = isCancelled ? statusColors.CANCELLED : tripTypeColors[tripType];
                      const isSelected = trip.id === selectedTripId;

                      const totalLiters = trip.trailers?.reduce((sum, t) => sum + t.litersLoaded, 0) || 0;
                      const hasDropOff = trip.trailers?.some(t => t.dropOffLocationId);
                      const hasPickup = trip.trailers?.some(t => t.isPickup);
                      const trailersInfo = trip.trailers?.map(t => t.trailer?.plate).filter(Boolean).join(', ');

                      return (
                        <div
                          key={trip.id}
                          className={cn(
                            "absolute top-2 bottom-2 rounded-md cursor-pointer transition-all overflow-hidden",
                            colors.bg,
                            colors.text,
                            "border-2",
                            isSelected ? "ring-2 ring-offset-2 ring-primary border-primary-foreground" : colors.border,
                            "hover:brightness-110 hover:shadow-lg"
                          )}
                          style={{
                            left: `${left}px`,
                            width: `${width}px`,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectTrip(trip);
                          }}
                        >
                          <div className="px-2 py-1 h-full flex flex-col justify-center">
                            {/* Main info */}
                            <div className="flex items-center gap-1 text-xs font-medium truncate">
                              <Truck className="h-3 w-3 flex-shrink-0" />
                              <span className="truncate">{trip.vehicle?.plate || 'N/A'}</span>
                            </div>

                            {/* Trailers and liters */}
                            <div className="flex items-center gap-1 text-xs opacity-90 truncate">
                              <Container className="h-3 w-3 flex-shrink-0" />
                              <span className="truncate">
                                {trailersInfo || 'N/A'} • {formatLiters(totalLiters)}
                              </span>
                            </div>

                            {/* Icons for special operations */}
                            {(hasPickup || hasDropOff) && (
                              <div className="flex gap-1 mt-0.5">
                                {hasPickup && (
                                  <span className="inline-flex items-center text-xs bg-white/20 rounded px-1">
                                    <ArrowUp className="h-3 w-3 mr-0.5" />
                                    Pick
                                  </span>
                                )}
                                {hasDropOff && (
                                  <span className="inline-flex items-center text-xs bg-white/20 rounded px-1">
                                    <ArrowDown className="h-3 w-3 mr-0.5" />
                                    Drop
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground flex-shrink-0">
        <span className="font-medium">Tipo:</span>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-green-500" />
          <span>Shuttle</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-blue-500" />
          <span>Supply</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-purple-500" />
          <span>Completo</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-orange-500" />
          <span>Transfer</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-red-400" />
          <span>Annullato</span>
        </div>
        {isDraft && (
          <>
            <span className="mx-2">|</span>
            <span className="italic">Clicca su uno slot vuoto per aggiungere un viaggio</span>
          </>
        )}
      </div>
    </div>
  );
}
