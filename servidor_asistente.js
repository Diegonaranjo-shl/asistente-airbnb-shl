// ASISTENTE IA AIRBNB - SUPERHOST LOFT
// servidor_asistente.js v5.4
// + endpoint /poll/debug para diagnostico dry-run
// + endpoint /poll/test-send para probar envio real con un thread especifico

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

const VERSION = '5.6.1';

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
// SESION IGMS
// ===========================================================
let sesion = { phpsessid: null, allCookies: null, expira: 0 };
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

async function programarCheckin(threadId, nombre, propiedad, fechaCheckin, phpsessid) {
  const hoy = new Date().toDateString();
  const llegada = new Date(fechaCheckin).toDateString();
  if (hoy === llegada) {
    const msg = await generarMensajeCheckin(nombre, propiedad);
    if (msg) {
      await enviarMensaje(threadId, msg, phpsessid);
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
      const phpsessid = await getSesion();
      if (phpsessid) {
        const msg = await generarMensajeCheckin(r.nombre, r.propiedad);
        if (msg) {
          await enviarMensaje(threadId, msg, phpsessid);
          console.log('[Checkin auto] ' + r.nombre);
          delete reservasPendientes[threadId];
        }
      }
    }
  }
}, 60 * 60 * 1000);

// ===========================================================
// LOGIN IGMS
// ===========================================================
async function loginIGMS() {
  try {
    console.log('[IGMS] Renovando sesion...');
    const res = await axios.post(
      'https://www.igms.com/api/user-api/login',
      { email: CONFIG.IGMS_EMAIL, password: CONFIG.IGMS_PASSWORD, platform: 'web' },
      { headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, maxRedirects: 5 }
    );
    
    // Verificar que el login fue exitoso
    const loginErr = res.data && res.data.data && res.data.data.err;
    const loginMsg = res.data && res.data.data && res.data.data.data && res.data.data.data.message;
    console.log('[IGMS] Login response: err=' + loginErr + ', msg=' + loginMsg);
    
    if (loginErr !== false) {
      console.error('[IGMS] Login RECHAZADO:', loginMsg || 'error desconocido');
      return false;
    }
    
    // Capturar TODAS las cookies
    const cookies = res.headers['set-cookie'] || [];
    const allCookies = cookies.map(c => c.split(';')[0]).join('; ');
    console.log('[IGMS] Cookies recibidas (' + cookies.length + '):', allCookies.substring(0, 150));
    
    if (!allCookies) {
      console.error('[IGMS] No se recibieron cookies');
      return false;
    }
    
    // Guardar todas las cookies (IGMS puede usar PHPSESSID o wsb-user-uid)
    sesion.allCookies = allCookies;
    sesion.expira = Date.now() + 22 * 60 * 60 * 1000;
    
    // Extraer PHPSESSID si existe (compatibilidad)
    const phpMatch = allCookies.match(/PHPSESSID=([^;]+)/);
    sesion.phpsessid = phpMatch ? phpMatch[1] : 'using-wsb-cookie';
    
    // Validar que la sesion funciona
    try {
      const testRes = await axios.get(
        'https://www.igms.com/api/data/threads?filters[limit]=1&filters[cursor]=0&filters[initial_load]=1&filters[category]=all',
        { headers: { Cookie: allCookies, 'User-Agent': 'Mozilla/5.0' }, responseType: 'text', maxRedirects: 0, validateStatus: () => true }
      );
      const testData = (testRes.data || '') + '';
      const esHtml = testData.trim().startsWith('<');
      const esRedirect = testRes.status >= 300 && testRes.status < 400;
      console.log('[IGMS] Validacion: status=' + testRes.status + ', esHtml=' + esHtml + ', largo=' + testData.length);
      if (esHtml || esRedirect) {
        console.error('[IGMS] Sesion NO valida - API devuelve HTML o redirect');
        // No invalidar la sesion — puede que la cookie funcione para otros endpoints
        // En lugar de fallar, seguir con la sesion y dejar que el polling maneje el error
        console.log('[IGMS] Manteniendo sesion de todas formas (wsb-user-uid)');
      } else {
        console.log('[IGMS] Sesion VALIDADA OK - API devuelve JSON');
      }
    } catch(e) {
      console.log('[IGMS] Error en validacion (continuando de todas formas):', e.message);
    }
    
    return true;
  } catch(e) {
    console.error('[IGMS] Login error:', e.message);
    return false;
  }
}

