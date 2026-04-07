// ASISTENTE IA AIRBNB — DIEGO NARANJO · SuperHost Loft v3.1
// Con Socket.IO + auto-login IGMS + renovacion automatica de sesion
const express = require('express');
const axios = require('axios');
const { io } = require('socket.io-client');
const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

const CONFIG = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  IGMS_EMAIL:      process.env.IGMS_EMAIL,
  IGMS_PASSWORD:   process.env.IGMS_PASSWORD,
  IGMS_CLIENT_ID:  parseInt(process.env.IGMS_CLIENT_ID || '93483'),
  PORT:            process.env.PORT || 3000,
};

let sesion = { phpsessid: null, expira: 0 };
let socket = null;
let socketConectado = false;
const respondidos = new Set();

// ============================================================
// SYSTEM PROMPT
// ============================================================
const SYSTEM_PROMPT = `Eres el asistente virtual del equipo SuperHost Loft de Diego Naranjo y Maritza.
Superhost verificado de Airbnb con 33+ propiedades en Colombia.

REGLA PRINCIPAL: Airbnb ya envia bienvenida+Hospy, check-in, check-out y resena automaticamente.
NO los repitas. Solo responde preguntas del huesped.

BLACKLIVING: Cra 73 Bis #64A-67, Engativa, Bogota. Maps: https://g.co/kgs/e2irUV
Lofts (2p): 301-306, 401-406 | Familiares: 101,201,202 | PH: 501 (jacuzzi)
Check-in: 3pm lofts/fam | 2pm PH | Check-out: 11am lofts | 12pm fam/PH
Late checkout 2pm: $50.000 COP (sujeto disponibilidad)
Acceso: TTLock porton + caja llaves fisica
Codigos caja: 101->2850|201->1607|202->0190|301->3676|302->9244|303->2713|304->9094|305->5961
306->6457|401->8219|402->3253|403->9733|404->9034|405->1357|406->1486|501->2080
Servicios: Parqueadero $15.000/noche | Lavanderia $7.000/turno piso5 (8-11am o 3-7pm, Nequi 3107541755)
Limpieza $50.000 | Sabanas $25.000 | Lavado ropa $30.000
Domicilios: CRA 73BIS #64A-67 + apto (no ubicacion del mapa)
HOSPY: obligatorio. Sin registro = sin codigo TTLock.
Agua Bogota: potable. Cafe: Sello Rojo.

LA 33-805: Cra 7 #33-91 Edif Teleskop | porteria | 3pm/11am | WiFi: BPALOMINO/Airbnb805
CANDELARIA 1210: Calle 18 #3-18 Edif Ventto | piso12 | caja: 9539 | 3pm/11am
SANTA BARBARA 205: Calle 124 #21-10 Edif Toledo | cerradura digital | 3pm/11am
COUNTRY 310: Calle 134C #12B-91 Edif Lecco | WiFi: Lecco310/Shloft310 | 3pm/11am

RODADERO 401: Calle 17 #2-63 Edif Manzanares | Cod: 123456# | WiFi: Apartamento401 | 3pm/11am
SANTA MARINA 1410: Cj Santa Marina Torre 2 (pedir Don Jaca) | caja:1621 | WiFi: SHLOFT1410 | 3pm/12pm
Piscina 9am-9pm (no martes) | Manillas $29.200 | Late checkout: 50% extra

TAYRONA: KM 37 Troncal (preguntar Casa Grande Surf) | 4pm/11am
Wilfer: +57 321 7652591 | WiFi: BEACH SUITES/SUITES1621

PALOMINO: Parcelacion Ukua Casa C1 | piscina+playa privada
CURITI: San Gil-Aratoca Km5 | 7 cabanas castillo medieval | piscina+jacuzzi

Check-in 3pm | Early check-in: sujeto disponibilidad | Check-out: dejar llaves en cajita
Late checkout: $50.000 hasta 2pm | Parqueadero: $15.000/noche
ESTAFA cancelacion: solo reembolso si hay nueva reserva
NUNCA dar telefono personal. NUNCA prometer sin confirmar.
Firma: Equipo Super Host Loft (apto 101: Diego y Maritza)
TONO: Amable, colombiano, 2-3 parrafos, 1-2 emojis. Mismo idioma del huesped.`;

