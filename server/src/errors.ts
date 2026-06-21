export class StaleDraftError extends Error {
  constructor(public readonly entity: string, public readonly id: string) {
    super(`stale ${entity} ${id}`)
    this.name = 'StaleDraftError'
  }
}
