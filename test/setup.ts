/**
 * Shared vitest setup for dsh-scholar-find: resets the process-global S2 pacing
 * clock before every test so pacing state never leaks between specs (the clock
 * is a module-level singleton shared by all client instances).
 */
import { beforeEach } from 'vitest'
import { resetSharedPacing } from '../src/s2/client.js'

beforeEach(() => {
  resetSharedPacing()
})