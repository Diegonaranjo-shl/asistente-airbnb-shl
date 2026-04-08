// ===========================================================
// ASISTENTE IA AIRBNB - SUPERHOST LOFT
// servidor_asistente.js  v5.0
// ===========================================================

const express = require('express');
const axios   = require('axios');
const app     = express();
app.use(express.json());

const VERSION = '5.0';

const CFG = {
  ANTHROPIC_API_KEY : process.env.ANTHROPIC_API_KEY,
  IGMS_API_KEY      : process.env.IGMS_API_KEY,
  WHATSAPP_API_KEY  : process.env.WHATSAPP_API_KEY,
  DIEGO_WHATSAPP    : process.env.DIEGO_WHATSAPP,
  PORT              : process.env.PORT || 3000,
};

const SYSTEM_PROMPT = `Eres el asistente virtual del equipo SuperHost Loft de Diego Naranjo.
Tienes 33+ propiedades en Colombia. Respondes como el equipo (Diego y Maritza).

BLACKLIVING - Cra 73 Bis 64A-67, El Encanto, Engativa, Bogota.
A 15 min del Aeropuerto El Dorado. Cerca a la Embajada Americana.
Lofts (2 personas): Aptos 301,302,303,304,305,306,401,402,403,404,405,406
Familiares 2H/2B: Aptos 101,201,202
Penthouse lujo: Apto 501 (hasta 6 personas, hab. principal con jacuzzi)
Maps: https://g.co/kgs/e2irUV

OTRAS BOGOTA:
La 33-805: Carrera 7 33-91, Edif Teleskop (estadias largas)
Candelaria Ventto1210: Calle 18 3-18, Edif Ventto
Santa Barbara 205: Calle 124 21-10, Edif Toledo
Country 310: Calle 134C 12B-91, Edif Lecco (cerca Clinica Bosque)

SANTA MARTA: El Rodadero 401 (Calle 17 2-63, Gaira), Frente al Mar 1410 (Torre 2)
TAYRONA (KM 37 Troncal del Caribe): Suite Green, Suite Blue, Beach Suites 2
PALOMINO: Casa La Sirena - piscina privada, acceso directo playa
CURITI SANTANDER (Castillo): Hobbit 1, Hobbit 2, Glamping 3, El Naranjal, De Piedra, Torre 2, El Cafetal

POLITICAS:
Check-in: 3pm (lofts/familiares Bogota), 2pm (Penthouse), 4pm (Santa Marta y Tayrona)
Check-out: 11am (lofts), 12pm (familiares, Penthouse y Santa Marta), 11am (Tayrona)
Late check-out hasta 2pm: $50.000 COP adicionales (sujeto a disponibilidad)
No mascotas, no fiestas, no fumar. WiFi gratuito en todas las propiedades.

ACCESO BLACKLIVING:
Porton: codigo TTLock unico siempre termina en #. Frotar la mano para activar teclado.
Caja de llaves codigos fijos: 101->2850, 201->1607, 202->0190,
301->3676, 302->9244, 303->2713, 304->9094, 305->5961, 306->6457,
401->8219, 402->3253, 403->9733, 404->9034, 405->1357, 406->1486, 501->2080
Perdida de llaves: 10 USD. Llave de emergencia SIEMPRE en la cajita.

REGISTRO HOSPY (link-airbnb.hospy.co): Obligatorio por norma colombiana.
Sin registro NO se entregan codigos. Si link no abre: pedir foto doc + correo + telefono.

SERVICIOS:
Lavanderia self-service: $7.000 COP/turno, maq 3 y 4, piso 5, horario 8am-11am o 3pm-7pm.
Pago: Nequi 3107541755 (Maritza). Llevar detergente y suavizante.
Limpieza general: $50.000 | Cambio sabanas/toallas: $25.000 | Lavado por personal: $30.000
Parqueadero: $15.000 COP/noche

INFO UTIL:
Agua Bogota: 100% potable.
Basura: canecas del primer piso.
Domicilios: usar SIEMPRE 'CRA 73BIS 64A-67 + num apto', NO usar ubicacion en mapa.
Supermercado: D1 en Av. Boyaca 64J-71 (5 min a pie).
WiFi caido: redes alternativas APTO30422, APTO40122, HOST-101.

ESTAFA: Si dicen 'Airbnb me dijo que debes aceptar la cancelacion' ->
Responder: 'Unicamente si recibimos reserva en las mismas fechas podriamos hacer el reembolso.'

TONO: Espanol colombiano natural, amable, max 3-4 parrafos, emojis moderados (1-2).
Nunca dar telefono personal. Firma siempre como: Equipo SuperHost Loft.`;

// ============================================================
// HISTORIAL POR CONVERSACION
// ============================================================
const conversations = new Map();

function getHistory(threadId) {
  if (!conversations.has(threadId)) conversations.set(threadId, []);
  return conversations.get(threadId);
}

