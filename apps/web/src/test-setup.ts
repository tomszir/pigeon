// Unmounts what each test rendered, since Vitest runs without globals.
import { cleanup } from '@solidjs/testing-library'
import { afterEach } from 'vitest'

afterEach(cleanup)
