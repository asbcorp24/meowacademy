// Live monitoring happens entirely in the browser; the microphone is never routed to speakers.
const $ = id => document.getElementById(id);
let lessons = [], session = null, animation = 0;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const hzText = n => Number.isFinite(n) ? `${Math.round(n)} Гц` : '—';
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function estimatePitch(samples, sampleRate) {
  // Normalized difference function (YIN-like), restricted to the voiced range.
  const minLag = Math.max(2, Math.floor(sampleRate / 1100));
  const maxLag = Math.min(Math.floor(sampleRate / 75), Math.floor(samples.length / 2));
  let sum = 0, peak = 0;
  for (const x of samples) sum += x * x;
  const rms = Math.sqrt(sum / samples.length);
  if (rms < .009) return { f0: null, rms };
  const differences = new Float32Array(maxLag + 1);
  let running = 0, bestLag = 0, bestValue = 1;
  // Only the last 2048 samples are needed; keep analysis fast on mobile.
  const count = Math.min(2048, samples.length - maxLag);
  for (let lag = 1; lag <= maxLag; lag++) {
    let diff = 0;
    for (let i = 0; i < count; i += 2) {
      const delta = samples[i] - samples[i + lag];
      diff += delta * delta;
    }
    differences[lag] = diff;
    running += diff;
    if (lag < minLag) continue;
    const value = diff * lag / (running + 1e-12);
    if (value < bestValue) { bestLag = lag; bestValue = value; }
    if (value < .13) {
      // Favor the first convincing periodicity rather than an octave multiple.
      let next = lag;
      while (next < maxLag && differences[next + 1] !== 0 && differences[next + 1] < differences[next]) next++;
      return { f0: sampleRate / next, rms };
    }
  }
  return { f0: bestValue < .24 ? sampleRate / bestLag : null, rms };
}

function atTime(frames, seconds) {
  if (!frames.length) return null;
  let low = 0, high = frames.length - 1;
  while (low < high) { const mid = (low + high) >> 1; if (frames[mid].t < seconds) low = mid + 1; else high = mid; }
  return frames[Math.abs((frames[low - 1]?.t ?? Infinity) - seconds) < Math.abs(frames[low].t - seconds) ? low - 1 : low];
}

function drawChart(id, points, key, min, max, time, duration) {
  const canvas = $(id), context = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  context.clearRect(0, 0, w, h);
  context.strokeStyle = '#e8e1f0'; context.lineWidth = 1;
  for (let j = 0; j < 5; j++) { const y = 15 + j * (h - 30) / 4; context.beginPath(); context.moveTo(0, y); context.lineTo(w, y); context.stroke(); }
  const x = t => clamp(t / Math.max(.1, duration), 0, 1) * (w - 30) + 15;
  for (const [field, color] of [['ref', '#19aa9e'], ['mic', '#ef8b78']]) {
    context.strokeStyle = color; context.lineWidth = 3; context.beginPath(); let started = false;
    for (const point of points) {
      const value = point[key]?.[field];
      if (!Number.isFinite(value)) { started = false; continue; }
      const px = x(point.t), py = 15 + (1 - clamp((value - min) / (max - min), 0, 1)) * (h - 30);
      if (started) context.lineTo(px, py); else context.moveTo(px, py);
      started = true;
    }
    context.stroke();
  }
  context.strokeStyle = '#9465d4'; context.lineWidth = 2; context.beginPath();context.moveTo(x(time), 0);context.lineTo(x(time), h);context.stroke();
}

function updateHint(ref, mic, points) {
  const tip = $('tip');
  if (!Number.isFinite(mic.f0)) { $('match').textContent = '—'; tip.textContent = '🎙 Мяукай увереннее — пока не удаётся выделить высоту голоса.'; return; }
  if (!Number.isFinite(ref?.f0)) { $('match').textContent = '—'; tip.textContent = '🐾 Сейчас котик молчит. Готовься к следующему мяу!'; return; }
  // Compare both absolute pitch and the direction of the melodic contour.
  const pitchDiff = 12 * Math.log2(mic.f0 / ref.f0);
  const match = Math.round(100 * Math.exp(-Math.abs(pitchDiff) / 7));
  $('match').textContent = `${match}%`;
  let contourTip = '';
  const voiced = points.filter(p => Number.isFinite(p.pitch.ref) && Number.isFinite(p.pitch.mic));
  if (voiced.length > 8) {
    const older = voiced[Math.max(0, voiced.length - 9)];
    const olderRef = older.pitch.ref, olderMic = older.pitch.mic;
    const refMove = 12 * Math.log2(ref.f0 / olderRef);
    const micMove = 12 * Math.log2(mic.f0 / olderMic);
    if (Number.isFinite(refMove) && Number.isFinite(micMove) && Math.abs(refMove - micMove) > 2.5) contourTip = refMove > micMove ? ' Веди интонацию выше ↗' : ' Веди интонацию ниже ↘';
  }
  let advice = Math.abs(pitchDiff) <= 2 ? 'Отлично, высота близка к эталону! ✨' : pitchDiff > 0 ? `Опусти голос примерно на ${Math.round(pitchDiff)} полутон(а) ↘` : `Подними голос примерно на ${Math.round(-pitchDiff)} полутон(а) ↗`;
  if (ref.rms > .01 && mic.rms < ref.rms * .45) advice += ' · Мяукай чуть громче.';
  else if (mic.rms > Math.max(ref.rms * 2, .04)) advice += ' · Попробуй чуть тише.';
  tip.textContent = `🐱 ${advice}${contourTip}`;
}