// ============================================================
// DETECCION DE URGENCIAS
// ============================================================
const URGENT_KW = [
  'emergencia','urgente','inundacion','incendio','robo','herido',
  'sin agua','sin luz','no hay agua','no hay luz','llave adentro',
  'no puedo entrar','accidente','medico'
];

function isUrgent(msg) {
  const l = msg.toLowerCase();
  return URGENT_KW.some(k => l.includes(k));
}

// ============================================================
// GENERAR RESPUESTA CON CLAUDE
// ============================================================
async function generateResponse(guestMessage, guestName, propertyName, threadId) {
  const history = getHistory(threadId);
  const userContent = 'Propiedad: ' + propertyName + '\nHuesped: ' + guestName + '\nMensaje: "' + guestMessage + '"';
  history.push({ role: 'user', content: userContent });
  if (history.length > 40) history.splice(0, 2);

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model     : 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system    : SYSTEM_PROMPT,
      messages  : history,
    },
    {
      headers: {
        'x-api-key'         : CFG.ANTHROPIC_API_KEY,
        'anthropic-version' : '2023-06-01',
        'Content-Type'      : 'application/json',
      },
    }
  );

  const reply = response.data.content[0].text;
  history.push({ role: 'assistant', content: reply });
  return reply;
}

// ============================================================
// ALERTA WHATSAPP A DIEGO
// ============================================================
async function alertDiego(guestName, propertyName, message, aiResponse) {
  if (!CFG.WHATSAPP_API_KEY || !CFG.DIEGO_WHATSAPP) return;
  const text = 'ALERTA URGENTE - Asistente Airbnb\n' +
    'Huesped: ' + guestName + '\nPropiedad: ' + propertyName +
    '\nMensaje: "' + message + '"\nRespuesta: "' + aiResponse.substring(0, 200) + '..."';
  await axios.post(
    'https://waba.360dialog.io/v1/messages',
    { messaging_product: 'whatsapp', to: CFG.DIEGO_WHATSAPP, type: 'text', text: { body: text } },
    { headers: { 'D360-API-KEY': CFG.WHATSAPP_API_KEY, 'Content-Type': 'application/json' } }
  );
  console.log('[WA] Alerta enviada a Diego');
}

// ============================================================
// RESPONDER EN AIRBNB VIA IGMS
// ============================================================
async function replyOnAirbnb(threadId, message) {
  if (!CFG.IGMS_API_KEY) {
    console.log('[IGMS] Sin API key configurada');
    return;
  }
  await axios.post(
    'https://api.igms.com/v1/messaging/send',
    { thread_id: threadId, message: message },
    { headers: { 'Authorization': 'Bearer ' + CFG.IGMS_API_KEY, 'Content-Type': 'application/json' } }
  );
  console.log('[IGMS] Respuesta enviada en thread ' + threadId);
}

// ============================================================
// POLLING: Revisar mensajes nuevos en IGMS cada 90 segundos
// ============================================================
const processedMessages = new Set();

async function pollNewMessages() {
  if (!CFG.IGMS_API_KEY) {
    console.log('[POLL] Sin IGMS_API_KEY - polling desactivado');
    return;
  }
  console.log('[POLL] Revisando mensajes nuevos... ' + new Date().toISOString());

  try {
    const res = await axios.get(
      'https://api.igms.com/v1/messaging/threads',
      {
        params : { status: 'active', limit: 20 },
        headers: { 'Authorization': 'Bearer ' + CFG.IGMS_API_KEY, 'Content-Type': 'application/json' },
        timeout: 15000,
      }
    );

    const threads = res.data.data || res.data.threads || res.data || [];
    console.log('[POLL] Threads encontrados: ' + threads.length);

    for (const thread of threads) {
      const threadId = thread.id || thread.thread_id;
      const lastMsg  = thread.last_message || (thread.messages && thread.messages[thread.messages.length - 1]);
      if (!lastMsg) continue;

      const msgId   = lastMsg.id || (threadId + '_' + lastMsg.created_at);
      const role    = lastMsg.role || lastMsg.sender_type || '';
      const isGuest = role === 'guest' || role === 'traveler' || role === 'renter';

      if (!isGuest || processedMessages.has(msgId)) continue;

      processedMessages.add(msgId);
      if (processedMessages.size > 500) {
        processedMessages.delete(processedMessages.values().next().value);
      }

      const guestMessage = lastMsg.message || lastMsg.body || lastMsg.text || '';
      const guestName    = thread.guest_name || (thread.guest && thread.guest.name) || 'Huesped';
      const propertyName = thread.property_name || (thread.listing && thread.listing.name) || 'Propiedad SHL';

      if (!guestMessage.trim()) continue;

      console.log('[POLL] Nuevo mensaje de ' + guestName + ': "' + guestMessage.substring(0, 80) + '"');

      try {
        const reply = await generateResponse(guestMessage, guestName, propertyName, threadId);
        await replyOnAirbnb(threadId, reply);
        console.log('[POLL] Respuesta enviada a ' + guestName);
        if (isUrgent(guestMessage)) await alertDiego(guestName, propertyName, guestMessage, reply);
      } catch (err) {
        console.error('[POLL] Error en msg de ' + guestName + ': ' + err.message);
      }
    }
  } catch (err) {
    console.error('[POLL] Error: ' + err.message);
    if (err.response) {
      console.error('[POLL] Status: ' + err.response.status + ' | Data: ' + JSON.stringify(err.response.data).substring(0, 300));
    }
  }
}

