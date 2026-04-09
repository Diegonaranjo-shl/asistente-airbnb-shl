// ASISTENTE IA AIRBNB - SUPERHOST LOFT
// servidor_asistente.js v5.7
// FIX: Login multi-paso — sigue redirect_url para capturar todas las cookies/tokens
// FIX: Usa hash del login como posible token de auth
// FIX: Diagnóstico mejorado de auth
// FIX: WebSocket como canal principal de recepción

const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const socketio = require('socket.io-client');
const crypto = require('crypto');
const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

const VERSION = '5.7.1';

const CONFIG = {
  ANTHROPIC_API_KEY:    process.env.ANTHROPIC_API_KEY,
  IGMS_EMAIL:           process.env.IGMS_EMAIL,
  IGMS_PASSWORD:        process.env.IGMS_PASSWORD,
  IGMS_CLIENT_ID:       parseInt(process.env.IGMS_CLIENT_ID || '93483'),
  PORT:                 process.env.PORT || 3000,
  TTLOCK_CLIENT_ID:     process.env.TTLOCK_CLIENT_ID || 'ef6d462b1ccd42b7a332b0113de71f97',
  TTLOCK_CLIENT_SECRET: process.env.TTLOCK_CLIENT_SECRET || 'effa57da6d6e5ea588190ab457585c6c',
  TTLOCK_USERNAME:      process.env.TTLOCK_USERNAME || 'diego.anfitrion@gmail.com',
  TTLOCK_PASSWORD:      process.env.TTLOCK_PASSWORD || 'Airbnb1280.',
  TTLOCK_LOCK_PORTON:   parseInt(process.env.TTLOCK_LOCK_ID_PORTON || '6778458'),
  WHATSAPP_API_KEY:     process.env.WHATSAPP_API_KEY,
  DIEGO_WHATSAPP:       process.env.DIEGO_WHATSAPP,
};

// ===========================================================
// SESION IGMS — ahora almacena más datos de auth
// ===========================================================
let sesion = {
  cookies: null,       // String con todas las cookies
  hash: null,          // Hash del login (posible token)
  userUid: null,       // user_uid del login
  redirectUrl: null,   // redirect_url del login
  expira: 0,
  loginOk: false,
  threadsOk: false,    // true si /api/data/threads responde JSON
};
let socket = null;
let socketConectado = false;
let reconectando = false;
const respondidos = new Set();

// ===========================================================
// TTLOCK
// ===========================================================
let ttlockToken = { access_token: null, expira: 0 };

