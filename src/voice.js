// Hold-to-talk: record while the button is held, turn it into 16 kHz mono WAV in the browser (so the speech
// service needs no extra tools), and send it to the Workshop server, which passes it to the voice service. Nothing leaves the house.
export function holdToTalk(button, { onText, onState }) {
  let rec = null, chunks = [], stream = null
  const start = async e => {
    e.preventDefault()
    if (rec) return
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) }
    catch { onState('Microphone blocked: allow it for this page in the browser settings.'); return }
    chunks = []
    rec = new MediaRecorder(stream)
    rec.ondataavailable = ev => ev.data.size && chunks.push(ev.data)
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      const blob = new Blob(chunks, { type: rec.mimeType }); rec = null
      if (blob.size < 2000) { onState('That was too short; hold the button while you talk.'); return }
      onState('Listening…')
      try {
        const wav = await toWav16k(await blob.arrayBuffer())
        const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav })
        const d = await r.json()
        if (d.text) onText(d.text); else onState(d.error || "I didn't catch that.")
      } catch (err) { onState(`Speech failed (${err.message}).`) }
    }
    rec.start()
    button.classList.add('on'); onState('Recording… let go when you’re done')
  }
  const stop = e => { e.preventDefault(); button.classList.remove('on'); if (rec && rec.state === 'recording') rec.stop() }
  button.addEventListener('pointerdown', start)
  button.addEventListener('pointerup', stop)
  button.addEventListener('pointerleave', stop)
  button.addEventListener('contextmenu', e => e.preventDefault())
}

async function toWav16k(buf) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  const decoded = await ctx.decodeAudioData(buf)
  ctx.close()
  const frames = Math.ceil(decoded.duration * 16000)
  const off = new OfflineAudioContext(1, frames, 16000)
  const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start()
  const pcm = (await off.startRendering()).getChannelData(0)
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2))
  const str = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, 16000, true)
  out.setUint32(28, 32000, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, 'data')
  out.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true)
  return out.buffer
}
