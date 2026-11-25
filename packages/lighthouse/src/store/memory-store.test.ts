import { createMemoryStore } from './memory-store.ts'
import { describeMailStore } from './store-contract.ts'

describeMailStore('the memory store', createMemoryStore)
