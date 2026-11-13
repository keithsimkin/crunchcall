import { handleRequest } from './worker.mjs'

export default {
  async fetch(request, env) {
    return handleRequest(request, env)
  },
}
