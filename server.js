const express = require('express');
const cron = require('node-cron');
const axios = require('axios');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();
app.use(express.json());

const TOKEN_BRAPI = 'fatF4aWydvJh8HBqoD6WfN';

const ATIVOS_MONITORADOS = [
  'PETR4', 'VALE3', 'ITUB4', 'BBDC4', 'ABEV3',
  'WEGE3', 'RENT3', 'MGLU3', 'HGLG11', 'XPML11'
];

let ultimasCotas = {};

// Tokens dos dispositivos dos usuários (depois vem do banco de dados)
let deviceTokens = [];

async function buscarCotacao(simbolo) {
  try {
    const res = await axios.get(
      `https://brapi.dev/api/quote/${simbolo}?token=${TOKEN_BRAPI}`
    );
    return res.data.results?.[0];
  } catch (e) {
    console.error(`Erro ao buscar ${simbolo}:`, e.message);
    return null;
  }
}

async function dispararNotificacao(titulo, corpo, dados = {}) {
  if (deviceTokens.length === 0) {
    console.log('📵 Nenhum dispositivo registrado ainda');
    return;
  }

  try {
    const mensagem = {
      notification: { title: titulo, body: corpo },
      data: dados,
      tokens: deviceTokens
    };

    const response = await admin.messaging().sendEachForMulticast(mensagem);
    console.log(`✅ Notificação enviada para ${response.successCount} dispositivos`);
  } catch (e) {
    console.error('Erro ao enviar notificação:', e.message);
  }
}

async function verificarAlertas() {
  console.log(`\n[${new Date().toLocaleTimeString('pt-BR')}] Verificando alertas...`);

  for (const simbolo of ATIVOS_MONITORADOS) {
    const ativo = await buscarCotacao(simbolo);
    if (!ativo) continue;

    const precoAtual = ativo.regularMarketPrice;
    const variacao = ativo.regularMarketChangePercent;

    if (ultimasCotas[simbolo]) {
      const variacaoDesdeUltima =
        ((precoAtual - ultimasCotas[simbolo]) / ultimasCotas[simbolo]) * 100;

      if (variacaoDesdeUltima <= -2) {
        console.log(`🔔 ALERTA: ${simbolo} caiu ${Math.abs(variacaoDesdeUltima).toFixed(2)}%`);
        await dispararNotificacao(
          `📉 ${simbolo} está caindo!`,
          `Queda de ${Math.abs(variacaoDesdeUltima).toFixed(2)}% agora. Toque para ver o motivo →`,
          { simbolo, tipo: 'QUEDA', preco: String(precoAtual) }
        );
      }

      if (variacaoDesdeUltima >= 2) {
        console.log(`🔔 ALERTA: ${simbolo} subiu ${variacaoDesdeUltima.toFixed(2)}%`);
        await dispararNotificacao(
          `📈 ${simbolo} está subindo!`,
          `Alta de ${variacaoDesdeUltima.toFixed(2)}% agora. Toque para aproveitar →`,
          { simbolo, tipo: 'ALTA', preco: String(precoAtual) }
        );
      }
    }

    if (Math.abs(variacao) >= 3) {
      console.log(`🔔 ALERTA DIA: ${simbolo} variou ${variacao.toFixed(2)}% hoje`);
      await dispararNotificacao(
        variacao > 0 ? `📈 ${simbolo} em alta hoje!` : `📉 ${simbolo} em queda hoje!`,
        `${variacao > 0 ? 'Subiu' : 'Caiu'} ${Math.abs(variacao).toFixed(2)}% hoje. Acompanhe no app →`,
        { simbolo, tipo: variacao > 0 ? 'ALTA_DIA' : 'QUEDA_DIA', preco: String(precoAtual) }
      );
    }

    ultimasCotas[simbolo] = precoAtual;
    console.log(`  ${simbolo}: R$ ${precoAtual} (${variacao > 0 ? '+' : ''}${variacao?.toFixed(2)}%)`);
  }
}

// Rota pra registrar token do dispositivo
app.post('/registrar-token', (req, res) => {
  const { token } = req.body;
  if (token && !deviceTokens.includes(token)) {
    deviceTokens.push(token);
    console.log(`📱 Novo dispositivo registrado! Total: ${deviceTokens.length}`);
  }
  res.json({ sucesso: true, total_dispositivos: deviceTokens.length });
});

// Roda a cada 20 minutos no horário do mercado
cron.schedule('*/20 * * * *', () => {
  const agora = new Date();
  const hora = agora.getHours();
  const minuto = agora.getMinutes();
  const diaSemana = agora.getDay();

  const ehDiaUtil = diaSemana >= 1 && diaSemana <= 5;
  const ehHorarioDeMercado = (hora > 10) || (hora === 10 && minuto >= 0);
  const ehAntesDoFechamento = hora < 17;

  if (ehDiaUtil && ehHorarioDeMercado && ehAntesDoFechamento) {
    verificarAlertas();
  } else {
    console.log(`[${agora.toLocaleTimeString('pt-BR')}] Mercado fechado — aguardando...`);
  }
});

verificarAlertas();

app.get('/status', (req, res) => {
  res.json({
    status: 'online',
    ativos_monitorados: ATIVOS_MONITORADOS,
    ultima_verificacao: new Date().toLocaleTimeString('pt-BR'),
    cotas_atuais: ultimasCotas,
    dispositivos_registrados: deviceTokens.length
  });
});

app.listen(3000, () => {
  console.log('🚀 Motor de alertas RadarInvest rodando na porta 3000');
  console.log(`📊 Monitorando ${ATIVOS_MONITORADOS.length} ativos`);
  console.log('⏰ Verificando a cada 20 minutos no horário do mercado\n');
});