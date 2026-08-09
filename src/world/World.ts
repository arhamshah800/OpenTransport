import type { Building, LevelDefinition, PointOfInterest, Road, Workplace } from './types';

/** Runtime read-models and indexes. Never mutate the source LevelDefinition. */
export class World {
  public readonly roadsById: ReadonlyMap<string, Road>;
  public readonly buildingsById: ReadonlyMap<string, Building>;
  public readonly workplacesById: ReadonlyMap<string, Workplace>;
  public readonly pointsOfInterestById: ReadonlyMap<string, PointOfInterest>;
  public constructor(public readonly definition: LevelDefinition) {
    this.roadsById = new Map(definition.roads.map((item) => [item.id, item]));
    this.buildingsById = new Map(definition.buildings.map((item) => [item.id, item]));
    this.workplacesById = new Map(definition.workplaces.map((item) => [item.id, item]));
    this.pointsOfInterestById = new Map(definition.pointsOfInterest.map((item) => [item.id, item]));
  }
}
