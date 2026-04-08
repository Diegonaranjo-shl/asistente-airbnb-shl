// ASISTENTE IA AIRBNB - SUPERHOST LOFT
// servidor_asistente.js v5.2
// Restaurado al mecanismo v3.4 que funcionaba:
// login IGMS -> PHPSESSID -> WebSocket + polling + send-thread-action

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

const VERSION = '5.2';

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
let sesion = { phpsessid: null, expira: 0 };
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
// SYSTEM PROMPT ACTUALIZADO
// ===========================================================
const SYSTEM_PROMPT = `Eres el asistente virtual del equipo SuperHost Loft de Diego Naranjo y Maritza.
Superhost verificado de Airbnb con 33+ propiedades en Colombia.

REGLA PRINCIPAL: Airbnb ya envia bienvenida+Hospy, check-in, check-out y resena automaticamente.
NO los repitas. Solo responde preguntas del huesped.

BLACKLIVING: Cra 73 Bis #64A-67, Engativa, Bogota. Maps: https://g.co/kgs/e2irUV
Lofts (2p): 301-306, 401-406 | Familiares: 101,201,202 | PH: 501
Check-in: 3pm TODAS las propiedades | Check-out: 11am lofts | 12pm fam/PH
Late checkout 2pm: $50.000 COP (sujeto disponibilidad)
Acceso: TTLock porton + caja llaves fisica
Codigos caja: 101->2850|201->1607|202->0190|301->3676|302->9244|303->2713|304->9094|305->5961
306->6457|401->8219|402->3253|403->9733|404->9034|405->1357|406->1486|501->2080
Parqueadero: GRATIS para estadias cortas. Solo para MOTO (no hay para carro).
Para estadias de mas de 30 dias: $35.000 COP MENSUAL.
Edificio con ascensor | Lavanderia $7.000/turno piso5 (8-11am o 3-7pm, Nequi 3107541755 Maritza Mora)
Domicilios: CRA 73BIS #64A-67 + apto (no ubicacion del mapa)
Agua Bogota: potable. Cafe: Sello Rojo.
WIFI BLACKLIVING: si cae red principal, alternativas: HOST-101, APTO30422, APTO40122
HOSPY: obligatorio. Sin registro = sin codigo TTLock.

PH 501: terraza privada | hab principal cama queen + bano privado con jacuzzi
Capacidad hasta 8 personas | TV en hab principal y sala

LA 33-805: Cra 7 #33-91 Edif Teleskop
CANDELARIA 1210: Calle 18 #3-18 Edif Ventto | caja: 9539
SANTA BARBARA 205: Calle 124 #21-10 Edif Toledo
COUNTRY 310: Edificio LECCO, Calle 134c #12b-91, Apto 310. Estadias largas +30 dias: $35.000 mensual parqueadero.
RODADERO 401 (Santa Marta): Calle 17 #2-63, Edif Manzanares, Apto 401. Check-in hasta 10pm presencial. Encargada: Yurani.
SANTA MARINA 1410: Torre 2, Apto 1410, Conj Santa Marina, sector Don Jaca. Manillas condominio: $29.200/persona.
TAYRONA: KM 37 Troncal | 4pm/11am | Wilfer: +57 321 7652591
PALOMINO: Parcelacion Ukua Casa C1 | piscina+playa privada
CURITÌ GLAMPING CASTILLO: 7 cabanas, banos compartidos, sin desayuno incluido, sin nevera en cabanas.

PRECIOS: nunca dar precio total por chat, siempre decir que lo vean en la app de Airbnb.
ESTAFA cancelacion: solo reembolso si hay nueva reserva en las mismas fechas.
NUNCA dar telefono personal. NUNCA prometer sin confirmar.
Firma: Equipo Super Host Loft
TONO: Amable, colombiano, 2-3 parrafos, 1-2 emojis. Mismo idioma del huesped.`;

