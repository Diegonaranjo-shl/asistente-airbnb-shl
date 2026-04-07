// ASISTENTE IA AIRBNB ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ DIEGO NARANJO ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ· v3.4 ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ· ENVIO AUTOMATICO REAL
const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const socketio = require('socket.io-client');
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
  IGMS_EMAIL:       process.env.IGMS_EMAIL,
  IGMS_PASSWORD:    process.env.IGMS_PASSWORD,
  IGMS_CLIENT_ID:   parseInt(process.env.IGMS_CLIENT_ID || '93483'),
  PORT:             process.env.PORT || 3000,
};

let sesion = { phpsessid: null, expira: 0 };
let socket = null;
let socketConectado = false;
let reconectando = false;
const respondidos = new Set();

const SYSTEM_PROMPT = `Eres el asistente virtual del equipo SuperHost Loft de Diego Naranjo y Maritza.
Superhost verificado de Airbnb con 33+ propiedades en Colombia.

REGLA PRINCIPAL: Airbnb ya envia bienvenida+Hospy, check-in, check-out y resena automaticamente.
NO los repitas. Solo responde preguntas del huesped.

BLACKLIVING: Cra 73 Bis #64A-67, Engativa, Bogota. Maps: https://g.co/kgs/e2irUV
Lofts (2p): 301-306, 401-406 | Familiares: 101,201,202 | PH: 501
Check-in: 3pm TODAS las propiedades | Check-out: 11am lofts | 12pm fam/PH
Late checkout 2pm: $50.000 COP (sujeto disponibilidad)
Acceso: TTLock porton + caja llaves fisica
APTO 101: primer piso, 4 habitaciones (es apartamento en edificio, no casa)
Codigos caja: 101->2850|201->1607|202->0190|301->3676|302->9244|303->2713|304->9094|305->5961
306->6457|401->8219|402->3253|403->9733|404->9034|405->1357|406->1486|501->2080
Servicios: Parqueadero SOLO para moto $15.000/noche (no hay parqueadero para carro)
Edificio con ascensor | Lavanderia $7.000/turno piso5 (8-11am o 3-7pm, Nequi 3107541755)
Limpieza $50.000 | Sabanas $25.000 | Lavado ropa $30.000
Domicilios: CRA 73BIS #64A-67 + apto (no ubicacion del mapa)
HOSPY: obligatorio. Sin registro = sin codigo TTLock.
Agua Bogota: potable. Cafe: Sello Rojo.

PH 501 BLACKLIVING:
- Terraza privada de uso exclusivo del apartamento
- Hab principal: cama queen + bano privado con jacuzzi
- TV: SOLO en habitacion principal y en la sala (otras habitaciones NO tienen TV)
- Camas: queen (principal) + doble (hab2) + semidoble + camarote sencillo (hab3) + sofa cama doble (sala)
- Capacidad: hasta 8 personas

LA 33-805: Cra 7 #33-91 Edif Teleskop | WiFi: BPALOMINO/Airbnb805
CANDELARIA 1210: Calle 18 #3-18 Edif Ventto | caja: 9539
SANTA BARBARA 205: Calle 124 #21-10 Edif Toledo
COUNTRY 310: Calle 134C #12B-91 Edif Lecco | WiFi: Lecco310/Shloft310
RODADERO 401: Calle 17 #2-63 | Cod: 123456# | WiFi: Apartamento401
SANTA MARINA 1410: Cj Santa Marina Torre 2 | caja:1621 | WiFi: SHLOFT1410 | tiene A/C
Camas: 1 doble (hab principal) + 1 sofa cama king (sala)
Piscina 9am-9pm (no martes) | Manillas $29.200
TAYRONA: KM 37 Troncal | 4pm/11am | Wilfer: +57 321 7652591 | WiFi: BEACH SUITES/SUITES1621
PALOMINO: Parcelacion Ukua Casa C1 | piscina+playa privada
CURITI: San Gil-Aratoca Km5 | 7 cabanas castillo medieval | piscina+jacuzzi

PRECIOS: nunca dar precio total por chat, siempre decir que lo vean en la app de Airbnb
COBRO ADICIONAL HUESPEDES: se cobra por numero de huespedes a partir del 5to (NO por edad ni por niÃ±os)
TRUCO RESERVA GRUPOS: se puede reservar con menos huespedes y en el registro Hospy poner a todos
MALETAS ANTES CHECK-IN: se puede confirmar el dia anterior segun disponibilidad. Minimo desde las 11:30am. NO antes de las 10am porque no hay recepcion. Depende del huesped que sale
DISTANCIAS DESDE BLACKLIVING (referencias utiles):
- Salitre Magico: 30 min en bicicleta
- Aeropuerto El Dorado: 15 min en carro
- Embajada Americana: cerca (pocos minutos)
GRUPOS DEPORTIVOS/EVENTOS: responder con entusiasmo por su evento antes de continuar con el proceso
ESTAFA cancelacion: solo reembolso si hay nueva reserva
NUNCA dar telefono personal. NUNCA prometer sin confirmar.
Firma: Equipo Super Host Loft
TONO: Amable, colombiano, 2-3 parrafos, 1-2 emojis. Mismo idioma del huesped.`;

