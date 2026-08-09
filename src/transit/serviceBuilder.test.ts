import { describe, expect, it } from 'vitest';
import { testCity } from '../levels/test-city';
import { World } from '../world';
import { ConstructionEngine } from '../construction';
import {
  createLine, createStop, createTransferComplex, deleteLine, deserializeTransitNetwork, makeLine,
  reorderLineStops, serializeTransitNetwork, TransitNetwork,
  busStopValidator, canCreateTransfer, constructionServiceValidator, makeServiceLine,
  routeBusSegments, routeGuidewaySegments, snapBusStopCoordinate, stationsConnectedBySubway,
} from './index';

const world = new World(testCity);
const point = (latitude: number, longitude: number) => ({ latitude, longitude });
const engine = new ConstructionEngine(world);

describe('player transit service building', () => {
  it('snaps bus stops to roads and builds ordered street-following paths', () => {
    const a = snapBusStopCoordinate(world, point(41.870, -87.64));
    const b = snapBusStopCoordinate(world, point(41.876, -87.636));
    const c = snapBusStopCoordinate(world, point(41.880, -87.628));
    expect(a && b && c).toBeTruthy();
    expect(snapBusStopCoordinate(world, point(41.9, -87.7))).toBeNull();
    expect(busStopValidator(world).validateProposal({ kind: 'stop', coordinate: point(41.9, -87.7), modes: ['BUS'] }).reasons[0]).toBe('Bus stop must be placed near a road.');

    let network = new TransitNetwork();
    const stops = [
      { id: 's1', name: 'One', coordinate: a!, kind: 'stop' as const, supportedModes: ['BUS' as const] },
      { id: 's2', name: 'Two', coordinate: b!, kind: 'stop' as const, supportedModes: ['BUS' as const] },
      { id: 's3', name: 'Three', coordinate: c!, kind: 'stop' as const, supportedModes: ['BUS' as const] },
    ];
    for (const stop of stops) network = createStop(network, stop, busStopValidator(world));
    const routed = routeBusSegments(world, stops);
    expect(routed.error).toBeUndefined();
    expect(routed.geometries).toHaveLength(2);
    expect(routed.geometries[0].length).toBeGreaterThan(2);
    const line = makeServiceLine('bus-1', 'Harbor Bus', 'BUS', ['s1', 's2', 's3'], network, { geometries: routed.geometries });
    network = createLine(network, line);
    expect(network.getLine('bus-1')?.stopIds).toEqual(['s1', 's2', 's3']);
    network = reorderLineStops(network, 'bus-1', ['s3', 's2', 's1']);
    expect(network.getLine('bus-1')?.stopIds).toEqual(['s3', 's2', 's1']);
  });

  it('integrates tram construction with service lines and rejects missing guideway', () => {
    const empty = routeGuidewaySegments({ demolishedBuildingIds: [], engineeringSegments: [], stations: [] }, 'TRAM', [
      { id: 'a', name: 'A', coordinate: point(41.87, -87.64), kind: 'stop', supportedModes: ['TRAM'] },
      { id: 'b', name: 'B', coordinate: point(41.871, -87.64), kind: 'stop', supportedModes: ['TRAM'] },
    ]);
    expect(empty.error).toBe('Tram alignment has not been constructed.');

    const evaluation = engine.evaluate({ kind: 'alignment', id: 'tram-1', mode: 'TRAM', geometry: [point(41.87, -87.64), point(41.876, -87.64)] });
    expect(evaluation.valid).toBe(true);
    const state = engine.commit(evaluation.plan!);
    const stops = [
      { id: 't1', name: 'South', coordinate: point(41.8705, -87.64), kind: 'stop' as const, supportedModes: ['TRAM' as const] },
      { id: 't2', name: 'North', coordinate: point(41.8755, -87.64), kind: 'stop' as const, supportedModes: ['TRAM' as const] },
    ];
    const routed = routeGuidewaySegments(state, 'TRAM', stops);
    expect(routed.error).toBeUndefined();
    let network = new TransitNetwork();
    for (const stop of stops) network = createStop(network, stop, constructionServiceValidator(state));
    network = createLine(network, makeServiceLine('tram-line', 'Green', 'TRAM', ['t1', 't2'], network, { geometries: routed.geometries, reservedRightOfWay: true, engineeringBySegment: routed.engineeringBySegment }));
    expect(network.getLine('tram-line')?.segments[0].engineering?.reservedRightOfWay).toBe(true);
  });

  it('requires subway tunnels to connect constructed stations before service creation', () => {
    const stationA = engine.evaluate({ kind: 'station', id: 'subway-station-a', mode: 'SUBWAY', elevationMeters: -24, footprint: { center: point(41.871, -87.636), widthMeters: 28, lengthMeters: 140 } });
    const stateA = engine.commit(stationA.plan!);
    const stationB = engine.evaluate({ kind: 'station', id: 'subway-station-b', mode: 'SUBWAY', elevationMeters: -24, footprint: { center: point(41.876, -87.628), widthMeters: 28, lengthMeters: 140 } }, stateA);
    const stateB = engine.commit(stationB.plan!, stateA);
    expect(stationsConnectedBySubway(stateB, stateB.stations[0], stateB.stations[1])).toBe(false);

    const tunnel = engine.evaluate({
      kind: 'alignment', id: 'subway-tunnel-1', mode: 'SUBWAY',
      geometry: [stateB.stations[0].center, stateB.stations[1].center],
      verticalProfile: { startElevationMeters: -24, endElevationMeters: -24 },
    }, stateB);
    expect(tunnel.valid).toBe(true);
    const connected = engine.commit(tunnel.plan!, stateB);
    expect(stationsConnectedBySubway(connected, connected.stations[0], connected.stations[1])).toBe(true);
    expect(connected.stations.map((station) => station.id)).toEqual(['subway-station-a', 'subway-station-b']);

    const stops = connected.stations.map((station) => ({
      id: `stop-${station.id}`, name: station.id!, coordinate: station.center, kind: 'station' as const, supportedModes: ['SUBWAY' as const],
      infrastructure: { constructionStationId: station.id },
    }));
    const routed = routeGuidewaySegments(connected, 'SUBWAY', stops);
    expect(routed.error).toBeUndefined();
    let network = new TransitNetwork();
    for (const stop of stops) network = createStop(network, stop, constructionServiceValidator(connected));
    network = createLine(network, makeServiceLine('metro-1', 'Purple', 'SUBWAY', stops.map((stop) => stop.id), network, { geometries: routed.geometries, reservedRightOfWay: true }));
    const serialized = deserializeTransitNetwork(serializeTransitNetwork(network));
    expect(serialized.getLine('metro-1')?.color).toBeTruthy();
    const before = connected;
    network = deleteLine(network, 'metro-1');
    expect(network.definition.lines).toHaveLength(0);
    expect(network.definition.stops).toHaveLength(2);
    expect(before.engineeringSegments).toHaveLength(1);
    expect(before.stations).toHaveLength(2);
  });

  it('creates nearby transfers and rejects distant teleport links', () => {
    let network = new TransitNetwork();
    network = createStop(network, { id: 'near-a', name: 'A', coordinate: point(41.88, -87.63), kind: 'stop', supportedModes: ['BUS'] });
    network = createStop(network, { id: 'near-b', name: 'B', coordinate: point(41.8801, -87.6301), kind: 'stop', supportedModes: ['TRAM'] });
    network = createStop(network, { id: 'far', name: 'Far', coordinate: point(41.89, -87.62), kind: 'stop', supportedModes: ['BUS'] });
    expect(canCreateTransfer(network.getStop('near-a')!, network.getStop('near-b')!).ok).toBe(true);
    expect(canCreateTransfer(network.getStop('near-a')!, network.getStop('far')!).ok).toBe(false);
    network = createTransferComplex(network, 'hub', 'Hub', ['near-a', 'near-b']);
    expect(network.getStop('near-a')?.parentComplexId).toBe('hub');
  });

  it('keeps makeLine compatible and colors distinct service lines', () => {
    let network = createStop(new TransitNetwork(), { id: 'a', name: 'A', coordinate: point(41.87, -87.64), kind: 'stop', supportedModes: ['BUS'] });
    network = createStop(network, { id: 'b', name: 'B', coordinate: point(41.871, -87.64), kind: 'stop', supportedModes: ['BUS'] });
    network = createLine(network, makeLine('one', 'One', 'BUS', ['a', 'b'], network));
    network = createLine(network, makeServiceLine('two', 'Two', 'BUS', ['a', 'b'], network));
    expect(network.getLine('one')?.color).not.toEqual(network.getLine('two')?.color);
  });
});