// ===========================================================
// CODIGOS CAJA Y UTILIDADES CHECKIN
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
  return `Hola ${nombre}
El personal del edificio tendra una autorizacion para permitir tu ingreso.

EDIFICIO PORTON NEGRO
Direccion: Cra 73bis #64A-67 - APTO ${numApto}
https://g.co/kgs/e2irUV

La puerta del edificio es con cerradura de teclado:
1. Frota la mano en la parte de arriba hasta que se prenda el teclado.
2. Ingresa el CODIGO: ${codigoPorton}# (el signo # va al final)
3. Baja la manija negra para abrir la puerta.
4. Una vez adentro cierra y sube la manija negra para asegurar.

Junto a la puerta del apto encontraras la caja de llaves:
Alinea el codigo, baja la palanca negra y hala la tapa.
CODIGO DE CAJA DE LLAVES: ${codigoCaja}

Encontraras 3 llaves:
- Llave puerta principal (doble llave despues de las 10pm)
- Llave de emergencia (debe permanecer en la cajita)
- Tarjeta negra: acceso sin codigo al edificio

Perdida de llaves: 10 USD

Saludos!
Equipo Super Host Loft`;
}

const reservasPendientes = {};

async function programarCheckin(threadId, nombre, propiedad, fechaCheckin, phpsessid) {
  const hoy = new Date().toDateString();
  const llegada = new Date(fechaCheckin).toDateString();
  if (hoy === llegada) {
    const msg = await generarMensajeCheckin(nombre, propiedad);
    if (msg) {
      await enviarMensaje(threadId, msg, phpsessid);
      console.log('[Check-in] Enviado a ' + nombre + ' - ' + propiedad);
    }
  } else {
    reservasPendientes[threadId] = { nombre, propiedad, fechaCheckin };
    console.log('[Check-in] Programado para ' + nombre + ' - ' + fechaCheckin);
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
          console.log('[Check-in auto] ' + r.nombre + ' - ' + r.propiedad);
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
    const cookies = res.headers['set-cookie'] || [];
    const phpCookie = cookies.find(c => c.includes('PHPSESSID'));
    if (phpCookie) {
      const match = phpCookie.match(/PHPSESSID=([^;]+)/);
      if (match) {
        sesion.phpsessid = match[1];
        sesion.expira = Date.now() + 22 * 60 * 60 * 1000;
        console.log('[IGMS] Sesion renovada OK');
        return true;
      }
    }
    console.error('[IGMS] No se encontro PHPSESSID en la respuesta');
    return false;
  } catch(e) {
    console.error('[IGMS] Login error:', e.message);
    if (e.response) console.error('[IGMS] Status:', e.response.status);
    return false;
  }
}

async function getSesion() {
  if (!sesion.phpsessid || Date.now() > sesion.expira) await loginIGMS();
  return sesion.phpsessid;
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
// ENVIAR MENSAJE VIA send-thread-action
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
      { headers: { ...form.getHeaders(), Cookie: 'PHPSESSID=' + phpsessid, 'User-Agent': 'Mozilla/5.0' } }
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
    extraHeaders: { Cookie: 'PHPSESSID=' + phpsessid },
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
  socket.on('connect_error', (err) => {
    socketConectado = false; reconectando = false;
    console.log('[Socket] Error conexion, reintentando en 60s...');
    setTimeout(() => conectarSocket(), 60000);
  });
  socket.on('new_message', async (data) => {
    console.log('[Socket] Nuevo msg:', JSON.stringify(data).substring(0, 100));
    await procesarMensajeSocket(data);
  });
}

// ===========================================================
// POLLING cada 2 minutos (respaldo al socket)
// ===========================================================
async function polling() {
  try {
    const phpsessid = await getSesion();
    if (!phpsessid) return;
    const res = await axios.get(
      'https://www.igms.com/api/data/threads?filters[limit]=10&filters[cursor]=0&filters[initial_load]=1&filters[category]=unread',
      { headers: { Cookie: 'PHPSESSID=' + phpsessid, 'User-Agent': 'Mozilla/5.0' } }
    );
    const threadIds = res.data?.data?.thread_ids || [];
    if (threadIds.length > 0) console.log('[Poll] ' + threadIds.length + ' threads no leidos');
    for (const threadId of threadIds.slice(0, 5)) {
      await procesarThread(threadId, phpsessid);
      await new Promise(r => setTimeout(r, 1500));
    }
  } catch(e) {
    console.error('[Poll] Error:', e.message);
    if (e.response?.status === 401 || e.response?.status === 403) sesion.expira = 0;
  }
}

