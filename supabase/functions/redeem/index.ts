import { handleRequest } from './worker.mjs'

type EdgeRuntime = {
  env: { get(name: string): string | undefined }
  serve(handler: (request: Request) => Response | Promise<Response>): void
}

const edge = (globalThis as { Deno?: EdgeRuntime }).Deno

if (!edge) {
  throw new Error('The redeem function runs on the Supabase edge runtime.')
}

edge.serve((request) =>
  handleRequest(request, {
    SUPABASE_URL: edge.env.get('SUPABASE_URL') ?? '',
    SUPABASE_SERVICE_ROLE_KEY: edge.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    ANNOTATED_LICENSE_PRIVATE_KEY: edge.env.get('ANNOTATED_LICENSE_PRIVATE_KEY') ?? '',
  }),
)
