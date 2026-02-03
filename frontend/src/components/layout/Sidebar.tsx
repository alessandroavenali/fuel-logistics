import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Truck,
  Container,
  Users,
  MapPin,
  Route,
  Calendar,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Motrici', href: '/vehicles', icon: Truck },
  { name: 'Rimorchi', href: '/trailers', icon: Container },
  { name: 'Autisti', href: '/drivers', icon: Users },
  { name: 'Luoghi', href: '/locations', icon: MapPin },
  { name: 'Percorsi', href: '/routes', icon: Route },
  { name: 'Pianificazione', href: '/schedules', icon: Calendar },
  { name: 'Report', href: '/reports', icon: BarChart3 },
];

export function Sidebar() {
  return (
    <div className="flex h-full w-64 flex-col border-r bg-card">
      <div className="flex h-16 items-center border-b px-6">
        <h1 className="text-xl font-bold text-primary">Fuel Logistics</h1>
      </div>
      <nav className="flex-1 space-y-1 p-4">
        {navigation.map((item) => (
          <NavLink
            key={item.name}
            to={item.href}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )
            }
          >
            <item.icon className="h-5 w-5" />
            {item.name}
          </NavLink>
        ))}
      </nav>
      <div className="border-t p-4">
        <p className="text-xs text-muted-foreground">
          Gestione Trasporti Carburante
        </p>
      </div>
    </div>
  );
}
