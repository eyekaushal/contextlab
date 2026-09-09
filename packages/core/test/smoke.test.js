import { describe, expect, it } from 'vitest'

describe('@contextlab/core', () => {
  it('imports cleanly', async () => {
    const core = await import('../src/index.js')
    expect(core).toBeTypeOf('object')
  })
})