async function loginIGMS() {
  try {
    console.log('Renovando sesion IGMS...');
    const res = await axios.post('https://www.igms.com/api/user-api/login',
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
        console.log('Sesion IGMS renovada OK');
        return true;
      }
    }
    return false;
  } catch(e) { console.error('Login error:', e.message); return false; }
}

async function getSesion() {
  if (!sesion.phpsessid || Date.now() > sesion.expira) await loginIGMS();
  return sesion.phpsessid;
}

async function generarRespuesta(mensaje, nombre, propiedad) {
  const res = await axios.post('https://api.anthropic.com/v1/messages',
    { model: 'claude-sonnet-4-20250514', max_tokens: 500, system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Huesped: ${nombre}\nPropiedad: ${propiedad}\nMensaje: "${mensaje}"` }] },
    { headers: { 'x-api-key': CONFIG.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' } }
  );
  return res.data.content[0].text;
}

// ENVIO REAL via send-thread-action con FormData
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
      { headers: { ...form.getHeaders(), Cookie: `PHPSESSID=${phpsessid}`, 'User-Agent': 'Mozilla/5.0' } }
    );
    if (res.status === 200) {
      console.log(`Mensaje enviado al thread ${threadId}`);
      return true;
    }
    return false;
  } catch(e) {
    console.error('Error enviando mensaje:', e.message);
    return false;
  }
}

async function conectarSocket() {
  if (reconectando) return;
  reconectando = true;
  const phpsessid = await getSesion();
  if (!phpsessid) { reconectando = false; return; }
  if (socket) { try { socket.disconnect(); } catch(e) {} socket = null; }
  socket = socketio('https://www.igms.com:8082', {
    transports: ['websocket', 'polling'],
    extraHeaders: { Cookie: `PHPSESSID=${phpsessid}` },
    reconnection: false,
  });
  socket.on('connect', () => {
    socketConectado = true; reconectando = false;
    console.log('Socket IGMS conectado:', socket.id);
    socket.emit('identify', { clientId: CONFIG.IGMS_CLIENT_ID });
  });
  socket.on('disconnect', () => {
    socketConectado = false;
    console.log('Socket desconectado');
    setTimeout(() => { reconectando = false; conectarSocket(); }, 30000);
  });
  socket.on('connect_error', (err) => {
    socketConectado = false; reconectando = false;
    setTimeout(() => conectarSocket(), 60000);
  });
  socket.on('new_message', async (data) => {
    console.log('Nuevo msg socket:', JSON.stringify(data).substring(0, 100));
    await procesarMensajeSocket(data);
  });
}

async function polling() {
  try {
    const phpsessid = await getSesion();
    if (!phpsessid) return;
    const res = await axios.get(
      'https://www.igms.com/api/data/threads?filters[limit]=10&filters[cursor]=0&filters[initial_load]=1&filters[category]=unread',
      { headers: { Cookie: `PHPSESSID=${phpsessid}`, 'User-Agent': 'Mozilla/5.0' } }
    );
    const threadIds = res.data?.data?.thread_ids || [];
    if (threadIds.length > 0) console.log(`${threadIds.length} threads no leidos`);
    for (const threadId of threadIds.slice(0, 5)) {
      await procesarThread(threadId, phpsessid);
      await new Promise(r => setTimeout(r, 1500));
    }
  } catch(e) {
    console.error('Polling error:', e.message);
    if (e.response?.status === 401 || e.response?.status === 403) sesion.expira = 0;
  }
}

async function procesarThread(threadId, phpsessid) {
  try {
    const res = await axios.get(
      `https://www.igms.com/api/data/thread-page-data?params[thread_id]=${threadId}&params[platform_type]=airbnb&params[owner_user_id]=${CONFIG.IGMS_CLIENT_ID}`,
      { headers: { Cookie: `PHPSESSID=${phpsessid}`, 'User-Agent': 'Mozilla/5.0' } }
    );
    const data = res.data?.data;
    const scope = res.data?.scopeData || {};
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
    console.log(`Mensaje de ${nombre} [${propiedad.substring(0,25)}]: "${mensaje.substring(0,50)}"`);
    respondidos.add(lastEventId);
    const respuesta = await generarRespuesta(mensaje, nombre, propiedad);
    const enviado = await enviarMensaje(threadId, respuesta, phpsessid);
    if (enviado) console.log(`Respondido automaticamente a ${nombre}`);
  } catch(e) { console.error('Error thread:', e.message); }
}

