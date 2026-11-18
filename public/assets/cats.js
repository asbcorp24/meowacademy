import { analyze } from './dsp.js';
const $ = id => document.getElementById(id);
let selected = null, previewUrl = null;

function wavFromBuffer(buffer) {
  const samples = buffer.getChannelData(0);
  const wav = new ArrayBuffer(44 + samples.length * 2), view = new DataView(wav);
  const ascii = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  ascii(0, 'RIFF'); view.setUint32(4, wav.byteLength - 8, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767), true);
  }
  return new Blob([wav], { type: 'audio/wav' });
}

async function prepare(file) {
  if (file.size > 12_000_000) throw new Error('Файл слишком большой (максимум 12 МБ).');
  const context = new AudioContext();
  let decoded;
  try { decoded = await context.decodeAudioData(await file.arrayBuffer()); }
  finally { await context.close(); }
  if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > 10.0001) throw new Error('Запись должна быть не длиннее 10 секунд.');
  const length = Math.round(decoded.duration * 16000);
  const offline = new OfflineAudioContext(1, length, 16000);
  const source = offline.createBufferSource(); source.buffer = decoded;
  source.connect(offline.destination); source.start(0);
  const normalized = await offline.startRendering();
  return { blob: wavFromBuffer(normalized), features: analyze(normalized), duration: normalized.duration };
}

async function listCats() {
  try {
    const response = await fetch('/api/cats'); if (!response.ok) throw new Error('Ошибка сервера');
    const cats = await response.json(); const container = $('catList'); container.replaceChildren();
    if (!cats.length) { container.textContent = 'Пока нет одобренных мяуканий. Будь первым! 🐈'; return; }
    for (const cat of cats) {
      const card = document.createElement('div'); card.className = 'cat-card';
      const title = document.createElement('strong'); title.textContent = `🐱 ${cat.cat_name}`;
      const info = document.createElement('small'); info.textContent = `${Number(cat.duration).toFixed(1)} сек.`;
      const player = document.createElement('audio'); player.controls = true; player.preload = 'none'; player.src = cat.audio_path;
      card.append(title, info, player); container.append(card);
    }
  } catch { $('catList').textContent = 'Не удалось получить записи. Попробуй обновить страницу.'; }
}

$('catAudio').addEventListener('change', async event => {
  const file = event.target.files?.[0]; selected = null;
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  $('preview').hidden = true; $('duration').textContent = '';
  if (!file) return;
  $('submit').disabled = true; $('uploadStatus').textContent = 'Проверяю длительность и подготавливаю звук…';
  try {
    selected = await prepare(file);
    previewUrl = URL.createObjectURL(selected.blob); $('preview').src = previewUrl; $('preview').hidden = false;
    $('duration').textContent = `Длительность: ${selected.duration.toFixed(1)} сек. · Готово к отправке`;
    $('uploadStatus').textContent = 'Прослушай запись и нажми «Отправить мяуканье».';
  } catch (error) { $('uploadStatus').textContent = error.message; }
  finally { $('submit').disabled = !selected; }
});

$('upload').addEventListener('submit', async event => {
  event.preventDefault(); if (!selected) return;
  $('submit').disabled = true; $('uploadStatus').textContent = 'Отправляю мяуканье…';
  try {
    const csrfResponse = await fetch('/api/csrf'); if (!csrfResponse.ok) throw new Error('Не удалось получить токен загрузки.');
    const { csrf } = await csrfResponse.json();
    const data = new FormData(); data.append('cat_name', $('catName').value.trim()); data.append('audio', selected.blob, 'cat-meow.wav'); data.append('features', JSON.stringify(selected.features));
    const response = await fetch('/api/cats', { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: data });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Не удалось загрузить файл.');
    $('uploadStatus').textContent = '✅ Мяуканье отправлено! После одобрения оно появится в уроках.';
    $('upload').reset(); selected = null; $('preview').hidden = true; $('duration').textContent = '';
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  } catch (error) { $('uploadStatus').textContent = `Ошибка: ${error.message}`; }
  finally { $('submit').disabled = !selected; }
});
listCats();
