import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const hostPlugin = require('./index.js')

export const name = hostPlugin.name
export const inject = hostPlugin.inject
export const apply = hostPlugin.apply
