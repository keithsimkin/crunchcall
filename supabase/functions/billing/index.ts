import { handleBilling } from './worker.mjs'

type EdgeRuntime = {
  env: { get(name: string): string | undefined }
  serve(handler: (request: Request) => Response | Promise<Response>): void
}

const edge = (globalThis as { Deno?: EdgeRuntime }).Deno

if (!edge) {
  throw new Error('The billing function runs on the Supabase edge runtime.')
}

function read(name: string) {
  return edge.env.get(name) ?? ''
}

edge.serve((request) =>
  handleBilling(request, {
    SUPABASE_URL: read('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: read('SUPABASE_SERVICE_ROLE_KEY'),
    ANNOTATED_LICENSE_PRIVATE_KEY: read('ANNOTATED_LICENSE_PRIVATE_KEY'),
    DODO_PAYMENTS_API_KEY: read('DODO_PAYMENTS_API_KEY'),
    DODO_PAYMENTS_PRODUCT_ID: read('DODO_PAYMENTS_PRODUCT_ID'),
    DODO_PAYMENTS_WEBHOOK_KEY: read('DODO_PAYMENTS_WEBHOOK_KEY'),
    DODO_PAYMENTS_ENV: read('DODO_PAYMENTS_ENV'),
    RESEND_API_KEY: read('RESEND_API_KEY'),
    ANNOTATED_MAIL_FROM: read('ANNOTATED_MAIL_FROM'),
  }),
)