async function procesarMensajeSocket(data) {
  const msgId = data.event_id || data.id || (data.thread_id + '_' + Date.now());
  if (respondidos.has(msgId)) return;
  const esHuesped = data.sent_by_host === false || data.is_incoming === true;
  const mensaje = data.message || data.text || data.body || '';
  const threadId = data.thread_id || data.threadId;
  if (!mensaje || !threadId || !esHuesped) return;
  respondidos.add(msgId);
  const nombre = data.guest_name || data.author || 'Huesped';
  const propiedad = data.listing_name || 'Propiedad SHL';
  const phpsessid = await getSesion();
  if (!phpsessid) return;
  const respuesta = await generarRespuesta(mensaje, nombre, propiedad);
  await enviarMensaje(threadId, respuesta, phpsessid);
}

(async () => {
  await loginIGMS();
  await conectarSocket();
  setInterval(polling, 2 * 60 * 1000);
  setInterval(loginIGMS, 20 * 60 * 60 * 1000);
  console.log('Asistente SHL v3.4 iniciado - envio automatico ACTIVO');
})();

app.post('/test', async (req, res) => {
  try {
    const { mensaje, nombre, propiedad } = req.body;
    const respuesta = await generarRespuesta(
      mensaje || 'ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¿A que hora es el check-in?',
      nombre || 'Huesped de prueba',
      propiedad || 'Loft 301 cerca aeropuerto'
    );
    res.json({ ok: true, respuesta });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/health', (req, res) => res.json({
  status: 'Asistente activo',
  version: '3.4',
  envio: 'send-thread-action ACTIVO',
  socket: socketConectado ? 'conectado' : 'reconectando',
  sesion: sesion.phpsessid ? 'activa' : 'sin sesion',
  timestamp: new Date().toISOString()
}));

app.listen(CONFIG.PORT, () => console.log(`Asistente SHL v3.4 ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ Puerto ${CONFIG.PORT}`));