async function getTTLockToken() {
  if (ttlockToken.access_token && Date.now() < ttlockToken.expira) return ttlockToken.access_token;
  const md5pass = crypto.createHash('md5').update(CONFIG.TTLOCK_PASSWORD).digest('hex');
  const params = new URLSearchParams({
    client_id: CONFIG.TTLOCK_CLIENT_ID,
    client_secret: CONFIG.TTLOCK_CLIENT_SECRET,
    username: CONFIG.TTLOCK_USERNAME,
    password: md5pass
  });
  const res = await axios.post('https://euapi.ttlock.com/oauth2/token', params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  ttlockToken = { access_token: res.data.access_token, expira: Date.now() + (res.data.expires_in - 60) * 1000 };
  console.log('[TTLock] Token renovado OK');
  return ttlockToken.access_token;
}

async function generarCodigoTTLock(lockId, nombre) {
  try {
    const accessToken = await getTTLockToken();
    const ahora = Date.now();
    const inicio = new Date(); inicio.setHours(0, 0, 0, 0);
    const fin = new Date(); fin.setHours(23, 59, 59, 0);
    const params = new URLSearchParams({
      clientId: CONFIG.TTLOCK_CLIENT_ID,
      accessToken,
      lockId: lockId.toString(),
      keyboardPwdType: 4,
      keyboardPwdName: nombre.substring(0, 20),
      startDate: inicio.getTime().toString(),
      endDate: fin.getTime().toString(),
      date: ahora.toString()
    });
    const res = await axios.post('https://euapi.ttlock.com/v3/keyboardPwd/get', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    if (res.data.keyboardPwd) {
      console.log('[TTLock] Codigo generado para ' + nombre + ': ' + res.data.keyboardPwd);
      return res.data.keyboardPwd;
    }
    return null;
  } catch(e) {
    console.error('[TTLock] Error:', e.message);
    return null;
  }
}

// ===========================================================
// SYSTEM PROMPT
// ===========================================================
const SYSTEM_PROMPT = `Eres el asistente virtual del equipo SuperHost Loft de Diego Naranjo y Maritza.
Superhost verificado de Airbnb con 33+ propiedades en Colombia.

REGLA PRINCIPAL: Airbnb ya envia bienvenida+Hospy, check-in, check-out y resena automaticamente.
NO los repitas. Solo responde preguntas del huesped.

BLACKLIVING: Cra 73 Bis 64A-67, Engativa, Bogota. Maps: https://g.co/kgs/e2irUV
Lofts (2p): 301-306, 401-406 | Familiares: 101,201,202 | PH: 501
Check-in: 3pm TODAS las propiedades | Check-out: 11am lofts | 12pm fam/PH
Late checkout 2pm: $50.000 COP (sujeto disponibilidad)
Codigos caja: 101->2850|201->1607|202->0190|301->3676|302->9244|303->2713|304->9094|305->5961
306->6457|401->8219|402->3253|403->9733|404->9034|405->1357|406->1486|501->2080
Parqueadero: GRATIS para estadias cortas. Solo para MOTO (no hay para carro).
Estadias mas de 30 dias: $35.000 COP MENSUAL.
Edificio con ascensor | Lavanderia $7.000/turno piso5 (8-11am o 3-7pm, Nequi 3107541755 Maritza Mora)
Domicilios: CRA 73BIS 64A-67 + num apto (no ubicacion del mapa)
Agua Bogota: potable. Cafe: Sello Rojo.
WIFI BLACKLIVING: si cae red principal, alternativas: HOST-101, APTO30422, APTO40122
HOSPY: obligatorio. Sin registro = sin codigo TTLock.
APTO 101: primer piso, 4 habitaciones
APTO 201: TV en una habitacion y en la sala.
PH 501: terraza privada | hab principal cama queen + bano privado con jacuzzi | hasta 8 personas

LA 33-805: Cra 7 33-91 Edif Teleskop (estadias largas)
CANDELARIA 1210: Calle 18 3-18 Edif Ventto | caja: 9539
SANTA BARBARA 205: Calle 124 21-10 Edif Toledo
COUNTRY 310: Edif LECCO, Calle 134c 12b-91, Apto 310. Parqueadero solo moto. Estadias +30 dias: $35.000 mensual.
RODADERO 401 (Santa Marta): Calle 17 2-63, Edif Manzanares. Check-in hasta 10pm presencial. Encargada: Yurani.
SANTA MARINA 1410: Torre 2, Apto 1410, Conj Santa Marina, sector Don Jaca. Manillas: $29.200/persona.
Desayuno incluido SOLO para reservas de 7 noches o mas (leche, cafe, azucar, aceite, jugo naranja, pan, queso, jamon, huevos).
Para reservas menores a 7 noches NO incluye desayuno.
TAYRONA: KM 37 Troncal | 4pm/11am | Wilfer: +57 321 7652591
PALOMINO: Parcelacion Ukua Casa C1 | piscina+playa privada
CURITÌ CASTILLO: 7 cabanas, banos compartidos, sin desayuno, sin nevera en cabanas.

PRECIOS: nunca dar precio total, decir que lo vean en la app Airbnb.
ESTAFA cancelacion: solo reembolso si hay nueva reserva en las mismas fechas.
NUNCA dar telefono personal. NUNCA prometer sin confirmar.
Firma: Equipo Super Host Loft
TONO: Amable, colombiano, 2-3 parrafos, 1-2 emojis. Mismo idioma del huesped.`;

// ===========================================================
// CODIGOS CAJA Y CHECKIN
// ===========================================================
const CODIGOS_CAJA = {
  101:2850, 201:1607, 202:190, 301:3676, 302:9244, 303:2713,
  304:9094, 305:5961, 306:6457, 401:8219, 402:3253, 403:9733,
  404:9034, 405:1357, 406:1486, 501:2080
};

function extraerNumeroApto(propiedad) {
  const m = propiedad.match(/\b(101|201|202|301|302|303|304|305|306|401|402|403|404|405|406|501)\b/);
  return m ? parseInt(m[1]) : null;
}

function esEdificioBlackliving(propiedad) {
  const p = propiedad.toLowerCase();
  return p.includes('aeropuerto') || p.includes('embajada') || p.includes('encanto') ||
         p.includes('engativa') || p.includes('73bis') || p.includes('73 bis') ||
         p.includes('blackliving') || extraerNumeroApto(propiedad) !== null;
}

async function generarMensajeCheckin(nombre, propiedad) {
  if (!esEdificioBlackliving(propiedad)) return null;
  const numApto = extraerNumeroApto(propiedad);
  if (!numApto) return null;
  const codigoCaja = CODIGOS_CAJA[numApto];
  if (!codigoCaja) return null;
  let codigoPorton = '[CODIGO PORTON]';
  if (CONFIG.TTLOCK_LOCK_PORTON) {
    const codigo = await generarCodigoTTLock(CONFIG.TTLOCK_LOCK_PORTON, nombre);
    if (codigo) codigoPorton = codigo;
  }
  return 'Hola ' + nombre + '\n' +
    'El personal del edificio tendra una autorizacion para permitir tu ingreso.\n\n' +
    'EDIFICIO PORTON NEGRO\n' +
    'Direccion: Cra 73bis 64A-67 - APTO ' + numApto + '\n' +
    'https://g.co/kgs/e2irUV\n\n' +
    'La puerta del edificio es con cerradura de teclado:\n' +
    '1. Frota la mano en la parte de arriba hasta que se prenda el teclado.\n' +
    '2. Ingresa el CODIGO: ' + codigoPorton + '# (el signo # va al final)\n' +
    '3. Baja la manija negra para abrir la puerta.\n' +
    '4. Una vez adentro cierra y sube la manija negra para asegurar.\n\n' +
    'Junto a la puerta del apto encontraras la caja de llaves:\n' +
    'Alinea el codigo, baja la palanca negra y hala la tapa.\n' +
    'CODIGO DE CAJA DE LLAVES: ' + codigoCaja + '\n\n' +
    'Encontraras 3 llaves:\n' +
    '- Llave puerta principal (doble llave despues de las 10pm)\n' +
    '- Llave de emergencia (debe permanecer en la cajita)\n' +
    '- Tarjeta negra: acceso sin codigo al edificio\n\n' +
    'Perdida de llaves: 10 USD\n\n' +
    'Saludos!\n' +
    'Equipo Super Host Loft';
}

const reservasPendientes = {};

async function programarCheckin(threadId, nombre, propiedad, fechaCheckin) {
  const hoy = new Date().toDateString();
  const llegada = new Date(fechaCheckin).toDateString();
  if (hoy === llegada) {
    const msg = await generarMensajeCheckin(nombre, propiedad);
    if (msg) {
      await enviarMensaje(threadId, msg);
      console.log('[Checkin] Enviado a ' + nombre);
    }
  } else {
    reservasPendientes[threadId] = { nombre, propiedad, fechaCheckin };
    console.log('[Checkin] Programado para ' + nombre + ' - ' + fechaCheckin);
  }
}

setInterval(async () => {
  const hoy = new Date().toDateString();
  for (const [threadId, r] of Object.entries(reservasPendientes)) {
    if (new Date(r.fechaCheckin).toDateString() === hoy) {
      const ok = await asegurarSesion();
      if (ok) {
        const msg = await generarMensajeCheckin(r.nombre, r.propiedad);
        if (msg) {
          await enviarMensaje(threadId, msg);
          console.log('[Checkin auto] ' + r.nombre);
          delete reservasPendientes[threadId];
        }
      }
    }
  }
}, 60 * 60 * 1000);

// ===========================================================
// LOGIN IGMS — MULTI-PASO v5.7.1
// DESCUBRIMIENTO: El navegador obtiene PHPSESSID + csrf_token
// al navegar a chat.html DESPUÉS del login. El POST login solo
// devuelve wsb-user-uid. Necesitamos seguir TODOS los redirects
// manualmente acumulando cookies, como lo hace un navegador real.
// ===========================================================

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Helper: hacer request acumulando cookies en el jar
async function igmsRequest(method, url, cookieJar, opts) {
  const config = {
    method,
    url,
    headers: {
      'Cookie': formatCookies(cookieJar),
      'User-Agent': UA,
      ...((opts && opts.headers) || {}),
    },
    maxRedirects: 0, // Manejar redirects manualmente
    validateStatus: () => true,
  };
  if (opts && opts.data) config.data = opts.data;
  if (opts && opts.responseType) config.responseType = opts.responseType;
  
  const res = await axios(config);
  
  // Acumular cookies de esta respuesta
  const newCookies = res.headers['set-cookie'] || [];
  for (const c of newCookies) {
    const [nameVal] = c.split(';');
    const eqIdx = nameVal.indexOf('=');
    if (eqIdx > 0) {
      cookieJar[nameVal.substring(0, eqIdx).trim()] = nameVal.substring(eqIdx + 1).trim();
    }
  }
  
  // Si es redirect, seguirlo con las cookies acumuladas
  if (res.status >= 300 && res.status < 400 && res.headers.location) {
    const loc = res.headers.location;
    const nextUrl = loc.startsWith('http') ? loc : 'https://www.igms.com' + (loc.startsWith('/') ? '' : '/') + loc;
    console.log('[IGMS] Redirect ' + res.status + ' → ' + nextUrl + ' (cookies: ' + Object.keys(cookieJar).join(',') + ')');
    return igmsRequest('GET', nextUrl, cookieJar, { headers: { 'Accept': 'text/html,*/*', 'Referer': url } });
  }
  
  return res;
}

async function loginIGMS() {
  try {
    console.log('[IGMS] === Login multi-paso v5.7.1 ===');
    
    let cookieJar = {};
    
    // ---- PASO 0: Visitar login.html para obtener cookies iniciales (como un navegador) ----
    console.log('[IGMS] Paso 0 - Visitando login.html...');
    await igmsRequest('GET', 'https://www.igms.com/app/login.html', cookieJar, {
      headers: { 'Accept': 'text/html,*/*' }
    });
    console.log('[IGMS] Paso 0 - Cookies: ' + Object.keys(cookieJar).join(', '));
    
    // ---- PASO 1: POST login ----
    console.log('[IGMS] Paso 1 - Login POST...');
    const loginRes = await igmsRequest('POST', 'https://www.igms.com/api/user-api/login', cookieJar, {
      data: { email: CONFIG.IGMS_EMAIL, password: CONFIG.IGMS_PASSWORD, platform: 'web' },
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://www.igms.com',
        'Referer': 'https://www.igms.com/app/login.html',
      },
    });
    
    const loginData = loginRes.data?.data?.data || loginRes.data?.data || loginRes.data || {};
    const loginErr = loginRes.data?.data?.err;
    const loginMsg = loginData.message;
    
    console.log('[IGMS] Paso 1 - Login: err=' + loginErr + ', msg=' + loginMsg);
    console.log('[IGMS] Paso 1 - Cookies: ' + Object.keys(cookieJar).join(', '));
    
    if (loginErr !== false && loginMsg !== 'ok') {
      console.error('[IGMS] Login RECHAZADO:', JSON.stringify(loginData).substring(0, 200));
      sesion.loginOk = false;
      return false;
    }
    
    sesion.hash = loginData.hash || null;
    sesion.userUid = loginData.user_uid || null;
    sesion.redirectUrl = loginData.redirect_url || null;
    
    console.log('[IGMS] hash=' + (sesion.hash || 'null') + ', redirect_url=' + (sesion.redirectUrl || 'null'));
    
    // ---- PASO 2: Navegar a chat.html (redirect_url) — AQUÍ se genera PHPSESSID ----
    if (sesion.redirectUrl) {
      console.log('[IGMS] Paso 2 - Navegando a chat.html...');
      const chatRes = await igmsRequest('GET', 'https://www.igms.com/app/' + sesion.redirectUrl, cookieJar, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Referer': 'https://www.igms.com/app/login.html',
        },
      });
      console.log('[IGMS] Paso 2 - Status: ' + chatRes.status + ', Cookies: ' + Object.keys(cookieJar).join(', '));
      
      // Buscar csrf_token en el HTML si no vino como cookie
      if (!cookieJar.csrf_token) {
        const html = (chatRes.data || '') + '';
        const csrfMatch = html.match(/csrf[_-]token['":\s]*['"]([^'"]+)['"]/i);
        if (csrfMatch) {
          cookieJar.csrf_token = csrfMatch[1];
          console.log('[IGMS] CSRF token extraído del HTML');
        }
      }
    }
    
    // ---- PASO 2b: Si aún no hay PHPSESSID, intentar navegar al index ----
    if (!cookieJar.PHPSESSID) {
      console.log('[IGMS] Paso 2b - No hay PHPSESSID aún, intentando /app/...');
      await igmsRequest('GET', 'https://www.igms.com/app/', cookieJar, {
        headers: { 'Accept': 'text/html,*/*', 'Referer': 'https://www.igms.com/app/login.html' },
      });
      console.log('[IGMS] Paso 2b - Cookies: ' + Object.keys(cookieJar).join(', '));
    }
    
    // ---- PASO 2c: Si aún no hay PHPSESSID, intentar / ----
    if (!cookieJar.PHPSESSID) {
      console.log('[IGMS] Paso 2c - Intentando / raíz...');
      await igmsRequest('GET', 'https://www.igms.com/', cookieJar, {
        headers: { 'Accept': 'text/html,*/*' },
      });
      console.log('[IGMS] Paso 2c - Cookies: ' + Object.keys(cookieJar).join(', '));
    }
    
    // ---- PASO 3: Construir cookie string final ----
    const hasPHP = !!cookieJar.PHPSESSID;
    const hasCSRF = !!cookieJar.csrf_token;
    console.log('[IGMS] Cookies finales: PHPSESSID=' + (hasPHP ? 'SI' : 'NO') + ', csrf_token=' + (hasCSRF ? 'SI' : 'NO') + ', total=' + Object.keys(cookieJar).length);
    
    sesion.cookies = formatCookies(cookieJar);
    sesion.expira = Date.now() + 22 * 60 * 60 * 1000;
    sesion.loginOk = true;
    
    // ---- PASO 4: Probar acceso a threads ----
    sesion.threadsOk = false;
    
    const testHeaders = {
      'Cookie': sesion.cookies,
      'User-Agent': UA,
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://www.igms.com/app/' + (sesion.redirectUrl || 'chat.html'),
      'X-Requested-With': 'XMLHttpRequest',
    };
    
    const stratA = await testThreadsAccess('A-all-cookies', testHeaders);
    if (stratA) { sesion.threadsOk = true; sesion._strategy = 'A-all-cookies'; }
    
    // Si falla, probar con hash como header adicional
    if (!sesion.threadsOk && sesion.hash) {
      const stratB = await testThreadsAccess('B-hash', {
        ...testHeaders,
        'X-Auth-Hash': sesion.hash,
      });
      if (stratB) { sesion.threadsOk = true; sesion._strategy = 'B-hash'; }
    }
    
    if (sesion.threadsOk) {
      console.log('[IGMS] ✅ Threads accesibles con estrategia: ' + sesion._strategy);
    } else {
      console.log('[IGMS] ⚠️ Threads NO accesibles — WebSocket será el canal principal');
      console.log('[IGMS] Cookies enviadas: ' + sesion.cookies.substring(0, 200));
    }
    
    return true;
  } catch(e) {
    console.error('[IGMS] Login error:', e.message);
    sesion.loginOk = false;
    return false;
  }
}

