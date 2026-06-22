'use strict';

const admin = require('firebase-admin');

const BOLAO_COLLECTION = process.env.BOLAO_COLLECTION || 'boloes';
const BOLAO_DOC_ID = process.env.BOLAO_DOC_ID || 'copa2026';
const ESPN_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';

const espnTeamMap = {
  'South Africa':'África do Sul','Germany':'Alemanha','Saudi Arabia':'Arábia Saudita','Algeria':'Argélia','Argentina':'Argentina','Australia':'Austrália','Austria':'Áustria','Belgium':'Bélgica','Bosnia and Herzegovina':'Bósnia e Herzegovina','Brazil':'Brasil','Cape Verde':'Cabo Verde','Cameroon':'Camarões','Canada':'Canadá','Qatar':'Catar','Colombia':'Colômbia','South Korea':'Coreia do Sul','Korea Republic':'Coreia do Sul','Ivory Coast':'Costa do Marfim','Côte d’Ivoire':'Costa do Marfim','Croatia':'Croácia','Curacao':'Curaçao','Curaçao':'Curaçao','Egypt':'Egito','Ecuador':'Equador','Scotland':'Escócia','Spain':'Espanha','United States':'Estados Unidos','USA':'Estados Unidos','France':'França','Ghana':'Gana','Haiti':'Haiti','Netherlands':'Holanda','England':'Inglaterra','Iran':'Irã','Iraq':'Iraque','Japan':'Japão','Jordan':'Jordânia','Morocco':'Marrocos','Mexico':'México','Nigeria':'Nigéria','Norway':'Noruega','New Zealand':'Nova Zelândia','Panama':'Panamá','Paraguay':'Paraguai','Portugal':'Portugal','DR Congo':'RD Congo','Congo DR':'RD Congo','Czechia':'República Tcheca','Czech Republic':'República Tcheca','Senegal':'Senegal','Sweden':'Suécia','Switzerland':'Suíça','Tunisia':'Tunísia','Turkey':'Turquia','Türkiye':'Turquia','Uruguay':'Uruguai','Uzbekistan':'Uzbequistão'
};

function initFirebase() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Secret FIREBASE_SERVICE_ACCOUNT_JSON não configurado.');

  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return admin.firestore();
}

function normalizeTeamName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function mapEspnTeam(name) {
  return espnTeamMap[String(name || '').trim()] || String(name || '').trim();
}

function yyyymmdd(dateValue) {
  return String(dateValue || '').replaceAll('-', '');
}

function datePartsSaoPaulo(iso) {
  const d = new Date(iso);
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d);
  const timeParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(d);
  const get = (parts, type) => parts.find(p => p.type === type)?.value;
  return {
    date: `${get(dateParts, 'year')}-${get(dateParts, 'month')}-${get(dateParts, 'day')}`,
    time: `${get(timeParts, 'hour')}:${get(timeParts, 'minute')}`
  };
}

function extractEspnEvent(ev) {
  const comp = ev.competitions?.[0] || {};
  const competitors = comp.competitors || [];
  const homeC = competitors.find(c => c.homeAway === 'home') || competitors[0] || {};
  const awayC = competitors.find(c => c.homeAway === 'away') || competitors[1] || {};
  const home = mapEspnTeam(homeC.team?.displayName || homeC.team?.name || '');
  const away = mapEspnTeam(awayC.team?.displayName || awayC.team?.name || '');
  const dt = datePartsSaoPaulo(ev.date);
  const statusObj = ev.status || comp.status || {};
  const status = statusObj.type || {};
  const state = status.state || '';
  const completed = !!status.completed;
  const hasScore = state !== 'pre' || completed;

  return {
    espnId: String(ev.id || ''),
    espnUid: String(ev.uid || ''),
    home,
    away,
    date: dt.date,
    time: dt.time,
    round: `Rodada ${dt.date.split('-').slice(1).reverse().join('/')}`,
    homeScore: hasScore ? String(homeC.score ?? '') : '',
    awayScore: hasScore ? String(awayC.score ?? '') : '',
    state,
    completed,
    statusName: status.name || '',
    statusDescription: status.description || '',
    shortDetail: status.shortDetail || '',
    clock: Number(statusObj.clock || 0),
    displayClock: String(statusObj.displayClock || '')
  };
}

