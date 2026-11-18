// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
interface WasmModule {
}

export interface ClassHandle {
  isAliasOf(other: ClassHandle): boolean;
  delete(): void;
  deleteLater(): this;
  isDeleted(): boolean;
  // @ts-ignore - If targeting lower than ESNext, this symbol might not exist.
  [Symbol.dispose](): void;
  clone(): this;
}
export interface DronePlanner extends ClassHandle {
  clearGrid(): void;
  setCell(_0: number, _1: number, _2: number): void;
  getCell(_0: number, _1: number): number;
  computePath(_0: number, _1: number, _2: number, _3: number, _4: number): boolean;
  hasPathObstruction(_0: number, _1: number, _2: number, _3: number): boolean;
  getLastExpandedCount(): number;
  getPathLength(): number;
  getReplanCount(): number;
  width(): number;
  height(): number;
  getLastReplanMs(): number;
  getPathCost(): number;
  getGridView(): any;
  getHeatView(): any;
  getPathView(): any;
}

interface EmbindModule {
  DronePlanner: {
    new(_0: number, _1: number): DronePlanner;
  };
}

export type MainModule = WasmModule & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
