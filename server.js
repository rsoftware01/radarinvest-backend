const express = require('express');
const cron = require('node-cron');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const TOKEN_BRAPI = 'fatF4aWydvJh8HBqoD6WfN';

const supabase = createClient(
  'https://toxfcffhboltszvsldiu.supabase.co',
  'sb_publishable_h8fQkwR8g7G2FROjA8l_kQ_njtGVo1d'
);

const ATIVOS_MONITORADOS = [
  'PETR4', 'VALE3', 'ITUB4', 'BBDC4', 'ABEV3',
  'WEGE3', 'RENT3', 'MGLU3', 'HGLG11', 'XPML11'
];

let ultimasCotas = {};
let deviceTokens = [];

async function carregarTokens() {
  try {
    const { data } = await supabase.from('device_tokens').select('token');
    deviceTokens = data?.map(d => d.token) || [];
    console.log(`📱 ${deviceTokens.length} tokens carregados do banco`);
  } catch (e) {
    console.error('Erro ao carregar tokens:', e.message);
  }
}

async function buscarCotacao(simbolo) {
  try {
    const res = await axios.get(`https://brapi.dev/api/quote/${simbolo}?token=${TOKEN_BRAPI}`);
    return res.data.results?.[0];
  } catch (e) {
    console.error(`Erro ao buscar ${simbolo}:`, e.message);
    return null;
  }
}

async function dispararNotificacao(titulo, corpo, dados = {}) {
  try {
    const { data: tokensData } = await supabase.from('device_tokens').select('token');
    const tokens = tokensData?.map(d => d.token) || [];

    if (tokens.length === 0) {
      console.log('📵 Nenhum dispositivo registrado');
      return;
    }

    console.log(`📤 Enviando pra ${tokens.length} dispositivos...`);

    const messages = tokens.map(token => ({
      to: token,
      title: titulo,
      body: corpo,
      data: dados,
      sound: 'default',
      priority: 'high',
    }));

    const response = await axios.post(
      'https://exp.host/--/api/v2/push/send',
      messages,
      { headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' } }
    );

    const resultado = response.data;
      console.log(`✅ Resposta Expo:`, JSON.stringify(resultado));
      if (resultado.data) {
        resultado.data.forEach(item => {
          if (item.status === 'error') {
            console.log(`❌ Erro no token: ${item.message} - ${item.details}`);
          } else {
            console.log(`✅ Enviado com sucesso! Receipt: ${item.id}`);
          }
        });
      }
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
    const precoAbertura = ativo.regularMarketOpen;
    const variacaoDesdeAbertura = ((precoAtual - precoAbertura) / precoAbertura) * 100;
    const variacaoDia = ativo.regularMarketChangePercent;

    if (variacaoDesdeAbertura <= -2) {
      await dispararNotificacao(
        `📉 ${simbolo} está caindo!`,
        `Queda de ${Math.abs(variacaoDesdeAbertura).toFixed(2)}% desde a abertura. Toque para ver o motivo →`,
        { simbolo, tipo: 'QUEDA', preco: String(precoAtual) }
      );
    }

    if (variacaoDesdeAbertura >= 2) {
      await dispararNotificacao(
        `📈 ${simbolo} está subindo!`,
        `Alta de ${variacaoDesdeAbertura.toFixed(2)}% desde a abertura. Toque para aproveitar →`,
        { simbolo, tipo: 'ALTA', preco: String(precoAtual) }
      );
    }

    if (Math.abs(variacaoDia) >= 3) {
      await dispararNotificacao(
        variacaoDia > 0 ? `📈 ${simbolo} em alta hoje!` : `📉 ${simbolo} em queda hoje!`,
        `${variacaoDia > 0 ? 'Subiu' : 'Caiu'} ${Math.abs(variacaoDia).toFixed(2)}% hoje. Acompanhe no app →`,
        { simbolo, tipo: variacaoDia > 0 ? 'ALTA_DIA' : 'QUEDA_DIA', preco: String(precoAtual) }
      );
    }

    ultimasCotas[simbolo] = precoAtual;
    console.log(`  ${simbolo}: R$ ${precoAtual} (${variacaoDesdeAbertura > 0 ? '+' : ''}${variacaoDesdeAbertura.toFixed(2)}%)`);
  }
}

app.post('/registrar-token', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.json({ sucesso: false });
  try {
    await supabase.from('device_tokens').upsert({ token });
    if (!deviceTokens.includes(token)) {
      deviceTokens.push(token);
      console.log(`📱 Novo dispositivo! Total: ${deviceTokens.length}`);
    }
    res.json({ sucesso: true, total_dispositivos: deviceTokens.length });
  } catch (e) {
    console.error('Erro:', e.message);
    res.json({ sucesso: false });
  }
});

