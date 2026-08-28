import { describe, expect, it } from 'vitest'
import { withTimeout } from '../src/util/async.js'

describe('withTimeout', () => {
  it('resolves when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'x')).resolves.toBe(42)
  })

  it('rejects with the labeled timeout error when the promise stalls', async () => {
    await expect(withTimeout(new Promise(() => {}), 50, 'sciverse read_content')).rejects.toThrow('sciverse read_content: timeout after 50ms')
  })

  it('propagates the underlying rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'x')).rejects.toThrow('boom')
  })
})