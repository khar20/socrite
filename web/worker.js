const API_ORIGIN = 'https://socrite.onrender.com'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const isApiRequest = url.pathname === '/api' || url.pathname.startsWith('/api/')

    if (!isApiRequest) {
      return env.ASSETS.fetch(request)
    }

    const target = new URL(request.url)
    target.protocol = 'https:'
    target.hostname = new URL(API_ORIGIN).hostname
    target.port = ''

    return fetch(new Request(target, request))
  },
}