async function getSesion() {
  if (!sesion.phpsessid || Date.now() > sesion.expira) await loginIGMS();
  return sesion.phpsessid;
}

function getCookieHeader() {
  // Usar todas las cookies si estan disponibles, sino solo PHPSESSID
  if (sesion.allCookies) return sesion.allCookies;
  if (sesion.phpsessid) return 'PHPSESSID=' + sesion.phpsessid;
  return '';
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
// ENVIAR MENSAJE
// ===========================================================
async function enviarMensaje(threadId, mensaje, phpsessid) {
  try {
    const form = new FormData();
    form.append('thread_id', String(threadId));
    form.append('action_data[action_type]', 'platform-message');
    form.append('action_data[platform_type]', 'airbnb');
    form.append('action_data[message]', mensaje);
    const res = await axios.post(
      'https://www.igms.com/api/user-api/send-thread-action',
      form,
      { headers: { ...form.getHeaders(), Cookie: getCookieHeader(), 'User-Agent': 'Mozilla/5.0' } }
    );
    if (res.status === 200) {
      console.log('[IGMS] Mensaje enviado al thread ' + threadId);
      return true;
    }
    return false;
  } catch(e) {
    console.error('[IGMS] Error enviando mensaje:', e.message);
    return false;
  }
}

// ===========================================================
// WEBSOCKET
// ===========================================================
async function conectarSocket() {
  if (reconectando) return;
  reconectando = true;
  const phpsessid = await getSesion();
  if (!phpsessid) { reconectando = false; return; }
  if (socket) { try { socket.disconnect(); } catch(e) {} socket = null; }
  socket = socketio('https://www.igms.com:8082', {
    transports: ['websocket', 'polling'],
    extraHeaders: { Cookie: getCookieHeader() },
    reconnection: false,
  });
  socket.on('connect', () => {
    socketConectado = true; reconectando = false;
    console.log('[Socket] Conectado:', socket.id);
    socket.emit('identify', { clientId: CONFIG.IGMS_CLIENT_ID });
  });
  socket.on('disconnect', () => {
    socketConectado = false;
    console.log('[Socket] Desconectado, reconectando en 30s...');
    setTimeout(() => { reconectando = false; conectarSocket(); }, 30000);
  });
  socket.on('connect_error', () => {
    socketConectado = false; reconectando = false;
    setTimeout(() => conectarSocket(), 60000);
  });
  socket.on('new_message', async (data) => {
    console.log('[Socket] Nuevo msg:', JSON.stringify(data).substring(0, 100));
    await procesarMensajeSocket(data);
  });
}

// ===========================================================
// HELPER: extraer thread IDs de la respuesta de IGMS
// IGMS puede devolver: array directo, { data: { thread_ids } }, u objeto indexado
// ===========================================================
function extraerThreadIds(responseData) {
  // Caso 1: respuesta es un array directo de objetos con thread_id
  if (Array.isArray(responseData)) {
    return responseData
      .map(item => item.thread_id || item.id || item)
      .filter(id => id && typeof id !== 'object')
      .slice(0, 50);
  }
  // Caso 2: { data: { thread_ids: [...] } } (formato original documentado)
  if (responseData && responseData.data && responseData.data.thread_ids) {
    return responseData.data.thread_ids;
  }
  // Caso 3: objeto con keys numericas (array-like) — ej: {"0": {...}, "1": {...}, ...}
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
  }
  return [];
}

