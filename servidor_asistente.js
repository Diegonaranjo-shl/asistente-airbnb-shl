// ============================================================
// ASISTENTE IA AIRBNB — SHL v4.0
// ============================================================
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const app = express();
app.use(express.json());

const CONFIG = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  IGMS_EMAIL:        process.env.IGMS_EMAIL       || 'diego.anfitrion@gmail.com',
  IGMS_PASSWORD:     process.env.IGMS_PASSWORD     || 'Igsm1280.',
  IGMS_CLIENT_ID:    parseInt(process.env.IGMS_CLIENT_ID || '93483'),
  TTLOCK_CLIENT_ID:     process.env.TTLOCK_CLIENT_ID     || 'ef6d462b1ccd42b7a332b0113de71f97',
  TTLOCK_CLIENT_SECRET: process.env.TTLOCK_CLIENT_SECRET || 'effa57da6d6e5ea588190ab457585c6c',
  TTLOCK_USERNAME:      process.env.TTLOCK_USERNAME      || 'diego.anfitrion@gmail.com',
  TTLOCK_PASSWORD:      process.env.TTLOCK_PASSWORD      || 'Airbnb1280.',
  TTLOCK_LOCK_PORTON:   parseInt(process.env.TTLOCK_LOCK_ID_PORTON || '6778458'),
  PORT: process.env.PORT || 3000,
  version: '4.0',
};