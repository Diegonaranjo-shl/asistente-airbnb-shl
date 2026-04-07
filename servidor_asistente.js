// ASISTENTE IA AIRBNB — DIEGO NARANJO · SuperHost Loft v3.0
// Con Socket.IO para IGMS + polling HTTP como fallback
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
  IGMS_PHPSESSID: process.env.IGMS_PHPSESSID,
  IGMS_CLIENT_ID: parseInt(process.env.IGMS_CLIENT_ID || '93483'),
  PORT: process.env.PORT || 3000,
};

// Registro de mensajes ya respondidos (evitar duplicados)
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

RESPUESTAS: Check-in 3pm | Early check-in: sujeto disponibilidad | Check-out: dejar llaves en cajita
Late checkout: $50.000 hasta 2pm | Parqueadero: $15.000/noche | ESTAFA: solo reembolso si hay nueva reserva
NUNCA dar telefono personal. NUNCA prometer sin confirmar.
Firma: "Equipo Super Host Loft" (apto 101: "Diego y Maritza")
TONO: Amable, colombiano, 2-3 parrafos, 1-2 emojis. Mismo idioma del huesped.`;

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
// IGMS: OBTENER THREADS CON MENSAJES SIN RESPONDER
// ============================================================
async function obtenerThreadsNuevos() {
  if (!CONFIG.IGMS_PHPSESSID) return [];
  const cookie = `PHPSESSID=${CONFIG.IGMS_PHPSESSID}`;
  
  const res = await axios.get(
    'https://www.igms.com/api/data/threads?filters[limit]=20&filters[cursor]=0&filters[initial_load]=1&filters[category]=unread',
    { headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0' } }
  );
  
  const threadIds = res.data?.data?.thread_ids || [];
  console.log(`📬 Threads no leidos: ${threadIds.length}`);
  return threadIds;
}

// ============================================================
// IGMS: OBTENER DATOS DE UN THREAD
// ============================================================
async function obtenerDatosThread(threadId) {
  if (!CONFIG.IGMS_PHPSESSID) return null;
  const cookie = `PHPSESSID=${CONFIG.IGMS_PHPSESSID}`;
  
  const res = await axios.get(
    `https://www.igms.com/api/data/thread-page-data?params[thread_id]=${threadId}&params[platform_type]=airbnb&params[owner_user_id]=${CONFIG.IGMS_CLIENT_ID}`,
    { headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0' } }
  );
  return res.data?.data;
}

// ============================================================
// IGMS: ENVIAR MENSAJE VIA SOCKET.IO
// ============================================================
let socket = null;
let socketConectado = false;

function conectarSocket() {
  if (!CONFIG.IGMS_PHPSESSID) return;
  
  socket = io('https://www.igms.com:8082', {
    transports: ['websocket', 'polling'],
    extraHeaders: { Cookie: `PHPSESSID=${CONFIG.IGMS_PHPSESSID}` },
    reconnection: true,
    reconnectionDelay: 5000,
  });

  socket.on('connect', () => {
    socketConectado = true;
    console.log('✅ Socket IGMS conectado:', socket.id);
    socket.emit('identify', { clientId: CONFIG.IGMS_CLIENT_ID });
  });

  socket.on('disconnect', () => {
    socketConectado = false;
    console.log('🔌 Socket IGMS desconectado');
  });

  socket.on('new_message', async (data) => {
    console.log('📩 Nuevo mensaje Socket:', JSON.stringify(data).substring(0, 200));
    await procesarMensajeSocket(data);
  });

  socket.on('connect_error', (err) => {
    console.error('❌ Socket error:', err.message);
  });
}

async function enviarMensajeSocket(threadId, mensaje, platformType, guestId, ownerId) {
  if (!socket || !socketConectado) {
    console.log('⚠️ Socket no conectado, usando fallback HTTP');
    return enviarMensajeHTTP(threadId, mensaje);
  }
  
  return new Promise((resolve, reject) => {
    socket.emit('send_message', {
      thread_id: threadId,
      message: mensaje,
      platform_type: platformType || 'airbnb',
      platform_user_id: guestId,
      owner_user_id: ownerId || CONFIG.IGMS_CLIENT_ID,
    }, (ack) => {
      if (ack?.success) {
        console.log(`✅ Mensaje enviado a thread ${threadId}`);
        resolve(true);
      } else {
        console.log('⚠️ Socket ack fallido, intentando HTTP');
        enviarMensajeHTTP(threadId, mensaje).then(resolve).catch(reject);
      }
    });
    setTimeout(() => enviarMensajeHTTP(threadId, mensaje).then(resolve).catch(reject), 3000);
  });
}

async function enviarMensajeHTTP(threadId, mensaje) {
  // Intentar varios endpoints conocidos de IGMS
  const endpoints = [
    { url: `https://www.igms.com/api/data/thread-reply`, body: { thread_id: threadId, message: mensaje } },
    { url: `https://www.igms.com/api/inbox/reply`, body: { threadId, message: mensaje } },
    { url: `https://www.igms.com/api/data/host-reply`, body: { thread_id: threadId, text: mensaje } },
  ];
  
  const cookie = `PHPSESSID=${CONFIG.IGMS_PHPSESSID}`;
  for (const ep of endpoints) {
    try {
      const res = await axios.post(ep.url, ep.body, {
        headers: { Cookie: cookie, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.status < 400) {
        console.log(`✅ HTTP enviado via ${ep.url}`);
        return true;
      }
    } catch(e) { /* siguiente */ }
  }
  console.log('⚠️ No se pudo enviar via HTTP — guardando para reintento');
  return false;
}

// ============================================================
// PROCESAR MENSAJE ENTRANTE
// ============================================================
async function procesarMensajeSocket(data) {
  const threadId = data.thread_id || data.threadId;
  const msgId = data.message_id || data.id || (threadId + '_' + Date.now());
  
  if (respondidos.has(msgId)) return;
  
  const mensaje = data.message || data.text || data.body || '';
  const nombre = data.guest_name || data.guestName || 'Huésped';
  const propiedad = data.listing_name || data.listingName || 'Propiedad SHL';
  const esHuesped = data.sender_type === 'guest' || data.is_guest || data.from_guest;
  
  if (!mensaje || !esHuesped) return;
  
  console.log(`📩 [${propiedad}] ${nombre}: "${mensaje.substring(0, 80)}"`);
  respondidos.add(msgId);
  
  try {
    const respuesta = await generarRespuesta(mensaje, nombre, propiedad);
    await enviarMensajeSocket(threadId, respuesta, data.platform_type, data.platform_user_id, CONFIG.IGMS_CLIENT_ID);
    console.log(`✅ Respondido a ${nombre}`);
  } catch(e) {
    console.error('❌ Error procesando:', e.message);
  }
}

// ============================================================
// POLLING: Revisar mensajes nuevos cada 2 minutos
// ============================================================
async function polling() {
  try {
    const threadIds = await obtenerThreadsNuevos();
    for (const threadId of threadIds.slice(0, 5)) {
      const datos = await obtenerDatosThread(threadId);
      if (!datos) continue;
      // Procesar ultimo mensaje del thread
    }
  } catch(e) {
    console.error('❌ Polling error:', e.message);
  }
}

// ============================================================
// INICIALIZAR
// ============================================================
conectarSocket();
setInterval(polling, 2 * 60 * 1000);

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
  version: '3.0',
  socket: socketConectado ? '✅ conectado' : '❌ desconectado',
  timestamp: new Date().toISOString()
}));

app.listen(CONFIG.PORT, () => console.log(`🏨 Asistente SHL v3.0 activo — Puerto ${CONFIG.PORT}`));