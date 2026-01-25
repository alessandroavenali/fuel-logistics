import { Router } from 'express';
import * as vehiclesController from '../controllers/vehicles.controller.js';
import * as trailersController from '../controllers/trailers.controller.js';
import * as driversController from '../controllers/drivers.controller.js';
import * as locationsController from '../controllers/locations.controller.js';
import * as routesController from '../controllers/routes.controller.js';
import * as schedulesController from '../controllers/schedules.controller.js';
import * as reportsController from '../controllers/reports.controller.js';

const router = Router();

// Vehicles
router.get('/vehicles', vehiclesController.getVehicles);
router.get('/vehicles/:id', vehiclesController.getVehicle);
router.post('/vehicles', vehiclesController.createVehicle);
router.put('/vehicles/:id', vehiclesController.updateVehicle);
router.delete('/vehicles/:id', vehiclesController.deleteVehicle);

// Trailers
router.get('/trailers', trailersController.getTrailers);
router.get('/trailers/:id', trailersController.getTrailer);
router.post('/trailers', trailersController.createTrailer);
router.put('/trailers/:id', trailersController.updateTrailer);
router.delete('/trailers/:id', trailersController.deleteTrailer);
router.get('/trailers/location/:locationId', trailersController.getTrailersAtLocation);

// Drivers
router.get('/drivers', driversController.getDrivers);
router.get('/drivers/expiring', driversController.getDriversWithExpiringLicenses);
router.get('/drivers/:id', driversController.getDriver);
router.post('/drivers', driversController.createDriver);
router.put('/drivers/:id', driversController.updateDriver);
router.delete('/drivers/:id', driversController.deleteDriver);
router.get('/drivers/:id/worklog', driversController.getDriverWorkLog);

// Locations
router.get('/locations', locationsController.getLocations);
router.get('/locations/:id', locationsController.getLocation);
router.post('/locations', locationsController.createLocation);
router.put('/locations/:id', locationsController.updateLocation);
router.delete('/locations/:id', locationsController.deleteLocation);

// Routes
router.get('/routes', routesController.getRoutes);
router.get('/routes/:id', routesController.getRoute);
router.post('/routes', routesController.createRoute);
router.put('/routes/:id', routesController.updateRoute);
router.delete('/routes/:id', routesController.deleteRoute);
router.post('/routes/calculate', routesController.calculateRoute);

// Schedules
router.get('/schedules', schedulesController.getSchedules);
router.get('/schedules/:id', schedulesController.getSchedule);
router.post('/schedules', schedulesController.createSchedule);
router.put('/schedules/:id', schedulesController.updateSchedule);
router.delete('/schedules/:id', schedulesController.deleteSchedule);
router.post('/schedules/:id/optimize', schedulesController.optimizeScheduleHandler);
router.put('/schedules/:id/confirm', schedulesController.confirmSchedule);
router.post('/schedules/:id/validate', schedulesController.validateSchedule);

// Trips within schedules
router.get('/schedules/:id/trips', schedulesController.getScheduleTrips);
router.post('/schedules/:id/trips', schedulesController.createTrip);
router.put('/schedules/:id/trips/:tripId', schedulesController.updateTrip);
router.delete('/schedules/:id/trips/:tripId', schedulesController.deleteTrip);

// Reports
router.get('/reports/trips', reportsController.getTripsReport);
router.get('/reports/drivers', reportsController.getDriversReport);
router.get('/reports/costs', reportsController.getCostsReport);
router.get('/reports/liters', reportsController.getLitersReport);
router.get('/reports/efficiency', reportsController.getEfficiencyReport);

export default router;
