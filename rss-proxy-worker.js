// rss-proxy-worker.js — v2, con endurecimiento de seguridad
// Proxy RSS propio para SEÑAL.
//

const SHARED_SECRET = 'e25bf4aabf7eac8f7a0678d7e147db3863f3b96488a54c68';

const ALLOWED_ORIGINS = [
  'https://jarudalapalma.github.io/se-al_noticias/',   // <- sustituye por tu dominio real de GitHub Pages
  'null',                            // permite abrir el archivo local (file://) mientras pruebas
];

const MAX_RESPONSE_BYTES = 3 * 1024 * 1024; // 3 MB, de sobra para un feed RSS

const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /\.local$/i,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
];

function isBlockedHostname(hostname) {
  return BLOCKED_HOSTNAME_PATTERNS.some(re => re.test(hostname));
}

function corsHeadersFor(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || 'null';
    const cors = corsHeadersFor(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'X-Senal-Key, Content-Type',
        },
      });
    }

    // --- Autenticación por clave compartida ---
    const key = request.headers.get('X-Senal-Key');
    if (key !== SHARED_SECRET) {
      return new Response('No autorizado.', { status: 403, headers: cors });
    }

    const { searchParams } = new URL(request.url);
    const target = searchParams.get('url');
    if (!target) {
      return new Response('Falta el parámetro ?url=', { status: 400, headers: cors });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return new Response('URL no válida.', { status: 400, headers: cors });
    }

    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      return new Response('Solo se permiten URLs http/https.', { status: 400, headers: cors });
    }
    if (isBlockedHostname(targetUrl.hostname)) {
      return new Response('Destino no permitido.', { status: 400, headers: cors });
    }

    try {
      const upstream = await fetch(targetUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SenalRSSProxy/2.0)',
          'Accept': 'application/rss+xml, application/xml, text/xml, text/html, */*',
        },
        cf: { cacheTtl: 300, cacheEverything: true },
      });

      const lengthHeader = upstream.headers.get('content-length');
      if (lengthHeader && Number(lengthHeader) > MAX_RESPONSE_BYTES) {
        return new Response('Respuesta demasiado grande.', { status: 413, headers: cors });
      }

      const buffer = await upstream.arrayBuffer();
      if (buffer.byteLength > MAX_RESPONSE_BYTES) {
        return new Response('Respuesta demasiado grande.', { status: 413, headers: cors });
      }

      return new Response(buffer, {
        status: upstream.status,
        headers: {
          ...cors,
          'Content-Type': upstream.headers.get('content-type') || 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        },
      });
    } catch (err) {
      return new Response('Error al obtener el recurso: ' + err.message, {
        status: 502,
        headers: cors,
      });
    }
  },
};
