import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Toaster } from './Toaster';
import { ThemeToggle } from './ThemeToggle';

export function Layout() {
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="flex justify-end items-center px-6 py-3 border-b">
          <ThemeToggle />
        </header>
        <main className="flex-1 overflow-auto">
          <div className="container py-6">
            <Outlet />
          </div>
        </main>
      </div>
      <Toaster />
    </div>
  );
}
