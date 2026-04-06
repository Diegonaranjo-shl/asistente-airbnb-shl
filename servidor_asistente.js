// ASISTENTE IA AIRBNB — DIEGO NARANJO · SuperHost Loft v2.0
const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const CONFIG = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  IGMS_API_KEY: process.env.IGMS_API_KEY,
  DIEGO_WHATSAPP: process.env.DIEGO_WHATSAPP || '573242344598',
  PORT: process.env.PORT || 3000,
};

const SYSTEM_PROMPT = `Eres el asistente virtual del equipo SuperHost Loft de Diego Naranjo y Maritza.
Superhost verificado de Airbnb con 33+ propiedades en Colombia.

REGLA PRINCIPAL: Airbnb ya envía bienvenida+Hospy, check-in con instrucciones, check-out y reseña.
NO los repitas. Solo responde preguntas del huesped.

BLACKLIVING: Cra 73 Bis #64A-67, Engativa, Bogota. Maps: https://g.co/kgs/e2irUV
Lofts (2p): 301-306, 401-406 | Familiares: 101,201,202 | PH: 501 (jacuzzi)
Check-in: 3pm lofts/fam | 2pm PH | Check-out: 11am lofts | 12pm fam/PH
Late checkout 2pm: $50.000 COP (sujeto disponibilidad)
Acceso: TTLock porton (codigo generado por Hospy al completar registro) + caja llaves fisica
Codigos caja: 101->2850|201->1607|202->0190|301->3676|302->9244|303->2713
304->9094|305->5961|306->6457|401->8219|402->3253|403->9733|404->9034|405->1357|406->1486|501->2080
Servicios: Parqueadero $15.000/noche | Lavanderia $7.000/turno (piso 5, 8-11am o 3-7pm, Nequi 3107541755 Maritza)
Limpieza $50.000 | Sabanas $25.000 | Lavado ropa $30.000
Domicilios: usar CRA 73BIS #64A-67 + apto (no ubicacion del mapa)
Apto 101: 2 llaves, perdida $20 USD, firma Diego y Maritza
Apto 501 PH: perdida $20 USD | Resto: 3 llaves, perdida $10 USD
HOSPY: obligatorio por ley. Sin registro = sin codigo TTLock.

LA 33-805: Cra 7 #33-91 Edif Teleskop | llave fisica | porteria | 3pm/11am
  WiFi: BPALOMINO/Airbnb805 | Netflix perfil Betty | limpieza gratis c/30 dias
CANDELARIA 1210: Calle 18 #3-18 Edif Ventto | llave | vigilante pide doc | piso 12 | caja: 9539 | 3pm/11am
SANTA BARBARA 205: Calle 124 #21-10 Edif Toledo | cerradura digital | sin porteria | 3pm/11am
COUNTRY 310: Calle 134C #12B-91 Edif Lecco piso 3 | llave | WiFi: Lecco310/Shloft310 | 3pm/11am

RODADERO 401: Calle 17 #2-63 Edif Manzanares | Cod: 123456# | tarjeta negra en mesa
  WiFi: Apartamento401/Manzanares401 | perdida tarjeta $20 USD | 3pm/11am
SANTA MARINA 1410: Cj Santa Marina Cra 4 #191-744 Torre 2 (pedir Don Jaca, 5min apto)
  Caja: 1621 -> tarjeta blanca (va en cajita de luz) | WiFi: SHLOFT1410/SHLOFT-1410
  Piscina 9am-9pm (no martes) | Playa 6am-7:45pm | Manillas $29.200/persona | 3pm/12pm
  Transporte: Giovany 3004707945 $30.000 | Late checkout noche: 50% extra

TAYRONA: Troncal Caribe KM 37 (preguntar Casa Grande Surf) Maps: https://maps.app.goo.gl/upAVxdrXxKaExasB8
  Suite Green, Suite Blue, Beach Suites 2 | 4pm/11am
  Wilfer encargado: +57 321 7652591 | WiFi: BEACH SUITES/SUITES1621

PALOMINO: Parcelacion Ukua Casa C1 | Maps: https://maps.app.goo.gl/Lk3WdHzm8bPnwvXK9 | piscina+playa
CURITI: San Gil-Aratoca Km5 | Maps: https://maps.app.goo.gl/Lst6NxMJeWqPDjep6 | 7 cabanas castillo medieval

RESPUESTAS CLAVE:
- Acceso/codigo: "Al completar el registro Hospy recibiras los codigos. Si el link no abre, envianos foto del doc."
- Llegada tarde: "El acceso es autonomo 24h, no hay problema."
- Early check-in: "Check-in desde las 3pm. Si esta listo antes te avisamos. No confirmar sin verificar."
- Check-out: "Solo dejar las llaves en la cajita por favor."
- Late checkout: "$50.000 COP hasta las 2pm, sujeto a disponibilidad."
- Parqueadero: "Si, $15.000 COP/noche, consultar disponibilidad al llegar."
- Domicilios: "Usar direccion exacta CRA 73BIS #64A-67 + apto, no ubicacion del mapa."
- Contacto directo: "Atendemos unicamente por el chat de Airbnb."
- ESTAFA cancelacion: "Unicamente si recibimos una reserva en las mismas fechas podriamos hacer reembolso."
- Agua Bogota: "El agua es potable, puedes tomarla directamente."

TONO: Amable, calido, colombiano natural. Maximo 3 parrafos. 1-2 emojis. Mismo idioma que el huesped.
Firma siempre como "Equipo Super Host Loft" (apto 101: "Diego y Maritza").
NUNCA dar telefono personal. NUNCA prometer cosas sin confirmar.`;

