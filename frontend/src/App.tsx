import { Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { ToastProvider } from '@/hooks/useToast';
import Dashboard from '@/pages/Dashboard';
import Vehicles from '@/pages/Vehicles';
import Trailers from '@/pages/Trailers';
import Drivers from '@/pages/Drivers';
import Locations from '@/pages/Locations';
import RoutesPage from '@/pages/Routes';
import Schedules from '@/pages/Schedules';
import ScheduleDetail from '@/pages/ScheduleDetail';
import Reports from '@/pages/Reports';

function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="vehicles" element={<Vehicles />} />
          <Route path="trailers" element={<Trailers />} />
          <Route path="drivers" element={<Drivers />} />
          <Route path="locations" element={<Locations />} />
          <Route path="routes" element={<RoutesPage />} />
          <Route path="schedules" element={<Schedules />} />
          <Route path="schedules/:id" element={<ScheduleDetail />} />
          <Route path="reports" element={<Reports />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}

export default App;
