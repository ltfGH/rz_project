import type { LoadedPack } from '../shared/types';

function key(id: string, version: string): string {
  return `${id}@${version}`;
}

export class PackRegistry {
  readonly #packs = new Map<string, LoadedPack>();

  register(pack: LoadedPack): void {
    const packKey = key(pack.catalog.id, pack.catalog.version);
    if (this.#packs.has(packKey)) throw new Error(`Pack '${packKey}' is already registered.`);
    this.#packs.set(packKey, pack);
  }

  get(id: string, version: string): LoadedPack {
    const packKey = key(id, version);
    const pack = this.#packs.get(packKey);
    if (!pack) throw new Error(`Pack '${packKey}' is not registered.`);
    return pack;
  }

  versions(id: string): readonly string[] {
    return Object.freeze([...this.#packs.values()]
      .filter((pack) => pack.catalog.id === id)
      .map((pack) => pack.catalog.version)
      .sort());
  }
}