// ===========================================================
// POLLING cada 30 segundos
// ===========================================================
async function polling() {
  try {
    const phpsessid = await getSesion();
    if (!phpsessid) { console.log('[Poll] Sin sesion IGMS'); return; }
    const res = await axios.get(
      'https://www.igms.com/api/data/threads?filters[limit]=50&filters[cursor]=0&filters[initial_load]=1&filters[category]=all',
      { headers: { Cookie: getCookieHeader(), 'User-Agent': 'Mozilla/5.0' }, responseType: 'text', maxRedirects: 0, validateStatus: () => true }
    );
    
    // Detectar si IGMS devolvio HTML (sesion invalida)
    let data = res.data;
    if (typeof data === 'string') {
      if (data.trim().startsWith('<')) {
        console.error('[Poll] IGMS devolvio HTML - sesion invalida, forzando re-login');
        sesion.expira = 0;
        sesion.phpsessid = null;
        return;
      }
      try { data = JSON.parse(data); } catch(e) {
        console.error('[Poll] Respuesta no es JSON:', data.substring(0, 100));
        return;
      }
    }
    
    const threadIds = extraerThreadIds(data);
    console.log('[Poll] ' + (threadIds.length > 0 ? threadIds.length + ' threads encontrados' : 'sin mensajes nuevos'));
    for (const threadId of threadIds.slice(0, 20)) {
      await procesarThread(threadId, phpsessid);
      await new Promise(r => setTimeout(r, 1500));
    }
  } catch(e) {
    console.error('[Poll] Error:', e.message);
    if (e.response && (e.response.status === 401 || e.response.status === 403)) sesion.expira = 0;
  }
}

async function procesarThread(threadId, phpsessid) {
  try {
    const res = await axios.get(
      'https://www.igms.com/api/data/thread-page-data?params[thread_id]=' + threadId + '&params[platform_type]=airbnb&params[owner_user_id]=' + CONFIG.IGMS_CLIENT_ID,
      { headers: { Cookie: getCookieHeader(), 'User-Agent': 'Mozilla/5.0' } }
    );
    const scope = (res.data && res.data.scopeData) || {};

    // Los mensajes estan en scope.Message.data — ordenados por dttm
    const mensajes = scope.Message && scope.Message.data ? Object.values(scope.Message.data) : [];
    if (!mensajes.length) return;
    mensajes.sort((a, b) => (a.dttm || '').localeCompare(b.dttm || ''));
    const ultimo = mensajes[mensajes.length - 1];

    // Detectar si es del huesped: sender_id != host_id
    const msgId = ultimo.id;
    if (!msgId || respondidos.has(msgId)) return;
    const esHost = ultimo.sender_id === ultimo.host_id;
    const mensaje = ultimo.message_text || '';
    if (esHost || !mensaje || mensaje.length < 2) return;

    // Datos de la reserva
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
    const enviado = await enviarMensaje(threadId, respuesta, phpsessid);
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
  const phpsessid = await getSesion();
  if (!phpsessid) return;
  if ((data.event_type === 'reservation_confirmed' || data.reservation_status === 'accepted') && data.checkin_date) {
    await programarCheckin(threadId, nombre, propiedad, data.checkin_date, phpsessid);
  }
  const respuesta = await generarRespuesta(mensaje, nombre, propiedad);
  await enviarMensaje(threadId, respuesta, phpsessid);
}

// ===========================================================
// ARRANQUE — setInterval FUERA del bloque async
// ===========================================================
loginIGMS().then(() => {
  conectarSocket();
});

// Polling cada 30 segundos — FUERA del bloque async para garantizar ejecucion
setInterval(polling, 30 * 1000);

// Renovar login cada 20 horas
setInterval(loginIGMS, 20 * 60 * 60 * 1000);

console.log('[SHL] Asistente v' + VERSION + ' - polling iniciado cada 30s');

// Auto-ping para mantener activo en Render free tier
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
  polling().catch(console.error);
  res.json({ ok: true, message: 'Polling iniciado' });
});

app.get('/health', (req, res) => {
  res.json({
    status     : 'Asistente activo',
    version    : VERSION,
    socket     : socketConectado ? 'conectado' : 'reconectando',
    sesion     : sesion.phpsessid ? 'activa' : 'sin sesion',
    sesion_expira: sesion.expira ? new Date(sesion.expira).toISOString() : null,
    polling    : 'activo cada 30s',
    respondidos: respondidos.size,
    timestamp  : new Date().toISOString()
  });
});