function formatCookies(jar) {
  return Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
}

async function testThreadsAccess(label, headers, extraQuery) {
  try {
    const url = 'https://www.igms.com/api/data/threads?filters[limit]=1&filters[cursor]=0&filters[initial_load]=1&filters[category]=all' + (extraQuery || '');
    const res = await axios.get(url, {
      headers,
      responseType: 'text',
      maxRedirects: 0,
      validateStatus: () => true,
    });
    const body = (res.data || '') + '';
    const esHtml = body.trim().startsWith('<');
    const esRedirect = res.status >= 300 && res.status < 400;
    const ok = !esHtml && !esRedirect && res.status === 200;
    console.log('[IGMS] Test ' + label + ': status=' + res.status + ', html=' + esHtml + ', redirect=' + esRedirect + ', ok=' + ok);
    if (ok) {
      // Verificar que hay datos parseables
      try {
        const parsed = JSON.parse(body);
        console.log('[IGMS] Test ' + label + ': JSON válido, keys=' + Object.keys(parsed).slice(0, 5).join(','));
        return true;
      } catch(e) {
        console.log('[IGMS] Test ' + label + ': no es JSON válido');
        return false;
      }
    }
    if (esRedirect) {
      console.log('[IGMS] Test ' + label + ': redirect a ' + (res.headers.location || 'desconocido'));
    }
    return false;
  } catch(e) {
    console.log('[IGMS] Test ' + label + ': error ' + e.message);
    return false;
  }
}