// ============================================================
// AUTO-LOGIN IGMS — renueva sesion automaticamente
// ============================================================
async function loginIGMS() {
  try {
    console.log('🔑 Renovando sesion IGMS...');
    const res = await axios.post('https://www.igms.com/api/user-api/login',
      { email: CONFIG.IGMS_EMAIL, password: CONFIG.IGMS_PASSWORD, platform: 'web' },
      { headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        withCredentials: true, maxRedirects: 5 }
    );

    // Extraer PHPSESSID de Set-Cookie
    const cookies = res.headers['set-cookie'] || [];
    const phpCookie = cookies.find(c => c.includes('PHPSESSID'));
    if (phpCookie) {
      const match = phpCookie.match(/PHPSESSID=([^;]+)/);
      if (match) {
        sesion.phpsessid = match[1];
        sesion.expira = Date.now() + 22 * 60 * 60 * 1000; // 22 horas
        console.log('✅ Sesion IGMS renovada:', sesion.phpsessid.substring(0,8) + '...');
        return true;
      }
    }

    // Si no hay cookie en headers, intentar con el hash de la respuesta
    const data = res.data?.data?.data;
    if (data?.hash) {
      console.log('Login OK via hash, buscando cookie...');
    }

    console.log('⚠️ Login response:', JSON.stringify(res.data).substring(0, 200));
    return false;
  } catch(e) {
    console.error('❌ Login IGMS error:', e.message);
    return false;
  }
}

async function getSesion() {
  if (!sesion.phpsessid || Date.now() > sesion.expira) {
    await loginIGMS();
  }
  return sesion.phpsessid;
}

// ============================================================
// GENERAR RESPUESTA CON CLAUDE
// ============================================================
async function generarRespuesta(mensaje, nombre, propiedad) {
  const res = await axios.post('https://api.anthropic.com/v1/messages',
    { model: 'claude-sonnet-4-20250514', max_tokens: 500, system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Huesped: ${nombre}\nPropiedad: ${propiedad}\nMensaje: "${mensaje}"` }] },
    { headers: { 'x-api-key': CONFIG.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' } }
  );
  return res.data.content[0].text;
}

// ============================================================
// SOCKET.IO — conectar a IGMS
// ============================================================
async function conectarSocket() {
  const phpsessid = await getSesion();
  if (!phpsessid) { console.log('⚠️ Sin sesion para socket'); return; }

  if (socket) { socket.disconnect(); socket = null; }

  socket = io('https://www.igms.com:8082', {
    transports: ['websocket', 'polling'],
    extraHeaders: { Cookie: `PHPSESSID=${phpsessid}` },
    reconnection: true, reconnectionDelay: 5000,
  });

  socket.on('connect', () => {
    socketConectado = true;
    console.log('✅ Socket IGMS conectado:', socket.id);
    socket.emit('identify', { clientId: CONFIG.IGMS_CLIENT_ID });
  });

  socket.on('disconnect', () => {
    socketConectado = false;
    console.log('🔌 Socket desconectado — reconectando...');
  });

  socket.on('connect_error', async (err) => {
    console.error('❌ Socket error:', err.message);
    // Renovar sesion y reconectar
    await loginIGMS();
  });

  // Escuchar mensajes nuevos de huespedes
  socket.on('new_message', async (data) => {
    console.log('📩 Nuevo msg socket:', JSON.stringify(data).substring(0, 150));
    await procesarMensaje(data);
  });

  socket.on('message', async (data) => {
    if (data?.type === 'new_message' || data?.event === 'new_message') {
      await procesarMensaje(data);
    }
  });
}

// ============================================================
// POLLING — leer mensajes no leidos cada 2 min
// ============================================================
async function polling() {
  try {
    const phpsessid = await getSesion();
    if (!phpsessid) return;

    const res = await axios.get(
      'https://www.igms.com/api/data/threads?filters[limit]=10&filters[cursor]=0&filters[initial_load]=1&filters[category]=unread',
      { headers: { Cookie: `PHPSESSID=${phpsessid}`, 'User-Agent': 'Mozilla/5.0' } }
    );

    const threadIds = res.data?.data?.thread_ids || [];
    if (threadIds.length > 0) console.log(`📬 ${threadIds.length} threads no leidos`);

    for (const threadId of threadIds.slice(0, 3)) {
      await procesarThread(threadId, phpsessid);
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch(e) {
    console.error('❌ Polling error:', e.message);
    if (e.response?.status === 401 || e.response?.status === 403) {
      sesion.expira = 0; // forzar re-login
    }
  }
}

async function procesarThread(threadId, phpsessid) {
  try {
    const res = await axios.get(
      `https://www.igms.com/api/data/thread-page-data?params[thread_id]=${threadId}&params[platform_type]=airbnb&params[owner_user_id]=${CONFIG.IGMS_CLIENT_ID}`,
      { headers: { Cookie: `PHPSESSID=${phpsessid}`, 'User-Agent': 'Mozilla/5.0' } }
    );

    const data = res.data?.data;
    if (!data) return;

    // Obtener IDs de mensajes
    const msgIds = data.message_ids || [];
    const eventIds = data.platformThreadEventIds || [];
    const lastEventId = eventIds[eventIds.length - 1];

    if (!lastEventId || respondidos.has(lastEventId)) return;

    // Obtener datos del scope para extraer el mensaje
    const scope = res.data?.scopeData || {};
    const threadEvent = scope.PlatformThreadEvent?.data?.[lastEventId];
    if (!threadEvent) return;

    const esHuesped = threadEvent.sent_by_host === false || threadEvent.type === 'message_received';
    const mensaje = threadEvent.message || threadEvent.body || '';
    if (!esHuesped || !mensaje) return;

    // Datos de la reserva
    const reservas = scope.Reservation?.data || {};
    const resKey = Object.keys(reservas)[0];
    const reserva = reservas[resKey] || {};
    const propiedad = reserva.listing_name || 'Propiedad SuperHost Loft';
    const nombre = reserva.guest_name || threadEvent.author_name || 'Huesped';

    console.log(`📩 [${propiedad}] ${nombre}: "${mensaje.substring(0, 80)}"`);
    respondidos.add(lastEventId);

    const respuesta = await generarRespuesta(mensaje, nombre, propiedad);
    await enviarRespuesta(threadId, respuesta, phpsessid);
    console.log(`✅ Respondido a ${nombre}`);
  } catch(e) {
    console.error('❌ Error procesando thread:', e.message);
  }
}