function tick() {
  if (!session) return;
  const { audio, analyser, wave, context, frames, points } = session;
  analyser.getFloatTimeDomainData(wave);
  const mic = estimatePitch(wave, context.sampleRate);
  const t = clamp(audio.currentTime + Number($('offset').value) / 1000, 0, session.duration);
  const reference = atTime(frames, t);
  if (!session.lastSample || performance.now() - session.lastSample > 45) {
    points.push({ t, pitch: { ref: reference?.f0 ?? null, mic: mic.f0 }, volume: { ref: reference?.rms ?? 0, mic: mic.rms } });
    session.lastSample = performance.now();
    if (points.length > 2500) points.shift();
    updateHint(reference, mic, points);
    $('userPitch').textContent = hzText(mic.f0);
    $('refPitch').textContent = hzText(reference?.f0);
    const pitches = points.flatMap(p => [p.pitch.ref, p.pitch.mic]).filter(Number.isFinite);
    const low = pitches.length ? Math.max(70, Math.min(...pitches) * .82) : 80;
    const high = pitches.length ? Math.max(low + 120, Math.max(...pitches) * 1.15) : 1000;
    drawChart('pitchChart', points, 'pitch', low, high, t, session.duration);
    const loudMax = Math.max(.08, ...points.map(p => Math.max(p.volume.ref, p.volume.mic))) * 1.15;
    drawChart('volumeChart', points, 'volume', 0, loudMax, t, session.duration);
    $('progress').style.width = `${clamp(audio.currentTime / session.duration, 0, 1) * 100}%`;
    $('time').textContent = `${mmss(audio.currentTime)} / ${mmss(session.duration)}`;
  }
  animation = requestAnimationFrame(tick);
}

function stop(reason = 'Дуэт остановлен. Можешь повторить ещё раз! 🐾') {
  cancelAnimationFrame(animation);
  const previous = session; session = null;
  if (previous) {
    previous.audio.pause(); previous.audio.removeAttribute('src'); previous.audio.load();
    previous.stream.getTracks().forEach(track => track.stop());
    previous.context.close().catch(() => {});
  }
  $('start').disabled = lessons.length === 0; $('lesson').disabled = false; $('stop').disabled = true;
  $('status').textContent = reason;
}

async function start() {
  const lesson = lessons.find(l => String(l.id) === $('lesson').value);
  if (!lesson) return;
  $('start').disabled = true; $('lesson').disabled = true; $('status').textContent = 'Подключаю микрофон и подготавливаю звук…';
  let context, stream, audio;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Для доступа к микрофону открой сайт по HTTPS или на localhost.');
    context = new AudioContext();
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const analyser = context.createAnalyser(); analyser.fftSize = 4096;
    context.createMediaStreamSource(stream).connect(analyser); // Deliberately no connection to destination.
    audio = new Audio(); audio.preload = 'auto'; audio.src = lesson.audio_path;
    const source = context.createMediaElementSource(audio), gain = context.createGain();
    gain.gain.value = Number($('volume').value) / 100;
    source.connect(gain).connect(context.destination);
    audio.addEventListener('ended', () => stop('Дуэт завершён! 🐈 Нажми «Начать» для новой попытки.'), { once: true });
    await new Promise((resolve, reject) => { audio.addEventListener('loadedmetadata', resolve, { once: true }); audio.addEventListener('error', () => reject(new Error('Не удалось загрузить эталон.')), { once: true }); audio.load(); });
    const frames = lesson.features?.frames || [];
    if (!frames.length) throw new Error('Для этого урока нет акустических данных. Перезагрузи его через админку.');
    session = { context, stream, analyser, gain, wave: new Float32Array(analyser.fftSize), audio, frames, points: [], duration: audio.duration };
    $('progress').style.width = '0%'; $('time').textContent = `0:00 / ${mmss(audio.duration)}`;
    await context.resume(); await audio.play();
    $('status').textContent = '🔴 Дуэт идёт! Слушай и мяукай одновременно.'; $('stop').disabled = false;
    tick();
  } catch (error) {
    if (session) stop(`Не удалось запустить дуэт: ${error.message}`);
    else { audio?.pause(); stream?.getTracks().forEach(t => t.stop()); await context?.close().catch(() => {}); $('start').disabled = false; $('lesson').disabled = false; $('status').textContent = `Не удалось запустить дуэт: ${error.message}`; }
  }
}

function escapeHtml(str) { return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
async function init() {
  const response = await fetch('/api/lessons'); if (!response.ok) throw new Error(`HTTP ${response.status}`);
  lessons = (await response.json()).map(l => ({ ...l, features: typeof l.features === 'string' ? JSON.parse(l.features) : l.features }));
  $('lesson').innerHTML = lessons.length ? lessons.map(l => `<option value="${l.id}">${escapeHtml(l.title)}</option>`).join('') : '<option>Уроков пока нет</option>';
  $('start').disabled = !lessons.length;
  $('lesson').onchange = () => { $('description').textContent = lessons.find(l => String(l.id) === $('lesson').value)?.description || ''; };
  $('lesson').onchange();
}
$('volume').oninput = () => { $('volumeValue').textContent = `${$('volume').value}%`; if (session) session.gain.gain.value = Number($('volume').value) / 100; };
$('offset').oninput = () => { $('offsetValue').textContent = `${$('offset').value} мс`; };
$('start').onclick = start;
$('stop').onclick = () => stop();
init().catch(error => { $('status').textContent = `Не удалось загрузить уроки: ${error.message}`; $('start').disabled = true; });
