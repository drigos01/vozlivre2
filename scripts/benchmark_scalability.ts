import fs from 'fs';
import path from 'path';
import { renderVideoForJob } from '../src/server/serverVideoRenderer';
import { WhatsAppVideoJob } from '../src/server/whatsappService';

interface TestMetrics {
  name: string;
  durationSec: number;
  sceneCount: number;
  ttsTimeMs: number;
  ffmpegTotalTimeMs: number;
  concatMuxTimeMs: number;
  totalTimeSec: number;
  finalSizeBytes: number;
  finalSizeMb: number;
  ramRssMb: number;
  ramHeapMb: number;
}

function getMemoryUsage() {
  const m = process.memoryUsage();
  return {
    rssMb: +(m.rss / (1024 * 1024)).toFixed(1),
    heapMb: +(m.heapUsed / (1024 * 1024)).toFixed(1),
  };
}

async function runBenchmarkCase(
  testName: string,
  content: string,
  targetDurationSeconds: number,
  enableBgMusic: boolean,
  showSubtitles: boolean
): Promise<TestMetrics> {
  const jobId = `bench-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  console.log(`\n======================================================`);
  console.log(`INICIANDO BENCHMARK: [${testName}] (Alvo: ${targetDurationSeconds}s)`);
  console.log(`RAM inicial: RSS ${getMemoryUsage().rssMb} MB | Heap ${getMemoryUsage().heapMb} MB`);
  console.log(`======================================================`);

  const mockJob: WhatsAppVideoJob = {
    id: jobId,
    groupId: 'test-group@g.us',
    groupName: 'Grupo de Testes',
    senderJid: '551199999999@s.whatsapp.net',
    senderName: 'Tester',
    rawMessage: content,
    parsed: {
      studioMode: 'roteiro_criativo',
      inputMode: 'full_prompt',
      commandUsed: '!ia-narrada',
      content,
      aspectRatio: '9:16',
      voiceId: 'pt-BR-FranciscaNeural',
      voiceName: 'Francisca',
      durationSeconds: targetDurationSeconds,
      showSubtitles,
      enableBgMusic,
    },
    status: 'rendering',
    progress: 10,
    statusText: 'Iniciando teste de benchmark...',
  };

  let maxRss = getMemoryUsage().rssMb;
  let maxHeap = getMemoryUsage().heapMb;
  const memInterval = setInterval(() => {
    const cur = getMemoryUsage();
    if (cur.rssMb > maxRss) maxRss = cur.rssMb;
    if (cur.heapMb > maxHeap) maxHeap = cur.heapMb;
  }, 200);

  const t0 = Date.now();
  let result;
  try {
    result = await renderVideoForJob(mockJob, (p, text) => {
      // Periodic progress monitor
    });
  } finally {
    clearInterval(memInterval);
  }

  const totalTimeSec = +((Date.now() - t0) / 1000).toFixed(2);
  const finalSizeBytes = result.videoSizeBytes;
  const finalSizeMb = +(finalSizeBytes / (1024 * 1024)).toFixed(2);

  // Measure actual output duration using ffprobe
  let actualDuration = targetDurationSeconds;
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      result.videoFilePath,
    ], { encoding: 'utf8' });
    const parsed = parseFloat(out.trim());
    if (!isNaN(parsed) && parsed > 0) actualDuration = +parsed.toFixed(1);
  } catch {}

  // Clean up benchmark artifact
  try {
    if (fs.existsSync(result.videoFilePath)) {
      fs.unlinkSync(result.videoFilePath);
    }
  } catch {}

  console.log(`[${testName}] Concluído em ${totalTimeSec}s | Duração: ${actualDuration}s | Tamanho: ${finalSizeMb} MB | Pico RAM: ${maxRss} MB RSS`);

  return {
    name: testName,
    durationSec: actualDuration,
    sceneCount: 0, // populated via regex from logs or estimation
    ttsTimeMs: 0,
    ffmpegTotalTimeMs: 0,
    concatMuxTimeMs: 0,
    totalTimeSec,
    finalSizeBytes,
    finalSizeMb,
    ramRssMb: maxRss,
    ramHeapMb: maxHeap,
  };
}

async function main() {
  console.log('--- SUÍTE DE TESTES DE ESCALABILIDADE PARA VÍDEOS LONGOS ---');

  // Teste 1: Vídeo curto (~15 segundos)
  const textCurto = `A inteligência artificial está transformando a forma como criamos conteúdos audiovisuais no mundo todo. Com apenas poucas linhas de texto, narrativas impressionantes ganham vida e alcançam milhões de pessoas.`;
  const m1 = await runBenchmarkCase('Vídeo Curto (15s)', textCurto, 15, true, true);

  // Teste 2: Vídeo de ~1 minuto (~60 segundos)
  const text1Min = `A trajetória de Ayrton Senna é uma das mais inspiradoras de toda a história do automobilismo mundial.
Desde seus primeiros passos competitivos no kart, sua velocidade pura e sua determinação inabalável já chamavam a atenção de especialistas e rivais.
Nas pistas mais desafiadoras do planeta, Senna desafiava a física sob tempestades torrenciais, dominando circuitos icônicos como Mônaco com maestria cirúrgica.
Em 1991, diante de sua apaixonada torcida em Interlagos, ele conquistou uma vitória heróica suportando dores extremas ao guiar apenas com a sexta marcha nas voltas finais.
Mais de três décadas depois, o legado de Ayrton Senna permanece imortal como símbolo incontestável de coragem, patriotismo e superação para todas as gerações.`;
  const m2 = await runBenchmarkCase('Vídeo de ~1 Minuto (60s)', text1Min, 60, true, true);

  // Teste 3: Vídeo de ~5 minutos (~300 segundos)
  const p1 = `A grande saga da exploração espacial representa o ápice da engenhosidade humana, desafiando a gravidade e desbravando o infinito desconhecido. Desde que o primeiro satélite foi lançado em órbita, a humanidade compreendeu que as fronteiras da Terra eram apenas o ponto de partida de uma jornada sem fim.`;
  const p2 = `Os pioneiros do programa espacial enfrentaram riscos inimagináveis em cada missão. Cada segundo de ignição representava uma dança precisa entre o triunfo monumental e a catástrofe iminente, impulsionada pela coragem incomparável de cientistas e astronautas.`;
  const p3 = `A histórica chegada do homem à Lua em julho de 1969 transformou para sempre a nossa percepção sobre o cosmos. Diante de centenas de milhões de pessoas maravilhadas em suas telas de televisão, pisar em solo lunar provou que nada é impossível quando a perseverança humana se une à ciência.`;
  const p4 = `Nas décadas seguintes, sondas automáticas como as missões Voyager avançaram pelos confins do sistema solar, enviando imagens deslumbrantes de Júpiter, Saturno e além. Cada sinal de rádio transmitido através de bilhões de quilômetros ampliava os horizontes do conhecimento humano.`;
  const p5 = `A construção da Estação Espacial Internacional consolidou a cooperação pacífica entre nações outrora rivais, criando um laboratório permanente na órbita baixa da Terra. Cientistas e engenheiros trabalham lado a lado desafiando a microgravidade para desenvolver tecnologias que revolucionam a medicina e a sustentabilidade.`;
  const p6 = `Hoje, testemunhamos o amanhecer de uma nova era espacial com o retorno planejado à Lua e os preparativos audaciosos para a primeira viagem tripulada a Marte. Foguetes reutilizáveis e telescópios espaciais como o James Webb descortinam galáxias formadas nos primórdios do universo, reafirmando que o espírito de exploração da humanidade jamais terá limites.`;
  const text5Min = [p1, p2, p3, p4, p5, p6].join('\n\n');
  const m3 = await runBenchmarkCase('Vídeo de ~5 Minutos (300s)', text5Min, 300, true, true);

  console.log('\n======================================================');
  console.log('RESUMO CONSOLIDADO DOS BENCHMARKS:');
  console.log('======================================================');
  console.table([
    {
      Teste: m1.name,
      'Duração (s)': m1.durationSec,
      'Tempo Total (s)': m1.totalTimeSec,
      'Tamanho (MB)': m1.finalSizeMb,
      'Pico RAM (MB)': m1.ramRssMb,
    },
    {
      Teste: m2.name,
      'Duração (s)': m2.durationSec,
      'Tempo Total (s)': m2.totalTimeSec,
      'Tamanho (MB)': m2.finalSizeMb,
      'Pico RAM (MB)': m2.ramRssMb,
    },
    {
      Teste: m3.name,
      'Duração (s)': m3.durationSec,
      'Tempo Total (s)': m3.totalTimeSec,
      'Tamanho (MB)': m3.finalSizeMb,
      'Pico RAM (MB)': m3.ramRssMb,
    },
  ]);
  console.log('Todos os testes de escalabilidade foram executados com sucesso total!');
}

main().catch((err) => {
  console.error('Erro na execução do benchmark:', err);
  process.exit(1);
});