// ===========================================================
// LOGIN DEBUG: ver exactamente que devuelve el login de IGMS
// ===========================================================
app.get('/igms/login-debug', async (req, res) => {
  try {
    const loginRes = await axios.post(
      'https://www.igms.com/api/user-api/login',
      { email: CONFIG.IGMS_EMAIL, password: CONFIG.IGMS_PASSWORD, platform: 'web' },
      { headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, maxRedirects: 5 }
    );
    
    const cookies = loginRes.headers['set-cookie'] || [];
    const allCookies = cookies.map(c => c.split(';')[0]).join('; ');
    const phpMatch = allCookies.match(/PHPSESSID=([^;]+)/);
    const phpsessid = phpMatch ? phpMatch[1] : null;
    
    // Test con PHPSESSID
    let testResult = 'no phpsessid';
    let testPreview = null;
    if (phpsessid) {
      try {
        const testRes = await axios.get(
          'https://www.igms.com/api/data/threads?filters[limit]=1&filters[cursor]=0&filters[initial_load]=1&filters[category]=all',
          { headers: { Cookie: 'PHPSESSID=' + phpsessid, 'User-Agent': 'Mozilla/5.0' }, responseType: 'text', maxRedirects: 0, validateStatus: () => true }
        );
        const isHtml = typeof testRes.data === 'string' && testRes.data.trim().startsWith('<');
        testResult = isHtml ? 'FALLO_HTML' : 'OK_JSON';
        testPreview = (testRes.data + '').substring(0, 150);
      } catch(e) {
        testResult = 'ERROR: ' + e.message;
      }
    }
    
    // Test con ALL cookies
    let testResult2 = 'no cookies';
    if (allCookies) {
      try {
        const testRes2 = await axios.get(
          'https://www.igms.com/api/data/threads?filters[limit]=1&filters[cursor]=0&filters[initial_load]=1&filters[category]=all',
          { headers: { Cookie: allCookies, 'User-Agent': 'Mozilla/5.0' }, responseType: 'text', maxRedirects: 0, validateStatus: () => true }
        );
        const isHtml2 = typeof testRes2.data === 'string' && testRes2.data.trim().startsWith('<');
        testResult2 = isHtml2 ? 'FALLO_HTML' : 'OK_JSON';
      } catch(e) {
        testResult2 = 'ERROR: ' + e.message;
      }
    }
    
    res.json({
      ok: true,
      version: VERSION,
      login_status: loginRes.status,
      login_response_keys: Object.keys(loginRes.data || {}),
      login_data_keys: loginRes.data && loginRes.data.data ? Object.keys(loginRes.data.data).slice(0, 20) : null,
      login_data_preview: loginRes.data && loginRes.data.data ? JSON.stringify(loginRes.data.data).substring(0, 500) : null,
      login_scopeData_keys: loginRes.data && loginRes.data.scopeData ? Object.keys(loginRes.data.scopeData).slice(0, 20) : null,
      login_status_field: loginRes.data ? loginRes.data.status : null,
      login_version: loginRes.data ? loginRes.data.version : null,
      cookies_count: cookies.length,
      cookies_raw: cookies.map(c => c.substring(0, 100)),
      all_cookies_string: allCookies.substring(0, 200),
      phpsessid: phpsessid ? phpsessid.substring(0, 10) + '...' : null,
      test_solo_phpsessid: testResult,
      test_todas_cookies: testResult2,
      test_preview: testPreview,
    });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===========================================================
// RAW IGMS: diagnostico crudo de la API de IGMS
// GET /igms/raw — muestra exactamente que devuelve IGMS
// ===========================================================
app.get('/igms/raw', async (req, res) => {
  try {
    const phpsessid = await getSesion();
    if (!phpsessid) return res.json({ ok: false, error: 'Sin sesion IGMS - login fallo' });

    const url = 'https://www.igms.com/api/data/threads?filters[limit]=50&filters[cursor]=0&filters[initial_load]=1&filters[category]=all';
    const threadsRes = await axios.get(url, {
      headers: { Cookie: getCookieHeader(), 'User-Agent': 'Mozilla/5.0' },
      responseType: 'text'
    });

    const rawText = threadsRes.data;
    const esHtml = typeof rawText === 'string' && rawText.trim().startsWith('<');
    
    if (esHtml) {
      // Sesion invalida - IGMS redirige al login
      return res.json({
        ok: false,
        version: VERSION,
        error: 'IGMS devolvio HTML en vez de JSON - la sesion PHPSESSID no es valida',
        html_preview: rawText.substring(0, 300),
        phpsessid_preview: phpsessid.substring(0, 8) + '...',
        solucion: 'El login obtiene un PHPSESSID pero IGMS no lo acepta para la API de datos. Revisar credenciales o si IGMS requiere algo adicional (2FA, captcha, etc).',
      });
    }

    // Parsear JSON
    let data;
    try { data = JSON.parse(rawText); } catch(e) {
      return res.json({ ok: false, error: 'Respuesta no es JSON ni HTML', preview: rawText.substring(0, 300) });
    }

    const keys = data ? Object.keys(data) : [];
    const muestra = [];
    for (let i = 0; i < Math.min(3, keys.length); i++) {
      const item = data[keys[i]];
      muestra.push({
        key: keys[i],
        type: typeof item,
        keys_del_item: typeof item === 'object' && item ? Object.keys(item).slice(0, 15) : null,
        preview: JSON.stringify(item).substring(0, 300),
      });
    }

    const threadIds = extraerThreadIds(data);

    let ejemploThread = null;
    if (threadIds.length > 0) {
      try {
        const tRes = await axios.get(
          'https://www.igms.com/api/data/thread-page-data?params[thread_id]=' + threadIds[0] +
          '&params[platform_type]=airbnb&params[owner_user_id]=' + CONFIG.IGMS_CLIENT_ID,
          { headers: { Cookie: getCookieHeader(), 'User-Agent': 'Mozilla/5.0' } }
        );
        const scope = (tRes.data && tRes.data.scopeData) || {};
        ejemploThread = {
          thread_id: threadIds[0],
          scopeData_keys: Object.keys(scope),
          tiene_Message: !!scope.Message,
          Message_data_count: scope.Message && scope.Message.data ? Object.keys(scope.Message.data).length : 0,
        };
      } catch(e) {
        ejemploThread = { error: e.message };
      }
    }

    res.json({
      ok: true,
      version: VERSION,
      sesion_activa: true,
      response_total_keys: keys.length,
      muestra_items_crudos: muestra,
      thread_ids_extraidos: threadIds.length,
      thread_ids_muestra: threadIds.slice(0, 5),
      ejemplo_thread: ejemploThread,
    });
  } catch(e) {
    res.status(500).json({
      ok: false, error: e.message,
      status: e.response ? e.response.status : null,
    });
  }
});

// ===========================================================
// DEBUG: ver estado de threads sin enviar nada (dry-run)
// GET /poll/debug?limit=5
// ===========================================================
app.get('/poll/debug', async (req, res) => {
  try {
    const limite = Math.min(parseInt(req.query.limit) || 5, 20);
    const phpsessid = await getSesion();
    if (!phpsessid) return res.json({ ok: false, error: 'Sin sesion IGMS' });

    const threadsRes = await axios.get(
      'https://www.igms.com/api/data/threads?filters[limit]=50&filters[cursor]=0&filters[initial_load]=1&filters[category]=all',
      { headers: { Cookie: getCookieHeader(), 'User-Agent': 'Mozilla/5.0' } }
    );
    const threadIds = extraerThreadIds(threadsRes.data);

    const resultados = [];
    for (const threadId of threadIds.slice(0, limite)) {
      try {
        const tRes = await axios.get(
          'https://www.igms.com/api/data/thread-page-data?params[thread_id]=' + threadId +
          '&params[platform_type]=airbnb&params[owner_user_id]=' + CONFIG.IGMS_CLIENT_ID,
          { headers: { Cookie: getCookieHeader(), 'User-Agent': 'Mozilla/5.0' } }
        );
        const scope = (tRes.data && tRes.data.scopeData) || {};
        const mensajes = scope.Message && scope.Message.data ? Object.values(scope.Message.data) : [];
        mensajes.sort((a, b) => (a.dttm || '').localeCompare(b.dttm || ''));
        const ultimo = mensajes.length ? mensajes[mensajes.length - 1] : null;

        const reservas = (scope.Reservation && scope.Reservation.data) || {};
        const resKey = Object.keys(reservas)[0];
        const reserva = reservas[resKey] || {};
        const data = (tRes.data && tRes.data.data) || {};

        resultados.push({
          thread_id: threadId,
          propiedad: (reserva.listing_name || data.listing_name || '???').substring(0, 50),
          huesped: reserva.guest_name || '???',
          total_mensajes: mensajes.length,
          ultimo_mensaje: ultimo ? {
            id: ultimo.id,
            texto: (ultimo.message_text || '').substring(0, 120),
            es_host: ultimo.sender_id === ultimo.host_id,
            fecha: ultimo.dttm,
            ya_respondido: respondidos.has(ultimo.id),
          } : null,
          // Info de reserva si existe
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
      total_threads: threadIds.length,
      analizados: resultados.length,
      threads: resultados,
      nota: 'DRY-RUN: no se envio nada. Busca threads donde ultimo_mensaje.es_host=false y ya_respondido=false'
    });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===========================================================
// TEST-SEND: probar respuesta real en UN thread especifico
// POST /poll/test-send  { thread_id: 123456, dry_run: true|false }
// dry_run=true  → genera respuesta pero NO la envia
// dry_run=false → genera respuesta Y la envia al huesped
// ===========================================================
app.post('/poll/test-send', async (req, res) => {
  try {
    const { thread_id, dry_run } = req.body;
    if (!thread_id) return res.json({ ok: false, error: 'Falta thread_id' });

    const isDryRun = dry_run !== false; // default: true (seguro)
    const phpsessid = await getSesion();
    if (!phpsessid) return res.json({ ok: false, error: 'Sin sesion IGMS' });

    // Traer datos del thread
    const tRes = await axios.get(
      'https://www.igms.com/api/data/thread-page-data?params[thread_id]=' + thread_id +
      '&params[platform_type]=airbnb&params[owner_user_id]=' + CONFIG.IGMS_CLIENT_ID,
      { headers: { Cookie: getCookieHeader(), 'User-Agent': 'Mozilla/5.0' } }
    );
    const scope = (tRes.data && tRes.data.scopeData) || {};
    const mensajes = scope.Message && scope.Message.data ? Object.values(scope.Message.data) : [];
    mensajes.sort((a, b) => (a.dttm || '').localeCompare(b.dttm || ''));

    // Tomar los ultimos 5 mensajes como contexto
    const ultimos5 = mensajes.slice(-5);
    const ultimo = mensajes.length ? mensajes[mensajes.length - 1] : null;
    if (!ultimo) return res.json({ ok: false, error: 'Thread sin mensajes' });

    const reservas = (scope.Reservation && scope.Reservation.data) || {};
    const resKey = Object.keys(reservas)[0];
    const reserva = reservas[resKey] || {};
    const data = (tRes.data && tRes.data.data) || {};
    const propiedad = reserva.listing_name || data.listing_name || 'Propiedad SHL';
    const nombre = reserva.guest_name || 'Huesped';

    // Construir contexto con historial
    const historial = ultimos5.map(m => {
      const quien = m.sender_id === m.host_id ? 'Host' : 'Huesped';
      return quien + ': ' + (m.message_text || '').substring(0, 300);
    }).join('\n');

    const mensajeHuesped = ultimo.message_text || '';
    const esHost = ultimo.sender_id === ultimo.host_id;

    // Generar respuesta con Claude
    const respuesta = await generarRespuesta(mensajeHuesped, nombre, propiedad);

    let enviado = false;
    if (!isDryRun && !esHost) {
      enviado = await enviarMensaje(thread_id, respuesta, phpsessid);
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

app.listen(CONFIG.PORT, () => {
  console.log('[SHL] Asistente v' + VERSION + ' - Puerto ' + CONFIG.PORT);
});