// Headers para requests API según la estrategia que funcionó
function getApiHeaders() {
  const h = {
    'Cookie': sesion.cookies || '',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://www.igms.com/app/' + (sesion.redirectUrl || 'chat.html'),
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (sesion._strategy === 'B-hash-header' && sesion.hash) {
    h['X-Auth-Hash'] = sesion.hash;
    h['Authorization'] = 'Bearer ' + sesion.hash;
  }
  if (sesion._strategy === 'D-uid-header' && sesion.userUid) {
    h['X-User-Uid'] = sesion.userUid;
  }
  return h;
}

function getThreadsUrl() {
  let url = 'https://www.igms.com/api/data/threads?filters[limit]=50&filters[cursor]=0&filters[initial_load]=1&filters[category]=all';
  if (sesion._strategy === 'C-hash-param' && sesion.hash) {
    url += '&hash=' + sesion.hash;
  }
  return url;
}

async function asegurarSesion() {
  if (!sesion.loginOk || Date.now() > sesion.expira) {
    return await loginIGMS();
  }
  return true;
}

// ===========================================================
// GENERAR RESPUESTA CON CLAUDE
// ===========================================================
async function generarRespuesta(mensaje, nombre, propiedad) {
  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: 'Huesped: ' + nombre + '\nPropiedad: ' + propiedad + '\nMensaje: "' + mensaje + '"' }]
    },
    { headers: { 'x-api-key': CONFIG.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' } }
  );
  return res.data.content[0].text;
}

// ===========================================================
// ENVIAR MENSAJE — usa los headers de la estrategia activa
// ===========================================================
async function enviarMensaje(threadId, mensaje) {
  try {
    const form = new FormData();
    form.append('thread_id', String(threadId));
    form.append('action_data[action_type]', 'platform-message');
    form.append('action_data[platform_type]', 'airbnb');
    form.append('action_data[message]', mensaje);
    
    const headers = getApiHeaders();
    // Merge form headers
    Object.assign(headers, form.getHeaders());
    
    const res = await axios.post(
      'https://www.igms.com/api/user-api/send-thread-action',
      form,
      { headers, maxRedirects: 0, validateStatus: () => true }
    );
    
    if (res.status === 200) {
      console.log('[IGMS] Mensaje enviado al thread ' + threadId);
      return true;
    }
    console.log('[IGMS] Envío mensaje status: ' + res.status);
    return false;
  } catch(e) {
    console.error('[IGMS] Error enviando mensaje:', e.message);
    return false;
  }
}

