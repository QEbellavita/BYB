import { describe, it, expect, vi } from 'vitest'
import { supabaseImprovementsStore } from '../../src/modules/improvements/supabase-store.js'
import type { AutoSuggestionRow } from '../../src/modules/improvements/types.js'

// ---------------------------------------------------------------------------
// Fake Supabase client builder for upsertAuto tests
// ---------------------------------------------------------------------------

function makeFakeDb(opts: {
  selectData: unknown
  insertError: { code: string; message: string } | null
}) {
  const selectChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: opts.selectData, error: null }),
  }
  const insertChain = {
    insert: vi.fn().mockResolvedValue({ error: opts.insertError }),
  }
  return {
    from: vi.fn((table: string) => {
      if (table === 'improvements') {
        return {
          select: vi.fn().mockReturnValue(selectChain),
          insert: insertChain.insert,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient
}

const autoRow: AutoSuggestionRow = {
  workspace_id: 'ws-1',
  source: 'auto',
  status: 'open',
  trigger_kind: 'untreated_high_risk',
  dedup_key: 'untreated_high_risk:risk-1',
  title: 'Treat high risk',
  suggested_change: null,
  source_ref: { risk_id: 'risk-1' },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('supabaseImprovementsStore.upsertAuto', () => {
  it('does NOT throw when insert returns error code 23505 (concurrent duplicate)', async () => {
    const db = makeFakeDb({
      selectData: null, // No existing row — proceeds to insert
      insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
    })
    const store = supabaseImprovementsStore(db)

    // Must resolve without throwing
    await expect(store.upsertAuto(autoRow)).resolves.toBeUndefined()
  })

  it('throws when insert returns a non-23505 error', async () => {
    const db = makeFakeDb({
      selectData: null,
      insertError: { code: '42P01', message: 'relation "improvements" does not exist' },
    })
    const store = supabaseImprovementsStore(db)

    await expect(store.upsertAuto(autoRow)).rejects.toThrow('improvements upsertAuto')
  })

  it('skips insert entirely when a matching open row already exists (select-then-insert guard)', async () => {
    const db = makeFakeDb({
      selectData: { id: 'imp-existing' }, // Existing row found
      insertError: null,
    })
    const store = supabaseImprovementsStore(db)

    // Should resolve without calling insert at all
    await expect(store.upsertAuto(autoRow)).resolves.toBeUndefined()
    // insert was not called because select returned an existing row
    expect((db.from('improvements') as unknown as { insert: ReturnType<typeof vi.fn> }).insert).not.toHaveBeenCalled()
  })
})