setInterval(pollNewMessages, 90000);
setTimeout(pollNewMessages, 5000);
console.log('[POLL] Polling iniciado cada 90s');

// ============================================================
// WEBHOOK: Mensaje nuevo
// ============================================================
app.post('/webhook/message', async (req, res) => {
  const { threadId, conversationId, guestName, propertyName, message } = req.body;
  const tid = threadId || conversationId;
  if (!message || !tid) return res.status(400).json({ error: 'Faltan threadId y message' });
  console.log('[WEBHOOK] Msg de ' + (guestName || 'Huesped') + ': "' + message.substring(0, 80) + '"');
  try {
    const reply = await generateResponse(message, guestName || 'Huesped', propertyName || 'Propiedad SHL', tid);
    await replyOnAirbnb(tid, reply);
    if (isUrgent(message)) await alertDiego(guestName, propertyName, message, reply);
    res.json({ success: true, reply });
  } catch (err) {
    console.error('[WEBHOOK] Error: ' + err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// WEBHOOK: Nueva reserva
// ============================================================
app.post('/webhook/reservation', async (req, res) => {
  const { guestName, propertyName, checkIn, checkOut, threadId } = req.body;
  console.log('[RESERVA] ' + guestName + ' en ' + propertyName);
  try {
    const welcomeMsg = await generateResponse(
      'SISTEMA: reserva confirmada. Genera mensaje de bienvenida. Check-in: ' + checkIn + '. Check-out: ' + checkOut + '.',
      guestName || 'Huesped',
      propertyName || 'Propiedad SHL',
      threadId || ('reserva_' + Date.now())
    );
    if (threadId) await replyOnAirbnb(threadId, welcomeMsg);
    res.json({ success: true, welcome: welcomeMsg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// WEBHOOK: Check-out
// ============================================================
app.post('/webhook/checkout', async (req, res) => {
  const { guestName, propertyName, checkoutTime, nextCheckin } = req.body;
  console.log('[CHECKOUT] ' + guestName + ' salio de ' + propertyName);
  if (CFG.WHATSAPP_API_KEY && CFG.DIEGO_WHATSAPP) {
    const msg = 'ASEO REQUERIDO\nPropiedad: ' + propertyName +
      '\nCheck-out: ' + guestName + ' a las ' + checkoutTime +
      '\nProximo check-in: ' + (nextCheckin || 'Por confirmar');
    axios.post(
      'https://waba.360dialog.io/v1/messages',
      { messaging_product: 'whatsapp', to: CFG.DIEGO_WHATSAPP, type: 'text', text: { body: msg } },
      { headers: { 'D360-API-KEY': CFG.WHATSAPP_API_KEY, 'Content-Type': 'application/json' } }
    ).catch(e => console.error('[CHECKOUT] WA error: ' + e.message));
  }
  res.json({ success: true });
});

// ============================================================
// TEST: Simular mensaje manual
// ============================================================
app.post('/test/message', async (req, res) => {
  const { message, guestName, propertyName } = req.body;
  try {
    const reply = await generateResponse(
      message || 'A que hora es el check-in?',
      guestName  || 'Cliente de prueba',
      propertyName || 'Loft 301 Bogota',
      'test_' + Date.now()
    );
    res.json({ reply, urgent: isUrgent(message || '') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// FORZAR POLLING MANUAL
// ============================================================
app.post('/poll/force', async (req, res) => {
  console.log('[POLL] Forzado manualmente');
  pollNewMessages().catch(console.error);
  res.json({ success: true, message: 'Polling iniciado' });
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => {
  res.json({
    status     : 'Asistente activo',
    version    : VERSION,
    propietario: 'Diego Naranjo - SuperHost Loft',
    propiedades: 33,
    polling    : CFG.IGMS_API_KEY ? 'activo cada 90s' : 'sin IGMS_API_KEY',
    timestamp  : new Date().toISOString(),
  });
});

// ============================================================
// ARRANCAR SERVIDOR
// ============================================================
app.listen(CFG.PORT, () => {
  console.log('===========================================');
  console.log('  Asistente SHL v' + VERSION + ' - Puerto ' + CFG.PORT);
  console.log('  IGMS polling: ' + (CFG.IGMS_API_KEY ? 'ACTIVO' : 'SIN API KEY'));
  console.log('  WhatsApp:     ' + (CFG.WHATSAPP_API_KEY ? 'ACTIVO' : 'SIN API KEY'));
  console.log('===========================================');
});