async function procesarMensaje(data) {
  const msgId = data.event_id || data.id || JSON.stringify(data).substring(0, 50);
  if (respondidos.has(msgId)) return;

  const mensaje = data.message || data.text || data.body || '';
  const nombre = data.guest_name || data.author || 'Huesped';
  const propiedad = data.listing_name || 'Propiedad SHL';
  const threadId = data.thread_id || data.threadId;
  const esHuesped = data.sent_by_host === false || data.from_host === false || data.is_guest === true;

  if (!mensaje || !threadId || !esHuesped) return;

  respondidos.add(msgId);
  const phpsessid = await getSesion();
  if (!phpsessid) return;

  const respuesta = await generarRespuesta(mensaje, nombre, propiedad);
  await enviarRespuesta(threadId, respuesta, phpsessid);
}

// ============================================================
// ENVIAR RESPUESTA VIA SOCKET O HTTP
// ============================================================
async function enviarRespuesta(threadId, mensaje, phpsessid) {
  // Intentar via socket primero
  if (socket && socketConectado) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(enviarRespuestaHTTP(threadId, mensaje, phpsessid)), 3000);
      socket.emit('send_message', { thread_id: threadId, message: mensaje }, (ack) => {
        clearTimeout(timeout);
        if (ack?.success) { console.log(`✅ Enviado via socket thread ${threadId}`); resolve(true); }
        else resolve(enviarRespuestaHTTP(threadId, mensaje, phpsessid));
      });
    });
  }
  return enviarRespuestaHTTP(threadId, mensaje, phpsessid);
}

async function enviarRespuestaHTTP(threadId, mensaje, phpsessid) {
  const endpoints = [
    { url: 'https://www.igms.com/api/data/thread-reply', body: { thread_id: threadId, message: mensaje } },
    { url: 'https://www.igms.com/api/inbox/reply', body: { threadId, message: mensaje } },
  ];
  for (const ep of endpoints) {
    try {
      const r = await axios.post(ep.url, ep.body, {
        headers: { Cookie: `PHPSESSID=${phpsessid}`, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }
      });
      if (r.status < 400) { console.log(`✅ Enviado HTTP ${ep.url.split('/').pop()}`); return true; }
    } catch(e) { /* siguiente */ }
  }
  console.log('⚠️ No se pudo enviar respuesta');
  return false;
}

// ============================================================
// INICIALIZAR
// ============================================================
(async () => {
  await loginIGMS();
  await conectarSocket();
  // Polling cada 2 minutos
  setInterval(polling, 2 * 60 * 1000);
  // Re-login cada 20 horas
  setInterval(loginIGMS, 20 * 60 * 60 * 1000);
  // Reconectar socket cada hora si se desconecto
  setInterval(async () => { if (!socketConectado) await conectarSocket(); }, 60 * 60 * 1000);
})();

// ============================================================
// ENDPOINTS
// ============================================================
app.post('/test', async (req, res) => {
  try {
    const { mensaje, nombre, propiedad } = req.body;
    const respuesta = await generarRespuesta(
      mensaje || '¿A que hora es el check-in?',
      nombre || 'Huesped de prueba',
      propiedad || 'Loft ideal para viajeros cerca al aeropuerto'
    );
    res.json({ ok: true, respuesta });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/health', (req, res) => res.json({
  status: '✅ Asistente Airbnb activo',
  version: '3.1',
  socket: socketConectado ? '✅ conectado' : '❌ desconectado',
  sesion: sesion.phpsessid ? '✅ activa' : '❌ sin sesion',
  timestamp: new Date().toISOString()
}));

app.listen(CONFIG.PORT, () => console.log(`🏨 Asistente SHL v3.1 activo — Puerto ${CONFIG.PORT}`));