// ===========================================================
// WEBSOCKET — canal principal si REST no funciona
// ===========================================================
async function conectarSocket() {
  if (reconectando) return;
  reconectando = true;
  const ok = await asegurarSesion();
  if (!ok) { reconectando = false; return; }
  if (socket) { try { socket.disconnect(); } catch(e) {} socket = null; }
  
  socket = socketio('https://www.igms.com:8082', {
    transports: ['websocket', 'polling'],
    extraHeaders: {
      Cookie: sesion.cookies || '',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    reconnection: false,
  });
  
  socket.on('connect', () => {
    socketConectado = true; reconectando = false;
    console.log('[Socket] Conectado:', socket.id);
    socket.emit('identify', { clientId: CONFIG.IGMS_CLIENT_ID });
  });
  socket.on('disconnect', (reason) => {
    socketConectado = false;
    console.log('[Socket] Desconectado (' + reason + '), reconectando en 30s...');
    setTimeout(() => { reconectando = false; conectarSocket(); }, 30000);
  });
  socket.on('connect_error', (err) => {
    socketConectado = false; reconectando = false;
    console.log('[Socket] Error conexión: ' + err.message);
    setTimeout(() => conectarSocket(), 60000);
  });
  
  // Escuchar eventos conocidos de IGMS + variantes comunes
  const eventosIGMS = [
    'new_message', 'message', 'thread_update', 'new_thread',
    'reservation', 'notification', 'update', 'data', 'event',
    'inbox', 'chat', 'msg', 'new_reservation', 'booking',
  ];
  for (const evt of eventosIGMS) {
    socket.on(evt, async (data) => {
      console.log('[Socket] Evento "' + evt + '":', JSON.stringify(data).substring(0, 200));
      if (typeof data === 'object' && (data.thread_id || data.threadId || data.message || data.text)) {
        await procesarMensajeSocket(data);
      }
    });
  }
  
  // Capturar eventos no listados via el emit original (compatible con v2)
  const _origEmit = socket.emit.bind(socket);
  socket.emit = function(event, ...args) {
    if (!eventosIGMS.includes(event) && !['connect','disconnect','connect_error','reconnect'].includes(event)) {
      console.log('[Socket] Evento NO listado "' + event + '":', JSON.stringify(args[0]).substring(0, 150));
    }
    return _origEmit(event, ...args);
  };
}

// ===========================================================
// HELPER: extraer thread IDs
// ===========================================================
function extraerThreadIds(responseData) {
  if (Array.isArray(responseData)) {
    return responseData
      .map(item => item.thread_id || item.id || item)
      .filter(id => id && typeof id !== 'object')
      .slice(0, 50);
  }
  if (responseData && responseData.data && responseData.data.thread_ids) {
    return responseData.data.thread_ids;
  }
  if (responseData && typeof responseData === 'object') {
    const keys = Object.keys(responseData);
    const esArrayLike = keys.length > 0 && keys.every(k => /^\d+$/.test(k));
    if (esArrayLike) {
      const items = keys.sort((a,b) => parseInt(a) - parseInt(b)).map(k => responseData[k]);
      return items
        .map(item => item.thread_id || item.id || item)
        .filter(id => id && typeof id !== 'object')
        .slice(0, 50);
    }
    // Caso extra: { scopeData: { Thread: { data: { ... } } } }
    if (responseData.scopeData && responseData.scopeData.Thread && responseData.scopeData.Thread.data) {
      return Object.keys(responseData.scopeData.Thread.data).slice(0, 50);
    }
  }
  return [];
}

// ===========================================================
// POLLING cada 30 segundos — solo si REST funciona
// ===========================================================
async function polling() {
  if (!sesion.threadsOk) {
    // REST no funciona, depender del WebSocket
    return;
  }
  try {
    const ok = await asegurarSesion();
    if (!ok) { console.log('[Poll] Sin sesion IGMS'); return; }
    
    const res = await axios.get(getThreadsUrl(), {
      headers: getApiHeaders(),
      responseType: 'text',
      maxRedirects: 0,
      validateStatus: () => true,
    });
    
    let data = res.data;
    if (typeof data === 'string') {
      if (data.trim().startsWith('<')) {
        console.error('[Poll] IGMS devolvió HTML — marcando threads como no accesibles');
        sesion.threadsOk = false;
        return;
      }
      try { data = JSON.parse(data); } catch(e) {
        console.error('[Poll] Respuesta no es JSON:', data.substring(0, 100));
        return;
      }
    }
    
    const threadIds = extraerThreadIds(data);
    console.log('[Poll] ' + (threadIds.length > 0 ? threadIds.length + ' threads' : 'sin threads'));
    for (const threadId of threadIds.slice(0, 20)) {
      await procesarThread(threadId);
      await new Promise(r => setTimeout(r, 1500));
    }
  } catch(e) {
    console.error('[Poll] Error:', e.message);
    if (e.response && (e.response.status === 401 || e.response.status === 403)) {
      sesion.expira = 0;
      sesion.loginOk = false;
    }
  }
}

async function procesarThread(threadId) {
  try {
    const res = await axios.get(
      'https://www.igms.com/api/data/thread-page-data?params[thread_id]=' + threadId +
      '&params[platform_type]=airbnb&params[owner_user_id]=' + CONFIG.IGMS_CLIENT_ID,
      { headers: getApiHeaders() }
    );
    const scope = (res.data && res.data.scopeData) || {};
    const mensajes = scope.Message && scope.Message.data ? Object.values(scope.Message.data) : [];
    if (!mensajes.length) return;
    mensajes.sort((a, b) => (a.dttm || '').localeCompare(b.dttm || ''));
    const ultimo = mensajes[mensajes.length - 1];

    const msgId = ultimo.id;
    if (!msgId || respondidos.has(msgId)) return;
    const esHost = ultimo.sender_id === ultimo.host_id;
    const mensaje = ultimo.message_text || '';
    if (esHost || !mensaje || mensaje.length < 2) return;

    const reservas = (scope.Reservation && scope.Reservation.data) || {};
    const resKey = Object.keys(reservas)[0];
    const reserva = reservas[resKey] || {};
    const data = (res.data && res.data.data) || {};
    const propiedad = reserva.listing_name || data.listing_name || 'Propiedad SuperHost Loft';
    const nombre = reserva.guest_name || 'Huesped';

    console.log('[Poll] Msg de ' + nombre + ' [' + propiedad.substring(0, 25) + ']: "' + mensaje.substring(0, 60) + '"');
    respondidos.add(msgId);
    if (respondidos.size > 500) respondidos.delete(respondidos.values().next().value);

    const respuesta = await generarRespuesta(mensaje, nombre, propiedad);
    const enviado = await enviarMensaje(threadId, respuesta);
    if (enviado) console.log('[Poll] Respondido a ' + nombre);
  } catch(e) {
    console.error('[Poll] Error en thread:', e.message);
  }
}

async function procesarMensajeSocket(data) {
  const msgId = data.event_id || data.id || (data.thread_id + '_' + Date.now());
  if (respondidos.has(msgId)) return;
  const esHost = data.sent_by_host === true || data.sent_by_host === 1;
  const mensaje = data.message || data.text || data.body || '';
  const threadId = data.thread_id || data.threadId;
  if (!mensaje || !threadId || esHost) return;
  respondidos.add(msgId);
  if (respondidos.size > 500) respondidos.delete(respondidos.values().next().value);
  const nombre = data.guest_name || data.author || 'Huesped';
  const propiedad = data.listing_name || 'Propiedad SHL';
  const ok = await asegurarSesion();
  if (!ok) return;
  if ((data.event_type === 'reservation_confirmed' || data.reservation_status === 'accepted') && data.checkin_date) {
    await programarCheckin(threadId, nombre, propiedad, data.checkin_date);
  }
  const respuesta = await generarRespuesta(mensaje, nombre, propiedad);
  await enviarMensaje(threadId, respuesta);
}

// ===========================================================
// ARRANQUE
// ===========================================================
loginIGMS().then(() => {
  conectarSocket();
});

setInterval(polling, 30 * 1000);
setInterval(() => {
  loginIGMS().then(() => {
    // Reconectar socket con nuevas cookies
    if (socket) { try { socket.disconnect(); } catch(e) {} socket = null; }
    conectarSocket();
  });
}, 20 * 60 * 60 * 1000);

console.log('[SHL] Asistente v' + VERSION + ' - polling + websocket');

// Auto-ping para mantener activo en Render
setInterval(() => {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!url) return;
  try {
    require(url.startsWith('https') ? 'https' : 'http').get(url + '/health', r => {
      console.log('[ping]', new Date().toISOString().substring(11, 19), r.statusCode);
    }).on('error', () => {});
  } catch(e) {}
}, 4 * 60 * 1000);

