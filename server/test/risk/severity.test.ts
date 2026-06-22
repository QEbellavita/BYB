import { describe, it, expect } from 'vitest'
import { severityBucket } from '../../src/modules/risk/severity.js'
describe('severityBucket', () => {
  it('buckets l*i', () => {
    expect(severityBucket(1,1)).toBe('low')      // 1
    expect(severityBucket(2,3)).toBe('med')      // 6
    expect(severityBucket(3,4)).toBe('high')     // 12
    expect(severityBucket(5,5)).toBe('ext')      // 25
  })
})