async function generarRespuesta(mensaje, nombreHuesped, propiedad, historial = []) {
  const mensajes = [
    ...historial.slice(-8),
    { role: 'user', content: `Huesped: ${nombreHuesped}\nPropiedad: ${propiedad}\nMensaje: "${mensaje}"` }
  ];
  const res = await axios.post('https://api.anthropic.com/v1/messages',
    { model: 'claude-sonnet-4-20250514', max_tokens: 500, system: SYSTEM_PROMPT, messages: mensajes },
    { headers: { 'x-api-key': CONFIG.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' } }
  );
  return res.data.content[0].text;
}

function esUrgente(msg) {
  return ['emergencia','urgente','inundacion','incendio','robo','no puedo entrar','sin agua','sin luz','herido'].some(k => msg.toLowerCase().includes(k));
}

function esEstafa(msg) {
  const l = msg.toLowerCase();
  return (l.includes('cancelar') || l.includes('reembolso')) && (l.includes('superhost') || l.includes('airbnb me dijo') || l.includes('fuerza mayor'));
}

app.post('/webhook/igms/message', async (req, res) => {
  try {
    const { threadId, guestName, listingName, message } = req.body;
    console.log(`📩 [${listingName}] ${guestName}: "${message}"`);

    if (esEstafa(message)) {
      const r = 'Unicamente si recibimos una reserva en las mismas fechas podriamos hacer el reembolso. Para gestionar la cancelacion comunicate con el servicio al cliente de Airbnb.';
      if (CONFIG.IGMS_API_KEY && threadId) {
        await axios.post(`https://api.igms.com/v1/threads/${threadId}/messages`, { message: r }, { headers: { Authorization: `Bearer ${CONFIG.IGMS_API_KEY}` } });
      }
      console.log('⚠️ ALERTA ESTAFA —', guestName);
      return res.json({ ok: true, alerta: 'estafa' });
    }

    const respuesta = await generarRespuesta(message, guestName, listingName);

    if (CONFIG.IGMS_API_KEY && threadId) {
      await axios.post(`https://api.igms.com/v1/threads/${threadId}/messages`, { message: respuesta }, { headers: { Authorization: `Bearer ${CONFIG.IGMS_API_KEY}` } });
    }

    if (esUrgente(message)) console.log(`🚨 URGENTE — ${guestName}: "${message}"`);
    console.log(`✅ Respuesta enviada a ${guestName}`);
    res.json({ ok: true, respuesta });
  } catch (err) {
    console.error('❌ Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/test', async (req, res) => {
  try {
    const { mensaje, nombre, propiedad } = req.body;
    const respuesta = await generarRespuesta(
      mensaje || '¿A que hora es el check-in?',
      nombre || 'Huesped de prueba',
      propiedad || 'Loft ideal para viajeros cerca al aeropuerto'
    );
    res.json({ ok: true, respuesta, urgente: esUrgente(mensaje || ''), estafa: esEstafa(mensaje || '') });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/health', (req, res) => res.json({
  status: '✅ Asistente Airbnb activo',
  propietario: 'Diego Naranjo · SuperHost Loft',
  version: '2.0',
  timestamp: new Date().toISOString()
}));

app.listen(CONFIG.PORT, () => console.log(`🏨 Asistente SHL v2.0 activo — Puerto ${CONFIG.PORT}`));