// ===========================================================
// ENDPOINTS
// ===========================================================
app.post('/test', async (req, res) => {
  try {
    const { mensaje, nombre, propiedad } = req.body;
    const respuesta = await generarRespuesta(
      mensaje || 'A que hora es el check-in?',
      nombre || 'Huesped de prueba',
      propiedad || 'Loft 301 cerca aeropuerto'
    );
    res.json({ ok: true, respuesta });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/poll/force', async (req, res) => {
  console.log('[Poll] Forzado manualmente');
  // Forzar intentar polling aunque threadsOk sea false (para diagnostico)
  const prevState = sesion.threadsOk;
  sesion.threadsOk = true;
  polling().catch(console.error).finally(() => {
    sesion.threadsOk = prevState;
  });
  res.json({ ok: true, message: 'Polling forzado iniciado', threadsOk: prevState });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'Asistente activo',
    version: VERSION,
    login: sesion.loginOk ? 'ok' : 'sin sesion',
    threads_api: sesion.threadsOk ? 'ok (' + (sesion._strategy || '?') + ')' : 'no accesible',
    socket: socketConectado ? 'conectado' : 'desconectado',
    sesion_expira: sesion.expira ? new Date(sesion.expira).toISOString() : null,
    polling: sesion.threadsOk ? 'activo cada 30s' : 'desactivado (sin acceso threads)',
    websocket_mode: !sesion.threadsOk ? 'PRINCIPAL (REST no disponible)' : 'complementario',
    respondidos: respondidos.size,
    timestamp: new Date().toISOString(),
  });
});

