export type TransportMode = 'bus' | 'tram' | 'subway';
export type Tool = 'select' | TransportMode | 'station' | 'data';
export type Camera = { zoom: number; tilt: number; x: number; y: number };
export type Station = { id: string; name: string; x: number; y: number; accessibility: boolean };
export type Route = { id: string; name: string; mode: TransportMode; color: string; stops: string[]; visible: boolean; vehicles: number; headway: number; capacity: number; status: 'healthy' | 'warning' | 'paused' };
export type Construction = { id: string; label: string; cost: number; affectedRouteId?: string; status: 'draft' | 'building' | 'complete' };
export type Alert = { id: string; message: string; severity: 'info' | 'warning' | 'error' };
export type TutorialState = { dismissed: boolean; current: number; completed: number[] };
export type PlannerSession = Readonly<{
  version: 1; cityId: string; cityName: string; cash: number; clock: number; speed: 0 | 1 | 2 | 3;
  score: number; routes: Route[]; stations: Station[]; projects: Construction[]; alerts: Alert[];
  camera: Camera; overlays: Record<'demand' | 'ridership' | 'coverage' | 'congestion' | 'unserved', boolean>;
  tutorial: TutorialState; selectedId?: string; updatedAt: number;
}>;
export type PlannerCommand =
  | { type: 'route.create'; route: Route }
  | { type: 'route.update'; id: string; changes: Partial<Pick<Route, 'name' | 'color' | 'visible' | 'vehicles' | 'headway' | 'capacity' | 'status'>> }
  | { type: 'route.delete'; id: string }
  | { type: 'station.create'; station: Station }
  | { type: 'station.delete'; id: string }
  | { type: 'project.create'; project: Construction }
  | { type: 'project.confirm'; id: string }
  | { type: 'select'; id?: string }
  | { type: 'camera.set'; camera: Camera }
  | { type: 'overlay.toggle'; overlay: keyof PlannerSession['overlays'] }
  | { type: 'clock.set'; speed: PlannerSession['speed'] }
  | { type: 'tutorial.set'; tutorial: TutorialState };
export type CommandResult = { ok: true; session: PlannerSession } | { ok: false; code: 'validation' | 'not-found' | 'funds'; message: string };
export type MapAdapterState = 'loading' | 'ready' | 'unavailable' | 'failed';
export type OverlayModel = Pick<PlannerSession, 'routes' | 'stations' | 'projects' | 'selectedId' | 'overlays' | 'alerts'>;
export interface MapAdapter { state: MapAdapterState; setCamera(camera: Camera): void; setOverlays(model: OverlayModel): void; destroy(): void }
