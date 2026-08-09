import type { TransitLine, TransitNetworkDefinition, TransitStop, TransitTransferComplex } from './types';

/** Serializable player-owned topology. Runtime graph indexes are built separately. */
export class TransitNetwork {
  public constructor(public readonly definition: TransitNetworkDefinition = { version: 1, stops: [], transferComplexes: [], lines: [] }) {}
  public getStop(id: string): TransitStop | undefined { return this.definition.stops.find((stop) => stop.id === id); }
  public getLine(id: string): TransitLine | undefined { return this.definition.lines.find((line) => line.id === id); }
  public getTransferComplex(id: string): TransitTransferComplex | undefined { return this.definition.transferComplexes.find((complex) => complex.id === id); }
  public withDefinition(definition: TransitNetworkDefinition): TransitNetwork { return new TransitNetwork(definition); }
}
