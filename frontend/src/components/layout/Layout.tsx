import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Toaster } from './Toaster';

export function Layout() {
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="container py-6">
          <Outlet />
        </div>
      </main>
      <Toaster />
    </div>
  );
}
