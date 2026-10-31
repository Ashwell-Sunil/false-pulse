// Node.js script to generate clean 16-bit PCM RIFF WAV audio assets
import fs from 'fs';
import path from 'path';

function createWavBuffer(sampleRate, samples) {
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF chunk descriptor
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt sub-chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // subchunk1 size (16 for PCM)
  buffer.writeUInt16LE(1, 20);  // audio format (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34); // bits per sample

  // data sub-chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Write samples
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
    buffer.writeInt16LE(Math.floor(val), 44 + i * 2);
  }

  return buffer;
}

const sampleRate = 44100;
const outputDir = path.resolve('audio');

// 1. static.mp3 / static.wav: 3 seconds loopable low ambient room static / filtered noise
{
  const duration = 3.0;
  const totalSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(totalSamples);
  let b0 = 0, b1 = 0, b2 = 0;
  
  for (let i = 0; i < totalSamples; i++) {
    const white = Math.random() * 2 - 1;
    // Pink / low-pass filter
    b0 = 0.99 * b0 + white * 0.05;
    b1 = 0.95 * b1 + white * 0.03;
    b2 = 0.90 * b2 + white * 0.02;
    let s = (b0 + b1 + b2) * 0.4;
    
    // Smooth crossfade loop boundaries
    const fadeLen = 2000;
    if (i < fadeLen) {
      const alpha = i / fadeLen;
      s = s * alpha + samples[totalSamples - fadeLen + i] * (1 - alpha);
    }
    samples[i] = s;
  }
  
  const wav = createWavBuffer(sampleRate, samples);
  fs.writeFileSync(path.join(outputDir, 'static.mp3'), wav);
  fs.writeFileSync(path.join(outputDir, 'static.wav'), wav);
  console.log('Generated static.mp3 & static.wav');
}

// 2. heartbeat_imposter.mp3: Deep visceral double thump (lub-dub) ~ 0.8s
{
  const duration = 1.0;
  const totalSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(totalSamples);

  function thump(offsetSec, peakFreq, durationSec, amp) {
    const startIdx = Math.floor(offsetSec * sampleRate);
    const count = Math.floor(durationSec * sampleRate);
    for (let i = 0; i < count && (startIdx + i) < totalSamples; i++) {
      const t = i / sampleRate;
      const progress = i / count;
      const env = Math.sin(progress * Math.PI) * Math.exp(-progress * 4);
      const freq = peakFreq * (1 - progress * 0.4);
      const val = Math.sin(2 * Math.PI * freq * t) * env * amp;
      samples[startIdx + i] += val;
    }
  }

  // Lub
  thump(0.05, 75, 0.22, 0.95);
  // Dub
  thump(0.32, 60, 0.26, 0.85);

  const wav = createWavBuffer(sampleRate, samples);
  fs.writeFileSync(path.join(outputDir, 'heartbeat_imposter.mp3'), wav);
  fs.writeFileSync(path.join(outputDir, 'heartbeat_imposter.wav'), wav);
  console.log('Generated heartbeat_imposter.mp3 & .wav');
}

// 3. heartbeat_decoy.mp3: Distinct softer rhythmic heartbeat (higher pitch, hollow metallic pulse)
{
  const duration = 1.0;
  const totalSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(totalSamples);

  function decoyThump(offsetSec, freq, durationSec, amp) {
    const startIdx = Math.floor(offsetSec * sampleRate);
    const count = Math.floor(durationSec * sampleRate);
    for (let i = 0; i < count && (startIdx + i) < totalSamples; i++) {
      const t = i / sampleRate;
      const progress = i / count;
      const env = Math.sin(progress * Math.PI) * Math.exp(-progress * 6);
      // Hollow tone with 2nd harmonic
      const val = (Math.sin(2 * Math.PI * freq * t) + 0.4 * Math.sin(4 * Math.PI * freq * t)) * env * amp;
      samples[startIdx + i] += val;
    }
  }

  decoyThump(0.05, 140, 0.18, 0.7);
  decoyThump(0.28, 120, 0.16, 0.55);

  const wav = createWavBuffer(sampleRate, samples);
  fs.writeFileSync(path.join(outputDir, 'heartbeat_decoy.mp3'), wav);
  fs.writeFileSync(path.join(outputDir, 'heartbeat_decoy.wav'), wav);
  console.log('Generated heartbeat_decoy.mp3 & .wav');
}

// 4. scream.mp3: Piercing horror screech
{
  const duration = 2.0;
  const totalSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const progress = t / duration;
    const env = Math.min(1, t * 15) * Math.exp(-progress * 2.2);
    // Warbling scream modulation
    const mod = Math.sin(2 * Math.PI * 18 * t) * 200;
    const f1 = 850 + mod - progress * 200;
    const f2 = 1200 + mod * 1.5 - progress * 300;
    const noise = (Math.random() * 2 - 1) * 0.35;
    let s = (Math.sin(2 * Math.PI * f1 * t) * 0.4 + Math.sin(2 * Math.PI * f2 * t) * 0.3 + noise) * env * 0.95;
    // Distortion clipping
    samples[i] = Math.tanh(s * 1.8);
  }

  const wav = createWavBuffer(sampleRate, samples);
  fs.writeFileSync(path.join(outputDir, 'scream.mp3'), wav);
  fs.writeFileSync(path.join(outputDir, 'scream.wav'), wav);
  console.log('Generated scream.mp3 & .wav');
}

// 5. jumpscare.mp3: Terrifying explosive sub-impact and distorted screech
{
  const duration = 2.5;
  const totalSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const progress = t / duration;
    const env = Math.min(1, t * 40) * Math.exp(-progress * 2.5);
    
    // Sub bass drop
    const subFreq = Math.max(35, 140 - t * 60);
    const sub = Math.sin(2 * Math.PI * subFreq * t) * 0.7;

    // Harsh metallic roar
    const roarMod = Math.sin(2 * Math.PI * 45 * t);
    const roar = Math.sin(2 * Math.PI * (400 + roarMod * 250) * t) * 0.5;

    // Distorted noise burst
    const noise = (Math.random() * 2 - 1) * Math.exp(-progress * 4) * 0.8;

    let s = (sub + roar + noise) * env;
    // Hard clip saturation
    samples[i] = Math.max(-1, Math.min(1, s * 2.2));
  }

  const wav = createWavBuffer(sampleRate, samples);
  fs.writeFileSync(path.join(outputDir, 'jumpscare.mp3'), wav);
  fs.writeFileSync(path.join(outputDir, 'jumpscare.wav'), wav);
  console.log('Generated jumpscare.mp3 & .wav');
}