// ===========================================================
// LOGIN DEBUG COMPLETO v5.7
// ===========================================================
app.get('/igms/login-debug', async (req, res) => {
  try {
    console.log('[Debug] Iniciando login debug completo...');
    
    // ---- Paso 1: Login ----
    const loginRes = await axios.post(
      'https://www.igms.com/api/user-api/login',
      { email: CONFIG.IGMS_EMAIL, password: CONFIG.IGMS_PASSWORD, platform: 'web' },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Origin': 'https://www.igms.com',
          'Referer': 'https://www.igms.com/app/login.html',
        },
        maxRedirects: 0,
        validateStatus: s => s < 400,
      }
    );
    
    const loginData = loginRes.data?.data?.data || loginRes.data?.data || {};
    const loginCookies = loginRes.headers['set-cookie'] || [];
    let cookieJar = {};
    for (const c of loginCookies) {
      const [nameVal] = c.split(';');
      const eqIdx = nameVal.indexOf('=');
      if (eqIdx > 0) cookieJar[nameVal.substring(0, eqIdx).trim()] = nameVal.substring(eqIdx + 1).trim();
    }
    
    // ---- Paso 2: Seguir redirect ----
    let paso2 = { status: 'no intentado', cookies_nuevas: 0 };
    const redirectUrl = loginData.redirect_url;
    if (redirectUrl) {
      try {
        const chatRes = await axios.get('https://www.igms.com/app/' + redirectUrl, {
          headers: {
            'Cookie': formatCookies(cookieJar),
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,*/*',
            'Referer': 'https://www.igms.com/app/login.html',
          },
          maxRedirects: 5,
          validateStatus: () => true,
        });
        const newCookies = chatRes.headers['set-cookie'] || [];
        for (const c of newCookies) {
          const [nameVal] = c.split(';');
          const eqIdx = nameVal.indexOf('=');
          if (eqIdx > 0) cookieJar[nameVal.substring(0, eqIdx).trim()] = nameVal.substring(eqIdx + 1).trim();
        }
        paso2 = {
          status: chatRes.status,
          url: 'https://www.igms.com/app/' + redirectUrl,
          cookies_nuevas: newCookies.length,
          cookies_nombres: newCookies.map(c => c.split('=')[0]).join(', '),
          html_largo: ((chatRes.data || '') + '').length,
        };
      } catch(e) {
        paso2 = { status: 'error', error: e.message };
      }
    }
    
    // ---- Paso 3: Probar todas las estrategias ----
    const allCookies = formatCookies(cookieJar);
    const hash = loginData.hash;
    const userUid = loginData.user_uid;
    
    const estrategias = {};
    
    // A: Solo cookies
    estrategias['A_solo_cookies'] = await testAndDescribe(
      'https://www.igms.com/api/data/threads?filters[limit]=1&filters[cursor]=0&filters[initial_load]=1&filters[category]=all',
      { 'Cookie': allCookies, 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://www.igms.com/app/chat.html' }
    );
    
    // B: Cookies + X-Auth-Hash + Authorization Bearer
    if (hash) {
      estrategias['B_hash_headers'] = await testAndDescribe(
        'https://www.igms.com/api/data/threads?filters[limit]=1&filters[cursor]=0&filters[initial_load]=1&filters[category]=all',
        { 'Cookie': allCookies, 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-Auth-Hash': hash, 'Authorization': 'Bearer ' + hash, 'Referer': 'https://www.igms.com/app/chat.html' }
      );
    }
    
    // C: Hash como query param
    if (hash) {
      estrategias['C_hash_query'] = await testAndDescribe(
        'https://www.igms.com/api/data/threads?filters[limit]=1&filters[cursor]=0&filters[initial_load]=1&filters[category]=all&hash=' + hash,
        { 'Cookie': allCookies, 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://www.igms.com/app/chat.html' }
      );
    }
    
    // D: user_uid header
    if (userUid) {
      estrategias['D_uid_header'] = await testAndDescribe(
        'https://www.igms.com/api/data/threads?filters[limit]=1&filters[cursor]=0&filters[initial_load]=1&filters[category]=all',
        { 'Cookie': allCookies, 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-User-Uid': userUid, 'Referer': 'https://www.igms.com/app/chat.html' }
      );
    }
    
    // E: Sin cookies, solo hash como Bearer
    if (hash) {
      estrategias['E_solo_bearer'] = await testAndDescribe(
        'https://www.igms.com/api/data/threads?filters[limit]=1&filters[cursor]=0&filters[initial_load]=1&filters[category]=all',
        { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Authorization': 'Bearer ' + hash }
      );
    }
    
    // F: Probar thread-page-data directamente (puede tener auth diferente)
    estrategias['F_thread_page_direct'] = await testAndDescribe(
      'https://www.igms.com/api/data/thread-page-data?params[thread_id]=1&params[platform_type]=airbnb&params[owner_user_id]=' + CONFIG.IGMS_CLIENT_ID,
      { 'Cookie': allCookies, 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://www.igms.com/app/chat.html' }
    );
    
    // G: send-thread-action (test auth de envío)
    estrategias['G_send_action_auth'] = await testAndDescribe(
      'https://www.igms.com/api/user-api/send-thread-action',
      { 'Cookie': allCookies, 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://www.igms.com/app/chat.html' },
      'POST'
    );
    
    res.json({
      ok: true,
      version: VERSION,
      paso1_login: {
        status: loginRes.status,
        err: loginRes.data?.data?.err,
        message: loginData.message,
        hash: hash ? hash.substring(0, 12) + '...' : null,
        user_uid: userUid ? userUid.substring(0, 10) + '...' : null,
        redirect_url: redirectUrl,
        cookies_recibidas: Object.keys(cookieJar).join(', '),
      },
      paso2_redirect: paso2,
      cookies_totales: {
        nombres: Object.keys(cookieJar).join(', '),
        string_preview: allCookies.substring(0, 200),
      },
      paso3_estrategias: estrategias,
      recomendacion: Object.entries(estrategias).find(([k, v]) => v.ok)?.[0] || 'NINGUNA FUNCIONO — necesitamos capturar headers del navegador real',
    });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message, stack: e.stack?.substring(0, 300) });
  }
});

async function testAndDescribe(url, headers, method) {
  try {
    const config = {
      headers,
      responseType: 'text',
      maxRedirects: 0,
      validateStatus: () => true,
    };
    const res = method === 'POST'
      ? await axios.post(url, {}, config)
      : await axios.get(url, config);
    
    const body = (res.data || '') + '';
    const esHtml = body.trim().startsWith('<');
    const esRedirect = res.status >= 300 && res.status < 400;
    const ok = !esHtml && !esRedirect && res.status >= 200 && res.status < 300;
    
    return {
      ok,
      status: res.status,
      es_html: esHtml,
      es_redirect: esRedirect,
      redirect_to: esRedirect ? res.headers.location : undefined,
      preview: body.substring(0, 200),
      content_type: res.headers['content-type'],
      nuevas_cookies: (res.headers['set-cookie'] || []).map(c => c.split('=')[0]).join(', ') || 'ninguna',
    };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ===========================================================
// RAW IGMS: diagnostico crudo
// ===========================================================
app.get('/igms/raw', async (req, res) => {
  try {
    const ok = await asegurarSesion();
    if (!ok) return res.json({ ok: false, error: 'Sin sesion IGMS - login fallo' });

    const threadsRes = await axios.get(getThreadsUrl(), {
      headers: getApiHeaders(),
      responseType: 'text',
      maxRedirects: 0,
      validateStatus: () => true,
    });

    const rawText = (threadsRes.data || '') + '';
    const esHtml = rawText.trim().startsWith('<');
    const esRedirect = threadsRes.status >= 300 && threadsRes.status < 400;
    
    if (esHtml || esRedirect) {
      return res.json({
        ok: false,
        version: VERSION,
        status: threadsRes.status,
        strategy: sesion._strategy || 'ninguna',
        error: 'IGMS no autoriza — devuelve HTML/redirect',
        redirect_to: threadsRes.headers.location || null,
        html_preview: rawText.substring(0, 300),
        cookies_enviadas: (sesion.cookies || '').substring(0, 100),
        solucion: 'Usar /igms/login-debug para ver todas las estrategias. Si ninguna funciona, necesitamos capturar los headers del navegador real con Chrome DevTools.',
      });
    }

    let data;
    try { data = JSON.parse(rawText); } catch(e) {
      return res.json({ ok: false, error: 'Respuesta no es JSON', preview: rawText.substring(0, 300) });
    }

    const threadIds = extraerThreadIds(data);
    
    res.json({
      ok: true,
      version: VERSION,
      strategy: sesion._strategy,
      total_keys: Object.keys(data).length,
      thread_ids: threadIds.length,
      thread_ids_muestra: threadIds.slice(0, 5),
      data_preview: JSON.stringify(data).substring(0, 500),
    });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===========================================================
// CAPTURE HELPER: endpoint para inyectar cookies del navegador
// POST /igms/inject-cookies  { cookies: "PHPSESSID=xxx; wsb-user-uid=yyy; otro=zzz" }
// ===========================================================
app.post('/igms/inject-cookies', async (req, res) => {
  try {
    const { cookies } = req.body;
    if (!cookies || typeof cookies !== 'string') {
      return res.json({ ok: false, error: 'Enviar { cookies: "PHPSESSID=xxx; wsb-user-uid=yyy" }' });
    }
    
    console.log('[IGMS] Inyectando cookies del navegador: ' + cookies.substring(0, 100));
    
    // Guardar las cookies inyectadas
    sesion.cookies = cookies;
    sesion.loginOk = true;
    sesion.expira = Date.now() + 22 * 60 * 60 * 1000;
    sesion._strategy = 'INYECTADA';
    
    // Probar acceso con las cookies inyectadas
    const testResult = await testAndDescribe(
      'https://www.igms.com/api/data/threads?filters[limit]=1&filters[cursor]=0&filters[initial_load]=1&filters[category]=all',
      {
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://www.igms.com/app/chat.html',
      }
    );
    
    sesion.threadsOk = testResult.ok;
    
    res.json({
      ok: true,
      cookies_inyectadas: cookies.substring(0, 100) + '...',
      test_threads: testResult,
      threads_ok: sesion.threadsOk,
      mensaje: sesion.threadsOk
        ? '✅ Cookies funcionan! El polling usará estas cookies.'
        : '❌ Cookies no autorizan threads. Verifica que copiaste TODAS las cookies del navegador.',
    });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===========================================================
// DEBUG: ver estado de threads sin enviar nada (dry-run)
// ===========================================================
app.get('/poll/debug', async (req, res) => {
  try {
    if (!sesion.threadsOk && sesion._strategy !== 'INYECTADA') {
      return res.json({
        ok: false,
        version: VERSION,
        error: 'REST API de threads no accesible. Opciones: 1) /igms/login-debug para ver estrategias. 2) /igms/inject-cookies para inyectar cookies del navegador.',
        socket: socketConectado ? 'conectado (canal principal)' : 'desconectado',
      });
    }
    
    const limite = Math.min(parseInt(req.query.limit) || 5, 20);
    
    const threadsRes = await axios.get(getThreadsUrl(), {
      headers: getApiHeaders(),
      responseType: 'text',
      maxRedirects: 0,
      validateStatus: () => true,
    });
    
    let data = threadsRes.data;
    if (typeof data === 'string') {
      if (data.trim().startsWith('<')) return res.json({ ok: false, error: 'HTML recibido — sesion inválida' });
      try { data = JSON.parse(data); } catch(e) { return res.json({ ok: false, error: 'No JSON' }); }
    }
    
    const threadIds = extraerThreadIds(data);
    const resultados = [];
    
    for (const threadId of threadIds.slice(0, limite)) {
      try {
        const tRes = await axios.get(
          'https://www.igms.com/api/data/thread-page-data?params[thread_id]=' + threadId +
          '&params[platform_type]=airbnb&params[owner_user_id]=' + CONFIG.IGMS_CLIENT_ID,
          { headers: getApiHeaders() }
        );
        const scope = (tRes.data && tRes.data.scopeData) || {};
        const mensajes = scope.Message && scope.Message.data ? Object.values(scope.Message.data) : [];
        mensajes.sort((a, b) => (a.dttm || '').localeCompare(b.dttm || ''));
        const ultimo = mensajes.length ? mensajes[mensajes.length - 1] : null;
        const reservas = (scope.Reservation && scope.Reservation.data) || {};
        const resKey = Object.keys(reservas)[0];
        const reserva = reservas[resKey] || {};
        const tData = (tRes.data && tRes.data.data) || {};

        resultados.push({
          thread_id: threadId,
          propiedad: (reserva.listing_name || tData.listing_name || '???').substring(0, 50),
          huesped: reserva.guest_name || '???',
          total_mensajes: mensajes.length,
          ultimo_mensaje: ultimo ? {
            id: ultimo.id,
            texto: (ultimo.message_text || '').substring(0, 120),
            es_host: ultimo.sender_id === ultimo.host_id,
            fecha: ultimo.dttm,
            ya_respondido: respondidos.has(ultimo.id),
          } : null,
          reserva: resKey ? {
            checkin: reserva.checkin_date || null,
            checkout: reserva.checkout_date || null,
            huespedes: reserva.number_of_guests || null,
            status: reserva.status || null,
          } : null,
        });
        await new Promise(r => setTimeout(r, 500));
      } catch(e) {
        resultados.push({ thread_id: threadId, error: e.message });
      }
    }

    res.json({
      ok: true,
      version: VERSION,
      strategy: sesion._strategy,
      total_threads: threadIds.length,
      analizados: resultados.length,
      threads: resultados,
      nota: 'DRY-RUN: no se envió nada.'
    });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===========================================================
// TEST-SEND
// ===========================================================
app.post('/poll/test-send', async (req, res) => {
  try {
    const { thread_id, dry_run } = req.body;
    if (!thread_id) return res.json({ ok: false, error: 'Falta thread_id' });
    const isDryRun = dry_run !== false;
    const ok = await asegurarSesion();
    if (!ok) return res.json({ ok: false, error: 'Sin sesion IGMS' });

    const tRes = await axios.get(
      'https://www.igms.com/api/data/thread-page-data?params[thread_id]=' + thread_id +
      '&params[platform_type]=airbnb&params[owner_user_id]=' + CONFIG.IGMS_CLIENT_ID,
      { headers: getApiHeaders() }
    );
    const scope = (tRes.data && tRes.data.scopeData) || {};
    const mensajes = scope.Message && scope.Message.data ? Object.values(scope.Message.data) : [];
    mensajes.sort((a, b) => (a.dttm || '').localeCompare(b.dttm || ''));
    const ultimos5 = mensajes.slice(-5);
    const ultimo = mensajes.length ? mensajes[mensajes.length - 1] : null;
    if (!ultimo) return res.json({ ok: false, error: 'Thread sin mensajes' });

    const reservas = (scope.Reservation && scope.Reservation.data) || {};
    const resKey = Object.keys(reservas)[0];
    const reserva = reservas[resKey] || {};
    const data = (tRes.data && tRes.data.data) || {};
    const propiedad = reserva.listing_name || data.listing_name || 'Propiedad SHL';
    const nombre = reserva.guest_name || 'Huesped';
    const esHost = ultimo.sender_id === ultimo.host_id;
    const mensajeHuesped = ultimo.message_text || '';

    const respuesta = await generarRespuesta(mensajeHuesped, nombre, propiedad);

    let enviado = false;
    if (!isDryRun && !esHost) {
      enviado = await enviarMensaje(thread_id, respuesta);
      if (enviado) respondidos.add(ultimo.id);
    }

    res.json({
      ok: true,
      dry_run: isDryRun,
      thread_id,
      propiedad,
      huesped: nombre,
      ultimo_mensaje: {
        texto: mensajeHuesped.substring(0, 200),
        es_host: esHost,
        fecha: ultimo.dttm,
      },
      historial_reciente: ultimos5.map(m => ({
        quien: m.sender_id === m.host_id ? 'Host' : 'Huesped',
        texto: (m.message_text || '').substring(0, 150),
        fecha: m.dttm,
      })),
      respuesta_generada: respuesta,
      enviado: isDryRun ? 'NO (dry_run)' : (enviado ? 'SI' : 'FALLO'),
      reserva: resKey ? {
        checkin: reserva.checkin_date || null,
        checkout: reserva.checkout_date || null,
        huespedes: reserva.number_of_guests || null,
      } : null,
    });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===========================================================
// SOCKET DEBUG: ver estado del WebSocket
// ===========================================================
app.get('/socket/debug', (req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    conectado: socketConectado,
    socket_id: socket?.id || null,
    reconectando,
    sesion_login: sesion.loginOk,
    threads_rest: sesion.threadsOk,
    modo: sesion.threadsOk ? 'REST + WebSocket' : 'Solo WebSocket',
    nota: 'Si REST no funciona, el WebSocket es el único canal para recibir mensajes. Los eventos aparecen en los logs del servidor.',
  });
});

app.listen(CONFIG.PORT, () => {
  console.log('[SHL] Asistente v' + VERSION + ' - Puerto ' + CONFIG.PORT);
});