async function procesarThread(threadId, phpsessid) {
  try {
    const CLIENT_IDS = [CONFIG.IGMS_CLIENT_ID, 26271];
    let data, scope;
    for (const cid of CLIENT_IDS) {
      const res = await axios.get(
        'https://www.igms.com/api/data/thread-page-data?params[thread_id]=' + threadId + '&params[platform_type]=airbnb&params[owner_user_id]=' + cid,
        { headers: { Cookie: 'PHPSESSID=' + phpsessid, 'User-Agent': 'Mozilla/5.0' } }
      );
      data = res.data?.data;
      scope = res.data?.scopeData || {};
      if (data && data.platformThreadEventIds?.length) break;
    }
    if (!data) return;
    const eventIds = data.platformThreadEventIds || [];
    const lastEventId = eventIds[eventIds.length - 1];
    if (!lastEventId || respondidos.has(lastEventId)) return;
    const threadEvent = scope.PlatformThreadEvent?.data?.[lastEventId];
    if (!threadEvent) return;
    const esHuesped = threadEvent.sent_by_host === false || threadEvent.is_incoming === true;
    const mensaje = threadEvent.message || threadEvent.body || '';
    if (!esHuesped || !mensaje || mensaje.length < 2) return;
    const reservas = scope.Reservation?.data || {};
    const resKey = Object.keys(reservas)[0];
    const reserva = reservas[resKey] || {};
    const propiedad = reserva.listing_name || data.listing_name || 'Propiedad SuperHost Loft';
    const nombre = reserva.guest_name || threadEvent.author_name || 'Huesped';
    console.log('[Thread] Msg de ' + nombre + ' [' + propiedad.substring(0, 25) + ']: "' + mensaje.substring(0, 50) + '"');
    respondidos.add(lastEventId);
    if (respondidos.size > 500) respondidos.delete(respondidos.values().next().value);
    const respuesta = await generarRespuesta(mensaje, nombre, propiedad);
    const enviado = await enviarMensaje(threadId, respuesta, phpsessid);
    if (enviado) console.log('[Thread] Respondido a ' + nombre);
  } catch(e) {
    console.error('[Thread] Error:', e.message);
  }
}

async function procesarMensajeSocket(data) {
  const msgId = data.event_id || data.id || (data.thread_id + '_' + Date.now());
  if (respondidos.has(msgId)) return;
  const esHuesped = data.sent_by_host === false || data.is_incoming === true;
  const mensaje = data.message || data.text || data.body || '';
  const threadId = data.thread_id || data.threadId;
  if (!mensaje || !threadId || !esHuesped) return;
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
// ARRANQUE
// ===========================================================
(async () => {
  await loginIGMS();
  await conectarSocket();
  setInterval(polling, 2 * 60 * 1000);
  setInterval(loginIGMS, 20 * 60 * 60 * 1000);
  console.log('[SHL] Asistente v' + VERSION + ' iniciado - envio automatico ACTIVO');
})();

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
  polling().catch(console.error);
  res.json({ ok: true, message: 'Polling forzado' });
});

app.get('/health', (req, res) => res.json({
  status: 'Asistente activo',
  version: VERSION,
  socket: socketConectado ? 'conectado' : 'reconectando',
  sesion: sesion.phpsessid ? 'activa' : 'sin sesion',
  polling: 'activo cada 2min',
  timestamp: new Date().toISOString()
}));

app.listen(CONFIG.PORT, () => {
  console.log('[SHL] Asistente v' + VERSION + ' - Puerto ' + CONFIG.PORT);
  console.log('[SHL] IGMS: ' + (CONFIG.IGMS_EMAIL ? CONFIG.IGMS_EMAIL : 'SIN EMAIL'));
});