async function fetchEspnDate(dateValue) {
  const url = `${ESPN_BASE_URL}?dates=${yyyymmdd(dateValue)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status} em ${dateValue}`);
  const json = await res.json();
  return (json.events || [])
    .map(extractEspnEvent)
    .filter(x => x.espnId && x.home && x.away);
}

function findByTeamsAndDate(games, item) {
  const nh = normalizeTeamName(item.home);
  const na = normalizeTeamName(item.away);
  return games.find(g =>
    String(g.date || '') === item.date &&
    normalizeTeamName(g.home) === nh &&
    normalizeTeamName(g.away) === na
  );
}

function applyEspnItemToGame(g, item, participants) {
  const beforeHome = String(g.homeScore ?? '');
  const beforeAway = String(g.awayScore ?? '');
  const wasCompleted = !!g.espnCompleted;

  g.round = g.round || item.round;
  g.date = item.date;
  g.time = item.time;
  g.home = g.home || item.home;
  g.away = g.away || item.away;

  if (item.homeScore !== '' && item.awayScore !== '') {
    g.homeScore = item.homeScore;
    g.awayScore = item.awayScore;
  }

  if (!g.guesses) g.guesses = {};
  participants.forEach(p => {
    if (!g.guesses[p.id]) g.guesses[p.id] = { home: '', away: '' };
  });

  g.espnId = item.espnId;
  g.espnUid = item.espnUid;
  g.espnStatus = item.statusName;
  g.espnState = item.state;
  g.espnCompleted = item.completed;
  g.espnClock = item.clock || 0;
  g.espnDisplayClock = item.displayClock || '';
  g.source = 'espn';
  g.espnLastSyncAt = new Date().toISOString();

  return {
    scoreChanged: beforeHome !== String(g.homeScore ?? '') || beforeAway !== String(g.awayScore ?? ''),
    finalized: !wasCompleted && !!g.espnCompleted
  };
}

async function main() {
  const db = initFirebase();
  const ref = db.collection(BOLAO_COLLECTION).doc(BOLAO_DOC_ID);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Documento ${BOLAO_COLLECTION}/${BOLAO_DOC_ID} não encontrado.`);

  const data = snap.data() || {};
  const games = Array.isArray(data.games) ? data.games : [];
  const participants = Array.isArray(data.participants) ? data.participants : [];

  const pending = games.filter(g => g.espnId && g.espnCompleted !== true);
  if (!pending.length) {
    console.log('Nenhum jogo pendente com espnId. Nada para atualizar.');
    return;
  }

  const dates = [...new Set(pending.map(g => g.date).filter(Boolean))];
  console.log(`Atualizando ${pending.length} jogo(s) pendente(s) em ${dates.length} data(s): ${dates.join(', ')}`);

  const allEspn = [];
  for (const date of dates) {
    const items = await fetchEspnDate(date);
    allEspn.push(...items);
    console.log(`${date}: ${items.length} jogo(s) ESPN.`);
  }

  const byId = new Map(allEspn.map(item => [String(item.espnId), item]));
  let updated = 0;
  let scoreUpdated = 0;
  let finalized = 0;
  let notFound = 0;

  pending.forEach(g => {
    let item = byId.get(String(g.espnId));
    if (!item) item = allEspn.find(i => findByTeamsAndDate([g], i));
    if (!item) {
      notFound++;
      console.log(`Não encontrado na ESPN: ${g.home} x ${g.away} (${g.date}) espnId=${g.espnId}`);
      return;
    }

    const r = applyEspnItemToGame(g, item, participants);
    updated++;
    if (r.scoreChanged) scoreUpdated++;
    if (r.finalized) finalized++;
  });

  await ref.set({
    ...data,
    games,
    ultimaAtualizacao: new Date().toISOString(),
    ultimaAutomacaoEspn: {
      updatedAt: new Date().toISOString(),
      pendingFound: pending.length,
      updated,
      scoreUpdated,
      finalized,
      notFound
    }
  }, { merge: true });

  console.log(`Concluído: ${updated} atualizado(s), ${scoreUpdated} placar(es) alterado(s), ${finalized} finalizado(s), ${notFound} não encontrado(s).`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