app.post('/boas-vindas', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.json({ sucesso: false });
  try {
    await axios.post(
      'https://exp.host/--/api/v2/push/send',
      {
        to: token,
        title: '👋 Bem-vindo ao RadarInvest!',
        body: 'Todas as informações do mercado na palma da sua mão. Fique sempre à frente! 📊',
        sound: 'default',
      },
      { headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' } }
    );
    console.log('✅ Boas vindas enviadas!');
    res.json({ sucesso: true });
  } catch (e) {
    console.error('Erro:', e.message);
    res.json({ sucesso: false });
  }
});

app.post('/testar-notificacao', async (req, res) => {
  await dispararNotificacao(
    '🔔 Teste RadarInvest!',
    'Se você recebeu isso, as notificações estão funcionando! 🚀',
    { tipo: 'TESTE' }
  );
  res.json({ sucesso: true, dispositivos: deviceTokens.length });
});

cron.schedule('*/10 * * * *', () => {
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
    console.log(`[${agora.toLocaleTimeString('pt-BR')}] Mercado fechado`);
  }
});

cron.schedule('5 10 * * 1-5', async () => {
  const resultados = [];
  for (const simbolo of ['PETR4', 'VALE3', 'ITUB4']) {
    const ativo = await buscarCotacao(simbolo);
    if (ativo) resultados.push(`${simbolo}: ${ativo.regularMarketChangePercent > 0 ? '+' : ''}${ativo.regularMarketChangePercent?.toFixed(2)}%`);
  }
  const ibov = await buscarCotacao('^BVSP');
  const variacaoIbov = ibov?.regularMarketChangePercent;
  await dispararNotificacao(
    `🔔 Mercado abriu ${variacaoIbov >= 0 ? 'em alta' : 'em queda'}!`,
    `Ibovespa ${variacaoIbov > 0 ? '+' : ''}${variacaoIbov?.toFixed(2)}% | ${resultados.join(' | ')}`,
    { tipo: 'ABERTURA' }
  );
});

cron.schedule('5 17 * * 1-5', async () => {
  const resultados = [];
  for (const simbolo of ['PETR4', 'VALE3', 'ITUB4']) {
    const ativo = await buscarCotacao(simbolo);
    if (ativo) resultados.push(`${simbolo}: ${ativo.regularMarketChangePercent > 0 ? '+' : ''}${ativo.regularMarketChangePercent?.toFixed(2)}%`);
  }
  const ibov = await buscarCotacao('^BVSP');
  const variacaoIbov = ibov?.regularMarketChangePercent;
  await dispararNotificacao(
    `📊 Mercado fechou ${variacaoIbov >= 0 ? 'positivo' : 'negativo'}!`,
    `Ibovespa ${variacaoIbov > 0 ? '+' : ''}${variacaoIbov?.toFixed(2)}% | ${resultados.join(' | ')}`,
    { tipo: 'FECHAMENTO' }
  );
});

cron.schedule('0 11,12,13,14,15,16 * * 1-5', async () => {
  const ibov = await buscarCotacao('^BVSP');
  if (!ibov) return;
  const variacao = ibov.regularMarketChangePercent;
  if (Math.abs(variacao) < 0.5) return;
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  await dispararNotificacao(
    `${variacao >= 0 ? '📈' : '📉'} Ibovespa agora — ${hora}`,
    `${ibov.regularMarketPrice?.toLocaleString('pt-BR')} pts • ${variacao > 0 ? '+' : ''}${variacao?.toFixed(2)}% desde abertura`,
    { tipo: 'HORA_EM_HORA' }
  );
});

setInterval(async () => {
  try {
    await axios.get('https://radarinvest-backend.onrender.com/status');
    console.log('💓 Servidor ativo');
  } catch (e) {}
}, 10 * 60 * 1000);

app.get('/status', (req, res) => {
  res.json({
    status: 'online',
    ativos_monitorados: ATIVOS_MONITORADOS,
    ultima_verificacao: new Date().toLocaleTimeString('pt-BR'),
    cotas_atuais: ultimasCotas,
    dispositivos_registrados: deviceTokens.length
  });
});

carregarTokens();
verificarAlertas();

app.listen(3000, () => {
  console.log('🚀 Motor de alertas RadarInvest rodando na porta 3000');
  console.log(`📊 Monitorando ${ATIVOS_MONITORADOS.length} ativos`);
  console.log('⏰ Verificando a cada 10 minutos no horário do mercado\n');
});