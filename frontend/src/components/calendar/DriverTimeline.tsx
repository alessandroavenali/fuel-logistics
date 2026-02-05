import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { format, addDays, subDays, isSameDay, startOfDay, parseISO, addMinutes } from 'date-fns';
import { it } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Truck, Container, ArrowUp, ArrowDown, MapPin, Fuel } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Trip, TripStatus, TripType, DriverType, Route, Location } from '@/types';

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
  // Per tooltip timeline
  routeMap?: Record<string, Route>;
  locations?: {
    source?: Location;
    parking?: Location;
    destination?: Location;
  };
}

// Timeline step type
interface TimelineStep {
  time: Date;
  location: string;
  action: string;
  icon: 'start' | 'arrive' | 'depart' | 'dropoff' | 'pickup' | 'load' | 'unload' | 'end';
  details?: string;
}

// Timeline config - compatto per evitare scroll orizzontale
const START_HOUR = 6;
const END_HOUR = 21;
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
const HOUR_WIDTH = 50; // pixels per hour (ridotto da 80)

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
  TRANSFER_TIRANO: { bg: 'bg-orange-500', border: 'border-orange-600', text: 'text-white', label: 'Travaso' },
  SHUTTLE_FROM_LIVIGNO: { bg: 'bg-cyan-500', border: 'border-cyan-600', text: 'text-white', label: 'Shuttle LIV' },
  SUPPLY_FROM_LIVIGNO: { bg: 'bg-pink-500', border: 'border-pink-600', text: 'text-white', label: 'Supply LIV' },
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
  routeMap,
  locations,
}: DriverTimelineProps) {
  const [currentDate, setCurrentDate] = useState<Date>(() => startOfDay(new Date(startDate)));
  const [tooltipTrip, setTooltipTrip] = useState<{
    trip: Trip;
    timeline: TimelineStep[];
    colors: { bg: string; border: string; text: string };
    rect: DOMRect;
  } | null>(null);
  const tooltipHideTimeoutRef = useRef<number | null>(null);

  const updateTooltip = (trip: Trip, colors: { bg: string; border: string; text: string }, rect: DOMRect) => {
    const timelineForTooltip = calculateTimeline(trip);
    if (tooltipHideTimeoutRef.current) {
      window.clearTimeout(tooltipHideTimeoutRef.current);
      tooltipHideTimeoutRef.current = null;
    }
    setTooltipTrip(prev => {
      if (prev && prev.trip.id === trip.id) {
        return { ...prev, timeline: timelineForTooltip, colors, rect };
      }
      return { trip, timeline: timelineForTooltip, colors, rect };
    });
  };

  // Calcola timeline per un trip (per tooltip)
  const calculateTimeline = useMemo(() => {
    return (trip: Trip): TimelineStep[] => {
      if (!routeMap || !locations?.source || !locations?.parking || !locations?.destination) {
        return [];
      }
      const { source, parking, destination } = locations;
      const timeline: TimelineStep[] = [];
      let currentTime = new Date(trip.departureTime);

      const LOAD_TIME = 30;
      const UNLOAD_TIME = 30;

      const getRouteDuration = (fromId: string, toId: string): number => {
        const route = routeMap[`${fromId}-${toId}`];
        return route?.durationMinutes || 60;
      };

      const tripType = trip.tripType || 'FULL_ROUND';

      if (tripType === 'SHUTTLE_LIVIGNO') {
        timeline.push({ time: new Date(currentTime), location: parking.name, action: 'Partenza', icon: 'start' });
        currentTime = addMinutes(currentTime, getRouteDuration(parking.id, destination.id));
        timeline.push({ time: new Date(currentTime), location: destination.name, action: 'Arrivo', icon: 'arrive' });
        timeline.push({ time: new Date(currentTime), location: destination.name, action: 'Scarico', icon: 'unload', details: '17.500 L' });
        currentTime = addMinutes(currentTime, UNLOAD_TIME);
        timeline.push({ time: new Date(currentTime), location: destination.name, action: 'Partenza', icon: 'depart' });
        currentTime = addMinutes(currentTime, getRouteDuration(destination.id, parking.id));
        timeline.push({ time: new Date(currentTime), location: parking.name, action: 'Fine', icon: 'end' });
      } else if (tripType === 'SUPPLY_MILANO') {
        timeline.push({ time: new Date(currentTime), location: parking.name, action: 'Partenza', icon: 'start' });
        currentTime = addMinutes(currentTime, getRouteDuration(parking.id, source.id));
        timeline.push({ time: new Date(currentTime), location: source.name, action: 'Arrivo', icon: 'arrive' });
        timeline.push({ time: new Date(currentTime), location: source.name, action: 'Carico', icon: 'load', details: '35.000 L' });
        currentTime = addMinutes(currentTime, LOAD_TIME * 2);
        timeline.push({ time: new Date(currentTime), location: source.name, action: 'Partenza', icon: 'depart' });
        currentTime = addMinutes(currentTime, getRouteDuration(source.id, parking.id));
        timeline.push({ time: new Date(currentTime), location: parking.name, action: 'Fine', icon: 'end' });
      } else if (tripType === 'TRANSFER_TIRANO') {
        timeline.push({ time: new Date(currentTime), location: parking.name, action: 'Inizio sversamento', icon: 'start' });
        timeline.push({ time: new Date(currentTime), location: parking.name, action: 'Travaso rimorchio → motrice', icon: 'unload', details: '17.500 L' });
        currentTime = addMinutes(currentTime, 30);
        timeline.push({ time: new Date(currentTime), location: parking.name, action: 'Fine', icon: 'end' });
      } else if (tripType === 'FULL_ROUND') {
        timeline.push({ time: new Date(currentTime), location: parking.name, action: 'Partenza', icon: 'start' });
        currentTime = addMinutes(currentTime, getRouteDuration(parking.id, source.id));
        timeline.push({ time: new Date(currentTime), location: source.name, action: 'Arrivo Milano', icon: 'arrive' });
        timeline.push({ time: new Date(currentTime), location: source.name, action: 'Carico', icon: 'load', details: '17.500 L' });
        currentTime = addMinutes(currentTime, LOAD_TIME);
        timeline.push({ time: new Date(currentTime), location: source.name, action: 'Partenza', icon: 'depart' });
        currentTime = addMinutes(currentTime, getRouteDuration(source.id, parking.id));
        timeline.push({ time: new Date(currentTime), location: parking.name, action: 'Arrivo Tirano', icon: 'arrive' });
        timeline.push({ time: new Date(currentTime), location: parking.name, action: 'Partenza', icon: 'depart' });
        currentTime = addMinutes(currentTime, getRouteDuration(parking.id, destination.id));
        timeline.push({ time: new Date(currentTime), location: destination.name, action: 'Arrivo Livigno', icon: 'arrive' });
        timeline.push({ time: new Date(currentTime), location: destination.name, action: 'Scarico', icon: 'unload', details: '17.500 L' });
        currentTime = addMinutes(currentTime, UNLOAD_TIME);
        timeline.push({ time: new Date(currentTime), location: destination.name, action: 'Partenza', icon: 'depart' });
        currentTime = addMinutes(currentTime, getRouteDuration(destination.id, parking.id));
        timeline.push({ time: new Date(currentTime), location: parking.name, action: 'Fine', icon: 'end' });
      } else if (tripType === 'SHUTTLE_FROM_LIVIGNO') {
        // SHUTTLE_FROM_LIVIGNO: Livigno -> Tirano -> Transfer -> Tirano -> Livigno (4.5h)
        const TRANSFER_TIME = 30;
        timeline.push({ time: new Date(currentTime), location: destination.name, action: 'Partenza da Livigno', icon: 'start' });
        currentTime = addMinutes(currentTime, getRouteDuration(destination.id, parking.id));
        timeline.push({ time: new Date(currentTime), location: parking.name, action: 'Arrivo Tirano', icon: 'arrive' });
        timeline.push({ time: new Date(currentTime), location: parking.name, action: 'Travaso rimorchio → motrice', icon: 'unload', details: '17.500 L' });
        currentTime = addMinutes(currentTime, TRANSFER_TIME);
        timeline.push({ time: new Date(currentTime), location: parking.name, action: 'Partenza', icon: 'depart' });
        currentTime = addMinutes(currentTime, getRouteDuration(parking.id, destination.id));
        timeline.push({ time: new Date(currentTime), location: destination.name, action: 'Arrivo Livigno', icon: 'arrive' });
        timeline.push({ time: new Date(currentTime), location: destination.name, action: 'Scarico', icon: 'unload', details: '17.500 L' });
        currentTime = addMinutes(currentTime, UNLOAD_TIME);
        timeline.push({ time: new Date(currentTime), location: destination.name, action: 'Fine (motrice a Livigno)', icon: 'end' });
      } else if (tripType === 'SUPPLY_FROM_LIVIGNO') {
        // SUPPLY_FROM_LIVIGNO: Livigno -> Tirano -> Milano -> Tirano -> Livigno (10h)
        timeline.push({ time: new Date(currentTime), location: destination.name, action: 'Partenza da Livigno', icon: 'start' });
        currentTime = addMinutes(currentTime, getRouteDuration(destination.id, parking.id));
        timeline.push({ time: new Date(currentTime), location: parking.name, action: 'Arrivo Tirano', icon: 'arrive' });
        timeline.push({ time: new Date(currentTime), location: parking.name, action: 'Partenza', icon: 'depart' });
        currentTime = addMinutes(currentTime, getRouteDuration(parking.id, source.id));
        timeline.push({ time: new Date(currentTime), location: source.name, action: 'Arrivo Milano', icon: 'arrive' });
        timeline.push({ time: new Date(currentTime), location: source.name, action: 'Carico', icon: 'load', details: '35.000 L' });
        currentTime = addMinutes(currentTime, LOAD_TIME * 2);
        timeline.push({ time: new Date(currentTime), location: source.name, action: 'Partenza', icon: 'depart' });
        currentTime = addMinutes(currentTime, getRouteDuration(source.id, parking.id));
        timeline.push({ time: new Date(currentTime), location: parking.name, action: 'Arrivo Tirano', icon: 'arrive' });
        timeline.push({ time: new Date(currentTime), location: parking.name, action: 'Partenza', icon: 'depart' });
        currentTime = addMinutes(currentTime, getRouteDuration(parking.id, destination.id));
        timeline.push({ time: new Date(currentTime), location: destination.name, action: 'Arrivo Livigno', icon: 'arrive' });
        timeline.push({ time: new Date(currentTime), location: destination.name, action: 'Scarico', icon: 'unload', details: '17.500 L' });
        currentTime = addMinutes(currentTime, UNLOAD_TIME);
        timeline.push({ time: new Date(currentTime), location: destination.name, action: 'Fine (motrice a Livigno)', icon: 'end' });
      }
      return timeline;
    };
  }, [routeMap, locations]);

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
          <div className="w-32 flex-shrink-0 border-r bg-muted/30">
            {/* Header spacer */}
            <div className="h-8 border-b flex items-center px-2 font-medium text-xs text-muted-foreground">
              Autisti
            </div>
            {/* Driver rows */}
            {drivers.map((driver) => (
              <div
                key={driver.id}
                className="h-14 border-b flex items-center px-2 gap-1"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{driver.name}</div>
                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                    {driver.type === 'RESIDENT' ? 'Fisso' : driver.type === 'ON_CALL' ? 'Reperibile' : 'Emerg.'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>

          {/* Timeline scrollable area */}
          <div className="flex-1 overflow-x-auto">
            <div style={{ minWidth: timelineWidth }}>
              {/* Time header */}
              <div className="h-8 border-b flex bg-muted/20 sticky top-0">
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="border-r text-center text-xs text-muted-foreground flex items-center justify-center"
                    style={{ width: HOUR_WIDTH }}
                  >
                    {hour}:00
                  </div>
                ))}
              </div>

              {/* Driver timeline rows */}
              {drivers.map((driver) => {
                const driverTrips = tripsByDriver[driver.id] || [];

                return (
                  <div
                    key={driver.id}
                    className="h-14 border-b relative group"
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
                          className="absolute top-0 bottom-0"
                          style={{
                            left: `${left}px`,
                            width: `${width}px`,
                          }}
                          onMouseEnter={(event) => {
                            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                            updateTooltip(trip, colors, rect);
                          }}
                          onMouseMove={(event) => {
                            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                            updateTooltip(trip, colors, rect);
                          }}
                          onMouseLeave={() => {
                            if (tooltipHideTimeoutRef.current) {
                              window.clearTimeout(tooltipHideTimeoutRef.current);
                            }
                            tooltipHideTimeoutRef.current = window.setTimeout(() => {
                              setTooltipTrip(null);
                            }, 80);
                          }}
                        >
                          {/* Barra colorata */}
                          <div
                            className={cn(
                              "absolute top-2 bottom-2 left-0 right-0 rounded-md cursor-pointer transition-all",
                              colors.bg,
                              colors.text,
                              "border-2",
                              isSelected ? "ring-2 ring-offset-2 ring-primary border-primary-foreground" : colors.border,
                              "hover:brightness-110 hover:shadow-lg"
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectTrip(trip);
                            }}
                          >
                            <div className="px-1.5 py-0.5 h-full flex flex-col justify-center overflow-hidden">
                              {/* Contenuto adattivo in base alla larghezza */}
                              {width > 80 ? (
                                <>
                                  {/* Main info */}
                                  <div className="flex items-center gap-1 text-xs font-medium truncate">
                                    <Truck className="h-3 w-3 flex-shrink-0" />
                                    <span className="truncate">{trip.vehicle?.plate || 'N/A'}</span>
                                    {/* Pick/Drop inline */}
                                    {hasPickup && <ArrowUp className="h-3 w-3 flex-shrink-0 ml-1" />}
                                    {hasDropOff && <ArrowDown className="h-3 w-3 flex-shrink-0" />}
                                  </div>
                                  {/* Trailers and liters */}
                                  <div className="flex items-center gap-1 text-xs opacity-90 truncate">
                                    <Container className="h-3 w-3 flex-shrink-0" />
                                    <span className="truncate">
                                      {trailersInfo || 'N/A'} • {formatLiters(totalLiters)}
                                    </span>
                                  </div>
                                </>
                              ) : (
                                /* Barra stretta: mostra solo icona tipo */
                                <div className="flex items-center justify-center h-full">
                                  <Truck className="h-3 w-3" />
                                </div>
                              )}
                            </div>
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
      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground flex-shrink-0 flex-wrap">
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
          <span>Travaso</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-cyan-500" />
          <span>Shuttle LIV</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-pink-500" />
          <span>Supply LIV</span>
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

      {tooltipTrip && typeof document !== 'undefined' && (() => {
        const tooltipWidth = 280;
        const margin = 8;
        const rect = tooltipTrip.rect;
        let left = rect.left;
        if (left + tooltipWidth > window.innerWidth - margin) {
          left = rect.right - tooltipWidth;
        }
        left = Math.max(margin, Math.min(left, window.innerWidth - tooltipWidth - margin));
        const estimatedHeight = Math.min(320, 80 + tooltipTrip.timeline.length * 20);
        let top = rect.bottom + 6;
        if (top + estimatedHeight > window.innerHeight - margin) {
          top = rect.top - estimatedHeight - 6;
        }
        top = Math.max(margin, top);

        return createPortal(
          <div
            className="fixed z-[9999] bg-popover text-popover-foreground border rounded-lg shadow-xl p-3 w-[280px] pointer-events-none"
            style={{ top, left }}
          >
            <div className="flex items-center gap-2 mb-2 pb-2 border-b">
              <Badge className={`${tooltipTrip.colors.bg} ${tooltipTrip.colors.text} text-xs`}>
                {tripTypeColors[tooltipTrip.trip.tripType || 'FULL_ROUND']?.label || tooltipTrip.trip.tripType}
              </Badge>
              <span className="text-sm font-medium">{tooltipTrip.trip.vehicle?.plate}</span>
              <span className="text-xs text-muted-foreground">• {tooltipTrip.trip.driver?.name}</span>
            </div>
            <div className="space-y-1.5">
              {tooltipTrip.timeline.length === 0 && (
                <div className="text-xs text-muted-foreground">
                  Timeline non disponibile per questo viaggio.
                </div>
              )}
              {tooltipTrip.timeline.map((step, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs">
                  <span className="font-mono text-muted-foreground w-10 shrink-0">
                    {format(step.time, 'HH:mm')}
                  </span>
                  <div className={cn(
                    "w-4 h-4 rounded-full flex items-center justify-center shrink-0",
                    step.icon === 'start' ? 'bg-green-500 text-white' :
                    step.icon === 'end' ? 'bg-blue-500 text-white' :
                    step.icon === 'load' ? 'bg-emerald-500 text-white' :
                    step.icon === 'unload' ? 'bg-yellow-500 text-white' :
                    'bg-muted text-muted-foreground'
                  )}>
                    {step.icon === 'start' || step.icon === 'end' ? (
                      <MapPin className="h-2.5 w-2.5" />
                    ) : step.icon === 'load' || step.icon === 'unload' ? (
                      <Fuel className="h-2.5 w-2.5" />
                    ) : (
                      <ArrowDown className="h-2.5 w-2.5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{step.action}</span>
                    <span className="text-muted-foreground ml-1">{step.location}</span>
                    {step.details && (
                      <span className="ml-1 text-[10px] bg-muted px-1 rounded">{step.details}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>,
          document.body
        );
      })()}
    </div>
  );
}
